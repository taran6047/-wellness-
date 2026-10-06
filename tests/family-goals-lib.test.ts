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

import { getFamilyGoalsWithProgress, metricTotal } from "@/lib/family-goals";

const start = new Date("2026-10-01T00:00:00.000Z");
const end = new Date("2026-10-31T00:00:00.000Z");
const range = { gte: start, lte: end };
const user = { familyId: "fam-1" };

beforeEach(() => {
  vi.resetAllMocks();
  m.activityLog.aggregate.mockResolvedValue({ _sum: { durationMinutes: null, distanceKm: null } });
  m.waterLog.aggregate.mockResolvedValue({ _sum: { amountMl: null } });
  m.mealLog.count.mockResolvedValue(0);
  m.healthLog.count.mockResolvedValue(0);
  m.pointsEvent.aggregate.mockResolvedValue({ _sum: { points: null } });
  m.familyGoal.findMany.mockResolvedValue([]);
});

describe("metricTotal", () => {
  it("activity_minutes: сумма durationMinutes по семье за период", async () => {
    m.activityLog.aggregate.mockResolvedValue({ _sum: { durationMinutes: 90 } });
    expect(await metricTotal("fam-1", "activity_minutes", start, end)).toBe(90);
    expect(m.activityLog.aggregate).toHaveBeenCalledWith({
      where: { user, date: range },
      _sum: { durationMinutes: true },
    });
  });

  it("activity_km: сумма distanceKm по семье за период", async () => {
    m.activityLog.aggregate.mockResolvedValue({ _sum: { distanceKm: 12.5 } });
    expect(await metricTotal("fam-1", "activity_km", start, end)).toBe(12.5);
    expect(m.activityLog.aggregate).toHaveBeenCalledWith({
      where: { user, date: range },
      _sum: { distanceKm: true },
    });
  });

  it("water_ml: сумма amountMl", async () => {
    m.waterLog.aggregate.mockResolvedValue({ _sum: { amountMl: 2500 } });
    expect(await metricTotal("fam-1", "water_ml", start, end)).toBe(2500);
    expect(m.waterLog.aggregate).toHaveBeenCalledWith({
      where: { user, date: range },
      _sum: { amountMl: true },
    });
  });

  it("meals_count: количество приёмов пищи семьи", async () => {
    m.mealLog.count.mockResolvedValue(7);
    expect(await metricTotal("fam-1", "meals_count", start, end)).toBe(7);
    expect(m.mealLog.count).toHaveBeenCalledWith({ where: { user, date: range } });
  });

  it("health_count: количество записей о здоровье семьи", async () => {
    m.healthLog.count.mockResolvedValue(3);
    expect(await metricTotal("fam-1", "health_count", start, end)).toBe(3);
    expect(m.healthLog.count).toHaveBeenCalledWith({ where: { user, date: range } });
  });

  it("points: по date, а при date=null — по createdAt в [start, end+1 день)", async () => {
    m.pointsEvent.aggregate.mockResolvedValue({ _sum: { points: 120 } });
    expect(await metricTotal("fam-1", "points", start, end)).toBe(120);
    expect(m.pointsEvent.aggregate).toHaveBeenCalledWith({
      where: {
        user,
        OR: [
          { date: range },
          { date: null, createdAt: { gte: start, lt: new Date("2026-11-01T00:00:00.000Z") } },
        ],
      },
      _sum: { points: true },
    });
  });

  it.each([
    ["activity_minutes"],
    ["activity_km"],
    ["water_ml"],
    ["meals_count"],
    ["health_count"],
    ["points"],
  ] as const)("%s: нет записей -> 0 (null суммы не превращается в NaN)", async (metric) => {
    expect(await metricTotal("fam-1", metric, start, end)).toBe(0);
  });

  it("фильтр всегда по user.familyId переданной семьи", async () => {
    await metricTotal("other-fam", "water_ml", start, end);
    expect(m.waterLog.aggregate.mock.calls[0][0].where.user).toEqual({ familyId: "other-fam" });
  });

  it("запрашивает только нужную таблицу", async () => {
    await metricTotal("fam-1", "water_ml", start, end);
    expect(m.activityLog.aggregate).not.toHaveBeenCalled();
    expect(m.pointsEvent.aggregate).not.toHaveBeenCalled();
    expect(m.mealLog.count).not.toHaveBeenCalled();
  });
});

describe("getFamilyGoalsWithProgress", () => {
  const today = new Date("2026-10-06T00:00:00.000Z");
  const goal = (over: Record<string, unknown> = {}) => ({
    id: "g1",
    familyId: "fam-1",
    title: "Вода",
    metric: "water_ml",
    targetValue: 5000,
    startDate: start,
    endDate: end,
    createdAt: new Date("2026-09-30T00:00:00.000Z"),
    ...over,
  });

  it("выбирает цели только своей семьи с сортировкой", async () => {
    await getFamilyGoalsWithProgress("fam-1", today);
    expect(m.familyGoal.findMany).toHaveBeenCalledWith({
      where: { familyId: "fam-1" },
      orderBy: [{ endDate: "asc" }, { createdAt: "desc" }],
    });
  });

  it("нет целей: пустой массив, метрики не запрашиваются", async () => {
    expect(await getFamilyGoalsWithProgress("fam-1", today)).toEqual([]);
    expect(m.waterLog.aggregate).not.toHaveBeenCalled();
  });

  it("считает current и прогресс по каждой цели", async () => {
    m.familyGoal.findMany.mockResolvedValue([
      goal(),
      goal({ id: "g2", metric: "meals_count", targetValue: 10 }),
    ]);
    m.waterLog.aggregate.mockResolvedValue({ _sum: { amountMl: 2500 } });
    m.mealLog.count.mockResolvedValue(10);

    const r = await getFamilyGoalsWithProgress("fam-1", today);
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({ id: "g1", metric: "water_ml", current: 2500, percent: 50, achieved: false, status: "in_progress", daysLeft: 25 });
    expect(r[1]).toMatchObject({ id: "g2", metric: "meals_count", current: 10, percent: 100, achieved: true, status: "achieved" });
    // метрики считаются по семье цели и по периоду цели
    expect(m.waterLog.aggregate.mock.calls[0][0].where).toEqual({ user, date: range });
    expect(m.mealLog.count.mock.calls[0][0].where).toEqual({ user, date: range });
  });

  it("срок истёк без достижения: status expired", async () => {
    m.familyGoal.findMany.mockResolvedValue([goal()]);
    m.waterLog.aggregate.mockResolvedValue({ _sum: { amountMl: 100 } });
    const r = await getFamilyGoalsWithProgress("fam-1", new Date("2026-11-05T00:00:00.000Z"));
    expect(r[0].status).toBe("expired");
    expect(r[0].daysLeft).toBe(0);
  });

  it("неизвестная метрика в БД: metric null, current 0, без запросов и падения", async () => {
    m.familyGoal.findMany.mockResolvedValue([goal({ metric: "steps" })]);
    const r = await getFamilyGoalsWithProgress("fam-1", today);
    expect(r[0].metric).toBeNull();
    expect(r[0].current).toBe(0);
    expect(r[0].percent).toBe(0);
    expect(m.activityLog.aggregate).not.toHaveBeenCalled();
    expect(m.waterLog.aggregate).not.toHaveBeenCalled();
  });

  it("сбой БД пробрасывается вызывающему", async () => {
    m.familyGoal.findMany.mockRejectedValue(new Error("db down"));
    await expect(getFamilyGoalsWithProgress("fam-1", today)).rejects.toThrow("db down");
  });
});
