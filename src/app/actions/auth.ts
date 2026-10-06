"use server";

import bcrypt from "bcryptjs";
import { AuthError, CredentialsSignin } from "next-auth";
import { Prisma } from "@prisma/client";
import { signIn, signOut } from "@/auth";
import { BCRYPT_COST, LOGIN_LOCKED_ERROR } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { generateInviteCode } from "@/lib/invite-code";
import { loginSchema, registerSchema } from "@/lib/validation";

export type FormState = { error?: string; message?: string } | undefined;

const LOGIN_ERROR = "Неверный email или пароль";
const GENERIC_ERROR = "Что-то пошло не так. Попробуйте ещё раз";

export async function loginAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: LOGIN_ERROR };

  try {
    await signIn("credentials", {
      email: parsed.data.email,
      password: parsed.data.password,
      redirectTo: "/family",
    });
  } catch (e) {
    if (e instanceof CredentialsSignin && e.code === "locked") {
      return { error: LOGIN_LOCKED_ERROR };
    }
    if (e instanceof AuthError) return { error: LOGIN_ERROR };
    throw e; // redirect
  }
}

export async function registerAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = registerSchema.safeParse({
    mode: formData.get("mode"),
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
    familyName: formData.get("familyName"),
    role: formData.get("role"),
    inviteCode: formData.get("inviteCode"),
    timeZone: formData.get("timeZone"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? GENERIC_ERROR };
  }
  const data = parsed.data;
  const passwordHash = await bcrypt.hash(data.password, BCRYPT_COST);

  try {
    if (data.mode === "create") {
      await createFamilyWithUser(data, passwordHash);
    } else {
      const family = await prisma.family.findUnique({
        where: { inviteCode: data.inviteCode },
      });
      if (!family) return { error: "Семья с таким кодом не найдена" };
      await prisma.user.create({
        data: {
          familyId: family.id,
          name: data.name,
          email: data.email,
          passwordHash,
          role: data.role,
          timeZone: data.timeZone,
        },
      });
    }
  } catch (e) {
    if (isUniqueError(e, "email")) {
      return { error: "Этот email уже зарегистрирован" };
    }
    console.error("register failed", e);
    return { error: GENERIC_ERROR };
  }

  try {
    await signIn("credentials", {
      email: data.email,
      password: data.password,
      redirectTo: "/family",
    });
  } catch (e) {
    if (e instanceof AuthError) return { error: GENERIC_ERROR };
    throw e; // redirect
  }
}

function isUniqueError(e: unknown, field: string): boolean {
  return (
    e instanceof Prisma.PrismaClientKnownRequestError &&
    e.code === "P2002" &&
    String(e.meta?.target).includes(field)
  );
}

async function createFamilyWithUser(
  data: { name: string; email: string; familyName: string; timeZone: string },
  passwordHash: string,
) {
  // Повторяем при редкой коллизии кода приглашения
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await prisma.family.create({
        data: {
          name: data.familyName,
          inviteCode: generateInviteCode(),
          users: {
            create: {
              name: data.name,
              email: data.email,
              passwordHash,
              role: "adult",
              timeZone: data.timeZone,
            },
          },
        },
      });
      return;
    } catch (e) {
      if (!isUniqueError(e, "inviteCode")) throw e;
    }
  }
  throw new Error("Не удалось создать уникальный код приглашения");
}

export async function logoutAction() {
  await signOut({ redirectTo: "/login" });
}
