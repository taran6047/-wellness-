import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  requireUser: vi.fn(),
  revalidatePath: vi.fn(),
  userUpdateMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: { user: { updateMany: m.userUpdateMany } } }));
vi.mock("@/lib/require-user", () => ({ requireUser: m.requireUser }));
vi.mock("next/cache", () => ({ revalidatePath: m.revalidatePath }));

import { updateTimeZoneAction } from "@/app/actions/timezone";

const GENERIC_ERROR = "Что-то пошло не так. Попробуйте ещё раз";
const INVALID_ZONE = "Выберите часовой пояс из списка";
const LIMIT_PREFIX = "Часовой пояс можно менять не чаще одного раза в 7 дней. Следующая смена будет доступна ";
const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-10-06T12:00:00.000Z");

function fd(fields: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

type Where = {
  id: string;
  OR: ({ timeZoneChangedAt: null } | { timeZoneChangedAt: { lte: Date } })[];
};

// Имитация БД: updateMany применяет условие where к «хранимой» дате последней смены
function simulateDb(changedAt: Date | null) {
  m.userUpdateMany.mockImplementation(async ({ where }: { where: Where }) => {
    const ok = where.OR.some((c) =>
      c.timeZoneChangedAt === null
        ? changedAt === null
        : changedAt !== null && changedAt.getTime() <= c.timeZoneChangedAt.lte.getTime(),
    );
    return { count: ok ? 1 : 0 };
  });
}

function user(over: Record<string, unknown> = {}) {
  return { id: "me", familyId: "fam-1", timeZone: "UTC", timeZoneChangedAt: null, ...over };
}

function formatNext(date: Date, timeZone: string) {
  return date.toLocaleString("ru-RU", { timeZone, dateStyle: "short", timeStyle: "short" });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  m.requireUser.mockResolvedValue(user());
  m.userUpdateMany.mockResolvedValue({ count: 1 });
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
});

describe("updateTimeZoneAction: сохранение", () => {
  it("сохраняет пояс только пользователю из сессии, фиксирует время смены и возвращает сообщение", async () => {
    const r = await updateTimeZoneAction(undefined, fd({ timeZone: "Europe/Moscow" }));
    expect(r).toEqual({ message: "Часовой пояс сохранён" });
    expect(m.userUpdateMany).toHaveBeenCalledTimes(1);
    expect(m.userUpdateMany).toHaveBeenCalledWith({
      where: {
        id: "me",
        OR: [{ timeZoneChangedAt: null }, { timeZoneChangedAt: { lte: new Date(NOW.getTime() - 7 * DAY) } }],
      },
      data: { timeZone: "Europe/Moscow", timeZoneChangedAt: NOW },
    });
  });

  it("условие 7 дней находится в самом запросе (updateMany), а не в отдельной проверке", async () => {
    await updateTimeZoneAction(undefined, fd({ timeZone: "Asia/Tokyo" }));
    const where = m.userUpdateMany.mock.calls[0][0].where;
    expect(where.OR).toHaveLength(2);
    expect(where.OR[1].timeZoneChangedAt.lte).toEqual(new Date(NOW.getTime() - 7 * DAY));
  });

  it("подделанные userId/id в форме игнорируются", async () => {
    await updateTimeZoneAction(
      undefined,
      fd({ timeZone: "Asia/Tokyo", userId: "victim", id: "victim", familyId: "other" }),
    );
    const arg = m.userUpdateMany.mock.calls[0][0];
    expect(arg.where.id).toBe("me");
    expect(arg.data).toEqual({ timeZone: "Asia/Tokyo", timeZoneChangedAt: NOW });
    expect(JSON.stringify(arg)).not.toContain("victim");
  });

  it("принимает UTC", async () => {
    m.requireUser.mockResolvedValue(user({ timeZone: "Europe/Moscow" }));
    const r = await updateTimeZoneAction(undefined, fd({ timeZone: "UTC" }));
    expect(r).toEqual({ message: "Часовой пояс сохранён" });
    expect(m.userUpdateMany.mock.calls[0][0].data.timeZone).toBe("UTC");
  });

  it("после сохранения вызывается revalidatePath('/', 'layout')", async () => {
    await updateTimeZoneAction(undefined, fd({ timeZone: "Europe/Berlin" }));
    expect(m.revalidatePath).toHaveBeenCalledWith("/", "layout");
  });
});

