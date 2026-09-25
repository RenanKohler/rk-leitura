import { describe, expect, it } from "vitest";
import {
  bodySizeOf,
  escapeMarkdown,
  layoutPage,
  pagesToMarkdown,
  stripRunningLines,
  type PdfItem,
} from "@/lib/pdf-layout";
import { parseMarkdown } from "@/lib/markdown";

/** Uma linha como um pedaco so; a largura cheia simula texto justificado. */
function item(text: string, x: number, y: number, width: number, size = 10): PdfItem {
  return { text, x, y, width, size };
}

/** Linhas de uma coluna, de cima para baixo, com a distancia `pitch`. */
function column(lines: string[], x: number, top: number, width: number, pitch = 12, size = 10) {
  return lines.map((text, index) =>
    // A ultima linha do paragrafo e curta; as outras ocupam a coluna toda.
    item(text, x, top - index * pitch, index === lines.length - 1 ? width * 0.5 : width, size)
  );
}

function toMarkdown(pages: PdfItem[][]): string {
  const body = bodySizeOf(pages);
  return pagesToMarkdown(
    pages.map((items) => layoutPage(items, body)),
    body
  );
}

const LEFT = [
  "The ability to sustain focused attention over",
  "prolonged periods of time has long been of",
  "interest to cognitive psychologists. This review",
  "seeks to bridge findings in disparate areas and",
  "provides a framework for both those who study",
  "attention as it is most broadly defined and those",
];

const RIGHT = [
  "whose research focuses on sustained attention or",
  "vigilance. There are four main questions that the",
  "present review focuses on. Why is it challenging",
  "for individuals to maintain focused attention on",
  "a task for extended periods of time and what",
  "factors modulate these fluctuations?",
];

describe("layoutPage: ordem de leitura", () => {
  it("le a coluna da esquerda inteira antes da direita", () => {
    const items = [...column(LEFT, 50, 700, 240), ...column(RIGHT, 310, 700, 240)];
    const text = toMarkdown([items]);

    // A frase atravessa a troca de coluna sem virar outro paragrafo.
    expect(text).toContain("broadly defined and those whose research focuses");
    expect(text.indexOf("prolonged periods")).toBeLessThan(text.indexOf("vigilance."));
    // Nada da direita colado no meio de uma linha da esquerda.
    expect(text).not.toContain("over whose");
  });

  it("artigo com cabecalho de largura cheia e corpo em duas colunas", () => {
    const items = [
      // Titulo em duas linhas, corpo maior.
      item("Recent theoretical, neural, and clinical advances", 50, 760, 480, 16),
      item("in sustained attention research", 50, 740, 300, 16),
      // Resumo em largura cheia, corpo menor.
      ...column(
        [
          "Models of attention often distinguish among attention subtypes, with classic models",
          "separating orienting, switching, and sustaining functions. These findings form the",
          "basis for the next generation of sustained attention research in clinical populations.",
        ],
        50,
        710,
        500,
        11,
        9
      ).map((line, index) => (index === 2 ? { ...line, width: 480 } : line)),
      item("Keywords: sustained attention; vigilance; mind wandering", 50, 670, 300, 9),
      // Corpo em duas colunas.
      ...column(LEFT, 50, 630, 240),
      ...column(RIGHT, 310, 630, 240),
    ];

    const text = toMarkdown([items]);
    const blocks = text.split("\n\n");

    expect(blocks[0]).toBe("# Recent theoretical, neural, and clinical advances in sustained attention research");
    expect(blocks[1]).toMatch(/^Models of attention .* clinical populations\.$/);
    expect(blocks[2]).toBe("Keywords: sustained attention; vigilance; mind wandering");
    expect(blocks[3]).toMatch(/^The ability to sustain .* those whose research focuses .* fluctuations\?$/);
    expect(blocks).toHaveLength(4);
  });

  it("colunas em linhas de base diferentes ainda sao separadas", () => {
    // Cabecalho de largura cheia e colunas desalinhadas em meia linha: nenhuma
    // linha visual tem texto das duas colunas ao mesmo tempo.
    const items = [
      item("A full width heading line that spans both of the columns on the page", 50, 760, 500),
      item("and a second full width line closing the introduction block here.", 50, 748, 450),
      ...column(LEFT, 50, 700, 240),
      ...column(RIGHT, 310, 694, 240),
    ];
    const text = toMarkdown([items]);
    expect(text).toContain("broadly defined and those whose research focuses");
    expect(text).not.toContain("over whose");
    expect(text.indexOf("closing the introduction")).toBeLessThan(text.indexOf("The ability"));
  });

  it("coluna mais longa que a outra continua em ordem", () => {
    const items = [
      ...column([...LEFT, "and a last line that only the left column has."], 50, 700, 240),
      ...column(RIGHT.slice(0, 3), 310, 700, 240),
    ];
    const text = toMarkdown([items]);
    expect(text.indexOf("only the left column has.")).toBeLessThan(text.indexOf("whose research"));
  });

  it("texto de uma coluna com palavras soltas nao e reordenado", () => {
    // Cada palavra como um pedaco, com vaos variados de justificacao.
    const words = "um texto de uma coluna so com varias palavras em linhas seguidas".split(" ");
    const items: PdfItem[] = [];
    for (let row = 0; row < 6; row += 1) {
      let x = 50;
      for (const [index, word] of words.entries()) {
        items.push(item(word, x, 700 - row * 12, word.length * 5, 10));
        x += word.length * 5 + 3 + ((index + row) % 3);
      }
    }
    const text = toMarkdown([items]);
    const expected = Array.from({ length: 6 }, () => words.join(" ")).join(" ");
    expect(text).toBe(expected);
  });

  it("junta o expoente a linha em que ele esta", () => {
    const items = [
      item("Francesca C. Fortenbaugh,", 50, 700, 120),
      item("1,2", 171, 703.5, 8, 6),
      item("Joseph DeGutis", 182, 700, 70),
    ];
    const { lines } = layoutPage(items, 10);
    expect(lines.map((line) => line.text)).toEqual(["Francesca C. Fortenbaugh,1,2 Joseph DeGutis"]);
  });

  it("poe espaco entre pedacos separados por um vao", () => {
    const { lines } = layoutPage([item("Ola", 50, 700, 15), item("mundo", 70, 700, 25)], 10);
    expect(lines[0]!.text).toBe("Ola mundo");
  });
});

