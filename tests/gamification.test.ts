import { describe, expect, it } from "vitest";
import {
  ACHIEVEMENTS,
  DAILY_LIMITS,
  applyDailyLimit,
  earnedAchievements,
  levelForPoints,
  levelProgress,
  longestStreak,
  pointsForActivity,
  pointsForHealth,
  pointsForLevel,
  pointsForMeal,
  pointsForWater,
  savedMessage,
  type AchievementStats,
} from "@/lib/gamification";

describe("pointsForActivity: 1 балл за 5 минут, максимум 60", () => {
  it.each([
    [0, 0],
    [1, 0],
    [4, 0],
    [5, 1],
    [9, 1],
    [10, 2],
    [30, 6],
    [299, 59],
    [300, 60],
    [301, 60],
    [1440, 60],
  ])("%j мин -> %j", (minutes, points) => {
    expect(pointsForActivity(minutes)).toBe(points);
  });

  it("отрицательная длительность не даёт отрицательных баллов", () => {
    expect(pointsForActivity(-10)).toBe(0);
  });
});

describe("pointsForMeal / pointsForHealth: по 5", () => {
  it("питание 5", () => expect(pointsForMeal()).toBe(5));
  it("здоровье 5", () => expect(pointsForHealth()).toBe(5));
});

describe("pointsForWater: 1 балл за 250 мл, максимум 8", () => {
  it.each([
    [0, 0],
    [1, 0],
    [249, 0],
    [250, 1],
    [499, 1],
    [500, 2],
    [1999, 7],
    [2000, 8],
    [2001, 8],
    [5000, 8],
  ])("%j мл -> %j", (ml, points) => {
    expect(pointsForWater(ml)).toBe(points);
  });

  it("отрицательный объём не даёт отрицательных баллов", () => {
    expect(pointsForWater(-250)).toBe(0);
  });
});

describe("суточные лимиты и applyDailyLimit", () => {
  it("значения лимитов", () => {
    expect(DAILY_LIMITS).toEqual({ activity: 100, meal: 20, water: 8, health: 5 });
  });

  it.each([
    ["activity", 60, 0, 60],
    ["activity", 60, 50, 50],
    ["activity", 60, 100, 0],
    ["activity", 10, 95, 5],
    ["meal", 5, 15, 5],
    ["meal", 5, 16, 4],
    ["meal", 5, 20, 0],
    ["water", 8, 0, 8],
    ["water", 3, 6, 2],
    ["water", 1, 8, 0],
    ["health", 5, 0, 5],
    ["health", 5, 3, 2],
    ["health", 5, 5, 0],
  ] as const)("%s: raw %j, уже %j -> %j", (kind, raw, earned, expected) => {
    expect(applyDailyLimit(kind, raw, earned)).toBe(expected);
  });

  it("уже набрано больше лимита: результат 0, не отрицательный", () => {
    expect(applyDailyLimit("water", 5, 100)).toBe(0);
  });

  it("raw 0 остаётся 0", () => {
    expect(applyDailyLimit("meal", 0, 0)).toBe(0);
  });

  it("отрицательный raw не даёт отрицательного результата", () => {
    expect(applyDailyLimit("meal", -5, 0)).toBe(0);
  });
});

