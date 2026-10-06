import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => {
  const model = () => ({
    create: vi.fn(),
    deleteMany: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
  });
  return {
    $transaction: vi.fn(),
    activityLog: model(),
    mealLog: model(),
    waterLog: model(),
    healthLog: model(),
    pointsEvent: { create: vi.fn(), aggregate: vi.fn(), deleteMany: vi.fn() },
    $executeRaw: vi.fn(),
    $queryRaw: vi.fn(),
    achievement: { createMany: vi.fn(), findMany: vi.fn() },
    userAchievement: { findMany: vi.fn(), createManyAndReturn: vi.fn() },
  };
});

vi.mock("@/lib/db", () => ({ prisma: m }));

import { ACHIEVEMENTS } from "@/lib/gamification";
import {
  DailyLimitError,
  createActivityLog,
  createHealthLog,
  createMealLog,
  createWaterLog,
  deleteOwnActivityLog,
  deleteOwnHealthLog,
  deleteOwnMealLog,
  deleteOwnWaterLog,
  listFamilyActivity,
  listFamilyHealth,
  listFamilyMeals,
  listFamilyWater,
} from "@/lib/logs";

const date = new Date("2026-10-05T00:00:00.000Z");
const logModels = [m.activityLog, m.mealLog, m.waterLog, m.healthLog];
const ALL_CODES = ACHIEVEMENTS.map((a) => a.code);

type Stats = {
  activityCount: number;
  mealCount: number;
  waterCount: number;
  healthCount: number;
  totalPoints: number;
};
const zeroStats: Stats = {
  activityCount: 0,
  mealCount: 0,
  waterCount: 0,
  healthCount: 0,
  totalPoints: 0,
};
let stats: Stats;
let logDays: Date[];

// Счётчики и дни приходят из $queryRaw: запрос счётчиков узнаём по алиасу activityCount
const sqlText = (strings: TemplateStringsArray) => strings.join("?");
const isStatsQuery = (strings: TemplateStringsArray) => sqlText(strings).includes('"activityCount"');

function setStats(patch: Partial<Stats>) {
  stats = { ...zeroStats, ...patch };
}
function setDays(days: string[]) {
  logDays = days.map((d) => new Date(`${d}T00:00:00.000Z`));
}
// Выдано достижений по кодам (ответ userAchievement.findMany)
function setHave(codes: string[]) {
  m.userAchievement.findMany.mockResolvedValue(codes.map((code) => ({ achievement: { code } })));
}

beforeEach(() => {
  vi.resetAllMocks();
  stats = { ...zeroStats };
  logDays = [];
  // Транзакция выполняет колбэк с теми же моками в роли tx
  m.$transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(m));
  for (const model of logModels) {
    model.create.mockResolvedValue({ id: "log1" });
    model.deleteMany.mockResolvedValue({ count: 1 });
    model.count.mockResolvedValue(0);
    model.findMany.mockResolvedValue([]);
  }
  m.pointsEvent.aggregate.mockResolvedValue({ _sum: { points: null } });
  m.pointsEvent.create.mockResolvedValue({});
  m.pointsEvent.deleteMany.mockResolvedValue({ count: 1 });
  m.$executeRaw.mockResolvedValue(1);
  m.$queryRaw.mockImplementation((strings: TemplateStringsArray) =>
    Promise.resolve(isStatsQuery(strings) ? [stats] : logDays.map((d) => ({ date: d }))),
  );
  m.achievement.createMany.mockResolvedValue({ count: 1 });
  m.achievement.findMany.mockImplementation(({ where }: { where: { code: { in: string[] } } }) =>
    Promise.resolve(where.code.in.map((code) => ({ id: `id-${code}`, code }))),
  );
  m.userAchievement.findMany.mockResolvedValue([]);
  m.userAchievement.createManyAndReturn.mockImplementation(
    ({ data }: { data: { achievementId: string }[] }) =>
      Promise.resolve(data.map((d) => ({ achievementId: d.achievementId }))),
  );
});

