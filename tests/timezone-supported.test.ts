import { describe, expect, it } from "vitest";
import { POPULAR_TIME_ZONES, isSupportedTimeZone } from "@/lib/timezone";

describe("isSupportedTimeZone", () => {
  it.each(["UTC", "Europe/Moscow", "America/New_York", "America/Los_Angeles", "Asia/Tokyo", "Pacific/Auckland", "Europe/Berlin"])(
    "IANA-имя %s допустимо",
    (tz) => {
      expect(isSupportedTimeZone(tz)).toBe(true);
    },
  );

  it("UTC допустим всегда, даже если Intl.supportedValuesOf его не перечисляет", () => {
    expect(isSupportedTimeZone("UTC")).toBe(true);
  });

  it.each(["+23:59", "-05:00", "+03:00", "GMT+3", "UTC+3", "Mars/Base", "Nowhere/City", "Europe", "<script>", "../etc"])(
    "смещение или мусор %j недопустимо",
    (tz) => {
      expect(isSupportedTimeZone(tz)).toBe(false);
    },
  );

  it.each(["", " ", "   ", " Europe/Moscow", "Europe/Moscow ", "\n"])(
    "пустое значение или пробелы по краям %j недопустимо (без trim)",
    (tz) => {
      expect(isSupportedTimeZone(tz)).toBe(false);
    },
  );

  it("регистр важен: europe/moscow и utc недопустимы", () => {
    expect(isSupportedTimeZone("europe/moscow")).toBe(false);
    expect(isSupportedTimeZone("utc")).toBe(false);
  });

  it.each([undefined, null, 0, 5, true, {}, [], ["UTC"]])("не строка (%j) недопустимо", (v) => {
    expect(isSupportedTimeZone(v)).toBe(false);
  });

  it("повторные вызовы дают тот же результат (кеш набора не ломает ответы)", () => {
    for (let i = 0; i < 3; i++) {
      expect(isSupportedTimeZone("Europe/Moscow")).toBe(true);
      expect(isSupportedTimeZone("+23:59")).toBe(false);
    }
  });

  // Если этот тест падает на конкретном поясе, то в выпадающем списке интерфейса есть пояс,
  // который сервер потом отклонит (зависит от версии ICU в Node, например Europe/Kyiv и Europe/Kiev)
  it("каждый пояс из POPULAR_TIME_ZONES принимается сервером", () => {
    const rejected = POPULAR_TIME_ZONES.filter((tz) => !isSupportedTimeZone(tz));
    expect(rejected).toEqual([]);
  });
});
