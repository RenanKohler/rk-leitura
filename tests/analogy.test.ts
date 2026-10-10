import { describe, expect, it } from "vitest";
import {
  analogyPrompt,
  analogyRequest,
  analogyWordsSent,
  MAX_ANALOGY_SOURCE_WORDS,
  MAX_ANALOGY_WORDS,
  parseAnalogy,
  storedAnalogy,
} from "@/lib/analogy";

describe("analogia para cartao errado", () => {
  it("o pedido leva so frente, verso e trecho de origem", () => {
    const card = {
      front: " O que e fotossintese? ",
      back: "Producao de energia pela luz.",
      source: "As plantas usam a luz do sol.",
      analogy: "ANALOGIA ANTIGA",
      textTitle: "TITULO SECRETO",
      content: "CONTEUDO INTEIRO DO TEXTO",
    };
    const request = analogyRequest(card);
    expect(Object.keys(request).sort()).toEqual(["back", "front", "source"]);
    const prompt = analogyPrompt(request);
    expect(prompt).toContain("O que e fotossintese?");
    expect(prompt).toContain("Producao de energia pela luz.");
    expect(prompt).toContain("As plantas usam a luz do sol.");
    expect(prompt).not.toContain("ANALOGIA ANTIGA");
    expect(prompt).not.toContain("TITULO SECRETO");
    expect(prompt).not.toContain("CONTEUDO INTEIRO");
    expect(prompt).toContain(`${MAX_ANALOGY_WORDS} palavras`);
  });

  it("limita o trecho enviado e conta as palavras", () => {
    const source = Array.from({ length: 400 }, (_, index) => `p${index}`).join(" ");
    const request = analogyRequest({ front: "f", back: "v", source });
    expect(analogyWordsSent(request)).toBe(MAX_ANALOGY_SOURCE_WORDS);
    expect(analogyWordsSent(analogyRequest({ front: "f", back: "v", source: "" }))).toBe(0);
  });

  it("a analogia tem ate 50 palavras", () => {
    const long = Array.from({ length: 80 }, () => "palavra").join(" ");
    const parsed = parseAnalogy(long)!;
    expect(parsed.replace("…", "").split(" ")).toHaveLength(MAX_ANALOGY_WORDS);
    expect(parseAnalogy("  ")).toBeNull();
    expect(storedAnalogy(3)).toBeNull();
    expect(storedAnalogy("Como uma usina solar.")).toBe("Como uma usina solar.");
  });
});
