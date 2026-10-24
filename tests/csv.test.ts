import { describe, expect, it } from "vitest";
import { neutralizeFormula, quotedCell } from "@/lib/csv";
import { wordsCsv } from "@/lib/vocabulary";

describe("neutralizacao de formulas no CSV (US-186)", () => {
  it("prefixa apostrofo nas celulas que a planilha leria como formula", () => {
    for (const start of ["=", "+", "-", "@", "\t", "\r"]) {
      expect(neutralizeFormula(`${start}1+1`)).toBe(`'${start}1+1`);
    }
  });

  it("deixa celulas comuns iguais", () => {
    expect(neutralizeFormula("Dom Casmurro")).toBe("Dom Casmurro");
    expect(neutralizeFormula("")).toBe("");
    expect(neutralizeFormula("a=b")).toBe("a=b");
  });

  it("exportacao de sessoes neutraliza o titulo =HYPERLINK", () => {
    const cell = quotedCell('=HYPERLINK("http://x.test","clique")');
    expect(cell).toBe(`"'=HYPERLINK(""http://x.test"",""clique"")"`);
    expect(quotedCell("Conto")).toBe('"Conto"');
  });

  it("exportacao de palavras neutraliza o titulo =HYPERLINK", () => {
    const csv = wordsCsv([
      {
        word: "manga",
        base: "manga",
        kind: "",
        definition: "d",
        translation: null,
        context: null,
        textTitle: '=HYPERLINK("http://x.test")',
      },
    ]);
    expect(csv).toContain(`"'=HYPERLINK(""http://x.test"")"`);
    expect(csv).not.toMatch(/,=HYPERLINK/);
  });
});
