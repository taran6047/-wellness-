import { z } from "zod";
import {
  GOAL_METRIC_KEYS,
  MAX_GOAL_DAYS,
  MAX_GOAL_TARGET,
  goalPeriodDays,
} from "@/lib/goals";
import { DEFAULT_TIME_ZONE, isSupportedTimeZone } from "@/lib/timezone";

const email = z
  .string()
  .trim()
  .toLowerCase()
  .email("Введите корректный email")
  .max(254, "Email слишком длинный");

// bcrypt учитывает только первые 72 байта, поэтому считаем длину в байтах UTF-8
const MAX_PASSWORD_BYTES = 72;
const fitsPasswordBytes = (value: string) =>
  new TextEncoder().encode(value).length <= MAX_PASSWORD_BYTES;
const PASSWORD_TOO_LONG =
  "Пароль слишком длинный (максимум 72 байта; кириллица занимает по 2 байта)";

const password = z
  .string()
  .min(8, "Пароль должен быть не короче 8 символов")
  .refine(fitsPasswordBytes, PASSWORD_TOO_LONG);

// Неизвестный или пустой пояс заменяется на UTC
export const timeZoneSchema = z
  .unknown()
  .optional()
  .transform((v) => {
    const value = typeof v === "string" ? v.trim() : v;
    return isSupportedTimeZone(value) ? value : DEFAULT_TIME_ZONE;
  });

const name = z
  .string()
  .trim()
  .min(1, "Введите имя")
  .max(50, "Имя должно быть не длиннее 50 символов");

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().max(254),
  password: z.string().min(1).refine(fitsPasswordBytes, PASSWORD_TOO_LONG),
});

export const createFamilySchema = z.object({
  mode: z.literal("create"),
  name,
  email,
  password,
  timeZone: timeZoneSchema,
  familyName: z
    .string()
    .trim()
    .min(1, "Введите название семьи")
    .max(60, "Название семьи должно быть не длиннее 60 символов"),
});

export const joinFamilySchema = z.object({
  mode: z.literal("join"),
  name,
  email,
  password,
  timeZone: timeZoneSchema,
  role: z.enum(["adult", "child"], { message: "Выберите роль" }),
  inviteCode: z
    .string()
    .trim()
    .toUpperCase()
    .min(1, "Введите код приглашения")
    .max(32, "Неверный код приглашения"),
});

export const registerSchema = z.discriminatedUnion("mode", [
  createFamilySchema,
  joinFamilySchema,
]);

// ---------- Учёт: активность, питание, вода, здоровье ----------

export const ACTIVITY_TYPES = {
  walking: "Ходьба",
  running: "Бег",
  cycling: "Велосипед",
  swimming: "Плавание",
  strength: "Силовая",
  yoga: "Йога",
  games: "Игры",
  other: "Другое",
} as const;

export const MEAL_TYPES = {
  breakfast: "Завтрак",
  lunch: "Обед",
  dinner: "Ужин",
  snack: "Перекус",
} as const;

export const MOOD_LABELS = {
  1: "Очень плохо",
  2: "Плохо",
  3: "Нормально",
  4: "Хорошо",
  5: "Отлично",
} as const;

// Пустое поле формы = «не заполнено»; остальное приводим к числу
const optionalNumber = (schema: z.ZodType<number>) =>
  z.preprocess((v) => {
    if (v === null || v === undefined) return undefined;
    if (typeof v === "string") return v.trim() === "" ? undefined : Number(v);
    return v;
  }, schema.optional());

const requiredNumber = (schema: z.ZodType<number>) =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() !== "" ? Number(v) : v),
    schema,
  );

const optionalNote = z
  .string()
  .trim()
  .max(500, "Заметка должна быть не длиннее 500 символов")
  .optional()
  .transform((v) => (v ? v : undefined));

