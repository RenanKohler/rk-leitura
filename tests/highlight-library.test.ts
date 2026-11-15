import { describe, expect, it } from "vitest";
import {
  dayLabel,
  filterHighlights,
  foldText,
  groupHighlights,
  HIGHLIGHT_EXPORT_LIMIT,
  HIGHLIGHT_LIBRARY_LIMIT,
  highlightsLabel,
  libraryExportFileName,
  libraryMarkdown,
  limitGroups,
  matchLabel,
  searchIndex,
  totalLabel,
  truncationNotice,
  withExcerpts,
  type HighlightRow,
} from "@/lib/highlight-library";
import { excerptOf, toMarkdown } from "@/lib/highlights";
import { parseParagraphs } from "@/lib/reading";
import type { HighlightExportText, LibraryHighlight, LibraryHighlightText } from "@/lib/types";

/** Destaque de teste: so o que o caso precisa muda. */
function mark(
  over: Partial<LibraryHighlight> & Pick<LibraryHighlight, "id" | "textId">
): LibraryHighlight {
  return {
    start: 0,
    end: 1,
    excerpt: "trecho",
    note: null,
    reviewOff: false,
    createdAt: "2026-03-01T12:00:00.000Z",
    ...over,
  };
}

const CABANA: LibraryHighlightText = { id: "t1", title: "A cabana no inverno" };
const MEMORIA: LibraryHighlightText = { id: "t2", title: "Memória de trabalho" };
const TEXTS = [CABANA, MEMORIA];

const ids = (items: LibraryHighlight[]) => items.map((item) => item.id);

describe("withExcerpts", () => {
  const row = (over: Partial<HighlightRow> & Pick<HighlightRow, "id" | "textId">): HighlightRow => ({
    start: 0,
    end: 1,
    note: null,
    reviewOff: false,
    createdAt: "2026-03-01T12:00:00.000Z",
    ...over,
  });

  const plain = {
    id: "p",
    format: "plain",
    content: "Primeira frase do texto.\n\nSegunda frase, mais longa, do mesmo texto.",
  };
  const markdown = {
    id: "m",
    format: "markdown",
    content: "# Um titulo\n\nTexto com **negrito** no meio da frase.",
  };

  it("tira o trecho do conteudo pelos indices de palavra", () => {
    const [item] = withExcerpts([row({ id: "a", textId: "p", start: 4, end: 8 })], [plain]);
    expect(item?.excerpt).toBe("Segunda frase, mais longa,");
  });

  it("separa as palavras com o formato do texto, como a tela do texto", () => {
    const [item] = withExcerpts([row({ id: "a", textId: "m", start: 2, end: 5 })], [markdown]);

    // A mesma conta de `loadHighlights`.
    const asMarkdown = parseParagraphs(markdown.content, "markdown").words;
    expect(item?.excerpt).toBe(excerptOf(asMarkdown, 2, 5));

    // Lido como texto simples, o "#" do titulo seria uma palavra e o trecho, outro.
    const asPlain = parseParagraphs(markdown.content, "plain").words;
    expect(item?.excerpt).not.toBe(excerptOf(asPlain, 2, 5));
  });

  it("formato desconhecido e lido como texto simples", () => {
    const [item] = withExcerpts(
      [row({ id: "a", textId: "p", start: 0, end: 2 })],
      [{ ...plain, format: "outro" }]
    );
    expect(item?.excerpt).toBe("Primeira frase");
  });

  it("leva nota, revisao e data como vieram", () => {
    const [item] = withExcerpts(
      [
        row({
          id: "a",
          textId: "p",
          start: 0,
          end: 1,
          note: "anotado",
          reviewOff: true,
          createdAt: "2026-04-02T08:00:00.000Z",
        }),
      ],
      [plain]
    );
    expect(item).toEqual({
      id: "a",
      textId: "p",
      start: 0,
      end: 1,
      excerpt: "Primeira",
      note: "anotado",
      reviewOff: true,
      createdAt: "2026-04-02T08:00:00.000Z",
    });
  });

  it("destaque de texto que nao veio fica de fora", () => {
    const items = withExcerpts(
      [row({ id: "a", textId: "p" }), row({ id: "b", textId: "sumiu" })],
      [plain]
    );
    expect(ids(items)).toEqual(["a"]);
  });
});

describe("foldText", () => {
  it("tira acento, caixa e pontuacao, e junta as palavras com um espaco", () => {
    expect(foldText("  Memória de  trabalho, ")).toBe("memoria de trabalho");
    expect(foldText("ATENÇÃO — constante!")).toBe("atencao constante");
  });

  it("so pontuacao vira vazio", () => {
    expect(foldText("... !?")).toBe("");
    expect(foldText("")).toBe("");
  });
});

