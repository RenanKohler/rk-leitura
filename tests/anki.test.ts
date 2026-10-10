import { describe, expect, it } from "vitest";
import { ankiExport, ankiField, ankiFileName, ankiTag } from "@/lib/anki";

describe("exportacao para o Anki", () => {
  it("uma linha por cartao: frente, verso e etiqueta, separados por tabulacao", () => {
    const out = ankiExport([
      { front: "O que é?", back: "Uma ideia.", title: "Ensaio sobre a cegueira" },
      { front: "Linha\tcom\ttab", back: "Verso\ncom\r\nquebras", title: "Outro, texto!" },
    ]);
    const lines = out.split("\n");
    expect(lines.slice(0, 3)).toEqual(["#separator:tab", "#html:false", "#tags column:3"]);
    expect(lines[3]).toBe("O que é?\tUma ideia.\tEnsaio_sobre_a_cegueira");
    expect(lines[4]).toBe("Linha com tab\tVerso com quebras\tOutro_texto");
    expect(lines[4]!.split("\t")).toHaveLength(3);
    expect(out.endsWith("\n")).toBe(true);
  });

  it("limpa os campos e a etiqueta", () => {
    expect(ankiField("  a\t\tb c ")).toBe("a b c");
    expect(ankiTag("Memórias póstumas de Brás Cubas")).toBe("Memórias_póstumas_de_Brás_Cubas");
    expect(ankiTag("!!!")).toBe("rk-leitura");
  });

  it("nome do arquivo so com ASCII", () => {
    expect(ankiFileName("Memórias Póstumas")).toBe("cartoes-memorias-postumas.txt");
    expect(ankiFileName(null)).toBe("cartoes-todos.txt");
    expect(ankiFileName("???")).toBe("cartoes-texto.txt");
  });
});