// Дата записи: YYYY-MM-DD (UTC-полночь). Что это «сегодня» или «вчера» в поясе
// пользователя, проверяет сервер по User.timeZone (isAllowedLogDate в actions/logs.ts)
const logDate = z
  .string({ message: "Укажите дату" })
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Укажите дату")
  .refine((v) => {
    // 2026-02-30 не должно превращаться в 2 марта
    const d = new Date(`${v}T00:00:00.000Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, "Укажите дату")
  .transform((v) => new Date(`${v}T00:00:00.000Z`));

export const activitySchema = z.object({
  type: z.enum(Object.keys(ACTIVITY_TYPES) as [string, ...string[]], {
    message: "Выберите тип активности",
  }),
  durationMinutes: requiredNumber(
    z
      .number({ message: "Укажите длительность в минутах" })
      .int("Минуты — целое число")
      .min(1, "Длительность: от 1 до 1440 минут")
      .max(1440, "Длительность: от 1 до 1440 минут"),
  ),
  distanceKm: optionalNumber(
    z
      .number()
      .min(0.01, "Расстояние: от 0.01 до 1000 км")
      .max(1000, "Расстояние: от 0.01 до 1000 км"),
  ),
  note: optionalNote,
  date: logDate,
});

export const mealSchema = z.object({
  mealType: z.enum(Object.keys(MEAL_TYPES) as [string, ...string[]], {
    message: "Выберите приём пищи",
  }),
  description: z
    .string({ message: "Опишите, что было съедено" })
    .trim()
    .min(1, "Опишите, что было съедено")
    .max(500, "Описание должно быть не длиннее 500 символов"),
  date: logDate,
});

export const waterSchema = z.object({
  amountMl: requiredNumber(
    z
      .number({ message: "Укажите объём в миллилитрах" })
      .int("Объём — целое число миллилитров")
      .min(1, "Объём: от 1 до 5000 мл")
      .max(5000, "Объём: от 1 до 5000 мл"),
  ),
  date: logDate,
});

export const healthSchema = z
  .object({
    weightKg: optionalNumber(
      z
        .number()
        .min(2, "Вес: от 2 до 500 кг")
        .max(500, "Вес: от 2 до 500 кг"),
    ),
    sleepHours: optionalNumber(
      z
        .number()
        .min(0, "Сон: от 0 до 24 часов")
        .max(24, "Сон: от 0 до 24 часов"),
    ),
    mood: optionalNumber(
      z
        .number()
        .int("Самочувствие: от 1 до 5")
        .min(1, "Самочувствие: от 1 до 5")
        .max(5, "Самочувствие: от 1 до 5"),
    ),
    note: optionalNote,
    date: logDate,
  })
  .refine(
    (d) =>
      d.weightKg !== undefined ||
      d.sleepHours !== undefined ||
      d.mood !== undefined,
    { message: "Заполните вес, сон или самочувствие" },
  );

export const recordIdSchema = z.string().min(1).max(64);

// ---------- Семейные цели ----------

export const goalSchema = z
  .object({
    title: z
      .string({ message: "Введите название цели" })
      .trim()
      .min(1, "Введите название цели")
      .max(100, "Название должно быть не длиннее 100 символов"),
    metric: z.enum(GOAL_METRIC_KEYS, { message: "Выберите метрику" }),
    targetValue: requiredNumber(
      z
        .number({ message: "Укажите целевое значение" })
        .positive("Целевое значение должно быть больше нуля")
        .max(
          MAX_GOAL_TARGET,
          `Целевое значение не больше ${MAX_GOAL_TARGET}`,
        ),
    ),
    startDate: logDate,
    endDate: logDate,
  })
  .superRefine((d, ctx) => {
    // если одна из дат не прошла проверку, здесь она ещё строка: ошибку уже вернули поля
    if (!(d.startDate instanceof Date) || !(d.endDate instanceof Date)) return;
    if (d.endDate.getTime() < d.startDate.getTime()) {
      ctx.addIssue({
        code: "custom",
        message: "Дата окончания не может быть раньше даты начала",
        path: ["endDate"],
      });
    } else if (goalPeriodDays(d.startDate, d.endDate) > MAX_GOAL_DAYS) {
      ctx.addIssue({
        code: "custom",
        message: `Период цели не длиннее ${MAX_GOAL_DAYS} дней`,
        path: ["endDate"],
      });
    }
  });
