import { describe, expect, it } from "vitest";
import { clientIp, decide } from "@/lib/rate-limit";

describe("clientIp", () => {
  const pedido = (headers: Record<string, string>) =>
    new Request("http://localhost/api/auth/login", { headers });

  it("prefere o cabecalho que a borda da Vercel escreve", () => {
    const ip = clientIp(
      pedido({ "x-vercel-forwarded-for": "203.0.113.7", "x-forwarded-for": "1.2.3.4, 203.0.113.7" })
    );
    expect(ip).toBe("203.0.113.7");
  });

  it("usa x-real-ip quando nao ha o da Vercel", () => {
    const ip = clientIp(pedido({ "x-real-ip": "198.51.100.2", "x-forwarded-for": "9.9.9.9" }));
    expect(ip).toBe("198.51.100.2");
  });

  it("usa o ultimo valor de X-Forwarded-For, o que o proxy acrescentou", () => {
    expect(clientIp(pedido({ "x-forwarded-for": "10.0.0.1, 10.0.0.2, 203.0.113.9" }))).toBe(
      "203.0.113.9"
    );
    // Trocar o valor forjado pelo cliente nao muda a chave do limitador.
    expect(clientIp(pedido({ "x-forwarded-for": "forjado-1, 203.0.113.9" }))).toBe(
      clientIp(pedido({ "x-forwarded-for": "forjado-2, 203.0.113.9" }))
    );
  });

  it("com um valor so, usa esse valor (testes de ponta a ponta)", () => {
    expect(clientIp(pedido({ "x-forwarded-for": "10.20.30.40" }))).toBe("10.20.30.40");
  });

  it("sem cabecalho nenhum, cai numa chave comum", () => {
    expect(clientIp(pedido({}))).toBe("desconhecido");
  });
});

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