describe("levelForPoints / pointsForLevel / levelProgress", () => {
  it.each([
    [0, 1],
    [49, 1],
    [50, 2],
    [199, 2],
    [200, 3],
    [449, 3],
    [450, 4],
    [799, 4],
    [800, 5],
    [1250, 6],
  ])("%j баллов -> уровень %j", (points, level) => {
    expect(levelForPoints(points)).toBe(level);
  });

  it("отрицательные баллы считаются как 0", () => {
    expect(levelForPoints(-100)).toBe(1);
  });

  it.each([
    [1, 0],
    [2, 50],
    [3, 200],
    [4, 450],
    [5, 800],
  ])("уровень %j начинается с %j баллов", (level, points) => {
    expect(pointsForLevel(level)).toBe(points);
  });

  it("pointsForLevel для уровня <= 1 это 0", () => {
    expect(pointsForLevel(0)).toBe(0);
    expect(pointsForLevel(-3)).toBe(0);
  });

  it("согласованность: на границе уровня levelForPoints(pointsForLevel(n)) = n, а на 1 балл меньше = n-1", () => {
    for (let n = 1; n <= 30; n++) {
      expect(levelForPoints(pointsForLevel(n))).toBe(n);
      if (n > 1) expect(levelForPoints(pointsForLevel(n) - 1)).toBe(n - 1);
    }
  });

  it("pointsForLevel строго возрастает", () => {
    for (let n = 1; n < 30; n++) {
      expect(pointsForLevel(n + 1)).toBeGreaterThan(pointsForLevel(n));
    }
  });

  it("levelProgress(0)", () => {
    expect(levelProgress(0)).toEqual({
      level: 1,
      currentLevelPoints: 0,
      nextLevelPoints: 50,
      pointsToNext: 50,
      percent: 0,
    });
  });

  it("levelProgress в середине уровня", () => {
    expect(levelProgress(125)).toEqual({
      level: 2,
      currentLevelPoints: 50,
      nextLevelPoints: 200,
      pointsToNext: 75,
      percent: 50,
    });
  });

  it("levelProgress: за 1 балл до нового уровня", () => {
    const p = levelProgress(49);
    expect(p.level).toBe(1);
    expect(p.pointsToNext).toBe(1);
    expect(p.percent).toBe(98);
  });

  it("levelProgress: ровно на границе уровня процент 0", () => {
    const p = levelProgress(200);
    expect(p.level).toBe(3);
    expect(p.currentLevelPoints).toBe(200);
    expect(p.nextLevelPoints).toBe(450);
    expect(p.percent).toBe(0);
    expect(p.pointsToNext).toBe(250);
  });

  it("levelProgress: отрицательные баллы как 0", () => {
    expect(levelProgress(-5)).toEqual(levelProgress(0));
  });

  it("levelProgress: percent всегда в 0..100, pointsToNext > 0", () => {
    for (let pts = 0; pts <= 3000; pts += 7) {
      const p = levelProgress(pts);
      expect(p.percent).toBeGreaterThanOrEqual(0);
      expect(p.percent).toBeLessThanOrEqual(100);
      expect(p.pointsToNext).toBeGreaterThan(0);
      expect(p.currentLevelPoints).toBeLessThanOrEqual(pts);
      expect(p.nextLevelPoints).toBeGreaterThan(pts);
      expect(p.level).toBe(levelForPoints(pts));
    }
  });
});

describe("savedMessage", () => {
  it.each([
    [1, "Сохранено, +1 балл"],
    [2, "Сохранено, +2 балла"],
    [3, "Сохранено, +3 балла"],
    [4, "Сохранено, +4 балла"],
    [5, "Сохранено, +5 баллов"],
    [10, "Сохранено, +10 баллов"],
    [11, "Сохранено, +11 баллов"],
    [12, "Сохранено, +12 баллов"],
    [14, "Сохранено, +14 баллов"],
    [20, "Сохранено, +20 баллов"],
    [21, "Сохранено, +21 балл"],
    [22, "Сохранено, +22 балла"],
    [25, "Сохранено, +25 баллов"],
    [60, "Сохранено, +60 баллов"],
    [100, "Сохранено, +100 баллов"],
    [101, "Сохранено, +101 балл"],
    [111, "Сохранено, +111 баллов"],
    [112, "Сохранено, +112 баллов"],
  ])("%j -> %s", (points, text) => {
    expect(savedMessage(points)).toBe(text);
  });

  it("0 баллов: сообщение о лимите", () => {
    expect(savedMessage(0)).toBe("Сохранено, лимит баллов на сегодня достигнут");
  });

  it("отрицательное число трактуется как лимит", () => {
    expect(savedMessage(-3)).toBe("Сохранено, лимит баллов на сегодня достигнут");
  });
});

describe("longestStreak", () => {
  it("пустой список -> 0", () => {
    expect(longestStreak([])).toBe(0);
  });

  it("один день -> 1", () => {
    expect(longestStreak(["2026-10-01"])).toBe(1);
  });

  it("повторы одного дня не увеличивают серию", () => {
    expect(longestStreak(["2026-10-01", "2026-10-01", "2026-10-01"])).toBe(1);
  });

  it("подряд идущие дни", () => {
    expect(longestStreak(["2026-10-01", "2026-10-02", "2026-10-03"])).toBe(3);
  });

  it("порядок во входе не важен", () => {
    expect(longestStreak(["2026-10-03", "2026-10-01", "2026-10-02"])).toBe(3);
  });

  it("разрыв сбрасывает серию, берётся самая длинная", () => {
    expect(
      longestStreak([
        "2026-10-01",
        "2026-10-02",
        "2026-10-04",
        "2026-10-05",
        "2026-10-06",
        "2026-10-07",
        "2026-10-09",
      ]),
    ).toBe(4);
  });

  it("серия через границу месяца и года", () => {
    expect(longestStreak(["2026-12-30", "2026-12-31", "2027-01-01"])).toBe(3);
  });

  it("серия через 29 февраля високосного года", () => {
    expect(longestStreak(["2028-02-28", "2028-02-29", "2028-03-01"])).toBe(3);
  });

  it("некорректные даты игнорируются", () => {
    expect(longestStreak(["мусор", "2026-10-01", "2026-13-45"])).toBe(1);
    expect(longestStreak(["мусор"])).toBe(0);
  });
});

