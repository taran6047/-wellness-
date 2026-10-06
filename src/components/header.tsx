import Link from "next/link";
import { auth } from "@/auth";
import { logoutAction } from "@/app/actions/auth";

const navLink = "inline-flex min-h-11 items-center hover:underline";

export async function Header() {
  const session = await auth();

  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-x-4 px-4 py-1">
        <Link href="/" className="inline-flex min-h-11 items-center font-semibold">
          Family_Wellness
        </Link>
        <nav className="flex flex-wrap items-center gap-x-3 text-sm">
          {session?.user ? (
            <>
              <Link href="/family" className={navLink}>
                Семья
              </Link>
              <Link href="/activity" className={navLink}>
                Активность
              </Link>
              <Link href="/nutrition" className={navLink}>
                Питание
              </Link>
              <Link href="/health" className={navLink}>
                Здоровье
              </Link>
              <Link href="/progress" className={navLink}>
                Прогресс
              </Link>
              <Link href="/goals" className={navLink}>
                Цели
              </Link>
              <form action={logoutAction}>
                <button type="submit" className={navLink}>
                  Выйти
                </button>
              </form>
            </>
          ) : (
            <>
              <Link href="/login" className={navLink}>
                Войти
              </Link>
              <Link href="/register" className={navLink}>
                Регистрация
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
