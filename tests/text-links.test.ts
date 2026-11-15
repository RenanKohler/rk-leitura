import { describe, expect, it } from "vitest";
import { parseParagraphs } from "@/lib/reading";
import {
  candidateLabel,
  characteristicTerms,
  charsPerCandidate,
  cleanRelation,
  CANDIDATE_CHARS,
  linksKey,
  linksMessage,
  MAX_CANDIDATES,
  MAX_CHARS_PER_CANDIDATE,
  MAX_LINKS,
  parseStoredLinks,
  pickParagraphs,
  rankCandidates,
  termKey,
  validLinks,
  type LibraryRow,
  type SourceText,
} from "@/lib/text-links";

/** Ligacoes entre textos (US-232): as partes puras. */

describe("characteristicTerms", () => {
  it("conta palavras frequentes sem stopwords, numeros nem palavras curtas", () => {
    const words =
      "A fotossíntese ocorre nas folhas. Fotossíntese precisa de clorofila; a clorofila absorve luz. Também sobre isso, 12345 12345 porque porque casa casa".split(
        " "
      );
    const terms = characteristicTerms(words);
    expect(terms.map((term) => term.term)).toEqual(["clorofila", "fotossintese"]);
    expect(terms[0]!.count).toBe(2);
  });

  it("respeita o teto e desempata pela ordem alfabetica", () => {
    const words = ["zebras", "zebras", "abacate", "abacate", "melancia", "melancia", "melancia"];
    expect(characteristicTerms(words, 2).map((term) => term.term)).toEqual(["melancia", "abacate"]);
  });

  it("dobra acento e maiuscula como a busca do banco", () => {
    expect(termKey("Atenção,")).toBe("atencao");
  });
});

const row = (id: string, hits: boolean[], extra: Partial<LibraryRow> = {}): LibraryRow => ({
  id,
  title: `Texto ${id}`,
  updatedAt: "2026-11-01T00:00:00.000Z",
  seriesKey: null,
  chapter: null,
  hits,
  ...extra,
});

describe("rankCandidates", () => {
  const terms = [
    { term: "clorofila", count: 6 },
    { term: "fotossintese", count: 4 },
    { term: "planta", count: 2 },
  ];

  it("pede pelo menos 2 termos em comum", () => {
    const ranked = rankCandidates([row("a", [true, false, false]), row("b", [true, true, false])], terms);
    expect(ranked.map((candidate) => candidate.id)).toEqual(["b"]);
    expect(ranked[0]!.shared).toEqual(["clorofila", "fotossintese"]);
  });

  it("termo raro na biblioteca pesa mais que termo comum", () => {
    const rows = [
      row("comum", [false, true, true]),
      row("raro", [true, true, false]),
      ...Array.from({ length: 6 }, (_, index) => row(`outro${index}`, [false, false, true])),
    ];
    expect(rankCandidates(rows, terms)[0]!.id).toBe("raro");
  });

  it("no maximo 6 candidatos, e nada sem linhas ou termos", () => {
    const rows = Array.from({ length: 10 }, (_, index) => row(`t${index}`, [true, true, true]));
    // Um termo em todos os textos nao separa: os de fora valem algo.
    rows.push(...Array.from({ length: 10 }, (_, index) => row(`x${index}`, [false, false, false])));
    expect(rankCandidates(rows, terms)).toHaveLength(MAX_CANDIDATES);
    expect(rankCandidates([], terms)).toEqual([]);
    expect(rankCandidates(rows, [])).toEqual([]);
  });
});

describe("linksKey", () => {
  const base = [
    { id: "b", updatedAt: "2026-11-01T00:00:00.000Z" },
    { id: "a", updatedAt: "2026-11-02T00:00:00.000Z" },
  ];

  it("nao depende da ordem dos candidatos", () => {
    expect(linksKey("t", "10-abc", base)).toBe(linksKey("t", "10-abc", [...base].reverse()));
  });

  it("muda com o texto, com um candidato editado e com outro candidato", () => {
    const key = linksKey("t", "10-abc", base);
    expect(linksKey("t", "11-abd", base)).not.toBe(key);
    expect(linksKey("t", "10-abc", [base[0]!, { id: "a", updatedAt: "2026-11-03T00:00:00.000Z" }])).not.toBe(key);
    expect(linksKey("t", "10-abc", [...base, { id: "c", updatedAt: base[0]!.updatedAt }])).not.toBe(key);
  });
});

describe("pickParagraphs", () => {
  const content = [
    "Um paragrafo qualquer sem nada.",
    "A clorofila absorve luz.",
    "Na fotossintese a clorofila das plantas trabalha.",
    "Outra frase sobre clorofilas verdes.",
  ].join("\n");
  const { paragraphs } = parseParagraphs(content);

  it("prefere paragrafos com mais termos (empate: o primeiro) e devolve na ordem do texto", () => {
    const blocks = pickParagraphs(paragraphs, ["clorofila", "fotossintese"], 80);
    expect(blocks.map((block) => block.text)).toEqual([
      "A clorofila absorve luz.",
      "Na fotossintese a clorofila das plantas trabalha.",
    ]);
    expect(blocks[1]!.start).toBe(paragraphs[2]!.start);
    expect(blocks[1]!.end).toBe(paragraphs[2]!.start + paragraphs[2]!.words.length);
  });

  it("deixa de fora paragrafo sem termo e corta o primeiro maior que o teto", () => {
    const blocks = pickParagraphs(paragraphs, ["fotossintese"], 20);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.text.length).toBeLessThanOrEqual(20);
    expect(blocks[0]!.text.startsWith("Na fotossintese")).toBe(true);
    expect(pickParagraphs(paragraphs, [], 1000)).toEqual([]);
  });
});

