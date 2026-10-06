import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DATE_WINDOW_ERROR,
  DEFAULT_TIME_ZONE,
  POPULAR_TIME_ZONES,
  dateInTimeZone,
  isAllowedLogDate,
  normalizeTimeZone,
} from "@/lib/timezone";

const utcDay = (day: string) => new Date(`${day}T00:00:00.000Z`);

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("константы", () => {
  it("пояс по умолчанию UTC и русский текст ошибки окна дат", () => {
    expect(DEFAULT_TIME_ZONE).toBe("UTC");
    expect(DATE_WINDOW_ERROR).toBe("Можно отметить только сегодняшний или вчерашний день");
  });

  it("популярные пояса: UTC первым, все понятны Intl, без дублей", () => {
    expect(POPULAR_TIME_ZONES[0]).toBe("UTC");
    expect(new Set(POPULAR_TIME_ZONES).size).toBe(POPULAR_TIME_ZONES.length);
    vi.setSystemTime(new Date("2026-10-06T12:00:00.000Z"));
    for (const tz of POPULAR_TIME_ZONES) {
      expect(() => dateInTimeZone(tz)).not.toThrow();
      expect(normalizeTimeZone(tz)).not.toBe("");
    }
  });
});

describe("normalizeTimeZone", () => {
  it.each(["UTC", "Europe/Moscow", "America/Los_Angeles", "Pacific/Auckland", "Asia/Tokyo"])(
    "валидный пояс %s сохраняется",
    (tz) => {
      expect(normalizeTimeZone(tz)).toBe(tz);
    },
  );

  it("пробелы вокруг имени обрезаются", () => {
    expect(normalizeTimeZone("  Europe/Moscow  ")).toBe("Europe/Moscow");
  });

  it.each(["Mars/Base", "Not/AZone", "abc", "Europe/Moscw", "+03:00x"])(
    "неизвестный пояс %j -> UTC",
    (tz) => {
      expect(normalizeTimeZone(tz)).toBe("UTC");
    },
  );

  it.each([["пустая строка", ""], ["пробелы", "   "], ["undefined", undefined], ["null", null], ["число", 42], ["объект", {}]])(
    "пустое или не строка (%s) -> UTC",
    (_t, value) => {
      expect(normalizeTimeZone(value)).toBe("UTC");
    },
  );
});

describe("dateInTimeZone", () => {
  it("в полдень UTC сегодня одинаково для UTC и Москвы", () => {
    vi.setSystemTime(new Date("2026-10-06T12:00:00.000Z"));
    expect(dateInTimeZone("UTC")).toBe("2026-10-06");
    expect(dateInTimeZone("Europe/Moscow")).toBe("2026-10-06");
  });

  it("по умолчанию смещение 0; offsetDays сдвигает на дни", () => {
    vi.setSystemTime(new Date("2026-10-06T12:00:00.000Z"));
    expect(dateInTimeZone("UTC", 0)).toBe("2026-10-06");
    expect(dateInTimeZone("UTC", -1)).toBe("2026-10-05");
    expect(dateInTimeZone("UTC", 1)).toBe("2026-10-07");
    expect(dateInTimeZone("UTC", -2)).toBe("2026-10-04");
  });

  it("пояса дают разные даты в один момент: 2026-10-06T20:00Z", () => {
    vi.setSystemTime(new Date("2026-10-06T20:00:00.000Z"));
    expect(dateInTimeZone("Pacific/Auckland")).toBe("2026-10-07"); // UTC+13
    expect(dateInTimeZone("Europe/Moscow")).toBe("2026-10-06"); // 23:00
    expect(dateInTimeZone("UTC")).toBe("2026-10-06");
    expect(dateInTimeZone("America/Los_Angeles")).toBe("2026-10-06"); // 13:00
  });

  it("сдвиг через границу месяца и года", () => {
    vi.setSystemTime(new Date("2027-01-01T05:00:00.000Z"));
    expect(dateInTimeZone("UTC", -1)).toBe("2026-12-31");
    expect(dateInTimeZone("UTC", 31)).toBe("2027-02-01");
    // в Лос-Анджелесе ещё 31 декабря
    expect(dateInTimeZone("America/Los_Angeles")).toBe("2026-12-31");
    expect(dateInTimeZone("America/Los_Angeles", -1)).toBe("2026-12-30");
  });

  it("високосный февраль", () => {
    vi.setSystemTime(new Date("2028-03-01T12:00:00.000Z"));
    expect(dateInTimeZone("UTC", -1)).toBe("2028-02-29");
  });

  it("новый год в Окленде наступает раньше UTC", () => {
    vi.setSystemTime(new Date("2026-12-31T23:30:00.000Z"));
    expect(dateInTimeZone("UTC")).toBe("2026-12-31");
    expect(dateInTimeZone("Pacific/Auckland")).toBe("2027-01-01");
  });
});

