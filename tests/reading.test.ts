import { describe, expect, it } from "vitest";
import {
  MAX_HIGHLIGHT,
  MAX_WPM,
  MIN_HIGHLIGHT,
  MIN_WPM,
  asFontFamily,
  clamp,
  countWords,
  orpIndex,
  orpParts,
  estimatedMinutes,
  warmupStart,
  parseParagraphs,
  sliceParagraphs,
  startsParagraph,
  tokenize,
  typographyVars,
  warmupFactor,
  WARMUP_START,
  WARMUP_WORDS,
  MAX_FONT_SCALE,
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

  it("marca o trecho que comeca no meio do paragrafo", () => {
    const recorte = sliceParagraphs(paragraphs, 1, 4);
    expect(recorte.map((p) => p.continued ?? false)).toEqual([true, false]);
  });
});

describe("inicio de paragrafo", () => {
  const { paragraphs } = parseParagraphs("um dois tres\n\nquatro cinco seis sete\n\noito");

  it("reconhece a primeira palavra de cada paragrafo", () => {
    const starts = Array.from({ length: 8 }, (_, index) => startsParagraph(paragraphs, index));
    expect(starts).toEqual([true, false, false, true, false, false, false, true]);
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
    expect(orpIndex("importacao")).toBe(3);
    // Nucleo acima de 13 letras: pivo na quinta letra.
    expect(orpIndex("extraordinario")).toBe(4);
  });

  it("ignora a pontuacao do inicio e do fim (ALG-12)", () => {
    // O pivo de "casa" e o "a"; a aspa de abertura so desloca o indice.
    expect(orpIndex('"casa')).toBe(2);
    expect(orpIndex("casa,")).toBe(1);
    expect(orpIndex("(cabana).")).toBe(3);
    expect(orpIndex("\u2014")).toBe(0);
    // A virgula final nao empurra a palavra para a faixa seguinte: "trabalhos,"
    // tem 10 caracteres, mas o nucleo tem 9.
    expect(orpIndex("trabalhos,")).toBe(orpIndex("trabalhos"));
    expect(orpIndex("importante.")).toBe(orpIndex("importante"));
  });

  it("conta code points em NFC, sem partir o acento", () => {
    // "a" + acento combinante: 2 unidades em NFD, 1 letra em NFC.
    const decomposta = "ac\u0327a\u0303o";
    expect(orpIndex(decomposta)).toBe(orpIndex("a\u00e7\u00e3o"));
    expect(orpParts(decomposta)).toEqual({ before: "a", pivot: "\u00e7", after: "\u00e3o" });
    expect(orpParts('"atencao",')).toEqual({ before: '"at', pivot: "e", after: 'ncao",' });
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

describe("warmupFactor", () => {
  it("comeca reduzido e chega ao ritmo cheio", () => {
    expect(warmupFactor(0)).toBe(WARMUP_START);
    expect(warmupFactor(WARMUP_WORDS)).toBe(1);
    expect(warmupFactor(WARMUP_WORDS * 10)).toBe(1);
  });

  it("sobe sem voltar atras", () => {
    let anterior = 0;
    for (let palavra = 0; palavra <= WARMUP_WORDS; palavra += 5) {
      const atual = warmupFactor(palavra);
      expect(atual).toBeGreaterThanOrEqual(anterior);
      anterior = atual;
    }
  });

  it("aceita o fator inicial e trata posicao negativa como o inicio (ALG-16)", () => {
    expect(WARMUP_WORDS).toBe(25);
    expect(warmupFactor(-5)).toBe(WARMUP_START);
    expect(warmupFactor(0, 0.85)).toBe(0.85);
    expect(warmupFactor(-3, 0.85)).toBe(0.85);
    expect(warmupFactor(0, 1)).toBe(1);
    expect(warmupFactor(12.5, 0.8)).toBeCloseTo(0.9, 10);
    expect(warmupFactor(WARMUP_WORDS, 0.85)).toBe(1);
  });

  it("nunca sai da faixa, nem com entrada absurda", () => {
    for (const palavra of [-100, Number.NaN, 1e9]) {
      const fator = warmupFactor(palavra);
      expect(fator).toBeGreaterThanOrEqual(WARMUP_START);
      expect(fator).toBeLessThanOrEqual(1);
    }
  });
});

describe("warmupStart (ALG-16)", () => {
  it("abertura e pausa de mais de 2 minutos comecam em 0,6", () => {
    expect(warmupStart()).toBe(0.6);
    expect(warmupStart(null)).toBe(0.6);
    expect(warmupStart(0)).toBe(0.6);
    expect(warmupStart(5 * 60_000)).toBe(0.6);
    expect(warmupStart(120_000)).toBe(0.6);
  });

  it("pausa de menos de 3 s nao tem rampa", () => {
    expect(warmupStart(1_000)).toBe(1);
    expect(warmupStart(2_999)).toBe(1);
  });

  it("de 3 a 30 s comeca em 0,85; de 30 s a 2 min desce ate 0,6", () => {
    expect(warmupStart(3_000)).toBe(0.85);
    expect(warmupStart(30_000)).toBe(0.85);
    expect(warmupStart(75_000)).toBeCloseTo(0.725, 10);
    expect(warmupStart(60_000)).toBeLessThan(0.85);
    expect(warmupStart(60_000)).toBeGreaterThan(0.6);
  });
});

describe("estimatedMinutes com as pausas", () => {
  it("soma o acrescimo medio das pausas quando o ritmo dinamico esta ligado", () => {
    // 1.000 palavras a 300 ppm: 3,3 min de palavras, ~3,9 com as pausas.
    expect(estimatedMinutes(1000, 300, false)).toBe(3);
    expect(estimatedMinutes(1000, 300)).toBe(4);
    expect(estimatedMinutes(1000, 300, true)).toBe(4);
    expect(estimatedMinutes(10, 300)).toBe(1);
  });
});

describe("tipografia", () => {
  it("cresce com o nivel e fica preso na faixa", () => {
    const tamanho = (nivel: number) =>
      Number.parseFloat(typographyVars({ fontScale: nivel, fontFamily: "sans", lineHeightStep: 2 })["--reader-size"]!);

    expect(tamanho(1)).toBeLessThan(tamanho(5));
    expect(tamanho(-5)).toBe(tamanho(1));
    expect(tamanho(99)).toBe(tamanho(MAX_FONT_SCALE));
    // O maior degrau chega a 2rem, o dobro do corpo base.
    expect(tamanho(MAX_FONT_SCALE)).toBe(2);
  });

  it("da entrelinha para todos os degraus", () => {
    for (const degrau of [1, 2, 3]) {
      const vars = typographyVars({ fontScale: 3, fontFamily: "sans", lineHeightStep: degrau });
      expect(Number.parseFloat(vars["--reader-leading"]!)).toBeGreaterThan(1);
    }
  });

  it("so a pilha legivel abre o espacamento entre letras", () => {
    const folga = (familia: "sans" | "serif" | "legivel") =>
      typographyVars({ fontScale: 3, fontFamily: familia, lineHeightStep: 2 })["--reader-tracking"];

    expect(folga("legivel")).not.toBe("normal");
    expect(folga("sans")).toBe("normal");
    expect(folga("serif")).toBe("normal");
  });

  it("recusa familia desconhecida em vez de repassar ao CSS", () => {
    // O valor entra em `var(--reader-font-X)`: aceitar qualquer texto criaria
    // uma variavel inexistente e a fonte cairia para o padrao do navegador.
    expect(asFontFamily("comic")).toBe("sans");
    expect(asFontFamily(null)).toBe("sans");
    expect(asFontFamily("serif")).toBe("serif");
  });
});

describe("isCompound", () => {
  it("reconhece palavra com hifen entre letras ou numeros", async () => {
    const { isCompound } = await import("@/lib/reading");
    expect(["guarda-chuva", "e-mail", "bem-vindo,", "COVID-19"].every(isCompound)).toBe(true);
  });

  it("travessao solto, hifen na ponta e palavra longa demais nao contam", async () => {
    const { isCompound } = await import("@/lib/reading");
    expect(["—", "-", "fim-", "-x", "a".repeat(30) + "-" + "b".repeat(15)].some(isCompound)).toBe(false);
  });
});