describe("updateTimeZoneAction: строгий список", () => {
  it.each(["Mars/Base", "", "   ", "+23:59", "-05:00", "GMT+3", "europe/moscow", " Europe/Moscow", "Europe/Moscow\n", "<script>"])(
    "недопустимый пояс %j отклоняется вместо подстановки UTC",
    async (tz) => {
      const r = await updateTimeZoneAction(undefined, fd({ timeZone: tz }));
      expect(r).toEqual({ error: INVALID_ZONE });
      expect(m.userUpdateMany).not.toHaveBeenCalled();
      expect(m.revalidatePath).not.toHaveBeenCalled();
    },
  );

  it("поле отсутствует в форме: отказ, UTC не подставляется", async () => {
    m.requireUser.mockResolvedValue(user({ timeZone: "Europe/Moscow" }));
    const r = await updateTimeZoneAction(undefined, new FormData());
    expect(r).toEqual({ error: INVALID_ZONE });
    expect(m.userUpdateMany).not.toHaveBeenCalled();
  });

  it("поле-файл вместо строки: отказ", async () => {
    const f = new FormData();
    f.set("timeZone", new Blob(["x"]), "x.txt");
    expect(await updateTimeZoneAction(undefined, f)).toEqual({ error: INVALID_ZONE });
    expect(m.userUpdateMany).not.toHaveBeenCalled();
  });

  it("отказ по списку не расходует лимит: БД не вызывается", async () => {
    await updateTimeZoneAction(undefined, fd({ timeZone: "Nowhere/City" }));
    expect(m.userUpdateMany).not.toHaveBeenCalled();
  });
});

describe("updateTimeZoneAction: тот же пояс", () => {
  it("выбранный пояс совпадает с текущим: сообщение, без записи и без revalidatePath", async () => {
    m.requireUser.mockResolvedValue(user({ timeZone: "Europe/Moscow" }));
    const r = await updateTimeZoneAction(undefined, fd({ timeZone: "Europe/Moscow" }));
    expect(r).toEqual({ message: "Этот часовой пояс уже выбран" });
    expect(m.userUpdateMany).not.toHaveBeenCalled();
    expect(m.revalidatePath).not.toHaveBeenCalled();
  });
});

