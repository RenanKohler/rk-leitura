import { describe, expect, it } from "vitest";
import { dropRepeated, fileTitle, hasNoText, usableMetaTitle } from "@/lib/pdf-text";

describe("dropRepeated", () => {
  const corpo = (n: number) => [`Conteudo da pagina ${n}`, "mais uma linha"];

  it("remove o cabecalho que se repete em todas as paginas", () => {
    const pages = [1, 2, 3, 4].map((n) => ["Manual do usuario", ...corpo(n), `${n}`]);
    const limpo = dropRepeated(pages);
    expect(limpo.every((page) => !page.includes("Manual do usuario"))).toBe(true);
    expect(limpo[0]).toContain("Conteudo da pagina 1");
  });

  it("reconhece o rodape variavel como a mesma linha", () => {
    const pages = [1, 2, 3, 4].map((n) => [...corpo(n), `Capitulo 2 | pagina ${n}`]);
    const limpo = dropRepeated(pages);
    expect(limpo.every((page) => !page.some((l) => l.startsWith("Capitulo 2")))).toBe(true);
  });

  it("nao mexe em frase repetida no meio do texto", () => {
    const pages = [1, 2, 3, 4].map(() => ["inicio", "refrao repetido", "meio", "fim"]);
    const limpo = dropRepeated(pages);
    expect(limpo[0]).toContain("refrao repetido");
  });

  it("aceita linhas com estrutura, comparando pelo texto", () => {
    const pages = ["um", "dois", "tres"].map((n) => [{ text: "Revista X" }, { text: `corpo ${n}` }]);
    const limpo = dropRepeated(pages, 2, (line) => line.text);
    expect(limpo.map((page) => page.map((line) => line.text))).toEqual([
      ["corpo um"],
      ["corpo dois"],
      ["corpo tres"],
    ]);
  });

  it("nao mexe em documento curto demais para ter padrao", () => {
    const pages = [["a", "b"], ["a", "c"]];
    expect(dropRepeated(pages)).toEqual(pages);
  });
});

describe("fileTitle", () => {
  it("prefere o titulo dos metadados", () => {
    expect(fileTitle("A cabana no inverno", "arquivo.pdf")).toBe("A cabana no inverno");
  });

  it("ignora titulo de gerador e cai no nome do arquivo", () => {
    expect(fileTitle("untitled", "relatorio_anual.pdf")).toBe("relatorio anual");
    expect(fileTitle("C:\\Users\\joao\\doc.docx", "relatorio.pdf")).toBe("relatorio");
    expect(fileTitle("saida.pdf", "relatorio.pdf")).toBe("relatorio");
    expect(fileTitle("about:blank", "relatorio.pdf")).toBe("relatorio");
    expect(fileTitle("https://site.com/artigo", "relatorio.pdf")).toBe("relatorio");
  });

  it("usableMetaTitle devolve nulo para titulo de gerador", () => {
    expect(usableMetaTitle("untitled")).toBeNull();
    expect(usableMetaTitle("Um artigo")).toBe("Um artigo");
  });

  it("nunca devolve titulo vazio", () => {
    expect(fileTitle(null, ".pdf")).toBe("Documento");
  });
});

describe("hasNoText", () => {
  it("reconhece o PDF digitalizado", () => {
    expect(hasNoText("   \n  \n ")).toBe(true);
    expect(hasNoText("3")).toBe(true);
  });

  it("aceita um documento com texto de verdade", () => {
    expect(hasNoText("a".repeat(200))).toBe(false);
  });
});
