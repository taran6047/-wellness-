import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  auth: vi.fn(),
  findUnique: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: m.auth }));
vi.mock("@/lib/db", () => ({ prisma: { user: { findUnique: m.findUnique } } }));
vi.mock("next/navigation", () => ({ redirect: m.redirect }));

import { getCurrentUser, requireUser } from "@/lib/require-user";

const dbUser = {
  id: "u1",
  name: "Анна",
  role: "adult",
  family: {
    name: "Ивановы",
    inviteCode: "ABCD2345",
    users: [{ id: "u1", name: "Анна", role: "adult" }],
  },
};

beforeEach(() => {
  m.auth.mockReset();
  m.findUnique.mockReset();
  m.redirect.mockReset();
  // Как настоящий next/navigation: redirect прерывает выполнение исключением
  m.redirect.mockImplementation((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  });
});

describe("getCurrentUser", () => {
  it.each([
    ["нет сессии (null)", null],
    ["сессия без user", {}],
    ["user без id", { user: {} }],
  ])("%s: null без запроса в БД", async (_title, session) => {
    m.auth.mockResolvedValue(session);
    expect(await getCurrentUser()).toBeNull();
    expect(m.findUnique).not.toHaveBeenCalled();
  });

  it("сессия есть, но пользователя в БД нет: null", async () => {
    m.auth.mockResolvedValue({ user: { id: "ghost" } });
    m.findUnique.mockResolvedValue(null);
    expect(await getCurrentUser()).toBeNull();
    expect(m.findUnique).toHaveBeenCalledTimes(1);
    expect(m.findUnique.mock.calls[0][0].where).toEqual({ id: "ghost" });
  });

  it("пользователь найден: возвращается вместе с семьёй", async () => {
    m.auth.mockResolvedValue({ user: { id: "u1" } });
    m.findUnique.mockResolvedValue(dbUser);
    const user = await getCurrentUser();
    expect(user).toEqual(dbUser);
    expect(user!.family.name).toBe("Ивановы");
  });

  it("запрашивает семью с кодом приглашения и участниками, без passwordHash", async () => {
    m.auth.mockResolvedValue({ user: { id: "u1" } });
    m.findUnique.mockResolvedValue(dbUser);
    await getCurrentUser();
    const { select } = m.findUnique.mock.calls[0][0];
    expect(select.family.select.inviteCode).toBe(true);
    expect(select.family.select.users.select).toEqual({ id: true, name: true, role: true });
    expect(select.passwordHash).toBeUndefined();
  });

  it("не вызывает redirect (это делает только requireUser)", async () => {
    m.auth.mockResolvedValue(null);
    await getCurrentUser();
    expect(m.redirect).not.toHaveBeenCalled();
  });
});

describe("requireUser", () => {
  it("нет сессии: redirect на /login", async () => {
    m.auth.mockResolvedValue(null);
    await expect(requireUser()).rejects.toThrow("NEXT_REDIRECT:/login");
    expect(m.redirect).toHaveBeenCalledWith("/login");
  });

  it("сессия есть, пользователя в БД нет: redirect на /login (getCurrentUser даёт null, /login не вернёт на /family)", async () => {
    m.auth.mockResolvedValue({ user: { id: "ghost" } });
    m.findUnique.mockResolvedValue(null);
    await expect(requireUser()).rejects.toThrow("NEXT_REDIRECT:/login");
    expect(m.redirect).toHaveBeenCalledTimes(1);
    expect(m.redirect).not.toHaveBeenCalledWith("/family");
  });

  it("пользователь найден: возвращается с семьёй, redirect не вызывается", async () => {
    m.auth.mockResolvedValue({ user: { id: "u1" } });
    m.findUnique.mockResolvedValue(dbUser);
    const user = await requireUser();
    expect(user).toEqual(dbUser);
    expect(user.family.inviteCode).toBe("ABCD2345");
    expect(m.redirect).not.toHaveBeenCalled();
  });
});
