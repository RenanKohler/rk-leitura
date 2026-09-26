import { describe, expect, it } from "vitest";
import { parseParagraphs } from "@/lib/reading";
import {
  bookmarkLabel,
  currentHeading,
  MAX_SEARCH_RESULTS,
  paragraphPauseMs,
  resumeTarget,
  searchWords,
  sentenceBackTarget,
  sentenceStart,
  textHeadings,
} from "@/lib/navigation";

const words = "Primeira frase curta. Segunda frase tem seis palavras aqui. Terceira.".split(" ");
// indices: 0 Primeira, 1 frase, 2 curta., 3 Segunda, 4 frase, 5 tem, 6 seis, 7 palavras, 8 aqui., 9 Terceira.

describe("sentenceStart / sentenceBackTarget (US-91)", () => {
  it("acha o inicio da frase atual", () => {
    expect(sentenceStart(words, 7)).toBe(3);
    expect(sentenceStart(words, 3)).toBe(3);
    expect(sentenceStart(words, 1)).toBe(0);
  });

  it("no meio da frase volta ao inicio dela", () => {
    expect(sentenceBackTarget(words, 7)).toBe(3);
  });

  it("no inicio da frase volta ao inicio da anterior", () => {
    expect(sentenceBackTarget(words, 3)).toBe(0);
    expect(sentenceBackTarget(words, 9)).toBe(3);
  });

  it("na primeira frase fica no zero", () => {
    expect(sentenceBackTarget(words, 0)).toBe(0);
    expect(sentenceBackTarget(words, 2)).toBe(0);
    expect(sentenceBackTarget([], 0)).toBe(0);
  });
});

describe("resumeTarget (US-95)", () => {
  it("pausa longa recua ate 5 palavras dentro da frase", () => {
    expect(resumeTarget(words, 8, 6_000)).toBe(3);
    const long = Array.from({ length: 20 }, (_, i) => `p${i}`);
    expect(resumeTarget(long, 12, 6_000)).toBe(7);
  });

  it("pausa curta nao muda a posicao", () => {
    expect(resumeTarget(words, 8, 4_999)).toBe(8);
  });

  it("perto do inicio vai para o zero sem erro", () => {
    expect(resumeTarget(words, 2, 10_000)).toBe(0);
    expect(resumeTarget(words, 0, 10_000)).toBe(0);
  });
});

describe("searchWords (US-90)", () => {
  const text = "A Memória de trabalho guarda pouco. A memoria de trabalho cansa; memória de trabalho, enfim.".split(" ");

  it("ignora caixa, acento e pontuacao", () => {
    expect(searchWords(text, "memoria de trabalho")).toEqual([1, 7, 11]);
  });

  it("a ultima palavra casa pelo prefixo", () => {
    expect(searchWords(text, "memoria de trab")).toEqual([1, 7, 11]);
  });

  it("sem ocorrencia devolve lista vazia", () => {
    expect(searchWords(text, "atencao")).toEqual([]);
  });

  it("menos de 2 caracteres nao busca", () => {
    expect(searchWords(text, "a")).toEqual([]);
    expect(searchWords(text, "  ")).toEqual([]);
  });

  it("para no teto de resultados", () => {
    const many = Array.from({ length: MAX_SEARCH_RESULTS + 50 }, () => "casa");
    expect(searchWords(many, "casa")).toHaveLength(MAX_SEARCH_RESULTS);
  });
});

describe("textHeadings (US-89)", () => {
  const { paragraphs } = parseParagraphs(
    "# Titulo\n\nTexto inicial.\n\n## Secao um\n\nMais texto aqui.\n\n### Detalhe\n\nFim.",
    "markdown"
  );

  it("lista os titulos com nivel e posicao", () => {
    const headings = textHeadings(paragraphs);
    expect(headings.map((heading) => [heading.level, heading.title])).toEqual([
      [1, "Titulo"],
      [2, "Secao um"],
      [3, "Detalhe"],
    ]);
    expect(headings[1]!.start).toBe(3);
  });

  it("marca a secao atual", () => {
    const headings = textHeadings(paragraphs);
    expect(currentHeading(headings, 0)).toBe(0);
    expect(currentHeading(headings, 5)).toBe(1);
    expect(currentHeading(headings, 100)).toBe(2);
  });

  it("texto sem titulos nao tem sumario", () => {
    expect(textHeadings(parseParagraphs("So um paragrafo.").paragraphs)).toEqual([]);
  });
});

describe("marcadores e pausas", () => {
  it("nome padrao sao as 5 primeiras palavras", () => {
    expect(bookmarkLabel(words, 3)).toBe("Segunda frase tem seis palavras");
    expect(bookmarkLabel(words, 50)).toBe("Marcador");
  });

  it("pausa de paragrafo e 1,5 palavra", () => {
    expect(paragraphPauseMs(300)).toBe(300);
    expect(paragraphPauseMs(600)).toBe(150);
  });
});
