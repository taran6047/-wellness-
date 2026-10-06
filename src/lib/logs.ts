import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  ACHIEVEMENTS,
  applyDailyLimit,
  earnedAchievements,
  pointsForActivity,
  pointsForHealth,
  pointsForMeal,
  pointsForWater,
  type LogKind,
} from "@/lib/gamification";
import { MAX_DAILY_RECORDS } from "@/lib/constants";

const RECENT_LIMIT = 30;

// Сохранение записи делает десятки запросов к облачной БД (около 190 мс каждый),
// поэтому стандартных 5 секунд на транзакцию не хватает
const TX_OPTIONS = { maxWait: 15_000, timeout: 30_000 };

// Блокировка по пользователю до конца транзакции: параллельные записи
// не обходят суточный лимит баллов
async function lockUser(tx: Tx, userId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;
}

type Tx = Prisma.TransactionClient;

export type CreateResult = {
  points: number;
  newAchievements: string[];
};

// Начисление баллов (с суточным лимитом) и выдача заслуженных достижений.
// Вызывается внутри транзакции создания записи.
async function awardPoints(
  tx: Tx,
  userId: string,
  kind: LogKind,
  sourceId: string,
  date: Date,
  rawPoints: number,
): Promise<CreateResult> {
  const earnedToday = await tx.pointsEvent.aggregate({
    where: { userId, sourceType: kind, date },
    _sum: { points: true },
  });
  const points = applyDailyLimit(kind, rawPoints, earnedToday._sum.points ?? 0);

  // Событие создаётся и при 0 баллов; уникальность (sourceType, sourceId)
  // не даёт начислить за одну запись дважды
  await tx.pointsEvent.create({
    data: { userId, points, reason: kind, sourceType: kind, sourceId, date },
  });

  const newAchievements = await grantAchievements(tx, userId);
  return { points, newAchievements };
}

const KIND_LABELS: Record<LogKind, string> = {
  activity: "активности",
  meal: "питания",
  water: "воды",
  health: "здоровья",
};

export class DailyLimitError extends Error {
  constructor(kind: LogKind) {
    super(
      `Достигнут лимит: не более ${MAX_DAILY_RECORDS} записей ${KIND_LABELS[kind]} в день`,
    );
    this.name = "DailyLimitError";
  }
}

// Вызывается внутри транзакции после блокировки пользователя; count — записей того же типа за день
function checkDailyLimit(kind: LogKind, count: number) {
  if (count >= MAX_DAILY_RECORDS) throw new DailyLimitError(kind);
}

type Stats = {
  activityCount: number;
  mealCount: number;
  waterCount: number;
  healthCount: number;
  totalPoints: number;
};

// Все счётчики одним запросом вместо пяти
async function loadStats(tx: Tx, userId: string): Promise<Stats> {
  const rows = await tx.$queryRaw<Stats[]>`
    SELECT
      (SELECT COUNT(*) FROM "ActivityLog" WHERE "userId" = ${userId})::int AS "activityCount",
      (SELECT COUNT(*) FROM "MealLog" WHERE "userId" = ${userId})::int AS "mealCount",
      (SELECT COUNT(*) FROM "WaterLog" WHERE "userId" = ${userId})::int AS "waterCount",
      (SELECT COUNT(*) FROM "HealthLog" WHERE "userId" = ${userId})::int AS "healthCount",
      (SELECT COALESCE(SUM(points), 0) FROM "PointsEvent" WHERE "userId" = ${userId})::int AS "totalPoints"`;
  return rows[0];
}

// Дни с любыми записями одним запросом (UNION убирает повторы)
async function loadLogDays(tx: Tx, userId: string): Promise<string[]> {
  const rows = await tx.$queryRaw<{ date: Date }[]>`
    SELECT "date" FROM "ActivityLog" WHERE "userId" = ${userId}
    UNION SELECT "date" FROM "MealLog" WHERE "userId" = ${userId}
    UNION SELECT "date" FROM "WaterLog" WHERE "userId" = ${userId}
    UNION SELECT "date" FROM "HealthLog" WHERE "userId" = ${userId}`;
  return rows.map((r) => r.date.toISOString().slice(0, 10));
}

