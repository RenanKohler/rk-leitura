import { describe, expect, it } from "vitest";
import {
  checkpointCrossed,
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
import { parseParagraphs, tokenize } from "@/lib/reading";

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
    "Primeira frase termina aqui. " + Array(60).fill("palavra").join(" ") + ". Outra frase comeca e segue."
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

describe("pausas de pontuacao (Word Runner)", () => {
  const pausa = (texto: string, index: number, fimDeParagrafo = false) =>
    pauseAfter(tokenize(texto), index, fimDeParagrafo);

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
    expect(pausa("Frutas, legumes etc. Depois o resto.", 2)).toBe("clause");
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

  it("a pausa acompanha a velocidade, presa entre piso e teto", () => {
    // 300 ppm: 200 ms por palavra; fim de frase = 1,8 palavra.
    expect(pauseMs("sentence", 300)).toBe(360);
    // Devagar, o teto evita a leitura gaguejando.
    expect(pauseMs("sentence", 100)).toBe(480);
    expect(pauseMs("paragraph", 100)).toBe(700);
    // Rapido, o piso impede a pausa de sumir.
    expect(pauseMs("sentence", 1200)).toBe(160);
    expect(pauseMs("none", 300)).toBe(0);
  });

  it("duracao da palavra: peso vezes a palavra, mais a pausa, com a rampa", () => {
    expect(runnerDelayMs(300, 1, "none")).toBe(200);
    expect(runnerDelayMs(300, 1.2, "none")).toBeCloseTo(240, 10);
    expect(runnerDelayMs(300, 1, "sentence")).toBe(560);
    expect(runnerDelayMs(300, 1, "none", 0.5)).toBe(400);
  });
});

function pausaMs(kind: "clause" | "sentence" | "paragraph") {
  return pauseMs(kind, 300);
}
