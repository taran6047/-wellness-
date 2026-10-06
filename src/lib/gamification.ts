// Чистая логика геймификации: баллы, уровни, достижения. Без обращения к БД.

export type LogKind = "activity" | "meal" | "water" | "health";

// ---------- Баллы ----------

const ACTIVITY_MINUTES_PER_POINT = 5;
const ACTIVITY_MAX_PER_LOG = 60;
const MEAL_POINTS = 5;
const WATER_ML_PER_POINT = 250;
const WATER_MAX_PER_LOG = 8;
const HEALTH_POINTS = 5;

// Суточные лимиты на пользователя по типу записи (против накрутки)
export const DAILY_LIMITS: Record<LogKind, number> = {
  activity: 100,
  meal: 20,
  water: 8,
  health: 5,
};

export function pointsForActivity(durationMinutes: number): number {
  const points = Math.floor(durationMinutes / ACTIVITY_MINUTES_PER_POINT);
  return Math.max(0, Math.min(points, ACTIVITY_MAX_PER_LOG));
}

export function pointsForMeal(): number {
  return MEAL_POINTS;
}

export function pointsForWater(amountMl: number): number {
  const points = Math.floor(amountMl / WATER_ML_PER_POINT);
  return Math.max(0, Math.min(points, WATER_MAX_PER_LOG));
}

export function pointsForHealth(): number {
  return HEALTH_POINTS;
}

// Сколько баллов реально начислить с учётом суточного лимита
export function applyDailyLimit(
  kind: LogKind,
  rawPoints: number,
  alreadyEarnedToday: number,
): number {
  const left = Math.max(0, DAILY_LIMITS[kind] - alreadyEarnedToday);
  return Math.max(0, Math.min(rawPoints, left));
}

function pluralPoints(n: number): string {
  const mod100 = n % 100;
  const mod10 = n % 10;
  if (mod100 >= 11 && mod100 <= 14) return "баллов";
  if (mod10 === 1) return "балл";
  if (mod10 >= 2 && mod10 <= 4) return "балла";
  return "баллов";
}

// Сообщение после сохранения записи
export function savedMessage(points: number): string {
  if (points <= 0) return "Сохранено, лимит баллов на сегодня достигнут";
  return `Сохранено, +${points} ${pluralPoints(points)}`;
}

// ---------- Уровни ----------

const POINTS_PER_LEVEL_UNIT = 50;

export function levelForPoints(totalPoints: number): number {
  const safe = Math.max(0, totalPoints);
  return Math.floor(Math.sqrt(safe / POINTS_PER_LEVEL_UNIT)) + 1;
}

// Сколько баллов нужно, чтобы достичь уровня
export function pointsForLevel(level: number): number {
  const steps = Math.max(0, level - 1);
  return POINTS_PER_LEVEL_UNIT * steps * steps;
}

export function levelProgress(totalPoints: number) {
  const safe = Math.max(0, totalPoints);
  const level = levelForPoints(safe);
  const currentLevelPoints = pointsForLevel(level);
  const nextLevelPoints = pointsForLevel(level + 1);
  const percent = Math.floor(
    ((safe - currentLevelPoints) / (nextLevelPoints - currentLevelPoints)) *
      100,
  );
  return {
    level,
    currentLevelPoints,
    nextLevelPoints,
    pointsToNext: nextLevelPoints - safe,
    percent: Math.max(0, Math.min(100, percent)),
  };
}

// ---------- Достижения ----------

export const ACHIEVEMENTS = [
  {
    code: "first_activity",
    title: "Первая активность",
    description: "Добавьте первую запись об активности",
  },
  {
    code: "first_meal",
    title: "Первый приём пищи",
    description: "Добавьте первую запись о питании",
  },
  {
    code: "first_water",
    title: "Первый стакан воды",
    description: "Добавьте первую запись о воде",
  },
  {
    code: "first_health",
    title: "Первая запись о здоровье",
    description: "Добавьте первую запись о здоровье",
  },
  {
    code: "streak_3",
    title: "Серия 3 дня",
    description: "Делайте записи 3 дня подряд",
  },
  {
    code: "streak_7",
    title: "Серия 7 дней",
    description: "Делайте записи 7 дней подряд",
  },
  {
    code: "points_100",
    title: "100 баллов",
    description: "Наберите 100 баллов",
  },
  {
    code: "points_500",
    title: "500 баллов",
    description: "Наберите 500 баллов",
  },
  {
    code: "points_1000",
    title: "1000 баллов",
    description: "Наберите 1000 баллов",
  },
  {
    code: "level_5",
    title: "Пятый уровень",
    description: "Достигните 5-го уровня",
  },
] as const;

export type AchievementCode = (typeof ACHIEVEMENTS)[number]["code"];

export type AchievementStats = {
  activityCount: number;
  mealCount: number;
  waterCount: number;
  healthCount: number;
  // Дни с любыми записями в формате YYYY-MM-DD (повторы допустимы)
  logDays: string[];
  totalPoints: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

// Самая длинная серия подряд идущих дней
export function longestStreak(days: string[]): number {
  const times = [
    ...new Set(days.map((d) => new Date(`${d}T00:00:00.000Z`).getTime())),
  ]
    .filter((t) => !Number.isNaN(t))
    .sort((a, b) => a - b);

  let best = 0;
  let current = 0;
  let prev: number | null = null;
  for (const t of times) {
    current = prev !== null && t - prev === DAY_MS ? current + 1 : 1;
    best = Math.max(best, current);
    prev = t;
  }
  return best;
}

// Коды достижений, которые заслужены при данных показателях
export function earnedAchievements(stats: AchievementStats): AchievementCode[] {
  const streak = longestStreak(stats.logDays);
  const checks: Record<AchievementCode, boolean> = {
    first_activity: stats.activityCount >= 1,
    first_meal: stats.mealCount >= 1,
    first_water: stats.waterCount >= 1,
    first_health: stats.healthCount >= 1,
    streak_3: streak >= 3,
    streak_7: streak >= 7,
    points_100: stats.totalPoints >= 100,
    points_500: stats.totalPoints >= 500,
    points_1000: stats.totalPoints >= 1000,
    level_5: levelForPoints(stats.totalPoints) >= 5,
  };
  return ACHIEVEMENTS.filter((a) => checks[a.code]).map((a) => a.code);
}
