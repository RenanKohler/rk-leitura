import { describe, expect, it } from "vitest";
import { parseParagraphs } from "@/lib/reading";
import { contextAround, namesInText } from "@/lib/xray";

function names(content: string) {
  const { words, paragraphs } = parseParagraphs(content);
  return { words, list: namesInText(words, paragraphs) };
}

describe("nomes no texto", () => {
  it("acha nomes com 3 ou mais ocorrencias, contando o comeco de frase", () => {
    const { list } = names(
      "Na manha seguinte, Capitu acordou cedo. Capitu olhou a janela. Depois disso, a mae chamou Capitu para o cafe. O dia passou."
    );
    expect(list).toEqual([{ name: "Capitu", count: 3, positions: [3, 6, 15] }]);
  });

  it("ignora palavra comum maiuscula so em comeco de frase", () => {
    const { list } = names(
      "Depois veio a chuva. Depois o vento. Depois a calma. Depois nada."
    );
    expect(list).toEqual([]);
  });

  it("junta sobrenome e particula: Maria da Silva", () => {
    const { list } = names(
      "Ontem Maria da Silva chegou. A vizinha viu Maria da Silva sair. E falou com Maria da Silva na rua."
    );
    expect(list[0]).toMatchObject({ name: "Maria da Silva", count: 3 });
  });

  it("menos de 3 ocorrencias fica de fora", () => {
    const { list } = names("Ontem Pedro chegou. Hoje Pedro saiu.");
    expect(list).toEqual([]);
  });

  it("ordena do mais citado ao menos", () => {
    const { list } = names(
      "Ali estavam Ana e Bento. Com Ana, Bento e Ana riam. Ate Bento e Ana dormirem. Ana sonhou."
    );
    expect(list.map((entry) => entry.name)).toEqual(["Ana", "Bento"]);
    expect(list[0]!.count).toBe(5);
  });

  it("contexto em volta da ocorrencia", () => {
    const words = "um dois tres quatro cinco seis sete oito nove dez".split(" ");
    expect(contextAround(words, 5, 2, 2)).toBe("...quatro cinco seis sete...");
  });
});
