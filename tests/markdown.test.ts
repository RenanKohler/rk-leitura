import { describe, expect, it } from "vitest";
import { looksLikeMarkdown, markdownTitle, parseMarkdown, STYLE } from "@/lib/markdown";
import { countWords, parseParagraphs, sliceParagraphs } from "@/lib/reading";

const words = (source: string) => parseMarkdown(source).flatMap((block) => block.words);

describe("parseMarkdown: blocos", () => {
  it("reconhece titulos ATX e setext sem o simbolo", () => {
    const blocks = parseMarkdown("# Um titulo\n\nTexto.\n\nOutro\n-----\n\nMais um\n===\n\n### Nivel 3 ###");
    expect(blocks.map((block) => block.kind)).toEqual(["h1", "p", "h2", "h1", "h3"]);
    expect(blocks[0]!.words).toEqual(["Um", "titulo"]);
    expect(blocks[4]!.words).toEqual(["Nivel", "3"]);
    expect(blocks[0]!.styles.every((style) => style & STYLE.heading)).toBe(true);
  });

  it("junta linhas do mesmo paragrafo e separa na linha vazia", () => {
    const blocks = parseMarkdown("primeira linha\nsegunda linha\n\nnovo paragrafo");
    expect(blocks).toHaveLength(2);
    expect(blocks[0]!.words).toEqual(["primeira", "linha", "segunda", "linha"]);
  });

  it("citacoes, listas e listas numeradas", () => {
    const blocks = parseMarkdown("> citado\n> continua\n\n- um\n- dois\n\n1. primeiro\n2) segundo");
    expect(blocks.map((block) => block.kind)).toEqual(["quote", "li", "li", "oli", "oli"]);
    expect(blocks[0]!.words).toEqual(["citado", "continua"]);
    expect(blocks[3]!.marker).toBe("1.");
    expect(blocks[4]!.marker).toBe("2.");
    expect(blocks[4]!.words).toEqual(["segundo"]);
  });

  it("bloco de codigo mantem os simbolos e marca como codigo", () => {
    const blocks = parseMarkdown("```ts\nconst a = **b**;\n\nreturn a;\n```\nfim");
    expect(blocks.map((block) => block.kind)).toEqual(["code", "code", "p"]);
    expect(blocks[0]!.words).toEqual(["const", "a", "=", "**b**;"]);
    expect(blocks[0]!.styles.every((style) => style === STYLE.code)).toBe(true);
  });

  it("ignora regua horizontal e front matter", () => {
    expect(words("---\ntitle: x\n---\nantes\n\n***\n\ndepois")).toEqual(["antes", "depois"]);
  });

  it("tabela vira linhas de celulas, sem a linha separadora", () => {
    const blocks = parseMarkdown("| a | b |\n|---|---|\n| 1 | 2 |");
    expect(blocks.map((block) => block.words)).toEqual([
      ["a", "·", "b"],
      ["1", "·", "2"],
    ]);
  });
});

describe("parseMarkdown: inline", () => {
  it("negrito, italico, riscado e codigo", () => {
    const [block] = parseMarkdown("um **forte** e *leve* e ~~fora~~ e `x()` e ***ambos***");
    const style = (word: string) => block!.styles[block!.words.indexOf(word)];
    expect(block!.words).toEqual(["um", "forte", "e", "leve", "e", "fora", "e", "x()", "e", "ambos"]);
    expect(style("forte")).toBe(STYLE.bold);
    expect(style("leve")).toBe(STYLE.italic);
    expect(style("fora")).toBe(STYLE.strike);
    expect(style("x()")).toBe(STYLE.code);
    expect(style("ambos")).toBe(STYLE.bold | STYLE.italic);
    expect(style("um")).toBe(0);
  });

  it("enfase que atravessa varias palavras", () => {
    const [block] = parseMarkdown("antes **tres palavras juntas** depois");
    expect(block!.styles).toEqual([0, STYLE.bold, STYLE.bold, STYLE.bold, 0]);
  });

  it("delimitador sem par fica como texto", () => {
    expect(words("2 * 3 = 6 e *sem fechar")).toEqual(["2", "*", "3", "=", "6", "e", "*sem", "fechar"]);
  });

  it("sublinhado dentro de palavra nao e marca", () => {
    const [block] = parseMarkdown("use snake_case_name aqui");
    expect(block!.words).toEqual(["use", "snake_case_name", "aqui"]);
    expect(block!.styles).toEqual([0, 0, 0]);
  });

  it("links ficam com o rotulo; imagens com o texto alternativo", () => {
    const [block] = parseMarkdown("veja [o site](https://a.com/x_(y)) e ![uma foto](f.png) e <https://b.com>");
    expect(block!.words).toEqual(["veja", "o", "site", "e", "uma", "foto", "e", "https://b.com"]);
    expect(block!.styles[1]).toBe(STYLE.link);
    expect(block!.styles[4]).toBe(0);
    expect(block!.styles[7]).toBe(STYLE.link);
  });

  it("escapes e tags HTML", () => {
    expect(words("\\*literal\\* e <b>forte</b>")).toEqual(["*literal*", "e", "forte"]);
  });

  it("pontuacao colada a enfase fica na palavra", () => {
    const [block] = parseMarkdown("**Nota**: ok");
    expect(block!.words).toEqual(["Nota:", "ok"]);
    expect(block!.styles[0]).toBe(STYLE.bold);
  });
});

describe("markdownTitle e looksLikeMarkdown", () => {
  it("usa o primeiro titulo", () => {
    expect(markdownTitle("intro\n\n## Capitulo **um**\n\n# Outro")).toBe("Capitulo um");
    expect(markdownTitle("sem titulo")).toBeNull();
  });

  it("detecta Markdown com titulo ou dois sinais", () => {
    expect(looksLikeMarkdown("# Titulo\n\ntexto")).toBe(true);
    expect(looksLikeMarkdown("- item\n- item\n\ncom **negrito**")).toBe(true);
    expect(looksLikeMarkdown("Um texto comum.\n\n- Disse ele, saindo.")).toBe(false);
    expect(looksLikeMarkdown("2 * 3 e 4 * 5")).toBe(false);
  });
});

describe("reading com formato markdown", () => {
  const source = "# Titulo\n\nUm **dois** tres.\n\n- item";

  it("conta so as palavras limpas", () => {
    expect(countWords(source, "markdown")).toBe(5);
    expect(countWords(source)).toBe(7);
  });

  it("paragrafos carregam tipo, estilos e inicio acumulado", () => {
    const { words: all, paragraphs } = parseParagraphs(source, "markdown");
    expect(all).toEqual(["Titulo", "Um", "dois", "tres.", "item"]);
    expect(paragraphs.map((paragraph) => [paragraph.kind, paragraph.start])).toEqual([
      ["h1", 0],
      ["p", 1],
      ["li", 4],
    ]);
    expect(paragraphs[1]!.styles).toEqual([0, STYLE.bold, 0]);
  });

  it("o recorte mantem tipo e recorta os estilos junto", () => {
    const { paragraphs } = parseParagraphs(source, "markdown");
    const [slice] = sliceParagraphs(paragraphs, 2, 3);
    expect(slice).toMatchObject({ kind: "p", start: 2, words: ["dois"], styles: [STYLE.bold] });
  });

  it("texto simples continua igual", () => {
    expect(parseParagraphs(source).paragraphs[0]).toEqual({ start: 0, words: ["#", "Titulo"] });
  });
});
