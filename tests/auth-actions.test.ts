import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => {
  class AuthError extends Error {}
  // Как в next-auth: CredentialsSignin наследует AuthError, код ошибки в поле code
  class CredentialsSignin extends AuthError {
    code = "credentials";
  }
  class PrismaClientKnownRequestError extends Error {
    code: string;
    meta?: Record<string, unknown>;
    constructor(message: string, opts: { code: string; meta?: Record<string, unknown> }) {
      super(message);
      this.code = opts.code;
      this.meta = opts.meta;
    }
  }
  return {
    AuthError,
    CredentialsSignin,
    PrismaClientKnownRequestError,
    signIn: vi.fn(),
    signOut: vi.fn(),
    hash: vi.fn(),
    familyFindUnique: vi.fn(),
    familyCreate: vi.fn(),
    userCreate: vi.fn(),
    generateInviteCode: vi.fn(),
  };
});

vi.mock("next-auth", () => ({
  AuthError: m.AuthError,
  CredentialsSignin: m.CredentialsSignin,
  default: vi.fn(),
}));
vi.mock("@prisma/client", () => ({
  Prisma: { PrismaClientKnownRequestError: m.PrismaClientKnownRequestError },
}));
vi.mock("@/auth", () => ({ signIn: m.signIn, signOut: m.signOut }));
vi.mock("bcryptjs", () => ({ default: { hash: m.hash } }));
vi.mock("@/lib/invite-code", () => ({ generateInviteCode: m.generateInviteCode }));
vi.mock("@/lib/db", () => ({
  prisma: {
    family: { findUnique: m.familyFindUnique, create: m.familyCreate },
    user: { create: m.userCreate },
  },
}));

import { loginAction, logoutAction, registerAction } from "@/app/actions/auth";

const LOGIN_ERROR = "Неверный email или пароль";
const GENERIC_ERROR = "Что-то пошло не так. Попробуйте ещё раз";

