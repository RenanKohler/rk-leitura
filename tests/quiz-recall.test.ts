import { describe, expect, it } from "vitest";
import {
  dueRecallRound,
  nextRecallDueOn,
  RECALL_EXPIRY_DAYS,
  recallDueOn,
  recallExpiresOn,
  recallQuestions,
  recallSeed,
  scoreRecall,
  shuffledOrder,
} from "@/lib/quiz-recall";
import type { Quiz } from "@/lib/quiz";

const concluded = "2026-09-01";

describe("rodadas do questionario refeito", () => {
  it("vence aos 7 e aos 30 dias da conclusao", () => {
    expect(recallDueOn(concluded, 7)).toBe("2026-09-08");
    expect(recallDueOn(concluded, 30)).toBe("2026-10-01");
    expect(dueRecallRound(concluded, "2026-09-07", [])).toBeNull();
    expect(dueRecallRound(concluded, "2026-09-08", [])).toBe(7);
    expect(dueRecallRound(concluded, "2026-09-20", [])).toBe(7);
  });

  it("feita a de 7, so volta aos 30", () => {
    expect(dueRecallRound(concluded, "2026-09-20", [7])).toBeNull();
    expect(dueRecallRound(concluded, "2026-10-01", [7])).toBe(30);
    expect(dueRecallRound(concluded, "2026-12-01", [7, 30])).toBeNull();
  });

  it("depois dos 30 dias sem a de 7, faz so a ultima", () => {
    expect(dueRecallRound(concluded, "2026-10-05", [])).toBe(30);
    expect(dueRecallRound(concluded, "2026-10-05", [30])).toBeNull();
  });

  it("proxima rodada, para contar o que vence amanha", () => {
    expect(nextRecallDueOn(concluded, "2026-09-07", [])).toBe("2026-09-08");
    expect(nextRecallDueOn(concluded, "2026-09-10", [7])).toBe("2026-10-01");
    expect(nextRecallDueOn(concluded, "2026-10-10", [30])).toBeNull();
  });
});

/** Prazo e dispensa da rodada (US-223). */
describe("rodada que expira ou e dispensada", () => {
  it("a de 30 dias vale 30 dias depois de vencer e some no dia 60", () => {
    expect(RECALL_EXPIRY_DAYS).toBe(30);
    // Concluido em 01/09: a rodada vence em 01/10 (dia 30) e expira em 31/10 (dia 60).
    expect(recallExpiresOn(concluded, 30)).toBe("2026-10-31");
    expect(dueRecallRound(concluded, "2026-10-01", [])).toBe(30);
    expect(dueRecallRound(concluded, "2026-10-30", [])).toBe(30);
    expect(dueRecallRound(concluded, "2026-10-31", [])).toBeNull();
    expect(dueRecallRound(concluded, "2027-03-01", [])).toBeNull();
    // Com a de 7 feita, a de 30 expira do mesmo jeito.
    expect(dueRecallRound(concluded, "2026-10-30", [7])).toBe(30);
    expect(dueRecallRound(concluded, "2026-10-31", [7])).toBeNull();
  });

  it("a de 7 dias expira quando a de 30 toma o lugar dela", () => {
    expect(recallExpiresOn(concluded, 7)).toBe(recallDueOn(concluded, 30));
    expect(dueRecallRound(concluded, "2026-09-30", [])).toBe(7);
    expect(dueRecallRound(concluded, "2026-10-01", [])).toBe(30);
  });

  it("rodada expirada nao volta a contar como proxima", () => {
    expect(nextRecallDueOn(concluded, "2026-10-31", [])).toBeNull();
    expect(nextRecallDueOn(concluded, "2026-10-31", [7])).toBeNull();
    // Na vespera do vencimento ela ainda e a proxima: o prazo so corre depois.
    expect(nextRecallDueOn(concluded, "2026-09-30", [])).toBe("2026-10-01");
  });

  it("dispensar a de 7 encerra so ela: a de 30 ainda vence", () => {
    // A rodada dispensada entra em `done` como a respondida.
    expect(dueRecallRound(concluded, "2026-09-10", [7])).toBeNull();
    expect(nextRecallDueOn(concluded, "2026-09-10", [7])).toBe("2026-10-01");
    expect(dueRecallRound(concluded, "2026-10-01", [7])).toBe(30);
  });

  it("dispensar a de 30 encerra o questionario do texto", () => {
    // Dispensada sem a de 7 ter sido feita: a de 7 nao volta depois da de 30.
    expect(dueRecallRound(concluded, "2026-10-05", [30])).toBeNull();
    expect(dueRecallRound(concluded, "2026-10-20", [30])).toBeNull();
    expect(nextRecallDueOn(concluded, "2026-10-05", [30])).toBeNull();
  });
});

const quiz: Quiz = {
  questions: [
    { prompt: "Q1", choices: ["a", "b", "c", "d"], answer: 0, evidence: "" },
    { prompt: "Q2", choices: ["e", "f", "g", "h"], answer: 2, evidence: "" },
    { prompt: "Q3", choices: ["i", "j", "k", "l"], answer: 3, evidence: "" },
  ],
};

describe("alternativas reembaralhadas", () => {
  it("a ordem e deterministica pela semente e nunca a original", () => {
    for (let index = 0; index < 50; index += 1) {
      const order = shuffledOrder(4, `semente-${index}`);
      expect([...order].sort()).toEqual([0, 1, 2, 3]);
      expect(order).not.toEqual([0, 1, 2, 3]);
      expect(shuffledOrder(4, `semente-${index}`)).toEqual(order);
    }
  });

  it("a correta acompanha a alternativa", () => {
    const questions = recallQuestions(quiz, recallSeed("texto", 7));
    questions.forEach((question, index) => {
      const original = quiz.questions[index]!;
      expect(question.choices[question.answer]).toBe(original.choices[original.answer]);
      expect([...question.choices].sort()).toEqual([...original.choices].sort());
    });
  });

  it("rodadas diferentes embaralham com sementes diferentes", () => {
    expect(recallSeed("texto", 7)).not.toBe(recallSeed("texto", 30));
  });

  it("corrige pela ordem nova", () => {
    const questions = recallQuestions(quiz, "s");
    const right = questions.map((question) => question.answer);
    expect(scoreRecall(questions, right)).toBe(100);
    expect(scoreRecall(questions, [right[0]!, -1, -1])).toBe(33);
    expect(scoreRecall([], [])).toBe(0);
  });
});
