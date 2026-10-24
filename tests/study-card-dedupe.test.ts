import { describe, expect, it } from "vitest";
import { dedupeByFront, storedFrontKey } from "@/lib/study-card-drafts";

describe("cartoes de estudo sem repeticao (US-197)", () => {
  it("a chave ignora caixa, acento e pontuacao", () => {
    expect(storedFrontKey("O que é Fotossíntese?")).toBe(storedFrontKey("o que e fotossintese"));
    expect(storedFrontKey("?!")).toBeNull();
  });

  it("descarta a frente ja salva e a repetida no mesmo lote", () => {
    const saved = [storedFrontKey("Qual a capital?")!];
    const { fresh, repeated } = dedupeByFront(
      [{ front: "Qual a capital?" }, { front: "Quem escreveu?" }, { front: "quem ESCREVEU" }, { front: "Onde?" }],
      saved
    );
    expect(fresh.map((card) => card.front)).toEqual(["Quem escreveu?", "Onde?"]);
    expect(repeated).toBe(2);
  });

  it("frente sem nada comparavel nao e tratada como repetida", () => {
    expect(dedupeByFront([{ front: "??" }, { front: "??" }], []).fresh).toHaveLength(2);
  });
});
