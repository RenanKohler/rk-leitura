import { describe, expect, it } from "vitest";
import {
  MAX_CHUNK,
  MAX_HIGHLIGHT,
  MAX_WPM,
  MIN_CHUNK,
  MIN_HIGHLIGHT,
  MIN_WPM,
  chunkDurationMs,
  clamp,
  countWords,
  orpIndex,
  parseParagraphs,
  sliceParagraphs,
  tokenize,
} from "@/lib/reading";

describe("tokenize", () => {
  it("preserva acentuacao", () => {
    // Regressao: um filtro /[^a-zA-Z0-9'-]/ apagava todo acento e "atencao"
    // virava "ateno" em qualquer texto em portugues.
    expect(tokenize("coração atenção ilusão")).toEqual(["coração", "atenção", "ilusão"]);
  });

  it("preserva pontuacao colada na palavra", () => {
    expect(tokenize("Ela disse: — Vim.")).toEqual(["Ela", "disse:", "—", "Vim."]);
  });

  it("colapsa espacos, tabulacoes e quebras de linha", () => {
    expect(tokenize("  uma \t duas \n\n tres  ")).toEqual(["uma", "duas", "tres"]);
  });

  it("devolve lista vazia para texto em branco", () => {
    expect(tokenize("   \n  ")).toEqual([]);
    expect(countWords("")).toBe(0);
  });
});

describe("parseParagraphs", () => {
  const conteudo = "Primeiro paragrafo com quatro palavras.\n\nSegundo aqui.\n\nTerceiro e ultimo.";

  it("separa os paragrafos e a lista corrida ao mesmo tempo", () => {
    const { words, paragraphs } = parseParagraphs(conteudo);
    expect(paragraphs).toHaveLength(3);
    expect(words).toHaveLength(paragraphs.reduce((total, p) => total + p.words.length, 0));
  });

  it("indexa cada paragrafo pela posicao da primeira palavra no texto inteiro", () => {
    const { paragraphs } = parseParagraphs(conteudo);
    expect(paragraphs[0]!.start).toBe(0);
    expect(paragraphs[1]!.start).toBe(paragraphs[0]!.words.length);
  });

  it("ignora linhas em branco sem criar paragrafo vazio", () => {
    const { paragraphs } = parseParagraphs("um dois\n\n\n\n   \n\ntres quatro");
    expect(paragraphs).toHaveLength(2);
  });

  it("conta as mesmas palavras que countWords", () => {
    expect(parseParagraphs(conteudo).words).toHaveLength(countWords(conteudo));
  });
});

describe("sliceParagraphs", () => {
  const { paragraphs } = parseParagraphs("um dois tres\n\nquatro cinco seis\n\nsete oito nove");

  it("recorta so os paragrafos que cobrem o intervalo", () => {
    const recorte = sliceParagraphs(paragraphs, 3, 6);
    expect(recorte).toHaveLength(1);
    expect(recorte[0]!.words).toEqual(["quatro", "cinco", "seis"]);
  });

  it("corta pelas bordas quando o intervalo cai no meio de um paragrafo", () => {
    const recorte = sliceParagraphs(paragraphs, 1, 4);
    expect(recorte.flatMap((p) => p.words)).toEqual(["dois", "tres", "quatro"]);
  });

  it("devolve vazio para intervalo fora do texto", () => {
    expect(sliceParagraphs(paragraphs, 50, 60)).toEqual([]);
  });
});

describe("chunkDurationMs", () => {
  it("dura mais quanto mais lenta a velocidade", () => {
    // Regressao: a conta ja esteve invertida e 350 ppm rodava perto de 5.600.
    expect(chunkDurationMs(300, 1)).toBe(200);
    expect(chunkDurationMs(600, 1)).toBe(100);
    expect(chunkDurationMs(300, 1)).toBeGreaterThan(chunkDurationMs(600, 1));
  });

  it("dura mais quanto maior o bloco", () => {
    expect(chunkDurationMs(300, 2)).toBe(400);
    expect(chunkDurationMs(300, 3)).toBeGreaterThan(chunkDurationMs(300, 2));
  });

  it("entrega a velocidade pedida ao longo de um minuto", () => {
    const wpm = 450;
    const porBloco = chunkDurationMs(wpm, 3);
    expect(Math.round((60_000 / porBloco) * 3)).toBe(wpm);
  });

  it("limita valores fora da faixa em vez de aceitar", () => {
    expect(chunkDurationMs(5, 1)).toBe(chunkDurationMs(MIN_WPM, 1));
    expect(chunkDurationMs(99_999, 1)).toBe(chunkDurationMs(MAX_WPM, 1));
    expect(chunkDurationMs(300, 0)).toBe(chunkDurationMs(300, MIN_CHUNK));
    expect(chunkDurationMs(300, 99)).toBe(chunkDurationMs(300, MAX_CHUNK));
  });
});

describe("clamp", () => {
  it("prende o valor na faixa", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
  });

  it("devolve o minimo para NaN, em vez de propagar", () => {
    expect(clamp(Number.NaN, 0, 10)).toBe(0);
  });
});

describe("orpIndex", () => {
  it("fica levemente a esquerda do centro e nunca fora da palavra", () => {
    for (const palavra of ["a", "de", "casa", "cabana", "importacao", "extraordinario"]) {
      const indice = orpIndex(palavra);
      expect(indice).toBeGreaterThanOrEqual(0);
      expect(indice).toBeLessThan(palavra.length);
      expect(indice).toBeLessThanOrEqual(Math.floor(palavra.length / 2));
    }
  });

  it("cresce por faixa de tamanho", () => {
    expect(orpIndex("a")).toBe(0);
    expect(orpIndex("casa")).toBe(1);
    expect(orpIndex("cabana")).toBe(2);
    expect(orpIndex("extraordinario")).toBe(3);
  });
});

describe("faixa da intensidade do destaque", () => {
  it("cobre do quase imperceptivel ao quase solido, sem passar disso", () => {
    // Faixa unica: o slider dos ajustes e o clamp da rota leem daqui. Quando
    // os dois guardavam o proprio numero, bastava mudar um para a tela
    // oferecer um valor que o servidor recusava.
    expect(MIN_HIGHLIGHT).toBeGreaterThan(0);
    expect(MIN_HIGHLIGHT).toBeLessThan(MAX_HIGHLIGHT);
    expect(MAX_HIGHLIGHT).toBeLessThan(1);
  });

  it("aceita o padrao e prende o que vem de fora", () => {
    expect(clamp(0.35, MIN_HIGHLIGHT, MAX_HIGHLIGHT)).toBe(0.35);
    expect(clamp(0, MIN_HIGHLIGHT, MAX_HIGHLIGHT)).toBe(MIN_HIGHLIGHT);
    expect(clamp(5, MIN_HIGHLIGHT, MAX_HIGHLIGHT)).toBe(MAX_HIGHLIGHT);
    expect(clamp(Number.NaN, MIN_HIGHLIGHT, MAX_HIGHLIGHT)).toBe(MIN_HIGHLIGHT);
  });

  it("vai e volta entre fracao e ponto percentual inteiro", () => {
    // O slider trabalha em inteiros; o valor guardado e a fracao.
    for (const fracao of [0.1, 0.35, 0.5, 0.8]) {
      expect(Math.round(fracao * 100) / 100).toBe(fracao);
    }
  });
});
