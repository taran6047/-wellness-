import type { ReactNode } from "react";
import type { FormState } from "@/app/actions/auth";
import { DeleteForm } from "@/components/delete-form";

function formatDate(date: Date) {
  return date.toLocaleDateString("ru-RU", { timeZone: "UTC" });
}

type Item = {
  id: string;
  authorId: string;
  authorName: string;
  date: Date;
  content: ReactNode;
};

// Список последних записей семьи; кнопка удаления только у своих записей
export function LogList({
  title,
  items,
  meId,
  deleteAction,
}: {
  title: string;
  items: Item[];
  meId: string;
  deleteAction: (formData: FormData) => Promise<FormState>;
}) {
  return (
    <div>
      <h2 className="text-xl font-semibold">{title}</h2>
      {items.length === 0 ? (
        <p className="mt-3 text-slate-600">Пока записей нет.</p>
      ) : (
        <ul className="mt-3 divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex items-start justify-between gap-2 px-4 py-3"
            >
              <div className="min-w-0">
                <p className="text-sm text-slate-600">
                  {item.authorName} · {formatDate(item.date)}
                </p>
                <div className="break-words">{item.content}</div>
              </div>
              {item.authorId === meId && (
                <DeleteForm
                  id={item.id}
                  action={deleteAction}
                  className="shrink-0 text-right"
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
