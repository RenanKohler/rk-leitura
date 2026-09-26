import { describe, expect, it } from "vitest";
import { annotatedFileName, annotatedMarkdown } from "@/lib/annotated-export";

const plain = {
  title: "Ensaio",
  sourceUrl: "https://exemplo.com/a",
  content: "Primeiro paragrafo com quatro.\n\nSegundo paragrafo aqui.",
  format: "plain" as const,
};

describe("annotatedMarkdown (US-100)", () => {
  it("marca o destaque entre == e poe a nota depois do paragrafo", () => {
    const md = annotatedMarkdown(plain, [{ start: 1, end: 3, note: "Importante" }]);
    expect(md).toContain("# Ensaio");
    expect(md).toContain("Origem: <https://exemplo.com/a>");
    expect(md).toContain("Primeiro ==paragrafo com== quatro.");
    expect(md).toContain("> **Nota:** Importante");
    expect(md.indexOf("> **Nota:**")).toBeLessThan(md.indexOf("Segundo"));
  });

  it("sem destaques traz so o texto", () => {
    const md = annotatedMarkdown(plain, []);
    expect(md).not.toContain("==");
    expect(md).toContain("Segundo paragrafo aqui.");
  });

  it("destaque que atravessa paragrafos fecha e reabre", () => {
    const md = annotatedMarkdown(plain, [{ start: 3, end: 5, note: null }]);
    expect(md).toContain("==quatro.==");
    expect(md).toContain("==Segundo==");
  });

  it("mantem a formatacao Markdown", () => {
    const md = annotatedMarkdown(
      { ...plain, content: "## Parte\n\nTexto com **forte** e *leve*.\n\n- item um", format: "markdown" },
      []
    );
    expect(md).toContain("## Parte");
    expect(md).toContain("**forte**");
    expect(md).toContain("*leve*.");
    expect(md).toContain("- item um");
  });

  it("nome de arquivo sem caracteres problematicos", () => {
    expect(annotatedFileName("A/B: teste")).toBe("ab-teste-anotado.md");
  });
});
