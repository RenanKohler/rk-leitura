import { describe, expect, it } from "vitest";
import {
  addDays,
  afterAnswer,
  afterGrade,
  currentInterval,
  firstReview,
  gradeFrom,
  gradeInterval,
  GRADUATION_DAYS,
  isDue,
  retention,
  wordsCsv,
} from "@/lib/vocabulary";

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

describe("quatro respostas (PROD-7)", () => {
  it("errei volta a 1 dia, qualquer que seja o intervalo", () => {
    expect(afterGrade(40, "errei", hoje)).toEqual({
      interval: 1,
      nextReviewOn: "2026-09-23",
      graduated: false,
    });
  });

  it("dificil, bom e facil multiplicam por 1,2, 2,5 e 4", () => {
    expect(gradeInterval(10, "dificil")).toBe(12);
    expect(gradeInterval(10, "bom")).toBe(25);
    expect(gradeInterval(10, "facil")).toBe(40);
  });

  it("resposta certa sempre avanca pelo menos um dia", () => {
    expect(gradeInterval(1, "dificil")).toBe(2);
    expect(gradeInterval(1, "bom")).toBe(3);
    expect(gradeInterval(1, "facil")).toBe(4);
  });

  it("forma a palavra ao chegar a 90 dias", () => {
    expect(afterGrade(30, "bom", hoje)).toMatchObject({ interval: 75, graduated: false });
    const formed = afterGrade(30, "facil", hoje);
    expect(formed.interval).toBeGreaterThanOrEqual(GRADUATION_DAYS);
    expect(formed.graduated).toBe(true);
    expect(formed.nextReviewOn).toBe(addDays(hoje, 120));
  });

  it("intervalo atual: gravado, ou da etapa antiga, ou 1 dia", () => {
    expect(currentInterval(17, 0)).toBe(17);
    expect(currentInterval(null, 3)).toBe(14);
    expect(currentInterval(null, 0)).toBe(1);
    expect(currentInterval(0)).toBe(1);
  });

  it("aceita o lembrei/nao lembrei antigo", () => {
    expect(gradeFrom({ remembered: true })).toBe("bom");
    expect(gradeFrom({ remembered: false })).toBe("errei");
    expect(gradeFrom({ grade: "facil" })).toBe("facil");
    expect(gradeFrom({ grade: "otimo" })).toBeNull();
    expect(gradeFrom(null)).toBeNull();
  });

  it("retencao e a parcela das respostas que nao foram errei", () => {
    expect(retention([])).toBeNull();
    expect(retention(["bom", "errei", "facil", "dificil"])).toBe(75);
    expect(retention(["errei"])).toBe(0);
  });
});
