"use client";

import { createGoalAction } from "@/app/actions/goals";
import { LogForm } from "@/components/log-ui";
import { inputClass } from "@/components/styles";
import { GOAL_METRICS, MAX_GOAL_TARGET } from "@/lib/goals";

export function GoalForm({ today }: { today: string }) {
  return (
    <LogForm title="Новая цель" action={createGoalAction}>
      <label className="block text-sm font-medium">
        Название
        <input
          name="title"
          type="text"
          required
          maxLength={100}
          className={inputClass}
        />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm font-medium">
          Метрика
          <select name="metric" required defaultValue="" className={inputClass}>
            <option value="" disabled>
              Выберите...
            </option>
            {Object.entries(GOAL_METRICS).map(([value, m]) => (
              <option key={value} value={value}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-medium">
          Целевое значение
          <input
            name="targetValue"
            type="number"
            inputMode="decimal"
            min={0.01}
            max={MAX_GOAL_TARGET}
            step="any"
            required
            className={inputClass}
          />
        </label>
        <label className="block text-sm font-medium">
          Начало
          <input
            name="startDate"
            type="date"
            required
            defaultValue={today}
            className={inputClass}
          />
        </label>
        <label className="block text-sm font-medium">
          Окончание
          <input
            name="endDate"
            type="date"
            required
            defaultValue={today}
            className={inputClass}
          />
        </label>
      </div>
      <p className="text-sm text-slate-500">
        Период цели — не длиннее 366 дней.
      </p>
    </LogForm>
  );
}