describe("lockUser: блокировка пользователя в транзакции", () => {
  const callers = [
    ["createActivityLog", () => createActivityLog("u1", { type: "yoga", durationMinutes: 10, date }), m.activityLog],
    ["createMealLog", () => createMealLog("u1", { mealType: "lunch", description: "х", date }), m.mealLog],
    ["createWaterLog", () => createWaterLog("u1", { amountMl: 100, date }), m.waterLog],
    ["createHealthLog", () => createHealthLog("u1", { mood: 3, date }), m.healthLog],
  ] as const;

  it.each(callers)("%s: pg_advisory_xact_lock по userId", async (_n, run) => {
    await run();
    expect(m.$executeRaw).toHaveBeenCalledTimes(1);
    const [strings, userId] = m.$executeRaw.mock.calls[0];
    expect(strings.join("?")).toContain("pg_advisory_xact_lock");
    expect(userId).toBe("u1");
  });

  it.each(callers)("%s: блокировка берётся первой, до подсчёта лимита, создания записи и баллов", async (_n, run, model) => {
    const order: string[] = [];
    m.$executeRaw.mockImplementation(async () => {
      order.push("lock");
      return 1;
    });
    model.count.mockImplementation(async () => {
      order.push("count");
      return 0;
    });
    model.create.mockImplementation(async () => {
      order.push("create");
      return { id: "x" };
    });
    m.pointsEvent.aggregate.mockImplementation(async () => {
      order.push("aggregate");
      return { _sum: { points: null } };
    });
    await run();
    expect(order[0]).toBe("lock");
    expect(order.indexOf("lock")).toBeLessThan(order.indexOf("count"));
    expect(order.indexOf("lock")).toBeLessThan(order.indexOf("create"));
    expect(order.indexOf("lock")).toBeLessThan(order.indexOf("aggregate"));
  });

  it("ошибка блокировки: запись и баллы не создаются", async () => {
    m.$executeRaw.mockRejectedValue(new Error("lock fail"));
    await expect(
      createMealLog("u1", { mealType: "lunch", description: "х", date }),
    ).rejects.toThrow("lock fail");
    expect(m.mealLog.count).not.toHaveBeenCalled();
    expect(m.mealLog.create).not.toHaveBeenCalled();
    expect(m.pointsEvent.aggregate).not.toHaveBeenCalled();
    expect(m.pointsEvent.create).not.toHaveBeenCalled();
  });

  it("удаление записи блокировку не берёт", async () => {
    await deleteOwnMealLog("u1", "r1");
    expect(m.$executeRaw).not.toHaveBeenCalled();
  });
});

describe("DailyLimitError: не более 50 записей одного типа в день", () => {
  const cases = [
    ["activity", "активности", m.activityLog, () => createActivityLog("u1", { type: "yoga", durationMinutes: 10, date })],
    ["meal", "питания", m.mealLog, () => createMealLog("u1", { mealType: "lunch", description: "х", date })],
    ["water", "воды", m.waterLog, () => createWaterLog("u1", { amountMl: 100, date })],
    ["health", "здоровья", m.healthLog, () => createHealthLog("u1", { mood: 3, date })],
  ] as const;

  it.each(cases)("%s: 50 записей уже есть, 51-я отклоняется с русским сообщением", async (_k, label, model, run) => {
    model.count.mockResolvedValue(50);
    const err = await run().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DailyLimitError);
    expect((err as Error).name).toBe("DailyLimitError");
    expect((err as Error).message).toBe(`Достигнут лимит: не более 50 записей ${label} в день`);
    expect(model.create).not.toHaveBeenCalled();
    expect(m.pointsEvent.aggregate).not.toHaveBeenCalled();
    expect(m.pointsEvent.create).not.toHaveBeenCalled();
    expect(m.userAchievement.findMany).not.toHaveBeenCalled();
  });

  it.each(cases)("%s: 49 записей — 50-я ещё сохраняется", async (_k, _l, model, run) => {
    model.count.mockResolvedValue(49);
    await expect(run()).resolves.toMatchObject({ points: expect.any(Number) });
    expect(model.create).toHaveBeenCalledTimes(1);
  });

  it.each(cases)("%s: больше 50 (например, 80) тоже отклоняется", async (_k, _l, model, run) => {
    model.count.mockResolvedValue(80);
    await expect(run()).rejects.toBeInstanceOf(DailyLimitError);
  });

  it.each(cases)("%s: записи считаются по пользователю и дате", async (_k, _l, model, run) => {
    await run();
    expect(model.count).toHaveBeenCalledWith({ where: { userId: "u1", date } });
  });

  it("лимит считается по типу: 50 записей питания не мешают добавить воду", async () => {
    m.mealLog.count.mockResolvedValue(50);
    await expect(createWaterLog("u1", { amountMl: 250, date })).resolves.toBeDefined();
    expect(m.waterLog.create).toHaveBeenCalledTimes(1);
    expect(m.mealLog.count).not.toHaveBeenCalled();
  });
});

