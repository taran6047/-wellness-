import { prisma } from "@/lib/db";
import { ACHIEVEMENTS, levelForPoints, levelProgress } from "@/lib/gamification";
import { requireUser } from "@/lib/require-user";

export default async function ProgressPage() {
  const me = await requireUser();
  const members = me.family.users;

  // Баллы только членов своей семьи
  const [sums, unlocked] = await Promise.all([
    prisma.pointsEvent.groupBy({
      by: ["userId"],
      where: { user: { familyId: me.familyId } },
      _sum: { points: true },
    }),
    prisma.userAchievement.findMany({
      where: { userId: me.id },
      select: { achievement: { select: { code: true } } },
    }),
  ]);

  const pointsByUser = new Map(sums.map((s) => [s.userId, s._sum.points ?? 0]));
  const myPoints = pointsByUser.get(me.id) ?? 0;
  const progress = levelProgress(myPoints);
  const unlockedCodes = new Set(unlocked.map((u) => u.achievement.code));

  const ranking = members
    .map((u) => ({ ...u, points: pointsByUser.get(u.id) ?? 0 }))
    .sort((a, b) => b.points - a.points);

  return (
    <section>
      <h1 className="text-2xl font-bold sm:text-3xl">Прогресс</h1>

      <div className="mt-6 rounded-lg border border-slate-200 bg-white p-4">
        <p className="text-sm text-slate-600">Мои баллы</p>
        <p className="mt-1 text-3xl font-bold">{myPoints}</p>
        <p className="mt-2">Уровень {progress.level}</p>
        <div
          role="progressbar"
          aria-valuenow={progress.percent}
          aria-valuemin={0}
          aria-valuemax={100}
          className="mt-2 h-3 overflow-hidden rounded-full bg-slate-200"
        >
          <div
            className="h-full bg-emerald-600"
            style={{ width: `${progress.percent}%` }}
          />
        </div>
        <p className="mt-1 text-sm text-slate-500">
          До уровня {progress.level + 1} осталось {progress.pointsToNext} (
          {myPoints} из {progress.nextLevelPoints})
        </p>
      </div>

      <h2 className="mt-8 text-xl font-semibold">Достижения</h2>
      <ul className="mt-3 grid gap-3 sm:grid-cols-2">
        {ACHIEVEMENTS.map((a) => {
          const done = unlockedCodes.has(a.code);
          return (
            <li
              key={a.code}
              className={`rounded-lg border p-4 ${
                done
                  ? "border-emerald-300 bg-emerald-50"
                  : "border-slate-200 bg-white text-slate-500"
              }`}
            >
              <p className="font-medium">
                {done ? "✓ " : ""}
                {a.title}
              </p>
              <p className="text-sm">{a.description}</p>
              <p className="mt-1 text-xs">
                {done ? "Получено" : "Пока не получено"}
              </p>
            </li>
          );
        })}
      </ul>

      <h2 className="mt-8 text-xl font-semibold">Баллы семьи</h2>
      <ul className="mt-3 divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
        {ranking.map((u) => (
          <li key={u.id} className="flex justify-between gap-4 px-4 py-3">
            <span>{u.name}</span>
            <span className="text-slate-600">
              {u.points} · уровень {levelForPoints(u.points)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
