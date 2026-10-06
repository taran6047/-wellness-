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
    achievement: { createMany: vi.fn(), findUniqueOrThrow: vi.fn() },
    userAchievement: { findMany: vi.fn(), createMany: vi.fn() },
  };
});

vi.mock("@/lib/db", () => ({ prisma: m }));

import {
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

beforeEach(() => {
  vi.resetAllMocks();
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
  m.achievement.createMany.mockResolvedValue({ count: 1 });
  m.achievement.findUniqueOrThrow.mockImplementation(({ where }: { where: { code: string } }) =>
    Promise.resolve({ id: `id-${where.code}` }),
  );
  m.userAchievement.findMany.mockResolvedValue([]);
  m.userAchievement.createMany.mockResolvedValue({ count: 1 });
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

  it.each(callers)("%s: блокировка берётся первой, до создания записи и подсчёта лимита", async (_n, run, model) => {
    const order: string[] = [];
    m.$executeRaw.mockImplementation(async () => {
      order.push("lock");
      return 1;
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
    expect(order.indexOf("lock")).toBeLessThan(order.indexOf("create"));
    expect(order.indexOf("lock")).toBeLessThan(order.indexOf("aggregate"));
  });

  it("ошибка блокировки: запись и баллы не создаются", async () => {
    m.$executeRaw.mockRejectedValue(new Error("lock fail"));
    await expect(
      createMealLog("u1", { mealType: "lunch", description: "х", date }),
    ).rejects.toThrow("lock fail");
    expect(m.mealLog.create).not.toHaveBeenCalled();
    expect(m.pointsEvent.aggregate).not.toHaveBeenCalled();
    expect(m.pointsEvent.create).not.toHaveBeenCalled();
  });

  it("удаление записи блокировку не берёт", async () => {
    await deleteOwnMealLog("u1", "r1");
    expect(m.$executeRaw).not.toHaveBeenCalled();
  });
});

describe("createXLog: запись сохраняется с userId в транзакции", () => {
  it("createActivityLog: новая структура результата", async () => {
    m.activityLog.create.mockResolvedValue({ id: "a1" });
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

  it("суточный лимит считается по пользователю, типу и дате записи", async () => {
    await createMealLog("u1", { mealType: "lunch", description: "х", date });
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
  it("заслуженное и не выданное достижение выдаётся: createMany каталога, findUniqueOrThrow, userAchievement.createMany", async () => {
    m.activityLog.count.mockResolvedValue(1);
    m.activityLog.findMany.mockResolvedValue([{ date }]);
    const r = await createActivityLog("u1", { type: "yoga", durationMinutes: 10, date });
    expect(r.newAchievements).toEqual(["Первая активность"]);
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
    expect(m.achievement.findUniqueOrThrow).toHaveBeenCalledWith({ where: { code: "first_activity" } });
    expect(m.userAchievement.createMany).toHaveBeenCalledWith({
      data: [{ userId: "u1", achievementId: "id-first_activity" }],
      skipDuplicates: true,
    });
  });

  it("каталог пополняется до чтения id, а выдача — после него", async () => {
    const order: string[] = [];
    m.activityLog.count.mockResolvedValue(1);
    m.achievement.createMany.mockImplementation(async () => {
      order.push("catalog");
      return { count: 1 };
    });
    m.achievement.findUniqueOrThrow.mockImplementation(async () => {
      order.push("find");
      return { id: "ach" };
    });
    m.userAchievement.createMany.mockImplementation(async () => {
      order.push("grant");
      return { count: 1 };
    });
    await createActivityLog("u1", { type: "yoga", durationMinutes: 10, date });
    expect(order).toEqual(["catalog", "find", "grant"]);
  });

  it("гонка: userAchievement.createMany вернул count 0 — достижение не попадает в newAchievements", async () => {
    m.activityLog.count.mockResolvedValue(1);
    m.userAchievement.createMany.mockResolvedValue({ count: 0 });
    const r = await createActivityLog("u1", { type: "yoga", durationMinutes: 10, date });
    expect(r.newAchievements).toEqual([]);
    expect(m.userAchievement.createMany).toHaveBeenCalledTimes(1);
  });

  it("из нескольких достижений в newAchievements только реально созданные (count > 0)", async () => {
    m.waterLog.count.mockResolvedValue(1);
    m.pointsEvent.aggregate
      .mockResolvedValueOnce({ _sum: { points: 0 } })
      .mockResolvedValueOnce({ _sum: { points: 800 } });
    // порядок каталога: стакан воды, 100, 500, пятый уровень; «100 баллов» выдано параллельно другой транзакцией
    m.userAchievement.createMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 });
    const r = await createWaterLog("u1", { amountMl: 250, date });
    expect(r.newAchievements).toEqual(["Первый стакан воды", "500 баллов", "Пятый уровень"]);
    expect(m.userAchievement.createMany).toHaveBeenCalledTimes(4);
  });

  it("ошибка findUniqueOrThrow пробрасывается, достижение не выдаётся", async () => {
    m.activityLog.count.mockResolvedValue(1);
    m.achievement.findUniqueOrThrow.mockRejectedValue(new Error("not found"));
    await expect(
      createActivityLog("u1", { type: "yoga", durationMinutes: 10, date }),
    ).rejects.toThrow("not found");
    expect(m.userAchievement.createMany).not.toHaveBeenCalled();
  });

  it("достижение выдаётся один раз: уже имеющееся не выдаётся повторно", async () => {
    m.activityLog.count.mockResolvedValue(2);
    m.userAchievement.findMany.mockResolvedValue([{ achievement: { code: "first_activity" } }]);
    const r = await createActivityLog("u1", { type: "yoga", durationMinutes: 10, date });
    expect(r.newAchievements).toEqual([]);
    expect(m.achievement.createMany).not.toHaveBeenCalled();
    expect(m.achievement.findUniqueOrThrow).not.toHaveBeenCalled();
    expect(m.userAchievement.createMany).not.toHaveBeenCalled();
  });

  it("при повторной записи выдаются только недостающие достижения", async () => {
    m.activityLog.count.mockResolvedValue(1);
    m.mealLog.count.mockResolvedValue(1);
    m.userAchievement.findMany.mockResolvedValue([{ achievement: { code: "first_activity" } }]);
    const r = await createMealLog("u1", { mealType: "lunch", description: "х", date });
    expect(r.newAchievements).toEqual(["Первый приём пищи"]);
    expect(m.userAchievement.createMany).toHaveBeenCalledTimes(1);
  });

  it("несколько достижений за раз возвращаются в порядке каталога", async () => {
    m.waterLog.count.mockResolvedValue(1);
    m.pointsEvent.aggregate
      .mockResolvedValueOnce({ _sum: { points: 0 } })
      .mockResolvedValueOnce({ _sum: { points: 800 } });
    const r = await createWaterLog("u1", { amountMl: 250, date });
    expect(r.newAchievements).toEqual([
      "Первый стакан воды",
      "100 баллов",
      "500 баллов",
      "Пятый уровень",
    ]);
    expect(m.userAchievement.createMany).toHaveBeenCalledTimes(4);
  });

  it("серия из 3 дней подряд даёт «Серия 3 дня»", async () => {
    m.mealLog.count.mockResolvedValue(3);
    m.mealLog.findMany.mockResolvedValue([
      { date: new Date("2026-10-03T00:00:00.000Z") },
      { date: new Date("2026-10-04T00:00:00.000Z") },
      { date: new Date("2026-10-05T00:00:00.000Z") },
    ]);
    m.userAchievement.findMany.mockResolvedValue([{ achievement: { code: "first_meal" } }]);
    const r = await createMealLog("u1", { mealType: "lunch", description: "х", date });
    expect(r.newAchievements).toEqual(["Серия 3 дня"]);
  });

  it("достижения проверяются только по данным этого пользователя", async () => {
    await createMealLog("u1", { mealType: "lunch", description: "х", date });
    expect(m.mealLog.count).toHaveBeenCalledWith({ where: { userId: "u1" } });
    expect(m.userAchievement.findMany.mock.calls[0][0].where).toEqual({ userId: "u1" });
    expect(m.pointsEvent.aggregate.mock.calls[1][0].where).toEqual({ userId: "u1" });
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

  it("достижения при удалении не отзываются", async () => {
    await deleteOwnActivityLog("u1", "rec1");
    expect(m.userAchievement.createMany).not.toHaveBeenCalled();
    expect(m.achievement.createMany).not.toHaveBeenCalled();
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
