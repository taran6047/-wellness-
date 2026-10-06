import { deleteGoalAction } from "@/app/actions/goals";
import { DeleteForm } from "@/components/delete-form";
import { GoalForm } from "@/components/goal-form";
import { GoalCard } from "@/components/goal-ui";
import { getFamilyGoalsWithProgress } from "@/lib/family-goals";
import { requireUser } from "@/lib/require-user";
import { dateInTimeZone } from "@/lib/timezone";

export default async function GoalsPage() {
  const me = await requireUser();
  const today = dateInTimeZone(me.timeZone);
  const goals = await getFamilyGoalsWithProgress(
    me.familyId,
    new Date(`${today}T00:00:00.000Z`),
  );
  const isAdult = me.role === "adult";

  return (
    <section>
      <h1 className="text-2xl font-bold sm:text-3xl">Цели</h1>
      <p className="mt-1 text-sm text-slate-500">
        Общий прогресс считается по записям всех членов семьи.
      </p>

      {goals.length === 0 ? (
        <p className="mt-6 text-slate-600">Целей пока нет.</p>
      ) : (
        <ul className="mt-6 space-y-3">
          {goals.map((goal) => (
            <GoalCard
              key={goal.id}
              goal={goal}
              action={
                isAdult ? (
                  <DeleteForm
                    id={goal.id}
                    action={deleteGoalAction}
                    className="mt-2"
                  />
                ) : null
              }
            />
          ))}
        </ul>
      )}

      {isAdult ? (
        <div className="mt-8">
          <GoalForm today={today} />
        </div>
      ) : (
        <p className="mt-8 text-sm text-slate-500">
          Создавать и удалять цели могут только взрослые.
        </p>
      )}
    </section>
  );
}
