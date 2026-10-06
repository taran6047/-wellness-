import { describe, expect, it, vi } from "vitest";
import {
  ACTIVITY_TYPES,
  MEAL_TYPES,
  MOOD_LABELS,
  activitySchema,
  healthSchema,
  mealSchema,
  recordIdSchema,
  waterSchema,
} from "@/lib/validation";

const DAY = 24 * 60 * 60 * 1000;
const isoDay = (offsetDays: number) =>
  new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 10);
const TODAY = isoDay(0);

const firstMessage = (r: { success: boolean; error?: { issues: { message: string }[] } }) =>
  r.error?.issues[0]?.message;

describe("справочники", () => {
  it("типы активности, приёмы пищи и самочувствие содержат ожидаемые ключи", () => {
    expect(Object.keys(ACTIVITY_TYPES)).toEqual([
      "walking",
      "running",
      "cycling",
      "swimming",
      "strength",
      "yoga",
      "games",
      "other",
    ]);
    expect(Object.keys(MEAL_TYPES)).toEqual(["breakfast", "lunch", "dinner", "snack"]);
    expect(Object.keys(MOOD_LABELS)).toEqual(["1", "2", "3", "4", "5"]);
    expect(MOOD_LABELS[5]).toBe("Отлично");
  });
});

describe("activitySchema", () => {
  const valid = { type: "running", durationMinutes: "30", distanceKm: "5.5", note: "утро", date: TODAY };

  it("принимает корректные данные и приводит строки к числам, дату к Date", () => {
    const r = activitySchema.safeParse(valid);
    expect(r.success).toBe(true);
    expect(r.data).toEqual({
      type: "running",
      durationMinutes: 30,
      distanceKm: 5.5,
      note: "утро",
      date: new Date(`${TODAY}T00:00:00.000Z`),
    });
  });

  it.each(Object.keys(ACTIVITY_TYPES))("допустимый тип %s", (type) => {
    expect(activitySchema.safeParse({ ...valid, type }).success).toBe(true);
  });

  it.each(["", "flying", "RUNNING", undefined])("недопустимый тип %j", (type) => {
    const r = activitySchema.safeParse({ ...valid, type });
    expect(r.success).toBe(false);
    expect(firstMessage(r)).toBe("Выберите тип активности");
  });

  it.each([["1"], ["1440"], [1], [1440]])("минуты %j допустимы", (v) => {
    expect(activitySchema.safeParse({ ...valid, durationMinutes: v }).success).toBe(true);
  });

  it.each([["0"], ["1441"], ["-5"], ["1.5"], ["abc"]])("минуты %j недопустимы", (v) => {
    expect(activitySchema.safeParse({ ...valid, durationMinutes: v }).success).toBe(false);
  });

  it.each([[""], [undefined], [null]])("минуты обязательны: %j", (v) => {
    const r = activitySchema.safeParse({ ...valid, durationMinutes: v });
    expect(r.success).toBe(false);
    expect(firstMessage(r)).toBe("Укажите длительность в минутах");
  });

  it.each([["0.01"], ["1000"], ["12.345"]])("расстояние %j допустимо", (v) => {
    expect(activitySchema.safeParse({ ...valid, distanceKm: v }).success).toBe(true);
  });

  it.each([["0"], ["0.009"], ["1000.01"], ["-1"], ["abc"]])("расстояние %j недопустимо", (v) => {
    expect(activitySchema.safeParse({ ...valid, distanceKm: v }).success).toBe(false);
  });

  it.each([[""], ["   "], [undefined], [null]])("пустое расстояние %j = не заполнено", (v) => {
    const r = activitySchema.safeParse({ ...valid, distanceKm: v });
    expect(r.success).toBe(true);
    expect(r.data?.distanceKm).toBeUndefined();
  });
});

describe("заметка (на примере activitySchema)", () => {
  const base = { type: "yoga", durationMinutes: "10", date: TODAY };

  it("ровно 500 символов допустимо", () => {
    expect(activitySchema.safeParse({ ...base, note: "а".repeat(500) }).success).toBe(true);
  });

  it("501 символ отклоняется с русским сообщением", () => {
    const r = activitySchema.safeParse({ ...base, note: "а".repeat(501) });
    expect(r.success).toBe(false);
    expect(firstMessage(r)).toBe("Заметка должна быть не длиннее 500 символов");
  });

  it("пробелы обрезаются; пустая или пробельная заметка становится undefined", () => {
    expect(activitySchema.parse({ ...base, note: "  привет  " }).note).toBe("привет");
    expect(activitySchema.parse({ ...base, note: "   " }).note).toBeUndefined();
    expect(activitySchema.parse({ ...base, note: "" }).note).toBeUndefined();
    expect(activitySchema.parse(base).note).toBeUndefined();
  });
});

