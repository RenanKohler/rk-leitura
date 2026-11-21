import { describe, expect, it } from "vitest";
import { importReceivedPages, ImportError, RECEIVED_PARTIAL } from "@/lib/import-text";
import { bookmarkletCode, bookmarkletUrl } from "@/lib/bookmarklet";

/**
 * "Enviar para o Leitura": o navegador envia o HTML das paginas e o servidor
 * monta o texto sem buscar nada na rede.
 */

const STORY = "https://historias.example/s/conto";

function page(title: string, paragraphs: string[]): string {
  const body = paragraphs.map((text) => `<p>${text}</p>`).join("");
  return `<!doctype html><html lang="pt-BR"><head><title>${title}</title></head><body><article>${body}</article></body></html>`;
}

const paragraph = (n: number) =>
  `Parágrafo número ${n} do conto, longo o bastante para contar como uma parte nova do texto.`;

describe("importReceivedPages", () => {
  it("uma pagina vira a previa comum, sem o bloco de paginas", async () => {
    const result = await importReceivedPages(STORY, [page("O conto", [paragraph(1), paragraph(2)])]);
    expect(result.title).toBe("O conto");
    expect(result.sourceUrl).toBe(STORY);
    expect(result.content).toContain("Parágrafo número 2");
    expect("pages" in result).toBe(false);
  });

  it("junta as paginas seguintes na ordem e chega ao fim", async () => {
    const result = await importReceivedPages(STORY, [
      page("O conto", [paragraph(1)]),
      page("O conto", [paragraph(2)]),
      page("O conto", [paragraph(3)]),
    ]);
    expect(result.content.indexOf("número 1")).toBeLessThan(result.content.indexOf("número 3"));
    expect("pages" in result && result.pages).toEqual({
      first: 1,
      last: 3,
      complete: true,
      stopMessage: "",
    });
  });

  it("conta as paginas a partir da que estava aberta", async () => {
    const result = await importReceivedPages(`${STORY}?page=4`, [
      page("O conto", [paragraph(4)]),
      page("O conto", [paragraph(5)]),
    ]);
    expect("pages" in result && result.pages).toMatchObject({ first: 4, last: 5, complete: true });
  });

  it("para na pagina que repete a anterior", async () => {
    const result = await importReceivedPages(STORY, [
      page("O conto", [paragraph(1)]),
      page("O conto", [paragraph(1)]),
    ]);
    expect("pages" in result && result.pages).toMatchObject({ last: 1, complete: true });
  });

  it("envio parcial termina incompleto, com o motivo", async () => {
    const result = await importReceivedPages(
      STORY,
      [page("O conto", [paragraph(1)]), page("O conto", [paragraph(2)])],
      true
    );
    expect("pages" in result && result.pages).toMatchObject({
      last: 2,
      complete: false,
      stopMessage: RECEIVED_PARTIAL,
    });
  });

  it("pagina sem texto suficiente e recusada", async () => {
    await expect(importReceivedPages(STORY, [page("Vazia", ["Pouco texto."])])).rejects.toBeInstanceOf(
      ImportError
    );
  });
});

describe("bookmarklet", () => {
  it("e JavaScript valido, com o endereco do app embutido", () => {
    const code = bookmarkletCode("https://leitura.example");
    expect(code).not.toContain("\n");
    expect(code).toContain('A="https://leitura.example"');
    // Compila sem executar: um erro de sintaxe quebraria o favorito em silencio.
    expect(() => new Function(code)).not.toThrow();
  });

  it("o endereco do favorito decodifica para o mesmo codigo", () => {
    const url = bookmarkletUrl("https://leitura.example");
    expect(url.startsWith("javascript:")).toBe(true);
    expect(decodeURIComponent(url.slice("javascript:".length))).toBe(
      bookmarkletCode("https://leitura.example")
    );
  });
});
