import { describe, expect, it } from "vitest";
import { DAILY_QUOTAS, quotaKey, releaseUnits, reserveUnits, secondsUntilNextDay } from "@/lib/quota";

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

describe("reserva e devolucao de cota (US-207)", () => {
  it("reserva tudo quando cabe", () => {
    expect(reserveUnits(10, 5, 200)).toEqual({ count: 15, granted: 5 });
  });

  it("para no teto e devolve so o que coube", () => {
    expect(reserveUnits(195, 10, 200)).toEqual({ count: 200, granted: 5 });
    expect(reserveUnits(200, 3, 200)).toEqual({ count: 200, granted: 0 });
  });

  it("nao mexe num contador acima do teto", () => {
    expect(reserveUnits(25, 4, 20)).toEqual({ count: 25, granted: 0 });
  });

  it("pedido vazio ou negativo nao reserva nada", () => {
    expect(reserveUnits(10, 0, 200)).toEqual({ count: 10, granted: 0 });
    expect(reserveUnits(10, -2, 200)).toEqual({ count: 10, granted: 0 });
  });

  it("devolve unidades sem passar de zero", () => {
    expect(releaseUnits(10, 3)).toBe(7);
    expect(releaseUnits(2, 5)).toBe(0);
    expect(releaseUnits(4, 0)).toBe(4);
  });

  it("reservar e devolver o mesmo lote volta ao ponto de partida", () => {
    const { count, granted } = reserveUnits(40, 30, 200);
    expect(releaseUnits(count, granted)).toBe(40);
  });

  it("o dia novo comeca outro contador, com a cota inteira", () => {
    const ontem = quotaKey("dicionario", "u1", "2026-09-22");
    const hoje = quotaKey("dicionario", "u1", "2026-09-23");
    expect(hoje).not.toBe(ontem);
    // Contador novo comeca em zero: o teto inteiro cabe.
    expect(reserveUnits(0, 250, DAILY_QUOTAS.dicionario).granted).toBe(DAILY_QUOTAS.dicionario);
  });
});
