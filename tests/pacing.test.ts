import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ADAPTIVE_FLOOR,
  checkpointCrossed,
  effectiveRunnerWpm,
  HEADING_BOOST,
  isSentenceEnd,
  PAUSE_OVERHEAD,
  pauseOverhead,
  predictRunnerMs,
  PUNCTUATION_WEIGHT,
  sentenceBounds,
  effectiveWpm,
  fitParagraphEnd,
  highlightsBefore,
  normalizedWeights,
  pauseAfter,
  pauseKinds,
  pauseMs,
  predictMs,
  recapWindow,
  runnerDelayMs,
  savedMinutes,
  wordKeyForPace,
  wordWeight,
} from "@/lib/pacing";
import { parseParagraphs, tokenize, warmupFactor } from "@/lib/reading";

const agora = new Date("2026-09-22T12:00:00Z");
const diasAtras = (dias: number) => new Date(agora.getTime() - dias * 86_400_000);
const sessao = (wpm: number, extra: Partial<Parameters<typeof effectiveWpm>[0][number]> = {}) => ({
  wpm,
  wordsRead: 500,
  narrated: false,
  createdAt: diasAtras(1),
  ...extra,
});

describe("ritmo real (US-83)", () => {
  it("usa a mediana das sessoes validas", () => {
    expect(effectiveWpm([sessao(300), sessao(320), sessao(900)], 250, agora)).toEqual({
      wpm: 320,
      fromSettings: false,
    });
  });

  it("ignora narradas, curtas, lentas demais, no teto e antigas", () => {
    const samples = [
      sessao(300),
      sessao(310),
      sessao(500, { narrated: true }),
      sessao(500, { wordsRead: 100 }),
      sessao(40),
      sessao(1200),
      sessao(500, { createdAt: diasAtras(40) }),
    ];
    expect(effectiveWpm(samples, 250, agora)).toEqual({ wpm: 250, fromSettings: true });
  });

  it("usa no maximo as 10 mais recentes", () => {
    const antigas = Array.from({ length: 10 }, (_, i) => sessao(200, { createdAt: diasAtras(20 + i) }));
    const recentes = Array.from({ length: 10 }, () => sessao(400));
    expect(effectiveWpm([...antigas, ...recentes], 250, agora).wpm).toBe(400);
  });
});

describe("tempo e ponto de parada (US-84)", () => {
  it("preve o tempo sem e com rampa", () => {
    expect(predictMs(300, 300, false)).toBe(60_000);
    expect(predictMs(300, 300, true)).toBeGreaterThan(60_000);
  });

  it("para no fim do ultimo paragrafo que cabe", () => {
    const { paragraphs } = parseParagraphs(
      [Array(100).fill("a").join(" "), Array(100).fill("b").join(" "), Array(100).fill("c").join(" ")].join("\n\n")
    );
    // 60 segundos a 200 ppm: cabem 200 palavras, os dois primeiros paragrafos.
    expect(fitParagraphEnd(paragraphs, 0, 60_000, 200, false)).toEqual({ end: 200, predictedMs: 60_000 });
    // Do meio do primeiro paragrafo, o fim dele cabe; o do segundo nao.
    expect(fitParagraphEnd(paragraphs, 50, 40_000, 200, false)?.end).toBe(100);
  });

  it("nada serve quando nem o paragrafo atual cabe", () => {
    const { paragraphs } = parseParagraphs(Array(500).fill("a").join(" "));
    expect(fitParagraphEnd(paragraphs, 0, 60_000, 200, false)).toBeNull();
  });
});

describe("recapitulacao (US-77, US-78)", () => {
  const words = tokenize(
    "Primeira frase termina aqui. Depois " + Array(60).fill("palavra").join(" ") + ". Outra frase comeca e segue."
  );

  it("aparece depois de 48 horas, alem da palavra 40, comecando na frase", () => {
    const window = recapWindow(words, 50, diasAtras(3), agora, false);
    expect(window).not.toBeNull();
    expect(window!.to).toBe(50);
    expect(words[window!.from - 1]).toMatch(/\.$/);
  });

  it("nao aparece antes de 48 horas, no inicio ou com posicao escolhida", () => {
    expect(recapWindow(words, 50, diasAtras(1), agora, false)).toBeNull();
    expect(recapWindow(words, 30, diasAtras(3), agora, false)).toBeNull();
    expect(recapWindow(words, 50, diasAtras(3), agora, true)).toBeNull();
    expect(recapWindow(words, 50, null, agora, false)).toBeNull();
  });

  it("usa os 5 destaques mais proximos antes da posicao", () => {
    const marks = Array.from({ length: 8 }, (_, i) => ({ start: i * 10, end: i * 10 + 5 }));
    const chosen = highlightsBefore(marks, 70);
    expect(chosen).toHaveLength(5);
    expect(chosen[0]!.start).toBe(20);
    expect(chosen.at(-1)!.start).toBe(60);
  });
});

