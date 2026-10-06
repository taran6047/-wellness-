import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/require-user";
import { LoginForm } from "@/components/login-form";

export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/family");

  return (
    <section className="mx-auto max-w-md">
      <h1 className="mb-6 text-2xl font-bold">Вход</h1>
      <LoginForm />
      <p className="mt-6 text-sm text-slate-600">
        Нет аккаунта?{" "}
        <Link href="/register" className="text-emerald-700 underline">
          Зарегистрироваться
        </Link>
      </p>
    </section>
  );
}