describe("createXLog: запись сохраняется с userId в транзакции", () => {
  it("createActivityLog: структура результата", async () => {
    m.activityLog.create.mockResolvedValue({ id: "a1" });
    // достижения уже выданы, чтобы проверить чистый результат
    setHave(ALL_CODES);
    const data = { type: "running", durationMinutes: 30, distanceKm: 5, note: "n", date };
    const r = await createActivityLog("u1", data);
    expect(r).toEqual({ points: 6, newAchievements: [] });
    expect(m.$transaction).toHaveBeenCalledTimes(1);
    expect(m.activityLog.create).toHaveBeenCalledWith({ data: { userId: "u1", ...data } });
  });

  it("createMealLog", async () => {
    const data = { mealType: "lunch", description: "суп", date };
    expect(await createMealLog("u1", data)).toEqual({ points: 5, newAchievements: [] });
    expect(m.mealLog.create).toHaveBeenCalledWith({ data: { userId: "u1", ...data } });
  });

  it("createWaterLog", async () => {
    const data = { amountMl: 500, date };
    expect(await createWaterLog("u1", data)).toEqual({ points: 2, newAchievements: [] });
    expect(m.waterLog.create).toHaveBeenCalledWith({ data: { userId: "u1", ...data } });
  });

  it("createHealthLog", async () => {
    const data = { weightKg: 60, sleepHours: 8, mood: 4, date };
    expect(await createHealthLog("u1", data)).toEqual({ points: 5, newAchievements: [] });
    expect(m.healthLog.create).toHaveBeenCalledWith({ data: { userId: "u1", ...data } });
  });

  it("транзакция создаётся с увеличенными таймаутами", async () => {
    await createMealLog("u1", { mealType: "lunch", description: "суп", date });
    expect(m.$transaction.mock.calls[0][1]).toEqual({ maxWait: 15_000, timeout: 30_000 });
  });

  it("ошибка внутри транзакции пробрасывается, баллы не начисляются", async () => {
    m.mealLog.create.mockRejectedValue(new Error("db down"));
    await expect(
      createMealLog("u1", { mealType: "lunch", description: "суп", date }),
    ).rejects.toThrow("db down");
    expect(m.pointsEvent.create).not.toHaveBeenCalled();
  });
});

