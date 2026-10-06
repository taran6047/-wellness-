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

async function grantAchievements(tx: Tx, userId: string): Promise<string[]> {
  const [activityCount, mealCount, waterCount, healthCount, total] =
    await Promise.all([
      tx.activityLog.count({ where: { userId } }),
      tx.mealLog.count({ where: { userId } }),
      tx.waterLog.count({ where: { userId } }),
      tx.healthLog.count({ where: { userId } }),
      tx.pointsEvent.aggregate({ where: { userId }, _sum: { points: true } }),
    ]);
  const dayQuery = {
    where: { userId },
    select: { date: true },
    distinct: ["date" as const],
  };
  const dayRows = await Promise.all([
    tx.activityLog.findMany(dayQuery),
    tx.mealLog.findMany(dayQuery),
    tx.waterLog.findMany(dayQuery),
    tx.healthLog.findMany(dayQuery),
  ]);
  const logDays = dayRows.flat().map((r) => r.date.toISOString().slice(0, 10));

  const earned = earnedAchievements({
    activityCount,
    mealCount,
    waterCount,
    healthCount,
    logDays,
    totalPoints: total._sum.points ?? 0,
  });

  const already = await tx.userAchievement.findMany({
    where: { userId },
    select: { achievement: { select: { code: true } } },
  });
  const have = new Set(already.map((a) => a.achievement.code));
  const fresh = ACHIEVEMENTS.filter(
    (a) => earned.includes(a.code) && !have.has(a.code),
  );

  const granted: string[] = [];
  for (const a of fresh) {
    // Каталог пополняется безопасно для повторов (параллельные транзакции разных пользователей)
    await tx.achievement.createMany({
      data: [{ code: a.code, title: a.title, description: a.description }],
      skipDuplicates: true,
    });
    const achievement = await tx.achievement.findUniqueOrThrow({
      where: { code: a.code },
    });
    // Повторная выдача (гонка) молча пропускается
    const created = await tx.userAchievement.createMany({
      data: [{ userId, achievementId: achievement.id }],
      skipDuplicates: true,
    });
    if (created.count > 0) granted.push(a.title);
  }
  return granted;
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
