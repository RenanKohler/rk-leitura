import { describe, expect, it } from "vitest";
import {
  appendNote,
  askExcerpt,
  askMessages,
  MAX_QUESTION_CHARS,
  NO_ANSWER,
  normalizeHistory,
  normalizeQuestion,
  noteTarget,
  readAnswer,
} from "@/lib/ask";
import { MAX_READ_CHARS } from "@/lib/ai-text";
import { MAX_NOTE_CHARS } from "@/lib/highlights";
import { parseParagraphs } from "@/lib/reading";

const { words, paragraphs } = parseParagraphs(
  "A baleia mergulhou fundo.\n\nO capitao ficou calado no convés.\n\nDepois veio a tempestade final."
);

describe("askExcerpt", () => {
  it("termina na palavra N, inclusive, sem nenhuma depois", () => {
    const n = words.indexOf("calado");
    const excerpt = askExcerpt(paragraphs, n);
    expect(excerpt.text).toBe("A baleia mergulhou fundo.\n\nO capitao ficou calado");
    expect(excerpt.endWord).toBe(n + 1);
    expect(excerpt.text).not.toContain("convés");
    expect(excerpt.text).not.toContain("tempestade");
  });

  it("o documento do pedido e o mesmo recorte", () => {
    const n = words.indexOf("ficou");
    const excerpt = askExcerpt(paragraphs, n);
    const [first] = askMessages(excerpt, "Moby", [], "Quem ficou?");
    const content = first!.content as { type: string; source?: { data: string } }[];
    expect(content[0]!.type).toBe("document");
    expect(content[0]!.source!.data).toBe(excerpt.text);
    expect(content[0]!.source!.data.endsWith("ficou")).toBe(true);
  });

  it("com mais de 200 mil caracteres lidos, guarda os mais recentes e avisa", () => {
    const paragraph = Array.from({ length: 2_000 }, (_, i) => `palavra${i}`).join(" ");
    const big = parseParagraphs(Array.from({ length: 20 }, () => paragraph).join("\n\n"));
    const position = big.words.length - 10;
    const excerpt = askExcerpt(big.paragraphs, position);
    expect(excerpt.truncated).toBe(true);
    expect(excerpt.text.length).toBeLessThanOrEqual(MAX_READ_CHARS);
    expect(excerpt.endWord).toBe(position + 1);
    expect(excerpt.text.endsWith(big.words[position]!)).toBe(true);
  });

  it("trecho curto nao e marcado como recortado", () => {
    expect(askExcerpt(paragraphs, 3).truncated).toBe(false);
  });
});

describe("askMessages", () => {
  it("monta a conversa com o documento em cache so na primeira mensagem", () => {
    const excerpt = askExcerpt(paragraphs, 5);
    const messages = askMessages(
      excerpt,
      "Moby",
      [{ question: "Primeira?", answer: "Resposta um." }],
      "Segunda?"
    );
    expect(messages.map((message) => message.role)).toEqual(["user", "assistant", "user"]);
    const first = messages[0]!.content as { type: string; cache_control?: unknown; citations?: unknown }[];
    expect(first[0]).toMatchObject({ cache_control: { type: "ephemeral" }, citations: { enabled: true } });
    expect(first[1]).toEqual({ type: "text", text: "Primeira?" });
    expect(messages[1]!.content).toBe("Resposta um.");
    expect(messages[2]!.content).toBe("Segunda?");
  });
});

describe("normalizeQuestion e normalizeHistory", () => {
  it("aceita ate 500 caracteres", () => {
    expect(normalizeQuestion("  Por que   ele saiu? ")).toBe("Por que ele saiu?");
    expect(normalizeQuestion("a".repeat(MAX_QUESTION_CHARS))).not.toBeNull();
    expect(normalizeQuestion("a".repeat(MAX_QUESTION_CHARS + 1))).toBeNull();
    expect(normalizeQuestion("   ")).toBeNull();
    expect(normalizeQuestion(3)).toBeNull();
  });

  it("recusa historico malformado", () => {
    expect(normalizeHistory(undefined)).toEqual([]);
    expect(normalizeHistory([{ question: "Q?", answer: "R." }])).toEqual([
      { question: "Q?", answer: "R." },
    ]);
    expect(normalizeHistory([{ question: "Q?" }])).toBeNull();
    expect(normalizeHistory("x")).toBeNull();
  });
});

describe("readAnswer", () => {
  const excerpt = askExcerpt(paragraphs, words.length - 1);

  it("converte a citacao de caracteres em intervalo de palavras", () => {
    const cited = "O capitao ficou calado no convés.";
    const from = excerpt.text.indexOf(cited);
    const answer = readAnswer(
      [
        { type: "text", text: "O capitão ", citations: null },
        {
          type: "text",
          text: "ficou calado.",
          citations: [
            {
              type: "char_location",
              cited_text: cited,
              start_char_index: from,
              end_char_index: from + cited.length,
            },
          ],
        },
      ],
      excerpt
    );
    expect(answer.text).toBe("O capitão ficou calado.");
    expect(answer.citations).toHaveLength(1);
    const [citation] = answer.citations;
    expect(words.slice(citation!.start, citation!.end).join(" ")).toBe(cited);
    expect(citation!.quote).toBe(cited);
  });

  it("sem citacao, a resposta vira a frase fixa", () => {
    const answer = readAnswer([{ type: "text", text: "Acho que sim.", citations: null }], excerpt);
    expect(answer).toEqual({ text: NO_ANSWER, citations: [] });
  });

  it("ignora blocos que nao sao texto e citacoes repetidas", () => {
    const citation = { type: "char_location", cited_text: "A baleia", start_char_index: 0, end_char_index: 8 };
    const answer = readAnswer(
      [
        { type: "thinking" },
        { type: "text", text: "Uma baleia.", citations: [citation, citation] },
      ],
      excerpt
    );
    expect(answer.citations).toEqual([{ start: 0, end: 2, quote: "A baleia" }]);
  });
});

describe("guardar como nota", () => {
  it("acrescenta a resposta depois de uma linha em branco", () => {
    expect(appendNote(null, "Resposta.")).toBe("Resposta.");
    expect(appendNote("Minha nota.", "Resposta.")).toBe("Minha nota.\n\nResposta.");
  });

  it("corta no limite e termina em reticencias", () => {
    const note = appendNote("a".repeat(1_500), "b".repeat(1_000));
    expect(note.length).toBe(MAX_NOTE_CHARS);
    expect(note.endsWith("…")).toBe(true);
    expect(note.startsWith(`${"a".repeat(1_500)}\n\n`)).toBe(true);
  });

  it("encontra o destaque que ja cobre o trecho citado", () => {
    const marks = [
      { id: "a", start: 0, end: 4, note: null },
      { id: "b", start: 10, end: 14, note: "x" },
    ];
    expect(noteTarget(marks, { start: 11, end: 13 })?.id).toBe("b");
    expect(noteTarget(marks, { start: 4, end: 6 })?.id).toBe("a");
    expect(noteTarget(marks, { start: 6, end: 8 })).toBeNull();
  });
});
