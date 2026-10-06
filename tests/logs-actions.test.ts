import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => {
  const model = () => ({
    create: vi.fn(),
    deleteMany: vi.fn(),
    count: vi.fn(),
    findMany: vi.fn(),
  });
  const tx = {
    activityLog: model(),
    mealLog: model(),
    waterLog: model(),
    healthLog: model(),
    pointsEvent: { create: vi.fn(), aggregate: vi.fn(), deleteMany: vi.fn() },
    $executeRaw: vi.fn(),
    achievement: { createMany: vi.fn(), findUniqueOrThrow: vi.fn() },
    userAchievement: { findMany: vi.fn(), createMany: vi.fn() },
  };
  return {
    requireUser: vi.fn(),
    revalidatePath: vi.fn(),
    transaction: vi.fn(),
    ...tx,
  };
});

// Транзакция просто выполняет колбэк с теми же моками
vi.mock("@/lib/db", () => ({
  prisma: {
    $transaction: m.transaction,
  },
}));
vi.mock("@/lib/require-user", () => ({ requireUser: m.requireUser }));
vi.mock("next/cache", () => ({ revalidatePath: m.revalidatePath }));

import {
  addActivityAction,
  addHealthAction,
  addMealAction,
  addWaterAction,
  deleteActivityAction,
  deleteHealthAction,
  deleteMealAction,
  deleteWaterAction,
} from "@/app/actions/logs";

const GENERIC_ERROR = "Что-то пошло не так. Попробуйте ещё раз";
const TODAY = new Date().toISOString().slice(0, 10);

function fd(fields: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
  m.requireUser.mockResolvedValue({ id: "me", familyId: "fam-1", timeZone: "UTC" });
  m.transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(m));
  for (const model of [m.activityLog, m.mealLog, m.waterLog, m.healthLog]) {
    model.create.mockResolvedValue({ id: "log1" });
    model.deleteMany.mockResolvedValue({ count: 1 });
    model.count.mockResolvedValue(0);
    model.findMany.mockResolvedValue([]);
  }
  m.pointsEvent.aggregate.mockResolvedValue({ _sum: { points: null } });
  m.pointsEvent.create.mockResolvedValue({});
  m.pointsEvent.deleteMany.mockResolvedValue({ count: 1 });
  m.$executeRaw.mockResolvedValue(1);
  m.achievement.createMany.mockResolvedValue({ count: 1 });
  m.achievement.findUniqueOrThrow.mockResolvedValue({ id: "ach1" });
  m.userAchievement.findMany.mockResolvedValue([]);
  m.userAchievement.createMany.mockResolvedValue({ count: 1 });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

const addCases = [
  {
    name: "addActivityAction",
    action: addActivityAction,
    model: "activityLog",
    path: "/activity",
    message: "Сохранено, +6 баллов",
    valid: { type: "running", durationMinutes: "30", distanceKm: "5", note: "бег", date: TODAY },
    invalid: { type: "running", durationMinutes: "0", date: TODAY },
    invalidMsg: "Длительность: от 1 до 1440 минут",
  },
  {
    name: "addMealAction",
    action: addMealAction,
    model: "mealLog",
    path: "/nutrition",
    message: "Сохранено, +5 баллов",
    valid: { mealType: "lunch", description: "суп", date: TODAY },
    invalid: { mealType: "brunch", description: "суп", date: TODAY },
    invalidMsg: "Выберите приём пищи",
  },
  {
    name: "addWaterAction",
    action: addWaterAction,
    model: "waterLog",
    path: "/nutrition",
    message: "Сохранено, +1 балл",
    valid: { amountMl: "250", date: TODAY },
    invalid: { amountMl: "5001", date: TODAY },
    invalidMsg: "Объём: от 1 до 5000 мл",
  },
  {
    name: "addHealthAction",
    action: addHealthAction,
    model: "healthLog",
    path: "/health",
    message: "Сохранено, +5 баллов",
    valid: { weightKg: "60", sleepHours: "8", mood: "4", note: "ок", date: TODAY },
    invalid: { note: "ничего", date: TODAY },
    invalidMsg: "Заполните вес, сон или самочувствие",
  },
] as const;

