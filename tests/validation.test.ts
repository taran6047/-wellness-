import { describe, expect, it } from "vitest";
import {
  createFamilySchema,
  joinFamilySchema,
  loginSchema,
  registerSchema,
  timeZoneSchema,
} from "@/lib/validation";

const PASSWORD_TOO_LONG =
  "Пароль слишком длинный (максимум 72 байта; кириллица занимает по 2 байта)";

const createBase = {
  mode: "create" as const,
  name: "Анна",
  email: "anna@example.com",
  password: "password123",
  familyName: "Ивановы",
};

const joinBase = {
  mode: "join" as const,
  name: "Петя",
  email: "petya@example.com",
  password: "password123",
  role: "child" as const,
  inviteCode: "ABCD2345",
};

function firstError(result: { success: boolean; error?: { issues: { message: string }[] } }) {
  expect(result.success).toBe(false);
  return result.error!.issues[0].message;
}

describe("validation: email", () => {
  it("принимает корректный email и приводит к нижнему регистру с обрезкой пробелов", () => {
    const r = createFamilySchema.safeParse({ ...createBase, email: "  Anna@Example.COM " });
    expect(r.success).toBe(true);
    expect(r.data!.email).toBe("anna@example.com");
  });

  it.each(["", "abc", "a@", "@b.com", "a b@c.com"])("отклоняет невалидный email %j", (email) => {
    const r = createFamilySchema.safeParse({ ...createBase, email });
    expect(firstError(r)).toBe("Введите корректный email");
  });

  it("отклоняет email длиннее 254 символов", () => {
    const email = `${"a".repeat(64)}@${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(63)}.com`;
    expect(email.length).toBeGreaterThan(254);
    const r = createFamilySchema.safeParse({ ...createBase, email });
    expect(r.success).toBe(false);
  });
});

describe("validation: пароль", () => {
  it("принимает пароль ровно 8 символов и ровно 72 ASCII-символа (72 байта)", () => {
    expect(createFamilySchema.safeParse({ ...createBase, password: "a".repeat(8) }).success).toBe(true);
    expect(createFamilySchema.safeParse({ ...createBase, password: "a".repeat(72) }).success).toBe(true);
  });

  it("принимает 36 кириллических символов (72 байта), отклоняет 37 (74 байта)", () => {
    expect(createFamilySchema.safeParse({ ...createBase, password: "я".repeat(36) }).success).toBe(true);
    const r = createFamilySchema.safeParse({ ...createBase, password: "я".repeat(37) });
    expect(firstError(r)).toBe(PASSWORD_TOO_LONG);
  });

  it("считает байты, а не символы: 71 ASCII + 1 кириллица = 73 байта отклоняется", () => {
    const password = "a".repeat(71) + "я";
    expect(createFamilySchema.safeParse({ ...createBase, password }).success).toBe(false);
    expect(createFamilySchema.safeParse({ ...createBase, password: "a".repeat(70) + "я" }).success).toBe(true);
  });

  it("то же ограничение в joinFamilySchema", () => {
    expect(joinFamilySchema.safeParse({ ...joinBase, password: "я".repeat(36) }).success).toBe(true);
    expect(firstError(joinFamilySchema.safeParse({ ...joinBase, password: "я".repeat(37) }))).toBe(
      PASSWORD_TOO_LONG,
    );
  });

  it("отклоняет пароль короче 8 символов с русским сообщением", () => {
    const r = createFamilySchema.safeParse({ ...createBase, password: "a".repeat(7) });
    expect(firstError(r)).toBe("Пароль должен быть не короче 8 символов");
  });

  it("отклоняет пароль длиннее 72 байт (73 ASCII-символа) с русским сообщением", () => {
    const r = createFamilySchema.safeParse({ ...createBase, password: "a".repeat(73) });
    expect(firstError(r)).toBe(PASSWORD_TOO_LONG);
  });

  it("не обрезает пробелы в пароле", () => {
    const r = createFamilySchema.safeParse({ ...createBase, password: "  pass word  " });
    expect(r.success).toBe(true);
    expect(r.data!.password).toBe("  pass word  ");
  });
});

describe("validation: имя", () => {
  it("принимает имя и обрезает пробелы", () => {
    const r = createFamilySchema.safeParse({ ...createBase, name: "  Анна  " });
    expect(r.data!.name).toBe("Анна");
  });

  it("отклоняет пустое имя и имя из пробелов", () => {
    expect(firstError(createFamilySchema.safeParse({ ...createBase, name: "" }))).toBe("Введите имя");
    expect(firstError(createFamilySchema.safeParse({ ...createBase, name: "   " }))).toBe("Введите имя");
  });

  it("граница 50 символов", () => {
    expect(createFamilySchema.safeParse({ ...createBase, name: "я".repeat(50) }).success).toBe(true);
    const r = createFamilySchema.safeParse({ ...createBase, name: "я".repeat(51) });
    expect(firstError(r)).toBe("Имя должно быть не длиннее 50 символов");
  });
});

