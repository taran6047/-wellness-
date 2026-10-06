import { describe, expect, it } from "vitest";
import { goalSchema } from "@/lib/validation";

const valid = {
  title: "Пройти 100 км",
  metric: "activity_km",
  targetValue: "100",
  startDate: "2026-10-01",
  endDate: "2026-10-31",
};

function firstError(input: Record<string, unknown>) {
  const r = goalSchema.safeParse(input);
  return r.success ? null : r.error.issues[0]?.message;
}

describe("goalSchema: основной сценарий", () => {
  it("принимает корректные данные и приводит типы", () => {
    const r = goalSchema.safeParse(valid);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data).toEqual({
        title: "Пройти 100 км",
        metric: "activity_km",
        targetValue: 100,
        startDate: new Date("2026-10-01T00:00:00.000Z"),
        endDate: new Date("2026-10-31T00:00:00.000Z"),
      });
    }
  });

  it("обрезает пробелы в названии", () => {
    const r = goalSchema.safeParse({ ...valid, title: "  Цель  " });
    expect(r.success && r.data.title).toBe("Цель");
  });

  it("дробное целевое значение допустимо", () => {
    const r = goalSchema.safeParse({ ...valid, targetValue: "12.5" });
    expect(r.success && r.data.targetValue).toBe(12.5);
  });

  it("начало = конец (один день) допустимо", () => {
    expect(goalSchema.safeParse({ ...valid, endDate: valid.startDate }).success).toBe(true);
  });
});

describe("goalSchema: метрика", () => {
  it.each(["activity_minutes", "activity_km", "water_ml", "meals_count", "health_count", "points"])(
    "%s допустима",
    (metric) => {
      expect(goalSchema.safeParse({ ...valid, metric }).success).toBe(true);
    },
  );

  it.each(["steps", "", "POINTS", "toString"])("%j недопустима: «Выберите метрику»", (metric) => {
    expect(firstError({ ...valid, metric })).toBe("Выберите метрику");
  });

  it("метрика не передана", () => {
    const { metric: _m, ...rest } = valid;
    expect(firstError(rest)).toBe("Выберите метрику");
  });
});

describe("goalSchema: название", () => {
  it("пустое / пробелы / отсутствует: «Введите название цели»", () => {
    expect(firstError({ ...valid, title: "" })).toBe("Введите название цели");
    expect(firstError({ ...valid, title: "   " })).toBe("Введите название цели");
    expect(firstError({ ...valid, title: undefined })).toBe("Введите название цели");
  });

  it("1 символ допустим, 100 допустимо, 101 — ошибка", () => {
    expect(goalSchema.safeParse({ ...valid, title: "а" }).success).toBe(true);
    expect(goalSchema.safeParse({ ...valid, title: "а".repeat(100) }).success).toBe(true);
    expect(firstError({ ...valid, title: "а".repeat(101) })).toBe(
      "Название должно быть не длиннее 100 символов",
    );
  });
});

describe("goalSchema: целевое значение", () => {
  it.each(["1", "0.01", "1000000"])("%s допустимо", (targetValue) => {
    expect(goalSchema.safeParse({ ...valid, targetValue }).success).toBe(true);
  });

  it.each(["0", "-1", "-0.5"])("%s: «больше нуля»", (targetValue) => {
    expect(firstError({ ...valid, targetValue })).toBe("Целевое значение должно быть больше нуля");
  });

  it("1000001 — выше максимума", () => {
    expect(firstError({ ...valid, targetValue: "1000001" })).toBe("Целевое значение не больше 1000000");
  });

  it.each(["", "   ", "abc", undefined])("%j: «Укажите целевое значение»", (targetValue) => {
    expect(firstError({ ...valid, targetValue })).toBe("Укажите целевое значение");
  });
});

describe("goalSchema: даты", () => {
  it.each(["", "2026-1-1", "01.10.2026", "2026-02-30", "2026-13-01", "abc"])(
    "неверный формат/дата %j в startDate: «Укажите дату»",
    (startDate) => {
      expect(firstError({ ...valid, startDate })).toBe("Укажите дату");
    },
  );

  it("неверная endDate: «Укажите дату»", () => {
    expect(firstError({ ...valid, endDate: "2026-02-30" })).toBe("Укажите дату");
  });

  it("даты не переданы: «Укажите дату»", () => {
    expect(firstError({ ...valid, startDate: undefined })).toBe("Укажите дату");
    expect(firstError({ ...valid, endDate: undefined })).toBe("Укажите дату");
  });

  it("конец раньше начала: ошибка на endDate", () => {
    const r = goalSchema.safeParse({ ...valid, startDate: "2026-10-10", endDate: "2026-10-09" });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0].message).toBe("Дата окончания не может быть раньше даты начала");
      expect(r.error.issues[0].path).toEqual(["endDate"]);
    }
  });
});

describe("goalSchema: длина периода", () => {
  it("366 дней (високосный год, включительно) допустимо", () => {
    expect(goalSchema.safeParse({ ...valid, startDate: "2024-01-01", endDate: "2024-12-31" }).success).toBe(
      true,
    );
  });

  it("367 дней — ошибка", () => {
    expect(firstError({ ...valid, startDate: "2024-01-01", endDate: "2025-01-01" })).toBe(
      "Период цели не длиннее 366 дней",
    );
  });

  it("365 дней допустимо, 366 дней в обычном году допустимо, 367 — нет", () => {
    expect(goalSchema.safeParse({ ...valid, startDate: "2025-01-01", endDate: "2025-12-31" }).success).toBe(
      true,
    );
    expect(goalSchema.safeParse({ ...valid, startDate: "2025-01-01", endDate: "2026-01-01" }).success).toBe(
      true,
    );
    expect(firstError({ ...valid, startDate: "2025-01-01", endDate: "2026-01-02" })).toBe(
      "Период цели не длиннее 366 дней",
    );
  });
});
