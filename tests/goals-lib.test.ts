import { describe, expect, it } from "vitest";
import {
  GOAL_METRICS,
  GOAL_METRIC_KEYS,
  GOAL_STATUS_LABELS,
  calculateGoalProgress,
  formatGoalValue,
  goalPeriodDays,
  isGoalMetric,
} from "@/lib/goals";

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

describe("calculateGoalProgress", () => {
  const base = { targetValue: 100, endDate: d("2026-10-10"), today: d("2026-10-06") };

  it("0%: ничего не сделано, цель в процессе", () => {
    expect(calculateGoalProgress({ ...base, current: 0 })).toEqual({
      percent: 0,
      achieved: false,
      daysLeft: 4,
      status: "in_progress",
    });
  });

  it("частичный прогресс округляется вниз", () => {
    const r = calculateGoalProgress({ ...base, current: 33.9 });
    expect(r.percent).toBe(33);
    expect(r.achieved).toBe(false);
    expect(r.status).toBe("in_progress");
  });

  it("99.99% не округляется до 100 и не считается достигнутой", () => {
    const r = calculateGoalProgress({ ...base, current: 99.99 });
    expect(r.percent).toBe(99);
    expect(r.achieved).toBe(false);
  });

  it("ровно цель: 100% и achieved", () => {
    const r = calculateGoalProgress({ ...base, current: 100 });
    expect(r.percent).toBe(100);
    expect(r.achieved).toBe(true);
    expect(r.status).toBe("achieved");
  });

  it("сверх цели: процент ограничен 100, achieved", () => {
    const r = calculateGoalProgress({ ...base, current: 250 });
    expect(r.percent).toBe(100);
    expect(r.achieved).toBe(true);
    expect(r.status).toBe("achieved");
  });

  it("срок истёк без достижения: expired", () => {
    const r = calculateGoalProgress({ ...base, current: 40, today: d("2026-10-11") });
    expect(r.status).toBe("expired");
    expect(r.achieved).toBe(false);
    expect(r.percent).toBe(40);
    expect(r.daysLeft).toBe(0);
  });

  it("достигнута после срока: остаётся achieved, а не expired", () => {
    const r = calculateGoalProgress({ ...base, current: 100, today: d("2026-10-20") });
    expect(r.status).toBe("achieved");
    expect(r.achieved).toBe(true);
    expect(r.daysLeft).toBe(0);
  });

  describe("daysLeft на границах", () => {
    it("сегодня последний день: 0 дней, ещё не expired", () => {
      const r = calculateGoalProgress({ ...base, current: 0, today: d("2026-10-10") });
      expect(r.daysLeft).toBe(0);
      expect(r.status).toBe("in_progress");
    });

    it("за день до конца: 1", () => {
      expect(calculateGoalProgress({ ...base, current: 0, today: d("2026-10-09") }).daysLeft).toBe(1);
    });

    it("на следующий день после конца: 0 и expired (не отрицательное)", () => {
      const r = calculateGoalProgress({ ...base, current: 0, today: d("2026-10-11") });
      expect(r.daysLeft).toBe(0);
      expect(r.status).toBe("expired");
    });

    it("далеко в прошлом: daysLeft не уходит в минус", () => {
      expect(calculateGoalProgress({ ...base, current: 0, today: d("2030-01-01") }).daysLeft).toBe(0);
    });

    it("через границу месяца и года считает календарные дни", () => {
      const r = calculateGoalProgress({
        current: 0,
        targetValue: 10,
        endDate: d("2027-01-02"),
        today: d("2026-12-30"),
      });
      expect(r.daysLeft).toBe(3);
    });
  });

  describe("некорректная цель не ломает расчёт", () => {
    it.each([0, -5])("targetValue %s: 0%, не achieved, без NaN/Infinity", (targetValue) => {
      const r = calculateGoalProgress({ ...base, current: 50, targetValue });
      expect(r.percent).toBe(0);
      expect(r.achieved).toBe(false);
      expect(Number.isFinite(r.percent)).toBe(true);
      expect(r.status).toBe("in_progress");
    });

    it("нулевая цель после срока: expired", () => {
      const r = calculateGoalProgress({ ...base, current: 0, targetValue: 0, today: d("2026-11-01") });
      expect(r.status).toBe("expired");
    });

    it("отрицательный current трактуется как 0", () => {
      const r = calculateGoalProgress({ ...base, current: -20 });
      expect(r.percent).toBe(0);
      expect(r.achieved).toBe(false);
    });
  });
});

