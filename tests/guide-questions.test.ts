import { describe, expect, it } from "vitest";
import { excerptOf } from "@/lib/ai-text";
import {
  guideKey,
  guideRange,
  guideTrigger,
  MAX_GUIDE_QUESTIONS,
  MAX_GUIDE_SECTION_WORDS,
  parseStoredGuide,
  validGuide,
} from "@/lib/guide-questions";
import { textHeadings } from "@/lib/navigation";
import { matchKeys } from "@/lib/passage-match";
import { parseParagraphs } from "@/lib/reading";
import { navigationHeadings } from "@/lib/sections";
import { sectionIndexAt, sectionRanges, sectionStartingAt } from "@/lib/text-sections";

const { words, paragraphs } = parseParagraphs(
  "Abertura sem titulo.\n\n# Origens\n\nO rio nasce na serra alta e desce ao mar.\n\n# Usos\n\nA agua do rio irriga os campos do vale.",
  "markdown"
);
const sections = sectionRanges(textHeadings(paragraphs), words.length);
const keys = matchKeys(words);

describe("secoes", () => {
  it("cada secao vai do titulo ao proximo", () => {
    expect(sections.map((section) => section.title)).toEqual(["Origens", "Usos"]);
    expect(sections[0]!.end).toBe(sections[1]!.start);
    expect(sections[1]!.end).toBe(words.length);
    expect(sectionStartingAt(sections, sections[1]!.start)).toBe(sections[1]);
    expect(sectionStartingAt(sections, 1)).toBeNull();
    expect(sectionIndexAt(sections, 0)).toBe(-1);
    expect(sectionIndexAt(sections, sections[1]!.start + 2)).toBe(1);
  });

  it("sem titulos, usa as secoes aplicadas", () => {
    const plain = parseParagraphs("Um dois tres.\n\nQuatro cinco seis.");
    const applied = navigationHeadings(plain.paragraphs, [{ index: 3, title: "Parte dois" }]);
    expect(sectionRanges(applied, 6)).toEqual([{ title: "Parte dois", start: 3, end: 6 }]);
  });

  it("o pedido leva so a secao, cortada no teto", () => {
    const range = guideRange(sections[0]!);
    const excerpt = excerptOf(paragraphs, range.from, range.to);
    expect(excerpt.text).toContain("serra");
    expect(excerpt.text).not.toContain("Abertura");
    expect(excerpt.text).not.toContain("irriga");
    expect(guideRange({ title: "x", start: 10, end: 100_000 }).to).toBe(10 + MAX_GUIDE_SECTION_WORDS);
  });
});

describe("validGuide", () => {
  it("guarda o trecho que responde, so dentro da secao", () => {
    const range = { from: sections[0]!.start, to: sections[0]!.end };
    const questions = validGuide(
      {
        questions: [
          { question: "Onde o rio nasce?", quote: "O rio nasce na serra alta" },
          { question: "Para que serve a água?", quote: "A agua do rio irriga" },
          { question: "Para onde desce?", quote: "e desce ao mar" },
        ],
      },
      words,
      keys,
      range
    );
    expect(questions.map((item) => item.question)).toEqual(["Onde o rio nasce?", "Para onde desce?"]);
    expect(questions[0]!.start).toBe(words.indexOf("rio") - 1);
  });

  it("no maximo 3", () => {
    const list = Array.from({ length: 5 }, (_, i) => ({ question: `P${i}?`, quote: "O rio nasce na serra" }));
    expect(validGuide(list, words, keys, { from: 0, to: words.length })).toHaveLength(MAX_GUIDE_QUESTIONS);
  });

  it("le o guardado e monta a chave por secao", () => {
    expect(parseStoredGuide({ questions: [{ question: "a", quote: "b", start: 1, end: 2 }, {}] })).toHaveLength(1);
    expect(guideKey("t", "f", 5)).not.toBe(guideKey("t", "f", 6));
  });
});

describe("guideTrigger", () => {
  it("abre ao entrar numa secao andando para frente", () => {
    expect(guideTrigger(-1, 0, sections[0]!.start, sections)).toBe(true);
    expect(guideTrigger(0, 1, sections[1]!.start + 40, sections)).toBe(true);
  });

  it("nao abre ao voltar, nem ao abrir o texto no meio de uma secao", () => {
    expect(guideTrigger(1, 0, sections[0]!.start, sections)).toBe(false);
    expect(guideTrigger(null, 0, sections[0]!.start + 2, sections)).toBe(false);
    expect(guideTrigger(null, 0, sections[0]!.start, sections)).toBe(true);
    expect(guideTrigger(0, -1, 0, sections)).toBe(false);
  });
});
