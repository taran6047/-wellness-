import { prisma } from "@/lib/db";
import {
  LOGIN_LOCK_MS,
  LOGIN_WINDOW_MS,
  MAX_LOGIN_FAILURES,
} from "@/lib/constants";

type Attempt = {
  failedCount: number;
  windowStart: Date;
  lockedUntil: Date | null;
} | null;

const DAY_MS = 24 * 60 * 60 * 1000;

export function isLocked(attempt: Attempt, now = new Date()): boolean {
  return !!attempt?.lockedUntil && attempt.lockedUntil.getTime() > now.getTime();
}

// Учитываем неудачную попытку: окно считается от первой неудачи, на лимите ставим блокировку.
// Счётчик обновляется одним SQL-запросом, поэтому параллельные попытки не теряются.
// Параметр attempt оставлен для совместимости вызова: актуальное значение берётся из БД.
export async function recordFailedLogin(
  email: string,
  _attempt: Attempt,
  now = new Date(),
) {
  const nowIso = now.toISOString();
  const windowCutoff = new Date(now.getTime() - LOGIN_WINDOW_MS).toISOString();
  const lockUntil = new Date(now.getTime() + LOGIN_LOCK_MS).toISOString();

  await prisma.$executeRaw`
    INSERT INTO "LoginAttempt" ("email", "failedCount", "windowStart", "lockedUntil")
    VALUES (
      ${email},
      1,
      ${nowIso}::timestamp,
      CASE WHEN 1 >= ${MAX_LOGIN_FAILURES} THEN ${lockUntil}::timestamp ELSE NULL END
    )
    ON CONFLICT ("email") DO UPDATE SET
      "failedCount" = CASE
        WHEN "LoginAttempt"."windowStart" < ${windowCutoff}::timestamp THEN 1
        ELSE "LoginAttempt"."failedCount" + 1
      END,
      "windowStart" = CASE
        WHEN "LoginAttempt"."windowStart" < ${windowCutoff}::timestamp THEN ${nowIso}::timestamp
        ELSE "LoginAttempt"."windowStart"
      END,
      "lockedUntil" = CASE
        WHEN (
          CASE
            WHEN "LoginAttempt"."windowStart" < ${windowCutoff}::timestamp THEN 1
            ELSE "LoginAttempt"."failedCount" + 1
          END
        ) >= ${MAX_LOGIN_FAILURES} THEN ${lockUntil}::timestamp
        ELSE NULL
      END
  `;

  // Дешёвая очистка: окно истекло более суток назад и блокировки уже нет
  const staleBefore = new Date(now.getTime() - LOGIN_WINDOW_MS - DAY_MS);
  await prisma.loginAttempt.deleteMany({
    where: {
      windowStart: { lt: staleBefore },
      OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }],
    },
  });
}

// Успешный вход сбрасывает счётчик
export async function clearFailedLogins(email: string) {
  await prisma.loginAttempt.deleteMany({ where: { email } });
}
