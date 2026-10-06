import { prisma } from "@/lib/db";
import {
  type GoalMetric,
  calculateGoalProgress,
  isGoalMetric,
} from "@/lib/goals";

const DAY_MS = 24 * 60 * 60 * 1000;

// Сумма метрики по записям всех членов семьи за период [startDate, endDate]
export async function metricTotal(
  familyId: string,
  metric: GoalMetric,
  startDate: Date,
  endDate: Date,
): Promise<number> {
  const user = { familyId };
  const range = { gte: startDate, lte: endDate };

  switch (metric) {
    case "activity_minutes": {
      const r = await prisma.activityLog.aggregate({
        where: { user, date: range },
        _sum: { durationMinutes: true },
      });
      return r._sum.durationMinutes ?? 0;
    }
    case "activity_km": {
      const r = await prisma.activityLog.aggregate({
        where: { user, date: range },
        _sum: { distanceKm: true },
      });
      return r._sum.distanceKm ?? 0;
    }
    case "water_ml": {
      const r = await prisma.waterLog.aggregate({
        where: { user, date: range },
        _sum: { amountMl: true },
      });
      return r._sum.amountMl ?? 0;
    }
    case "meals_count":
      return prisma.mealLog.count({ where: { user, date: range } });
    case "health_count":
      return prisma.healthLog.count({ where: { user, date: range } });
    case "points": {
      // Баллы привязаны к дню записи; если дня нет — берём момент начисления
      const endExclusive = new Date(endDate.getTime() + DAY_MS);
      const r = await prisma.pointsEvent.aggregate({
        where: {
          user,
          OR: [
            { date: range },
            { date: null, createdAt: { gte: startDate, lt: endExclusive } },
          ],
        },
        _sum: { points: true },
      });
      return r._sum.points ?? 0;
    }
  }
}

// Цели семьи с прогрессом; today — UTC-полночь сегодняшнего дня пользователя
export async function getFamilyGoalsWithProgress(familyId: string, today: Date) {
  const goals = await prisma.familyGoal.findMany({
    where: { familyId },
    orderBy: [{ endDate: "asc" }, { createdAt: "desc" }],
  });

  return Promise.all(
    goals.map(async (goal) => {
      const metric = isGoalMetric(goal.metric) ? goal.metric : null;
      const current = metric
        ? await metricTotal(familyId, metric, goal.startDate, goal.endDate)
        : 0;
      return {
        ...goal,
        metric,
        current,
        ...calculateGoalProgress({
          current,
          targetValue: goal.targetValue,
          endDate: goal.endDate,
          today,
        }),
      };
    }),
  );
}

export type GoalWithProgress = Awaited<
  ReturnType<typeof getFamilyGoalsWithProgress>
>[number];
