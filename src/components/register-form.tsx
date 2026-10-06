"use client";

import { useActionState, useEffect, useState } from "react";
import { registerAction } from "@/app/actions/auth";
import { inputClass, buttonClass } from "@/components/styles";

export function RegisterForm() {
  const [state, action, pending] = useActionState(registerAction, undefined);
  const [mode, setMode] = useState<"create" | "join">("create");

  const [timeZone, setTimeZone] = useState("UTC");

  useEffect(() => {
    setTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  }, []);

  const tabClass = (active: boolean) =>
    `min-h-11 flex-1 rounded-md px-2 py-2 text-sm font-medium ${
      active ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-700"
    }`;

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="mode" value={mode} />
      <input type="hidden" name="timeZone" value={timeZone} />
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setMode("create")}
          className={tabClass(mode === "create")}
        >
          Создать семью
        </button>
        <button
          type="button"
          onClick={() => setMode("join")}
          className={tabClass(mode === "join")}
        >
          Вступить по коду
        </button>
      </div>

      {mode === "create" ? (
        <label className="block text-sm font-medium">
          Название семьи
          <input
            name="familyName"
            required
            maxLength={60}
            className={inputClass}
          />
        </label>
      ) : (
        <>
          <label className="block text-sm font-medium">
            Код приглашения
            <input
              name="inviteCode"
              required
              maxLength={32}
              autoCapitalize="characters"
              className={`${inputClass} uppercase`}
            />
          </label>
          <label className="block text-sm font-medium">
            Роль
            <select name="role" defaultValue="adult" className={inputClass}>
              <option value="adult">Взрослый</option>
              <option value="child">Ребёнок</option>
            </select>
          </label>
        </>
      )}

      <label className="block text-sm font-medium">
        Ваше имя
        <input
          name="name"
          required
          maxLength={50}
          autoComplete="name"
          className={inputClass}
        />
      </label>
      <label className="block text-sm font-medium">
        Email
        <input
          name="email"
          type="email"
          required
          autoComplete="email"
          className={inputClass}
        />
      </label>
      <label className="block text-sm font-medium">
        Пароль (не короче 8 символов)
        <input
          name="password"
          type="password"
          required
          minLength={8}
          maxLength={72}
          autoComplete="new-password"
          className={inputClass}
        />
      </label>

      {state?.error && (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      )}
      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? "Подождите..." : "Зарегистрироваться"}
      </button>
    </form>
  );
}
