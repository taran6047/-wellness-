import bcrypt from "bcryptjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Сквозная проверка authorize с настоящим login-throttle: БД заменена хранилищем в памяти

type Row = { email: string; failedCount: number; windowStart: Date; lockedUntil: Date | null };

const m = vi.hoisted(() => {
  class AuthError extends Error {}
  class CredentialsSignin extends AuthError {
    code = "credentials";
  }
  return {
    CredentialsSignin,
    nextAuth: vi.fn(),
    userFindUnique: vi.fn(),
    attemptFindUnique: vi.fn(),
    executeRaw: vi.fn(),
    attemptDeleteMany: vi.fn(),
  };
});

vi.mock("next-auth", () => ({
  default: (config: unknown) => {
    m.nextAuth(config);
    return { handlers: {}, auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn() };
  },
  CredentialsSignin: m.CredentialsSignin,
}));
vi.mock("next-auth/providers/credentials", () => ({
  default: (options: unknown) => options,
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    user: { findUnique: m.userFindUnique },
    $executeRaw: m.executeRaw,
    loginAttempt: {
      findUnique: m.attemptFindUnique,
      deleteMany: m.attemptDeleteMany,
    },
  },
}));

const MIN = 60 * 1000;
const T0 = new Date("2026-10-06T12:00:00.000Z");
const PASSWORD = "correct-password";
const EXISTING = "anna@example.com";
const GHOST = "ghost@example.com";

const store = new Map<string, Row>();

type DeleteWhere = {
  email?: string;
  windowStart?: { lt: Date };
  OR?: [{ lockedUntil: null }, { lockedUntil: { lt: Date } }];
};

// Эмуляция INSERT ... ON CONFLICT DO UPDATE из recordFailedLogin по тем же правилам:
// окно 15 минут от первой неудачи, порог 5, блокировка 15 минут.
// Значения шаблона: [0] email, [1] now, [2] порог, [3] конец блокировки, [4] граница окна.
// Реальная семантика SQL проверяется отдельно на настоящей БД; здесь важно только,
// что authorize и login-throttle согласованы между собой.
function emulateUpsertSql(values: unknown[]) {
  const [email, nowIso, max, lockIso, cutoffIso] = values as [string, string, number, string, string];
  const now = new Date(nowIso);
  const lockUntil = new Date(lockIso);
  const cutoff = new Date(cutoffIso);
  const prev = store.get(email);
  if (!prev) {
    store.set(email, {
      email,
      failedCount: 1,
      windowStart: now,
      lockedUntil: 1 >= max ? lockUntil : null,
    });
    return;
  }
  const expired = prev.windowStart.getTime() < cutoff.getTime();
  const failedCount = expired ? 1 : prev.failedCount + 1;
  store.set(email, {
    email,
    failedCount,
    windowStart: expired ? now : prev.windowStart,
    lockedUntil: failedCount >= max ? lockUntil : null,
  });
}

let authorize: (raw: unknown) => Promise<unknown>;
let passwordHash: string;