describe("marcos de desistencia (US-80, US-81)", () => {
  it("pergunta em 25, 50 e 75%, uma vez cada", () => {
    expect(checkpointCrossed(200, 1000, 0)).toBeNull();
    expect(checkpointCrossed(250, 1000, 0)).toBe(25);
    expect(checkpointCrossed(260, 1000, 25)).toBeNull();
    expect(checkpointCrossed(760, 1000, 25)).toBe(75);
  });

  it("texto curto nao pergunta", () => {
    expect(checkpointCrossed(700, 799, 0)).toBeNull();
  });

  it("minutos economizados pelo ritmo", () => {
    expect(savedMinutes(3000, 300)).toBe(10);
    expect(savedMinutes(3000, 0)).toBe(0);
  });
});

describe("peso lexical (US-87, US-88)", () => {
  it("curta pesa menos que media; longa, numero e nome proprio pesam mais", () => {
    expect(wordWeight("de", "casa")).toBeLessThan(wordWeight("janela", "casa"));
    expect(wordWeight("paralelepipedo", "o")).toBeGreaterThan(wordWeight("janela", "o"));
    expect(wordWeight("2026", "em")).toBeGreaterThan(wordWeight("hoje", "em"));
    expect(wordWeight("Maria", "com")).toBeGreaterThan(wordWeight("Maria", "fim."));
  });

  it("a pontuacao nao entra no peso: vira pausa", () => {
    expect(wordWeight("fim.", "o")).toBe(wordWeight("fim", "o"));
    expect(wordWeight("\u2014", "disse")).toBeLessThan(wordWeight("de", "casa"));
  });

  const texto = tokenize(
    "Em 2026, Maria leu de tudo. O texto seguia longo e cheio de detalhes, e a leitura de um capitulo inteiro levou a tarde toda. No fim, ela anotou o que lembrava."
  );

  it("a velocidade media das palavras fica na configurada", () => {
    const weights = normalizedWeights(texto);
    const mean = weights.reduce((sum, w) => sum + w, 0) / weights.length;
    expect(mean).toBeGreaterThanOrEqual(0.98);
    expect(mean).toBeLessThanOrEqual(1.05);
  });

  it("nenhuma palavra passa mais de 10% mais rapido que o ppm nem de 1,5 vez", () => {
    const weights = normalizedWeights(texto);
    expect(Math.min(...weights)).toBeGreaterThanOrEqual(0.9);
    expect(Math.max(...weights)).toBeLessThanOrEqual(1.5);
  });

  it("palavra ja consultada ganha 50% de tempo", () => {
    const words = tokenize("A efemeride foi lembrada.");
    const normal = normalizedWeights(words);
    const boosted = normalizedWeights(words, new Set([wordKeyForPace("efemeride")]));
    expect(boosted[1]! / normal[1]!).toBeCloseTo(1.5, 10);
    expect(boosted[0]).toBe(normal[0]);
  });
});

const pausa = (texto: string, index: number, fimDeParagrafo = false) =>
  pauseAfter(tokenize(texto), index, fimDeParagrafo);

