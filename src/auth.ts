import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { BCRYPT_COST } from "@/lib/constants";
import { prisma } from "@/lib/db";
import {
  clearFailedLogins,
  isLocked,
  recordFailedLogin,
} from "@/lib/login-throttle";
import { loginSchema } from "@/lib/validation";

// Хеш-заглушка: сравниваем с ней, если email не найден, чтобы время ответа не выдавало существование email
const DUMMY_HASH = bcrypt.hashSync("dummy-password-for-timing", BCRYPT_COST);

// Ошибка блокировки: loginAction по коду показывает отдельное сообщение
export class LoginLockedError extends CredentialsSignin {
  code = "locked";
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  // Нужно за прокси (Vercel и т.п.); адрес сайта задаёт AUTH_URL
  trustHost: true,
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Пароль", type: "password" },
      },
      async authorize(raw) {
        const parsed = loginSchema.safeParse(raw);
        if (!parsed.success) return null;
        const { email, password } = parsed.data;

        // Состояние блокировки и пользователь читаются одновременно; bcrypt выполняется всегда,
        // поэтому время ответа не зависит от существования email и от блокировки
        const [attempt, user] = await Promise.all([
          prisma.loginAttempt.findUnique({ where: { email } }),
          prisma.user.findUnique({ where: { email } }),
        ]);
        const ok = await bcrypt.compare(
          password,
          user?.passwordHash ?? DUMMY_HASH,
        );

        // Одинаковая реакция для существующих и несуществующих email
        if (isLocked(attempt)) throw new LoginLockedError();

        if (!user || !ok) {
          await recordFailedLogin(email, attempt);
          return null;
        }
        if (attempt) await clearFailedLogins(email);

        return { id: user.id, name: user.name, email: user.email };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user?.id) token.sub = user.id;
      return token;
    },
    session({ session, token }) {
      if (token.sub) session.user.id = token.sub;
      return session;
    },
  },
});
