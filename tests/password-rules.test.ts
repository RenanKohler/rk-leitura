import { describe, expect, it } from "vitest";
import { passwordProblem, PASSWORD_TOO_LONG, PASSWORD_TOO_SHORT } from "@/lib/password-rules";

describe("regras de senha (US-190)", () => {
  it("recusa senha curta", () => {
    expect(passwordProblem("1234567")).toBe(PASSWORD_TOO_SHORT);
  });

  it("aceita ate 72 bytes", () => {
    expect(passwordProblem("a".repeat(72))).toBeNull();
  });

  it("recusa acima de 72 bytes", () => {
    expect(passwordProblem("a".repeat(73))).toBe(PASSWORD_TOO_LONG);
  });

  it("conta bytes, nao caracteres: acento vale dois", () => {
    // 37 caracteres acentuados = 74 bytes.
    expect(passwordProblem("é".repeat(37))).toBe(PASSWORD_TOO_LONG);
    expect(passwordProblem("é".repeat(36))).toBeNull();
  });
});