describe("pausas de pontuacao (Word Runner)", () => {
  it("virgula, ponto e fim de paragrafo, em ordem crescente", () => {
    expect(pausa("Ela veio, viu tudo.", 1)).toBe("clause");
    expect(pausa("Ela veio. Depois saiu.", 1)).toBe("sentence");
    expect(pausa("Ela veio. Depois saiu.", 1, true)).toBe("paragraph");
    expect(pausa("Ela veio e saiu.", 1)).toBe("none");
    expect(pausaMs("clause")).toBeLessThan(pausaMs("sentence"));
    expect(pausaMs("sentence")).toBeLessThan(pausaMs("paragraph"));
  });

  it("aspas e parenteses depois da pontuacao nao escondem a pausa", () => {
    expect(pausa('Ele disse "chega." Depois saiu.', 2)).toBe("sentence");
    expect(pausa("Um (talvez dois), no maximo.", 2)).toBe("clause");
  });

  it("interrogacao, exclamacao e reticencias sempre encerram", () => {
    expect(pausa("Voce vem? ela perguntou.", 1)).toBe("sentence");
    expect(pausa("E entao... nada.", 1)).toBe("sentence");
    expect(pausa("E entao\u2026 nada.", 1)).toBe("sentence");
  });

  it("tratamento, inicial e abreviatura nao encerram a frase", () => {
    expect(pausa("O Sr. Silva chegou.", 1)).toBe("none");
    expect(pausa("Livro de J. R. R. Tolkien.", 2)).toBe("none");
    expect(pausa("Veja o cap. tres.", 2)).toBe("none");
    // "etc." antes de maiuscula fecha a frase (ALG-6); antes de minuscula, nao.
    expect(pausa("Frutas, legumes etc. Depois o resto.", 2)).toBe("sentence");
    expect(pausa("Frutas, legumes etc. e o resto.", 2)).toBe("none");
    expect(pausa("Ele disse sim, e. Depois saiu.", 3)).toBe("sentence");
  });

  it("ponto seguido de minuscula vira so pausa curta", () => {
    expect(pausa("As 3 p.m. ela saiu.", 2)).toBe("clause");
  });

  it("o travessao pausa antes dele, nao depois", () => {
    expect(pausa("Ele \u2014 que era timido \u2014 saiu.", 0)).toBe("clause");
    expect(pausa("Ele \u2014 que era timido \u2014 saiu.", 1)).toBe("none");
  });

  it("a ultima palavra do texto nao pausa", () => {
    expect(pausa("Fim.", 0, true)).toBe("none");
  });

  it("marca o fim de cada paragrafo", () => {
    const { words, paragraphs } = parseParagraphs("Primeiro bloco aqui\n\nSegundo bloco, curto.\n\nFim");
    const kinds = pauseKinds(words, paragraphs);
    expect(kinds[2]).toBe("paragraph");
    expect(kinds[4]).toBe("clause");
    expect(kinds[5]).toBe("paragraph");
    expect(kinds[6]).toBe("none");
  });

  it("a pausa segue a lei de potencia ancorada em 300 ppm (ALG-4)", () => {
    // 300 ppm: 200 ms por palavra, os valores de ancoragem.
    expect(pauseMs("clause", 300)).toBe(160);
    expect(pauseMs("sentence", 300)).toBe(360);
    expect(pauseMs("paragraph", 300)).toBe(520);
    // 100 ppm: 600 ms por palavra; 3^0,8 = 2,408 - cresce menos que a palavra.
    expect(pauseMs("clause", 100)).toBe(385);
    expect(pauseMs("sentence", 100)).toBe(867);
    expect(pauseMs("paragraph", 100)).toBe(1252);
    // 900 ppm: 66,7 ms por palavra; (1/3)^0,8 = 0,415 - encolhe menos que a palavra.
    expect(pauseMs("clause", 900)).toBe(66);
    expect(pauseMs("sentence", 900)).toBe(149);
    expect(pauseMs("paragraph", 900)).toBe(216);
    // Sem piso nem teto secos: 150 ppm pausa mais que 100? Nao - menos, e diferente.
    expect(pauseMs("sentence", 150)).toBeLessThan(pauseMs("sentence", 100));
    expect(pauseMs("sentence", 1200)).toBeLessThan(pauseMs("sentence", 900));
    // So o teto de seguranca de 1,5 s.
    expect(pauseMs("paragraph", 40)).toBe(1500);
    expect(pauseMs("none", 300)).toBe(0);
  });

  it("duracao da palavra: peso vezes a palavra, mais a pausa, com a rampa", () => {
    expect(runnerDelayMs(300, 1, "none")).toBe(200);
    expect(runnerDelayMs(300, 1.2, "none")).toBeCloseTo(240, 10);
    expect(runnerDelayMs(300, 1, "sentence")).toBe(560);
    expect(runnerDelayMs(300, 1, "none", 0.5)).toBe(400);
    // A rampa desacelera a pausa junto com a palavra (ALG-16).
    expect(runnerDelayMs(300, 1, "sentence", 0.5)).toBe(400 + 720);
  });
});

