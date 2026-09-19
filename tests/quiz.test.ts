import { describe, expect, it } from "vitest";
import {
  CHOICES_PER_QUESTION,
  contentKey,
  MIN_QUESTIONS,
  parseQuiz,
  scoreQuiz,
  type Quiz,
} from "@/lib/quiz";

const pergunta = (answer = 0) => ({
  prompt: "O que acontece no primeiro paragrafo?",
  choices: ["Uma", "Duas", "Tres", "Quatro"],
  answer,
  evidence: "Ela chegou a cabana no fim da tarde.",
});

const bruto = (n: number, extra: Record<string, unknown> = {}) => ({
  questions: Array.from({ length: n }, (_, i) => ({ ...pergunta(i % 4), ...extra })),
});

describe("parseQuiz", () => {
  it("aceita um questionario bem formado", () => {
    const quiz = parseQuiz(bruto(4));
    expect(quiz?.questions).toHaveLength(4);
    expect(quiz?.questions[0]!.choices).toHaveLength(CHOICES_PER_QUESTION);
  });

  it("aceita tambem quando vem como texto JSON", () => {
    expect(parseQuiz(JSON.stringify(bruto(3)))?.questions).toHaveLength(3);
  });

  it("recusa menos perguntas que o minimo", () => {
    expect(parseQuiz(bruto(MIN_QUESTIONS - 1))).toBeNull();
  });

  it("corta o excedente em vez de recusar", () => {
    expect(parseQuiz(bruto(9))?.questions.length).toBeLessThanOrEqual(5);
  });

  it("descarta pergunta com indice fora das alternativas", () => {
    // Pior que nenhuma pergunta: pareceria valida e marcaria o certo como errado.
    const misto = { questions: [pergunta(0), pergunta(0), pergunta(0), { ...pergunta(), answer: 9 }] };
    const quiz = parseQuiz(misto);
    expect(quiz?.questions).toHaveLength(3);
  });

  it("descarta pergunta com numero errado de alternativas", () => {
    const misto = {
      questions: [pergunta(), pergunta(1), pergunta(2), { ...pergunta(), choices: ["a", "b"] }],
    };
    expect(parseQuiz(misto)?.questions).toHaveLength(3);
  });

  it("descarta pergunta com alternativas repetidas", () => {
    const misto = {
      questions: [
        pergunta(),
        pergunta(1),
        pergunta(2),
        { ...pergunta(), choices: ["Uma", "Uma", "Tres", "Quatro"] },
      ],
    };
    expect(parseQuiz(misto)?.questions).toHaveLength(3);
  });

  it("recusa lixo em vez de repassar a tela", () => {
    for (const entrada of [null, undefined, "", "nao e json", 42, {}, { questions: "x" }]) {
      expect(parseQuiz(entrada)).toBeNull();
    }
  });
});

describe("contentKey", () => {
  it("muda quando o conteudo muda", () => {
    // E o que faz a continuacao gerar perguntas novas em vez de reusar as da
    // primeira parte do conto.
    const parte1 = "Ela chegou a cabana no fim da tarde.";
    expect(contentKey(parte1)).not.toBe(contentKey(`${parte1}\n\nNo dia seguinte, choveu.`));
  });

  it("e estavel para o mesmo conteudo", () => {
    const texto = "um dois tres quatro cinco";
    expect(contentKey(texto)).toBe(contentKey(texto));
  });

  it("separa textos de mesmo tamanho", () => {
    expect(contentKey("abcde")).not.toBe(contentKey("edcba"));
  });
});

describe("scoreQuiz", () => {
  const quiz: Quiz = parseQuiz(bruto(4))!;

  it("conta acertos em porcentagem", () => {
    const corretas = quiz.questions.map((q) => q.answer);
    expect(scoreQuiz(quiz, corretas)).toBe(100);
    expect(scoreQuiz(quiz, [])).toBe(0);
  });

  it("resposta parcial vale a fracao", () => {
    const metade = quiz.questions.map((q, i) => (i < 2 ? q.answer : -1));
    expect(scoreQuiz(quiz, metade)).toBe(50);
  });

  it("resposta a mais nao inventa acerto", () => {
    expect(scoreQuiz(quiz, [0, 0, 0, 0, 0, 0, 0])).toBeLessThanOrEqual(100);
  });
});
