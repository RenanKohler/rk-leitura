import { describe, expect, it } from "vitest";
import {
  canAskPreview,
  clampChars,
  clampPreview,
  firstSentence,
  isPreview,
  MAX_ITEM_CHARS,
  MAX_PREVIEW_CHARS,
  MIN_PREVIEW_WORDS,
  previewExcerpt,
} from "@/lib/preview";
import { crossedSection, finishedPart, MAX_READING_STEP } from "@/app/(app)/leitor/[id]/explain-offer";
import type { TextSection } from "@/lib/text-sections";

// Previa antes de ler (US-233).
describe("canAskPreview", () => {
  it("so vale para texto nao comecado, nunca lido e longo o bastante", () => {
    expect(canAskPreview({ wordCount: MIN_PREVIEW_WORDS, progressIndex: 0, lastReadAt: null })).toBe(true);
    expect(canAskPreview({ wordCount: MIN_PREVIEW_WORDS, progressIndex: 1, lastReadAt: null })).toBe(false);
    expect(
      canAskPreview({ wordCount: MIN_PREVIEW_WORDS, progressIndex: 0, lastReadAt: "2026-11-01T10:00:00Z" })
    ).toBe(false);
    expect(canAskPreview({ wordCount: MIN_PREVIEW_WORDS - 1, progressIndex: 0 })).toBe(false);
  });
});

describe("previewExcerpt", () => {
  it("manda so o comeco do texto, dentro do teto", () => {
    const content = Array.from({ length: 1000 }, (_, index) => `palavra${index}`).join(" ");
    const excerpt = previewExcerpt(content);
    expect(content.startsWith(excerpt)).toBe(true);
    expect(excerpt.split(" ")).toHaveLength(150);
    const long = "a ".repeat(200_000);
    expect(previewExcerpt(long).length).toBeLessThanOrEqual(MAX_PREVIEW_CHARS);
  });
});

describe("clampPreview", () => {
  const valid = {
    about: "Um ensaio sobre o tempo livre. E mais uma frase que sobra.",
    focus: ["A ideia de ócio", "  A ideia de ócio ", "O exemplo grego", "A crítica ao trabalho", "Quarto item"],
    questions: ["O que o autor chama de ócio?", "Por que o trabalho mudou"],
  };

  it("guarda uma frase, ate 3 itens sem repeticao e as 2 perguntas", () => {
    const preview = clampPreview(valid);
    expect(preview).toEqual({
      about: "Um ensaio sobre o tempo livre.",
      focus: ["A ideia de ócio", "O exemplo grego", "A crítica ao trabalho"],
      questions: ["O que o autor chama de ócio?", "Por que o trabalho mudou?"],
    });
    expect(isPreview(preview)).toBe(true);
  });

  it("recusa sem a frase ou sem as duas perguntas", () => {
    expect(clampPreview({ ...valid, about: "  " })).toBeNull();
    expect(clampPreview({ ...valid, questions: ["Uma só?"] })).toBeNull();
    expect(clampPreview({ ...valid, questions: "nada" })).toBeNull();
    expect(clampPreview(null)).toBeNull();
  });

  it("corta itens longos com reticencias", () => {
    const long = "palavra ".repeat(60).trim();
    const preview = clampPreview({ ...valid, focus: [long] });
    expect(preview!.focus[0]!.length).toBeLessThanOrEqual(MAX_ITEM_CHARS);
    expect(preview!.focus[0]!.endsWith("…")).toBe(true);
  });

  it("frase e corte puros", () => {
    expect(firstSentence("Sem ponto final")).toBe("Sem ponto final");
    expect(firstSentence("O Sr. Silva chega à cidade. Depois sai.")).toBe("O Sr. Silva chega à cidade.");
    expect(clampChars("curto", 10)).toBe("curto");
  });

  it("isPreview recusa o que nao tem a forma guardada", () => {
    expect(isPreview({ about: "x", focus: [], questions: ["a?"] })).toBe(false);
    expect(isPreview("x")).toBe(false);
  });
});

// Explicar a secao no leitor (US-231).
describe("crossedSection", () => {
  const sections: TextSection[] = [
    { title: "Um", start: 0, end: 200 },
    { title: "Dois", start: 200, end: 250 },
    { title: "Três", start: 250, end: 600 },
    { title: "Quatro", start: 600, end: 1000 },
  ];

  it("oferece a secao cujo fim a leitura cruzou andando", () => {
    expect(crossedSection(sections, 199, 200, 1000)?.title).toBe("Um");
    expect(crossedSection(sections, 150, 180, 1000)).toBeNull();
  });

  it("nao conta volta, salto longo, secao curta nem a ultima", () => {
    expect(crossedSection(sections, 300, 100, 1000)).toBeNull();
    expect(crossedSection(sections, 0, MAX_READING_STEP + 1, 3000)).toBeNull();
    expect(crossedSection(sections, 240, 260, 1000)).toBeNull();
    expect(crossedSection(sections, 990, 1000, 1000)).toBeNull();
  });

  it("passo que cruza dois fins fica com o ultimo", () => {
    expect(crossedSection(sections, 100, 610, 1000)?.title).toBe("Três");
  });
});

describe("finishedPart", () => {
  it("na conclusao, a ultima secao ou o texto inteiro", () => {
    expect(finishedPart([{ title: "Fim", start: 100, end: 400 }], 400)).toEqual({ start: 100, title: "Fim" });
    expect(finishedPart([], 400)).toEqual({ start: 0, title: null });
    expect(finishedPart([], 50)).toBeNull();
    expect(finishedPart([{ title: "Curta", start: 380, end: 400 }], 400)).toBeNull();
  });
});
