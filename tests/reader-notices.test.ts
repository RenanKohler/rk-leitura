import { describe, expect, it } from "vitest";
import { SUGGESTION_ORDER, visibleSuggestion } from "@/lib/reader-notices";

const all = { recapitular: true, capitulo: true, checagem: true, velocidade: true };

describe("visibleSuggestion (US-219)", () => {
  it("sem nada pendente nao ha sugestao", () => {
    expect(visibleSuggestion({ pending: {}, blocked: false, settled: false })).toBeNull();
  });

  it("com varias pendentes aparece so a de maior prioridade", () => {
    expect(visibleSuggestion({ pending: all, blocked: false, settled: false })).toBe("recapitular");
    expect(
      visibleSuggestion({
        pending: { checagem: true, velocidade: true },
        blocked: false,
        settled: false,
      })
    ).toBe("checagem");
    expect(
      visibleSuggestion({ pending: { velocidade: true }, blocked: false, settled: false })
    ).toBe("velocidade");
  });

  it("a ordem e recapitular, capitulo, checagem, velocidade", () => {
    expect(SUGGESTION_ORDER).toEqual(["recapitular", "capitulo", "checagem", "velocidade"]);
    const pending: Record<string, boolean> = { ...all };
    for (const expected of SUGGESTION_ORDER) {
      expect(visibleSuggestion({ pending, blocked: false, settled: false })).toBe(expected);
      pending[expected] = false;
    }
    expect(visibleSuggestion({ pending, blocked: false, settled: false })).toBeNull();
  });

  it("aviso de estado ou controle aberto faz a sugestao esperar", () => {
    expect(visibleSuggestion({ pending: all, blocked: true, settled: false })).toBeNull();
  });

  it("depois de responder uma, as outras esperam a proxima pausa", () => {
    expect(
      visibleSuggestion({ pending: { velocidade: true }, blocked: false, settled: true })
    ).toBeNull();
  });
});
