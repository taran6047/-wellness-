import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  activityLog: { aggregate: vi.fn() },
  waterLog: { aggregate: vi.fn() },
  mealLog: { count: vi.fn() },
  healthLog: { count: vi.fn() },
  pointsEvent: { aggregate: vi.fn() },
  familyGoal: { findMany: vi.fn() },
}));

vi.mock("@/lib/db", () => ({ prisma: m }));

import { getActiveGoalsWithProgress } from "@/lib/family-goals";

const today = new Date("2026-10-06T00:00:00.000Z");
const start = new Date("2026-10-01T00:00:00.000Z");
const end = new Date("2026-10-31T00:00:00.000Z");

// Цель по воде; текущее значение в моке всегда 100, поэтому при targetValue <= 100 цель достигнута
const goal = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  familyId: "fam-1",
  title: `Цель ${id}`,
  metric: "water_ml",
  targetValue: 1000,
  startDate: start,
  endDate: end,
  createdAt: new Date("2026-09-30T00:00:00.000Z"),
  ...over,
});
const achieved = (id: string) => goal(id, { targetValue: 50 });

beforeEach(() => {
  vi.resetAllMocks();
  m.waterLog.aggregate.mockResolvedValue({ _sum: { amountMl: 100 } });
  m.activityLog.aggregate.mockResolvedValue({ _sum: { durationMinutes: null, distanceKm: null } });
  m.mealLog.count.mockResolvedValue(0);
  m.healthLog.count.mockResolvedValue(0);
  m.pointsEvent.aggregate.mockResolvedValue({ _sum: { points: null } });
  m.familyGoal.findMany.mockResolvedValue([]);
});

describe("getActiveGoalsWithProgress: выборка", () => {
  it("берёт цели только своей семьи, не просроченные (endDate >= today), в порядке срока", async () => {
    await getActiveGoalsWithProgress("fam-1", today, 5);
    expect(m.familyGoal.findMany).toHaveBeenCalledTimes(1);
    expect(m.familyGoal.findMany).toHaveBeenCalledWith({
      where: { familyId: "fam-1", endDate: { gte: today } },
      orderBy: [{ endDate: "asc" }, { createdAt: "desc" }],
    });
  });

  it("нет целей: пустой массив, метрики не запрашиваются", async () => {
    expect(await getActiveGoalsWithProgress("fam-1", today, 5)).toEqual([]);
    expect(m.waterLog.aggregate).not.toHaveBeenCalled();
  });

  it("цель, заканчивающаяся сегодня, ещё активна и попадает в выдачу", async () => {
    m.familyGoal.findMany.mockResolvedValue([goal("g1", { endDate: today })]);
    const r = await getActiveGoalsWithProgress("fam-1", today, 5);
    expect(r.map((g) => g.id)).toEqual(["g1"]);
    expect(r[0]).toMatchObject({ status: "in_progress", daysLeft: 0 });
  });

  it("просроченные цели (endDate раньше today) отсекаются запросом и метрики по ним не считаются", async () => {
    // БД уже не вернёт просроченные из-за условия endDate >= today; проверяем и условие, и отсутствие расчёта
    m.familyGoal.findMany.mockResolvedValue([]);
    await getActiveGoalsWithProgress("fam-1", today, 5);
    expect(m.familyGoal.findMany.mock.calls[0][0].where.endDate).toEqual({ gte: today });
    expect(m.waterLog.aggregate).not.toHaveBeenCalled();
  });

  it("просроченная цель, всё же попавшая в ответ, в выдачу не входит (status expired отфильтрован)", async () => {
    m.familyGoal.findMany.mockResolvedValue([
      goal("old", { endDate: new Date("2026-10-01T00:00:00.000Z") }),
      goal("g2"),
    ]);
    const r = await getActiveGoalsWithProgress("fam-1", today, 5);
    expect(r.map((g) => g.id)).toEqual(["g2"]);
  });

  it("сбой БД пробрасывается", async () => {
    m.familyGoal.findMany.mockRejectedValue(new Error("db down"));
    await expect(getActiveGoalsWithProgress("fam-1", today, 3)).rejects.toThrow("db down");
  });
});

describe("getActiveGoalsWithProgress: прогресс активных целей", () => {
  it("возвращает цели с current, процентом и статусом in_progress", async () => {
    m.familyGoal.findMany.mockResolvedValue([goal("g1")]);
    const r = await getActiveGoalsWithProgress("fam-1", today, 3);
    expect(r[0]).toMatchObject({
      id: "g1",
      metric: "water_ml",
      current: 100,
      percent: 10,
      achieved: false,
      status: "in_progress",
      daysLeft: 25,
    });
  });

  it("метрика считается по семье и периоду цели", async () => {
    m.familyGoal.findMany.mockResolvedValue([goal("g1")]);
    await getActiveGoalsWithProgress("fam-1", today, 3);
    expect(m.waterLog.aggregate.mock.calls[0][0].where).toEqual({
      user: { familyId: "fam-1" },
      date: { gte: start, lte: end },
    });
  });

  it("достигнутые цели в выдачу не входят (только «в процессе»)", async () => {
    m.familyGoal.findMany.mockResolvedValue([achieved("done"), goal("g2")]);
    const r = await getActiveGoalsWithProgress("fam-1", today, 5);
    expect(r.map((g) => g.id)).toEqual(["g2"]);
  });

  it("неизвестная метрика: цель активна с current 0, запросов к БД нет", async () => {
    m.familyGoal.findMany.mockResolvedValue([goal("g1", { metric: "steps" })]);
    const r = await getActiveGoalsWithProgress("fam-1", today, 3);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ metric: null, current: 0, status: "in_progress" });
    expect(m.waterLog.aggregate).not.toHaveBeenCalled();
  });
});

