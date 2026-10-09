import { describe, expect, it } from "vitest";
import {
  clampWords,
  locateEvidence,
  MAX_RATIONALE_WORDS,
  parseQuiz,
  QUIZ_MAX_CHARS,
  quizKey,
  quizSample,
  withEvidencePositions,
} from "@/lib/quiz";
import { parseParagraphs } from "@/lib/reading";

/** Texto longo com paragrafos numerados, para saber de onde veio cada trecho. */
function longText(paragraphs: number): string {
  return Array.from(
    { length: paragraphs },
    (_, index) =>
      `Paragrafo ${index} comeca aqui e segue com frases sobre o assunto que ocupam espaco suficiente para encher a pagina inteira.`
  ).join("\n");
}

const pergunta = (extra: Record<string, unknown> = {}) => ({
  prompt: "O que acontece?",
  choices: ["Uma", "Duas", "Tres", "Quatro"],
  answer: 1,
  evidence: "Ela chegou a cabana no fim da tarde.",
  ...extra,
});

describe("quizSample (US-133)", () => {
  it("envia o texto inteiro ate o teto", () => {
    const content = longText(10);
    expect(quizSample(content)).toEqual({ text: content, blocks: [] });
    const exact = "a ".repeat(QUIZ_MAX_CHARS / 2);
    expect(quizSample(exact).text).toBe(exact);
  });

  it("cobre o primeiro decimo, a segunda metade e o ultimo decimo", () => {
    for (const size of [501, 4000]) {
      const content = longText(size);
      const { blocks } = quizSample(content);
      const length = content.length;
      expect(blocks.length).toBeGreaterThan(2);
      expect(blocks.some((block) => block.start < length / 10)).toBe(true);
      expect(blocks.some((block) => block.start >= length / 2)).toBe(true);
      expect(blocks.some((block) => block.end > length * 0.9)).toBe(true);
    }
  });

  it("nunca passa do teto, marcadores incluidos", () => {
    for (const size of [501, 800, 4000, 20000]) {
      const { text } = quizSample(longText(size));
      expect(text.length).toBeLessThanOrEqual(QUIZ_MAX_CHARS);
    }
    // Texto corrido, sem paragrafo algum.
    const flat = "palavra ".repeat(50_000);
    expect(quizSample(flat).text.length).toBeLessThanOrEqual(QUIZ_MAX_CHARS);
  });

  it("comeca cada trecho num inicio de paragrafo e marca a posicao relativa", () => {
    const content = longText(4000);
    const { text, blocks } = quizSample(content);
    for (const block of blocks) {
      expect(block.start === 0 || content[block.start - 1] === "\n").toBe(true);
    }
    expect(text.startsWith("[Trecho 1 de 6]\nParagrafo 0 ")).toBe(true);
    expect(text).toContain("[Trecho 3 de 6]\nParagrafo ");
    expect(text).toContain("[Trecho 6 de 6]");
  });

  it("os trechos vao em ordem e nao se sobrepoem", () => {
    const { blocks } = quizSample(longText(2000));
    for (let index = 1; index < blocks.length; index += 1) {
      expect(blocks[index]!.start).toBeGreaterThanOrEqual(blocks[index - 1]!.end);
    }
  });

  it("nao muda a chave do questionario", () => {
    const content = longText(4000);
    // A chave continua sendo do conteudo inteiro: os questionarios gravados valem.
    expect(quizKey(content, "pt-BR")).not.toBe(quizKey(quizSample(content).text, "pt-BR"));
    // Valores da chave de antes desta entrega: nenhum questionario gravado se perde.
    expect(quizKey("Texto de exemplo.", "pt-BR")).toBe("17-1oa5z54");
    expect(quizKey("Texto de exemplo.", "en")).toBe("17-1oa5z54:en");
  });
});

