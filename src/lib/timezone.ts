export const DEFAULT_TIME_ZONE = "UTC";

export const DATE_WINDOW_ERROR =
  "Можно отметить только сегодняшний или вчерашний день";

// Допустимое IANA-имя пояса; неизвестное значение заменяется на UTC
export function normalizeTimeZone(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") return DEFAULT_TIME_ZONE;
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: value.trim() })
      .resolvedOptions().timeZone;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}

let supportedZones: Set<string> | null = null;

// Допустимые для смены пояса значения: IANA-имена из Intl.supportedValuesOf и «UTC»
// (смещения вроде +23:59 не принимаются)
export function isSupportedTimeZone(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (!supportedZones) {
    supportedZones = new Set([
      DEFAULT_TIME_ZONE,
      ...Intl.supportedValuesOf("timeZone"),
    ]);
    // В зависимости от версии ICU Киев называется Kiev или Kyiv: принимаем оба
    if (supportedZones.has("Europe/Kiev")) supportedZones.add("Europe/Kyiv");
    if (supportedZones.has("Europe/Kyiv")) supportedZones.add("Europe/Kiev");
  }
  return supportedZones.has(value);
}

// Дата YYYY-MM-DD «сейчас + offsetDays» в заданном часовом поясе
export function dateInTimeZone(timeZone: string, offsetDays = 0): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const todayUtcMidnight = Date.UTC(
    Number(get("year")),
    Number(get("month")) - 1,
    Number(get("day")),
  );
  return new Date(todayUtcMidnight + offsetDays * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

// date — UTC-полночь выбранного дня; разрешены только сегодня и вчера в поясе пользователя
export function isAllowedLogDate(date: Date, timeZone: string): boolean {
  const day = date.toISOString().slice(0, 10);
  return day === dateInTimeZone(timeZone) || day === dateInTimeZone(timeZone, -1);
}

export const POPULAR_TIME_ZONES = [
  "UTC",
  "Europe/Kaliningrad",
  "Europe/Moscow",
  "Europe/Samara",
  "Asia/Yekaterinburg",
  "Asia/Omsk",
  "Asia/Novosibirsk",
  "Asia/Krasnoyarsk",
  "Asia/Irkutsk",
  "Asia/Yakutsk",
  "Asia/Vladivostok",
  "Asia/Magadan",
  "Asia/Kamchatka",
  "Europe/Kyiv",
  "Europe/Minsk",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Paris",
  "Asia/Almaty",
  "Asia/Tashkent",
  "Asia/Dubai",
  "Asia/Tbilisi",
  "Asia/Yerevan",
  "Asia/Baku",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
];