describe("PointsEvent при создании записи", () => {
  it.each([
    ["activity", () => createActivityLog("u1", { type: "yoga", durationMinutes: 50, date }), m.activityLog, 10],
    ["meal", () => createMealLog("u1", { mealType: "lunch", description: "х", date }), m.mealLog, 5],
    ["water", () => createWaterLog("u1", { amountMl: 1000, date }), m.waterLog, 4],
    ["health", () => createHealthLog("u1", { mood: 3, date }), m.healthLog, 5],
  ] as const)(
    "%s: событие с уникальным источником (sourceType + sourceId записи)",
    async (kind, run, model, points) => {
      model.create.mockResolvedValue({ id: "rec-42" });
      await run();
      expect(m.pointsEvent.create).toHaveBeenCalledTimes(1);
      expect(m.pointsEvent.create).toHaveBeenCalledWith({
        data: {
          userId: "u1",
          points,
          reason: kind,
          sourceType: kind,
          sourceId: "rec-42",
          date,
        },
      });
    },
  );

  it("суточный лимит баллов считается по пользователю, типу и дате записи", async () => {
    await createMealLog("u1", { mealType: "lunch", description: "х", date });
    expect(m.pointsEvent.aggregate).toHaveBeenCalledTimes(1);
    expect(m.pointsEvent.aggregate.mock.calls[0][0]).toEqual({
      where: { userId: "u1", sourceType: "meal", date },
      _sum: { points: true },
    });
  });

  it("лимит почти исчерпан: начисляется только остаток (95 из 100, активность 30 мин -> 5)", async () => {
    m.pointsEvent.aggregate.mockResolvedValueOnce({ _sum: { points: 95 } });
    const r = await createActivityLog("u1", { type: "yoga", durationMinutes: 30, date });
    expect(r.points).toBe(5);
    expect(m.pointsEvent.create.mock.calls[0][0].data.points).toBe(5);
  });

  it("сверх лимита: запись сохраняется, PointsEvent создаётся с 0 баллов", async () => {
    m.pointsEvent.aggregate.mockResolvedValueOnce({ _sum: { points: 8 } });
    const r = await createWaterLog("u1", { amountMl: 2000, date });
    expect(r.points).toBe(0);
    expect(m.waterLog.create).toHaveBeenCalledTimes(1);
    expect(m.pointsEvent.create).toHaveBeenCalledTimes(1);
    expect(m.pointsEvent.create.mock.calls[0][0].data).toMatchObject({
      points: 0,
      sourceType: "water",
      sourceId: "log1",
    });
  });

  it("лимит превышен (сумма больше лимита): баллы не отрицательные", async () => {
    m.pointsEvent.aggregate.mockResolvedValueOnce({ _sum: { points: 500 } });
    const r = await createHealthLog("u1", { mood: 3, date });
    expect(r.points).toBe(0);
  });

  it("запись и PointsEvent создаются внутри одного вызова $transaction", async () => {
    const order: string[] = [];
    m.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => {
      order.push("begin");
      const res = await cb(m);
      order.push("end");
      return res;
    });
    m.mealLog.create.mockImplementation(async () => {
      order.push("log");
      return { id: "x" };
    });
    m.pointsEvent.create.mockImplementation(async () => {
      order.push("event");
      return {};
    });
    await createMealLog("u1", { mealType: "lunch", description: "х", date });
    expect(order).toEqual(["begin", "log", "event", "end"]);
  });
});

