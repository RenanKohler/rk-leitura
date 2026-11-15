import { describe, expect, it } from "vitest";
import {
  brakeExcerpt,
  chooseWindow,
  clampProfile,
  comprehensionBySpeed,
  isReread,
  MAX_EXAMPLES,
  MAX_PATTERNS,
  MAX_TITLE_WORDS,
  mergeBrakes,
  missingData,
  monthBounds,
  monthLabel,
  pickExamples,
  previousMonth,
  profileBase,
  profilePrompt,
  resolveExample,
  sentenceLengthAt,
  summarizeProfile,
  windowLabel,
  type ProfileInput,
  type ProfileSession,
} from "@/lib/reading-profile";

/**
 * Perfil de leitura do mes (US-234): periodo, agregados, exemplos levados ao
 * pedido, o que falta para gerar e a validacao da resposta.
 */

function session(partial: Partial<ProfileSession> = {}): ProfileSession {
  return {
    textId: "t1",
    wpm: 300,
    wordsRead: 1000,
    durationMs: 200_000,
    mode: "runner",
    comprehension: null,
    brakes: null,
    createdAt: new Date("2026-10-10T12:00:00Z"),
    ...partial,
  };
}

function input(partial: Partial<ProfileInput> = {}): ProfileInput {
  return {
    sessions: [],
    firstCompleted: {},
    texts: {},
    recalls: [],
    savedWords: [],
    reviews: [],
    lowQuizzes: [],
    ...partial,
  };
}

describe("periodo", () => {
  it("mes anterior, inclusive na virada do ano", () => {
    expect(previousMonth("2026-11-15")).toBe("2026-10");
    expect(previousMonth("2026-01-03")).toBe("2025-12");
  });

  it("limites do mes, com o fim exclusivo", () => {
    expect(monthBounds("2026-10")).toEqual({ from: "2026-10-01", to: "2026-11-01" });
    expect(monthBounds("2025-12")).toEqual({ from: "2025-12-01", to: "2026-01-01" });
  });

  it("mes anterior com dado bastante: o mes inteiro", () => {
    expect(chooseWindow("2026-11-15", 3)).toEqual({
      month: "2026-10",
      from: "2026-10-01",
      to: "2026-11-01",
      basis: "mes",
    });
  });

  it("mes anterior com pouco dado: ultimos 30 dias, chave continua o mes anterior", () => {
    expect(chooseWindow("2026-11-15", 2)).toEqual({
      month: "2026-10",
      from: "2026-10-17",
      to: "2026-11-16",
      basis: "30dias",
    });
  });

  it("rotulos", () => {
    expect(monthLabel("2026-03")).toBe("março de 2026");
    expect(windowLabel(chooseWindow("2026-11-15", 5))).toBe("Leituras de outubro de 2026");
    expect(windowLabel(chooseWindow("2026-11-15", 0))).toBe("Leituras dos últimos 30 dias");
  });
});

describe("trechos dos freios", () => {
  const words = "Uma frase curta. Outra frase, com vírgulas, apostos e orações, que vai longe demais até acabar.".split(" ");

  it("trecho em volta com a palavra marcada", () => {
    expect(brakeExcerpt(words, 3, 2)).toBe("... frase curta. [Outra] frase, com ...");
    expect(brakeExcerpt(words, 0, 2)).toBe("[Uma] frase curta. ...");
    expect(brakeExcerpt(words, 99)).toBe("");
  });

  it("tamanho da frase em volta da posicao", () => {
    expect(sentenceLengthAt(words, 1)).toBe(3);
    expect(sentenceLengthAt(words, 5)).toBe(words.length - 3);
    expect(sentenceLengthAt(words, -1)).toBe(0);
  });

  it("freios seguidos no mesmo lugar viram um trecho so", () => {
    expect(mergeBrakes([50, 3, 5, 5, 20, 52], 12)).toEqual([3, 20, 50]);
  });
});

