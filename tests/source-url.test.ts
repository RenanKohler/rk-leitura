import { describe, expect, it } from "vitest";
import { normalizeSourceUrl, pageFromUrl, pickSharedUrl } from "@/lib/source-url";

const STORY = "https://www.literotica.com/s/the-cabin-ch-01";

describe("normalizeSourceUrl", () => {
  it("descarta parametros de rastreamento", () => {
    expect(normalizeSourceUrl(`${STORY}?utm_source=android&utm_campaign=x`)).toBe(STORY);
    expect(normalizeSourceUrl(`${STORY}?fbclid=abc`)).toBe(STORY);
    expect(normalizeSourceUrl(`${STORY}?gclid=abc&igshid=def`)).toBe(STORY);
  });

  it("preserva parametros que mudam o conteudo", () => {
    expect(normalizeSourceUrl(`${STORY}?page=3&utm_source=x`)).toBe(`${STORY}?page=3`);
  });

  it("descarta fragmento, barra final e maiuscula no host", () => {
    expect(normalizeSourceUrl(`${STORY}#topo`)).toBe(STORY);
    expect(normalizeSourceUrl(`${STORY}/`)).toBe(STORY);
    expect(normalizeSourceUrl("https://WWW.Literotica.com/s/the-cabin-ch-01")).toBe(STORY);
  });

  it("trata as variacoes como o mesmo endereco", () => {
    const formas = [
      `${STORY}`,
      `${STORY}/`,
      `${STORY}#topo`,
      `${STORY}?utm_source=share`,
      "https://WWW.Literotica.com/s/the-cabin-ch-01/?fbclid=1#leia",
    ];
    const normalizadas = new Set(formas.map(normalizeSourceUrl));
    expect(normalizadas.size).toBe(1);
  });

  it("nao apaga a barra da raiz", () => {
    expect(normalizeSourceUrl("https://exemplo.com/")).toBe("https://exemplo.com/");
  });

  it("devolve a entrada quando nao e uma URL http", () => {
    expect(normalizeSourceUrl("  nao e url  ")).toBe("nao e url");
    expect(normalizeSourceUrl("javascript:alert(1)")).toBe("javascript:alert(1)");
    expect(normalizeSourceUrl("ftp://exemplo.com/a")).toBe("ftp://exemplo.com/a");
  });
});

describe("pickSharedUrl", () => {
  it("prefere o campo url", () => {
    expect(pickSharedUrl({ url: STORY, text: "https://outro.com/x" })).toBe(STORY);
  });

  it("acha a URL dentro do texto quando o campo url nao vem", () => {
    // O Chrome preenche `url`; boa parte dos apps manda tudo junto em `text`.
    expect(pickSharedUrl({ text: `Olha isso: ${STORY} otimo conto` })).toBe(STORY);
  });

  it("tambem procura no titulo, como ultimo recurso", () => {
    expect(pickSharedUrl({ title: STORY })).toBe(STORY);
  });

  it("tira a pontuacao colada no fim do endereco", () => {
    expect(pickSharedUrl({ text: `Leia ${STORY}.` })).toBe(STORY);
    expect(pickSharedUrl({ text: `Leia ${STORY}!` })).toBe(STORY);
  });

  it("preserva parenteses que fazem parte do endereco", () => {
    const wiki = "https://pt.wikipedia.org/wiki/Fixacao_(leitura)";
    expect(pickSharedUrl({ text: wiki })).toBe(wiki);
  });

  it("devolve null quando nao ha endereco", () => {
    expect(pickSharedUrl({ text: "um trecho selecionado sem link" })).toBeNull();
    expect(pickSharedUrl({})).toBeNull();
  });
});

describe("pageFromUrl", () => {
  it("usa 1 quando nao ha page", () => {
    expect(pageFromUrl(STORY)).toBe(1);
    expect(pageFromUrl(null)).toBe(1);
    expect(pageFromUrl("nao e url")).toBe(1);
  });

  it("le a parte indicada na URL importada", () => {
    // Importar "?page=3" significa continuar da 4, nao voltar para a 2.
    expect(pageFromUrl(`${STORY}?page=3`)).toBe(3);
  });

  it("ignora valores invalidos", () => {
    expect(pageFromUrl(`${STORY}?page=0`)).toBe(1);
    expect(pageFromUrl(`${STORY}?page=-2`)).toBe(1);
    expect(pageFromUrl(`${STORY}?page=abc`)).toBe(1);
    expect(pageFromUrl(`${STORY}?page=2.5`)).toBe(1);
  });
});
