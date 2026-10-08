import { describe, expect, it } from "vitest";
import {
  asStoredSynthesis,
  cleanSynthesis,
  highlightsFingerprint,
  isSynthesisStale,
  MAX_SYNTHESIS_WORDS,
  synthesisPrompt,
} from "@/lib/highlight-synthesis";

const items = [
  { id: "b", start: 40, end: 45, excerpt: "segundo trecho", note: null },
  { id: "a", start: 10, end: 15, excerpt: "primeiro  trecho\ncom quebra", note: "Gostei" },
  { id: "c", start: 90, end: 95, excerpt: "terceiro trecho", note: null },
];

describe("highlightsFingerprint (US-140)", () => {
  it("nao depende da ordem da lista", () => {
    expect(highlightsFingerprint(items)).toBe(highlightsFingerprint([...items].reverse()));
  });

  it("muda quando um destaque entra, sai ou muda de nota", () => {
    const base = highlightsFingerprint(items);
    expect(highlightsFingerprint(items.slice(1))).not.toBe(base);
    expect(
      highlightsFingerprint([...items, { id: "d", start: 99, end: 100, excerpt: "x", note: null }])
    ).not.toBe(base);
    expect(
      highlightsFingerprint(items.map((item) => (item.id === "b" ? { ...item, note: "nova" } : item)))
    ).not.toBe(base);
  });

  it("marca a sintese como desatualizada", () => {
    const stored = { fingerprint: highlightsFingerprint(items) };
    expect(isSynthesisStale(stored, items)).toBe(false);
    expect(isSynthesisStale(stored, items.slice(0, 2))).toBe(true);
  });
});

describe("synthesisPrompt (US-140)", () => {
  it("numera os destaques na ordem da leitura, com as notas", () => {
    const { prompt, included } = synthesisPrompt("Ensaio", items);
    expect(included).toBe(3);
    expect(prompt).toContain("Texto: Ensaio");
    expect(prompt).toContain("[1] primeiro trecho com quebra\nNota do leitor: Gostei");
    expect(prompt).toContain("[2] segundo trecho");
    expect(prompt).toContain("[3] terceiro trecho");
    expect(prompt.indexOf("[1]")).toBeLessThan(prompt.indexOf("[2]"));
  });

  it("para no teto de caracteres", () => {
    const long = Array.from({ length: 10 }, (_, index) => ({
      id: String(index),
      start: index,
      end: index + 1,
      excerpt: "a".repeat(20_000),
      note: null,
    }));
    const { included } = synthesisPrompt("Longo", long);
    expect(included).toBeGreaterThan(0);
    expect(included).toBeLessThan(10);
  });
});

describe("cleanSynthesis (US-140)", () => {
  it("separa citacoes agrupadas e descarta numeros que nao existem", () => {
    const clean = cleanSynthesis("Uma ideia [1, 3] e outra [7].  Fim [2]", 3);
    expect(clean?.synthesis).toBe("Uma ideia [1][3] e outra. Fim [2]");
    expect(clean?.cited).toEqual([1, 2, 3]);
  });

  it(`corta em ${MAX_SYNTHESIS_WORDS} palavras`, () => {
    const raw = Array.from({ length: 200 }, (_, index) => `p${index}`).join(" ");
    const clean = cleanSynthesis(raw, 3);
    expect(clean?.synthesis.split(" ")).toHaveLength(MAX_SYNTHESIS_WORDS);
    expect(clean?.synthesis.endsWith("…")).toBe(true);
  });

  it("recusa resposta vazia ou fora do formato", () => {
    expect(cleanSynthesis("   ", 3)).toBeNull();
    expect(cleanSynthesis(null, 3)).toBeNull();
  });
});

describe("asStoredSynthesis (US-140)", () => {
  it("le o que foi guardado e recusa o resto", () => {
    expect(
      asStoredSynthesis({ synthesis: "S [1]", fingerprint: "3-abc", cited: [1], count: 3, createdAt: "x" })
    ).toEqual({ synthesis: "S [1]", fingerprint: "3-abc", cited: [1], count: 3, createdAt: "x" });
    expect(asStoredSynthesis({ synthesis: "S" })).toBeNull();
    expect(asStoredSynthesis(null)).toBeNull();
  });
});
