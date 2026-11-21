import { describe, expect, it } from "vitest";
import { MAX_CHAPTER, parseSeriesAssignment } from "@/lib/series";

describe("parseSeriesAssignment", () => {
  it("serie existente com capitulo", () => {
    expect(parseSeriesAssignment({ serie: "url:the-cabin", capitulo: 3 })).toEqual({
      kind: "existente",
      key: "url:the-cabin",
      chapter: 3,
    });
  });

  it("serie nova pelo nome, sem espacos sobrando", () => {
    expect(parseSeriesAssignment({ titulo: "  A   Cabana ", capitulo: "1" })).toEqual({
      kind: "nova",
      title: "A Cabana",
      chapter: 1,
    });
  });

  it("a serie existente vale mais que o nome", () => {
    expect(parseSeriesAssignment({ serie: "k", titulo: "Outra", capitulo: 2 })).toMatchObject({
      kind: "existente",
    });
  });

  it.each([0, -1, 1.5, MAX_CHAPTER + 1, "abc", undefined])("recusa capitulo %s", (capitulo) => {
    expect(typeof parseSeriesAssignment({ titulo: "A Cabana", capitulo })).toBe("string");
  });

  it("recusa sem serie e sem nome, ou nome sem letras", () => {
    expect(typeof parseSeriesAssignment({ capitulo: 1 })).toBe("string");
    expect(typeof parseSeriesAssignment({ titulo: "   ", capitulo: 1 })).toBe("string");
    expect(typeof parseSeriesAssignment({ titulo: "!!!", capitulo: 1 })).toBe("string");
    expect(typeof parseSeriesAssignment(null)).toBe("string");
  });
});
