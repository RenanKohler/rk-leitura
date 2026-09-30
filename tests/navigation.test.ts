import { describe, expect, it } from "vitest";
import { parseParagraphs } from "@/lib/reading";
import {
  bookmarkLabel,
  CONTEXT_BLOCK,
  currentHeading,
  MAX_SEARCH_RESULTS,
  resumeTarget,
  searchWords,
  runnerContext,
  sentenceBackTarget,
  sentenceForwardTarget,
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

describe("resumeTarget (US-95, ALG-17)", () => {
  it("pausa de 5 s a 1 min volta ao inicio da frase", () => {
    expect(resumeTarget(words, 8, 6_000)).toBe(3);
    expect(resumeTarget(words, 8, 59_000)).toBe(3);
  });

  it("pausa curta nao muda a posicao", () => {
    expect(resumeTarget(words, 8, 4_999)).toBe(8);
    expect(resumeTarget(words, 8, 1_000, undefined, 300)).toBe(8);
  });

  it("a 450 ppm ou mais, ate a pausa curta recua uma palavra, sem sair da frase", () => {
    expect(resumeTarget(words, 8, 1_000, undefined, 450)).toBe(7);
    expect(resumeTarget(words, 3, 1_000, undefined, 600)).toBe(3);
  });

  it("de 1 a 10 min volta ao inicio da frase anterior", () => {
    expect(resumeTarget(words, 8, 60_000)).toBe(0);
    expect(resumeTarget(words, 9, 5 * 60_000)).toBe(3);
  });

  it("mais de 10 min volta ao inicio do paragrafo", () => {
    const texto = parseParagraphs(
      "Primeira frase do bloco. Segunda frase do bloco. Terceira frase do bloco.\n\nOutro bloco."
    );
    // Na terceira frase (indice 8): o paragrafo comeca no 0.
    expect(resumeTarget(texto.words, 10, 11 * 60_000, texto.paragraphs)).toBe(0);
    // Sem os paragrafos, a frase anterior.
    expect(resumeTarget(texto.words, 10, 11 * 60_000)).toBe(4);
  });

  it("nunca recua mais de 60 palavras", () => {
    const longo = parseParagraphs(Array.from({ length: 200 }, (_, i) => `p${i}`).join(" ") + ".");
    expect(resumeTarget(longo.words, 150, 20 * 60_000, longo.paragraphs)).toBe(90);
    expect(resumeTarget(longo.words, 150, 10_000)).toBe(90);
  });

  it("perto do inicio vai para o zero sem erro", () => {
    expect(resumeTarget(words, 2, 10_000)).toBe(0);
    expect(resumeTarget(words, 0, 10_000)).toBe(0);
    expect(resumeTarget([], 0, 10_000)).toBe(0);
  });
});

describe("frase pelo segmentador unico (ALG-8)", () => {
  const sr = parseParagraphs("Antes veio isto. O Sr. Silva chegou cedo. Depois saiu.");
  // 0 Antes 1 veio 2 isto. 3 O 4 Sr. 5 Silva 6 chegou 7 cedo. 8 Depois 9 saiu.

  it('"O Sr. Silva chegou." e uma frase so na navegacao', () => {
    expect(sentenceStart(sr.words, 6)).toBe(3);
    expect(sentenceBackTarget(sr.words, 6)).toBe(3);
    expect(sentenceBackTarget(sr.words, 8)).toBe(3);
    expect(sentenceForwardTarget(sr.words, 3)).toBe(8);
    expect(runnerContext(sr.words, sr.paragraphs, 5)).toEqual({
      from: 3,
      to: 8,
      clippedStart: false,
      clippedEnd: false,
    });
    expect(resumeTarget(sr.words, 6, 10_000)).toBe(3);
  });

  it("abreviatura e inicial tambem nao partem a frase", () => {
    const texto = parseParagraphs("Veja a p. 12 do cap. 3. Livro de J. R. R. Tolkien. Fim.");
    expect(sentenceStart(texto.words, 6)).toBe(0);
    expect(sentenceForwardTarget(texto.words, 0)).toBe(7);
    expect(sentenceStart(texto.words, 12)).toBe(7);
  });

  it("vitamina D. e fim de frase", () => {
    const texto = parseParagraphs("Tomou vitamina D. Depois dormiu.");
    expect(sentenceStart(texto.words, 4)).toBe(3);
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

describe("marcadores", () => {
  it("nome padrao sao as 5 primeiras palavras", () => {
    expect(bookmarkLabel(words, 3)).toBe("Segunda frase tem seis palavras");
    expect(bookmarkLabel(words, 50)).toBe("Marcador");
  });
});

describe("Word Runner: avancar a frase e contexto", () => {
  const texto = parseParagraphs(
    "Primeira frase curta. Segunda frase tem seis palavras.\n\nOutro paragrafo sem ponto"
  );

  it("avanca para o inicio da frase seguinte", () => {
    expect(sentenceForwardTarget(texto.words, 0)).toBe(3);
    expect(sentenceForwardTarget(texto.words, 3)).toBe(8);
    expect(sentenceForwardTarget(texto.words, 10)).toBe(11);
    expect(sentenceForwardTarget([], 0)).toBe(0);
  });

  it("o contexto e a frase atual, sem sair do paragrafo", () => {
    expect(runnerContext(texto.words, texto.paragraphs, 4)).toEqual({
      from: 3,
      to: 8,
      clippedStart: false,
      clippedEnd: false,
    });
    expect(runnerContext(texto.words, texto.paragraphs, 10)).toMatchObject({ from: 8, to: 12 });
  });

  it("frase longa vira blocos fixos; o bloco so muda quando a palavra sai dele (ALG-9)", () => {
    const longa = parseParagraphs(Array.from({ length: 60 }, (_, i) => `p${i}`).join(" ") + ".");
    // 60 palavras em blocos de ate 18: quatro de 15.
    const blocos = longa.words.map((_, index) => runnerContext(longa.words, longa.paragraphs, index));
    expect(blocos[0]).toEqual({ from: 0, to: 15, clippedStart: false, clippedEnd: true });
    expect(blocos[30]).toEqual({ from: 30, to: 45, clippedStart: true, clippedEnd: true });
    expect(blocos[44]).toEqual(blocos[30]);
    expect(blocos[59]).toEqual({ from: 45, to: 60, clippedStart: true, clippedEnd: false });
    // Cada bloco contem a palavra e tem no maximo 18 palavras.
    blocos.forEach((bloco, index) => {
      expect(bloco.from).toBeLessThanOrEqual(index);
      expect(bloco.to).toBeGreaterThan(index);
      expect(bloco.to - bloco.from).toBeLessThanOrEqual(CONTEXT_BLOCK);
    });
    // O bloco so muda nas fronteiras.
    const mudancas = blocos.filter((bloco, index) => index > 0 && bloco.from !== blocos[index - 1]!.from);
    expect(mudancas).toHaveLength(3);
  });

  it("corta de preferencia depois de virgula", () => {
    const palavras = Array.from({ length: 30 }, (_, i) => `p${i}`);
    palavras[11] = "p11,";
    palavras[29] = "p29.";
    const texto = parseParagraphs(palavras.join(" "));
    // Ideal seria 15 + 15; a virgula depois da palavra 11 puxa o corte para 12.
    expect(runnerContext(texto.words, texto.paragraphs, 5)).toMatchObject({ from: 0, to: 12 });
    expect(runnerContext(texto.words, texto.paragraphs, 12)).toMatchObject({ from: 12, to: 30 });
  });

  it("o tamanho do bloco e ajustavel", () => {
    const longa = parseParagraphs(Array.from({ length: 60 }, (_, i) => `p${i}`).join(" ") + ".");
    expect(runnerContext(longa.words, longa.paragraphs, 30, 5)).toEqual({
      from: 30,
      to: 35,
      clippedStart: true,
      clippedEnd: true,
    });
  });
});