beforeEach(async () => {
  if (!authorize) {
    await import("@/auth");
    authorize = (m.nextAuth.mock.calls[0][0] as {
      providers: { authorize: (raw: unknown) => Promise<unknown> }[];
    }).providers[0].authorize;
    passwordHash = bcrypt.hashSync(PASSWORD, 4);
  }
  store.clear();
  // Fake timers только для Date: bcrypt и промисы работают как обычно
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);

  m.userFindUnique.mockReset();
  m.userFindUnique.mockImplementation(async ({ where }: { where: { email: string } }) =>
    where.email === EXISTING ? { id: "u1", name: "Анна", email: EXISTING, passwordHash } : null,
  );
  m.attemptFindUnique.mockReset();
  m.attemptFindUnique.mockImplementation(async ({ where }: { where: { email: string } }) => {
    const row = store.get(where.email);
    return row ? { ...row } : null;
  });
  m.executeRaw.mockReset();
  m.executeRaw.mockImplementation(async (_strings: readonly string[], ...values: unknown[]) => {
    emulateUpsertSql(values);
    return 1;
  });
  m.attemptDeleteMany.mockReset();
  m.attemptDeleteMany.mockImplementation(async ({ where }: { where: DeleteWhere }) => {
    if (where.email !== undefined) {
      store.delete(where.email);
      return;
    }
    // Очистка устаревших: windowStart < lt и (lockedUntil пуст или в прошлом)
    for (const [email, row] of store) {
      const stale = row.windowStart.getTime() < where.windowStart!.lt.getTime();
      const unlocked = !row.lockedUntil || row.lockedUntil.getTime() < where.OR![1].lockedUntil.lt.getTime();
      if (stale && unlocked) store.delete(email);
    }
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const advance = (ms: number) => vi.setSystemTime(new Date(Date.now() + ms));

type Outcome = "ok" | "null" | "locked";
async function login(email: string, password: string): Promise<Outcome> {
  try {
    const r = await authorize({ email, password });
    return r ? "ok" : "null";
  } catch (e) {
    if ((e as { code?: string }).code === "locked") return "locked";
    throw e;
  }
}

describe("authorize + login-throttle", () => {
  it("5 неверных паролей: все возвращают null, 6-я попытка даже с верным паролем — locked", async () => {
    const outcomes: Outcome[] = [];
    for (let i = 0; i < 5; i++) outcomes.push(await login(EXISTING, "wrong-password"));
    expect(outcomes).toEqual(["null", "null", "null", "null", "null"]);
    expect(await login(EXISTING, PASSWORD)).toBe("locked");
    expect(await login(EXISTING, "wrong-password")).toBe("locked");
  });

  it("несуществующий email проходит ту же последовательность, что и существующий", async () => {
    const run = async (email: string) => {
      const out: Outcome[] = [];
      for (let i = 0; i < 7; i++) out.push(await login(email, "wrong-password"));
      return out;
    };
    const existing = await run(EXISTING);
    const ghost = await run(GHOST);
    expect(ghost).toEqual(existing);
    expect(existing).toEqual(["null", "null", "null", "null", "null", "locked", "locked"]);
  });

  it("через 15 минут блокировка снимается и верный пароль пускает, счётчик очищается", async () => {
    for (let i = 0; i < 5; i++) await login(EXISTING, "wrong-password");
    advance(15 * MIN - 1);
    expect(await login(EXISTING, PASSWORD)).toBe("locked");
    advance(1);
    expect(await login(EXISTING, PASSWORD)).toBe("ok");
    expect(store.has(EXISTING)).toBe(false);
  });

  it("успешный вход до лимита сбрасывает неудачи", async () => {
    for (let i = 0; i < 4; i++) await login(EXISTING, "wrong-password");
    expect(await login(EXISTING, PASSWORD)).toBe("ok");
    expect(store.has(EXISTING)).toBe(false);
    for (let i = 0; i < 4; i++) {
      expect(await login(EXISTING, "wrong-password")).toBe("null");
    }
    // верный пароль всё ещё работает: блокировки нет
    expect(await login(EXISTING, PASSWORD)).toBe("ok");
  });

  it("окно истекает: 4 неудачи, пауза больше 15 минут, ещё 4 неудачи не блокируют", async () => {
    for (let i = 0; i < 4; i++) await login(EXISTING, "wrong-password");
    advance(15 * MIN + 1);
    for (let i = 0; i < 4; i++) await login(EXISTING, "wrong-password");
    expect(await login(EXISTING, PASSWORD)).toBe("ok");
  });

  it("во время блокировки неверные попытки не продлевают её", async () => {
    for (let i = 0; i < 5; i++) await login(EXISTING, "wrong-password");
    advance(10 * MIN);
    expect(await login(EXISTING, "wrong-password")).toBe("locked");
    advance(5 * MIN);
    expect(await login(EXISTING, PASSWORD)).toBe("ok");
  });

  it("блокировка одного email не мешает входу другого пользователя", async () => {
    for (let i = 0; i < 5; i++) await login(GHOST, "wrong-password");
    expect(await login(GHOST, "wrong-password")).toBe("locked");
    expect(await login(EXISTING, PASSWORD)).toBe("ok");
  });

  it("регистр и пробелы в email не обходят блокировку (email нормализуется схемой)", async () => {
    for (let i = 0; i < 5; i++) await login(EXISTING, "wrong-password");
    expect(await login(" Anna@Example.com ", PASSWORD)).toBe("locked");
  });

  it("bcrypt.compare вызывается на каждой попытке, включая заблокированные и несуществующий email", async () => {
    const spy = vi.spyOn(bcrypt, "compare");
    for (let i = 0; i < 5; i++) await login(EXISTING, "wrong-password");
    await login(EXISTING, PASSWORD); // locked
    await login(GHOST, PASSWORD);
    expect(spy).toHaveBeenCalledTimes(7);
  });
});
