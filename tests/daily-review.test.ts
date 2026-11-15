import { describe, expect, it } from "vitest";
import {
  byOverdue,
  countsLabel,
  dailySession,
  DAILY_REVIEW_KINDS,
  DAILY_REVIEW_LIMIT,
  emptyCounts,
  emptyTally,
  interleave,
  itemsLabel,
  removalCopy,
  sessionSummary,
  tallyWith,
  totalOf,
  type DailyReviewKind,
  type ReviewOutcome,
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

/** Pular e tirar da revisao (US-223). */
describe("resumo da sessao com pulados e tirados", () => {
  const tallyOf = (...outcomes: ReviewOutcome[]) => outcomes.reduce(tallyWith, emptyTally());

  it("pulado e tirado nao contam como lembrado nem como errado", () => {
    expect(tallyOf("lembrado", "errado", "pulado", "tirado", "pulado")).toEqual({
      answered: 2,
      remembered: 1,
      skipped: 2,
      removed: 1,
    });
    // O placar anterior nao e alterado.
    const before = emptyTally();
    tallyWith(before, "pulado");
    expect(before).toEqual(emptyTally());
  });

  it("separa respondidos de pulados", () => {
    const summary = sessionSummary(
      tallyOf("lembrado", "lembrado", "lembrado", "errado", "pulado", "pulado")
    );
    expect(summary.title).toBe("Revisão concluída");
    expect(summary.description).toBe(
      "Você lembrou 3 de 4. O que você errou volta amanhã. 2 pulados continuam na fila."
    );
  });

  it("sem erro nao promete volta amanha; um pulado fica no singular", () => {
    expect(sessionSummary(tallyOf("lembrado", "lembrado")).description).toBe("Você lembrou 2 de 2.");
    expect(sessionSummary(tallyOf("lembrado", "pulado")).description).toBe(
      "Você lembrou 1 de 1. 1 pulado continua na fila."
    );
  });

  it("tudo pulado nao e revisao concluida", () => {
    const summary = sessionSummary(tallyOf("pulado", "pulado", "pulado"));
    expect(summary.title).toBe("Nada respondido");
    expect(summary.title).not.toContain("concluída");
    expect(summary.description).toBe("3 itens pulados continuam na fila.");
    expect(sessionSummary(tallyOf("pulado")).description).toBe("1 item pulado continua na fila.");
  });

  it("os tirados da revisao vem em frase propria", () => {
    expect(sessionSummary(tallyOf("errado", "tirado")).description).toBe(
      "Você lembrou 0 de 1. O que você errou volta amanhã. 1 saiu da revisão."
    );
    expect(sessionSummary(tallyOf("pulado", "tirado", "tirado"))).toEqual({
      title: "Nada respondido",
      description: "1 item pulado continua na fila. 2 saíram da revisão.",
    });
  });

  it("tudo tirado: nada respondido e nada na fila", () => {
    expect(sessionSummary(tallyOf("tirado"))).toEqual({
      title: "Nada ficou na fila",
      description: "1 item saiu da revisão.",
    });
    expect(sessionSummary(tallyOf("tirado", "tirado")).description).toBe(
      "2 itens saíram da revisão."
    );
    expect(sessionSummary(emptyTally()).title).not.toContain("concluída");
  });
});

describe("confirmacao de tirar da revisao", () => {
  it("cada tipo diz o proprio efeito, em uma frase", () => {
    for (const kind of DAILY_REVIEW_KINDS) {
      const copy = removalCopy(kind, 7);
      expect(copy.title).not.toBe("");
      expect(copy.confirm).not.toBe("");
      // Uma frase: um ponto final, no fim.
      expect(copy.effect.endsWith(".")).toBe(true);
      expect(copy.effect.slice(0, -1)).not.toContain(".");
    }
    expect(removalCopy("palavra").effect).toContain("aprendida");
    expect(removalCopy("destaque").confirm).toBe("Não revisar");
  });

  it("so excluir o cartao e destrutivo, e avisa que nao da para desfazer", () => {
    expect(DAILY_REVIEW_KINDS.filter((kind) => removalCopy(kind).destructive)).toEqual(["cartao"]);
    expect(removalCopy("cartao").effect).toContain("não dá para desfazer");
  });

  it("dispensar a rodada de 7 dias avisa que a de 30 continua", () => {
    expect(removalCopy("recordar", 7).effect).toContain("a de 30 dias continua valendo");
    expect(removalCopy("recordar", 30).effect).toContain("não volta mais");
    expect(removalCopy("recordar", 30).effect).not.toContain("continua valendo");
  });
});