describe("busca e filtro", () => {
  const items = [
    mark({
      id: "a",
      textId: "t1",
      start: 10,
      excerpt: "O coração da cabana, no inverno, é a lareira.",
      note: "lembra a casa da avó",
    }),
    mark({ id: "b", textId: "t1", start: 40, excerpt: "A neve cobria tudo." }),
    mark({
      id: "c",
      textId: "t2",
      start: 5,
      excerpt: "A atenção sustenta a leitura.",
      note: "comparar com o capítulo sobre ritmo",
    }),
  ];
  const index = searchIndex(items, TEXTS);
  const search = (query: string, scope: "todos" | "com-nota" = "todos") =>
    ids(filterHighlights(index, query, scope));

  it("sem busca nem filtro devolve tudo, na ordem em que veio", () => {
    expect(search("")).toEqual(["a", "b", "c"]);
    // So pontuacao nao e busca.
    expect(search("!!!")).toEqual(["a", "b", "c"]);
  });

  it("acha no trecho sem diferenciar acento nem maiuscula", () => {
    expect(search("coracao")).toEqual(["a"]);
    expect(search("ATENCAO")).toEqual(["c"]);
    expect(search("Atenção")).toEqual(["c"]);
  });

  it("acha palavra que so esta na nota", () => {
    expect(search("avo")).toEqual(["a"]);
    expect(search("capitulo sobre ritmo")).toEqual(["c"]);
  });

  it("acha pelo titulo do texto: todos os destaques dele", () => {
    expect(search("memoria")).toEqual(["c"]);
    expect(search("cabana no inverno")).toEqual(["a", "b"]);
  });

  it("a pontuacao no meio da frase nao atrapalha", () => {
    expect(search("cabana no inverno e a lareira")).toEqual(["a"]);
  });

  it("acha enquanto se digita, pelo comeco da palavra", () => {
    expect(search("lare")).toEqual(["a"]);
  });

  it("o termo nao casa metade no trecho e metade na nota", () => {
    expect(search("lareira lembra")).toEqual([]);
  });

  it("com nota deixa so os anotados", () => {
    expect(search("", "com-nota")).toEqual(["a", "c"]);
  });

  it("busca e filtro valem juntos", () => {
    expect(search("cabana", "com-nota")).toEqual(["a"]);
    expect(search("neve", "com-nota")).toEqual([]);
  });
});

describe("groupHighlights", () => {
  const items = [
    mark({ id: "a", textId: "t1", start: 40, createdAt: "2026-03-01T10:00:00.000Z" }),
    mark({ id: "b", textId: "t1", start: 10, createdAt: "2026-03-02T10:00:00.000Z" }),
    mark({ id: "c", textId: "t2", start: 5, createdAt: "2026-03-05T10:00:00.000Z" }),
    mark({ id: "d", textId: "t2", start: 1, createdAt: "2026-02-01T10:00:00.000Z" }),
  ];

  it("o texto com o destaque mais recente vem primeiro", () => {
    const groups = groupHighlights(items, TEXTS);
    expect(groups.map((group) => group.text.id)).toEqual(["t2", "t1"]);
  });

  it("dentro do texto a ordem e a do texto, nao a da criacao", () => {
    const groups = groupHighlights(items, TEXTS);
    expect(ids(groups[0]!.items)).toEqual(["d", "c"]);
    expect(ids(groups[1]!.items)).toEqual(["b", "a"]);
  });

  it("conta os destaques de cada grupo", () => {
    expect(groupHighlights(items, TEXTS).map((group) => group.count)).toEqual([2, 2]);
  });

  it("empate na data segue o titulo", () => {
    const same = [
      mark({ id: "x", textId: "t2", createdAt: "2026-03-01T10:00:00.000Z" }),
      mark({ id: "y", textId: "t1", createdAt: "2026-03-01T10:00:00.000Z" }),
    ];
    expect(groupHighlights(same, TEXTS).map((group) => group.text.title)).toEqual([
      "A cabana no inverno",
      "Memória de trabalho",
    ]);
  });

  it("compara o instante, nao o texto da data", () => {
    const mixed = [
      mark({ id: "x", textId: "t1", createdAt: "2026-03-01T10:00:00Z" }),
      mark({ id: "y", textId: "t2", createdAt: "2026-03-01T10:00:00.500Z" }),
    ];
    expect(groupHighlights(mixed, TEXTS).map((group) => group.text.id)).toEqual(["t2", "t1"]);
  });

  it("destaque de texto desconhecido fica de fora, e sem destaque nao ha grupo", () => {
    const groups = groupHighlights([mark({ id: "z", textId: "t9" })], TEXTS);
    expect(groups).toEqual([]);
  });

  it("nao muda a lista recebida", () => {
    const before = ids(items);
    groupHighlights(items, TEXTS);
    expect(ids(items)).toEqual(before);
  });
});

