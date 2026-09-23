import { describe, expect, it } from "vitest";
import {
  checkpointCrossed,
  chunkFactor,
  effectiveWpm,
  fitParagraphEnd,
  highlightsBefore,
  normalizedWeights,
  predictMs,
  recapWindow,
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

describe("ritmo adaptativo (US-87, US-88)", () => {
  it("curta pesa menos que media; numero e nome proprio pesam mais", () => {
    expect(wordWeight("de", "casa")).toBeLessThan(wordWeight("janela", "casa"));
    expect(wordWeight("2026", "em")).toBeGreaterThan(wordWeight("hoje", "em"));
    expect(wordWeight("Maria", "com")).toBeGreaterThan(wordWeight("Maria", "fim."));
    expect(wordWeight("fim.", "o")).toBeGreaterThan(wordWeight("fim", "o"));
  });

  const texto = tokenize(
    "Em 2026, Maria leu de tudo. O texto seguia longo e cheio de detalhes, e a leitura de um capitulo inteiro levou a tarde toda. No fim, ela anotou o que lembrava."
  );

  it("a velocidade media fica a ate 5% da configurada, e nunca acima", () => {
    const weights = normalizedWeights(texto);
    const mean = weights.reduce((sum, w) => sum + w, 0) / weights.length;
    expect(mean).toBeGreaterThanOrEqual(1);
    expect(mean).toBeLessThanOrEqual(1.05);
  });

  it("nenhuma palavra passa mais de 5% mais rapido que o ppm", () => {
    expect(Math.min(...normalizedWeights(texto))).toBeGreaterThanOrEqual(0.95);
  });

  it("a variacao fica contida: nenhuma palavra passa de 1,4 vez o tempo medio", () => {
    expect(Math.max(...normalizedWeights(texto))).toBeLessThanOrEqual(1.4);
  });

  it("o bloco considera todas as palavras", () => {
    const weights = [0.5, 1.5, 1];
    expect(chunkFactor(weights, 0, 2)).toBe(1);
    expect(chunkFactor(weights, 1, 2)).toBe(1.25);
  });

  it("palavra ja consultada ganha 50% de tempo", () => {
    const words = tokenize("A efemeride foi lembrada.");
    const normal = normalizedWeights(words);
    const boosted = normalizedWeights(words, new Set([wordKeyForPace("efemeride")]));
    expect(boosted[1]! / normal[1]!).toBeCloseTo(1.5, 10);
    expect(boosted[0]).toBe(normal[0]);
  });
});