function fd(fields: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

const createFields = {
  mode: "create",
  name: "Анна",
  email: "Anna@Example.com",
  password: "password123",
  familyName: "Ивановы",
};
const joinFields = {
  mode: "join",
  name: "Петя",
  email: "petya@example.com",
  password: "password123",
  role: "child",
  inviteCode: "abcd2345",
};

const redirect = new Error("NEXT_REDIRECT");

beforeEach(() => {
  vi.clearAllMocks();
  m.hash.mockResolvedValue("HASH");
  m.generateInviteCode.mockReturnValue("CODE2345");
  m.signIn.mockRejectedValue(redirect); // успешный signIn в next-auth бросает redirect
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("loginAction", () => {
  it("вызывает signIn с нормализованным email и redirectTo /family; redirect пробрасывается", async () => {
    await expect(
      loginAction(undefined, fd({ email: " A@B.com ", password: "secret" })),
    ).rejects.toBe(redirect);
    expect(m.signIn).toHaveBeenCalledWith("credentials", {
      email: "a@b.com",
      password: "secret",
      redirectTo: "/family",
    });
  });

  it("при AuthError возвращает единое сообщение", async () => {
    m.signIn.mockRejectedValue(new m.AuthError("CredentialsSignin"));
    expect(await loginAction(undefined, fd({ email: "a@b.com", password: "wrong" }))).toEqual({
      error: LOGIN_ERROR,
    });
  });

  it("CredentialsSignin с обычным кодом: то же единое сообщение", async () => {
    m.signIn.mockRejectedValue(new m.CredentialsSignin("CredentialsSignin"));
    expect(await loginAction(undefined, fd({ email: "a@b.com", password: "wrong" }))).toEqual({
      error: LOGIN_ERROR,
    });
  });

  it("блокировка (CredentialsSignin с кодом locked): сообщение о слишком большом числе попыток", async () => {
    const locked = new m.CredentialsSignin("locked");
    locked.code = "locked";
    m.signIn.mockRejectedValue(locked);
    const r = await loginAction(undefined, fd({ email: "a@b.com", password: "x" }));
    expect(r).toEqual({ error: "Слишком много попыток, попробуйте позже" });
    expect(r).not.toEqual({ error: LOGIN_ERROR });
  });

  it("код locked у обычного AuthError (не CredentialsSignin) блокировкой не считается", async () => {
    const e = new m.AuthError("x") as Error & { code?: string };
    e.code = "locked";
    m.signIn.mockRejectedValue(e);
    expect(await loginAction(undefined, fd({ email: "a@b.com", password: "x" }))).toEqual({
      error: LOGIN_ERROR,
    });
  });

  it("при пустых полях возвращает то же единое сообщение и не вызывает signIn", async () => {
    expect(await loginAction(undefined, fd({ email: "a@b.com", password: "" }))).toEqual({
      error: LOGIN_ERROR,
    });
    expect(await loginAction(undefined, new FormData())).toEqual({ error: LOGIN_ERROR });
    expect(m.signIn).not.toHaveBeenCalled();
  });

  it("неожиданные ошибки пробрасываются", async () => {
    const boom = new Error("db down");
    m.signIn.mockRejectedValue(boom);
    await expect(
      loginAction(undefined, fd({ email: "a@b.com", password: "x" })),
    ).rejects.toBe(boom);
  });
});

describe("registerAction: создание семьи", () => {
  it("создаёт семью с пользователем-взрослым, хешем и кодом, затем входит", async () => {
    await expect(registerAction(undefined, fd(createFields))).rejects.toBe(redirect);

    expect(m.hash).toHaveBeenCalledWith("password123", 10);
    expect(m.familyCreate).toHaveBeenCalledTimes(1);
    expect(m.familyCreate).toHaveBeenCalledWith({
      data: {
        name: "Ивановы",
        inviteCode: "CODE2345",
        users: {
          create: {
            name: "Анна",
            email: "anna@example.com",
            passwordHash: "HASH",
            role: "adult",
            timeZone: "UTC",
          },
        },
      },
    });
    expect(m.signIn).toHaveBeenCalledWith("credentials", {
      email: "anna@example.com",
      password: "password123",
      redirectTo: "/family",
    });
  });

  it("передан timeZone: сохраняется у создаваемого пользователя", async () => {
    await registerAction(undefined, fd({ ...createFields, timeZone: "Europe/Moscow" })).catch(() => {});
    expect(m.familyCreate.mock.calls[0][0].data.users.create.timeZone).toBe("Europe/Moscow");
  });

  it("неизвестный timeZone заменяется на UTC, регистрация проходит", async () => {
    await expect(
      registerAction(undefined, fd({ ...createFields, timeZone: "Nowhere/City" })),
    ).rejects.toBe(redirect);
    expect(m.familyCreate.mock.calls[0][0].data.users.create.timeZone).toBe("UTC");
  });

  it.each(["+23:59", "GMT+3", "utc"])("timeZone %j (смещение или не тот регистр) заменяется на UTC, регистрация проходит", async (tz) => {
    await expect(registerAction(undefined, fd({ ...createFields, timeZone: tz }))).rejects.toBe(redirect);
    expect(m.familyCreate.mock.calls[0][0].data.users.create.timeZone).toBe("UTC");
  });

  it("timeZone с пробелами по краям обрезается и сохраняется", async () => {
    await registerAction(undefined, fd({ ...createFields, timeZone: "  Europe/Moscow  " })).catch(() => {});
    expect(m.familyCreate.mock.calls[0][0].data.users.create.timeZone).toBe("Europe/Moscow");
  });

  it("America/Los_Angeles сохраняется как есть", async () => {
    await registerAction(undefined, fd({ ...createFields, timeZone: "America/Los_Angeles" })).catch(() => {});
    expect(m.familyCreate.mock.calls[0][0].data.users.create.timeZone).toBe("America/Los_Angeles");
  });

  it("регистрация не считается сменой пояса: timeZoneChangedAt не задаётся", async () => {
    await registerAction(undefined, fd({ ...createFields, timeZone: "Europe/Moscow" })).catch(() => {});
    expect(m.familyCreate.mock.calls[0][0].data.users.create).not.toHaveProperty("timeZoneChangedAt");
  });

  it("не хранит пароль в открытом виде", async () => {
    await registerAction(undefined, fd(createFields)).catch(() => {});
    expect(JSON.stringify(m.familyCreate.mock.calls)).not.toContain("password123");
  });

  it("повторяет попытку при коллизии inviteCode (P2002)", async () => {
    m.familyCreate
      .mockRejectedValueOnce(
        new m.PrismaClientKnownRequestError("dup", { code: "P2002", meta: { target: ["inviteCode"] } }),
      )
      .mockResolvedValueOnce({});
    m.generateInviteCode.mockReturnValueOnce("AAAAAAAA").mockReturnValueOnce("BBBBBBBB");

    await expect(registerAction(undefined, fd(createFields))).rejects.toBe(redirect);
    expect(m.familyCreate).toHaveBeenCalledTimes(2);
    expect(m.familyCreate.mock.calls[1][0].data.inviteCode).toBe("BBBBBBBB");
  });

  it("после 5 коллизий подряд возвращает общую ошибку", async () => {
    m.familyCreate.mockRejectedValue(
      new m.PrismaClientKnownRequestError("dup", { code: "P2002", meta: { target: ["inviteCode"] } }),
    );
    expect(await registerAction(undefined, fd(createFields))).toEqual({ error: GENERIC_ERROR });
    expect(m.familyCreate).toHaveBeenCalledTimes(5);
    expect(m.signIn).not.toHaveBeenCalled();
  });

  it("занятый email (P2002 по email) даёт понятное сообщение", async () => {
    m.familyCreate.mockRejectedValue(
      new m.PrismaClientKnownRequestError("dup", { code: "P2002", meta: { target: ["email"] } }),
    );
    expect(await registerAction(undefined, fd(createFields))).toEqual({
      error: "Этот email уже зарегистрирован",
    });
    expect(m.familyCreate).toHaveBeenCalledTimes(1);
    expect(m.signIn).not.toHaveBeenCalled();
  });

  it("прочие ошибки БД дают общее сообщение без деталей", async () => {
    m.familyCreate.mockRejectedValue(new Error("connection refused"));
    expect(await registerAction(undefined, fd(createFields))).toEqual({ error: GENERIC_ERROR });
  });
});

describe("registerAction: вступление по коду", () => {
  it("ищет семью по коду в верхнем регистре и создаёт пользователя с выбранной ролью", async () => {
    m.familyFindUnique.mockResolvedValue({ id: "fam-1" });

    await expect(registerAction(undefined, fd(joinFields))).rejects.toBe(redirect);

    expect(m.familyFindUnique).toHaveBeenCalledWith({ where: { inviteCode: "ABCD2345" } });
    expect(m.userCreate).toHaveBeenCalledWith({
      data: {
        familyId: "fam-1",
        name: "Петя",
        email: "petya@example.com",
        passwordHash: "HASH",
        role: "child",
        timeZone: "UTC",
      },
    });
    expect(m.familyCreate).not.toHaveBeenCalled();
    expect(m.signIn).toHaveBeenCalledTimes(1);
  });

  it("передан timeZone: сохраняется у пользователя", async () => {
    m.familyFindUnique.mockResolvedValue({ id: "fam-1" });
    await registerAction(undefined, fd({ ...joinFields, timeZone: "Asia/Vladivostok" })).catch(() => {});
    expect(m.userCreate.mock.calls[0][0].data.timeZone).toBe("Asia/Vladivostok");
  });

  it("при вступлении timeZoneChangedAt не задаётся (регистрация не считается сменой пояса)", async () => {
    m.familyFindUnique.mockResolvedValue({ id: "fam-1" });
    await registerAction(undefined, fd({ ...joinFields, timeZone: "Asia/Vladivostok" })).catch(() => {});
    expect(m.userCreate.mock.calls[0][0].data).not.toHaveProperty("timeZoneChangedAt");
  });

  it.each(["+23:59", "GMT+3"])("при вступлении timeZone %j заменяется на UTC", async (tz) => {
    m.familyFindUnique.mockResolvedValue({ id: "fam-1" });
    await registerAction(undefined, fd({ ...joinFields, timeZone: tz })).catch(() => {});
    expect(m.userCreate.mock.calls[0][0].data.timeZone).toBe("UTC");
  });

  it("неизвестный timeZone при вступлении заменяется на UTC", async () => {
    m.familyFindUnique.mockResolvedValue({ id: "fam-1" });
    await registerAction(undefined, fd({ ...joinFields, timeZone: "Mars/Base" })).catch(() => {});
    expect(m.userCreate.mock.calls[0][0].data.timeZone).toBe("UTC");
  });

  it("несуществующий код: ошибка, пользователь не создаётся, вход не выполняется", async () => {
    m.familyFindUnique.mockResolvedValue(null);
    expect(await registerAction(undefined, fd(joinFields))).toEqual({
      error: "Семья с таким кодом не найдена",
    });
    expect(m.userCreate).not.toHaveBeenCalled();
    expect(m.signIn).not.toHaveBeenCalled();
  });

  it("занятый email при вступлении (P2002)", async () => {
    m.familyFindUnique.mockResolvedValue({ id: "fam-1" });
    m.userCreate.mockRejectedValue(
      new m.PrismaClientKnownRequestError("dup", { code: "P2002", meta: { target: ["email"] } }),
    );
    expect(await registerAction(undefined, fd(joinFields))).toEqual({
      error: "Этот email уже зарегистрирован",
    });
    expect(m.signIn).not.toHaveBeenCalled();
  });

  it("P2002 по другому полю не маскируется под занятый email", async () => {
    m.familyFindUnique.mockResolvedValue({ id: "fam-1" });
    m.userCreate.mockRejectedValue(
      new m.PrismaClientKnownRequestError("dup", { code: "P2002", meta: { target: ["other"] } }),
    );
    expect(await registerAction(undefined, fd(joinFields))).toEqual({ error: GENERIC_ERROR });
  });
});

describe("registerAction: валидация и вход после регистрации", () => {
  it("невалидные данные: первое русское сообщение, БД и bcrypt не вызываются", async () => {
    const r = await registerAction(undefined, fd({ ...createFields, password: "short" }));
    expect(r).toEqual({ error: "Пароль должен быть не короче 8 символов" });
    expect(m.hash).not.toHaveBeenCalled();
    expect(m.familyCreate).not.toHaveBeenCalled();
  });

  it("неверная роль при вступлении отклоняется", async () => {
    const r = await registerAction(undefined, fd({ ...joinFields, role: "admin" }));
    expect(r).toEqual({ error: "Выберите роль" });
    expect(m.userCreate).not.toHaveBeenCalled();
  });

  it("пустой FormData не падает, возвращает ошибку", async () => {
    const r = await registerAction(undefined, new FormData());
    expect(r?.error).toBeTruthy();
  });

  it("AuthError при автоматическом входе даёт общую ошибку", async () => {
    m.signIn.mockRejectedValue(new m.AuthError("x"));
    expect(await registerAction(undefined, fd(createFields))).toEqual({ error: GENERIC_ERROR });
  });

  it("CredentialsSignin при автоматическом входе после регистрации тоже даёт общую ошибку", async () => {
    m.signIn.mockRejectedValue(new m.CredentialsSignin("x"));
    expect(await registerAction(undefined, fd(createFields))).toEqual({ error: GENERIC_ERROR });
  });
});

describe("logoutAction", () => {
  it("вызывает signOut с redirectTo /login", async () => {
    await logoutAction();
    expect(m.signOut).toHaveBeenCalledWith({ redirectTo: "/login" });
  });
});
