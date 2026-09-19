import { describe, expect, it } from "vitest";
import { alreadyPresent, buildPageUrl } from "@/lib/continuation";
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
