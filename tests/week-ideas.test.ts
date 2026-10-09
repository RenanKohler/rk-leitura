import { describe, expect, it } from "vitest";
import {
  canOfferWeekIdeas,
  clampIdeas,
  MAX_HIGHLIGHTS_PER_TEXT,
  MAX_IDEAS_WORDS,
  shiftDay,
  weekIdeasKey,
  weekIdeasPrompt,
} from "@/lib/week-ideas";

/**
 * Ideias da semana (US-154): o pedido leva so titulo, sinopse e destaques, e
 * o botao so aparece com a IA utilizavel e pelo menos dois textos lidos.
 */

describe("weekIdeasPrompt", () => {
  it("leva titulo, sinopse e destaques de cada texto", () => {
    const prompt = weekIdeasPrompt([
      { title: "O tempo", synopsis: "Uma reflexão sobre pressa.", highlights: ["o relógio manda"] },
      { title: 'Sem "aspas"', synopsis: null, highlights: [] },
    ]);
    expect(prompt).toContain('<texto titulo="O tempo">');
    expect(prompt).toContain("Sinopse: Uma reflexão sobre pressa.");
    expect(prompt).toContain("- o relógio manda");
    expect(prompt).toContain(`<texto titulo="Sem 'aspas'">`);
    expect(prompt).toContain("(só o título)");
  });

  it("limita os destaques por texto e o tamanho de cada um", () => {
    const highlights = Array.from({ length: 20 }, (_, index) => `trecho ${index} ${"x".repeat(400)}`);
    const prompt = weekIdeasPrompt([{ title: "Longo", synopsis: null, highlights }]);
    expect(prompt.match(/^- /gm)).toHaveLength(MAX_HIGHLIGHTS_PER_TEXT);
    expect(prompt).toContain("...");
  });
});

describe("clampIdeas", () => {
  it("mantem paragrafo curto e corta o longo em 120 palavras", () => {
    expect(clampIdeas("  Um   paragrafo curto. ")).toBe("Um paragrafo curto.");
    const longo = clampIdeas("palavra ".repeat(200));
    expect(longo.split(" ")).toHaveLength(MAX_IDEAS_WORDS);
    expect(longo.endsWith("…")).toBe(true);
    expect(clampIdeas(undefined)).toBe("");
  });
});

describe("canOfferWeekIdeas", () => {
  const base = { readTexts: 2, configured: true, consent: "on" as const, quotaLeft: true, cached: false };

  it("aparece com dois textos e IA disponivel", () => {
    expect(canOfferWeekIdeas(base)).toBe(true);
  });

  it("some com menos de dois textos, sem chave ou com a IA desligada", () => {
    expect(canOfferWeekIdeas({ ...base, readTexts: 1 })).toBe(false);
    expect(canOfferWeekIdeas({ ...base, configured: false })).toBe(false);
    expect(canOfferWeekIdeas({ ...base, consent: "off" })).toBe(false);
    expect(canOfferWeekIdeas({ ...base, consent: "pending" })).toBe(false);
  });

  it("sem cota so aparece quando ja ha paragrafo guardado", () => {
    expect(canOfferWeekIdeas({ ...base, quotaLeft: false })).toBe(false);
    expect(canOfferWeekIdeas({ ...base, quotaLeft: false, cached: true })).toBe(true);
  });
});

describe("semana", () => {
  it("chave e a segunda-feira; deslocamento atravessa o mes", () => {
    expect(weekIdeasKey("2026-09-28")).toBe("2026-09-28");
    expect(shiftDay("2026-10-05", -7)).toBe("2026-09-28");
  });
});
