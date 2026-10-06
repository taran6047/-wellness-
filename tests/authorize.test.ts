import bcrypt from "bcryptjs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  nextAuth: vi.fn(),
  findUnique: vi.fn(),
}));

vi.mock("next-auth", () => ({
  default: (config: unknown) => {
    m.nextAuth(config);
    return { handlers: {}, auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn() };
  },
}));
// Credentials(options) возвращает options, чтобы достать authorize
vi.mock("next-auth/providers/credentials", () => ({
  default: (options: unknown) => options,
}));
vi.mock("@/lib/db", () => ({ prisma: { user: { findUnique: m.findUnique } } }));

type Config = {
  session: { strategy: string };
  pages: { signIn: string };
  providers: { authorize: (raw: unknown) => Promise<unknown> }[];
  callbacks: {
    jwt: (a: { token: Record<string, unknown>; user?: { id?: string } }) => Record<string, unknown>;
    session: (a: { session: { user: Record<string, unknown> }; token: { sub?: string } }) => {
      user: Record<string, unknown>;
    };
  };
};

let config: Config;
let authorize: (raw: unknown) => Promise<unknown>;
const PASSWORD = "correct-password";
let passwordHash: string;

beforeEach(async () => {
  if (!config) {
    await import("@/auth");
    config = m.nextAuth.mock.calls[0][0] as Config;
    authorize = config.providers[0].authorize;
    passwordHash = bcrypt.hashSync(PASSWORD, 4);
  }
  m.findUnique.mockReset();
});

describe("auth: конфигурация", () => {
  it("JWT-сессии и страница входа /login", () => {
    expect(config.session.strategy).toBe("jwt");
    expect(config.pages.signIn).toBe("/login");
  });

  it("jwt-колбэк кладёт id пользователя в token.sub", () => {
    expect(config.callbacks.jwt({ token: {}, user: { id: "u1" } }).sub).toBe("u1");
    expect(config.callbacks.jwt({ token: { sub: "old" } }).sub).toBe("old");
  });

  it("session-колбэк копирует token.sub в session.user.id", () => {
    const s = config.callbacks.session({ session: { user: {} }, token: { sub: "u1" } });
    expect(s.user.id).toBe("u1");
    const s2 = config.callbacks.session({ session: { user: {} }, token: {} });
    expect(s2.user.id).toBeUndefined();
  });
});

describe("authorize", () => {
  it("возвращает пользователя при верном пароле, без passwordHash", async () => {
    m.findUnique.mockResolvedValue({ id: "u1", name: "Анна", email: "a@b.com", passwordHash });
    const r = await authorize({ email: " A@B.com ", password: PASSWORD });
    expect(r).toEqual({ id: "u1", name: "Анна", email: "a@b.com" });
    expect(m.findUnique).toHaveBeenCalledWith({ where: { email: "a@b.com" } });
  });

  it("неверный пароль: null", async () => {
    m.findUnique.mockResolvedValue({ id: "u1", name: "Анна", email: "a@b.com", passwordHash });
    expect(await authorize({ email: "a@b.com", password: "wrong-password" })).toBeNull();
  });

  it("несуществующий email: null (тот же результат, что и при неверном пароле)", async () => {
    m.findUnique.mockResolvedValue(null);
    expect(await authorize({ email: "none@b.com", password: PASSWORD })).toBeNull();
  });

  it("невалидные учётные данные: null без обращения к БД", async () => {
    expect(await authorize({ email: "a@b.com", password: "" })).toBeNull();
    expect(await authorize({})).toBeNull();
    expect(await authorize(undefined)).toBeNull();
    expect(m.findUnique).not.toHaveBeenCalled();
  });

  it("для несуществующего email всё равно вызывается bcrypt.compare (выравнивание времени)", async () => {
    m.findUnique.mockResolvedValue(null);
    const spy = vi.spyOn(bcrypt, "compare");
    await authorize({ email: "none@b.com", password: PASSWORD });
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
