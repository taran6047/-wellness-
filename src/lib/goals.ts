// Чистая логика семейных целей: метрики, расчёт прогресса. Без обращения к БД.

export const GOAL_METRICS = {
  activity_minutes: { label: "Минуты активности", unit: "мин" },
  activity_km: { label: "Километры активности", unit: "км" },
  water_ml: { label: "Миллилитры воды", unit: "мл" },
  meals_count: { label: "Количество приёмов пищи", unit: "приёмов" },
  health_count: { label: "Количество записей о здоровье", unit: "записей" },
  points: { label: "Баллы", unit: "баллов" },
} as const;

export type GoalMetric = keyof typeof GOAL_METRICS;

export const GOAL_METRIC_KEYS = Object.keys(GOAL_METRICS) as [
  GoalMetric,
  ...GoalMetric[],
];

export const MAX_GOAL_TARGET = 1_000_000;
export const MAX_GOAL_DAYS = 366;

const DAY_MS = 24 * 60 * 60 * 1000;

export type GoalStatus = "in_progress" | "achieved" | "expired";

export const GOAL_STATUS_LABELS: Record<GoalStatus, string> = {
  in_progress: "В процессе",
  achieved: "Достигнута",
  expired: "Срок истёк",
};

export function isGoalMetric(value: string): value is GoalMetric {
  return Object.prototype.hasOwnProperty.call(GOAL_METRICS, value);
}

// Длина периода в днях, включая оба конца (даты — UTC-полночь)
export function goalPeriodDays(startDate: Date, endDate: Date): number {
  return Math.round((endDate.getTime() - startDate.getTime()) / DAY_MS) + 1;
}

export function calculateGoalProgress(input: {
  current: number;
  targetValue: number;
  endDate: Date;
  // Сегодняшний день как UTC-полночь
  today: Date;
}) {
  const { current, targetValue, endDate, today } = input;
  const safeCurrent = Math.max(0, current);
  const percent =
    targetValue > 0
      ? Math.max(0, Math.min(100, Math.floor((safeCurrent / targetValue) * 100)))
      : 0;
  const achieved = targetValue > 0 && safeCurrent >= targetValue;
  const daysLeft = Math.max(
    0,
    Math.round((endDate.getTime() - today.getTime()) / DAY_MS),
  );
  const expired = today.getTime() > endDate.getTime();
  const status: GoalStatus = achieved
    ? "achieved"
    : expired
      ? "expired"
      : "in_progress";
  return { percent, achieved, daysLeft, status };
}

export function formatGoalValue(value: number): string {
  return String(Math.round(value * 100) / 100);
}