describe("locateEvidence (US-134)", () => {
  const { words } = parseParagraphs(
    "Era uma vez.\nA menina, cansada, chegou à cabana no fim da tarde — e dormiu.\nFim."
  );

  it("acha a evidencia ignorando acento, caixa e pontuacao", () => {
    const span = locateEvidence(words, "“Chegou a cabana no fim da tarde”");
    expect(span).not.toBeNull();
    expect(words.slice(span!.start, span!.end).join(" ")).toBe("chegou à cabana no fim da tarde");
  });

  it("ignora palavras so de pontuacao no meio", () => {
    const span = locateEvidence(words, "no fim da tarde e dormiu");
    expect(words.slice(span!.start, span!.end).join(" ")).toBe("no fim da tarde — e dormiu.");
  });

  it("aceita reticencias entre pedacos", () => {
    const span = locateEvidence(words, "A menina ... no fim da tarde");
    expect(words[span!.start]).toBe("A");
    expect(words[span!.end - 1]).toBe("tarde");
  });

  it("devolve null quando a evidencia nao esta no texto", () => {
    expect(locateEvidence(words, "o lobo comeu a avo")).toBeNull();
    expect(locateEvidence(words, "...")).toBeNull();
  });

  it("procura no idioma original do texto", () => {
    const english = parseParagraphs("The girl reached the cabin at dusk. She slept.").words;
    const span = locateEvidence(english, "reached the Cabin at dusk");
    expect(span).toEqual({ start: 2, end: 7 });
  });

  it("conta palavras como o leitor, inclusive em Markdown", () => {
    const { words: md } = parseParagraphs("# Titulo\n\nUm **texto** com *enfase* aqui.", "markdown");
    const span = locateEvidence(md, "texto com enfase");
    expect(md.slice(span!.start, span!.end).join(" ")).toBe("texto com enfase");
  });
});

describe("withEvidencePositions", () => {
  const { words } = parseParagraphs("Ela chegou a cabana no fim da tarde. Depois dormiu.");

  it("calcula a posicao dos questionarios antigos", () => {
    const quiz = parseQuiz({ questions: [pergunta(), pergunta(), pergunta()] })!;
    const located = withEvidencePositions(quiz, words);
    expect(located.questions[0]!.position).toEqual({ start: 0, end: 8 });
  });

  it("mantem a posicao gravada quando confere e recalcula quando nao", () => {
    const quiz = parseQuiz({
      questions: [
        pergunta({ position: { start: 0, end: 8 } }),
        pergunta({ position: { start: 3, end: 5 } }),
        pergunta({ evidence: "nada disso existe" }),
      ],
    })!;
    const located = withEvidencePositions(quiz, words);
    expect(located.questions[0]!.position).toEqual({ start: 0, end: 8 });
    expect(located.questions[1]!.position).toEqual({ start: 0, end: 8 });
    expect("position" in located.questions[2]!).toBe(false);
  });
});

describe("rationale (US-135)", () => {
  it("questionario antigo continua valendo, sem campo vazio", () => {
    const quiz = parseQuiz({ questions: [pergunta(), pergunta(), pergunta()] })!;
    expect(quiz.questions).toHaveLength(3);
    expect("rationale" in quiz.questions[0]!).toBe(false);
    expect("position" in quiz.questions[0]!).toBe(false);
  });

  it("le a justificativa e a posicao gravadas", () => {
    const quiz = parseQuiz(
      JSON.stringify({
        questions: [1, 2, 3].map(() =>
          pergunta({ rationale: "  Porque o texto diz.  ", position: { start: 2, end: 6 } })
        ),
      })
    )!;
    expect(quiz.questions[0]!.rationale).toBe("Porque o texto diz.");
    expect(quiz.questions[0]!.position).toEqual({ start: 2, end: 6 });
  });

  it("descarta posicao invalida e justificativa vazia", () => {
    const quiz = parseQuiz({
      questions: [1, 2, 3].map(() => pergunta({ rationale: " ", position: { start: 5, end: 2 } })),
    })!;
    expect(quiz.questions[0]!.rationale).toBeUndefined();
    expect(quiz.questions[0]!.position).toBeUndefined();
  });

  it("corta a justificativa em 40 palavras", () => {
    const long = Array.from({ length: 60 }, (_, index) => `p${index}`).join(" ");
    const quiz = parseQuiz({ questions: [1, 2, 3].map(() => pergunta({ rationale: long })) })!;
    expect(quiz.questions[0]!.rationale!.split(" ")).toHaveLength(MAX_RATIONALE_WORDS);
    expect(quiz.questions[0]!.rationale!.endsWith("…")).toBe(true);
    expect(clampWords("curta demais.", 40)).toBe("curta demais.");
  });
});