function pausaMs(kind: "clause" | "sentence" | "paragraph") {
  return pauseMs(kind, 300);
}

describe("falsos fins de frase (ALG-5)", () => {
  const pausas = (texto: string, language?: string) =>
    pauseKinds(tokenize(texto), [{ start: 0, words: tokenize(texto) }], language);

  it("abreviatura antes de numero, romano ou parentese nao pausa", () => {
    // "Veja a p. 12 do cap. 3.": so a ultima palavra fecha, e ela e o fim do texto.
    expect(pausas("Veja a p. 12 do cap. 3.")).toEqual(Array(7).fill("none"));
    for (const texto of [
      "Na fig. 2 aparece o erro.",
      "O art. 5 garante isso.",
      "A tab. 4 resume os dados.",
      "Saiu no vol. II da serie.",
      "Silva et al. (2020) mostraram isso.",
      "Veja o n. 5 da lista.",
      "Consulte o v. 3 da obra.",
      "Veja o no. 5 da revista.",
      "Veja o nº. 7 da revista.",
      "Foi no sec. XIX que tudo mudou.",
      "Foi no séc. XIX que tudo mudou.",
      "Nasceu em 5 de mar. de 1990 no Rio.",
      "Morreu em 300 a.C. na Grecia.",
      "Uma fruta, p.ex. a maca, basta.",
      "A Acme S.A. comprou a Beta Ltda. no ano passado.",
    ]) {
      expect(pausas(texto), texto).not.toContain("sentence");
    }
  });

  it("tratamento antes de nome nao pausa", () => {
    expect(pausa("O Sr. Silva chegou.", 1)).toBe("none");
    expect(pausa("A Dra. Souza chegou.", 1)).toBe("none");
  });

  it("palavra comum que tambem e abreviatura fecha a frase antes de maiuscula", () => {
    // "mar." so e mes antes de numero ou minuscula; "no." so antes de numero.
    expect(pausa("Olhou o mar. Depois voltou.", 2)).toBe("sentence");
    expect(pausa("Ela disse que ficaria no. Depois saiu.", 4)).toBe("sentence");
  });

  it("listas por idioma", () => {
    const en = (texto: string, index: number) => pauseAfter(tokenize(texto), index, false, "en");
    expect(en("Mr. Smith arrived.", 0)).toBe("none");
    expect(en("Mrs. Smith arrived.", 0)).toBe("none");
    expect(en("Ask Dr. Who now.", 1)).toBe("none");
    expect(en("See No. 5 now.", 1)).toBe("none");
    expect(en("The U.S. Army came.", 1)).toBe("none");
    expect(en("Fruit, e.g. apples, helps.", 1)).toBe("none");
    expect(en("Read it, i.e. twice.", 2)).toBe("none");
    expect(en("Brazil vs. Chile ended.", 1)).toBe("none");
    expect(en("See Fig. 3 below.", 1)).toBe("none");
    expect(en("See p. 3 below.", 1)).toBe("none");
    expect(en("See pp. 3-5 below.", 1)).toBe("none");
    // "tab." e abreviatura em portugues, nao em ingles.
    expect(en("Open the tab. Then read.", 2)).toBe("sentence");
    expect(pauseAfter(tokenize("Veja a tab. Depois leia."), 2, false, "pt-BR")).toBe("none");
  });

  it("marcador de lista no inicio do paragrafo: peso minimo e sem pausa propria", () => {
    const { words, paragraphs } = parseParagraphs("Passos:\n1. Abra o texto.\n2. Leia com calma.");
    const kinds = pauseKinds(words, paragraphs);
    expect(words[1]).toBe("1.");
    expect(kinds[1]).toBe("none");
    expect(kinds[5]).toBe("none");
    const weights = normalizedWeights(words, new Set(), paragraphs);
    expect(weights[1]).toBe(ADAPTIVE_FLOOR);
    expect(weights[5]).toBe(ADAPTIVE_FLOOR);
    // No meio da frase, "12." e numero comum e fecha a frase.
    expect(pausa("Cheguei no dia 12. Depois saimos.", 3)).toBe("sentence");
  });
});