describe("goalPeriodDays", () => {
  it("один день: начало = конец -> 1", () => {
    expect(goalPeriodDays(d("2026-10-06"), d("2026-10-06"))).toBe(1);
  });

  it("включает оба конца", () => {
    expect(goalPeriodDays(d("2026-10-01"), d("2026-10-07"))).toBe(7);
  });

  it("високосный год: 366 дней", () => {
    expect(goalPeriodDays(d("2024-01-01"), d("2024-12-31"))).toBe(366);
  });

  it("обычный год: 365 дней", () => {
    expect(goalPeriodDays(d("2025-01-01"), d("2025-12-31"))).toBe(365);
  });

  it("конец раньше начала даёт значение меньше 1", () => {
    expect(goalPeriodDays(d("2026-10-06"), d("2026-10-04"))).toBe(-1);
  });
});

describe("isGoalMetric", () => {
  it.each(["activity_minutes", "activity_km", "water_ml", "meals_count", "health_count", "points"])(
    "%s — допустимая метрика",
    (k) => {
      expect(isGoalMetric(k)).toBe(true);
    },
  );

  it.each(["", "steps", "POINTS", "toString", "constructor", "__proto__", "hasOwnProperty"])(
    "%j — недопустимая метрика",
    (k) => {
      expect(isGoalMetric(k)).toBe(false);
    },
  );

  it("GOAL_METRIC_KEYS содержит ровно 6 метрик", () => {
    expect([...GOAL_METRIC_KEYS].sort()).toEqual(Object.keys(GOAL_METRICS).sort());
    expect(GOAL_METRIC_KEYS).toHaveLength(6);
  });
});

describe("formatGoalValue", () => {
  it("целые числа без дробной части", () => {
    expect(formatGoalValue(0)).toBe("0");
    expect(formatGoalValue(150)).toBe("150");
    expect(formatGoalValue(1_000_000)).toBe("1000000");
  });

  it("округляет до 2 знаков", () => {
    expect(formatGoalValue(12.3456)).toBe("12.35");
    expect(formatGoalValue(5.5)).toBe("5.5");
    expect(formatGoalValue(0.004)).toBe("0");
  });

  it("убирает хвост плавающей точки", () => {
    expect(formatGoalValue(0.1 + 0.2)).toBe("0.3");
  });

  it.each(Object.keys(GOAL_METRICS))("метрика %s форматируется значением и имеет подпись и единицу", (k) => {
    const meta = GOAL_METRICS[k as keyof typeof GOAL_METRICS];
    expect(meta.label.length).toBeGreaterThan(0);
    expect(meta.unit.length).toBeGreaterThan(0);
    expect(formatGoalValue(42.125)).toBe("42.13");
  });

  it("единицы и подписи метрик", () => {
    expect(GOAL_METRICS.activity_minutes).toEqual({ label: "Минуты активности", unit: "мин" });
    expect(GOAL_METRICS.activity_km).toEqual({ label: "Километры активности", unit: "км" });
    expect(GOAL_METRICS.water_ml).toEqual({ label: "Миллилитры воды", unit: "мл" });
    expect(GOAL_METRICS.meals_count.unit).toBe("приёмов");
    expect(GOAL_METRICS.health_count.unit).toBe("записей");
    expect(GOAL_METRICS.points).toEqual({ label: "Баллы", unit: "баллов" });
  });
});

describe("GOAL_STATUS_LABELS", () => {
  it("русские подписи всех трёх статусов", () => {
    expect(GOAL_STATUS_LABELS).toEqual({
      in_progress: "В процессе",
      achieved: "Достигнута",
      expired: "Срок истёк",
    });
  });
});