const STREAK_CODES: string[] = ["streak_3", "streak_7"];

async function grantAchievements(tx: Tx, userId: string): Promise<string[]> {
  const already = await tx.userAchievement.findMany({
    where: { userId },
    select: { achievement: { select: { code: true } } },
  });
  const have = new Set(already.map((a) => a.achievement.code));
  // Всё уже выдано: новых достижений быть не может
  if (ACHIEVEMENTS.every((a) => have.has(a.code))) return [];

  // Считаем только то, что нужно для ещё не выданных достижений
  const missing = ACHIEVEMENTS.filter((a) => !have.has(a.code));
  const needStats = missing.some((a) => !STREAK_CODES.includes(a.code));
  const needDays = missing.some((a) => STREAK_CODES.includes(a.code));
  const [stats, logDays] = await Promise.all([
    needStats ? loadStats(tx, userId) : null,
    needDays ? loadLogDays(tx, userId) : [],
  ]);

  const earned = earnedAchievements({
    activityCount: stats?.activityCount ?? 0,
    mealCount: stats?.mealCount ?? 0,
    waterCount: stats?.waterCount ?? 0,
    healthCount: stats?.healthCount ?? 0,
    logDays,
    totalPoints: stats?.totalPoints ?? 0,
  });
  const fresh = missing.filter((a) => earned.includes(a.code));
  if (fresh.length === 0) return [];

  // Каталог пополняется безопасно для повторов; выдача — тремя запросами на все новые достижения
  await tx.achievement.createMany({
    data: fresh.map((a) => ({
      code: a.code,
      title: a.title,
      description: a.description,
    })),
    skipDuplicates: true,
  });
  const catalog = await tx.achievement.findMany({
    where: { code: { in: fresh.map((a) => a.code) } },
    select: { id: true, code: true },
  });
  // Повторная выдача (гонка) молча пропускается: возвращаются только реально созданные
  const created = await tx.userAchievement.createManyAndReturn({
    data: catalog.map((c) => ({ userId, achievementId: c.id })),
    skipDuplicates: true,
    select: { achievementId: true },
  });
  const createdIds = new Set(created.map((c) => c.achievementId));
  const titleByCode = new Map<string, string>(
    fresh.map((a) => [a.code, a.title]),
  );
  return catalog
    .filter((c) => createdIds.has(c.id))
    .map((c) => titleByCode.get(c.code) as string);
}

// Все записи — только от имени userId. Запись и баллы создаются в одной транзакции.
export function createActivityLog(
  userId: string,
  data: {
    type: string;
    durationMinutes: number;
    distanceKm?: number;
    note?: string;
    date: Date;
  },
): Promise<CreateResult> {
  return prisma.$transaction(async (tx) => {
    await lockUser(tx, userId);
    checkDailyLimit(
      "activity",
      await tx.activityLog.count({ where: { userId, date: data.date } }),
    );
    const log = await tx.activityLog.create({ data: { ...data, userId } });
    return awardPoints(
      tx,
      userId,
      "activity",
      log.id,
      data.date,
      pointsForActivity(data.durationMinutes),
    );
  }, TX_OPTIONS);
}

export function createMealLog(
  userId: string,
  data: { mealType: string; description: string; date: Date },
): Promise<CreateResult> {
  return prisma.$transaction(async (tx) => {
    await lockUser(tx, userId);
    checkDailyLimit(
      "meal",
      await tx.mealLog.count({ where: { userId, date: data.date } }),
    );
    const log = await tx.mealLog.create({ data: { ...data, userId } });
    return awardPoints(tx, userId, "meal", log.id, data.date, pointsForMeal());
  }, TX_OPTIONS);
}

