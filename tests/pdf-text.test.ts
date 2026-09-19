import { describe, expect, it } from "vitest";
import {
  dropRepeated,
  fileTitle,
  hasNoText,
  joinParagraphs,
  linesFromItems,
} from "@/lib/pdf-text";

describe("linesFromItems", () => {
  it("junta os pedacos da mesma linha na ordem horizontal", () => {
    const linhas = linesFromItems([
      { text: "mundo", x: 60, y: 700 },
      { text: "Ola ", x: 10, y: 700 },
    ]);
    expect(linhas).toEqual(["Ola mundo"]);
  });

  it("tolera diferenca pequena de altura na mesma linha", () => {
    const linhas = linesFromItems([
      { text: "texto ", x: 10, y: 700 },
      { text: "italico", x: 50, y: 701.4 },
    ]);
    expect(linhas).toEqual(["texto italico"]);
  });

  it("ordena as linhas de cima para baixo", () => {
    const linhas = linesFromItems([
      { text: "segunda", x: 10, y: 680 },
      { text: "primeira", x: 10, y: 700 },
    ]);
    expect(linhas).toEqual(["primeira", "segunda"]);
  });

  it("descarta pedacos vazios", () => {
    expect(linesFromItems([{ text: "   ", x: 10, y: 700 }])).toEqual([]);
  });
});

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

  it("nao mexe em documento curto demais para ter padrao", () => {
    const pages = [["a", "b"], ["a", "c"]];
    expect(dropRepeated(pages)).toEqual(pages);
  });
});

describe("joinParagraphs", () => {
  it("junta linhas quebradas pela margem", () => {
    const texto = joinParagraphs([["O relojoeiro herdou a oficina do pai", "em 1974."]]);
    expect(texto).toBe("O relojoeiro herdou a oficina do pai em 1974.");
  });

  it("separa paragrafos quando a frase termina", () => {
    const texto = joinParagraphs([["Primeira frase.", "Segunda frase."]]);
    expect(texto).toBe("Primeira frase.\n\nSegunda frase.");
  });

  it("desfaz a hifenizacao de fim de linha", () => {
    const texto = joinParagraphs([["nao e recomen-", "dado."]]);
    expect(texto).toBe("nao e recomendado.");
  });

  it("descarta a linha que e so o numero da pagina", () => {
    const texto = joinParagraphs([["Uma frase que continua", "12", "em outra pagina."]]);
    expect(texto).toContain("Uma frase que continua");
    expect(texto).not.toContain("12");
  });

  it("a frase atravessa a quebra de pagina", () => {
    const texto = joinParagraphs([["A frase comeca aqui"], ["e termina na pagina seguinte."]]);
    expect(texto).toBe("A frase comeca aqui e termina na pagina seguinte.");
  });

  it("paginas vazias nao viram paragrafos vazios", () => {
    expect(joinParagraphs([[], [], []])).toBe("");
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
