import Link from "next/link";
import { auth } from "@/auth";
import { logoutAction } from "@/app/actions/auth";

export async function Header() {
  const session = await auth();

  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
        <Link href="/" className="font-semibold">
          Family_Wellness
        </Link>
        <nav className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          {session?.user ? (
            <>
              <Link href="/family" className="hover:underline">
                Семья
              </Link>
              <Link href="/activity" className="hover:underline">
                Активность
              </Link>
              <Link href="/nutrition" className="hover:underline">
                Питание
              </Link>
              <Link href="/health" className="hover:underline">
                Здоровье
              </Link>
              <Link href="/progress" className="hover:underline">
                Прогресс
              </Link>
              <Link href="/goals" className="hover:underline">
                Цели
              </Link>
              <form action={logoutAction}>
                <button type="submit" className="hover:underline">
                  Выйти
                </button>
              </form>
            </>
          ) : (
            <>
              <Link href="/login" className="hover:underline">
                Войти
              </Link>
              <Link href="/register" className="hover:underline">
                Регистрация
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
