"use client";

import { useState, useTransition } from "react";
import type { FormState } from "@/app/actions/auth";

// Кнопка «Удалить» с показом ошибки, если удалить не удалось
export function DeleteForm({
  id,
  action,
  className = "",
}: {
  id: string;
  action: (formData: FormData) => Promise<FormState>;
  className?: string;
}) {
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  function handleSubmit(formData: FormData) {
    setError(undefined);
    startTransition(async () => {
      try {
        const result = await action(formData);
        if (result?.error) setError(result.error);
      } catch {
        setError("Не удалось удалить. Проверьте соединение и попробуйте ещё раз");
      }
    });
  }

  return (
    <form action={handleSubmit} className={className}>
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        disabled={pending}
        className="inline-flex min-h-11 items-center px-2 text-sm text-red-600 hover:underline disabled:opacity-60"
      >
        {pending ? "Удаляем..." : "Удалить"}
      </button>
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
    </form>
  );
}
