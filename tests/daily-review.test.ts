import { describe, expect, it } from "vitest";
import {
  byOverdue,
  countsLabel,
  dailySession,
  DAILY_REVIEW_LIMIT,
  emptyCounts,
  interleave,
  itemsLabel,
  totalOf,
  type DailyReviewKind,
} from "@/lib/daily-review";

const item = (kind: DailyReviewKind, dueOn: string | null, id = `${kind}-${dueOn}`) => ({
  kind,
  dueOn,
  id,
});

describe("revisao do dia", () => {
  it("ordena pelos mais atrasados; sem data conta como o mais atrasado", () => {
    const sorted = byOverdue([
      item("cartao", "2026-10-10"),
      item("palavra", "2026-10-01"),
      item("destaque", null),
      item("recordar", "2026-10-05"),
    ]);
    expect(sorted.map((entry) => entry.kind)).toEqual(["destaque", "palavra", "recordar", "cartao"]);
  });

  it("intercala os tipos mantendo a ordem de atraso dentro de cada um", () => {
    const words = ["2026-10-01", "2026-10-02", "2026-10-03"].map((day) => item("palavra", day));
    const cards = ["2026-10-04", "2026-10-05"].map((day) => item("cartao", day));
    const result = interleave([...words, ...cards]);
    expect(result.map((entry) => entry.kind)).toEqual([
      "palavra",
      "cartao",
      "palavra",
      "cartao",
      "palavra",
    ]);
    expect(result.filter((entry) => entry.kind === "palavra").map((entry) => entry.dueOn)).toEqual([
      "2026-10-01",
      "2026-10-02",
      "2026-10-03",
    ]);
  });

  it("abre com o item mais atrasado de todos", () => {
    const result = interleave([
      item("palavra", "2026-10-09"),
      item("destaque", "2026-09-01"),
      item("cartao", "2026-10-01"),
    ]);
    expect(result[0]!.kind).toBe("destaque");
    expect(result).toHaveLength(3);
  });

  it("limita a 50 itens, cortando os menos atrasados antes de intercalar", () => {
    const recent = Array.from({ length: 40 }, (_, index) => item("palavra", "2026-10-10", `p${index}`));
    const old = Array.from({ length: 20 }, (_, index) => item("cartao", "2026-09-01", `c${index}`));
    const session = dailySession([...recent, ...old]);
    expect(session).toHaveLength(DAILY_REVIEW_LIMIT);
    // Os 20 cartoes atrasados entram todos; das palavras recentes, so 30.
    expect(session.filter((entry) => entry.kind === "cartao")).toHaveLength(20);
    expect(session.filter((entry) => entry.kind === "palavra")).toHaveLength(30);
    expect(new Set(session.map((entry) => entry.id)).size).toBe(DAILY_REVIEW_LIMIT);
  });

  it("um tipo so continua inteiro", () => {
    const words = Array.from({ length: 3 }, (_, index) => item("palavra", `2026-10-0${index + 1}`));
    expect(dailySession(words).map((entry) => entry.dueOn)).toEqual([
      "2026-10-01",
      "2026-10-02",
      "2026-10-03",
    ]);
  });

  it("descreve as contagens por tipo", () => {
    const counts = emptyCounts();
    counts.palavra = 3;
    counts.cartao = 1;
    counts.recordar = 2;
    expect(totalOf(counts)).toBe(6);
    expect(countsLabel(counts)).toBe("3 palavras · 1 cartão · 2 questionários");
    expect(itemsLabel(1)).toBe("1 item");
    expect(itemsLabel(12)).toBe("12 itens");
  });
});
