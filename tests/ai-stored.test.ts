import { describe, expect, it } from "vitest";
import { keptEditedNotice, keepsEditedNotice, storedBreakdown, storedTotal } from "@/lib/ai-stored";

const empty = {
  resultados: 0,
  perguntas: 0,
  cartoes: 0,
  analogias: 0,
  cartoesDestaque: 0,
  questionarios: 0,
  cartoesEditados: 0,
};

describe("o que a IA gerou no estudo (US-193)", () => {
  it("a contagem inclui cartoes, analogias, cartoes de destaque e questionarios", () => {
    const counts = { ...empty, resultados: 2, cartoes: 5, analogias: 1, cartoesDestaque: 3, questionarios: 2 };
    expect(storedTotal(counts)).toBe(13);
  });

  it("cartoes editados ficam fora da conta do que sai", () => {
    expect(storedTotal({ ...empty, cartoes: 2, cartoesEditados: 4 })).toBe(2);
  });

  it("a confirmacao lista so os tipos com itens", () => {
    expect(storedBreakdown({ ...empty, cartoes: 1, questionarios: 2 })).toBe("1 cartão de estudo, 2 questionários");
    expect(storedBreakdown(empty)).toBe("");
  });

  it("avisa quantos cartoes editados foram mantidos", () => {
    expect(keptEditedNotice(0)).toBeNull();
    expect(keptEditedNotice(1)).toBe("1 cartão editado por você foi mantido.");
    expect(keptEditedNotice(3)).toBe("3 cartões editados por você foram mantidos.");
    expect(keepsEditedNotice(2)).toBe("2 cartões editados por você ficam.");
  });
});
