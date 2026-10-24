import { describe, expect, it } from "vitest";
import { relocateDrafts, type SavedDraft } from "@/lib/study-card-drafts";
import { cardAfterRewrite, isUneditedGenerated, remapCard } from "@/lib/study-cards";
import { alignRemoval, forwardMap, inverseMap, mapSpan, unmapSpan } from "@/lib/reindex";

const words = (text: string) => text.split(" ");

describe("cartoes no reprocessamento (US-192)", () => {
  // Omitir "[1]" desloca tudo o que vem depois uma palavra para tras.
  const before = words("O rio [1] nasce na serra e desce ao mar");
  const after = words("O rio nasce na serra e desce ao mar");
  const matched = alignRemoval(before, after)!;
  const toNew = forwardMap(before.length, matched);
  const span = (value: { start: number; end: number }) => mapSpan(value, toNew);

  it("move o trecho de origem como o destaque", () => {
    const card = { kind: "conceito", sourceStart: 3, sourceEnd: 5, editedAt: null };
    expect(remapCard(card, span)).toEqual({ action: "mover", start: 2, end: 4 });
  });

  it("cartao sem trecho (feito a mao) fica como esta", () => {
    expect(remapCard({ kind: "manual", sourceStart: 0, sourceEnd: 0, editedAt: null }, span)).toEqual({
      action: "manter",
    });
  });

  it("trecho que sumiu: gerado sai, editado fica marcado", () => {
    const gone = () => null;
    expect(remapCard({ kind: "ponto", sourceStart: 2, sourceEnd: 3, editedAt: null }, gone)).toEqual({
      action: "apagar",
    });
    expect(
      remapCard({ kind: "ponto", sourceStart: 2, sourceEnd: 3, editedAt: new Date() }, gone)
    ).toEqual({ action: "marcar" });
  });

  it("restaurar as referencias devolve o cartao para a posicao original", () => {
    const inverse = inverseMap(matched, before.length);
    const back = (value: { start: number; end: number }) => unmapSpan(value, inverse);
    expect(remapCard({ kind: "lacuna", sourceStart: 2, sourceEnd: 4, editedAt: null }, back)).toEqual({
      action: "mover",
      start: 3,
      end: 5,
    });
  });
});

describe("cartoes no conteudo reescrito (US-192)", () => {
  it("gerados pela IA saem; feitos a mao e editados ficam marcados", () => {
    expect(cardAfterRewrite({ kind: "conceito", editedAt: null })).toBe("apagar");
    expect(cardAfterRewrite({ kind: "glossario", editedAt: null })).toBe("apagar");
    expect(cardAfterRewrite({ kind: "trecho", editedAt: null })).toBe("apagar");
    expect(cardAfterRewrite({ kind: "manual", editedAt: null })).toBe("marcar");
    expect(cardAfterRewrite({ kind: "conceito", editedAt: "2026-10-01T00:00:00Z" })).toBe("marcar");
    expect(isUneditedGenerated({ kind: "manual", editedAt: null })).toBe(false);
  });
});

describe("relocalizar ao salvar (US-192)", () => {
  const draft = (passage: string | undefined, start: number, end: number): SavedDraft => ({
    front: "Frente",
    back: "Verso",
    kind: "conceito",
    sourceStart: start,
    sourceEnd: end,
    ...(passage ? { passage } : {}),
  });

  it("acha o trecho na posicao nova quando o conteudo mudou", () => {
    const now = words("Uma frase nova no inicio. O rio nasce na serra alta e desce ao mar.");
    const { kept, dropped } = relocateDrafts([draft("O rio nasce na serra alta", 0, 6)], now);
    expect(dropped).toBe(0);
    expect(kept[0]).toMatchObject({ sourceStart: 5, sourceEnd: 11 });
  });

  it("descarta o cartao cujo trecho nao existe mais", () => {
    const now = words("Outro texto inteiramente diferente sem o trecho de antes.");
    const { kept, dropped } = relocateDrafts([draft("O rio nasce na serra alta", 0, 6)], now);
    expect(kept).toEqual([]);
    expect(dropped).toBe(1);
  });

  it("sem trecho informado mantem a posicao, se couber no texto", () => {
    const now = words("um dois tres quatro");
    expect(relocateDrafts([draft(undefined, 0, 3)], now).kept).toHaveLength(1);
    expect(relocateDrafts([draft(undefined, 0, 9)], now).kept).toHaveLength(0);
  });
});
