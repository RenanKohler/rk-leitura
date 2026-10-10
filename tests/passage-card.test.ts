import { describe, expect, it } from "vitest";
import {
  cardProposal,
  fallbackProposal,
  MAX_PASSAGE_WORDS,
  passageExcerpt,
  passageMessage,
  passageSpan,
  passageWords,
} from "@/lib/passage-card";
import { parseParagraphs } from "@/lib/reading";

const { words, paragraphs } = parseParagraphs(
  "Primeiro paragrafo distante.\n\nO capitao olhou o mar calmo.\n\nA baleia surgiu de repente ao lado do navio. Todos gritaram.\n\nDepois veio a tempestade final."
);

describe("passageExcerpt", () => {
  it("leva o paragrafo anterior e o trecho, nada depois do trecho", () => {
    const start = words.indexOf("baleia");
    const end = words.indexOf("navio.") + 1;
    const excerpt = passageExcerpt(paragraphs, { start, end });
    expect(excerpt.previous).toBe("O capitao olhou o mar calmo.");
    expect(excerpt.passage).toBe("baleia surgiu de repente ao lado do navio.");
    expect(excerpt.endWord).toBe(end);
    const message = passageMessage("Moby", excerpt);
    expect(message).not.toContain("Todos");
    expect(message).not.toContain("tempestade");
    expect(message).not.toContain("distante");
    // O comeco do paragrafo do trecho, antes da selecao, tambem fica de fora.
    expect(message).not.toContain("A baleia");
  });

  it("no primeiro paragrafo nao ha contexto anterior", () => {
    const excerpt = passageExcerpt(paragraphs, { start: 0, end: 2 });
    expect(excerpt.previous).toBe("");
    expect(excerpt.passage).toBe("Primeiro paragrafo");
    expect(passageMessage("T", excerpt)).not.toContain("Parágrafo anterior");
  });

  it("trecho que atravessa paragrafos usa o anterior ao do inicio", () => {
    const start = words.indexOf("mar");
    const end = words.indexOf("surgiu") + 1;
    const excerpt = passageExcerpt(paragraphs, { start, end });
    expect(excerpt.previous).toBe("Primeiro paragrafo distante.");
    expect(excerpt.passage).toBe("mar calmo.\n\nA baleia surgiu");
  });
});

describe("passageSpan e tamanho", () => {
  it("aceita so intervalos dentro do texto", () => {
    expect(passageSpan({ start: 1, end: 3 }, 10)).toEqual({ start: 1, end: 3 });
    expect(passageSpan({ start: 3, end: 3 }, 10)).toBeNull();
    expect(passageSpan({ start: 0, end: 11 }, 10)).toBeNull();
    expect(passageSpan({ start: "a", end: 2 }, 10)).toBeNull();
    expect(passageSpan(null, 10)).toBeNull();
  });

  it("conta as palavras do trecho", () => {
    expect(passageWords({ start: 0, end: MAX_PASSAGE_WORDS + 1 })).toBe(301);
  });
});

describe("proposta", () => {
  it("valida os dois lados", () => {
    expect(cardProposal({ front: " Quem? ", back: "A baleia." })).toEqual({ front: "Quem?", back: "A baleia." });
    expect(cardProposal({ front: "", back: "x" })).toBeNull();
    expect(cardProposal(null)).toBeNull();
  });

  it("sem IA, o trecho vai no verso e a frente fica vazia", () => {
    expect(fallbackProposal("a  baleia\nsurgiu")).toEqual({ front: "", back: "a baleia surgiu" });
    expect(fallbackProposal("x".repeat(800)).back.length).toBe(500);
  });
});