describe("validation: роль", () => {
  it.each(["adult", "child"])("принимает роль %s", (role) => {
    expect(joinFamilySchema.safeParse({ ...joinBase, role }).success).toBe(true);
  });

  it.each(["admin", "", "ADULT", "parent"])("отклоняет роль %j", (role) => {
    const r = joinFamilySchema.safeParse({ ...joinBase, role });
    expect(firstError(r)).toBe("Выберите роль");
  });

  it("отклоняет отсутствующую роль (null из formData)", () => {
    expect(joinFamilySchema.safeParse({ ...joinBase, role: null }).success).toBe(false);
    expect(joinFamilySchema.safeParse({ ...joinBase, role: undefined }).success).toBe(false);
  });
});

describe("validation: название семьи", () => {
  it("принимает название и обрезает пробелы", () => {
    const r = createFamilySchema.safeParse({ ...createBase, familyName: "  Ивановы " });
    expect(r.data!.familyName).toBe("Ивановы");
  });

  it("отклоняет пустое название", () => {
    const r = createFamilySchema.safeParse({ ...createBase, familyName: "  " });
    expect(firstError(r)).toBe("Введите название семьи");
  });

  it("граница 60 символов", () => {
    expect(createFamilySchema.safeParse({ ...createBase, familyName: "с".repeat(60) }).success).toBe(true);
    const r = createFamilySchema.safeParse({ ...createBase, familyName: "с".repeat(61) });
    expect(firstError(r)).toBe("Название семьи должно быть не длиннее 60 символов");
  });
});

describe("validation: код приглашения", () => {
  it("приводит к верхнему регистру и обрезает пробелы", () => {
    const r = joinFamilySchema.safeParse({ ...joinBase, inviteCode: "  abcd2345 " });
    expect(r.data!.inviteCode).toBe("ABCD2345");
  });

  it("отклоняет пустой код", () => {
    const r = joinFamilySchema.safeParse({ ...joinBase, inviteCode: "   " });
    expect(firstError(r)).toBe("Введите код приглашения");
  });

  it("отклоняет код длиннее 32 символов", () => {
    const r = joinFamilySchema.safeParse({ ...joinBase, inviteCode: "A".repeat(33) });
    expect(firstError(r)).toBe("Неверный код приглашения");
  });
});

describe("validation: registerSchema (по mode)", () => {
  it("разбирает create и join", () => {
    expect(registerSchema.safeParse(createBase).success).toBe(true);
    expect(registerSchema.safeParse(joinBase).success).toBe(true);
  });

  it("отклоняет неизвестный или отсутствующий mode", () => {
    expect(registerSchema.safeParse({ ...createBase, mode: "other" }).success).toBe(false);
    expect(registerSchema.safeParse({ ...createBase, mode: null }).success).toBe(false);
  });

  it("create требует familyName, join требует inviteCode и role", () => {
    const { familyName: _f, ...noFamily } = createBase;
    expect(registerSchema.safeParse(noFamily).success).toBe(false);
    const { inviteCode: _i, ...noCode } = joinBase;
    expect(registerSchema.safeParse(noCode).success).toBe(false);
  });
});

