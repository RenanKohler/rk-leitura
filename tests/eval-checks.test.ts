import { describe, expect, it } from "vitest";
import {
  caseProblems,
  citationProblems,
  explanationProblems,
  forbiddenProblems,
  loadCases,
  mentions,
  quizProblems,
  readPosition,
} from "./eval/checks";

/**
 * As verificacoes da avaliacao de IA (US-142) e os casos versionados, sem
 * rede: a chamada ao modelo so roda em `npm run eval:ia`.
 */

const cases = loadCases();

describe("casos da avaliacao", () => {
  it("tem ao menos 6 textos, em portugues e em ingles", () => {
    expect(cases.length).toBeGreaterThanOrEqual(6);
    expect(cases.some((item) => item.language === "pt-BR")).toBe(true);
    expect(cases.some((item) => item.language === "en")).toBe(true);
    expect(new Set(cases.map((item) => item.id)).size).toBe(cases.length);
  });

  it.each(cases.map((item) => [item.id, item] as const))("%s e um caso valido", (_id, item) => {
    expect(caseProblems(item)).toEqual([]);
    expect(readPosition(item)).toBeGreaterThan(0);
  });
});

describe("verificacoes", () => {
  const content = "O farol gira a cada sete segundos.\n\nOs pescadores reconhecem o ritmo.";

  it("aceita questionario com evidencia literal e alternativas distintas", () => {
    const quiz = {
      questions: [
        {
          prompt: "De quanto em quanto tempo o farol gira?",
          choices: ["Sete segundos", "Cinco segundos", "Dez segundos", "Um minuto"],
          evidence: "gira a cada sete   segundos",
          rationale: "O texto diz sete segundos.",
        },
      ],
    };
    expect(quizProblems(quiz, content)).toEqual([]);
  });

  it("recusa evidencia parafraseada, alternativas repetidas e justificativa longa", () => {
    const quiz = {
      questions: [
        {
          prompt: "?",
          choices: ["Sete", "sete ", "Dez", "Um"],
          evidence: "gira de sete em sete segundos",
          rationale: Array.from({ length: 41 }, () => "palavra").join(" "),
        },
      ],
    };
    expect(quizProblems(quiz, content)).toHaveLength(3);
  });

  it("citacao fora do recorte reprova", () => {
    const excerpt = { text: "O farol gira a cada sete segundos.", startWord: 0, endWord: 7 };
    const ok = { text: "Sete.", citations: [{ start: 2, end: 7, quote: "gira a cada sete segundos." }] };
    expect(citationProblems(ok, excerpt)).toEqual([]);
    const late = { text: "x", citations: [{ start: 7, end: 10, quote: "Os pescadores reconhecem" }] };
    expect(citationProblems(late, excerpt)).toHaveLength(2);
    expect(citationProblems({ text: "x", citations: [] }, excerpt)).toEqual(["resposta sem citação"]);
  });

  it("termo de depois da posicao so conta como palavra inteira", () => {
    expect(mentions("O capitão Ernesto agradeceu.", "ernesto")).toBe(true);
    expect(mentions("Ernestina chegou.", "Ernesto")).toBe(false);
    expect(forbiddenProblems("Fala de Lisboa.", ["Lisboa", "Aurélio"])).toHaveLength(1);
  });

  it("explicacao respeita o teto e traz a traducao em outro idioma", () => {
    expect(explanationProblems({ simple: "a", translation: null, explanation: "b" }, false)).toEqual([]);
    expect(explanationProblems({ simple: "a", translation: null, explanation: "b" }, true)).toHaveLength(1);
  });
});
