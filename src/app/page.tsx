import Link from "next/link";
import { GoalCard } from "@/components/goal-ui";
import { prisma } from "@/lib/db";
import { getActiveGoalsWithProgress } from "@/lib/family-goals";
import { levelForPoints } from "@/lib/gamification";
import { getCurrentUser } from "@/lib/require-user";
import { dateInTimeZone } from "@/lib/timezone";

const MAX_DASHBOARD_GOALS = 3;
const MAX_DASHBOARD_ACHIEVEMENTS = 5;

const QUICK_LINKS = [
  { href: "/activity", label: "Добавить активность" },
  { href: "/nutrition", label: "Добавить питание или воду" },
  { href: "/health", label: "Добавить запись о здоровье" },
] as const;

export default async function Home() {
  const me = await getCurrentUser();

  if (!me) {
    return (
      <section>
        <h1 className="text-3xl font-bold sm:text-4xl">Family_Wellness</h1>
        <p className="mt-3 text-slate-600">
          Общая панель для всей семьи: спорт, питание и здоровье.
        </p>
      </section>
    );
  }

  const today = new Date(`${dateInTimeZone(me.timeZone)}T00:00:00.000Z`);
  const [sums, activeGoals, achievements] = await Promise.all([
    prisma.pointsEvent.groupBy({
      by: ["userId"],
      where: { user: { familyId: me.familyId } },
      _sum: { points: true },
    }),
    getActiveGoalsWithProgress(me.familyId, today, MAX_DASHBOARD_GOALS),
    prisma.userAchievement.findMany({
      where: { user: { familyId: me.familyId } },
      orderBy: { unlockedAt: "desc" },
      take: MAX_DASHBOARD_ACHIEVEMENTS,
      select: {
        id: true,
        unlockedAt: true,
        user: { select: { name: true } },
        achievement: { select: { title: true } },
      },
    }),
  ]);

  const pointsByUser = new Map(sums.map((s) => [s.userId, s._sum.points ?? 0]));
  const ranking = me.family.users
    .map((u) => ({ ...u, points: pointsByUser.get(u.id) ?? 0 }))
    .sort((a, b) => b.points - a.points);
  const familyPoints = ranking.reduce((sum, u) => sum + u.points, 0);

  return (
    <section>
      <h1 className="break-words text-2xl font-bold sm:text-3xl">{me.family.name}</h1>

      <div className="mt-6 rounded-lg border border-slate-200 bg-white p-4">
        <p className="text-sm text-slate-600">Баллы семьи</p>
        <p className="mt-1 text-3xl font-bold">{familyPoints}</p>
      </div>

      <h2 className="mt-8 text-xl font-semibold">Рейтинг</h2>
      <ul className="mt-3 divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
        {ranking.map((u, i) => (
          <li key={u.id} className="flex justify-between gap-4 px-4 py-3">
            <span className="min-w-0 break-words">
              {i + 1}. {u.name}
            </span>
            <span className="shrink-0 text-slate-600">
              {u.points} · уровень {levelForPoints(u.points)}
            </span>
          </li>
        ))}
      </ul>

      <h2 className="mt-8 text-xl font-semibold">Активные цели</h2>
      {activeGoals.length === 0 ? (
        <p className="mt-3 text-slate-600">Активных целей нет.</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {activeGoals.map((goal) => (
            <GoalCard key={goal.id} goal={goal} />
          ))}
        </ul>
      )}
      <Link
        href="/goals"
        className="mt-3 inline-flex min-h-11 items-center text-sm text-emerald-700 hover:underline"
      >
        Все цели
      </Link>

      <h2 className="mt-8 text-xl font-semibold">Последние достижения</h2>
      {achievements.length === 0 ? (
        <p className="mt-3 text-slate-600">Достижений пока нет.</p>
      ) : (
        <ul className="mt-3 divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
          {achievements.map((a) => (
            <li key={a.id} className="flex justify-between gap-4 px-4 py-3">
              <span className="min-w-0 break-words">{a.achievement.title}</span>
              <span className="shrink-0 text-slate-600">{a.user.name}</span>
            </li>
          ))}
        </ul>
      )}

      <h2 className="mt-8 text-xl font-semibold">Быстрые действия</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        {QUICK_LINKS.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className="flex min-h-11 items-center justify-center rounded-lg border border-slate-200 bg-white p-4 text-center font-medium hover:border-emerald-600"
          >
            {l.label}
          </Link>
        ))}
      </div>
    </section>
  );
}
