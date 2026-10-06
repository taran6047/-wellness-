import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

// Пользователь из сессии, который реально есть в БД (иначе null)
export async function getCurrentUser() {
  const session = await auth();
  if (!session?.user?.id) return null;

  return prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      familyId: true,
      name: true,
      role: true,
      timeZone: true,
      timeZoneChangedAt: true,
      family: {
        select: {
          name: true,
          inviteCode: true,
          users: {
            select: { id: true, name: true, role: true },
            orderBy: { createdAt: "asc" },
          },
        },
      },
    },
  });
}

// Для защищённых страниц: нет сессии или пользователя в БД — на /login.
// /login редиректит на /family только если пользователь найден в БД, поэтому цикла нет.
export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}