describe("fins de frase perdidos (ALG-6)", () => {
  it("letra maiuscula isolada depois de palavra comum fecha a frase", () => {
    expect(pausa("Tomou vitamina D. Depois dormiu.", 2)).toBe("sentence");
    expect(pausa("Era o plano B. Ninguem sabia.", 3)).toBe("sentence");
  });

  it("inicial de nome continua emendando", () => {
    expect(pausa("Livro de J. R. R. Tolkien.", 2)).toBe("none");
    expect(pausa("Livro de J. R. R. Tolkien.", 4)).toBe("none");
    expect(pausa("Texto de J. Silva sobre isso.", 2)).toBe("none");
    expect(pausa("Segundo A. Souza, nao.", 1)).toBe("none");
  });

  it("etc. seguido de maiuscula fecha a frase", () => {
    expect(pausa("Levou frutas, legumes etc. Depois pagou.", 3)).toBe("sentence");
    expect(isSentenceEnd(tokenize("Levou frutas etc. Depois pagou."), 2)).toBe(true);
  });
});

describe("virgula fora do lugar (ALG-7)", () => {
  it("virgula dentro de citacao numerica nao pausa", () => {
    expect(pausa("Estudos [2, 3] mostram isso.", 1)).toBe("none");
    expect(pausa("Estudos [2, 5, 9] mostram isso.", 2)).toBe("none");
    // A virgula depois do colchete e de oracao.
    expect(pausa("Estudos [2, 3], porem, divergem.", 2)).toBe("clause");
    // Citacao com texto nao e so numerica.
    expect(pausa("Veja [Silva, 2020] depois.", 1)).toBe("clause");
  });

  it("palavra antes de parentese pausa como antes de travessao", () => {
    expect(pausa("O autor (2020) mostrou isso.", 1)).toBe("clause");
    // O parentese fechado respira do outro lado, como o travessao de fecho.
    expect(pausa("O autor (2020) mostrou isso.", 2)).toBe("clause");
    expect(pausa("O autor citado mostrou isso.", 1)).toBe("none");
  });
});

describe("segmentador unico (ALG-8)", () => {
  it("isSentenceEnd e sentenceBounds concordam com a pausa de frase", () => {
    const words = tokenize("O Sr. Silva chegou. Depois saiu.");
    expect(words.map((_, index) => isSentenceEnd(words, index))).toEqual([
      false,
      false,
      false,
      true,
      false,
      true,
    ]);
    expect(sentenceBounds(words, 2)).toEqual({ start: 0, end: 4 });
    expect(sentenceBounds(words, 4)).toEqual({ start: 4, end: 6 });
  });

  it("a recapitulacao nao comeca depois de um tratamento", () => {
    const words = tokenize(
      "Inicio da historia. Depois " +
        Array(30).fill("palavra").join(" ") +
        " com o Sr. " +
        Array(20).fill("Silva").join(" ")
    );
    const window = recapWindow(words, 50, diasAtras(3), agora, false);
    // Recua ate a frase de verdade (depois de "historia."), nao ate "Sr.".
    expect(window!.from).toBe(3);
    expect(words[3]).toBe("Depois");
  });
});

