import { describe, expect, it } from "vitest";
import { emphasisLength, splitEmphasis } from "@/lib/reading";

describe("emphasisLength", () => {
  it("enfatiza cerca de metade das letras", () => {
    expect(emphasisLength("leitura")).toBe(4);
    expect(emphasisLength("palavra")).toBe(4);
    expect(emphasisLength("casa")).toBe(2);
  });

  it("palavras muito curtas recebem so a primeira letra", () => {
    expect(emphasisLength("de")).toBe(1);
    expect(emphasisLength("uma")).toBe(1);
  });

  it("uma letra so continua uma letra", () => {
    expect(emphasisLength("a")).toBe(1);
  });

  it("pontuacao nao conta como letra", () => {
    expect(emphasisLength("casa.")).toBe(emphasisLength("casa"));
    expect(emphasisLength("—")).toBe(0);
  });
});

describe("splitEmphasis", () => {
  it("desligada, devolve a palavra inteira sem negrito", () => {
    expect(splitEmphasis("leitura", false)).toEqual([{ text: "leitura", bold: false }]);
  });

  it("divide em inicio enfatizado e resto", () => {
    expect(splitEmphasis("leitura", true)).toEqual([
      { text: "leit", bold: true },
      { text: "ura", bold: false },
    ]);
  });

  it("nao perde nem duplica caractere", () => {
    for (const word of ["leitura", "a", "de", "casa.", "“aspas”", "co-autor", "2026"]) {
      expect(splitEmphasis(word, true).map((part) => part.text).join("")).toBe(word);
    }
  });

  it("pontuacao inicial nao consome a enfase", () => {
    const partes = splitEmphasis("“casa”", true);
    expect(partes[0]!.text).toBe("“ca");
    expect(partes[0]!.bold).toBe(true);
  });

  it("o que nao tem letra fica sem negrito", () => {
    expect(splitEmphasis("—", true)).toEqual([{ text: "—", bold: false }]);
  });

  it("palavra toda enfatizada nao gera parte vazia", () => {
    expect(splitEmphasis("a", true)).toEqual([{ text: "a", bold: true }]);
  });
});