describe.each(addCases)("$name", ({ action, model, path, valid, invalid, invalidMsg, message }) => {
  it("сохраняет запись от имени пользователя из сессии и вызывает revalidatePath", async () => {
    const r = await action(undefined, fd(valid));
    expect(r).toEqual({ message });
    expect(m[model].create).toHaveBeenCalledTimes(1);
    expect(m[model].create.mock.calls[0][0].data.userId).toBe("me");
    expect(m[model].create.mock.calls[0][0].data.date).toEqual(new Date(`${TODAY}T00:00:00.000Z`));
    expect(m.revalidatePath).toHaveBeenCalledWith(path);
    expect(m.revalidatePath).toHaveBeenCalledWith("/progress");
  });

  it("при достигнутом суточном лимите сообщение о лимите, запись всё равно сохранена", async () => {
    m.pointsEvent.aggregate.mockResolvedValueOnce({ _sum: { points: 1000 } });
    const r = await action(undefined, fd(valid));
    expect(r).toEqual({ message: "Сохранено, лимит баллов на сегодня достигнут" });
    expect(m[model].create).toHaveBeenCalledTimes(1);
  });

  it("новое достижение добавляется к сообщению", async () => {
    m[model].count.mockResolvedValue(1);
    const r = await action(undefined, fd(valid));
    expect(r?.message).toMatch(/^Сохранено, .*\. Новое достижение: .+/);
    expect(r?.error).toBeUndefined();
  });

  it("подделанные userId/familyId в FormData игнорируются", async () => {
    await action(undefined, fd({ ...valid, userId: "victim", familyId: "other-fam" }));
    const data = m[model].create.mock.calls[0][0].data;
    expect(data.userId).toBe("me");
    expect(JSON.stringify(data)).not.toContain("victim");
    expect(data).not.toHaveProperty("familyId");
  });

  it("невалидные данные: русская ошибка, БД и revalidatePath не вызываются", async () => {
    const r = await action(undefined, fd(invalid));
    expect(r).toEqual({ error: invalidMsg });
    expect(m[model].create).not.toHaveBeenCalled();
    expect(m.revalidatePath).not.toHaveBeenCalled();
  });

  it("пустой FormData не падает и возвращает ошибку", async () => {
    const r = await action(undefined, new FormData());
    expect(r?.error).toBeTruthy();
    expect(m[model].create).not.toHaveBeenCalled();
  });

  it("сбой БД: общее сообщение без деталей, revalidatePath не вызывается", async () => {
    m[model].create.mockRejectedValue(new Error("connection refused"));
    const r = await action(undefined, fd(valid));
    expect(r).toEqual({ error: GENERIC_ERROR });
    expect(m.revalidatePath).not.toHaveBeenCalled();
  });

  it("без сессии (requireUser бросает redirect) ничего не сохраняется", async () => {
    const redirect = new Error("NEXT_REDIRECT:/login");
    m.requireUser.mockRejectedValue(redirect);
    await expect(action(undefined, fd(valid))).rejects.toBe(redirect);
    expect(m[model].create).not.toHaveBeenCalled();
  });
});

describe.each(addCases)("$name: окно дат по поясу пользователя", ({ action, model, valid }) => {
  const DATE_WINDOW_ERROR = "Можно отметить только сегодняшний или вчерашний день";
  const NOW = "2026-10-06T12:00:00.000Z"; // UTC: сегодня 10-06

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(NOW));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each(["2026-10-06", "2026-10-05"])("дата %s (сегодня/вчера) сохраняется", async (date) => {
    const r = await action(undefined, fd({ ...valid, date }));
    expect(r?.error).toBeUndefined();
    expect(m[model].create).toHaveBeenCalledTimes(1);
  });

  it.each(["2026-10-04", "2026-10-07", "2026-01-01", "2030-10-06"])(
    "дата %s вне окна: ошибка, БД и revalidatePath не вызываются",
    async (date) => {
      const r = await action(undefined, fd({ ...valid, date }));
      expect(r).toEqual({ error: DATE_WINDOW_ERROR });
      expect(m.transaction).not.toHaveBeenCalled();
      expect(m[model].create).not.toHaveBeenCalled();
      expect(m.revalidatePath).not.toHaveBeenCalled();
    },
  );

  it("окно считается по me.timeZone: Pacific/Auckland уже на 10-07 (UTC 12:00 = 10-07 01:00)", async () => {
    m.requireUser.mockResolvedValue({ id: "me", familyId: "fam-1", timeZone: "Pacific/Auckland" });
    expect(await action(undefined, fd({ ...valid, date: "2026-10-07" }))).not.toEqual({
      error: DATE_WINDOW_ERROR,
    });
    expect(await action(undefined, fd({ ...valid, date: "2026-10-05" }))).toEqual({
      error: DATE_WINDOW_ERROR,
    });
  });

  it("America/Los_Angeles ещё на 10-06: вчера 10-05 можно, 10-07 нельзя", async () => {
    m.requireUser.mockResolvedValue({ id: "me", familyId: "fam-1", timeZone: "America/Los_Angeles" });
    expect((await action(undefined, fd({ ...valid, date: "2026-10-05" })))?.error).toBeUndefined();
    expect(await action(undefined, fd({ ...valid, date: "2026-10-07" }))).toEqual({
      error: DATE_WINDOW_ERROR,
    });
  });

  it("ошибка формата даты приходит раньше проверки окна", async () => {
    const r = await action(undefined, fd({ ...valid, date: "2026-02-30" }));
    expect(r).toEqual({ error: "Укажите дату" });
  });
});

