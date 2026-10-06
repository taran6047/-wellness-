import { describe, expect, it } from "vitest";
import { BCRYPT_COST } from "@/lib/constants";

describe("constants", () => {
  it("BCRYPT_COST экспортируется и равен 10", () => {
    expect(BCRYPT_COST).toBe(10);
  });
});
