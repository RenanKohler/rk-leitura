import { describe, expect, it } from "vitest";
import { addDays, afterAnswer, firstReview, isDue, wordsCsv } from "@/lib/vocabulary";

const hoje = "2026-09-22";

describe("intervalos de revisao", () => {
  it("palavra nova entra na revisao no dia seguinte", () => {
    expect(firstReview(hoje)).toEqual({ step: 0, nextReviewOn: "2026-09-23" });
  });

  it("lembrei avanca na sequencia 1, 3, 7, 14 e 30 dias", () => {
    let step = 0;
    const gaps: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      const next = afterAnswer(step, true, hoje);
      step = next.step;
      gaps.push((Date.parse(next.nextReviewOn) - Date.parse(hoje)) / 86_400_000);
    }
    expect(gaps).toEqual([3, 7, 14, 30, 30]);
  });

  it("nao lembrei volta a 1 dia", () => {
    expect(afterAnswer(3, false, hoje)).toEqual({ step: 0, nextReviewOn: "2026-09-23" });
  });

  it("sem data de revisao conta como vencida", () => {
    expect(isDue(null, hoje)).toBe(true);
    expect(isDue(hoje, hoje)).toBe(true);
    expect(isDue("2026-09-21", hoje)).toBe(true);
    expect(isDue("2026-09-23", hoje)).toBe(false);
  });

  it("soma dias atravessando o mes", () => {
    expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
  });
});

describe("exportacao em CSV", () => {
  it("tem BOM, cabecalho e uma linha por palavra", () => {
    const csv = wordsCsv([
      {
        word: "manga",
        base: "manga",
        kind: "substantivo",
        definition: "Parte da roupa que cobre o braco.",
        translation: null,
        context: "arregacou a manga",
        textTitle: "Conto",
      },
    ]);
    expect(csv.startsWith("﻿")).toBe(true);
    const lines = csv.slice(1).trimEnd().split("\r\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("palavra,forma base,classe,definicao");
  });

  it("protege virgula, aspas e quebra de linha", () => {
    const csv = wordsCsv([
      {
        word: "tal",
        base: "tal",
        kind: "",
        definition: 'Diz-se "assim", de tal modo,\nou semelhante.',
        translation: null,
        context: null,
        textTitle: null,
      },
    ]);
    expect(csv).toContain('"Diz-se ""assim"", de tal modo,\nou semelhante."');
  });

  it("texto de origem apagado sai com titulo vazio", () => {
    const csv = wordsCsv([
      {
        word: "a",
        base: "a",
        kind: "",
        definition: "d",
        translation: null,
        context: null,
        textTitle: null,
      },
    ]);
    expect(csv.trimEnd().endsWith("a,a,,d,,,")).toBe(true);
  });
});