describe("достижения при создании записи", () => {
  it("заслуженное и не выданное достижение выдаётся: каталог createMany, findMany по кодам, createManyAndReturn", async () => {
    setStats({ activityCount: 1 });
    const r = await createActivityLog("u1", { type: "yoga", durationMinutes: 10, date });
    expect(r.newAchievements).toEqual(["Первая активность"]);
    expect(m.achievement.createMany).toHaveBeenCalledTimes(1);
    expect(m.achievement.createMany).toHaveBeenCalledWith({
      data: [
        {
          code: "first_activity",
          title: "Первая активность",
          description: "Добавьте первую запись об активности",
        },
      ],
      skipDuplicates: true,
    });
    expect(m.achievement.findMany).toHaveBeenCalledWith({
      where: { code: { in: ["first_activity"] } },
      select: { id: true, code: true },
    });
    expect(m.userAchievement.createManyAndReturn).toHaveBeenCalledWith({
      data: [{ userId: "u1", achievementId: "id-first_activity" }],
      skipDuplicates: true,
      select: { achievementId: true },
    });
  });

  it("findUniqueOrThrow больше не вызывается (достижение читается одним findMany)", async () => {
    // у мока каталога нет findUniqueOrThrow: вызов упал бы с TypeError
    setStats({ activityCount: 1 });
    await expect(
      createActivityLog("u1", { type: "yoga", durationMinutes: 10, date }),
    ).resolves.toBeDefined();
    expect(m.achievement).not.toHaveProperty("findUniqueOrThrow");
  });

  it("порядок: каталог пополняется, затем читаются id, затем выдача", async () => {
    const order: string[] = [];
    setStats({ activityCount: 1 });
    m.achievement.createMany.mockImplementation(async () => {
      order.push("catalog");
      return { count: 1 };
    });
    m.achievement.findMany.mockImplementation(async () => {
      order.push("find");
      return [{ id: "ach", code: "first_activity" }];
    });
    m.userAchievement.createManyAndReturn.mockImplementation(async () => {
      order.push("grant");
      return [{ achievementId: "ach" }];
    });
    await createActivityLog("u1", { type: "yoga", durationMinutes: 10, date });
    expect(order).toEqual(["catalog", "find", "grant"]);
  });

  it("гонка: createManyAndReturn вернул пусто (выдано параллельно) — достижение не попадает в newAchievements", async () => {
    setStats({ activityCount: 1 });
    m.userAchievement.createManyAndReturn.mockResolvedValue([]);
    const r = await createActivityLog("u1", { type: "yoga", durationMinutes: 10, date });
    expect(r.newAchievements).toEqual([]);
    expect(m.userAchievement.createManyAndReturn).toHaveBeenCalledTimes(1);
  });

  it("несколько достижений выдаются тремя запросами на всю пачку, в порядке каталога", async () => {
    setStats({ waterCount: 1, totalPoints: 800 });
    const r = await createWaterLog("u1", { amountMl: 250, date });
    expect(r.newAchievements).toEqual([
      "Первый стакан воды",
      "100 баллов",
      "500 баллов",
      "Пятый уровень",
    ]);
    expect(m.achievement.createMany).toHaveBeenCalledTimes(1);
    expect(m.achievement.createMany.mock.calls[0][0].data.map((d: { code: string }) => d.code)).toEqual([
      "first_water",
      "points_100",
      "points_500",
      "level_5",
    ]);
    expect(m.achievement.findMany).toHaveBeenCalledTimes(1);
    expect(m.userAchievement.createManyAndReturn).toHaveBeenCalledTimes(1);
    expect(m.userAchievement.createManyAndReturn.mock.calls[0][0].data).toEqual([
      { userId: "u1", achievementId: "id-first_water" },
      { userId: "u1", achievementId: "id-points_100" },
      { userId: "u1", achievementId: "id-points_500" },
      { userId: "u1", achievementId: "id-level_5" },
    ]);
  });

  it("из нескольких достижений в newAchievements только реально созданные", async () => {
    setStats({ waterCount: 1, totalPoints: 800 });
    // «100 баллов» выдано параллельной транзакцией
    m.userAchievement.createManyAndReturn.mockResolvedValue([
      { achievementId: "id-first_water" },
      { achievementId: "id-points_500" },
      { achievementId: "id-level_5" },
    ]);
    const r = await createWaterLog("u1", { amountMl: 250, date });
    expect(r.newAchievements).toEqual(["Первый стакан воды", "500 баллов", "Пятый уровень"]);
  });

  it("ошибка чтения каталога пробрасывается, выдача не выполняется", async () => {
    setStats({ activityCount: 1 });
    m.achievement.findMany.mockRejectedValue(new Error("not found"));
    await expect(
      createActivityLog("u1", { type: "yoga", durationMinutes: 10, date }),
    ).rejects.toThrow("not found");
    expect(m.userAchievement.createManyAndReturn).not.toHaveBeenCalled();
  });

  it("достижение выдаётся один раз: уже имеющееся не выдаётся повторно", async () => {
    setStats({ activityCount: 2 });
    setHave(["first_activity"]);
    const r = await createActivityLog("u1", { type: "yoga", durationMinutes: 10, date });
    expect(r.newAchievements).toEqual([]);
    expect(m.achievement.createMany).not.toHaveBeenCalled();
    expect(m.achievement.findMany).not.toHaveBeenCalled();
    expect(m.userAchievement.createManyAndReturn).not.toHaveBeenCalled();
  });

  it("при повторной записи выдаются только недостающие достижения", async () => {
    setStats({ activityCount: 1, mealCount: 1 });
    setHave(["first_activity"]);
    const r = await createMealLog("u1", { mealType: "lunch", description: "х", date });
    expect(r.newAchievements).toEqual(["Первый приём пищи"]);
    expect(m.userAchievement.createManyAndReturn).toHaveBeenCalledTimes(1);
    expect(m.userAchievement.createManyAndReturn.mock.calls[0][0].data).toEqual([
      { userId: "u1", achievementId: "id-first_meal" },
    ]);
  });

  it("ничего не заслужено: каталог и выдача не трогаются", async () => {
    const r = await createMealLog("u1", { mealType: "lunch", description: "х", date });
    expect(r.newAchievements).toEqual([]);
    expect(m.achievement.createMany).not.toHaveBeenCalled();
    expect(m.achievement.findMany).not.toHaveBeenCalled();
    expect(m.userAchievement.createManyAndReturn).not.toHaveBeenCalled();
  });

  it("серия из 3 дней подряд даёт «Серия 3 дня»", async () => {
    setStats({ mealCount: 3 });
    setDays(["2026-10-03", "2026-10-04", "2026-10-05"]);
    setHave(["first_meal"]);
    const r = await createMealLog("u1", { mealType: "lunch", description: "х", date });
    expect(r.newAchievements).toEqual(["Серия 3 дня"]);
  });

  it("дни с пропуском серию не дают", async () => {
    setStats({ mealCount: 3 });
    setDays(["2026-10-01", "2026-10-03", "2026-10-05"]);
    setHave(["first_meal"]);
    const r = await createMealLog("u1", { mealType: "lunch", description: "х", date });
    expect(r.newAchievements).toEqual([]);
  });

  it("серия из 7 дней даёт обе серии, если ни одна ещё не выдана", async () => {
    setHave(ALL_CODES.filter((c) => !c.startsWith("streak_")));
    setDays([
      "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04",
      "2026-10-05", "2026-10-06", "2026-10-07",
    ]);
    const r = await createMealLog("u1", { mealType: "lunch", description: "х", date });
    expect(r.newAchievements).toEqual(["Серия 3 дня", "Серия 7 дней"]);
  });

  it("достижения проверяются только по данным этого пользователя", async () => {
    await createMealLog("u1", { mealType: "lunch", description: "х", date });
    expect(m.userAchievement.findMany.mock.calls[0][0].where).toEqual({ userId: "u1" });
    expect(m.$queryRaw).toHaveBeenCalled();
    for (const call of m.$queryRaw.mock.calls) {
      // все подставленные в SQL значения — только userId
      expect(call.slice(1).every((v: unknown) => v === "u1")).toBe(true);
      expect(call.slice(1).length).toBeGreaterThan(0);
    }
  });
});

