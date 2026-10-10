import { describe, expect, it } from "vitest";
import {
  dueRecallRound,
  nextRecallDueOn,
  recallDueOn,
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
