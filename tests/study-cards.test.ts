import { describe, expect, it } from "vitest";
import { cardSide, isCardDue, isCardRead, isConcluded, splitByReading } from "@/lib/study-cards";

const progress = { progressIndex: 99, wordCount: 1000 };

describe("cartoes de estudo", () => {
  it("so mostra cartoes de trechos ja lidos", () => {
    const cards = [{ sourceEnd: 50 }, { sourceEnd: 100 }, { sourceEnd: 101 }, { sourceEnd: 900 }];
    const { read, unread } = splitByReading(cards, progress);
    expect(read.map((card) => card.sourceEnd)).toEqual([50, 100]);
    expect(unread.map((card) => card.sourceEnd)).toEqual([101, 900]);
  });

  it("texto concluido mostra todos", () => {
    const done = { progressIndex: 999, wordCount: 1000 };
    expect(isConcluded(done)).toBe(true);
    expect(isCardRead({ sourceEnd: 1000 }, done)).toBe(true);
    expect(isConcluded({ progressIndex: 0, wordCount: 0 })).toBe(false);
  });

  it("cartao nao lido nunca vence, mesmo com data passada", () => {
    expect(isCardDue({ sourceEnd: 500, nextReviewOn: "2026-01-01" }, progress, "2026-10-10")).toBe(false);
  });

  it("cartao lido sem data vence; com data, so na data", () => {
    expect(isCardDue({ sourceEnd: 10, nextReviewOn: null }, progress, "2026-10-10")).toBe(true);
    expect(isCardDue({ sourceEnd: 10, nextReviewOn: "2026-10-10" }, progress, "2026-10-10")).toBe(true);
    expect(isCardDue({ sourceEnd: 10, nextReviewOn: "2026-10-11" }, progress, "2026-10-10")).toBe(false);
  });

  it("normaliza os lados do cartao", () => {
    expect(cardSide("  um   lado ")).toBe("um lado");
    expect(cardSide("")).toBeNull();
    expect(cardSide("a".repeat(501))).toBeNull();
    expect(cardSide(3)).toBeNull();
  });
});
