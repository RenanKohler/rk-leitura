import { describe, expect, it } from "vitest";
import {
  batchItemEntry,
  batchStartNotice,
  isPendingDefinition,
  type BatchItemLike,
} from "@/lib/definition-batch";

function succeeded(text: string, stop_reason = "end_turn"): BatchItemLike {
  return {
    custom_id: "w1",
    result: { type: "succeeded", message: { stop_reason, content: [{ type: "text", text }] } },
  };
}

const json = JSON.stringify({
  base: "percorrer",
  kind: "verbo",
  definition: "Andar de um lado a outro.",
  translation: "",
});

describe("isPendingDefinition (US-139)", () => {
  it("so a definicao vazia conta como pendente", () => {
    expect(isPendingDefinition("")).toBe(true);
    expect(isPendingDefinition("   ")).toBe(true);
    expect(isPendingDefinition("algo")).toBe(false);
  });
});

describe("batchItemEntry (US-139)", () => {
  it("le a definicao de um item que deu certo", () => {
    expect(batchItemEntry(succeeded(json), "percorreram", "pt-BR")).toEqual({
      word: "percorreram",
      base: "percorrer",
      kind: "verbo",
      definition: "Andar de um lado a outro.",
      translation: null,
    });
  });

  it("guarda a traducao em palavra de outro idioma", () => {
    const entry = batchItemEntry(
      succeeded(JSON.stringify({ base: "run", kind: "verbo (inglês)", definition: "Correr.", translation: "correr" })),
      "running",
      "en"
    );
    expect(entry?.translation).toBe("correr");
    expect(entry?.base).toBe("run");
  });

  it("ignora blocos que nao sao texto", () => {
    const item: BatchItemLike = {
      custom_id: "w1",
      result: {
        type: "succeeded",
        message: { stop_reason: "end_turn", content: [{ type: "thinking" }, { type: "text", text: json }] },
      },
    };
    expect(batchItemEntry(item, "x", "pt-BR")?.definition).toBe("Andar de um lado a outro.");
  });

  it("erro, expiracao, cancelamento e recusa deixam a palavra sem definicao", () => {
    for (const type of ["errored", "expired", "canceled"] as const) {
      expect(batchItemEntry({ custom_id: "w1", result: { type } }, "x", "pt-BR")).toBeNull();
    }
    expect(batchItemEntry(succeeded(json, "refusal"), "x", "pt-BR")).toBeNull();
  });

  it("resposta fora do formato tambem", () => {
    expect(batchItemEntry(succeeded("nao e json"), "x", "pt-BR")).toBeNull();
    expect(batchItemEntry(succeeded(JSON.stringify({ base: "x" })), "x", "pt-BR")).toBeNull();
  });
});

describe("batchStartNotice (US-139)", () => {
  it("diz quantas foram e quantas ficaram de fora pela cota", () => {
    expect(batchStartNotice(12, 12)).toBe("12 palavras estão sendo buscadas.");
    expect(batchStartNotice(5, 12)).toBe(
      "5 palavras estão sendo buscadas. 7 ficaram de fora: a cota do dicionário de hoje acabou."
    );
    expect(batchStartNotice(1, 2)).toBe(
      "1 palavra está sendo buscada. 1 ficou de fora: a cota do dicionário de hoje acabou."
    );
  });
});

describe("batchItemEntry com alternativas (US-151)", () => {
  it("le as tres definicoes erradas do mesmo esquema da consulta", () => {
    const entry = batchItemEntry(
      succeeded(
        JSON.stringify({
          base: "percorrer",
          kind: "verbo",
          definition: "Andar de um lado a outro.",
          translation: "",
          distractors: ["Ficar parado.", "Correr em circulos.", "Voltar para casa."],
        })
      ),
      "percorreram",
      "pt-BR"
    );
    expect(entry?.distractors).toEqual(["Ficar parado.", "Correr em circulos.", "Voltar para casa."]);
  });
});