describe("limitGroups", () => {
  const groups = groupHighlights(
    [
      mark({ id: "a", textId: "t1", start: 1, createdAt: "2026-03-05T10:00:00.000Z" }),
      mark({ id: "b", textId: "t1", start: 2, createdAt: "2026-03-05T10:00:00.000Z" }),
      mark({ id: "c", textId: "t2", start: 1, createdAt: "2026-03-01T10:00:00.000Z" }),
      mark({ id: "d", textId: "t2", start: 2, createdAt: "2026-03-01T10:00:00.000Z" }),
    ],
    TEXTS
  );

  it("corta no meio de um grupo e mantem a contagem dele", () => {
    const limited = limitGroups(groups, 3);
    expect(limited.map((group) => ids(group.items))).toEqual([["a", "b"], ["c"]]);
    expect(limited[1]!.count).toBe(2);
  });

  it("com folga devolve tudo; com zero, nada", () => {
    expect(limitGroups(groups, 10).map((group) => group.items.length)).toEqual([2, 2]);
    expect(limitGroups(groups, 0)).toEqual([]);
  });

  it("grupo que nao coube nem aparece", () => {
    expect(limitGroups(groups, 2).map((group) => group.text.id)).toEqual(["t1"]);
  });
});

describe("rotulos", () => {
  it("contagem da tela, no singular e no plural", () => {
    expect(highlightsLabel(1)).toBe("1 destaque");
    expect(totalLabel(1, 1)).toBe("1 destaque em 1 texto");
    expect(totalLabel(12, 3)).toBe("12 destaques em 3 textos");
    expect(totalLabel(2_000, 12)).toBe("2.000 destaques em 12 textos");
  });

  it("sem busca nem filtro nao ha frase de resultado", () => {
    expect(matchLabel(5, false, "todos")).toBeNull();
  });

  it("com busca, diz quantos corresponderam", () => {
    expect(matchLabel(0, true, "todos")).toBe("Nenhum destaque corresponde à busca.");
    expect(matchLabel(1, true, "todos")).toBe("1 destaque corresponde à busca.");
    expect(matchLabel(3, true, "todos")).toBe("3 destaques correspondem à busca.");
  });

  it("com o filtro de nota, diz quantos tem nota", () => {
    expect(matchLabel(0, false, "com-nota")).toBe("Nenhum destaque com nota.");
    expect(matchLabel(2, false, "com-nota")).toBe("2 destaques com nota.");
    expect(matchLabel(2, true, "com-nota")).toBe("2 destaques com nota correspondem à busca.");
    expect(matchLabel(0, true, "com-nota")).toBe("Nenhum destaque com nota corresponde à busca.");
  });

  it("avisa quando o limite cortou, e so entao", () => {
    expect(truncationNotice(120, 120)).toBeNull();
    expect(truncationNotice(HIGHLIGHT_LIBRARY_LIMIT, 2_345)).toBe(
      "Mostrando os 2.000 mais recentes de 2.345."
    );
  });

  it("o teto da exportacao fica bem acima do da tela", () => {
    expect(HIGHLIGHT_EXPORT_LIMIT).toBeGreaterThanOrEqual(HIGHLIGHT_LIBRARY_LIMIT * 10);
  });
});

describe("dayLabel", () => {
  it("escreve o dia no fuso do leitor", () => {
    // 01h30 UTC ainda e a noite anterior em Sao Paulo.
    expect(dayLabel("2026-03-02T01:30:00.000Z", "America/Sao_Paulo")).toBe("01/03/2026");
    expect(dayLabel("2026-03-02T01:30:00.000Z", "UTC")).toBe("02/03/2026");
    expect(dayLabel(new Date("2026-12-31T23:00:00.000Z"), "UTC")).toBe("31/12/2026");
  });

  it("data ilegivel vira vazio", () => {
    expect(dayLabel("nao e data", "UTC")).toBe("");
  });

  it("fuso desconhecido cai em UTC em vez de lancar", () => {
    expect(dayLabel("2026-03-02T01:30:00.000Z", "Marte/Olimpo")).toBe("02/03/2026");
  });
});