describe("charsPerCandidate", () => {
  it("reparte o total com teto por candidato", () => {
    expect(charsPerCandidate(1)).toBe(MAX_CHARS_PER_CANDIDATE);
    expect(charsPerCandidate(6)).toBe(Math.floor(CANDIDATE_CHARS / 6));
    expect(charsPerCandidate(0)).toBe(0);
  });
});

function source(id: string, title: string, content: string, extra: Partial<SourceText> = {}): SourceText {
  const { words, paragraphs } = parseParagraphs(content);
  return {
    id,
    title,
    words,
    blocks: paragraphs.map((p) => ({ start: p.start, end: p.start + p.words.length, text: p.words.join(" ") })),
    ...extra,
  };
}

const here = source(
  "aqui",
  "Fotossintese",
  "Introducao solta.\nA clorofila absorve a luz vermelha e azul do sol.\nO resto do texto."
);
// So o segundo paragrafo foi enviado.
here.blocks = [here.blocks[1]!];
const other = source(
  "outro",
  "Plantas de sombra",
  "Nas plantas de sombra a clorofila b aumenta para captar luz difusa.\nFim.",
  { sameSeries: true, chapter: 2 }
);

describe("linksMessage", () => {
  it("rotula os candidatos e marca a mesma serie", () => {
    const message = linksMessage(here, [other]);
    expect(message).toContain("ESTE TEXTO — Título: Fotossintese");
    expect(message).toContain("A clorofila absorve a luz vermelha");
    expect(message).not.toContain("Introducao solta");
    expect(message).toContain(`--- ${candidateLabel(0)} — Título: Plantas de sombra (mesma série deste texto, capítulo 2)`);
  });
});

describe("validLinks", () => {
  const good = {
    label: "T1",
    relation: "Complementa com o caso das plantas de sombra.",
    quoteHere: "A clorofila absorve a luz vermelha",
    quoteOther: "a clorofila b aumenta para captar luz difusa",
  };

  it("guarda a ligacao com as duas citacoes conferidas e as posicoes", () => {
    const [link] = validLinks({ links: [good] }, here, [other]);
    expect(link).toMatchObject({
      textId: "outro",
      title: "Plantas de sombra",
      relation: good.relation,
      sameSeries: true,
    });
    expect(link!.here.quote).toBe("A clorofila absorve a luz vermelha");
    expect(link!.here.start).toBe(2);
    expect(link!.other.quote).toBe("a clorofila b aumenta para captar luz difusa.");
    expect(link!.other.start).toBe(4);
  });

  it("descarta citacao fora do trecho enviado, inventada, rotulo errado ou relacao vazia", () => {
    const links = validLinks(
      [
        { ...good, quoteHere: "Introducao solta e mais" },
        { ...good, quoteOther: "a clorofila c diminui sempre muito" },
        { ...good, label: "T9" },
        { ...good, relation: "   " },
        { ...good, relation: "x".repeat(500) },
        null,
      ],
      here,
      [other]
    );
    expect(links).toEqual([]);
  });

  it("aceita o rotulo em minusculas e conta uma vez a mesma citacao do outro", () => {
    const links = validLinks([{ ...good, label: "t1" }, good], here, [other]);
    expect(links).toHaveLength(1);
  });

  it("no maximo 5 ligacoes", () => {
    const many = source(
      "muitos",
      "Muitos",
      Array.from({ length: 8 }, (_, index) => `Paragrafo ${index} fala da clorofila numero ${index} aqui`).join("\n")
    );
    const raw = Array.from({ length: 8 }, (_, index) => ({
      ...good,
      quoteOther: `fala da clorofila numero ${index}`,
    }));
    expect(validLinks(raw, here, [many])).toHaveLength(MAX_LINKS);
  });
});

describe("cleanRelation e parseStoredLinks", () => {
  it("limpa espacos e recusa o que nao e uma frase curta", () => {
    expect(cleanRelation("  Contradiz   a ideia. ")).toBe("Contradiz a ideia.");
    expect(cleanRelation(3)).toBe("");
  });

  it("le o que foi guardado e recusa formato estranho", () => {
    const [link] = validLinks(
      [
        {
          label: "T1",
          relation: "Complementa.",
          quoteHere: "A clorofila absorve a luz vermelha",
          quoteOther: "a clorofila b aumenta para captar luz difusa",
        },
      ],
      here,
      [other]
    );
    expect(parseStoredLinks({ links: [link] })).toEqual({ links: [link] });
    expect(parseStoredLinks({ links: [] })).toEqual({ links: [] });
    expect(parseStoredLinks({ links: [{ textId: "x" }] })).toBeNull();
    expect(parseStoredLinks(null)).toBeNull();
  });
});
