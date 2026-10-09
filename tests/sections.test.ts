import { describe, expect, it } from "vitest";
import { parseParagraphs } from "@/lib/reading";
import {
  canSuggestSections,
  cleanSectionTitle,
  MAX_SECTIONS,
  MIN_SECTION_WORDS,
  navigationHeadings,
  sectionParts,
  storedSections,
  validSections,
} from "@/lib/sections";

/**
 * Secoes de um documento longo (US-153): o modelo aponta paragrafos, e aqui
 * eles viram posicoes validas do texto, sem mexer no conteudo.
 */

const plain = parseParagraphs(
  ["Primeiro paragrafo com quatro.", "Segundo paragrafo aqui.", "Terceiro e ultimo paragrafo."].join(
    "\n\n"
  ),
  "plain"
).paragraphs;

describe("canSuggestSections", () => {
  it("so em texto longo e sem titulos", () => {
    expect(canSuggestSections(MIN_SECTION_WORDS, plain)).toBe(true);
    expect(canSuggestSections(MIN_SECTION_WORDS - 1, plain)).toBe(false);
    const comTitulo = parseParagraphs("# Capitulo\n\nTexto do capitulo.", "markdown").paragraphs;
    expect(canSuggestSections(MIN_SECTION_WORDS, comTitulo)).toBe(false);
  });
});

describe("sectionParts", () => {
  it("numera os paragrafos e manda tudo numa parte so quando cabe", () => {
    const parts = sectionParts(plain);
    expect(parts).toHaveLength(1);
    expect(parts[0]!.prompt.split("\n")[0]).toBe("[0] Primeiro paragrafo com quatro.");
    expect(parts[0]!.maxSections).toBe(MAX_SECTIONS);
  });

  it("divide em partes acima do teto, com a numeracao do texto inteiro", () => {
    const longo = parseParagraphs(
      Array.from({ length: 40 }, (_, index) => `Paragrafo ${index} ${"palavra ".repeat(20)}`).join(
        "\n\n"
      ),
      "plain"
    ).paragraphs;
    const parts = sectionParts(longo, 2_000);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts[1]!.prompt.startsWith(`[${parts[1]!.first}] Paragrafo ${parts[1]!.first}`)).toBe(true);
    expect(parts.at(-1)!.last).toBe(39);
    for (const part of parts) {
      expect(part.prompt.length).toBeLessThanOrEqual(2_000);
      expect(part.maxSections).toBeGreaterThanOrEqual(1);
    }
    const sum = parts.reduce((total, part) => total + part.maxSections, 0);
    expect(sum).toBeLessThanOrEqual(MAX_SECTIONS);
  });
});

describe("cleanSectionTitle", () => {
  it("tira numeracao, aspas e pontuacao, ate 8 palavras", () => {
    expect(cleanSectionTitle('1. "A chegada."')).toBe("A chegada");
    expect(cleanSectionTitle("um dois tres quatro cinco seis sete oito nove")).toBe(
      "um dois tres quatro cinco seis sete oito"
    );
    expect(cleanSectionTitle(null)).toBe("");
  });
});

describe("validSections", () => {
  it("converte paragrafo em posicao e descarta o que nao existe", () => {
    const result = validSections(
      [
        { paragraph: 2, title: "Fim" },
        { paragraph: 0, title: "Comeco" },
        { paragraph: 0, title: "Repetido" },
        { paragraph: 9, title: "Fora" },
        { paragraph: 1.5, title: "Quebrado" },
        { paragraph: 1, title: "   " },
      ],
      plain
    );
    expect(result).toEqual([
      { index: 0, title: "Comeco" },
      { index: plain[2]!.start, title: "Fim" },
    ]);
  });

  it("respeita o teto de secoes", () => {
    const muitos = parseParagraphs(
      Array.from({ length: 50 }, (_, index) => `Paragrafo ${index}.`).join("\n\n"),
      "plain"
    ).paragraphs;
    const raw = muitos.map((_, index) => ({ paragraph: index, title: `Parte ${index}` }));
    expect(validSections(raw, muitos)).toHaveLength(MAX_SECTIONS);
  });

  it("resposta fora do formato vira lista vazia", () => {
    expect(validSections(null, plain)).toEqual([]);
    expect(validSections([1, "a"], plain)).toEqual([]);
  });
});

describe("storedSections", () => {
  it("so mantem posicoes que abrem paragrafo", () => {
    const meio = plain[1]!.start + 1;
    const result = storedSections(
      [
        { index: plain[1]!.start, title: "Meio" },
        { index: meio, title: "Quebrada" },
        { index: 9_999, title: "Alem do fim" },
        { index: 0, title: "Inicio" },
      ],
      plain
    );
    expect(result).toEqual([
      { index: 0, title: "Inicio" },
      { index: plain[1]!.start, title: "Meio" },
    ]);
  });
});

describe("navigationHeadings", () => {
  it("usa as secoes quando o texto nao tem titulos", () => {
    const headings = navigationHeadings(plain, [{ index: plain[2]!.start, title: "Final" }]);
    expect(headings).toEqual([{ level: 1, title: "Final", start: plain[2]!.start }]);
  });

  it("titulos do proprio texto vencem as secoes", () => {
    const md = parseParagraphs("# Capitulo um\n\nTexto.\n\nMais texto.", "markdown").paragraphs;
    const headings = navigationHeadings(md, [{ index: md[2]!.start, title: "Ignorada" }]);
    expect(headings.map((heading) => heading.title)).toEqual(["Capitulo um"]);
  });

  it("sem titulos nem secoes, sumario vazio", () => {
    expect(navigationHeadings(plain, null)).toEqual([]);
  });
});
