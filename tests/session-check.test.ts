import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MIN_SESSION_CHECK_WORDS,
  MIN_SESSION_RANGE_WORDS,
  SESSION_CHECK_QUESTIONS,
  sessionCheckRange,
  sessionExcerpt,
  sessionQuizKey,
  validSessionRange,
} from "@/lib/session-check";
import { MIN_QUESTIONS, parseQuiz } from "@/lib/quiz";

// O pedido ao modelo e capturado aqui, sem rede: e ele que o teste confere.
const sent: { content: string; wordsSent?: number; textId?: string | null }[] = [];
vi.mock("@/lib/ai", () => ({
  AiUnavailable: class extends Error {},
  countWords: (text: string) => text.trim().split(/\s+/).filter(Boolean).length,
  aiParse: vi.fn(
    async (options: {
      content: { content: string }[];
      wordsSent?: number;
      textId?: string | null;
    }) => {
      sent.push({
        content: options.content[0]!.content,
        wordsSent: options.wordsSent,
        textId: options.textId,
      });
      const question = (n: number) => ({
        prompt: `Pergunta ${n}`,
        choices: ["a", "b", "c", "d"],
        answer: 0,
        evidence: "",
        rationale: "Porque sim.",
      });
      return { questions: [question(1), question(2)] };
    }
  ),
}));

// Palavras numeradas: cada uma diz a propria posicao no texto.
const words = Array.from({ length: 3000 }, (_, index) => `p${index}`);

describe("sessionCheckRange", () => {
  const base = { mode: "runner" as const, words: 900, from: 100, position: 1000, total: 3000 };

  it("oferece o trecho entre o inicio da sessao e a posicao atual", () => {
    expect(sessionCheckRange(base)).toEqual({ from: 100, to: 1000 });
  });

  it("some abaixo de 800 palavras lidas na sessao", () => {
    expect(sessionCheckRange({ ...base, words: MIN_SESSION_CHECK_WORDS - 1 })).toBeNull();
    expect(sessionCheckRange({ ...base, words: MIN_SESSION_CHECK_WORDS })).not.toBeNull();
  });

  it("so vale para o Word Runner, com sessao aberta e posicao depois do inicio", () => {
    expect(sessionCheckRange({ ...base, mode: "narracao" })).toBeNull();
    expect(sessionCheckRange({ ...base, mode: "pagina" })).toBeNull();
    expect(sessionCheckRange({ ...base, mode: null })).toBeNull();
    expect(sessionCheckRange({ ...base, from: null })).toBeNull();
    expect(sessionCheckRange({ ...base, position: 100 })).toBeNull();
  });

  it("nao passa do fim do texto", () => {
    expect(sessionCheckRange({ ...base, position: 5000 })).toEqual({ from: 100, to: 3000 });
  });
});

describe("sessionExcerpt", () => {
  it("contem so as palavras do trecho, sem nenhuma depois da posicao", () => {
    const excerpt = sessionExcerpt(words, { from: 100, to: 1000 }).split(" ");
    expect(excerpt[0]).toBe("p100");
    expect(excerpt.at(-1)).toBe("p999");
    expect(excerpt).toHaveLength(900);
    // A palavra da posicao atual ainda nao foi lida: fica de fora.
    expect(excerpt).not.toContain("p1000");
    expect(excerpt.every((word) => Number(word.slice(1)) < 1000)).toBe(true);
    expect(excerpt.every((word) => Number(word.slice(1)) >= 100)).toBe(true);
  });

  it("corta no fim do texto", () => {
    expect(sessionExcerpt(words, { from: 2990, to: 9999 }).split(" ")).toHaveLength(10);
  });
});

describe("validSessionRange", () => {
  it("aceita um trecho inteiro dentro do texto", () => {
    expect(validSessionRange({ from: 0, to: 900 }, 3000)).toBe(true);
  });

  it("recusa trecho curto, invertido, fora do texto ou malformado", () => {
    expect(validSessionRange({ from: 0, to: MIN_SESSION_RANGE_WORDS - 1 }, 3000)).toBe(false);
    expect(validSessionRange({ from: 900, to: 100 }, 3000)).toBe(false);
    expect(validSessionRange({ from: 0, to: 3001 }, 3000)).toBe(false);
    expect(validSessionRange({ from: -1, to: 900 }, 3000)).toBe(false);
    expect(validSessionRange({ from: "0", to: 900 }, 3000)).toBe(false);
    expect(validSessionRange({ from: 0.5, to: 900 }, 3000)).toBe(false);
    expect(validSessionRange(null, 3000)).toBe(false);
  });
});

describe("sessionQuizKey", () => {
  it("separa o trecho da sessao do questionario do texto", () => {
    expect(sessionQuizKey("123-abc", { from: 10, to: 900 })).toBe("123-abc:sessao:10-900");
    expect(sessionQuizKey("123-abc", { from: 10, to: 900 })).not.toBe(
      sessionQuizKey("123-abc", { from: 10, to: 901 })
    );
  });
});

describe("parseQuiz com outro minimo", () => {
  const question = { prompt: "P", choices: ["a", "b", "c", "d"], answer: 1, evidence: "" };

  it("duas perguntas valem na checagem e nao no questionario do texto", () => {
    const raw = { questions: [question, { ...question, prompt: "Q" }] };
    expect(parseQuiz(raw)).toBeNull();
    expect(MIN_QUESTIONS).toBe(3);
    expect(
      parseQuiz(raw, SESSION_CHECK_QUESTIONS, SESSION_CHECK_QUESTIONS)?.questions
    ).toHaveLength(2);
  });

  it("corta no maximo pedido", () => {
    const raw = { questions: [question, { ...question, prompt: "Q" }, { ...question, prompt: "R" }] };
    expect(parseQuiz(raw, 2, 2)?.questions).toHaveLength(2);
  });
});

describe("generateSessionQuiz", () => {
  beforeEach(() => {
    sent.length = 0;
  });

  it("envia ao modelo so o trecho da sessao, nenhuma palavra depois da posicao", async () => {
    const { generateSessionQuiz } = await import("@/lib/quiz-generator");
    const range = { from: 400, to: 1300 };
    const quiz = await generateSessionQuiz(
      "usuario",
      "Titulo",
      sessionExcerpt(words, range),
      "pt-BR",
      "texto-1"
    );
    expect(quiz.questions).toHaveLength(2);

    expect(sent).toHaveLength(1);
    const numbers = [...sent[0]!.content.matchAll(/\bp(\d+)\b/g)].map((match) => Number(match[1]));
    expect(numbers.length).toBe(900);
    expect(Math.max(...numbers)).toBe(1299);
    expect(Math.min(...numbers)).toBe(400);
    expect(sent[0]!.textId).toBe("texto-1");
    expect(sent[0]!.wordsSent).toBeGreaterThanOrEqual(900);
  });
});