describe("pesos: pontuacao, normalizacao e nome proprio", () => {
  it("token sem letras nem digitos pesa 0,35, fora da normalizacao (ALG-11)", () => {
    const words = tokenize("Ele veio — e saiu · depois = fim | agora.");
    const weights = normalizedWeights(words);
    const soltos = [2, 5, 7, 9];
    for (const index of soltos) expect(weights[index]).toBe(PUNCTUATION_WEIGHT);
    expect(PUNCTUATION_WEIGHT).toBe(0.35);
    const letras = weights.filter((_, index) => !soltos.includes(index));
    const mean = letras.reduce((sum, w) => sum + w, 0) / letras.length;
    expect(Math.abs(mean - 1)).toBeLessThanOrEqual(0.01);
  });

  it("a media dos pesos fica em 1,00 +- 0,01 (ALG-13)", () => {
    const textos = [
      "Em 2026, Maria leu de tudo. O texto seguia longo e cheio de detalhes, e a leitura de um capitulo inteiro levou a tarde toda. No fim, ela anotou o que lembrava.",
      "A leitura profunda e o tipo de leitura em que a atencao fica inteira no texto por um periodo longo. Nao e so decodificar palavras: e acompanhar um argumento ate o fim, guardar o que veio antes e relacionar com o que vem depois.",
      "O estado de fluxo descrito por Mihaly Csikszentmihalyi aparece quando a dificuldade da tarefa se equilibra com a habilidade de quem a executa. Privacao de sono derruba a atencao sustentada de forma comparavel a intoxicacao alcoolica leve.",
      "Eu vi o que ele fez e so. Mas ai ele me viu e foi em bora, e eu tb.",
    ];
    for (const texto of textos) {
      const weights = normalizedWeights(tokenize(texto));
      const mean = weights.reduce((sum, w) => sum + w, 0) / weights.length;
      expect(Math.abs(mean - 1), texto).toBeLessThanOrEqual(0.01);
      expect(Math.min(...weights)).toBeGreaterThanOrEqual(ADAPTIVE_FLOOR);
      expect(Math.max(...weights)).toBeLessThanOrEqual(1.5);
    }
  });

  it("inicio de frase vem do segmentador; tratamento e inicial dao o bonus de nome (ALG-14)", () => {
    expect(wordWeight("Silva", "Sr.")).toBeGreaterThan(wordWeight("Silva", "fim."));
    expect(wordWeight("Silva", "J.")).toBeGreaterThan(wordWeight("Silva", "fim."));
    // O travessao do dialogo nao conta como palavra anterior.
    const words = tokenize("Ele saiu. — Maria voltou e viu Maria.");
    const weights = normalizedWeights(words);
    expect(weights[3]).toBeLessThan(weights[7]!);
    // Aspas de abertura tambem nao.
    const citado = tokenize('Ele saiu. "Maria voltou e viu Maria."');
    const pesos = normalizedWeights(citado);
    expect(pesos[2]).toBeLessThan(pesos[6]!);
  });
});

describe("Markdown no ritmo (ALG-18)", () => {
  it("fim de item de lista e linha de tabela pausam como frase", () => {
    const lista = parseParagraphs("- Primeiro item\n- Segundo item\n\nParagrafo final aqui.", "markdown");
    const kinds = pauseKinds(lista.words, lista.paragraphs);
    expect(kinds[1]).toBe("sentence");
    expect(kinds[3]).toBe("sentence");

    const tabela = parseParagraphs("| Nome | Nota |\n| --- | --- |\n| Ana | 9 |\n\nFim.", "markdown");
    const pausasTabela = pauseKinds(tabela.words, tabela.paragraphs);
    const fimDaPrimeiraLinha = tabela.paragraphs[0]!.words.length - 1;
    expect(pausasTabela[fimDaPrimeiraLinha]).toBe("sentence");
    // A palavra antes do separador de celula respira como antes de travessao.
    expect(pausasTabela[0]).toBe("clause");
  });

  it("linhas de codigo seguidas pausam como virgula; titulo como paragrafo", () => {
    const codigo = parseParagraphs("```\nconst a = 1;\nconst b = 2;\n```\n\nTexto.", "markdown");
    const kinds = pauseKinds(codigo.words, codigo.paragraphs);
    expect(kinds[codigo.paragraphs[0]!.words.length - 1]).toBe("clause");
    const segunda = codigo.paragraphs[1]!;
    expect(kinds[segunda.start + segunda.words.length - 1]).toBe("paragraph");

    const titulo = parseParagraphs("# Um titulo\n\nTexto comum aqui.", "markdown");
    expect(pauseKinds(titulo.words, titulo.paragraphs)[1]).toBe("paragraph");
  });

  it("palavras de titulo ganham 12% de peso", () => {
    const titulo = parseParagraphs("# Um titulo\n\nTexto comum aqui.", "markdown");
    const com = normalizedWeights(titulo.words, new Set(), titulo.paragraphs);
    const comoParagrafo = titulo.paragraphs.map((paragraph) => ({ ...paragraph, kind: "p" as const }));
    const sem = normalizedWeights(titulo.words, new Set(), comoParagrafo);
    expect(HEADING_BOOST).toBe(1.12);
    expect(com[1]! / sem[1]!).toBeCloseTo(1.12, 10);
    expect(com[3]).toBeCloseTo(sem[3]!, 10);
  });
});