// [пояс, последняя секунда дня D, первая секунда дня D+1, D, D+1]
const boundaries = [
  ["UTC", "2026-10-06T23:59:59.000Z", "2026-10-07T00:00:00.000Z", "2026-10-06", "2026-10-07"],
  ["Pacific/Auckland", "2026-10-06T10:59:59.000Z", "2026-10-06T11:00:00.000Z", "2026-10-06", "2026-10-07"],
  ["America/Los_Angeles", "2026-10-07T06:59:59.000Z", "2026-10-07T07:00:00.000Z", "2026-10-06", "2026-10-07"],
  ["Europe/Moscow", "2026-10-06T20:59:59.000Z", "2026-10-06T21:00:00.000Z", "2026-10-06", "2026-10-07"],
] as const;

describe.each(boundaries)("граница суток: %s", (tz, before, after, dayBefore, dayAfter) => {
  const shift = (day: string, n: number) =>
    new Date(Date.parse(`${day}T00:00:00.000Z`) + n * 86400000).toISOString().slice(0, 10);

  it("за секунду до полуночи сегодня = D, в полночь = D+1", () => {
    vi.setSystemTime(new Date(before));
    expect(dateInTimeZone(tz)).toBe(dayBefore);
    vi.setSystemTime(new Date(after));
    expect(dateInTimeZone(tz)).toBe(dayAfter);
  });

  it("до полуночи: сегодня D и вчера D-1 проходят, позавчера D-2 и завтра D+1 нет", () => {
    vi.setSystemTime(new Date(before));
    expect(isAllowedLogDate(utcDay(dayBefore), tz)).toBe(true);
    expect(isAllowedLogDate(utcDay(shift(dayBefore, -1)), tz)).toBe(true);
    expect(isAllowedLogDate(utcDay(shift(dayBefore, -2)), tz)).toBe(false);
    expect(isAllowedLogDate(utcDay(shift(dayBefore, 1)), tz)).toBe(false);
  });

  it("после полуночи окно сдвигается: D+1 и D проходят, D-1 уже нет, D+2 нет", () => {
    vi.setSystemTime(new Date(after));
    expect(isAllowedLogDate(utcDay(dayAfter), tz)).toBe(true);
    expect(isAllowedLogDate(utcDay(dayBefore), tz)).toBe(true);
    expect(isAllowedLogDate(utcDay(shift(dayBefore, -1)), tz)).toBe(false);
    expect(isAllowedLogDate(utcDay(shift(dayAfter, 1)), tz)).toBe(false);
  });
});

describe("isAllowedLogDate", () => {
  it("один и тот же момент: «завтра по UTC» допустимо в Окленде, но не в Москве", () => {
    vi.setSystemTime(new Date("2026-10-06T20:00:00.000Z"));
    const tomorrow = utcDay("2026-10-07");
    expect(isAllowedLogDate(tomorrow, "Pacific/Auckland")).toBe(true);
    expect(isAllowedLogDate(tomorrow, "Europe/Moscow")).toBe(false);
    expect(isAllowedLogDate(tomorrow, "UTC")).toBe(false);
  });

  it("пояс, отстающий от UTC: Лос-Анджелес в 01:00 UTC ещё живёт вчерашним днём", () => {
    // 2026-10-07T01:00Z = 2026-10-06 18:00 в Лос-Анджелесе: вчера = 10-05
    vi.setSystemTime(new Date("2026-10-07T01:00:00.000Z"));
    expect(isAllowedLogDate(utcDay("2026-10-05"), "America/Los_Angeles")).toBe(true);
    expect(isAllowedLogDate(utcDay("2026-10-05"), "UTC")).toBe(false);
    expect(isAllowedLogDate(utcDay("2026-10-07"), "America/Los_Angeles")).toBe(false);
    expect(isAllowedLogDate(utcDay("2026-10-07"), "UTC")).toBe(true);
  });

  it("далёкие даты отклоняются", () => {
    vi.setSystemTime(new Date("2026-10-06T12:00:00.000Z"));
    for (const day of ["2020-01-01", "2026-09-01", "2026-12-31", "2030-10-06"]) {
      expect(isAllowedLogDate(utcDay(day), "UTC")).toBe(false);
    }
  });

  it("переход через год: 2027-01-01 по UTC, вчера = 2026-12-31", () => {
    vi.setSystemTime(new Date("2027-01-01T05:00:00.000Z"));
    expect(isAllowedLogDate(utcDay("2027-01-01"), "UTC")).toBe(true);
    expect(isAllowedLogDate(utcDay("2026-12-31"), "UTC")).toBe(true);
    expect(isAllowedLogDate(utcDay("2026-12-30"), "UTC")).toBe(false);
    expect(isAllowedLogDate(utcDay("2027-01-02"), "UTC")).toBe(false);
  });

  it("сравнивается только календарный день даты (время в Date не влияет)", () => {
    vi.setSystemTime(new Date("2026-10-06T12:00:00.000Z"));
    expect(isAllowedLogDate(new Date("2026-10-06T23:59:59.000Z"), "UTC")).toBe(true);
  });
});
