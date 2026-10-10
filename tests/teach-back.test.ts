import { describe, expect, it } from "vitest";
import { excerptOf } from "@/lib/ai-text";
import { matchKeys } from "@/lib/passage-match";
import { parseParagraphs } from "@/lib/reading";
import {
  checkExplanation,
  EXPLANATION_TOO_LONG,
  EXPLANATION_TOO_SHORT,
  MAX_POINTS,
  pickPart,
  readParts,
  validPoints,
  wordsRead,
} from "@/lib/teach-back";

const sentence = (size: number) => Array.from({ length: size }, () => "palavra").join(" ");

describe("checkExplanation", () => {
  it("pede de 30 a 300 palavras", () => {
    expect(checkExplanation(sentence(29))).toEqual({ error: EXPLANATION_TOO_SHORT });
    expect(checkExplanation(sentence(301))).toEqual({ error: EXPLANATION_TOO_LONG });
    expect(checkExplanation(`  ${sentence(30)} `)).toEqual({ text: sentence(30) });
    expect(checkExplanation(undefined)).toEqual({ error: EXPLANATION_TOO_SHORT });
  });
});

describe("partes lidas", () => {
  const sections = [
    { title: "Um", start: 0, end: 100 },
    { title: "Dois", start: 100, end: 200 },
    { title: "Tres", start: 200, end: 300 },
  ];

  it("so oferece secoes que comecam antes da posicao, cortadas nela", () => {
    expect(readParts(sections, 150)).toEqual([
      { title: "Um", start: 0, end: 100, partial: false },
      { title: "Dois", start: 100, end: 150, partial: true },
    ]);
    expect(readParts(sections, 0)).toEqual([]);
  });

  it("sem secoes, o trecho lido inteiro", () => {
    expect(readParts([], 80)).toEqual([{ title: null, start: 0, end: 80, partial: false }]);
    expect(pickPart(readParts([], 80), null)).toMatchObject({ start: 0, end: 80 });
  });

  it("escolha precisa ser uma das partes oferecidas", () => {
    const parts = readParts(sections, 150);
    expect(pickPart(parts, 100)).toMatchObject({ title: "Dois" });
    expect(pickPart(parts, 200)).toBeNull();
    expect(pickPart(parts, null)).toBeNull();
  });

  it("palavras lidas contam a posicao atual", () => {
    expect(wordsRead({ progressIndex: 9, wordCount: 100 })).toBe(10);
    expect(wordsRead({ progressIndex: 99, wordCount: 100 })).toBe(100);
    expect(wordsRead({ progressIndex: 0, wordCount: 0 })).toBe(0);
  });
});

describe("validPoints", () => {
  const { words, paragraphs } = parseParagraphs(
    "A fotossintese usa luz para produzir acucar.\n\nO oxigenio sai como subproduto.\n\nNa proxima secao veremos a respiracao celular."
  );
  const keys = matchKeys(words);
  const read = words.indexOf("Na");

  it("so o trecho lido vai ao pedido", () => {
    const excerpt = excerptOf(paragraphs, 0, read);
    expect(excerpt.text).not.toContain("respiracao");
  });

  it("aceita apontamento com trecho literal da parte e descarta o resto", () => {
    const points = validPoints(
      {
        points: [
          { text: "Faltou o oxigênio.", quote: "O oxigenio sai como subproduto" },
          { text: "Vem depois.", quote: "veremos a respiracao celular" },
          { text: "Sem trecho.", quote: "" },
        ],
      },
      words,
      keys,
      { start: 0, end: read }
    );
    expect(points).toEqual([
      { text: "Faltou o oxigênio.", quote: "O oxigenio sai como subproduto.", start: words.indexOf("O"), end: read },
    ]);
  });

  it("no maximo 4", () => {
    const list = Array.from({ length: 6 }, (_, i) => ({ text: `P${i}`, quote: "usa luz para produzir" }));
    expect(validPoints(list, words, keys, { start: 0, end: read })).toHaveLength(MAX_POINTS);
  });
});
