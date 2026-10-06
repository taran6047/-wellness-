"use server";

import { revalidatePath } from "next/cache";
import { savedMessage } from "@/lib/gamification";
import { requireUser } from "@/lib/require-user";
import {
  type CreateResult,
  createActivityLog,
  createHealthLog,
  createMealLog,
  createWaterLog,
  deleteOwnActivityLog,
  deleteOwnHealthLog,
  deleteOwnMealLog,
  deleteOwnWaterLog,
} from "@/lib/logs";
import {
  activitySchema,
  healthSchema,
  mealSchema,
  recordIdSchema,
  waterSchema,
} from "@/lib/validation";
import { DATE_WINDOW_ERROR, isAllowedLogDate } from "@/lib/timezone";
import type { FormState } from "@/app/actions/auth";

const GENERIC_ERROR = "Что-то пошло не так. Попробуйте ещё раз";

function saved(result: CreateResult): FormState {
  let message = savedMessage(result.points);
  if (result.newAchievements.length > 0) {
    message += `. Новое достижение: ${result.newAchievements.join(", ")}`;
  }
  return { message };
}

function firstError(error: { issues: { message: string }[] }): FormState {
  return { error: error.issues[0]?.message ?? GENERIC_ERROR };
}

function field(formData: FormData, name: string) {
  const v = formData.get(name);
  return typeof v === "string" ? v : undefined;
}

export async function addActivityAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const me = await requireUser();
  const parsed = activitySchema.safeParse({
    type: field(formData, "type"),
    durationMinutes: field(formData, "durationMinutes"),
    distanceKm: field(formData, "distanceKm"),
    note: field(formData, "note"),
    date: field(formData, "date"),
  });
  if (!parsed.success) return firstError(parsed.error);
  if (!isAllowedLogDate(parsed.data.date, me.timeZone)) {
    return { error: DATE_WINDOW_ERROR };
  }

  let result: CreateResult;
  try {
    result = await createActivityLog(me.id, parsed.data);
  } catch (e) {
    console.error("add activity failed", e);
    return { error: GENERIC_ERROR };
  }
  revalidatePath("/activity");
  revalidatePath("/progress");
  return saved(result);
}

export async function addMealAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const me = await requireUser();
  const parsed = mealSchema.safeParse({
    mealType: field(formData, "mealType"),
    description: field(formData, "description"),
    date: field(formData, "date"),
  });
  if (!parsed.success) return firstError(parsed.error);
  if (!isAllowedLogDate(parsed.data.date, me.timeZone)) {
    return { error: DATE_WINDOW_ERROR };
  }

  let result: CreateResult;
  try {
    result = await createMealLog(me.id, parsed.data);
  } catch (e) {
    console.error("add meal failed", e);
    return { error: GENERIC_ERROR };
  }
  revalidatePath("/nutrition");
  revalidatePath("/progress");
  return saved(result);
}

export async function addWaterAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const me = await requireUser();
  const parsed = waterSchema.safeParse({
    amountMl: field(formData, "amountMl"),
    date: field(formData, "date"),
  });
  if (!parsed.success) return firstError(parsed.error);
  if (!isAllowedLogDate(parsed.data.date, me.timeZone)) {
    return { error: DATE_WINDOW_ERROR };
  }

  let result: CreateResult;
  try {
    result = await createWaterLog(me.id, parsed.data);
  } catch (e) {
    console.error("add water failed", e);
    return { error: GENERIC_ERROR };
  }
  revalidatePath("/nutrition");
  revalidatePath("/progress");
  return saved(result);
}

export async function addHealthAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const me = await requireUser();
  const parsed = healthSchema.safeParse({
    weightKg: field(formData, "weightKg"),
    sleepHours: field(formData, "sleepHours"),
    mood: field(formData, "mood"),
    note: field(formData, "note"),
    date: field(formData, "date"),
  });
  if (!parsed.success) return firstError(parsed.error);
  if (!isAllowedLogDate(parsed.data.date, me.timeZone)) {
    return { error: DATE_WINDOW_ERROR };
  }

  let result: CreateResult;
  try {
    result = await createHealthLog(me.id, parsed.data);
  } catch (e) {
    console.error("add health failed", e);
    return { error: GENERIC_ERROR };
  }
  revalidatePath("/health");
  revalidatePath("/progress");
  return saved(result);
}

// Удаление: id берём из формы, но удаляется только запись текущего пользователя
async function deleteRecord(
  formData: FormData,
  remove: (userId: string, id: string) => Promise<void>,
  path: string,
) {
  const me = await requireUser();
  const id = recordIdSchema.safeParse(formData.get("id"));
  if (!id.success) return;
  await remove(me.id, id.data);
  revalidatePath(path);
  revalidatePath("/progress");
}

export async function deleteActivityAction(formData: FormData) {
  await deleteRecord(formData, deleteOwnActivityLog, "/activity");
}

export async function deleteMealAction(formData: FormData) {
  await deleteRecord(formData, deleteOwnMealLog, "/nutrition");
}

export async function deleteWaterAction(formData: FormData) {
  await deleteRecord(formData, deleteOwnWaterLog, "/nutrition");
}

export async function deleteHealthAction(formData: FormData) {
  await deleteRecord(formData, deleteOwnHealthLog, "/health");
}
