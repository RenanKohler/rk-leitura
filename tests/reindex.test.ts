import { describe, expect, it } from "vitest";
import { stripCitations } from "@/lib/citations";
import { alignRemoval, forwardMap, inverseMap, mapSpan, unmapSpan } from "@/lib/reindex";

const split = (text: string) => text.split(/\s+/).filter(Boolean);

const ORIGINAL = "A memoria e limitada [1]. Miller (1956) mostrou isso (Silva, 2020). Fim resultado¹².";
// 0 A, 1 memoria, 2 e, 3 limitada, 4 [1]., 5 Miller, 6 (1956), 7 mostrou, 8 isso, 9 (Silva, 10 2020)., 11 Fim, 12 resultado¹².
const before = split(ORIGINAL);
const after = split(stripCitations(ORIGINAL).text);

describe("alignRemoval", () => {
  it("casa cada palavra que ficou com a posicao original", () => {
    expect(after).toEqual(["A", "memoria", "e", "limitada.", "Miller", "mostrou", "isso.", "Fim", "resultado."]);
    expect(alignRemoval(before, after)).toEqual([0, 1, 2, 3, 5, 7, 8, 11, 12]);
  });

  it("recusa quando uma palavra da lista nova nao existe na antiga", () => {
    expect(alignRemoval(["a", "b"], ["a", "c"])).toBeNull();
  });
});

describe("mapas de posicao", () => {
  const matched = alignRemoval(before, after)!;
  const forward = forwardMap(before.length, matched);

  it("palavra que ficou vai para a posicao nova; removida vai para a seguinte", () => {
    expect(forward[5]).toBe(4); // Miller
    expect(forward[4]).toBe(4); // [1]. -> Miller
    expect(forward[9]).toBe(7); // (Silva, -> Fim
    expect(forward[before.length]).toBe(after.length);
  });

  it("destaque que cobre texto e citacao encolhe; so citacao some", () => {
    expect(mapSpan({ start: 3, end: 7 }, forward)).toEqual({ start: 3, end: 5 }); // limitada [1]. Miller (1956)
    expect(mapSpan({ start: 9, end: 11 }, forward)).toBeNull(); // (Silva, 2020).
  });

  it("desfazer leva de volta as posicoes originais", () => {
    const inverse = inverseMap(matched, before.length);
    expect(inverse[4]).toBe(5);
    expect(unmapSpan({ start: 3, end: 5 }, inverse)).toEqual({ start: 3, end: 6 });
    expect(inverse[after.length]).toBe(before.length);
  });
});
