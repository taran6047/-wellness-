import bcrypt from "bcryptjs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => {
  // Как в next-auth: CredentialsSignin наследует AuthError и несёт code
  class AuthError extends Error {}
  class CredentialsSignin extends AuthError {
    code = "credentials";
  }
  return {
    AuthError,
    CredentialsSignin,
    nextAuth: vi.fn(),
    userFindUnique: vi.fn(),
    attemptFindUnique: vi.fn(),
    isLocked: vi.fn(),
    recordFailedLogin: vi.fn(),
    clearFailedLogins: vi.fn(),
  };
});

vi.mock("next-auth", () => ({
  default: (config: unknown) => {
    m.nextAuth(config);
    return { handlers: {}, auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn() };
  },
  CredentialsSignin: m.CredentialsSignin,
}));
// Credentials(options) возвращает options, чтобы достать authorize
vi.mock("next-auth/providers/credentials", () => ({
  default: (options: unknown) => options,
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    user: { findUnique: m.userFindUnique },
    loginAttempt: { findUnique: m.attemptFindUnique },
  },
}));
vi.mock("@/lib/login-throttle", () => ({
  isLocked: m.isLocked,
  recordFailedLogin: m.recordFailedLogin,
  clearFailedLogins: m.clearFailedLogins,
}));

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
let LoginLockedError: new () => Error & { code: string };
const PASSWORD = "correct-password";
let passwordHash: string;

const attemptRow = {
  failedCount: 2,
  windowStart: new Date("2026-10-06T12:00:00.000Z"),
  lockedUntil: null,
};

beforeEach(async () => {
  if (!config) {
    const mod = await import("@/auth");
    LoginLockedError = mod.LoginLockedError as unknown as typeof LoginLockedError;
    config = m.nextAuth.mock.calls[0][0] as Config;
    authorize = config.providers[0].authorize;
    passwordHash = bcrypt.hashSync(PASSWORD, 4);
  }
  m.userFindUnique.mockReset();
  m.attemptFindUnique.mockReset();
  m.isLocked.mockReset();
  m.recordFailedLogin.mockReset();
  m.clearFailedLogins.mockReset();
  m.attemptFindUnique.mockResolvedValue(null);
  m.isLocked.mockReturnValue(false);
  m.recordFailedLogin.mockResolvedValue(undefined);
  m.clearFailedLogins.mockResolvedValue(undefined);
});

const existingUser = () => ({ id: "u1", name: "Анна", email: "a@b.com", passwordHash });

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

describe("LoginLockedError", () => {
  it("наследует CredentialsSignin и несёт код locked", () => {
    const e = new LoginLockedError();
    expect(e).toBeInstanceOf(m.CredentialsSignin);
    expect(e).toBeInstanceOf(m.AuthError);
    expect(e.code).toBe("locked");
  });
});

describe("authorize", () => {
  it("возвращает пользователя при верном пароле, без passwordHash", async () => {
    m.userFindUnique.mockResolvedValue(existingUser());
    const r = await authorize({ email: " A@B.com ", password: PASSWORD });
    expect(r).toEqual({ id: "u1", name: "Анна", email: "a@b.com" });
    expect(m.userFindUnique).toHaveBeenCalledWith({ where: { email: "a@b.com" } });
    expect(m.attemptFindUnique).toHaveBeenCalledWith({ where: { email: "a@b.com" } });
  });

  it("верный пароль без записи о неудачах: счётчик не трогается", async () => {
    m.userFindUnique.mockResolvedValue(existingUser());
    await authorize({ email: "a@b.com", password: PASSWORD });
    expect(m.clearFailedLogins).not.toHaveBeenCalled();
    expect(m.recordFailedLogin).not.toHaveBeenCalled();
  });

  it("верный пароль при накопленных неудачах (не заблокирован): счётчик сбрасывается", async () => {
    m.attemptFindUnique.mockResolvedValue(attemptRow);
    m.userFindUnique.mockResolvedValue(existingUser());
    const r = await authorize({ email: "a@b.com", password: PASSWORD });
    expect(r).toMatchObject({ id: "u1" });
    expect(m.clearFailedLogins).toHaveBeenCalledWith("a@b.com");
    expect(m.recordFailedLogin).not.toHaveBeenCalled();
  });

  it("неверный пароль: null и учёт неудачи с текущим состоянием попыток", async () => {
    m.attemptFindUnique.mockResolvedValue(attemptRow);
    m.userFindUnique.mockResolvedValue(existingUser());
    expect(await authorize({ email: "a@b.com", password: "wrong-password" })).toBeNull();
    expect(m.recordFailedLogin).toHaveBeenCalledTimes(1);
    expect(m.recordFailedLogin).toHaveBeenCalledWith("a@b.com", attemptRow);
    expect(m.clearFailedLogins).not.toHaveBeenCalled();
  });

  it("несуществующий email: null (как при неверном пароле) и тоже учёт неудачи", async () => {
    m.userFindUnique.mockResolvedValue(null);
    expect(await authorize({ email: "none@b.com", password: PASSWORD })).toBeNull();
    expect(m.recordFailedLogin).toHaveBeenCalledTimes(1);
    expect(m.recordFailedLogin).toHaveBeenCalledWith("none@b.com", null);
  });

  it("невалидные учётные данные: null без обращения к БД и к счётчику", async () => {
    expect(await authorize({ email: "a@b.com", password: "" })).toBeNull();
    expect(await authorize({})).toBeNull();
    expect(await authorize(undefined)).toBeNull();
    expect(m.userFindUnique).not.toHaveBeenCalled();
    expect(m.attemptFindUnique).not.toHaveBeenCalled();
    expect(m.recordFailedLogin).not.toHaveBeenCalled();
  });

  it("состояние блокировки проверяется по записи попыток из БД", async () => {
    m.attemptFindUnique.mockResolvedValue(attemptRow);
    m.userFindUnique.mockResolvedValue(existingUser());
    await authorize({ email: "a@b.com", password: PASSWORD });
    expect(m.isLocked).toHaveBeenCalledWith(attemptRow);
  });
});

