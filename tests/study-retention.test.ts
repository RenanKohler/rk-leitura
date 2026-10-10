import { describe, expect, it } from "vitest";
import { cardRetention, pretestPercent, rereadList } from "@/lib/study-retention";

const grades = (kept: number, missed: number) => [
  ...Array.from({ length: kept }, () => "bom"),
  ...Array.from({ length: missed }, () => "errei"),
];

describe("retencao dos cartoes", () => {
  it("com menos de 10 revisoes nao mede", () => {
    expect(cardRetention(grades(9, 0), [30])).toEqual({ measured: false, reviews: 9 });
    expect(cardRetention([], [])).toEqual({ measured: false, reviews: 0 });
  });

  it("acerto e toda nota diferente de errei; maduro e intervalo de 21 dias ou mais", () => {
    const result = cardRetention([...grades(6, 3), "dificil"], [1, 20, 21, 45]);
    expect(result).toEqual({ measured: true, reviews: 10, percent: 70, mature: 2 });
  });

  it("conhecimento previo conta so as respostas do teste", () => {
    expect(pretestPercent([null, null])).toBeNull();
    expect(pretestPercent(["sabia", "nao_sabia", "sabia", null])).toBe(67);
    expect(pretestPercent(["outra"])).toBeNull();
  });

  it("para reler: retencao medida abaixo de 60%, os piores primeiro", () => {
    const list = rereadList([
      { textId: "a", title: "Bom", grades: grades(9, 1) },
      { textId: "b", title: "Ruim", grades: grades(3, 7) },
      { textId: "c", title: "Pouco", grades: grades(0, 5) },
      { textId: "d", title: "Medio", grades: grades(5, 5) },
      { textId: "e", title: "Limite", grades: grades(6, 4) },
    ]);
    expect(list).toEqual([
      { textId: "b", title: "Ruim", percent: 30 },
      { textId: "d", title: "Medio", percent: 50 },
    ]);
  });
});
