import { describe, expect, it } from "vitest";
import { sessionPruneCutoffs, sessionValidSince } from "@/lib/account-security";

const WEEK = 7 * 24 * 60 * 60;
const now = new Date("2026-10-24T12:00:00Z");

describe("aparelhos com sessao valida (US-188)", () => {
  it("token emitido ha mais de 7 dias ja venceu", () => {
    expect(sessionValidSince(now, WEEK).toISOString()).toBe("2026-10-17T12:00:00.000Z");
  });

  it("limpa revogadas ha 30 dias e vencidas ha 30 dias", () => {
    const { revokedBefore, issuedBefore } = sessionPruneCutoffs(now, WEEK);
    expect(revokedBefore.toISOString()).toBe("2026-09-24T12:00:00.000Z");
    // Venceu 7 dias depois de emitido: emitido ha 37 dias venceu ha 30.
    expect(issuedBefore.toISOString()).toBe("2026-09-17T12:00:00.000Z");
  });
});
