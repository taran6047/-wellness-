import { deleteActivityAction } from "@/app/actions/logs";
import { ActivityForm } from "@/components/log-forms";
import { LogList } from "@/components/log-list";
import { listFamilyActivity } from "@/lib/logs";
import { dateInTimeZone } from "@/lib/timezone";
import { requireUser } from "@/lib/require-user";
import { ACTIVITY_TYPES } from "@/lib/validation";

export default async function ActivityPage() {
  const me = await requireUser();
  const today = dateInTimeZone(me.timeZone);
  const yesterday = dateInTimeZone(me.timeZone, -1);
  const logs = await listFamilyActivity(me.familyId);

  return (
    <section className="space-y-8">
      <h1 className="text-2xl font-bold sm:text-3xl">Активность</h1>
      <ActivityForm today={today} yesterday={yesterday} />
      <LogList
        title="Последние записи семьи"
        meId={me.id}
        deleteAction={deleteActivityAction}
        items={logs.map((l) => ({
          id: l.id,
          authorId: l.user.id,
          authorName: l.user.name,
          date: l.date,
          content: (
            <>
              <p>
                {ACTIVITY_TYPES[l.type as keyof typeof ACTIVITY_TYPES] ??
                  l.type}
                , {l.durationMinutes} мин
                {l.distanceKm != null && `, ${l.distanceKm} км`}
              </p>
              {l.note && <p className="text-sm text-slate-600">{l.note}</p>}
            </>
          ),
        }))}
      />
    </section>
  );
}
