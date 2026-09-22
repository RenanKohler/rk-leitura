import { describe, expect, it } from "vitest";
import { DAILY_QUOTAS, quotaKey, secondsUntilNextDay } from "@/lib/quota";

describe("cota diaria por conta", () => {
  it("tem os tetos combinados na US-72", () => {
    expect(DAILY_QUOTAS.questionario).toBe(20);
    expect(DAILY_QUOTAS.dicionario).toBe(200);
  });

  it("a chave depende da conta e do dia, nao do endereco IP", () => {
    expect(quotaKey("questionario", "u1", "2026-09-22")).toBe("questionario-dia:u1:2026-09-22");
    expect(quotaKey("questionario", "u1", "2026-09-23")).not.toBe(
      quotaKey("questionario", "u1", "2026-09-22")
    );
    expect(quotaKey("dicionario", "u1", "2026-09-22")).not.toBe(
      quotaKey("questionario", "u1", "2026-09-22")
    );
  });

  it("conta os segundos ate a meia-noite no fuso do usuario", () => {
    // 12:00 UTC = 09:00 em Sao Paulo: faltam 15 horas para a meia-noite de la.
    const agora = new Date("2026-09-22T12:00:00Z");
    expect(secondsUntilNextDay("America/Sao_Paulo", agora)).toBe(15 * 3600);
    expect(secondsUntilNextDay("UTC", agora)).toBe(12 * 3600);
  });

  it("nunca devolve zero", () => {
    expect(secondsUntilNextDay("UTC", new Date("2026-09-22T23:59:59.900Z"))).toBe(1);
  });
});
