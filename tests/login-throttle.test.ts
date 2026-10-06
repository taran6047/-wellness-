import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  executeRaw: vi.fn(),
  deleteMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    $executeRaw: m.executeRaw,
    loginAttempt: { deleteMany: m.deleteMany },
  },
}));

import { LOGIN_LOCK_MS, LOGIN_WINDOW_MS, MAX_LOGIN_FAILURES } from "@/lib/constants";
import { clearFailedLogins, isLocked, recordFailedLogin } from "@/lib/login-throttle";

const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;
const T0 = new Date("2026-10-06T12:00:00.000Z");

beforeEach(() => {
  vi.resetAllMocks();
  m.executeRaw.mockResolvedValue(1);
  m.deleteMany.mockResolvedValue({ count: 0 });
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});
afterEach(() => {
  vi.useRealTimers();
});

// $executeRaw вызывается как tagged template: (strings, ...values)
function rawCall(): { strings: readonly string[]; values: unknown[]; sql: string } {
  const [strings, ...values] = m.executeRaw.mock.calls[0] as [readonly string[], ...unknown[]];
  return { strings, values, sql: strings.join("?").replace(/\s+/g, " ").trim() };
}

describe("константы защиты входа", () => {
  it("5 неудач, окно 15 минут, блокировка 15 минут", () => {
    expect(MAX_LOGIN_FAILURES).toBe(5);
    expect(LOGIN_WINDOW_MS).toBe(15 * MIN);
    expect(LOGIN_LOCK_MS).toBe(15 * MIN);
  });
});

describe("isLocked", () => {
  const row = (lockedUntil: Date | null) => ({ failedCount: 5, windowStart: T0, lockedUntil });

  it("нет записи: не заблокирован", () => {
    expect(isLocked(null)).toBe(false);
  });

  it("lockedUntil пуст: не заблокирован", () => {
    expect(isLocked(row(null))).toBe(false);
  });

  it("lockedUntil в будущем: заблокирован", () => {
    expect(isLocked(row(new Date(T0.getTime() + 1)))).toBe(true);
  });

  it("lockedUntil ровно сейчас: уже не заблокирован", () => {
    expect(isLocked(row(new Date(T0.getTime())))).toBe(false);
  });

  it("lockedUntil в прошлом: не заблокирован", () => {
    expect(isLocked(row(new Date(T0.getTime() - 1)))).toBe(false);
  });

  it("параметр now переопределяет текущее время", () => {
    const r = row(new Date(T0.getTime() + 10 * MIN));
    expect(isLocked(r, new Date(T0.getTime() + 9 * MIN))).toBe(true);
    expect(isLocked(r, new Date(T0.getTime() + 11 * MIN))).toBe(false);
  });

  it("по умолчанию берётся текущее (фейковое) время", () => {
    const r = row(new Date(T0.getTime() + 10 * MIN));
    expect(isLocked(r)).toBe(true);
    vi.setSystemTime(new Date(T0.getTime() + 10 * MIN));
    expect(isLocked(r)).toBe(false);
  });
});

