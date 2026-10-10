import { describe, expect, it } from "vitest";
import {
  CARD_EMPTY_MESSAGE,
  CARD_TOO_LONG_MESSAGE,
  cleanGeneratedCards,
  clozeSentence,
  frontKey,
  locatePassage,
  manualCard,
  MAX_EXISTING_FRONTS,
  MAX_GENERATED_CARDS,
  parseDraftEdits,
  passageIndex,
  pretestSummary,
  studyCardsPrompt,
} from "@/lib/study-card-drafts";
import { parseParagraphs } from "@/lib/reading";
import { splitByReading } from "@/lib/study-cards";

const CONTENT = [
  "A fotossíntese é o processo pelo qual as plantas transformam luz em energia química.",
  "Ela acontece nos cloroplastos, que guardam a clorofila.",
  "",
  "No fim do texto, o autor defende que florestas antigas armazenam mais carbono que as jovens.",
].join("\n");

const { words } = parseParagraphs(CONTENT);
const index = passageIndex(words);

describe("trecho de origem", () => {
  it("acha o trecho em indices de palavra, ignorando caixa, acento e pontuacao", () => {
    const span = locatePassage(index, "ela acontece nos cloroplastos");
    expect(span).toEqual({ start: 14, end: 18 });
    expect(words.slice(span!.start, span!.end).join(" ")).toBe("Ela acontece nos cloroplastos,");
    expect(locatePassage(index, "“A FOTOSSINTESE é o processo”")).toEqual({ start: 0, end: 5 });
  });

  it("recusa trecho que nao esta no texto, com reticencias ou curto demais", () => {
    expect(locatePassage(index, "as plantas transformam agua em energia")).toBeNull();
    expect(locatePassage(index, "A fotossíntese ... energia química")).toBeNull();
    expect(locatePassage(index, "as plantas")).toBeNull();
  });

  it("no markdown, o indice e o mesmo da leitura", () => {
    const md = "# Título\n\nUm **termo importante** aparece aqui no texto.";
    const parsed = parseParagraphs(md, "markdown");
    const span = locatePassage(passageIndex(parsed.words), "termo importante aparece aqui");
    expect(span).not.toBeNull();
    expect(parsed.words.slice(span!.start, span!.end)).toEqual(["termo", "importante", "aparece", "aqui"]);
  });
});

describe("lacuna", () => {
  it("monta a frase com o termo no lugar da lacuna", () => {
    expect(clozeSentence("Ela acontece nos ____, que guardam a clorofila.", "cloroplastos")).toBe(
      "Ela acontece nos cloroplastos, que guardam a clorofila."
    );
  });

  it("exige exatamente uma lacuna e um termo", () => {
    expect(clozeSentence("Sem lacuna nenhuma.", "termo")).toBeNull();
    expect(clozeSentence("____ e ____.", "termo")).toBeNull();
    expect(clozeSentence("Uma ____ aqui.", "  ")).toBeNull();
  });
});

describe("resposta do modelo", () => {
  const raw = {
    cards: [
      {
        front: "Onde acontece a fotossíntese?",
        back: "Nos cloroplastos.",
        kind: "ponto",
        passage: "Ela acontece nos cloroplastos, que guardam a clorofila.",
      },
      {
        front: "O que é fotossíntese?",
        back: "Transformar luz em energia química.",
        kind: "conceito",
        passage: "A fotossíntese é o processo pelo qual as plantas transformam luz",
      },
      // Trecho inventado: descartado.
      { front: "Pergunta falsa?", back: "Resposta.", kind: "ponto", passage: "isto nao esta no texto" },
      // Tipo invalido: descartado.
      { front: "Outra?", back: "Sim.", kind: "lacuna", passage: "que guardam a clorofila" },
      // Repetida (mesma frente com outra pontuacao): descartada.
      { front: "onde acontece a fotossintese", back: "Ali.", kind: "ponto", passage: "que guardam a clorofila" },
    ],
  };

  it("mantem so os validos, na ordem do texto, com a posicao", () => {
    const cards = cleanGeneratedCards(raw, index, "pergunta");
    expect(cards.map((card) => card.front)).toEqual(["O que é fotossíntese?", "Onde acontece a fotossíntese?"]);
    expect(cards[0]).toMatchObject({ kind: "conceito", sourceStart: 0, sourceEnd: 11 });
    expect(cards[1]).toMatchObject({ kind: "ponto", sourceStart: 14, sourceEnd: 22 });
  });

  it("nao repete cartoes ja salvos", () => {
    const cards = cleanGeneratedCards(raw, index, "pergunta", ["O QUE É FOTOSSÍNTESE"]);
    expect(cards.map((card) => card.front)).toEqual(["Onde acontece a fotossíntese?"]);
  });

  it("lacuna: a frase sem a lacuna precisa estar no texto", () => {
    const cards = cleanGeneratedCards(
      {
        cards: [
          { front: "Ela acontece nos ___, que guardam a clorofila.", back: "cloroplastos" },
          { front: "Ela acontece nas ____ verdes.", back: "folhas" },
          { front: "Sem lacuna nos cloroplastos.", back: "x" },
        ],
      },
      index,
      "lacuna"
    );
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      front: "Ela acontece nos ____, que guardam a clorofila.",
      back: "cloroplastos",
      kind: "lacuna",
      sourceStart: 14,
      sourceEnd: 22,
    });
  });

  it("limita a quantidade e aceita resposta vazia", () => {
    const many = {
      cards: Array.from({ length: 40 }, (_, n) => ({
        front: `Pergunta ${n}?`,
        back: "Resposta.",
        kind: "ponto",
        passage: "que guardam a clorofila",
      })),
    };
    expect(cleanGeneratedCards(many, index, "pergunta")).toHaveLength(MAX_GENERATED_CARDS);
    expect(cleanGeneratedCards(null, index, "pergunta")).toEqual([]);
  });
});