describe("stripRunningLines", () => {
  it("tira o cabecalho alinhado a direita antes do corte em colunas", () => {
    // Cada pagina com texto proprio: so o cabecalho e o rodape se repetem.
    const words = ["alpha", "beta", "gamma"];
    const page = (n: number) => [
      item("Ann. N.Y. Acad. Sci. ISSN 0077-8923", 420, 780, 140, 8),
      ...column(LEFT.map((line) => `${words[n]} ${line}`), 50, 700, 240),
      ...column(RIGHT.map((line) => `${words[n]} ${line}`), 310, 700, 240),
      item(`${70 + n} Ann. N.Y. Acad. Sci. 1396 (2017)`, 50, 30, 500, 8),
    ];
    const pages = stripRunningLines([page(0), page(1), page(2)]);
    const text = toMarkdown(pages);
    expect(text).not.toContain("ISSN");
    expect(text).not.toContain("1396");
    expect(text.startsWith("alpha The ability")).toBe(true);
    // A coluna da direita de uma pagina vem antes da esquerda da seguinte.
    expect(text.indexOf("alpha factors modulate")).toBeLessThan(text.indexOf("beta The ability"));
  });
});

describe("pagesToMarkdown: paragrafos", () => {
  it("junta linhas quebradas pela margem e desfaz a hifenizacao", () => {
    const items = column(
      ["O relojoeiro herdou a oficina do pai e nao e recomen-", "dado mexer nela sem licenca."],
      50,
      700,
      400
    );
    expect(toMarkdown([items])).toBe(
      "O relojoeiro herdou a oficina do pai e nao e recomendado mexer nela sem licenca."
    );
  });

  it("linha curta com ponto final fecha o paragrafo", () => {
    const items = [
      ...column(["Primeira linha longa do primeiro paragrafo que vai", "ate aqui."], 50, 700, 400),
      ...column(["Segundo paragrafo comeca na linha de baixo e", "termina."], 50, 676, 400),
    ];
    expect(toMarkdown([items])).toBe(
      "Primeira linha longa do primeiro paragrafo que vai ate aqui.\n\nSegundo paragrafo comeca na linha de baixo e termina."
    );
  });

  it("recuo de primeira linha abre paragrafo", () => {
    const items = [
      item("Primeira linha do texto que ocupa a coluna inteira", 50, 700, 400),
      item("e continua aqui sem ponto", 50, 688, 400),
      item("Novo paragrafo recuado que tambem ocupa a coluna", 70, 676, 380),
      item("toda ate o fim", 50, 664, 200),
    ];
    expect(toMarkdown([items]).split("\n\n")).toHaveLength(2);
  });

  it("a frase atravessa a quebra de pagina e o numero da pagina some", () => {
    const first = [...column(["A frase comeca aqui e vai ate a margem direita da"], 50, 700, 400), item("12", 290, 40, 10)];
    const second = column(["pagina seguinte, onde termina."], 50, 700, 400);
    expect(toMarkdown([first, second])).toBe(
      "A frase comeca aqui e vai ate a margem direita da pagina seguinte, onde termina."
    );
  });

  it("marcador de lista vira item de lista", () => {
    const items = [item("• primeiro ponto", 50, 700, 100), item("• segundo ponto", 50, 688, 100)];
    expect(toMarkdown([items])).toBe("- primeiro ponto\n\n- segundo ponto");
  });

  it("titulos em niveis pelo corpo da fonte", () => {
    const items = [
      item("Titulo do artigo", 50, 760, 200, 18),
      item("Introducao", 50, 720, 100, 13),
      ...column(["Texto do corpo em uma linha longa que vai ate o fim", "e fecha aqui."], 50, 700, 400),
    ];
    expect(toMarkdown([items]).split("\n\n").slice(0, 2)).toEqual(["# Titulo do artigo", "## Introducao"]);
  });

  it("paginas vazias nao geram paragrafos", () => {
    expect(toMarkdown([[], []])).toBe("");
  });
});

describe("escapeMarkdown", () => {
  it("simbolos do PDF continuam literais para o leitor", () => {
    const original = "# 1. *nota* com [colchetes], <tag>, a_b e 3 | 4 ~ 5";
    const [block] = parseMarkdown(escapeMarkdown(original));
    expect(block!.kind).toBe("p");
    expect(block!.words.join(" ")).toBe(original);
    expect(block!.styles.every((style) => style === 0)).toBe(true);
  });

  it("hifen e numero no inicio nao viram lista", () => {
    expect(parseMarkdown(escapeMarkdown("- nao e item"))[0]!.kind).toBe("p");
    expect(parseMarkdown(escapeMarkdown("1. nao e item"))[0]!.kind).toBe("p");
    expect(parseMarkdown(escapeMarkdown("---"))[0]!.words).toEqual(["---"]);
  });
});
