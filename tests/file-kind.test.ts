import { describe, expect, it } from "vitest";
import { fileKind } from "@/lib/file-kind";

describe("fileKind", () => {
  it("reconhece os formatos pela extensao", () => {
    expect(fileKind("artigo.pdf")).toBe("pdf");
    expect(fileKind("livro.EPUB")).toBe("epub");
    expect(fileKind("relatorio.docx")).toBe("docx");
    expect(fileKind("notas.md")).toBe("markdown");
    expect(fileKind("notas.markdown")).toBe("markdown");
    expect(fileKind("conto.txt")).toBe("text");
  });

  it("a extensao vence o MIME generico do sistema", () => {
    expect(fileKind("notas.md", "text/plain")).toBe("markdown");
    expect(fileKind("artigo.pdf", "application/octet-stream")).toBe("pdf");
  });

  it("recusa o que nao e texto, em vez de cair no leitor de PDF", () => {
    expect(fileKind("foto.png", "image/png")).toBeNull();
    expect(fileKind("planilha.xlsx")).toBeNull();
    expect(fileKind("antigo.doc", "application/msword")).toBeNull();
    // Extensao desconhecida nao e salva por um MIME que diz PDF.
    expect(fileKind("foto.png", "application/pdf")).toBeNull();
  });

  it("sem extensao, decide pelo MIME", () => {
    expect(fileKind("compartilhado", "application/pdf")).toBe("pdf");
    expect(fileKind("compartilhado", "text/plain; charset=utf-8")).toBe("text");
    expect(fileKind("compartilhado", "image/jpeg")).toBeNull();
    expect(fileKind("compartilhado")).toBeNull();
  });
});