describe("regra de exibicao dos cartoes gerados", () => {
  it("cartao de trecho nao lido nunca aparece fora do teste previo", () => {
    const cards = cleanGeneratedCards(
      {
        cards: [
          { front: "Início?", back: "a", kind: "ponto", passage: "A fotossíntese é o processo" },
          {
            front: "Fim?",
            back: "b",
            kind: "ponto",
            passage: "florestas antigas armazenam mais carbono",
          },
        ],
      },
      index,
      "pergunta"
    );
    // Leitura parada no fim do primeiro paragrafo.
    const { read, unread } = splitByReading(cards, { progressIndex: 22, wordCount: words.length });
    expect(read.map((card) => card.front)).toEqual(["Início?"]);
    expect(unread.map((card) => card.front)).toEqual(["Fim?"]);
    // Texto concluido: todos aparecem.
    const done = splitByReading(cards, { progressIndex: words.length - 1, wordCount: words.length });
    expect(done.unread).toEqual([]);
  });

  it("cartao a mao (0 a 0) aparece sempre", () => {
    const { read } = splitByReading([{ sourceEnd: 0 }], { progressIndex: 0, wordCount: 1000 });
    expect(read).toHaveLength(1);
  });
});

describe("salvar os cartoes revisados", () => {
  const card = { front: "F?", back: "V.", kind: "ponto", sourceStart: 0, sourceEnd: 5 };

  it("aceita o lote valido", () => {
    expect(parseDraftEdits([card], 100)).toEqual([card]);
  });

  it("recusa o lote com item invalido", () => {
    expect(parseDraftEdits([], 100)).toBeNull();
    expect(parseDraftEdits([{ ...card, front: " " }], 100)).toBeNull();
    expect(parseDraftEdits([{ ...card, kind: "manual" }], 100)).toBeNull();
    expect(parseDraftEdits([{ ...card, sourceEnd: 101 }], 100)).toBeNull();
    expect(parseDraftEdits([{ ...card, sourceStart: 5 }], 100)).toBeNull();
    expect(parseDraftEdits([{ ...card, kind: "lacuna" }], 100)).toBeNull();
    expect(parseDraftEdits([{ ...card, kind: "lacuna", front: "Uma ___ aqui." }], 100)).toEqual([
      { ...card, kind: "lacuna", front: "Uma ____ aqui." },
    ]);
  });
});

describe("cartao a mao", () => {
  it("valida frente e verso com as mensagens da tela", () => {
    expect(manualCard("  Frente ", "Verso")).toEqual({ front: "Frente", back: "Verso" });
    expect(manualCard("", "Verso")).toEqual({ error: CARD_EMPTY_MESSAGE });
    expect(manualCard("Frente", undefined)).toEqual({ error: CARD_EMPTY_MESSAGE });
    expect(manualCard("a".repeat(501), "Verso")).toEqual({ error: CARD_TOO_LONG_MESSAGE });
    expect(CARD_EMPTY_MESSAGE).toBe("Preencha a frente e o verso.");
    expect(CARD_TOO_LONG_MESSAGE).toBe("Use até 500 caracteres em cada lado.");
  });
});

describe("conhecimento previo", () => {
  it("resume em numero e porcentagem", () => {
    expect(pretestSummary(["sabia", "nao_sabia", "sabia"])).toEqual({ known: 2, total: 3, percent: 67 });
    expect(pretestSummary([])).toEqual({ known: 0, total: 0, percent: 0 });
  });
});

describe("pedido ao modelo", () => {
  it("leva as frentes ja salvas para nao repetir", () => {
    const fronts = Array.from({ length: MAX_EXISTING_FRONTS + 5 }, (_, n) => `Frente ${n}`);
    const prompt = studyCardsPrompt({ title: "T", text: "corpo", sampled: 0, mode: "pergunta", existingFronts: fronts });
    expect(prompt).toContain("- Frente 0");
    expect(prompt).not.toContain(`- Frente ${MAX_EXISTING_FRONTS}`);
    expect(prompt).toContain("Texto:\ncorpo");
  });

  it("lacuna pede a frase com a marca", () => {
    const prompt = studyCardsPrompt({ title: "T", text: "x", sampled: 6, mode: "lacuna", existingFronts: [] });
    expect(prompt).toContain("____");
    expect(prompt).toContain("6 trechos");
    expect(prompt).not.toContain("já tem estes cartões");
  });

  it("chave da frente ignora caixa, acento e pontuacao", () => {
    expect(frontKey("O que é?")).toBe(frontKey("o QUE e"));
  });
});