describe("libraryMarkdown", () => {
  const texts: HighlightExportText[] = [
    {
      id: "t1",
      title: "A cabana no inverno",
      author: "Ana Lima",
      sourceUrl: "https://exemplo.com/cabana",
      tags: ["ficção", "inverno"],
      createdAt: "2026-02-20T15:00:00.000Z",
    },
    {
      id: "t2",
      title: "Memória de trabalho",
      author: null,
      sourceUrl: null,
      tags: [],
      createdAt: "2026-03-04T15:00:00.000Z",
    },
  ];
  const items = [
    mark({
      id: "a",
      textId: "t1",
      start: 40,
      excerpt: "segundo trecho",
      createdAt: "2026-03-01T12:00:00.000Z",
    }),
    mark({
      id: "b",
      textId: "t1",
      start: 10,
      excerpt: "primeiro trecho",
      note: "o que eu pensei",
      createdAt: "2026-03-03T12:00:00.000Z",
    }),
    mark({
      id: "c",
      textId: "t2",
      start: 5,
      excerpt: "linha um\nlinha dois",
      note: "nota em\nduas linhas",
      createdAt: "2026-03-05T12:00:00.000Z",
    }),
  ];
  const options = { timezone: "America/Sao_Paulo", now: new Date("2026-03-10T15:00:00.000Z") };

  it("traz os dois textos, cada um com seus dados, trechos e notas", () => {
    expect(libraryMarkdown(texts, items, options)).toBe(
      [
        "# Destaques e notas",
        "",
        "Exportado em 10/03/2026: 3 destaques em 2 textos.",
        "",
        // O texto do destaque mais recente primeiro, como na tela.
        "## Memória de trabalho",
        "",
        // Sem autor, origem nem etiquetas: so as linhas que existem.
        "- Adicionado em: 04/03/2026",
        "- Destacado em: 05/03/2026",
        "",
        "> linha um",
        "> linha dois",
        "",
        "nota em",
        "duas linhas",
        "",
        "## A cabana no inverno",
        "",
        "- Autor: Ana Lima",
        "- Origem: <https://exemplo.com/cabana>",
        "- Etiquetas: ficção, inverno",
        "- Adicionado em: 20/02/2026",
        "- Destacado em: 01/03/2026 a 03/03/2026",
        "",
        // Ordem do texto, nao a da criacao.
        "> primeiro trecho",
        "",
        "o que eu pensei",
        "",
        "> segundo trecho",
        "",
      ].join("\n")
    );
  });

  it("os trechos e as notas saem como na exportacao de um texto", () => {
    const one = toMarkdown(
      { title: "T", sourceUrl: null },
      items
        .filter((item) => item.textId === "t1")
        .map((item) => ({ start: item.start, excerpt: item.excerpt, note: item.note }))
    );
    const body = one.slice("# T\n\n".length);
    expect(body).toBe("> primeiro trecho\n\no que eu pensei\n\n> segundo trecho\n");
    expect(libraryMarkdown(texts, items, options)).toContain(body);
  });

  it("as datas seguem o fuso do leitor", () => {
    const late = [mark({ id: "n", textId: "t2", createdAt: "2026-03-06T01:00:00.000Z" })];
    const out = libraryMarkdown(texts, late, options);
    // 01h UTC do dia 6 ainda e dia 5 em Sao Paulo.
    expect(out).toContain("- Destacado em: 05/03/2026");
  });

  it("avisa no arquivo quando o teto da exportacao cortou", () => {
    const cut = libraryMarkdown(texts, items, { ...options, total: 25_000 });
    expect(cut).toContain("Este arquivo traz os 3 destaques mais recentes de 25.000.");

    const whole = libraryMarkdown(texts, items, { ...options, total: 3 });
    expect(whole).not.toContain("Este arquivo traz");
  });

  it("texto sem destaque nao vira secao", () => {
    const out = libraryMarkdown(texts, [items[2]!], options);
    expect(out).toContain("## Memória de trabalho");
    expect(out).not.toContain("## A cabana no inverno");
    expect(out).toContain("1 destaque em 1 texto.");
  });

  it("sem destaque nenhum, diz isso", () => {
    expect(libraryMarkdown([], [], options)).toBe("# Destaques e notas\n\n_Nenhum destaque._\n");
  });
});

describe("libraryExportFileName", () => {
  it("leva o dia do fuso do leitor", () => {
    const now = new Date("2026-11-15T01:00:00.000Z");
    expect(libraryExportFileName("America/Sao_Paulo", now)).toBe("destaques-2026-11-14.md");
    expect(libraryExportFileName("UTC", now)).toBe("destaques-2026-11-15.md");
  });

  it("fuso desconhecido usa o dia em UTC", () => {
    const now = new Date("2026-11-15T01:00:00.000Z");
    expect(libraryExportFileName("Marte/Olimpo", now)).toBe("destaques-2026-11-15.md");
  });
});
