import { describe, expect, it } from "vitest";
import {
  acceptsPosition,
  LIVE_SAVE_WINDOW_MS,
  newerPosition,
  OFFLINE_TEXTS,
  queueable,
} from "@/lib/offline";

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

describe("acceptsPosition", () => {
  const servidor = new Date("2026-09-19T12:00:00Z");
  const gravadoAgora = new Date("2026-09-19T11:59:58Z");

  it("save feito agora vence mesmo com o relogio do aparelho atrasado", () => {
    // Aparelho 3 minutos atrasado: o `at` e anterior a ultima gravacao, que
    // usou a hora do servidor. Antes o save era descartado em silencio.
    expect(acceptsPosition("2026-09-19T11:57:00Z", gravadoAgora, servidor)).toBe(true);
  });

  it("save feito agora vence com o relogio adiantado", () => {
    expect(acceptsPosition("2026-09-19T12:04:00Z", gravadoAgora, servidor)).toBe(true);
  });

  it("save da fila offline mais antigo que a ultima gravacao perde", () => {
    expect(acceptsPosition("2026-09-19T09:00:00Z", gravadoAgora, servidor)).toBe(false);
  });

  it("save da fila offline mais novo que a ultima gravacao vence", () => {
    const gravadoCedo = new Date("2026-09-19T08:00:00Z");
    expect(acceptsPosition("2026-09-19T09:00:00Z", gravadoCedo, servidor)).toBe(true);
  });

  it("sem data, ou com data invalida, e um save de agora", () => {
    expect(acceptsPosition(null, gravadoAgora, servidor)).toBe(true);
    expect(acceptsPosition("ontem", gravadoAgora, servidor)).toBe(true);
  });

  it("a janela de agora tem cinco minutos", () => {
    const limite = new Date(servidor.getTime() - LIVE_SAVE_WINDOW_MS).toISOString();
    expect(acceptsPosition(limite, gravadoAgora, servidor)).toBe(false);
  });
});

describe("limites", () => {
  it("guarda uma biblioteca recente, nao a inteira", () => {
    expect(OFFLINE_TEXTS).toBeGreaterThan(5);
    expect(OFFLINE_TEXTS).toBeLessThanOrEqual(50);
  });
});
