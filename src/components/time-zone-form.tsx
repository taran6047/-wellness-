"use client";

import { useActionState } from "react";
import { updateTimeZoneAction } from "@/app/actions/timezone";
import { buttonClass, inputClass } from "@/components/styles";

export function TimeZoneForm({
  current,
  zones,
}: {
  current: string;
  zones: string[];
}) {
  const [state, action, pending] = useActionState(updateTimeZoneAction, undefined);
  const options = zones.includes(current) ? zones : [current, ...zones];

  return (
    <form
      action={action}
      className="mt-3 space-y-3 rounded-lg border border-slate-200 bg-white p-4"
    >
      <label className="block text-sm font-medium">
        Часовой пояс
        <select name="timeZone" defaultValue={current} className={inputClass}>
          {options.map((z) => (
            <option key={z} value={z}>
              {z}
            </option>
          ))}
        </select>
      </label>
      {state?.message && (
        <p role="status" className="text-sm text-emerald-700">
          {state.message}
        </p>
      )}
      {state?.error && (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      )}
      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? "Сохраняем..." : "Сохранить"}
      </button>
    </form>
  );
}
