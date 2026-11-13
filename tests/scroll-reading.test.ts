import { describe, expect, it } from "vitest";
import type { Paragraph } from "@/lib/reading";
import {
  marksByParagraph,
  paragraphIndexOf,
  SCROLL_AWAY_WORDS,
  scrolledAway,
  scrollStatus,
  wordInView,
  wordSpanInText,
} from "@/lib/scroll-reading";

const paragraph = (start: number, size: number): Paragraph => ({
  start,
  words: Array.from({ length: size }, (_, i) => `p${start + i}`),
});

// Palavras 0-4, 5-9 e 10-12.
const paragraphs = [paragraph(0, 5), paragraph(5, 5), paragraph(10, 3)];

describe("paragraphIndexOf", () => {
  it("acha o paragrafo da palavra, nas bordas e no meio", () => {
    expect(paragraphIndexOf(paragraphs, 0)).toBe(0);
    expect(paragraphIndexOf(paragraphs, 4)).toBe(0);
    expect(paragraphIndexOf(paragraphs, 5)).toBe(1);
    expect(paragraphIndexOf(paragraphs, 9)).toBe(1);
    expect(paragraphIndexOf(paragraphs, 12)).toBe(2);
  });

  it("fora do texto fica no paragrafo mais proximo", () => {
    expect(paragraphIndexOf(paragraphs, -3)).toBe(0);
    expect(paragraphIndexOf(paragraphs, 99)).toBe(2);
  });

  it("sem paragrafos nao ha onde cair", () => {
    expect(paragraphIndexOf([], 0)).toBe(-1);
  });
});

describe("wordSpanInText", () => {
  it("devolve o trecho da palavra pedida", () => {
    const text = "ler rápido exige atenção";
    expect(wordSpanInText(text, 0)).toEqual({ start: 0, end: 3 });
    expect(wordSpanInText(text, 2)).toEqual({ start: 11, end: 16 });
    expect(text.slice(11, 16)).toBe("exige");
  });

  it("ignora espacos repetidos e nas pontas", () => {
    const text = "  um   dois\ntres ";
    expect(wordSpanInText(text, 0)).toEqual({ start: 2, end: 4 });
    expect(wordSpanInText(text, 1)).toEqual({ start: 7, end: 11 });
    expect(wordSpanInText(text, 2)).toEqual({ start: 12, end: 16 });
  });

  it("palavra que nao existe, ou posicao invalida, e null", () => {
    expect(wordSpanInText("um dois", 2)).toBeNull();
    expect(wordSpanInText("", 0)).toBeNull();
    expect(wordSpanInText("um dois", -1)).toBeNull();
    expect(wordSpanInText("um dois", 0.5)).toBeNull();
  });
});

describe("marksByParagraph", () => {
  const mark = (id: string, start: number, end: number) => ({ id, start, end, note: null });

  it("cada paragrafo recebe so os destaques que o tocam", () => {
    const marks = [mark("a", 1, 3), mark("b", 4, 7), mark("c", 10, 11)];
    const of = marksByParagraph(paragraphs, marks);
    expect(of(paragraphs[0]!).map((item) => item.id)).toEqual(["a", "b"]);
    expect(of(paragraphs[1]!).map((item) => item.id)).toEqual(["b"]);
    expect(of(paragraphs[2]!).map((item) => item.id)).toEqual(["c"]);
  });

  it("destaque que termina onde o paragrafo comeca nao entra nele", () => {
    const of = marksByParagraph(paragraphs, [mark("a", 2, 5)]);
    expect(of(paragraphs[0]!)).toHaveLength(1);
    expect(of(paragraphs[1]!)).toHaveLength(0);
  });

  it("paragrafos sem destaque dividem a mesma lista vazia", () => {
    const of = marksByParagraph(paragraphs, [mark("a", 0, 1)]);
    expect(of(paragraphs[1]!)).toBe(of(paragraphs[2]!));
    expect(marksByParagraph(paragraphs, [])(paragraphs[0]!)).toBe(of(paragraphs[1]!));
  });
});

describe("wordInView", () => {
  const frame = { top: 100, bottom: 700 };

  it("linha inteira dentro da coluna esta a vista", () => {
    expect(wordInView({ top: 300, bottom: 328 }, frame)).toBe(true);
  });

  it("em cima, um pedaco da linha ja conta", () => {
    expect(wordInView({ top: 80, bottom: 108 }, frame)).toBe(true);
    expect(wordInView({ top: 60, bottom: 100 }, frame)).toBe(false);
  });

  it("embaixo, a linha precisa caber inteira", () => {
    expect(wordInView({ top: 672, bottom: 700 }, frame)).toBe(true);
    expect(wordInView({ top: 690, bottom: 718 }, frame)).toBe(false);
    expect(wordInView({ top: 800, bottom: 828 }, frame)).toBe(false);
  });
});

describe("scrolledAway", () => {
  it("perto do lugar da leitura, para tras ou para a frente, nao e longe", () => {
    expect(scrolledAway(1000, 1000)).toBe(false);
    expect(scrolledAway(1000 - SCROLL_AWAY_WORDS, 1000)).toBe(false);
    expect(scrolledAway(1000 + SCROLL_AWAY_WORDS, 1000)).toBe(false);
  });

  it("uma palavra alem do limite ja e longe, nos dois sentidos", () => {
    expect(scrolledAway(1000 - SCROLL_AWAY_WORDS - 1, 1000)).toBe(true);
    expect(scrolledAway(1000 + SCROLL_AWAY_WORDS + 1, 1000)).toBe(true);
  });
});

describe("scrollStatus", () => {
  it("mostra o quanto do texto ja passou", () => {
    expect(scrollStatus(0, 1000)).toBe("0%");
    expect(scrollStatus(420, 1000)).toBe("42%");
    expect(scrollStatus(1000, 1000)).toBe("100%");
  });

  it("nao passa de 100% nem quebra em texto vazio", () => {
    expect(scrollStatus(1500, 1000)).toBe("100%");
    expect(scrollStatus(0, 0)).toBe("0%");
  });
});
