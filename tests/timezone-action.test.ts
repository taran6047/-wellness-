import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  requireUser: vi.fn(),
  revalidatePath: vi.fn(),
  userUpdate: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: { user: { update: m.userUpdate } } }));
vi.mock("@/lib/require-user", () => ({ requireUser: m.requireUser }));
vi.mock("next/cache", () => ({ revalidatePath: m.revalidatePath }));

import { updateTimeZoneAction } from "@/app/actions/timezone";

const GENERIC_ERROR = "Что-то пошло не так. Попробуйте ещё раз";

function fd(fields: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
  m.requireUser.mockResolvedValue({ id: "me", familyId: "fam-1", timeZone: "UTC" });
  m.userUpdate.mockResolvedValue({});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("updateTimeZoneAction", () => {
  it("сохраняет пояс только пользователю из сессии и возвращает сообщение", async () => {
    const r = await updateTimeZoneAction(undefined, fd({ timeZone: "Europe/Moscow" }));
    expect(r).toEqual({ message: "Часовой пояс сохранён" });
    expect(m.userUpdate).toHaveBeenCalledTimes(1);
    expect(m.userUpdate).toHaveBeenCalledWith({
      where: { id: "me" },
      data: { timeZone: "Europe/Moscow" },
    });
  });

  it("подделанные userId/id в форме игнорируются", async () => {
    await updateTimeZoneAction(
      undefined,
      fd({ timeZone: "Asia/Tokyo", userId: "victim", id: "victim", familyId: "other" }),
    );
    const arg = m.userUpdate.mock.calls[0][0];
    expect(arg.where).toEqual({ id: "me" });
    expect(arg.data).toEqual({ timeZone: "Asia/Tokyo" });
    expect(JSON.stringify(arg)).not.toContain("victim");
  });

  it.each(["Mars/Base", "", "   "])("невалидный пояс %j сохраняется как UTC", async (tz) => {
    const r = await updateTimeZoneAction(undefined, fd({ timeZone: tz }));
    expect(r).toEqual({ message: "Часовой пояс сохранён" });
    expect(m.userUpdate.mock.calls[0][0].data).toEqual({ timeZone: "UTC" });
  });

  it("поле отсутствует в форме: UTC", async () => {
    await updateTimeZoneAction(undefined, new FormData());
    expect(m.userUpdate.mock.calls[0][0].data).toEqual({ timeZone: "UTC" });
  });

  it("после сохранения вызывается revalidatePath('/', 'layout')", async () => {
    await updateTimeZoneAction(undefined, fd({ timeZone: "Europe/Berlin" }));
    expect(m.revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("сбой БД: общее сообщение без деталей, revalidatePath не вызывается", async () => {
    m.userUpdate.mockRejectedValue(new Error("connection refused"));
    const r = await updateTimeZoneAction(undefined, fd({ timeZone: "Europe/Moscow" }));
    expect(r).toEqual({ error: GENERIC_ERROR });
    expect(m.revalidatePath).not.toHaveBeenCalled();
  });

  it("без сессии (requireUser бросает redirect) БД не вызывается", async () => {
    const redirect = new Error("NEXT_REDIRECT:/login");
    m.requireUser.mockRejectedValue(redirect);
    await expect(updateTimeZoneAction(undefined, fd({ timeZone: "Asia/Tokyo" }))).rejects.toBe(redirect);
    expect(m.userUpdate).not.toHaveBeenCalled();
  });
});