describe("agregados", () => {
  it("releitura: sessao depois da primeira conclusao do texto", () => {
    const first = { t1: new Date("2026-10-05T00:00:00Z") };
    expect(isReread(session({ createdAt: new Date("2026-10-06T00:00:00Z") }), first)).toBe(true);
    expect(isReread(session({ createdAt: new Date("2026-10-05T00:00:00Z") }), first)).toBe(false);
    expect(isReread(session({ textId: "t2" }), first)).toBe(false);
  });

  it("compreensao por velocidade so com 4 medidas ou mais", () => {
    expect(comprehensionBySpeed([{ wpm: 200, comprehension: 80 }])).toBeNull();
    expect(
      comprehensionBySpeed([
        { wpm: 450, comprehension: 40 },
        { wpm: 200, comprehension: 100 },
        { wpm: 250, comprehension: 80 },
        { wpm: 500, comprehension: 60 },
      ])
    ).toEqual({ faster: { wpm: 475, average: 50 }, slower: { wpm: 225, average: 90 } });
  });

  it("resumo do periodo com numeros, exemplos e fatos", () => {
    const long = Array.from({ length: 40 }, (_, index) => `p${index}`);
    long[39] = "fim.";
    const summary = summarizeProfile(
      input({
        sessions: [
          session({ wpm: 400, wordsRead: 1000, comprehension: 60, brakes: [5, 6, 30] }),
          session({ wpm: 200, wordsRead: 1000, comprehension: 100, mode: "pagina" }),
          session({ textId: "t2", createdAt: new Date("2026-10-20T12:00:00Z") }),
        ],
        firstCompleted: { t2: new Date("2026-09-01T00:00:00Z") },
        texts: { t1: { title: "Ensaio", words: long } },
        recalls: [50, 70],
        savedWords: [
          { word: "exegese", context: "A exegese do texto" },
          { word: "Exegese", context: null },
          { word: "lacônico", context: null },
        ],
        reviews: [
          { kind: "palavra", grade: "errei", label: "lacônico" },
          { kind: "palavra", grade: "bom", label: "exegese" },
          { kind: "cartao", grade: "errei", label: "O que é entropia?" },
          { kind: "outro", grade: "errei", label: null },
        ],
        lowQuizzes: [{ title: "Ensaio", score: 60, prompts: ["Por que o autor conclui X?"] }],
      })
    );

    expect(summary.sessions).toBe(3);
    expect(summary.words).toBe(3000);
    expect(summary.wpm).toBe(300);
    expect(summary.byMode).toEqual([
      { mode: "pagina", wpm: 200, sessions: 1 },
      { mode: "runner", wpm: 350, sessions: 2 },
    ]);
    expect(summary.comprehension).toMatchObject({ measured: 2, average: 80, faster: null });
    expect(summary.recall).toEqual({ answered: 2, average: 60 });
    expect(summary.brakes).toEqual({ total: 3, perThousand: 3, inLongSentences: 100 });
    expect(summary.reviews.palavra).toEqual({ total: 2, wrong: 1 });
    expect(summary.reviews.cartao).toEqual({ total: 1, wrong: 1 });
    expect(summary.rereads).toBe(1);

    // Dois freios proximos viram um trecho; a palavra errada vem antes.
    const kinds = summary.examples.map((example) => example.kind);
    expect(kinds).toEqual(["freio", "freio", "cartao", "palavra", "palavra", "pergunta"]);
    expect(summary.examples[0]).toMatchObject({ id: "E1", source: "Ensaio" });
    expect(summary.examples[0]?.text).toContain("[p5]");
    expect(summary.examples[3]?.text).toContain("errada na revisão");
    expect(summary.examples[3]?.text).toContain("lacônico");
    expect(summary.examples[5]?.text).toContain("60% de acertos");

    expect(summary.facts[0]).toEqual({
      id: "F1",
      text: "3 sessões, 3000 palavras em 10 min, média de 300 ppm.",
    });
    expect(summary.facts.map((fact) => fact.text).join(" ")).toContain("3 por mil palavras");
  });

  it("taxa de freio nula quando nenhuma sessao mediu", () => {
    const summary = summarizeProfile(input({ sessions: [session()] }));
    expect(summary.brakes).toEqual({ total: 0, perThousand: null, inLongSentences: null });
    expect(summary.examples).toEqual([]);
  });
});

describe("exemplos", () => {
  it("cota por tipo e vaga que sobra passa aos outros, ate 15", () => {
    const many = (kind: "freio" | "cartao" | "palavra" | "pergunta", count: number) =>
      Array.from({ length: count }, (_, index) => ({ kind, text: `${kind} ${index}`, source: null }));
    const picked = pickExamples([...many("freio", 20), ...many("palavra", 2), ...many("pergunta", 5)]);
    expect(picked).toHaveLength(MAX_EXAMPLES);
    expect(picked.filter((item) => item.kind === "palavra")).toHaveLength(2);
    expect(picked.filter((item) => item.kind === "pergunta")).toHaveLength(2);
    expect(picked.filter((item) => item.kind === "freio")).toHaveLength(11);
    expect(picked.map((item) => item.id).slice(0, 2)).toEqual(["E1", "E2"]);
  });
});

