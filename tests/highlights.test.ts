import { describe, expect, it } from "vitest";
import {
  absorb,
  asNote,
  excerptOf,
  exportFileName,
  MAX_HIGHLIGHT_WORDS,
  markCovering,
  MAX_NOTE_CHARS,
  normalizeRange,
  segmentsOf,
  sentenceRange,
  toMarkdown,
  wordIndexAtEnd,
  wordIndexAtStart,
} from "@/lib/highlights";
import { parseParagraphs } from "@/lib/reading";

describe("normalizeRange", () => {
  it("aceita a selecao feita de tras para frente", () => {
    expect(normalizeRange(9, 4, 100)).toEqual({ start: 4, end: 9 });
  });

  it("recorta ao tamanho do texto", () => {
    expect(normalizeRange(-5, 500, 20)).toEqual({ start: 0, end: 20 });
  });

  it("recusa intervalo vazio", () => {
    expect(normalizeRange(7, 7, 100)).toBeNull();
    expect(normalizeRange("a", 3, 100)).toBeNull();
  });

  it("limita o destaque para que nao vire o texto inteiro", () => {
    const range = normalizeRange(0, 5_000, 5_000);
    expect(range).toEqual({ start: 0, end: MAX_HIGHLIGHT_WORDS });
  });
});

describe("cortes da selecao", () => {
  const text = "um dois tres";

  it("comeca na palavra tocada, mesmo com o corte no meio dela", () => {
    expect(wordIndexAtStart(text, 0)).toBe(0);
    expect(wordIndexAtStart(text, 1)).toBe(0);
    expect(wordIndexAtStart(text, 3)).toBe(1);
    expect(wordIndexAtStart(text, 4)).toBe(1);
    expect(wordIndexAtStart(text, 9)).toBe(2);
  });

  it("termina depois da ultima palavra tocada", () => {
    expect(wordIndexAtEnd(text, 2)).toBe(1);
    expect(wordIndexAtEnd(text, 3)).toBe(1);
    expect(wordIndexAtEnd(text, 4)).toBe(2);
    expect(wordIndexAtEnd(text, text.length)).toBe(3);
  });

  it("uma palavra selecionada pela metade vira a palavra inteira", () => {
    // "do|is" -> [1, 2)
    expect(wordIndexAtStart(text, 5)).toBe(1);
    expect(wordIndexAtEnd(text, 6)).toBe(2);
  });

  it("nao estoura os limites do texto", () => {
    expect(wordIndexAtStart(text, -10)).toBe(0);
    expect(wordIndexAtEnd(text, 9_999)).toBe(3);
  });
});

describe("sentenceRange", () => {
  const { words } = parseParagraphs(
    "Marina subiu a serra. A cabana estava fria, e ela acendeu o fogo! Depois dormiu."
  );

  it("pega a frase inteira a partir de uma palavra no meio dela", () => {
    const range = sentenceRange(words, 6)!;
    expect(excerptOf(words, range.start, range.end)).toBe(
      "A cabana estava fria, e ela acendeu o fogo!"
    );
  });

  it("pega a primeira frase quando a palavra e a primeira", () => {
    const range = sentenceRange(words, 0)!;
    expect(excerptOf(words, range.start, range.end)).toBe("Marina subiu a serra.");
  });

  it("pega a ultima frase mesmo no fim do texto", () => {
    const range = sentenceRange(words, words.length - 1)!;
    expect(excerptOf(words, range.start, range.end)).toBe("Depois dormiu.");
  });

  it("fecha a frase depois das aspas", () => {
    const { words: quoted } = parseParagraphs('Ele disse "vamos embora." Ela ficou.');
    const range = sentenceRange(quoted, 1)!;
    expect(excerptOf(quoted, range.start, range.end)).toBe('Ele disse "vamos embora."');
  });

  it("limita um paragrafo sem pontuacao terminal", () => {
    const endless = Array.from({ length: 2_000 }, () => "palavra");
    const range = sentenceRange(endless, 1_000)!;
    expect(range.end - range.start).toBe(MAX_HIGHLIGHT_WORDS);
  });

  it("devolve nulo sem palavras", () => {
    expect(sentenceRange([], 0)).toBeNull();
  });
});

describe("absorb", () => {
  const existing = [
    { id: "a", start: 10, end: 20, note: null },
    { id: "b", start: 40, end: 50, note: "nota de b" },
  ];

  it("nao funde o que nao encosta", () => {
    expect(absorb(existing, { start: 25, end: 30 })).toEqual({
      range: { start: 25, end: 30 },
      absorbed: [],
      note: null,
    });
  });

  it("funde o que sobrepoe e devolve o intervalo maior", () => {
    const result = absorb(existing, { start: 15, end: 45 });
    expect(result.range).toEqual({ start: 10, end: 50 });
    expect(result.absorbed).toEqual(["a", "b"]);
  });

  it("funde o que apenas encosta", () => {
    const result = absorb(existing, { start: 20, end: 25 });
    expect(result.range).toEqual({ start: 10, end: 25 });
    expect(result.absorbed).toEqual(["a"]);
  });

  it("preserva as notas dos absorvidos", () => {
    const comNota = [
      { id: "a", start: 10, end: 20, note: "primeira" },
      { id: "b", start: 20, end: 30, note: "segunda" },
    ];
    expect(absorb(comNota, { start: 12, end: 28 }).note).toBe("primeira\n\nsegunda");
  });
});

