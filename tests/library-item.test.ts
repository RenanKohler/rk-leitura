import { describe, expect, it } from "vitest";
import { toLibraryItem } from "@/lib/queries";
import type { TextSummary } from "@/lib/types";

const chapter = (n: number, extra: Partial<TextSummary> = {}): TextSummary => ({
  id: `c${n}`,
  title: `Capitulo ${n}`,
  sourceUrl: null,
  wordCount: 100,
  progressIndex: 0,
  highlights: 0,
  tags: [],
  seriesKey: "serie",
  seriesTitle: "Serie",
  chapter: n,
  queuePosition: null,
  archivedAt: null,
  fresh: false,
  abandoned: false,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
  ...extra,
});

describe("capitulo atual da serie", () => {
  it("pula o capitulo largado e leva ao proximo ativo", () => {
    const item = toLibraryItem([
      chapter(1, { progressIndex: 100 }),
      chapter(2, { progressIndex: 40, abandoned: true }),
      chapter(3),
    ]);
    expect(item?.kind === "serie" && item.current).toBe(3);
  });

  it("serie terminada fica no ultimo capitulo ativo", () => {
    const item = toLibraryItem([
      chapter(1, { progressIndex: 100 }),
      chapter(2, { progressIndex: 100 }),
      chapter(3, { progressIndex: 10, abandoned: true }),
    ]);
    expect(item?.kind === "serie" && item.current).toBe(2);
  });
});
