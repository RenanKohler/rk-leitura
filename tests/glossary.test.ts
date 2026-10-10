import { describe, expect, it } from "vitest";
import { excerptOf } from "@/lib/ai-text";
import {
  glossaryCut,
  glossaryKey,
  MAX_TERMS,
  parseStoredGlossary,
  validGlossary,
} from "@/lib/glossary";
import { matchKeys } from "@/lib/passage-match";
import { parseParagraphs } from "@/lib/reading";

describe("glossaryCut", () => {
  it("exige 500 palavras lidas", () => {
    expect(glossaryCut({ progressIndex: 498, wordCount: 5000 })).toBeNull();
    expect(glossaryCut({ progressIndex: 499, wordCount: 5000 })).toBe(500);
  });

  it("usa o comeco da faixa de 1.000 palavras, nunca depois da posicao", () => {
    expect(glossaryCut({ progressIndex: 999, wordCount: 5000 })).toBe(1000);
    expect(glossaryCut({ progressIndex: 1500, wordCount: 5000 })).toBe(1000);
    expect(glossaryCut({ progressIndex: 1998, wordCount: 5000 })).toBe(1000);
    expect(glossaryCut({ progressIndex: 2400, wordCount: 5000 })).toBe(2000);
    for (const position of [499, 700, 1234, 3999]) {
      expect(glossaryCut({ progressIndex: position, wordCount: 5000 })!).toBeLessThanOrEqual(position + 1);
    }
  });

  it("texto concluido usa o texto inteiro", () => {
    expect(glossaryCut({ progressIndex: 1799, wordCount: 1800 })).toBe(1800);
    expect(glossaryCut({ progressIndex: 299, wordCount: 300 })).toBeNull();
  });

  it("a chave muda com o conteudo e com a faixa", () => {
    expect(glossaryKey("t", "f1", 1000)).not.toBe(glossaryKey("t", "f2", 1000));
    expect(glossaryKey("t", "f1", 1000)).not.toBe(glossaryKey("t", "f1", 2000));
  });
});

describe("validGlossary", () => {
  const { words, paragraphs } = parseParagraphs(
    "Introducao sobre o Capital.\n\nA mais-valia e o excedente. O capital cresce com a mais-valia.\n\nDepois surge a alienacao do trabalho."
  );
  const keys = matchKeys(words);
  const cut = words.indexOf("Depois");

  it("so entra termo que aparece ate o corte, com a primeira ocorrencia", () => {
    const terms = validGlossary(
      {
        terms: [
          { term: "mais-valia", definition: "O valor que o trabalho cria além do salário." },
          { term: "Alienação", definition: "Separação do trabalhador do que produz." },
          { term: "alienacao", definition: "Vem depois da posição." },
          { term: "capital", definition: "Dinheiro que gera mais dinheiro." },
          { term: "Mais-Valia", definition: "Repetido." },
          { term: "inventado", definition: "Não está no texto." },
        ],
      },
      keys,
      { from: 0, to: cut },
      cut
    );
    expect(terms.map((term) => term.term)).toEqual(["capital", "mais-valia"]);
    expect(terms[0]!.start).toBe(words.indexOf("Capital."));
    expect(terms[1]).toMatchObject({ start: words.indexOf("mais-valia"), end: words.indexOf("mais-valia") + 1 });
  });

  it("o termo precisa estar no trecho enviado, mas a posicao e a primeira do texto", () => {
    const excerpt = excerptOf(paragraphs, 0, cut, 40);
    expect(excerpt.startWord).toBeGreaterThan(0);
    const terms = validGlossary(
      [
        { term: "Introducao", definition: "Ficou fora do trecho enviado." },
        { term: "capital", definition: "Dinheiro que gera mais dinheiro." },
      ],
      keys,
      { from: excerpt.startWord, to: excerpt.endWord },
      cut
    );
    expect(terms.map((term) => term.term)).toEqual(["capital"]);
    expect(terms[0]!.start).toBe(words.indexOf("Capital."));
  });

  it("descarta definicao longa e ordena em portugues", () => {
    const long = Array.from({ length: 31 }, () => "palavra").join(" ");
    const terms = validGlossary(
      [
        { term: "excedente", definition: "Sobra." },
        { term: "A", definition: long },
        { term: "Capital", definition: "Dinheiro." },
      ],
      keys,
      { from: 0, to: cut },
      cut
    );
    expect(terms.map((term) => term.term)).toEqual(["Capital", "excedente"]);
  });

  it("fica em 30 termos", () => {
    const { words: many } = parseParagraphs(Array.from({ length: 40 }, (_, i) => `termo${i}`).join(" "));
    const list = many.map((term) => ({ term, definition: "Definição." }));
    expect(validGlossary(list, matchKeys(many), { from: 0, to: 40 }, 40)).toHaveLength(MAX_TERMS);
  });

  it("le o guardado e ignora o que nao confere", () => {
    expect(parseStoredGlossary({ terms: [{ term: "a", definition: "b", start: 1, end: 2 }, { term: 1 }] })).toEqual([
      { term: "a", definition: "b", start: 1, end: 2 },
    ]);
    expect(parseStoredGlossary(null)).toBeNull();
  });
});