describe("asNote", () => {
  it("nota vazia vira ausencia de nota", () => {
    expect(asNote("   ")).toBeNull();
    expect(asNote("")).toBeNull();
    expect(asNote(42)).toBeNull();
  });

  it("corta no limite", () => {
    expect(asNote("x".repeat(MAX_NOTE_CHARS + 500))!.length).toBe(MAX_NOTE_CHARS);
  });
});

describe("toMarkdown", () => {
  it("traz titulo, origem, citacao e nota", () => {
    const out = toMarkdown(
      { title: "A cabana", sourceUrl: "https://exemplo.com/conto" },
      [
        { start: 40, excerpt: "segundo trecho", note: null },
        { start: 10, excerpt: "primeiro trecho", note: "o que eu pensei" },
      ]
    );

    expect(out).toContain("# A cabana");
    expect(out).toContain("Origem: <https://exemplo.com/conto>");
    // Ordem do texto, nao a ordem em que foram passados.
    expect(out.indexOf("primeiro trecho")).toBeLessThan(out.indexOf("segundo trecho"));
    expect(out).toContain("> primeiro trecho");
    expect(out).toContain("o que eu pensei");
  });

  it("omite a origem de um texto colado", () => {
    const out = toMarkdown({ title: "Colado", sourceUrl: null }, []);
    expect(out).not.toContain("Origem:");
    expect(out).toContain("_Nenhum destaque._");
  });

  it("cita todas as linhas de um trecho com quebra", () => {
    const out = toMarkdown({ title: "T", sourceUrl: null }, [
      { start: 0, excerpt: "linha um\nlinha dois", note: null },
    ]);
    expect(out).toContain("> linha um\n> linha dois");
  });
});

describe("exportFileName", () => {
  it("tira acento, pontuacao e espaco", () => {
    expect(exportFileName("A cabana no inverno!")).toBe("a-cabana-no-inverno-destaques.md");
  });

  it("nao devolve arquivo sem nome", () => {
    expect(exportFileName("!!!")).toBe("destaques-destaques.md");
  });
});

describe("segmentsOf", () => {
  const marks = [
    { id: "a", start: 5, end: 8, note: null },
    { id: "b", start: 12, end: 15, note: "com nota" },
  ];

  it("sem destaque, devolve um pedaco unico", () => {
    expect(segmentsOf(0, 20, [])).toEqual([{ start: 0, end: 20, id: null, hasNote: false }]);
  });

  it("alterna marcado e nao marcado na ordem do texto", () => {
    expect(segmentsOf(0, 20, marks)).toEqual([
      { start: 0, end: 5, id: null, hasNote: false },
      { start: 5, end: 8, id: "a", hasNote: false },
      { start: 8, end: 12, id: null, hasNote: false },
      { start: 12, end: 15, id: "b", hasNote: true },
      { start: 15, end: 20, id: null, hasNote: false },
    ]);
  });

  it("recorta o destaque que atravessa a borda do trecho", () => {
    expect(segmentsOf(6, 14, marks)).toEqual([
      { start: 6, end: 8, id: "a", hasNote: false },
      { start: 8, end: 12, id: null, hasNote: false },
      { start: 12, end: 14, id: "b", hasNote: true },
    ]);
  });

  it("ignora destaque fora do trecho", () => {
    expect(segmentsOf(16, 20, marks)).toEqual([
      { start: 16, end: 20, id: null, hasNote: false },
    ]);
  });

  it("cobre o trecho inteiro quando o destaque o engloba", () => {
    const todo = [{ id: "c", start: 0, end: 100, note: null }];
    expect(segmentsOf(10, 20, todo)).toEqual([
      { start: 10, end: 20, id: "c", hasNote: false },
    ]);
  });

  it("os pedacos cobrem o trecho sem buraco nem sobreposicao", () => {
    const segments = segmentsOf(0, 20, marks);
    expect(segments[0]!.start).toBe(0);
    expect(segments.at(-1)!.end).toBe(20);
    for (let i = 1; i < segments.length; i += 1) {
      expect(segments[i]!.start).toBe(segments[i - 1]!.end);
    }
  });
});

describe("markCovering", () => {
  const marks = [{ id: "a", start: 5, end: 8, note: null }];

  it("acha o destaque que cobre a palavra", () => {
    expect(markCovering(marks, 5)!.id).toBe("a");
    expect(markCovering(marks, 7)!.id).toBe("a");
  });

  it("o fim e exclusivo", () => {
    expect(markCovering(marks, 8)).toBeNull();
    expect(markCovering(marks, 4)).toBeNull();
  });
});
