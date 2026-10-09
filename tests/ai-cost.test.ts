import { describe, expect, it } from "vitest";
import { estimateCost } from "@/lib/ai-cost";

describe("estimateCost (US-124)", () => {
  it("soma entrada, saida, leitura e escrita de cache pelo preco do modelo", () => {
    const cost = estimateCost({
      model: "claude-opus-5-5",
      inputTokens: 1_000_000,
      outputTokens: 100_000,
      cacheReadTokens: 1_000_000,
      cacheWriteTokens: 100_000,
    });
    // 4 + 2 + 0,20 + 0,5 (100 mil a 1,25 x 4)
    expect(cost).toBeCloseTo(6.7, 6);
  });

  it("cobra metade em lote", () => {
    const base = { model: "claude-opus-5-5", inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
    expect(estimateCost({ ...base, batch: true })).toBeCloseTo(estimateCost(base) / 2, 6);
  });

  it("modelo desconhecido conta pelo preco do Opus 5.5", () => {
    const counts = { inputTokens: 1000, outputTokens: 1000, cacheReadTokens: 0, cacheWriteTokens: 0 };
    expect(estimateCost({ model: "claude-novo", ...counts })).toBe(
      estimateCost({ model: "claude-opus-5-5", ...counts })
    );
  });
});
