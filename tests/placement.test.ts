import { describe, expect, it } from "vitest";
import {
  COMPREHENSION_CEILING,
  COMPREHENSION_FLOOR,
  measuredWpm,
  MAX_TEST_SECONDS,
  minSeconds,
  PLACEMENT_QUESTIONS,
  PLACEMENT_TEXT,
  PLACEMENT_WORDS,
  plausibleDuration,
  scorePlacement,
  suggestionReason,
  suggestWpm,
} from "@/lib/placement";
import { MAX_WPM, MIN_WPM } from "@/lib/reading";

describe("material do teste", () => {
  it("tem texto suficiente para medir um ritmo", () => {
    expect(PLACEMENT_WORDS).toBeGreaterThan(400);
  });

  it("tem cinco perguntas, como o criterio pede", () => {
    expect(PLACEMENT_QUESTIONS).toHaveLength(5);
  });

  it("cada pergunta tem quatro alternativas e um gabarito valido", () => {
    for (const question of PLACEMENT_QUESTIONS) {
      expect(question.choices).toHaveLength(4);
      expect(new Set(question.choices).size).toBe(4);
      expect(question.answer).toBeGreaterThanOrEqual(0);
      expect(question.answer).toBeLessThan(question.choices.length);
    }
  });

  it("a resposta certa nao fica sempre na mesma posicao", () => {
    expect(new Set(PLACEMENT_QUESTIONS.map((q) => q.answer)).size).toBeGreaterThan(1);
  });

  it("o texto esta em paragrafos, nao em um bloco unico", () => {
    expect(PLACEMENT_TEXT.split(/\n\n/).length).toBeGreaterThan(3);
  });
});

describe("measuredWpm", () => {
  it("converte duracao em palavras por minuto", () => {
    expect(measuredWpm(60_000, 300)).toBe(300);
    expect(measuredWpm(120_000, 300)).toBe(150);
  });

  it("duracao zero nao vira infinito", () => {
    expect(measuredWpm(0, 300)).toBe(0);
  });
});

describe("scorePlacement", () => {
  it("gabarito inteiro da 100", () => {
    expect(scorePlacement(PLACEMENT_QUESTIONS.map((q) => q.answer))).toBe(100);
  });

  it("conta so os acertos", () => {
    const answers = PLACEMENT_QUESTIONS.map((q, i) => (i < 3 ? q.answer : (q.answer + 1) % 4));
    expect(scorePlacement(answers)).toBe(60);
  });

  it("sem respostas da zero", () => {
    expect(scorePlacement([])).toBe(0);
  });
});

describe("suggestWpm", () => {
  it("compreensao baixa sugere abaixo do medido", () => {
    const medido = 400;
    expect(suggestWpm(medido, COMPREHENSION_FLOOR - 20)).toBeLessThan(medido);
  });

  it("compreensao no meio acompanha o medido", () => {
    expect(suggestWpm(400, 70)).toBe(400);
  });

  it("compreensao alta sugere acima do medido", () => {
    expect(suggestWpm(400, COMPREHENSION_CEILING)).toBeGreaterThan(400);
  });

  it("nunca sai da faixa aceita pelo leitor", () => {
    expect(suggestWpm(50, 100)).toBeGreaterThanOrEqual(MIN_WPM);
    expect(suggestWpm(5_000, 100)).toBeLessThanOrEqual(MAX_WPM);
  });

  it("arredonda para a dezena, como o controle de velocidade", () => {
    expect(suggestWpm(337, 70) % 10).toBe(0);
  });
});

describe("suggestionReason", () => {
  it("explica cada faixa de forma diferente", () => {
    const baixa = suggestionReason(40);
    const media = suggestionReason(70);
    const alta = suggestionReason(90);
    expect(new Set([baixa, media, alta]).size).toBe(3);
    expect(baixa).toContain("60%");
  });
});

describe("plausibleDuration", () => {
  it("o piso vem do teto de velocidade, nao de um numero fixo", () => {
    // Ler o texto no maximo que o leitor permite leva este tempo; menos do
    // que isso nao e leitura.
    expect(minSeconds()).toBe(Math.ceil((PLACEMENT_WORDS / MAX_WPM) * 60));
    expect(measuredWpm(minSeconds() * 1000)).toBeLessThanOrEqual(MAX_WPM);
  });

  it("recusa o que foi rapido demais para ter sido lido", () => {
    expect(plausibleDuration((minSeconds() - 1) * 1000)).toBe(false);
  });

  it("recusa o que ficou aberto tempo demais", () => {
    expect(plausibleDuration((MAX_TEST_SECONDS + 1) * 1000)).toBe(false);
  });

  it("aceita uma leitura de verdade", () => {
    expect(plausibleDuration(90_000)).toBe(true);
  });

  it("acompanha o tamanho do texto", () => {
    expect(minSeconds(2_000)).toBeGreaterThan(minSeconds(500));
  });
});
