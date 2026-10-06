import { deleteHealthAction } from "@/app/actions/logs";
import { HealthForm } from "@/components/log-forms";
import { LogList } from "@/components/log-list";
import { listFamilyHealth } from "@/lib/logs";
import { dateInTimeZone } from "@/lib/timezone";
import { requireUser } from "@/lib/require-user";
import { MOOD_LABELS } from "@/lib/validation";

export default async function HealthPage() {
  const me = await requireUser();
  const today = dateInTimeZone(me.timeZone);
  const yesterday = dateInTimeZone(me.timeZone, -1);
  const logs = await listFamilyHealth(me.familyId);

  return (
    <section className="space-y-8">
      <h1 className="text-2xl font-bold sm:text-3xl">Здоровье</h1>
      <HealthForm today={today} yesterday={yesterday} />
      <LogList
        title="Последние записи семьи"
        meId={me.id}
        deleteAction={deleteHealthAction}
        items={logs.map((l) => {
          const parts = [
            l.weightKg != null && `вес ${l.weightKg} кг`,
            l.sleepHours != null && `сон ${l.sleepHours} ч`,
            l.mood != null &&
              `самочувствие: ${
                MOOD_LABELS[l.mood as keyof typeof MOOD_LABELS] ?? l.mood
              }`,
          ].filter(Boolean);
          return {
            id: l.id,
            authorId: l.user.id,
            authorName: l.user.name,
            date: l.date,
            content: (
              <>
                <p>{parts.join(", ")}</p>
                {l.note && <p className="text-sm text-slate-600">{l.note}</p>}
              </>
            ),
          };
        })}
      />
    </section>
  );
}
