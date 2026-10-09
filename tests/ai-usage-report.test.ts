import { describe, expect, it } from "vitest";
import { estimateCost } from "@/lib/ai-cost";
import { successRate, summarizeByFeature, type UsageGroup } from "@/lib/ai-usage-report";

function group(partial: Partial<UsageGroup>): UsageGroup {
  return {
    feature: "resumo",
    model: "claude-sonnet-5-5",
    batch: false,
    outcome: "sucesso",
    calls: 1,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    ...partial,
  };
}

describe("summarizeByFeature (US-141)", () => {
  it("soma chamadas por funcao e calcula a taxa de sucesso", () => {
    const [report] = summarizeByFeature([
      group({ outcome: "sucesso", calls: 7 }),
      group({ outcome: "recusa", calls: 1 }),
      group({ outcome: "tempo", calls: 1 }),
      group({ outcome: "falha", calls: 1 }),
    ]);
    expect(report).toMatchObject({
      feature: "resumo",
      calls: 10,
      outcomes: { sucesso: 7, recusa: 1, tempo: 1, falha: 1 },
      successRate: 70,
    });
  });

  it("soma o custo de cada modelo pelo preco dele", () => {
    const opus = group({ feature: "pergunta", model: "claude-opus-5-5", inputTokens: 1_000_000 });
    const haiku = group({
      feature: "pergunta",
      model: "claude-haiku-5-5",
      outputTokens: 1_000_000,
      batch: true,
    });
    const [report] = summarizeByFeature([opus, haiku]);
    const expected = estimateCost(opus) + estimateCost(haiku);
    expect(report!.costUsd).toBeCloseTo(expected, 4);
    // 1 milhao de entrada no Opus (4) + 1 milhao de saida no Haiku em lote (0,25)
    expect(report!.costUsd).toBeCloseTo(4.25, 4);
  });

  it("falhas nao custam: zero tokens, zero dolares", () => {
    const [report] = summarizeByFeature([group({ outcome: "falha", calls: 3 })]);
    expect(report).toMatchObject({ calls: 3, successRate: 0, costUsd: 0 });
  });

  it("resultado desconhecido conta como falha", () => {
    const [report] = summarizeByFeature([
      group({ outcome: "sucesso", calls: 1 }),
      group({ outcome: "cancelada", calls: 1 }),
    ]);
    expect(report!.outcomes.falha).toBe(1);
    expect(report!.successRate).toBe(50);
  });

  it("ordena da funcao mais chamada para a menos", () => {
    const reports = summarizeByFeature([
      group({ feature: "sinopse", calls: 2 }),
      group({ feature: "dicionario", calls: 9 }),
      group({ feature: "explicacao", calls: 2 }),
    ]);
    expect(reports.map((report) => report.feature)).toEqual([
      "dicionario",
      "explicacao",
      "sinopse",
    ]);
  });

  it("sem linhas, nenhuma funcao", () => {
    expect(summarizeByFeature([])).toEqual([]);
  });
});

describe("successRate", () => {
  it("arredonda a uma casa decimal", () => {
    expect(successRate(2, 3)).toBe(66.7);
    expect(successRate(0, 0)).toBe(0);
  });
});
