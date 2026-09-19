import { describe, expect, it } from "vitest";
import { decide } from "@/lib/rate-limit";

const agora = new Date("2026-09-19T12:00:00Z");
const daqui = (segundos: number) => new Date(agora.getTime() + segundos * 1000);

describe("decide", () => {
  it("libera enquanto a contagem cabe no limite", () => {
    expect(decide(1, 10, daqui(900), agora)).toEqual({ allowed: true, retryAfterSeconds: 0 });
    expect(decide(10, 10, daqui(900), agora)).toEqual({ allowed: true, retryAfterSeconds: 0 });
  });

  it("recusa a primeira que passa do limite", () => {
    const resultado = decide(11, 10, daqui(900), agora);
    expect(resultado.allowed).toBe(false);
    expect(resultado.retryAfterSeconds).toBe(900);
  });

  it("o tempo de espera encolhe conforme a janela corre", () => {
    expect(decide(11, 10, daqui(60), agora).retryAfterSeconds).toBe(60);
    expect(decide(11, 10, daqui(5), agora).retryAfterSeconds).toBe(5);
  });

  it("nunca manda esperar zero segundo", () => {
    expect(decide(11, 10, daqui(0), agora).retryAfterSeconds).toBe(1);
    expect(decide(11, 10, daqui(-30), agora).retryAfterSeconds).toBe(1);
  });

  it("o limite vale por chave, nao por instancia", () => {
    // A contagem chega pronta do banco: a decima primeira e recusada mesmo
    // que cada tentativa tenha chegado a uma instancia diferente.
    expect(decide(11, 10, daqui(900), agora).allowed).toBe(false);
  });
});