describe("authorize: блокировка", () => {
  const locked = { failedCount: 5, windowStart: new Date(), lockedUntil: new Date(Date.now() + 60_000) };

  beforeEach(() => {
    m.attemptFindUnique.mockResolvedValue(locked);
    m.isLocked.mockReturnValue(true);
  });

  it("заблокированный email с верным паролем: бросает LoginLockedError с кодом locked", async () => {
    m.userFindUnique.mockResolvedValue(existingUser());
    const err = await authorize({ email: "a@b.com", password: PASSWORD }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LoginLockedError);
    expect(err).toBeInstanceOf(m.CredentialsSignin);
    expect((err as { code: string }).code).toBe("locked");
  });

  it("заблокированный email с неверным паролем: та же ошибка", async () => {
    m.userFindUnique.mockResolvedValue(existingUser());
    await expect(authorize({ email: "a@b.com", password: "wrong-password" })).rejects.toBeInstanceOf(
      LoginLockedError,
    );
  });

  it("несуществующий email в блокировке: та же ошибка (реакция не выдаёт существование email)", async () => {
    m.userFindUnique.mockResolvedValue(null);
    const err = await authorize({ email: "none@b.com", password: PASSWORD }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LoginLockedError);
    expect((err as { code: string }).code).toBe("locked");
  });

  it("при блокировке неудача не записывается (блокировка не продлевается) и счётчик не сбрасывается", async () => {
    m.userFindUnique.mockResolvedValue(existingUser());
    await authorize({ email: "a@b.com", password: PASSWORD }).catch(() => {});
    await authorize({ email: "a@b.com", password: "wrong-password" }).catch(() => {});
    expect(m.recordFailedLogin).not.toHaveBeenCalled();
    expect(m.clearFailedLogins).not.toHaveBeenCalled();
  });
});

describe("authorize: bcrypt.compare выполняется всегда (выравнивание времени)", () => {
  it("для несуществующего email сравнение идёт с хешем-заглушкой", async () => {
    m.userFindUnique.mockResolvedValue(null);
    const spy = vi.spyOn(bcrypt, "compare");
    await authorize({ email: "none@b.com", password: PASSWORD });
    expect(spy).toHaveBeenCalledTimes(1);
    const hashUsed = spy.mock.calls[0][1] as string;
    expect(hashUsed).toMatch(/^\$2[aby]\$/);
    expect(hashUsed).not.toBe(passwordHash);
    spy.mockRestore();
  });

  it("для существующего пользователя сравнение идёт с его хешем", async () => {
    m.userFindUnique.mockResolvedValue(existingUser());
    const spy = vi.spyOn(bcrypt, "compare");
    await authorize({ email: "a@b.com", password: PASSWORD });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][1]).toBe(passwordHash);
    spy.mockRestore();
  });

  it.each([
    ["существующий email", existingUser(), "a@b.com"],
    ["несуществующий email", null, "none@b.com"],
  ] as const)("при блокировке (%s) bcrypt.compare тоже вызывается", async (_n, user, email) => {
    m.isLocked.mockReturnValue(true);
    m.userFindUnique.mockResolvedValue(user);
    const spy = vi.spyOn(bcrypt, "compare");
    await authorize({ email, password: PASSWORD }).catch(() => {});
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("состояние попыток и пользователь читаются оба, даже если email не найден", async () => {
    const started: string[] = [];
    m.attemptFindUnique.mockImplementation(async () => {
      started.push("attempt");
      await Promise.resolve();
      return null;
    });
    m.userFindUnique.mockImplementation(async () => {
      started.push("user");
      return null;
    });
    await authorize({ email: "a@b.com", password: PASSWORD });
    expect(started.sort()).toEqual(["attempt", "user"]);
  });
});
