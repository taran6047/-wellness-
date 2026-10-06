import { deleteMealAction, deleteWaterAction } from "@/app/actions/logs";
import { MealForm, WaterForm } from "@/components/log-forms";
import { LogList } from "@/components/log-list";
import { listFamilyMeals, listFamilyWater } from "@/lib/logs";
import { dateInTimeZone } from "@/lib/timezone";
import { requireUser } from "@/lib/require-user";
import { MEAL_TYPES } from "@/lib/validation";

export default async function NutritionPage() {
  const me = await requireUser();
  const today = dateInTimeZone(me.timeZone);
  const yesterday = dateInTimeZone(me.timeZone, -1);
  const [meals, water] = await Promise.all([
    listFamilyMeals(me.familyId),
    listFamilyWater(me.familyId),
  ]);

  return (
    <section className="space-y-8">
      <h1 className="text-2xl font-bold sm:text-3xl">Питание и вода</h1>
      <div className="grid gap-4 md:grid-cols-2">
        <MealForm today={today} yesterday={yesterday} />
        <WaterForm today={today} yesterday={yesterday} />
      </div>
      <LogList
        title="Последние приёмы пищи семьи"
        meId={me.id}
        deleteAction={deleteMealAction}
        items={meals.map((m) => ({
          id: m.id,
          authorId: m.user.id,
          authorName: m.user.name,
          date: m.date,
          content: (
            <p>
              <span className="font-medium">
                {MEAL_TYPES[m.mealType as keyof typeof MEAL_TYPES] ??
                  m.mealType}
              </span>
              : {m.description}
            </p>
          ),
        }))}
      />
      <LogList
        title="Последняя выпитая вода семьи"
        meId={me.id}
        deleteAction={deleteWaterAction}
        items={water.map((w) => ({
          id: w.id,
          authorId: w.user.id,
          authorName: w.user.name,
          date: w.date,
          content: <p>{w.amountMl} мл</p>,
        }))}
      />
    </section>
  );
}