describe("getActiveGoalsWithProgress: limit и порции", () => {
  it("возвращает не больше limit активных целей, первые по порядку", async () => {
    m.familyGoal.findMany.mockResolvedValue(
      ["g1", "g2", "g3", "g4", "g5", "g6", "g7"].map((id) => goal(id)),
    );
    const r = await getActiveGoalsWithProgress("fam-1", today, 3);
    expect(r.map((g) => g.id)).toEqual(["g1", "g2", "g3"]);
  });

  it("прогресс считается только для нужных целей: limit 3 из 7 — три запроса метрики, не семь", async () => {
    m.familyGoal.findMany.mockResolvedValue(
      ["g1", "g2", "g3", "g4", "g5", "g6", "g7"].map((id) => goal(id)),
    );
    await getActiveGoalsWithProgress("fam-1", today, 3);
    expect(m.waterLog.aggregate).toHaveBeenCalledTimes(3);
  });

  it("порциями по числу недостающих: достигнутая цель в первой порции -> дозапрос ещё одной", async () => {
    // порция 1: g1 (достигнута), g2, g3 -> активных 2; порция 2 из 1 цели: g4 -> активных 3
    m.familyGoal.findMany.mockResolvedValue([achieved("g1"), goal("g2"), goal("g3"), goal("g4"), goal("g5")]);
    const r = await getActiveGoalsWithProgress("fam-1", today, 3);
    expect(r.map((g) => g.id)).toEqual(["g2", "g3", "g4"]);
    expect(m.waterLog.aggregate).toHaveBeenCalledTimes(4); // g5 не считалась
  });

  it("несколько достигнутых подряд: лишние цели после набора limit не считаются", async () => {
    // limit 2; порция 1: g1, g2 (обе достигнуты) -> 0; порция 2: g3, g4 -> 2 активных; g5 не считается
    m.familyGoal.findMany.mockResolvedValue([
      achieved("g1"),
      achieved("g2"),
      goal("g3"),
      goal("g4"),
      goal("g5"),
    ]);
    const r = await getActiveGoalsWithProgress("fam-1", today, 2);
    expect(r.map((g) => g.id)).toEqual(["g3", "g4"]);
    expect(m.waterLog.aggregate).toHaveBeenCalledTimes(4);
  });

  it("активных меньше limit: просматриваются все цели, возвращаются все активные", async () => {
    m.familyGoal.findMany.mockResolvedValue([achieved("g1"), goal("g2"), achieved("g3")]);
    const r = await getActiveGoalsWithProgress("fam-1", today, 5);
    expect(r.map((g) => g.id)).toEqual(["g2"]);
    expect(m.waterLog.aggregate).toHaveBeenCalledTimes(3);
  });

  it("целей меньше limit: одна порция, все цели", async () => {
    m.familyGoal.findMany.mockResolvedValue([goal("g1"), goal("g2")]);
    const r = await getActiveGoalsWithProgress("fam-1", today, 5);
    expect(r.map((g) => g.id)).toEqual(["g1", "g2"]);
    expect(m.waterLog.aggregate).toHaveBeenCalledTimes(2);
  });

  it("limit 0: пустой результат, метрики не запрашиваются", async () => {
    m.familyGoal.findMany.mockResolvedValue([goal("g1")]);
    expect(await getActiveGoalsWithProgress("fam-1", today, 0)).toEqual([]);
    expect(m.waterLog.aggregate).not.toHaveBeenCalled();
  });

  it("limit 1: считается одна цель за раз до первой активной", async () => {
    m.familyGoal.findMany.mockResolvedValue([achieved("g1"), achieved("g2"), goal("g3"), goal("g4")]);
    const r = await getActiveGoalsWithProgress("fam-1", today, 1);
    expect(r.map((g) => g.id)).toEqual(["g3"]);
    expect(m.waterLog.aggregate).toHaveBeenCalledTimes(3);
  });

  it("порядок целей сохраняется между порциями", async () => {
    m.familyGoal.findMany.mockResolvedValue([
      goal("a"), achieved("b"), goal("c"), achieved("d"), goal("e"), goal("f"),
    ]);
    const r = await getActiveGoalsWithProgress("fam-1", today, 4);
    expect(r.map((g) => g.id)).toEqual(["a", "c", "e", "f"]);
  });
});