describe("updateTimeZoneAction: не чаще одного раза в 7 дней", () => {
  it("первая смена (timeZoneChangedAt = null, регистрация не считается): разрешена", async () => {
    simulateDb(null);
    const r = await updateTimeZoneAction(undefined, fd({ timeZone: "Asia/Tokyo" }));
    expect(r).toEqual({ message: "Часовой пояс сохранён" });
    expect(m.revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it.each([
    ["только что", 0],
    ["3 дня назад", 3 * DAY],
    ["6 суток 23 часа назад", 7 * DAY - 60 * 60 * 1000],
    ["за 1 мс до границы", 7 * DAY - 1],
  ])("смена %s: отказ с сообщением и датой следующей смены", async (_n, agoMs) => {
    const changedAt = new Date(NOW.getTime() - agoMs);
    simulateDb(changedAt);
    m.requireUser.mockResolvedValue(user({ timeZoneChangedAt: changedAt }));
    const r = await updateTimeZoneAction(undefined, fd({ timeZone: "Asia/Tokyo" }));
    const next = new Date(changedAt.getTime() + 7 * DAY);
    expect(r).toEqual({ error: `${LIMIT_PREFIX}${formatNext(next, "UTC")}` });
    expect(m.revalidatePath).not.toHaveBeenCalled();
  });

  it.each([
    ["ровно 7 дней назад", 7 * DAY],
    ["8 дней назад", 8 * DAY],
    ["полгода назад", 180 * DAY],
  ])("смена %s: разрешена", async (_n, agoMs) => {
    const changedAt = new Date(NOW.getTime() - agoMs);
    simulateDb(changedAt);
    m.requireUser.mockResolvedValue(user({ timeZoneChangedAt: changedAt }));
    const r = await updateTimeZoneAction(undefined, fd({ timeZone: "Asia/Tokyo" }));
    expect(r).toEqual({ message: "Часовой пояс сохранён" });
    expect(m.revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("дата следующей смены показана в поясе пользователя (Asia/Tokyo, UTC+9)", async () => {
    const changedAt = new Date(NOW.getTime() - 2 * DAY);
    simulateDb(changedAt);
    m.requireUser.mockResolvedValue(user({ timeZone: "Asia/Tokyo", timeZoneChangedAt: changedAt }));
    const r = await updateTimeZoneAction(undefined, fd({ timeZone: "UTC" }));
    const next = new Date(changedAt.getTime() + 7 * DAY);
    expect(r).toEqual({ error: `${LIMIT_PREFIX}${formatNext(next, "Asia/Tokyo")}` });
    expect(r?.error).toContain("21:00");
  });

  it("гонка (count 0, а в сессии timeZoneChangedAt пуст): дата отсчитывается от текущего момента", async () => {
    m.userUpdateMany.mockResolvedValue({ count: 0 });
    const r = await updateTimeZoneAction(undefined, fd({ timeZone: "Asia/Tokyo" }));
    expect(r).toEqual({ error: `${LIMIT_PREFIX}${formatNext(new Date(NOW.getTime() + 7 * DAY), "UTC")}` });
    expect(m.revalidatePath).not.toHaveBeenCalled();
  });

  it("при отказе по лимиту это не сбой: ошибка не логируется", async () => {
    m.userUpdateMany.mockResolvedValue({ count: 0 });
    await updateTimeZoneAction(undefined, fd({ timeZone: "Asia/Tokyo" }));
    expect(console.error).not.toHaveBeenCalled();
  });

  it("вторая смена сразу после первой отклоняется (повторный вызов с обновлённым пользователем)", async () => {
    simulateDb(null);
    const first = await updateTimeZoneAction(undefined, fd({ timeZone: "Asia/Tokyo" }));
    expect(first).toEqual({ message: "Часовой пояс сохранён" });
    // после первой смены в БД и в сессии фиксируется момент смены
    simulateDb(NOW);
    m.requireUser.mockResolvedValue(user({ timeZone: "Asia/Tokyo", timeZoneChangedAt: NOW }));
    const second = await updateTimeZoneAction(undefined, fd({ timeZone: "Europe/Berlin" }));
    expect(second?.error).toContain("не чаще одного раза в 7 дней");
  });
});

describe("updateTimeZoneAction: сбои и сессия", () => {
  it("сбой БД: общее сообщение без деталей, revalidatePath не вызывается", async () => {
    m.userUpdateMany.mockRejectedValue(new Error("connection refused"));
    const r = await updateTimeZoneAction(undefined, fd({ timeZone: "Europe/Moscow" }));
    expect(r).toEqual({ error: GENERIC_ERROR });
    expect(JSON.stringify(r)).not.toContain("connection refused");
    expect(m.revalidatePath).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalled();
  });

  it("без сессии (requireUser бросает redirect) БД не вызывается", async () => {
    const redirect = new Error("NEXT_REDIRECT:/login");
    m.requireUser.mockRejectedValue(redirect);
    await expect(updateTimeZoneAction(undefined, fd({ timeZone: "Asia/Tokyo" }))).rejects.toBe(redirect);
    expect(m.userUpdateMany).not.toHaveBeenCalled();
  });
});
