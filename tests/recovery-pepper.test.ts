import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => ({ db: {} }));

const { hashRecoveryCode, recoveryHashCandidates } = await import("@/lib/recovery");

const OLD_SECRET = "a".repeat(40);
const NEW_SECRET = "b".repeat(40);
const CODE = "ABCD-EFGH-JKLM";

describe("codigos de recuperacao e troca do segredo (US-191)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("sem RECOVERY_PEPPER, o tempero e o JWT_SECRET, como antes", () => {
    vi.stubEnv("JWT_SECRET", OLD_SECRET);
    vi.stubEnv("RECOVERY_PEPPER", "");
    expect(hashRecoveryCode(CODE)).toBe(hashRecoveryCode(CODE, OLD_SECRET));
    expect(recoveryHashCandidates(CODE)).toHaveLength(1);
  });

  it("com RECOVERY_PEPPER, trocar o JWT_SECRET nao muda o hash", () => {
    vi.stubEnv("RECOVERY_PEPPER", "tempero-fixo-de-recuperacao-1234567890");
    vi.stubEnv("JWT_SECRET", OLD_SECRET);
    const before = hashRecoveryCode(CODE);
    vi.stubEnv("JWT_SECRET", NEW_SECRET);
    expect(hashRecoveryCode(CODE)).toBe(before);
  });

  it("na transicao, o codigo gravado com o JWT_SECRET ainda e aceito", () => {
    vi.stubEnv("JWT_SECRET", OLD_SECRET);
    const legacy = hashRecoveryCode(CODE, OLD_SECRET);
    vi.stubEnv("RECOVERY_PEPPER", "tempero-fixo-de-recuperacao-1234567890");
    expect(recoveryHashCandidates(CODE)).toContain(legacy);
    expect(recoveryHashCandidates(CODE)[0]).toBe(hashRecoveryCode(CODE));
  });
});
