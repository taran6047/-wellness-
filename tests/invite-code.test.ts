import { describe, expect, it } from "vitest";
import { generateInviteCode } from "@/lib/invite-code";

describe("generateInviteCode", () => {
  it("по умолчанию возвращает код длиной 8", () => {
    expect(generateInviteCode()).toHaveLength(8);
  });

  it("учитывает заданную длину", () => {
    expect(generateInviteCode(12)).toHaveLength(12);
    expect(generateInviteCode(0)).toBe("");
  });

  it("использует только заглавные буквы и цифры без похожих символов (0, O, 1, I)", () => {
    for (let i = 0; i < 500; i++) {
      const code = generateInviteCode();
      expect(code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
      expect(code).not.toMatch(/[01OI]/);
    }
  });

  it("коды различаются между вызовами", () => {
    const codes = new Set(Array.from({ length: 200 }, () => generateInviteCode()));
    expect(codes.size).toBe(200);
  });
});
