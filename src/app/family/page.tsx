import { TimeZoneForm } from "@/components/time-zone-form";
import { POPULAR_TIME_ZONES } from "@/lib/timezone";
import { requireUser } from "@/lib/require-user";

const ROLE_LABELS = { adult: "Взрослый", child: "Ребёнок" } as const;

export default async function FamilyPage() {
  const me = await requireUser();
  const family = me.family;

  return (
    <section>
      <h1 className="text-2xl font-bold sm:text-3xl">{family.name}</h1>

      <div className="mt-6 rounded-lg border border-slate-200 bg-white p-4">
        <p className="text-sm text-slate-600">Код приглашения</p>
        <p className="mt-1 font-mono text-2xl tracking-widest">
          {family.inviteCode}
        </p>
        <p className="mt-1 text-sm text-slate-500">
          Передайте код тем, кто должен вступить в семью.
        </p>
      </div>

      <h2 className="mt-8 text-xl font-semibold">Члены семьи</h2>
      <ul className="mt-3 divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
        {family.users.map((u) => (
          <li key={u.id} className="flex justify-between gap-4 px-4 py-3">
            <span>{u.name}</span>
            <span className="text-slate-600">{ROLE_LABELS[u.role]}</span>
          </li>
        ))}
      </ul>

      <h2 className="mt-8 text-xl font-semibold">Мой часовой пояс</h2>
      <p className="mt-1 text-sm text-slate-500">
        По нему определяются «сегодня» и «вчера» при добавлении записей.
      </p>
      <TimeZoneForm current={me.timeZone} zones={POPULAR_TIME_ZONES} />
    </section>
  );
}
