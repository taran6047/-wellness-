import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  requireUser: vi.fn(),
  revalidatePath: vi.fn(),
  familyGoal: { create: vi.fn(), deleteMany: vi.fn() },
}));

vi.mock("@/lib/db", () => ({ prisma: { familyGoal: m.familyGoal } }));
vi.mock("@/lib/require-user", () => ({ requireUser: m.requireUser }));
vi.mock("next/cache", () => ({ revalidatePath: m.revalidatePath }));

import { createGoalAction, deleteGoalAction } from "@/app/actions/goals";

const GENERIC_ERROR = "Что-то пошло не так. Попробуйте ещё раз";
const ADULT_ONLY = "Цели могут создавать и удалять только взрослые";

function fd(fields: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

const valid = {
  title: "Выпить воды",
  metric: "water_ml",
  targetValue: "20000",
  startDate: "2026-10-01",
  endDate: "2026-10-31",
};

beforeEach(() => {
  vi.resetAllMocks();
  m.requireUser.mockResolvedValue({ id: "me", familyId: "fam-1", role: "adult" });
  m.familyGoal.create.mockResolvedValue({ id: "g1" });
  m.familyGoal.deleteMany.mockResolvedValue({ count: 1 });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("createGoalAction", () => {
  it("взрослый создаёт цель с familyId из пользователя и приведёнными типами", async () => {
    const r = await createGoalAction(undefined, fd(valid));
    expect(r).toEqual({ message: "Цель создана" });
    expect(m.familyGoal.create).toHaveBeenCalledTimes(1);
    expect(m.familyGoal.create).toHaveBeenCalledWith({
      data: {
        familyId: "fam-1",
        title: "Выпить воды",
        metric: "water_ml",
        targetValue: 20000,
        startDate: new Date("2026-10-01T00:00:00.000Z"),
        endDate: new Date("2026-10-31T00:00:00.000Z"),
      },
    });
  });

  it("вызывает revalidatePath для /goals и /", async () => {
    await createGoalAction(undefined, fd(valid));
    expect(m.revalidatePath).toHaveBeenCalledWith("/goals");
    expect(m.revalidatePath).toHaveBeenCalledWith("/");
  });

  it("подделка familyId (и createdBy) в форме игнорируется", async () => {
    await createGoalAction(undefined, fd({ ...valid, familyId: "other-fam", userId: "victim" }));
    const data = m.familyGoal.create.mock.calls[0][0].data;
    expect(data.familyId).toBe("fam-1");
    expect(JSON.stringify(data)).not.toContain("other-fam");
    expect(JSON.stringify(data)).not.toContain("victim");
    expect(data).not.toHaveProperty("userId");
  });

  it("ребёнок получает отказ, БД и revalidatePath не вызываются", async () => {
    m.requireUser.mockResolvedValue({ id: "kid", familyId: "fam-1", role: "child" });
    const r = await createGoalAction(undefined, fd(valid));
    expect(r).toEqual({ error: ADULT_ONLY });
    expect(m.familyGoal.create).not.toHaveBeenCalled();
    expect(m.revalidatePath).not.toHaveBeenCalled();
  });

  it("отказ ребёнку идёт раньше валидации (даже для невалидных данных)", async () => {
    m.requireUser.mockResolvedValue({ id: "kid", familyId: "fam-1", role: "child" });
    expect(await createGoalAction(undefined, new FormData())).toEqual({ error: ADULT_ONLY });
  });

  it.each([
    ["метрика", { metric: "steps" }, "Выберите метрику"],
    ["пустое название", { title: " " }, "Введите название цели"],
    ["цель 0", { targetValue: "0" }, "Целевое значение должно быть больше нуля"],
    ["цель выше максимума", { targetValue: "1000001" }, "Целевое значение не больше 1000000"],
    ["дата", { startDate: "2026-02-30" }, "Укажите дату"],
    [
      "конец раньше начала",
      { startDate: "2026-10-10", endDate: "2026-10-01" },
      "Дата окончания не может быть раньше даты начала",
    ],
    [
      "период 367 дней",
      { startDate: "2024-01-01", endDate: "2025-01-01" },
      "Период цели не длиннее 366 дней",
    ],
  ])("невалидные данные (%s): русская ошибка, БД не вызывается", async (_n, patch, msg) => {
    const r = await createGoalAction(undefined, fd({ ...valid, ...patch }));
    expect(r).toEqual({ error: msg });
    expect(m.familyGoal.create).not.toHaveBeenCalled();
    expect(m.revalidatePath).not.toHaveBeenCalled();
  });

  it("пустой FormData не падает и возвращает ошибку", async () => {
    const r = await createGoalAction(undefined, new FormData());
    expect(r?.error).toBeTruthy();
    expect(m.familyGoal.create).not.toHaveBeenCalled();
  });

  it("сбой БД: общее сообщение без деталей, revalidatePath не вызывается", async () => {
    m.familyGoal.create.mockRejectedValue(new Error("connection refused"));
    const r = await createGoalAction(undefined, fd(valid));
    expect(r).toEqual({ error: GENERIC_ERROR });
    expect(JSON.stringify(r)).not.toContain("connection refused");
    expect(m.revalidatePath).not.toHaveBeenCalled();
  });

  it("без сессии (requireUser бросает redirect) ничего не сохраняется", async () => {
    const redirect = new Error("NEXT_REDIRECT:/login");
    m.requireUser.mockRejectedValue(redirect);
    await expect(createGoalAction(undefined, fd(valid))).rejects.toBe(redirect);
    expect(m.familyGoal.create).not.toHaveBeenCalled();
  });
});

describe("deleteGoalAction", () => {
  it("взрослый удаляет по {id, familyId из сессии} и вызывает revalidatePath", async () => {
    await deleteGoalAction(fd({ id: "g1" }));
    expect(m.familyGoal.deleteMany).toHaveBeenCalledWith({ where: { id: "g1", familyId: "fam-1" } });
    expect(m.revalidatePath).toHaveBeenCalledWith("/goals");
    expect(m.revalidatePath).toHaveBeenCalledWith("/");
  });

  it("подделанный familyId в форме игнорируется", async () => {
    await deleteGoalAction(fd({ id: "g1", familyId: "other-fam" }));
    expect(m.familyGoal.deleteMany).toHaveBeenCalledWith({ where: { id: "g1", familyId: "fam-1" } });
  });

  it("чужая цель (count 0): ошибки нет, удаление ограничено своей семьёй", async () => {
    m.familyGoal.deleteMany.mockResolvedValue({ count: 0 });
    await expect(deleteGoalAction(fd({ id: "foreign" }))).resolves.toBeUndefined();
    expect(m.familyGoal.deleteMany.mock.calls[0][0].where.familyId).toBe("fam-1");
  });

  it("ребёнок: ничего не удаляется, revalidatePath не вызывается", async () => {
    m.requireUser.mockResolvedValue({ id: "kid", familyId: "fam-1", role: "child" });
    await expect(deleteGoalAction(fd({ id: "g1" }))).resolves.toBeUndefined();
    expect(m.familyGoal.deleteMany).not.toHaveBeenCalled();
    expect(m.revalidatePath).not.toHaveBeenCalled();
  });

  it.each([["пустой id", { id: "" }], ["нет id", {}], ["id длиннее 64", { id: "a".repeat(65) }]])(
    "%s: БД не вызывается",
    async (_t, fields) => {
      await deleteGoalAction(fd(fields));
      expect(m.familyGoal.deleteMany).not.toHaveBeenCalled();
      expect(m.revalidatePath).not.toHaveBeenCalled();
    },
  );

  it("без сессии ничего не удаляется", async () => {
    const redirect = new Error("NEXT_REDIRECT:/login");
    m.requireUser.mockRejectedValue(redirect);
    await expect(deleteGoalAction(fd({ id: "g1" }))).rejects.toBe(redirect);
    expect(m.familyGoal.deleteMany).not.toHaveBeenCalled();
  });
});