export function createWaterLog(
  userId: string,
  data: { amountMl: number; date: Date },
): Promise<CreateResult> {
  return prisma.$transaction(async (tx) => {
    await lockUser(tx, userId);
    checkDailyLimit(
      "water",
      await tx.waterLog.count({ where: { userId, date: data.date } }),
    );
    const log = await tx.waterLog.create({ data: { ...data, userId } });
    return awardPoints(
      tx,
      userId,
      "water",
      log.id,
      data.date,
      pointsForWater(data.amountMl),
    );
  }, TX_OPTIONS);
}

export function createHealthLog(
  userId: string,
  data: {
    weightKg?: number;
    sleepHours?: number;
    mood?: number;
    note?: string;
    date: Date;
  },
): Promise<CreateResult> {
  return prisma.$transaction(async (tx) => {
    await lockUser(tx, userId);
    checkDailyLimit(
      "health",
      await tx.healthLog.count({ where: { userId, date: data.date } }),
    );
    const log = await tx.healthLog.create({ data: { ...data, userId } });
    return awardPoints(
      tx,
      userId,
      "health",
      log.id,
      data.date,
      pointsForHealth(),
    );
  }, TX_OPTIONS);
}

async function revokePoints(
  tx: Tx,
  userId: string,
  kind: LogKind,
  sourceId: string,
) {
  await tx.pointsEvent.deleteMany({
    where: { userId, sourceType: kind, sourceId },
  });
}

// Удалять можно только свои записи: userId входит в условие.
// Вместе с записью удаляется её PointsEvent (баллы отзываются), достижения остаются.
export function deleteOwnActivityLog(userId: string, id: string) {
  return prisma.$transaction(async (tx) => {
    await tx.activityLog.deleteMany({ where: { id, userId } });
    await revokePoints(tx, userId, "activity", id);
  });
}

export function deleteOwnMealLog(userId: string, id: string) {
  return prisma.$transaction(async (tx) => {
    await tx.mealLog.deleteMany({ where: { id, userId } });
    await revokePoints(tx, userId, "meal", id);
  });
}

export function deleteOwnWaterLog(userId: string, id: string) {
  return prisma.$transaction(async (tx) => {
    await tx.waterLog.deleteMany({ where: { id, userId } });
    await revokePoints(tx, userId, "water", id);
  });
}

export function deleteOwnHealthLog(userId: string, id: string) {
  return prisma.$transaction(async (tx) => {
    await tx.healthLog.deleteMany({ where: { id, userId } });
    await revokePoints(tx, userId, "health", id);
  });
}

// Последние записи семьи: всегда фильтр по семье пользователя
const familyUser = (familyId: string) => ({ user: { familyId } });
const withAuthor = { user: { select: { id: true, name: true } } };
const newestFirst = [{ date: "desc" }, { createdAt: "desc" }] as const;

export function listFamilyActivity(familyId: string) {
  return prisma.activityLog.findMany({
    where: familyUser(familyId),
    include: withAuthor,
    orderBy: [...newestFirst],
    take: RECENT_LIMIT,
  });
}

export function listFamilyMeals(familyId: string) {
  return prisma.mealLog.findMany({
    where: familyUser(familyId),
    include: withAuthor,
    orderBy: [...newestFirst],
    take: RECENT_LIMIT,
  });
}

export function listFamilyWater(familyId: string) {
  return prisma.waterLog.findMany({
    where: familyUser(familyId),
    include: withAuthor,
    orderBy: [...newestFirst],
    take: RECENT_LIMIT,
  });
}

export function listFamilyHealth(familyId: string) {
  return prisma.healthLog.findMany({
    where: familyUser(familyId),
    include: withAuthor,
    orderBy: [...newestFirst],
    take: RECENT_LIMIT,
  });
}
