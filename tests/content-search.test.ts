import { describe, expect, it } from "vitest";
import { contentMatchFrom } from "@/lib/content-search";
import { recapTail } from "@/lib/series";
import { parseParagraphs } from "@/lib/reading";

describe("busca no conteudo", () => {
  const content = "Primeira frase do texto. A memoria de trabalho guarda pouco e cansa.";
  const match = (query: string) => {
    const position = content.toLowerCase().indexOf(query) + 1;
    return contentMatchFrom(
      { id: "t", title: "T", format: "plain", position, head: content },
      query.length
    );
  };

  it("aponta o indice da palavra onde o termo comeca", () => {
    const { words } = parseParagraphs(content);
    const found = match("memoria de trabalho");
    expect(words[found.wordIndex]).toBe("memoria");
  });

  it("termo no meio da palavra aponta a propria palavra", () => {
    const { words } = parseParagraphs(content);
    expect(words[match("abalho").wordIndex]).toBe("trabalho");
  });

  it("termo na primeira palavra da indice 0 e trecho com contexto", () => {
    const found = match("primeira");
    expect(found.wordIndex).toBe(0);
    expect(found.excerpt.startsWith("Primeira frase")).toBe(true);
  });
});

describe("recapitulacao do capitulo anterior", () => {
  const paragraph = (size: number, label: string) =>
    Array.from({ length: size }, (_, i) => `${label}${i}`);

  it("ultimos paragrafos ate 3, na ordem", () => {
    const tail = recapTail([paragraph(5, "a"), paragraph(5, "b"), paragraph(5, "c"), paragraph(5, "d")]);
    expect(tail).toHaveLength(3);
    expect(tail[0]!.startsWith("b0")).toBe(true);
    expect(tail[2]!.endsWith("d4")).toBe(true);
  });

  it("para no teto de palavras", () => {
    const tail = recapTail([paragraph(100, "a"), paragraph(50, "b")]);
    expect(tail).toEqual([paragraph(50, "b").join(" ")]);
  });

  it("paragrafo final enorme entra cortado pelo comeco", () => {
    const [only] = recapTail([paragraph(300, "a")]);
    expect(only!.startsWith("...a180")).toBe(true);
    expect(only!.endsWith("a299")).toBe(true);
  });
});
