import { describe, expect, it } from "vitest";
import {
  alreadyPresent,
  buildPageUrl,
  collectPages,
  MAX_SOURCE_PAGE,
  MAX_TEXT_CHARS,
  type PartResult,
} from "@/lib/continuation";
import { pageFromUrl } from "@/lib/source-url";

const STORY = "https://www.literotica.com/s/the-cabin-ch-01";

/** Paragrafo acima do minimo comparavel (40 caracteres). */
const bloco = (n: number) =>
  `Paragrafo numero ${n} do conto, longo o bastante para entrar na comparacao entre partes.`;

const texto = (numeros: number[]) => numeros.map(bloco).join("\n\n");

describe("buildPageUrl", () => {
  it("acrescenta page quando a URL nao tem", () => {
    expect(buildPageUrl(STORY, 2)).toBe(`${STORY}?page=2`);
  });

  it("troca o page existente em vez de acumular", () => {
    // A base e sempre a URL importada; sem isso o parametro se somaria a cada
    // chamada e a origem receberia "?page=2&page=3".
    expect(buildPageUrl(`${STORY}?page=2`, 3)).toBe(`${STORY}?page=3`);
  });

  it("preserva os demais parametros", () => {
    expect(buildPageUrl(`${STORY}?ordem=asc`, 2)).toBe(`${STORY}?ordem=asc&page=2`);
  });

  it("devolve null quando a origem nao e uma URL", () => {
    expect(buildPageUrl("nao e url", 2)).toBeNull();
  });
});

describe("alreadyPresent", () => {
  it("reconhece a mesma pagina devolvida de novo", () => {
    // Origem que ignora o parametro e repete o conteudo ja salvo.
    const parte = texto([1, 2, 3, 4]);
    expect(alreadyPresent(parte, parte)).toBe(true);
  });

  it("aceita uma parte nova", () => {
    expect(alreadyPresent(texto([1, 2, 3, 4]), texto([5, 6, 7, 8]))).toBe(false);
  });

  it("aceita uma parte que repete so a abertura", () => {
    // Sites que repetem o primeiro paragrafo em toda pagina nao podem ser
    // lidos como fim do conto.
    expect(alreadyPresent(texto([1, 2, 3, 4]), texto([1, 5, 6, 7]))).toBe(false);
  });

  it("recusa uma parte que so muda o inicio", () => {
    // O inverso tambem: mudar apenas a abertura nao faz a parte ser nova.
    const novo = texto([99, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const existente = texto([2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(alreadyPresent(existente, novo)).toBe(true);
  });

  it("ignora diferencas de espaco e caixa", () => {
    const existente = texto([1, 2, 3]);
    const recebido = existente.toUpperCase().replace(/ /g, "  ");
    expect(alreadyPresent(existente, recebido)).toBe(true);
  });

  it("nao compara paragrafos curtos", () => {
    // Falas de dialogo se repetem naturalmente; contar isso apagaria partes
    // legitimas.
    const dialogo = "- Oi.\n\n- Voce veio.\n\n- Vim.";
    expect(alreadyPresent(dialogo, dialogo)).toBe(false);
  });

  it("trata parte vazia como nao repetida", () => {
    expect(alreadyPresent(texto([1, 2, 3]), "")).toBe(false);
  });
});

describe("continuacao a partir da URL importada", () => {
  it("segue da parte importada, nao da segunda", () => {
    // Importar "?page=3" e continuar deve buscar a 4.
    const importada = `${STORY}?page=3`;
    const proxima = pageFromUrl(importada) + 1;
    expect(proxima).toBe(4);
    expect(buildPageUrl(importada, proxima)).toBe(`${STORY}?page=4`);
  });

  it("comeca na 2 quando a importacao foi a primeira pagina", () => {
    const proxima = pageFromUrl(STORY) + 1;
    expect(buildPageUrl(STORY, proxima)).toBe(`${STORY}?page=2`);
  });
});

describe("collectPages", () => {
  const part = (page: number) => `Parte ${page}: ${"palavra ".repeat(20)}fim da parte ${page}.`;
  const upTo =
    (last: number) =>
    async (page: number): Promise<PartResult> =>
      page <= last
        ? { status: "appended", content: part(page) }
        : { status: "end", message: "Não há mais partes neste texto." };

  it("junta as paginas ate a origem acabar e marca como completo", async () => {
    const pages: number[] = [];
    const result = await collectPages({ content: part(1), page: 1 }, async (page, existing) => {
      pages.push(page);
      expect(existing).toContain(`fim da parte ${page - 1}.`);
      return upTo(4)(page);
    });

    expect(pages).toEqual([2, 3, 4, 5]);
    expect(result).toMatchObject({ firstPage: 1, lastPage: 4, complete: true, stopMessage: "" });
    expect(result.content.split("\n\n")).toEqual([part(1), part(2), part(3), part(4)]);
  });

  it("uma pagina so tambem e completa", async () => {
    const result = await collectPages({ content: part(1), page: 1 }, upTo(1));
    expect(result).toMatchObject({ lastPage: 1, complete: true, content: part(1) });
  });

  it("comeca da pagina do endereco", async () => {
    const pages: number[] = [];
    const result = await collectPages({ content: part(3), page: 3 }, async (page) => {
      pages.push(page);
      return upTo(4)(page);
    });
    expect(pages).toEqual([4, 5]);
    expect(result).toMatchObject({ firstPage: 3, lastPage: 4, complete: true });
  });

  it("falha da origem para incompleto, com o que ja veio e o motivo", async () => {
    const result = await collectPages({ content: part(1), page: 1 }, async (page) =>
      page === 3
        ? { status: "unavailable", message: "A origem demorou demais para responder." }
        : { status: "appended", content: part(page) }
    );
    expect(result).toMatchObject({
      lastPage: 2,
      complete: false,
      stopMessage: "A origem demorou demais para responder.",
    });
  });

  it("para no teto de paginas", async () => {
    const result = await collectPages({ content: part(1), page: 1 }, upTo(100), { maxPages: 5 });
    expect(result).toMatchObject({ lastPage: 5, complete: false });
    expect(result.stopMessage).toContain("5 páginas");
  });

  it("para no teto de partes do texto", async () => {
    const result = await collectPages(
      { content: part(MAX_SOURCE_PAGE - 1), page: MAX_SOURCE_PAGE - 1 },
      upTo(1000)
    );
    expect(result).toMatchObject({ lastPage: MAX_SOURCE_PAGE, complete: false });
  });

  it("para no tamanho maximo sem passar dele", async () => {
    const big = "a ".repeat(MAX_TEXT_CHARS / 4);
    const result = await collectPages({ content: big, page: 1 }, async () => ({
      status: "appended",
      content: big,
    }));
    expect(result.content.length).toBeLessThanOrEqual(MAX_TEXT_CHARS);
    expect(result.complete).toBe(false);
    expect(result.stopMessage).toBe("O texto atingiu o tamanho máximo.");
  });

  it("para quando o tempo acaba", async () => {
    let clock = 0;
    const result = await collectPages(
      { content: part(1), page: 1 },
      async (page) => {
        clock += 20_000;
        return upTo(100)(page);
      },
      { now: () => clock, budgetMs: 45_000 }
    );
    expect(result).toMatchObject({ lastPage: 4, complete: false });
    expect(result.stopMessage).toBe("A busca das páginas passou do tempo.");
  });
});
