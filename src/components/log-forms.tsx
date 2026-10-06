"use client";

import {
  addActivityAction,
  addHealthAction,
  addMealAction,
  addWaterAction,
} from "@/app/actions/logs";
import { DateField, LogForm, NoteField } from "@/components/log-ui";
import { inputClass } from "@/components/styles";
import { ACTIVITY_TYPES, MEAL_TYPES, MOOD_LABELS } from "@/lib/validation";

type DateProps = { today: string; yesterday: string };

export function ActivityForm({ today, yesterday }: DateProps) {
  return (
    <LogForm title="Новая активность" action={addActivityAction}>
      <label className="block text-sm font-medium">
        Тип
        <select name="type" required defaultValue="" className={inputClass}>
          <option value="" disabled>
            Выберите...
          </option>
          {Object.entries(ACTIVITY_TYPES).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm font-medium">
          Длительность, минут
          <input
            name="durationMinutes"
            type="number"
            inputMode="numeric"
            min={1}
            max={1440}
            step={1}
            required
            className={inputClass}
          />
        </label>
        <label className="block text-sm font-medium">
          Расстояние, км (необязательно)
          <input
            name="distanceKm"
            type="number"
            inputMode="decimal"
            min={0.01}
            max={1000}
            step="any"
            className={inputClass}
          />
        </label>
      </div>
      <DateField today={today} yesterday={yesterday} />
      <NoteField />
    </LogForm>
  );
}

export function MealForm({ today, yesterday }: DateProps) {
  return (
    <LogForm title="Новый приём пищи" action={addMealAction}>
      <label className="block text-sm font-medium">
        Приём пищи
        <select name="mealType" required defaultValue="" className={inputClass}>
          <option value="" disabled>
            Выберите...
          </option>
          {Object.entries(MEAL_TYPES).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm font-medium">
        Что съедено
        <input
          name="description"
          type="text"
          required
          maxLength={500}
          className={inputClass}
        />
      </label>
      <DateField today={today} yesterday={yesterday} />
    </LogForm>
  );
}

export function WaterForm({ today, yesterday }: DateProps) {
  return (
    <LogForm title="Выпитая вода" action={addWaterAction}>
      <label className="block text-sm font-medium">
        Объём, мл
        <input
          name="amountMl"
          type="number"
          inputMode="numeric"
          min={1}
          max={5000}
          step={1}
          required
          className={inputClass}
        />
      </label>
      <DateField today={today} yesterday={yesterday} />
    </LogForm>
  );
}

export function HealthForm({ today, yesterday }: DateProps) {
  return (
    <LogForm title="Новая запись о здоровье" action={addHealthAction}>
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="block text-sm font-medium">
          Вес, кг
          <input
            name="weightKg"
            type="number"
            inputMode="decimal"
            min={2}
            max={500}
            step="any"
            className={inputClass}
          />
        </label>
        <label className="block text-sm font-medium">
          Сон, часов
          <input
            name="sleepHours"
            type="number"
            inputMode="decimal"
            min={0}
            max={24}
            step="any"
            className={inputClass}
          />
        </label>
        <label className="block text-sm font-medium">
          Самочувствие
          <select name="mood" defaultValue="" className={inputClass}>
            <option value="">Не указано</option>
            {Object.entries(MOOD_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {value} — {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="text-sm text-slate-500">
        Заполните хотя бы одно из полей: вес, сон или самочувствие.
      </p>
      <DateField today={today} yesterday={yesterday} />
      <NoteField />
    </LogForm>
  );
}