describe("validation: timeZone", () => {
  it("create и join: отсутствующий пояс = UTC", () => {
    expect(createFamilySchema.parse(createBase).timeZone).toBe("UTC");
    expect(joinFamilySchema.parse(joinBase).timeZone).toBe("UTC");
    expect(registerSchema.parse(createBase)).toMatchObject({ timeZone: "UTC" });
  });

  it("null из formData (поле не передано) = UTC", () => {
    expect(createFamilySchema.parse({ ...createBase, timeZone: null }).timeZone).toBe("UTC");
  });

  it("валидный IANA-пояс сохраняется", () => {
    expect(createFamilySchema.parse({ ...createBase, timeZone: "Europe/Moscow" }).timeZone).toBe(
      "Europe/Moscow",
    );
    expect(joinFamilySchema.parse({ ...joinBase, timeZone: "America/Los_Angeles" }).timeZone).toBe(
      "America/Los_Angeles",
    );
  });

  it.each(["Mars/Base", "", "   ", 42, {}])("невалидный пояс %j заменяется на UTC, регистрация не падает", (tz) => {
    const r = createFamilySchema.safeParse({ ...createBase, timeZone: tz });
    expect(r.success).toBe(true);
    expect(r.data!.timeZone).toBe("UTC");
  });

  it("timeZoneSchema: пробелы обрезаются, мусор -> UTC", () => {
    expect(timeZoneSchema.parse(" Asia/Tokyo ")).toBe("Asia/Tokyo");
    expect(timeZoneSchema.parse(undefined)).toBe("UTC");
    expect(timeZoneSchema.parse("не пояс")).toBe("UTC");
  });

  it("timeZoneSchema: пробелы и переводы строк по краям обрезаются у валидных поясов", () => {
    expect(timeZoneSchema.parse("  Europe/Moscow  ")).toBe("Europe/Moscow");
    expect(timeZoneSchema.parse("\tAmerica/Los_Angeles\n")).toBe("America/Los_Angeles");
    expect(timeZoneSchema.parse(" UTC ")).toBe("UTC");
  });

  it.each(["Europe/Moscow", "UTC", "America/Los_Angeles"])("timeZoneSchema: %s сохраняется как есть", (tz) => {
    expect(timeZoneSchema.parse(tz)).toBe(tz);
  });

  it.each(["+23:59", "-05:00", "+03:00", "GMT+3", "UTC+3", "Etc/GMT+3x", "<script>", "../etc", "Europe"])(
    "timeZoneSchema: смещение или чужое значение %j -> UTC",
    (tz) => {
      expect(timeZoneSchema.parse(tz)).toBe("UTC");
    },
  );

  it.each(["utc", "europe/moscow", "EUROPE/MOSCOW"])("timeZoneSchema: регистр важен, %j -> UTC", (tz) => {
    expect(timeZoneSchema.parse(tz)).toBe("UTC");
  });

  it("timeZoneSchema: Asia/Calcutta сохраняется, только если есть в Intl.supportedValuesOf, иначе UTC", () => {
    const supported = Intl.supportedValuesOf("timeZone").includes("Asia/Calcutta");
    expect(timeZoneSchema.parse("Asia/Calcutta")).toBe(supported ? "Asia/Calcutta" : "UTC");
  });

  it.each([null, 0, 42, true, {}, [], ["Europe/Moscow"]])("timeZoneSchema: не-строка %j -> UTC", (v) => {
    expect(timeZoneSchema.parse(v)).toBe("UTC");
  });

  it("create/join: +23:59 и GMT+3 не ломают регистрацию, пояс становится UTC", () => {
    for (const tz of ["+23:59", "GMT+3", "utc"]) {
      const c = createFamilySchema.safeParse({ ...createBase, timeZone: tz });
      expect(c.success).toBe(true);
      expect(c.data!.timeZone).toBe("UTC");
      const j = joinFamilySchema.safeParse({ ...joinBase, timeZone: tz });
      expect(j.success).toBe(true);
      expect(j.data!.timeZone).toBe("UTC");
    }
  });

  it("create/join: пояс с пробелами по краям обрезается", () => {
    expect(createFamilySchema.parse({ ...createBase, timeZone: " Europe/Moscow " }).timeZone).toBe("Europe/Moscow");
    expect(joinFamilySchema.parse({ ...joinBase, timeZone: " Asia/Tokyo " }).timeZone).toBe("Asia/Tokyo");
  });
});

describe("validation: loginSchema", () => {
  it("нормализует email и принимает любой непустой пароль", () => {
    const r = loginSchema.safeParse({ email: " A@B.com ", password: "x" });
    expect(r.success).toBe(true);
    expect(r.data!.email).toBe("a@b.com");
  });

  it("отклоняет пустой пароль и null (поля отсутствуют в formData)", () => {
    expect(loginSchema.safeParse({ email: "a@b.com", password: "" }).success).toBe(false);
    expect(loginSchema.safeParse({ email: null, password: null }).success).toBe(false);
  });

  it("email: ровно 254 символа проходит, 255 отклоняется", () => {
    expect(loginSchema.safeParse({ email: "a".repeat(254), password: "x" }).success).toBe(true);
    expect(loginSchema.safeParse({ email: "a".repeat(255), password: "x" }).success).toBe(false);
  });

  it("пароль: 72 байта проходят, 73 ASCII и 37 кириллических символов отклоняются", () => {
    expect(loginSchema.safeParse({ email: "a@b.com", password: "a".repeat(72) }).success).toBe(true);
    expect(loginSchema.safeParse({ email: "a@b.com", password: "я".repeat(36) }).success).toBe(true);
    expect(firstError(loginSchema.safeParse({ email: "a@b.com", password: "a".repeat(73) }))).toBe(
      PASSWORD_TOO_LONG,
    );
    expect(firstError(loginSchema.safeParse({ email: "a@b.com", password: "я".repeat(37) }))).toBe(
      PASSWORD_TOO_LONG,
    );
  });
});