describe("grantAchievements: ранний выход и минимум запросов", () => {
  it("все достижения уже выданы: ни счётчики, ни дни, ни каталог не запрашиваются", async () => {
    setHave(ALL_CODES);
    setStats({ activityCount: 5, totalPoints: 5000 });
    const r = await createActivityLog("u1", { type: "yoga", durationMinutes: 10, date });
    expect(r.newAchievements).toEqual([]);
    expect(m.userAchievement.findMany).toHaveBeenCalledTimes(1);
    expect(m.$queryRaw).not.toHaveBeenCalled();
    expect(m.achievement.createMany).not.toHaveBeenCalled();
    expect(m.achievement.findMany).not.toHaveBeenCalled();
    expect(m.userAchievement.createManyAndReturn).not.toHaveBeenCalled();
  });

  it("недостаёт только серий: запрашиваются дни, счётчики и баллы — нет", async () => {
    setHave(ALL_CODES.filter((c) => !c.startsWith("streak_")));
    await createMealLog("u1", { mealType: "lunch", description: "х", date });
    expect(m.$queryRaw).toHaveBeenCalledTimes(1);
    const sql = sqlText(m.$queryRaw.mock.calls[0][0]);
    expect(sql).toContain("UNION");
    expect(sql).not.toContain('"activityCount"');
  });

  it("недостаёт только не-серий: запрашиваются счётчики, дни — нет", async () => {
    setHave(ALL_CODES.filter((c) => c !== "first_activity"));
    await createMealLog("u1", { mealType: "lunch", description: "х", date });
    expect(m.$queryRaw).toHaveBeenCalledTimes(1);
    const sql = sqlText(m.$queryRaw.mock.calls[0][0]);
    expect(sql).toContain('"activityCount"');
    expect(sql).not.toContain("UNION");
  });

  it("недостаёт и серий, и обычных: два запроса — счётчики и дни", async () => {
    setHave(["first_activity"]);
    await createMealLog("u1", { mealType: "lunch", description: "х", date });
    expect(m.$queryRaw).toHaveBeenCalledTimes(2);
    const sqls = m.$queryRaw.mock.calls.map((c) => sqlText(c[0]));
    expect(sqls.some((s) => s.includes('"activityCount"'))).toBe(true);
    expect(sqls.some((s) => s.includes("UNION"))).toBe(true);
  });

  it("счётчики считаются одним запросом, а не пятью count/aggregate", async () => {
    await createMealLog("u1", { mealType: "lunch", description: "х", date });
    // mealLog.count вызывается один раз — только для суточного лимита
    expect(m.mealLog.count).toHaveBeenCalledTimes(1);
    // pointsEvent.aggregate — только для суточного лимита баллов
    expect(m.pointsEvent.aggregate).toHaveBeenCalledTimes(1);
  });
});

