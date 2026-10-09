import { describe, expect, it } from "vitest";
import { parseDistractors, parseEntry } from "@/lib/dictionary";
import { definitionChoices, markWord } from "@/lib/word-choices";

describe("parseDistractors (US-151)", () => {
  it("aceita tres alternativas diferentes entre si e da correta", () => {
    expect(parseDistractors(["Uma.", "Duas.", "Tres."], "Certa.")).toEqual([
      "Uma.",
      "Duas.",
      "Tres.",
    ]);
  });

  it("descarta repetidas e a igual a correta; menos de tres vira null", () => {
    expect(parseDistractors(["Uma.", "uma", "Certa", "Duas."], "Certa.")).toBeNull();
    expect(parseDistractors(["Uma.", "uma", "Certa", "Duas.", "Tres."], "Certa.")).toEqual([
      "Uma.",
      "Duas.",
      "Tres.",
    ]);
    expect(parseDistractors("Uma", "Certa")).toBeNull();
    expect(parseDistractors(["", "  ", 3], "Certa")).toBeNull();
  });

  it("entra na leitura da consulta so quando valido", () => {
    expect(parseEntry({ definition: "Certa." }, "x")).not.toHaveProperty("distractors");
    expect(
      parseEntry({ definition: "Certa.", distractors: ["A.", "B.", "C."] }, "x")?.distractors
    ).toEqual(["A.", "B.", "C."]);
  });
});

describe("definitionChoices", () => {
  const distractors = ["Ficar parado.", "Correr em circulos.", "Voltar para casa."];

  it("mistura as quatro e aponta a correta", () => {
    const result = definitionChoices("Andar de um lado a outro.", distractors, "id-1")!;
    expect(result.choices).toHaveLength(4);
    expect([...result.choices].sort()).toEqual(
      ["Andar de um lado a outro.", ...distractors].sort()
    );
    expect(result.choices[result.answer]).toBe("Andar de um lado a outro.");
  });

  it("a mesma semente da a mesma ordem; outras sementes variam a posicao", () => {
    const first = definitionChoices("Certa.", distractors, "palavra-1");
    expect(definitionChoices("Certa.", distractors, "palavra-1")).toEqual(first);
    const positions = new Set(
      Array.from(
        { length: 40 },
        (_, index) => definitionChoices("Certa.", distractors, `p${index}`)!.answer
      )
    );
    expect(positions.size).toBeGreaterThan(1);
  });

  it("sem alternativas ou sem definicao, a revisao e a de sempre", () => {
    expect(definitionChoices("Certa.", null, "x")).toBeNull();
    expect(definitionChoices("Certa.", ["A.", "B."], "x")).toBeNull();
    expect(definitionChoices("  ", distractors, "x")).toBeNull();
  });
});

describe("markWord", () => {
  it("marca a palavra inteira, sem acento nem caixa", () => {
    expect(markWord("Carregava uma rede remendada.", "remendada")).toEqual({
      before: "Carregava uma rede ",
      match: "remendada",
      after: ".",
    });
    expect(markWord("A Ação começou", "acao")?.match).toBe("Ação");
  });

  it("nao casa pedaco de palavra e devolve null sem ela", () => {
    expect(markWord("As redes secavam", "rede")).toBeNull();
    expect(markWord("", "rede")).toBeNull();
  });
});
