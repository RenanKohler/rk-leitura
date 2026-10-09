import { describe, expect, it } from "vitest";
import {
  cardsPrompt,
  cleanCards,
  MAX_CARD_PROMPT_CHARS,
  MAX_CARDS,
  parseCardEdits,
} from "@/lib/highlight-cards";

const item = (id: string, start: number, excerpt: string, note: string | null = null) => ({
  id,
  start,
  excerpt,
  note,
});

describe("cardsPrompt", () => {
  it("numera os destaques na ordem da leitura, com a nota, e so eles", () => {
    const { prompt, ids, words } = cardsPrompt("Conto", [
      item("b", 50, "o barco balancou", "medo"),
      item("a", 10, "a pescadora saiu cedo"),
    ]);
    expect(ids).toEqual(["a", "b"]);
    expect(prompt).toContain("Texto: Conto");
    expect(prompt).toContain("[1] a pescadora saiu cedo");
    expect(prompt).toContain("[2] o barco balancou\nNota do leitor: medo");
    // Palavras do leitor enviadas: trechos e notas.
    expect(words).toBe(4 + 3 + 1);
  });

  it("manda no maximo 20 destaques", () => {
    const many = Array.from({ length: 30 }, (_, index) => item(`h${index}`, index, `trecho ${index}`));
    const { ids, prompt } = cardsPrompt("Longo", many);
    expect(ids).toHaveLength(MAX_CARDS);
    expect(prompt).not.toContain("[21]");
  });
});

describe("cleanCards", () => {
  const ids = ["a", "b", "c"];

  it("liga cada cartao ao destaque pelo numero e descarta o que nao serve", () => {
    const cards = cleanCards(
      {
        cards: [
          { highlight: 2, prompt: " O que balancou? ", answer: "O barco." },
          { highlight: 2, prompt: "Repetido", answer: "Fica de fora." },
          { highlight: 9, prompt: "Fora da faixa", answer: "x" },
          { highlight: 1, prompt: "", answer: "Sem pergunta" },
          { highlight: 3, prompt: "Quem saiu cedo?", answer: "A pescadora." },
          "lixo",
        ],
      },
      ids
    );
    expect(cards).toEqual([
      { highlightId: "b", prompt: "O que balancou?", answer: "O barco." },
      { highlightId: "c", prompt: "Quem saiu cedo?", answer: "A pescadora." },
    ]);
  });

  it("corta textos longos e aguenta resposta malformada", () => {
    const [card] = cleanCards(
      { cards: [{ highlight: 1, prompt: "x".repeat(1000), answer: "y" }] },
      ids
    );
    expect(card!.prompt.length).toBeLessThanOrEqual(MAX_CARD_PROMPT_CHARS);
    expect(cleanCards(null, ids)).toEqual([]);
    expect(cleanCards({ cards: "nada" }, ids)).toEqual([]);
  });
});

describe("parseCardEdits", () => {
  it("aceita os cartoes revisados e ignora destaque repetido", () => {
    expect(
      parseCardEdits([
        { highlightId: "a", prompt: "P", answer: "R" },
        { highlightId: "a", prompt: "P2", answer: "R2" },
      ])
    ).toEqual([{ highlightId: "a", prompt: "P", answer: "R" }]);
  });

  it("recusa lista vazia, cartao pela metade ou lista grande demais", () => {
    expect(parseCardEdits([])).toBeNull();
    expect(parseCardEdits([{ highlightId: "a", prompt: " ", answer: "R" }])).toBeNull();
    expect(parseCardEdits([{ prompt: "P", answer: "R" }])).toBeNull();
    expect(
      parseCardEdits(
        Array.from({ length: MAX_CARDS + 1 }, (_, index) => ({
          highlightId: `h${index}`,
          prompt: "P",
          answer: "R",
        }))
      )
    ).toBeNull();
    expect(parseCardEdits("x")).toBeNull();
  });
});