describe("deleteOwnXLog: условие {id, userId} и отзыв баллов в транзакции", () => {
  it.each([
    ["activityLog", "activity", deleteOwnActivityLog],
    ["mealLog", "meal", deleteOwnMealLog],
    ["waterLog", "water", deleteOwnWaterLog],
    ["healthLog", "health", deleteOwnHealthLog],
  ] as const)("%s: deleteMany с id и userId, удаляется PointsEvent записи", async (model, kind, fn) => {
    await fn("u1", "rec1");
    expect(m.$transaction).toHaveBeenCalledTimes(1);
    expect(m[model].deleteMany).toHaveBeenCalledTimes(1);
    expect(m[model].deleteMany).toHaveBeenCalledWith({ where: { id: "rec1", userId: "u1" } });
    expect(m.pointsEvent.deleteMany).toHaveBeenCalledTimes(1);
    expect(m.pointsEvent.deleteMany).toHaveBeenCalledWith({
      where: { userId: "u1", sourceType: kind, sourceId: "rec1" },
    });
  });

  it("достижения при удалении не отзываются и не выдаются", async () => {
    await deleteOwnActivityLog("u1", "rec1");
    expect(m.userAchievement.createManyAndReturn).not.toHaveBeenCalled();
    expect(m.achievement.createMany).not.toHaveBeenCalled();
    expect(m.$queryRaw).not.toHaveBeenCalled();
  });

  it("чужая запись: ошибки нет; PointsEvent ищется только среди событий этого пользователя", async () => {
    m.activityLog.deleteMany.mockResolvedValue({ count: 0 });
    await expect(deleteOwnActivityLog("u1", "чужая")).resolves.toBeUndefined();
    expect(m.activityLog.deleteMany.mock.calls[0][0].where.userId).toBe("u1");
    expect(m.pointsEvent.deleteMany.mock.calls[0][0].where.userId).toBe("u1");
  });

  it("ошибка при удалении записи пробрасывается, баллы не трогаются", async () => {
    m.mealLog.deleteMany.mockRejectedValue(new Error("fail"));
    await expect(deleteOwnMealLog("u1", "r")).rejects.toThrow("fail");
    expect(m.pointsEvent.deleteMany).not.toHaveBeenCalled();
  });
});

describe("listFamilyX: фильтр по семье и лимит 30", () => {
  it.each([
    ["activityLog", listFamilyActivity],
    ["mealLog", listFamilyMeals],
    ["waterLog", listFamilyWater],
    ["healthLog", listFamilyHealth],
  ] as const)("%s", async (model, fn) => {
    m[model].findMany.mockResolvedValue([{ id: "x" }]);
    expect(await fn("fam-1")).toEqual([{ id: "x" }]);
    const arg = m[model].findMany.mock.calls[0][0];
    expect(arg.where).toEqual({ user: { familyId: "fam-1" } });
    expect(arg.take).toBe(30);
    expect(arg.orderBy).toEqual([{ date: "desc" }, { createdAt: "desc" }]);
  });

  it("автор подтягивается только по id и имени (без email и passwordHash)", () => {
    listFamilyActivity("fam-1");
    expect(m.activityLog.findMany.mock.calls[0][0].include).toEqual({
      user: { select: { id: true, name: true } },
    });
  });
});
