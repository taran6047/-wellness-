"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/require-user";
import { timeZoneSchema } from "@/lib/validation";
import type { FormState } from "@/app/actions/auth";

// Пользователь меняет только свой часовой пояс
export async function updateTimeZoneAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const me = await requireUser();
  const timeZone = timeZoneSchema.parse(formData.get("timeZone"));
  try {
    await prisma.user.update({ where: { id: me.id }, data: { timeZone } });
  } catch (e) {
    console.error("update time zone failed", e);
    return { error: "Что-то пошло не так. Попробуйте ещё раз" };
  }
  revalidatePath("/", "layout");
  return { message: "Часовой пояс сохранён" };
}