describe("earnedAchievements", () => {
  const empty: AchievementStats = {
    activityCount: 0,
    mealCount: 0,
    waterCount: 0,
    healthCount: 0,
    logDays: [],
    totalPoints: 0,
  };
  const days = (n: number) =>
    Array.from({ length: n }, (_, i) => `2026-10-${String(i + 1).padStart(2, "0")}`);

  it("каталог содержит ровно 10 достижений с уникальными кодами, названиями и описаниями", () => {
    expect(ACHIEVEMENTS).toHaveLength(10);
    expect(new Set(ACHIEVEMENTS.map((a) => a.code)).size).toBe(10);
    for (const a of ACHIEVEMENTS) {
      expect(a.title).toBeTruthy();
      expect(a.description).toBeTruthy();
    }
    expect(ACHIEVEMENTS.map((a) => a.code)).toEqual([
      "first_activity",
      "first_meal",
      "first_water",
      "first_health",
      "streak_3",
      "streak_7",
      "points_100",
      "points_500",
      "points_1000",
      "level_5",
    ]);
  });

  it("пустая статистика -> ничего", () => {
    expect(earnedAchievements(empty)).toEqual([]);
  });

  it.each([
    ["first_activity", { activityCount: 1 }],
    ["first_meal", { mealCount: 1 }],
    ["first_water", { waterCount: 1 }],
    ["first_health", { healthCount: 1 }],
  ] as const)("%s: выдаётся ровно за одну запись своего типа", (code, patch) => {
    expect(earnedAchievements({ ...empty, ...patch })).toEqual([code]);
  });

  it("запись другого типа не даёт чужое «первое» достижение", () => {
    expect(earnedAchievements({ ...empty, mealCount: 5 })).toEqual(["first_meal"]);
  });

  it("streak_3: 2 дня нет, 3 есть", () => {
    expect(earnedAchievements({ ...empty, logDays: days(2) })).toEqual([]);
    expect(earnedAchievements({ ...empty, logDays: days(3) })).toEqual(["streak_3"]);
  });

  it("streak_7: 6 дней только streak_3, 7 дней обе серии", () => {
    expect(earnedAchievements({ ...empty, logDays: days(6) })).toEqual(["streak_3"]);
    expect(earnedAchievements({ ...empty, logDays: days(7) })).toEqual(["streak_3", "streak_7"]);
  });

  it("серия с разрывом не засчитывается как 3 подряд", () => {
    expect(
      earnedAchievements({ ...empty, logDays: ["2026-10-01", "2026-10-02", "2026-10-04"] }),
    ).toEqual([]);
  });

  it("points_100: 99 нет, 100 есть", () => {
    expect(earnedAchievements({ ...empty, totalPoints: 99 })).toEqual([]);
    expect(earnedAchievements({ ...empty, totalPoints: 100 })).toEqual(["points_100"]);
  });

  it("points_500: 499 нет, 500 есть (вместе с points_100)", () => {
    expect(earnedAchievements({ ...empty, totalPoints: 499 })).toEqual(["points_100"]);
    expect(earnedAchievements({ ...empty, totalPoints: 500 })).toEqual(["points_100", "points_500"]);
  });

  it("level_5 наступает с 800 баллов, а не раньше", () => {
    expect(earnedAchievements({ ...empty, totalPoints: 799 })).not.toContain("level_5");
    expect(earnedAchievements({ ...empty, totalPoints: 800 })).toEqual([
      "points_100",
      "points_500",
      "level_5",
    ]);
  });

  it("points_1000: 999 нет, 1000 есть", () => {
    expect(earnedAchievements({ ...empty, totalPoints: 999 })).not.toContain("points_1000");
    expect(earnedAchievements({ ...empty, totalPoints: 1000 })).toEqual([
      "points_100",
      "points_500",
      "points_1000",
      "level_5",
    ]);
  });

  it("все 10 достижений при максимальной статистике, в порядке каталога", () => {
    const all = earnedAchievements({
      activityCount: 10,
      mealCount: 10,
      waterCount: 10,
      healthCount: 10,
      logDays: days(7),
      totalPoints: 5000,
    });
    expect(all).toEqual(ACHIEVEMENTS.map((a) => a.code));
  });
});
