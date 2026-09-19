import { describe, expect, it } from "vitest";
import { newerPosition, OFFLINE_TEXTS, queueable } from "@/lib/offline";

describe("queueable", () => {
  it("aceita o salvamento de posicao", () => {
    expect(queueable("/api/texts/8c84559e-02b1-4506-a733-0f12633392df", "PATCH")).toBe(true);
  });

  it("aceita o registro de sessao", () => {
    expect(queueable("/api/reading-sessions", "POST")).toBe(true);
  });

  it("recusa o que depende da origem", () => {
    expect(queueable("/api/import-url", "POST")).toBe(false);
    expect(queueable("/api/texts/abc/continuar", "POST")).toBe(false);
  });

  it("recusa leitura e remocao", () => {
    expect(queueable("/api/reading-sessions", "GET")).toBe(false);
    expect(queueable("/api/texts/8c84559e-02b1-4506-a733-0f12633392df", "DELETE")).toBe(false);
  });
});

describe("newerPosition", () => {
  it("vence a posicao com data mais recente", () => {
    const escolhida = newerPosition(
      { progressIndex: 40, at: "2026-09-19T10:00:00Z" },
      { progressIndex: 300, at: "2026-09-19T09:00:00Z" }
    );
    expect(escolhida).toBe(40);
  });

  it("nao confunde mais recente com maior", () => {
    const escolhida = newerPosition(
      { progressIndex: 300, at: "2026-09-19T09:00:00Z" },
      { progressIndex: 0, at: "2026-09-19T10:00:00Z" }
    );
    expect(escolhida).toBe(0);
  });

  it("empate fica com o servidor", () => {
    const mesmo = "2026-09-19T10:00:00Z";
    expect(newerPosition({ progressIndex: 40, at: mesmo }, { progressIndex: 90, at: mesmo })).toBe(40);
  });

  it("quem tem data ganha de quem nao tem", () => {
    expect(newerPosition({ progressIndex: 40, at: "2026-09-19T10:00:00Z" }, { progressIndex: 90 })).toBe(40);
    expect(newerPosition({ progressIndex: 40 }, { progressIndex: 90, at: "2026-09-19T10:00:00Z" })).toBe(90);
  });

  it("sem data dos dois lados, o servidor manda", () => {
    expect(newerPosition({ progressIndex: 40 }, { progressIndex: 90 })).toBe(90);
  });

  it("data invalida conta como ausente", () => {
    expect(newerPosition({ progressIndex: 40, at: "ontem" }, { progressIndex: 90 })).toBe(90);
  });
});

describe("limites", () => {
  it("guarda uma biblioteca recente, nao a inteira", () => {
    expect(OFFLINE_TEXTS).toBeGreaterThan(5);
    expect(OFFLINE_TEXTS).toBeLessThanOrEqual(50);
  });
});
