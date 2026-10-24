import { describe, expect, it } from "vitest";
import { capContent, MAX_CONTENT_CHARS, TRUNCATED_NOTICE } from "@/lib/text-limits";
import { MAX_TEXT_CHARS } from "@/lib/continuation";
import { MAX_IMPORT_CHARS } from "@/lib/pdf-text";

describe("limite de tamanho em todas as importacoes (US-179)", () => {
  it("o mesmo limite vale para colar, importar arquivo e continuar", () => {
    expect(MAX_TEXT_CHARS).toBe(MAX_CONTENT_CHARS);
    expect(MAX_IMPORT_CHARS).toBe(MAX_CONTENT_CHARS);
    expect(TRUNCATED_NOTICE).toBe("Texto cortado em 400 mil caracteres.");
  });

  it("texto dentro do limite passa inteiro", () => {
    expect(capContent("curto")).toEqual({ content: "curto", truncated: false });
  });

  it("acima do limite corta sem partir a ultima palavra", () => {
    const words = "palavra ".repeat(60_000);
    const { content, truncated } = capContent(words);
    expect(truncated).toBe(true);
    expect(content.length).toBeLessThanOrEqual(MAX_CONTENT_CHARS);
    expect(content.endsWith("palavra")).toBe(true);
  });
});