describe("дата записи", () => {
  const base = { amountMl: "200" };

  // Окно «сегодня/вчера» схема больше не проверяет — это делает isAllowedLogDate в экшене
  it.each([-365, -30, -3, -2, -1, 0, 1, 2, 365])(
    "реальная дата со смещением %j дн. проходит схему (окно не проверяется)",
    (offset) => {
      const date = isoDay(offset);
      const r = waterSchema.safeParse({ ...base, date });
      expect(r.success).toBe(true);
      expect(r.data?.date).toEqual(new Date(`${date}T00:00:00.000Z`));
    },
  );

  it("разбор не зависит от текущего времени", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2030-01-01T00:00:00.000Z"));
      expect(waterSchema.safeParse({ ...base, date: "2026-10-05" }).success).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("дата во всех схемах превращается в UTC-полночь", () => {
    const expected = new Date("2026-10-05T00:00:00.000Z");
    expect(activitySchema.parse({ type: "yoga", durationMinutes: "10", date: "2026-10-05" }).date).toEqual(expected);
    expect(mealSchema.parse({ mealType: "lunch", description: "суп", date: "2026-10-05" }).date).toEqual(expected);
    expect(healthSchema.parse({ mood: "3", date: "2026-10-05" }).date).toEqual(expected);
  });

  it("високосный день 2028-02-29 реален, 2027-02-29 нет", () => {
    expect(waterSchema.safeParse({ ...base, date: "2028-02-29" }).success).toBe(true);
    expect(waterSchema.safeParse({ ...base, date: "2027-02-29" }).success).toBe(false);
  });

  it.each(["", "2026-1-5", "05.10.2026", "2026-10-05T10:00:00Z", "2026-13-01", "2026-02-30", "abc"])(
    "неверный формат/дата %j",
    (date) => {
      const r = waterSchema.safeParse({ ...base, date });
      expect(r.success).toBe(false);
      expect(firstMessage(r)).toBe("Укажите дату");
    },
  );

  it("отсутствующая дата", () => {
    const r = waterSchema.safeParse(base);
    expect(r.success).toBe(false);
    expect(firstMessage(r)).toBe("Укажите дату");
  });
});

describe("mealSchema", () => {
  const valid = { mealType: "lunch", description: "Суп и хлеб", date: TODAY };

  it("принимает корректные данные", () => {
    const r = mealSchema.safeParse(valid);
    expect(r.success).toBe(true);
    expect(r.data?.description).toBe("Суп и хлеб");
  });

  it.each(Object.keys(MEAL_TYPES))("допустимый приём пищи %s", (mealType) => {
    expect(mealSchema.safeParse({ ...valid, mealType }).success).toBe(true);
  });

  it.each(["", "brunch", "Lunch", undefined])("недопустимый приём пищи %j", (mealType) => {
    const r = mealSchema.safeParse({ ...valid, mealType });
    expect(r.success).toBe(false);
    expect(firstMessage(r)).toBe("Выберите приём пищи");
  });

  it.each(["", "   ", undefined])("пустое описание %j", (description) => {
    const r = mealSchema.safeParse({ ...valid, description });
    expect(r.success).toBe(false);
    expect(firstMessage(r)).toBe("Опишите, что было съедено");
  });

  it("описание до 500 символов допустимо, 501 нет; пробелы обрезаются", () => {
    expect(mealSchema.safeParse({ ...valid, description: "а".repeat(500) }).success).toBe(true);
    const r = mealSchema.safeParse({ ...valid, description: "а".repeat(501) });
    expect(r.success).toBe(false);
    expect(firstMessage(r)).toBe("Описание должно быть не длиннее 500 символов");
    expect(mealSchema.parse({ ...valid, description: "  каша " }).description).toBe("каша");
  });
});

describe("waterSchema", () => {
  it.each([["1"], ["5000"], [250]])("объём %j допустим", (v) => {
    const r = waterSchema.safeParse({ amountMl: v, date: TODAY });
    expect(r.success).toBe(true);
    expect(r.data?.amountMl).toBe(Number(v));
  });

  it.each([["0"], ["5001"], ["-10"], ["250.5"], ["abc"]])("объём %j недопустим", (v) => {
    expect(waterSchema.safeParse({ amountMl: v, date: TODAY }).success).toBe(false);
  });

  it.each([[""], [undefined]])("объём обязателен: %j", (v) => {
    const r = waterSchema.safeParse({ amountMl: v, date: TODAY });
    expect(r.success).toBe(false);
    expect(firstMessage(r)).toBe("Укажите объём в миллилитрах");
  });
});

describe("healthSchema", () => {
  const d = { date: TODAY };

  it("принимает все три поля и приводит к числам", () => {
    const r = healthSchema.safeParse({ weightKg: "65.5", sleepHours: "7.5", mood: "4", ...d });
    expect(r.success).toBe(true);
    expect(r.data).toMatchObject({ weightKg: 65.5, sleepHours: 7.5, mood: 4 });
  });

  it.each([
    ["только вес", { weightKg: "70" }],
    ["только сон", { sleepHours: "8" }],
    ["только самочувствие", { mood: "3" }],
  ])("достаточно одного поля: %s", (_t, fields) => {
    expect(healthSchema.safeParse({ ...fields, ...d }).success).toBe(true);
  });

  it("сон 0 считается заполненным", () => {
    const r = healthSchema.safeParse({ sleepHours: "0", ...d });
    expect(r.success).toBe(true);
    expect(r.data?.sleepHours).toBe(0);
  });

  it("без вес/сон/самочувствие — ошибка; заметка не считается", () => {
    const r = healthSchema.safeParse({ note: "просто так", ...d });
    expect(r.success).toBe(false);
    expect(firstMessage(r)).toBe("Заполните вес, сон или самочувствие");
  });

  it("все числовые поля пустыми строками — ошибка «заполните»", () => {
    const r = healthSchema.safeParse({ weightKg: "", sleepHours: " ", mood: "", ...d });
    expect(r.success).toBe(false);
    expect(firstMessage(r)).toBe("Заполните вес, сон или самочувствие");
  });

  it.each([["2"], ["500"]])("вес %j допустим", (v) => {
    expect(healthSchema.safeParse({ weightKg: v, ...d }).success).toBe(true);
  });
  it.each([["1.99"], ["500.1"], ["0"], ["-3"]])("вес %j недопустим", (v) => {
    const r = healthSchema.safeParse({ weightKg: v, ...d });
    expect(r.success).toBe(false);
    expect(firstMessage(r)).toBe("Вес: от 2 до 500 кг");
  });

  it.each([["0"], ["24"], ["7.25"]])("сон %j допустим", (v) => {
    expect(healthSchema.safeParse({ sleepHours: v, ...d }).success).toBe(true);
  });
  it.each([["-0.1"], ["24.1"]])("сон %j недопустим", (v) => {
    const r = healthSchema.safeParse({ sleepHours: v, ...d });
    expect(r.success).toBe(false);
    expect(firstMessage(r)).toBe("Сон: от 0 до 24 часов");
  });

  it.each([["1"], ["5"]])("самочувствие %j допустимо", (v) => {
    expect(healthSchema.safeParse({ mood: v, ...d }).success).toBe(true);
  });
  it.each([["0"], ["6"], ["3.5"], ["-1"]])("самочувствие %j недопустимо", (v) => {
    const r = healthSchema.safeParse({ mood: v, ...d });
    expect(r.success).toBe(false);
    expect(firstMessage(r)).toBe("Самочувствие: от 1 до 5");
  });

  it("заметка более 500 символов отклоняется", () => {
    const r = healthSchema.safeParse({ mood: "3", note: "x".repeat(501), ...d });
    expect(r.success).toBe(false);
  });

  it("неверная дата отклоняется", () => {
    expect(healthSchema.safeParse({ mood: "3", date: "вчера" }).success).toBe(false);
  });
});

describe("recordIdSchema", () => {
  it("принимает строку 1–64 символа", () => {
    expect(recordIdSchema.safeParse("a").success).toBe(true);
    expect(recordIdSchema.safeParse("a".repeat(64)).success).toBe(true);
  });

  it.each(["", "a".repeat(65), null, undefined, 5])("отклоняет %j", (v) => {
    expect(recordIdSchema.safeParse(v).success).toBe(false);
  });
});
