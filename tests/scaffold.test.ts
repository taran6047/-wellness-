import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");

describe("prisma/schema.prisma", () => {
  const schema = read("prisma/schema.prisma");

  const models = [
    "Family",
    "User",
    "ActivityLog",
    "MealLog",
    "WaterLog",
    "HealthLog",
    "PointsEvent",
    "Achievement",
    "UserAchievement",
    "FamilyGoal",
  ];

  const block = (kind: "model" | "enum", name: string) =>
    schema.match(new RegExp(`${kind}\\s+${name}\\s*\\{([\\s\\S]*?)\\n\\}`))?.[1];

  it.each(models)("содержит модель %s", (name) => {
    expect(block("model", name)).toBeDefined();
  });

  it("enum Role содержит ровно adult и child", () => {
    const body = block("enum", "Role");
    expect(body).toBeDefined();
    const values = body!
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    expect(values.sort()).toEqual(["adult", "child"]);
  });

  it("у Family есть уникальное поле inviteCode", () => {
    expect(block("model", "Family")).toMatch(/inviteCode\s+String\s+@unique/);
  });

  it("у User есть поле role типа Role", () => {
    expect(block("model", "User")).toMatch(/role\s+Role/);
  });

  it("использует PostgreSQL и DATABASE_URL", () => {
    expect(schema).toMatch(/provider\s*=\s*"postgresql"/);
    expect(schema).toMatch(/url\s*=\s*env\("DATABASE_URL"\)/);
  });
});

describe(".env.example и .gitignore", () => {
  it(".env.example существует и задаёт DATABASE_URL", () => {
    expect(fs.existsSync(path.join(root, ".env.example"))).toBe(true);
    expect(read(".env.example")).toMatch(/^DATABASE_URL=/m);
  });

  it(".env.example не содержит реальных секретов", () => {
    const lines = read(".env.example")
      .split(/\r?\n/)
      .filter((l) => l.trim() && !l.trim().startsWith("#"));
    for (const line of lines) {
      const value = line.slice(line.indexOf("=") + 1).replace(/^"|"$/g, "");
      // Пароль в URL должен быть плейсхолдером
      const pwd = value.match(/^\w+:\/\/[^:]+:([^@]*)@/)?.[1];
      if (pwd !== undefined) {
        expect(["password", "pass", "changeme", "your_password", "postgres", ""]).toContain(
          pwd.toLowerCase(),
        );
      }
      // Никаких длинных случайных токенов
      expect(value).not.toMatch(/[A-Za-z0-9_\-]{32,}/);
    }
  });

  it(".gitignore содержит .env", () => {
    const lines = read(".gitignore")
      .split(/\r?\n/)
      .map((l) => l.trim());
    expect(lines).toContain(".env");
  });
});

describe("package.json", () => {
  const pkg = JSON.parse(read("package.json"));

  it("содержит скрипты test и build", () => {
    expect(pkg.scripts.test).toBeTruthy();
    expect(pkg.scripts.build).toBeTruthy();
  });

  it("test запускает vitest, build запускает next build", () => {
    expect(pkg.scripts.test).toContain("vitest");
    expect(pkg.scripts.build).toContain("next build");
  });
});