// Логика окна и порога (сброс по истечении окна, блокировка на 5-й неудаче, неубывающий счёт
// при параллельных попытках) целиком живёт в SQL (INSERT ... ON CONFLICT DO UPDATE).
// Мок $executeRaw её не исполняет, а повторная ручная реализация в тесте проверяла бы саму себя.
// Поэтому ниже проверяется только контракт вызова; семантика SQL проверяется отдельно на реальной БД.
describe("recordFailedLogin: атомарный SQL-запрос", () => {
  it("$executeRaw вызывается ровно один раз", async () => {
    await recordFailedLogin("a@b.com", null);
    expect(m.executeRaw).toHaveBeenCalledTimes(1);
  });

  it("в запрос передаются email и текущее время в ISO", async () => {
    await recordFailedLogin("a@b.com", null);
    const { values } = rawCall();
    expect(values[0]).toBe("a@b.com");
    expect(values[1]).toBe(T0.toISOString());
  });

  it("параметр now используется вместо текущего времени", async () => {
    const now = new Date("2030-01-01T00:00:00.000Z");
    await recordFailedLogin("a@b.com", null, now);
    const { values } = rawCall();
    expect(values[1]).toBe("2030-01-01T00:00:00.000Z");
    expect(values).toContain(new Date(now.getTime() + LOGIN_LOCK_MS).toISOString());
    expect(values).toContain(new Date(now.getTime() - LOGIN_WINDOW_MS).toISOString());
  });

  it("запрос содержит INSERT ... ON CONFLICT по email и DO UPDATE", async () => {
    await recordFailedLogin("a@b.com", null);
    const { sql } = rawCall();
    expect(sql).toContain('INSERT INTO "LoginAttempt"');
    expect(sql).toContain('ON CONFLICT ("email") DO UPDATE');
  });

  it("запрос обновляет счётчик, начало окна и блокировку", async () => {
    await recordFailedLogin("a@b.com", null);
    const { sql } = rawCall();
    expect(sql).toContain('"failedCount" = CASE');
    expect(sql).toContain('"windowStart" = CASE');
    expect(sql).toContain('"lockedUntil" = CASE');
    expect(sql).toContain('"LoginAttempt"."failedCount" + 1');
  });

  it("все временные параметры (кроме email и порога) приводятся ::timestamp", async () => {
    await recordFailedLogin("a@b.com", null);
    const { strings, values } = rawCall();
    const isoIdx = values
      .map((v, i) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v) ? i : -1))
      .filter((i) => i >= 0);
    expect(isoIdx.length).toBeGreaterThanOrEqual(5);
    for (const i of isoIdx) {
      expect(strings[i + 1].startsWith("::timestamp")).toBe(true);
    }
    // email и порог не приводятся к timestamp
    expect(strings[1].startsWith("::timestamp")).toBe(false);
  });

  it("порог MAX_LOGIN_FAILURES передаётся параметром, а не зашит в текст запроса", async () => {
    await recordFailedLogin("a@b.com", null);
    const { values, sql } = rawCall();
    expect(values.filter((v) => v === MAX_LOGIN_FAILURES).length).toBeGreaterThanOrEqual(2);
    expect(sql).toContain(">= ?");
  });

  it("граница окна (now - 15 мин) и конец блокировки (now + 15 мин) передаются параметрами", async () => {
    await recordFailedLogin("a@b.com", null);
    const { values } = rawCall();
    const cutoff = new Date(T0.getTime() - LOGIN_WINDOW_MS).toISOString();
    const lockUntil = new Date(T0.getTime() + LOGIN_LOCK_MS).toISOString();
    expect(values.filter((v) => v === cutoff).length).toBeGreaterThanOrEqual(1);
    expect(values.filter((v) => v === lockUntil).length).toBeGreaterThanOrEqual(1);
  });

  it("аргумент attempt игнорируется: актуальное состояние берётся из БД, запрос тот же", async () => {
    await recordFailedLogin("a@b.com", null);
    const first = rawCall();
    m.executeRaw.mockClear();
    await recordFailedLogin("a@b.com", {
      failedCount: 4,
      windowStart: new Date(T0.getTime() - 5 * MIN),
      lockedUntil: null,
    });
    const second = rawCall();
    expect(second.sql).toBe(first.sql);
    expect(second.values).toEqual(first.values);
  });

  it("запись не делается через loginAttempt.upsert (его нет в моке): только $executeRaw", async () => {
    await expect(recordFailedLogin("a@b.com", null)).resolves.toBeUndefined();
  });
});

describe("recordFailedLogin: очистка устаревших записей", () => {
  it("deleteMany вызывается один раз после запроса", async () => {
    const order: string[] = [];
    m.executeRaw.mockImplementation(async () => void order.push("raw"));
    m.deleteMany.mockImplementation(async () => void order.push("delete"));
    await recordFailedLogin("a@b.com", null);
    expect(m.deleteMany).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["raw", "delete"]);
  });

  it("where: окно истекло более суток назад и блокировки нет или она в прошлом", async () => {
    await recordFailedLogin("a@b.com", null);
    expect(m.deleteMany).toHaveBeenCalledWith({
      where: {
        windowStart: { lt: new Date(T0.getTime() - LOGIN_WINDOW_MS - DAY) },
        OR: [{ lockedUntil: null }, { lockedUntil: { lt: T0 } }],
      },
    });
  });

  it("очистка не ограничена email: чистит чужие устаревшие записи, а не только текущую", async () => {
    await recordFailedLogin("a@b.com", null);
    expect(m.deleteMany.mock.calls[0][0].where).not.toHaveProperty("email");
  });

  it("граница вычисляется от параметра now", async () => {
    const now = new Date("2030-01-01T00:00:00.000Z");
    await recordFailedLogin("a@b.com", null, now);
    const where = m.deleteMany.mock.calls[0][0].where;
    expect(where.windowStart.lt).toEqual(new Date(now.getTime() - 15 * MIN - DAY));
    expect(where.OR[1].lockedUntil.lt).toEqual(now);
  });
});

describe("recordFailedLogin: сбои БД", () => {
  it("сбой $executeRaw пробрасывается, очистка не запускается", async () => {
    m.executeRaw.mockRejectedValue(new Error("db down"));
    await expect(recordFailedLogin("a@b.com", null)).rejects.toThrow("db down");
    expect(m.deleteMany).not.toHaveBeenCalled();
  });

  it("сбой очистки (deleteMany) пробрасывается, ошибка не глотается", async () => {
    m.deleteMany.mockRejectedValue(new Error("cleanup failed"));
    await expect(recordFailedLogin("a@b.com", null)).rejects.toThrow("cleanup failed");
    expect(m.executeRaw).toHaveBeenCalledTimes(1);
  });
});

describe("clearFailedLogins", () => {
  it("удаляет запись только этого email", async () => {
    await clearFailedLogins("a@b.com");
    expect(m.deleteMany).toHaveBeenCalledTimes(1);
    expect(m.deleteMany).toHaveBeenCalledWith({ where: { email: "a@b.com" } });
  });

  it("не падает, если записи нет", async () => {
    await expect(clearFailedLogins("none@b.com")).resolves.toBeUndefined();
  });

  it("сбой БД пробрасывается", async () => {
    m.deleteMany.mockRejectedValue(new Error("db down"));
    await expect(clearFailedLogins("a@b.com")).rejects.toThrow("db down");
  });
});
