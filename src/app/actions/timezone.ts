"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/require-user";
import { TIME_ZONE_CHANGE_INTERVAL_MS } from "@/lib/constants";
import { isSupportedTimeZone } from "@/lib/timezone";
import type { FormState } from "@/app/actions/auth";

const INVALID_ZONE_ERROR = "Выберите часовой пояс из списка";

// Пользователь меняет только свой часовой пояс, не чаще одного раза в 7 дней
export async function updateTimeZoneAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const me = await requireUser();
  const timeZone = formData.get("timeZone");
  if (!isSupportedTimeZone(timeZone)) return { error: INVALID_ZONE_ERROR };
  if (timeZone === me.timeZone) return { message: "Этот часовой пояс уже выбран" };

  const now = new Date();
  const cutoff = new Date(now.getTime() - TIME_ZONE_CHANGE_INTERVAL_MS);
  try {
    // Условие в самом запросе: две одновременные смены не пройдут обе
    const { count } = await prisma.user.updateMany({
      where: {
        id: me.id,
        OR: [{ timeZoneChangedAt: null }, { timeZoneChangedAt: { lte: cutoff } }],
      },
      data: { timeZone, timeZoneChangedAt: now },
    });
    if (count === 0) {
      const next = new Date(
        (me.timeZoneChangedAt ?? now).getTime() + TIME_ZONE_CHANGE_INTERVAL_MS,
      );
      return {
        error: `Часовой пояс можно менять не чаще одного раза в 7 дней. Следующая смена будет доступна ${next.toLocaleString("ru-RU", { timeZone: me.timeZone, dateStyle: "short", timeStyle: "short" })}`,
      };
    }
  } catch (e) {
    console.error("update time zone failed", e);
    return { error: "Что-то пошло не так. Попробуйте ещё раз" };
  }
  revalidatePath("/", "layout");
  return { message: "Часовой пояс сохранён" };
}