describe("previsao com as pausas (ALG-3)", () => {
  const texto = parseParagraphs(
    "O Sr. Silva chegou cedo, abriu a porta e ficou. Depois, sem pressa, leu a p. 12 do cap. 3.\n\n" +
      "Em 2026 a leitura mudou. Ninguem sabia por que, mas todos liam mais.\n\n" +
      "No fim, restou o habito."
  );

  it("predictRunnerMs e a soma de runnerDelayMs, como o leitor agenda", () => {
    const { words, paragraphs } = texto;
    const weights = normalizedWeights(words, new Set(), paragraphs);
    const pauses = pauseKinds(words, paragraphs);
    for (const [wpm, warmup] of [
      [300, false],
      [300, true],
      [900, true],
      [120, false],
    ] as const) {
      let soma = 0;
      for (let index = 3; index < words.length; index += 1) {
        const fator = warmup ? warmupFactor(index - 3) : 1;
        soma += runnerDelayMs(wpm, weights[index]!, pauses[index]!, fator);
      }
      const previsto = predictRunnerMs(words, paragraphs, 3, words.length, wpm, { adaptive: true, warmup });
      expect(Math.abs(previsto - soma) / soma).toBeLessThan(0.01);
    }
  });

  it("soma as pausas ao tempo das palavras; sem ritmo dinamico, nao", () => {
    const { words, paragraphs } = texto;
    const n = words.length;
    const com = predictRunnerMs(words, paragraphs, 0, n, 300, { adaptive: true, warmup: false });
    const sem = predictRunnerMs(words, paragraphs, 0, n, 300, { adaptive: false, warmup: false });
    expect(sem).toBeCloseTo(predictMs(n, 300, false), 6);
    expect(com).toBeGreaterThan(sem * 1.1);
    expect(predictRunnerMs(words, paragraphs, 5, 5, 300, { adaptive: true, warmup: true })).toBe(0);
  });

  it("fitParagraphEnd com as palavras usa a previsao do Word Runner", () => {
    const { words, paragraphs } = texto;
    const fimDoSegundo = paragraphs[1]!.start + paragraphs[1]!.words.length;
    const ate = predictRunnerMs(words, paragraphs, 0, fimDoSegundo, 300, { adaptive: true, warmup: true });
    const fit = fitParagraphEnd(paragraphs, 0, ate + 1, 300, true, { words });
    expect(fit?.end).toBe(fimDoSegundo);
    expect(fit?.predictedMs).toBeCloseTo(ate, 6);
    // Contando so palavras caberia o texto todo: a previsao antiga subestimava.
    expect(fitParagraphEnd(paragraphs, 0, ate + 1, 300, true)?.end).toBe(words.length);
  });

  it("o acrescimo medio das pausas fica perto do medido nos textos de exemplo", () => {
    expect(PAUSE_OVERHEAD).toBeGreaterThanOrEqual(1.15);
    expect(PAUSE_OVERHEAD).toBeLessThanOrEqual(1.25);
    expect(pauseOverhead(300)).toBe(PAUSE_OVERHEAD);
    // Lei de potencia: em ritmo alto a pausa pesa mais, relativamente.
    expect(pauseOverhead(100)).toBeLessThan(pauseOverhead(300));
    expect(pauseOverhead(900)).toBeGreaterThan(pauseOverhead(300));

    const seed = readFileSync("src/db/seed.ts", "utf8");
    const conteudos = [...seed.matchAll(/content: `([^`]*)`/g)].map((match) => match[1]!);
    expect(conteudos.length).toBeGreaterThan(0);
    for (const conteudo of conteudos) {
      const { words, paragraphs } = parseParagraphs(conteudo);
      for (const wpm of [150, 300, 600]) {
        const real = predictRunnerMs(words, paragraphs, 0, words.length, wpm, {
          adaptive: true,
          warmup: false,
        });
        const medido = real / predictMs(words.length, wpm, false);
        expect(Math.abs(pauseOverhead(wpm) - medido)).toBeLessThan(0.03);
      }
    }
  });

  it("ritmo real do Word Runner com as pausas", () => {
    expect(effectiveRunnerWpm(300)).toBe(Math.round(300 / PAUSE_OVERHEAD));
    expect(effectiveRunnerWpm(300)).toBeGreaterThan(230);
    expect(effectiveRunnerWpm(300)).toBeLessThan(270);
    const { words, paragraphs } = texto;
    const medido = effectiveRunnerWpm(300, words, paragraphs);
    const total = predictRunnerMs(words, paragraphs, 0, words.length, 300, {
      adaptive: true,
      warmup: false,
    });
    expect(medido).toBe(Math.round((words.length * 60_000) / total));
    expect(medido).toBeLessThan(300);
  });
});