describe("addActivityAction: детали данных", () => {
  it("пустые необязательные поля не попадают в БД как значения", async () => {
    await addActivityAction(
      undefined,
      fd({ type: "yoga", durationMinutes: "20", distanceKm: "", note: "", date: TODAY }),
    );
    const data = m.activityLog.create.mock.calls[0][0].data;
    expect(data.distanceKm).toBeUndefined();
    expect(data.note).toBeUndefined();
    expect(data.durationMinutes).toBe(20);
  });
});

describe("addHealthAction: детали данных", () => {
  it("пустые поля = не заполнено, достаточно одного", async () => {
    const r = await addHealthAction(
      undefined,
      fd({ weightKg: "", sleepHours: "", mood: "3", date: TODAY }),
    );
    expect(r).toEqual({ message: "Сохранено, +5 баллов" });
    const data = m.healthLog.create.mock.calls[0][0].data;
    expect(data.mood).toBe(3);
    expect(data.weightKg).toBeUndefined();
    expect(data.sleepHours).toBeUndefined();
  });
});

const deleteCases = [
  { name: "deleteActivityAction", action: deleteActivityAction, model: "activityLog", path: "/activity" },
  { name: "deleteMealAction", action: deleteMealAction, model: "mealLog", path: "/nutrition" },
  { name: "deleteWaterAction", action: deleteWaterAction, model: "waterLog", path: "/nutrition" },
  { name: "deleteHealthAction", action: deleteHealthAction, model: "healthLog", path: "/health" },
] as const;

describe.each(deleteCases)("$name", ({ action, model, path }) => {
  it("удаляет по {id, userId из сессии} и вызывает revalidatePath", async () => {
    m[model].deleteMany.mockResolvedValue({ count: 1 });
    await action(fd({ id: "rec1" }));
    expect(m[model].deleteMany).toHaveBeenCalledWith({ where: { id: "rec1", userId: "me" } });
    expect(m.revalidatePath).toHaveBeenCalledWith(path);
    expect(m.revalidatePath).toHaveBeenCalledWith("/progress");
  });

  it("подделанный userId в форме игнорируется", async () => {
    m[model].deleteMany.mockResolvedValue({ count: 0 });
    await action(fd({ id: "rec1", userId: "victim" }));
    expect(m[model].deleteMany).toHaveBeenCalledWith({ where: { id: "rec1", userId: "me" } });
  });

  it("чужая запись (count 0): ошибки нет, удаление ограничено своим userId", async () => {
    m[model].deleteMany.mockResolvedValue({ count: 0 });
    await expect(action(fd({ id: "foreign" }))).resolves.toBeUndefined();
    expect(m[model].deleteMany.mock.calls[0][0].where.userId).toBe("me");
  });

  it.each([["пустой id", { id: "" }], ["нет id", {}], ["id длиннее 64", { id: "a".repeat(65) }]])(
    "%s: БД не вызывается",
    async (_t, fields) => {
      await action(fd(fields));
      expect(m[model].deleteMany).not.toHaveBeenCalled();
      expect(m.revalidatePath).not.toHaveBeenCalled();
    },
  );

  it("без сессии ничего не удаляется", async () => {
    const redirect = new Error("NEXT_REDIRECT:/login");
    m.requireUser.mockRejectedValue(redirect);
    await expect(action(fd({ id: "rec1" }))).rejects.toBe(redirect);
    expect(m[model].deleteMany).not.toHaveBeenCalled();
  });
});
