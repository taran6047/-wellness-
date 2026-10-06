"use server";

import { revalidatePath } from "next/cache";
import { MAX_FAMILY_GOALS } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/require-user";
import { goalSchema, recordIdSchema } from "@/lib/validation";
import type { FormState } from "@/app/actions/auth";

const GENERIC_ERROR = "Что-то пошло не так. Попробуйте ещё раз";
const ADULT_ONLY_ERROR = "Цели могут создавать и удалять только взрослые";

function field(formData: FormData, name: string) {
  const v = formData.get(name);
  return typeof v === "string" ? v : undefined;
}

export async function createGoalAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const me = await requireUser();
  if (me.role !== "adult") return { error: ADULT_ONLY_ERROR };

  const parsed = goalSchema.safeParse({
    title: field(formData, "title"),
    metric: field(formData, "metric"),
    targetValue: field(formData, "targetValue"),
    startDate: field(formData, "startDate"),
    endDate: field(formData, "endDate"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? GENERIC_ERROR };
  }

  try {
    const count = await prisma.familyGoal.count({
      where: { familyId: me.familyId },
    });
    if (count >= MAX_FAMILY_GOALS) {
      return {
        error: `Достигнут лимит: не более ${MAX_FAMILY_GOALS} целей на семью. Удалите ненужные цели`,
      };
    }
    await prisma.familyGoal.create({
      data: { familyId: me.familyId, ...parsed.data },
    });
  } catch (e) {
    console.error("create goal failed", e);
    return { error: GENERIC_ERROR };
  }
  revalidatePath("/goals");
  revalidatePath("/");
  return { message: "Цель создана" };
}

// Удаляется только цель семьи текущего пользователя
export async function deleteGoalAction(
  formData: FormData,
): Promise<FormState> {
  const me = await requireUser();
  if (me.role !== "adult") return;
  const id = recordIdSchema.safeParse(formData.get("id"));
  if (!id.success) return;
  try {
    await prisma.familyGoal.deleteMany({
      where: { id: id.data, familyId: me.familyId },
    });
  } catch (e) {
    console.error("delete goal failed", e);
    return { error: "Не удалось удалить цель. Попробуйте ещё раз" };
  }
  revalidatePath("/goals");
  revalidatePath("/");
}
