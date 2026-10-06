"use client";

import type { ReactNode } from "react";
import { useActionState } from "react";
import type { FormState } from "@/app/actions/auth";
import { inputClass, buttonClass } from "@/components/styles";

// today и yesterday (YYYY-MM-DD) считает сервер в часовом поясе пользователя
export function DateField({
  today,
  yesterday,
}: {
  today: string;
  yesterday: string;
}) {
  return (
    <label className="block text-sm font-medium">
      Дата
      <input
        name="date"
        type="date"
        required
        defaultValue={today}
        min={yesterday}
        max={today}
        className={inputClass}
      />
    </label>
  );
}

export function NoteField() {
  return (
    <label className="block text-sm font-medium">
      Заметка (необязательно)
      <input name="note" type="text" maxLength={500} className={inputClass} />
    </label>
  );
}

export function LogForm({
  title,
  action,
  children,
}: {
  title: string;
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  children: ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);

  return (
    <form
      action={formAction}
      className="space-y-4 rounded-lg border border-slate-200 bg-white p-4"
    >
      <h2 className="text-lg font-semibold">{title}</h2>
      {children}
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
        {pending ? "Сохраняем..." : "Добавить"}
      </button>
    </form>
  );
}