describe("o que falta", () => {
  it("pouco dado: diz quantas sessoes e o questionario", () => {
    expect(missingData({ sessions: 1, comprehension: { measured: 0 } as never, recall: { answered: 0, average: null } })).toEqual([
      "Faltam 2 sessões de leitura no período (mínimo de 3).",
      "Responda pelo menos um questionário de compreensão ao fim de uma leitura.",
    ]);
    expect(missingData({ sessions: 2, comprehension: { measured: 1 } as never, recall: { answered: 0, average: null } })).toEqual([
      "Falta 1 sessão de leitura no período (mínimo de 3).",
    ]);
  });

  it("recordar conta como questionario", () => {
    expect(missingData({ sessions: 3, comprehension: { measured: 0 } as never, recall: { answered: 1, average: 80 } })).toEqual([]);
  });

  it("linha de base", () => {
    expect(profileBase({ sessions: 1, comprehension: { measured: 1 } as never, recall: { answered: 0, average: null } })).toBe(
      "1 sessão, 1 questionário"
    );
  });
});

describe("pedido e resposta", () => {
  const summary = summarizeProfile(
    input({
      sessions: [session({ brakes: [2] }), session(), session({ comprehension: 50 })],
      texts: { t1: { title: 'Um "texto"', words: "a b c d e".split(" ") } },
    })
  );

  it("pedido leva so fatos e exemplos numerados", () => {
    const prompt = profilePrompt(summary, chooseWindow("2026-11-15", 3));
    expect(prompt).toContain("<periodo>Leituras de outubro de 2026</periodo>");
    expect(prompt).toContain("F1: 3 sessões");
    expect(prompt).toContain(`E1 [freio] (de "Um 'texto'"): a b [c] d e`);
  });

  it("exemplo resolvido pelo id, nunca pelo texto do modelo", () => {
    expect(resolveExample(" e1 ", summary)).toEqual({ text: "a b [c] d e", source: 'Um "texto"' });
    expect(resolveExample("F1", summary)?.text).toContain("3 sessões");
    expect(resolveExample("E9", summary)).toBeNull();
    expect(resolveExample(3, summary)).toBeNull();
  });

  it("valida a resposta: exemplo inexistente sai, acao desconhecida vira nenhuma", () => {
    const patterns = clampProfile(
      {
        patterns: [
          { title: "Você freia em frases longas", detail: "d", example: "E1", suggestion: "Baixe o ppm", action: "velocidade" },
          { title: "Inventado", detail: "", example: "E7", suggestion: "x", action: "treino" },
          { title: "Compreensão cai", detail: "", example: "F2", suggestion: "Faça o treino", action: "voar" },
          { title: "", detail: "", example: "E1", suggestion: "x", action: "treino" },
        ],
      },
      summary
    );
    expect(patterns).toHaveLength(2);
    expect(patterns?.[0]).toMatchObject({ action: "velocidade", example: { text: "a b [c] d e" } });
    expect(patterns?.[1]?.action).toBe("nenhuma");
  });

  it("corta titulo longo e limita a 4 padroes", () => {
    const item = {
      title: Array.from({ length: 30 }, () => "palavra").join(" "),
      detail: "",
      example: "F1",
      suggestion: "Revise as palavras.",
      action: "palavras",
    };
    const patterns = clampProfile({ patterns: Array.from({ length: 6 }, () => item) }, summary);
    expect(patterns).toHaveLength(MAX_PATTERNS);
    expect(patterns?.[0]?.title.split(" ")).toHaveLength(MAX_TITLE_WORDS);
    expect(patterns?.[0]?.title.endsWith("…")).toBe(true);
  });

  it("nada valido: null", () => {
    expect(clampProfile({ patterns: [] }, summary)).toBeNull();
    expect(clampProfile(null, summary)).toBeNull();
    expect(clampProfile({ patterns: [{ title: "x", example: "E99", suggestion: "y" }] }, summary)).toBeNull();
  });
});
