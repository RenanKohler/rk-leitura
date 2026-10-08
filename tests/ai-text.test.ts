import { describe, expect, it } from "vitest";
import { excerptOf, wordAtChar } from "@/lib/ai-text";
import { parseParagraphs } from "@/lib/reading";

const { paragraphs, words } = parseParagraphs("um dois tres\n\nquatro cinco\n\nseis sete oito nove");

describe("excerptOf", () => {
  it("termina na posicao de leitura, sem nenhuma palavra depois", () => {
    const excerpt = excerptOf(paragraphs, 0, 4);
    expect(excerpt.text).toBe("um dois tres\n\nquatro");
    expect(excerpt.endWord).toBe(4);
    expect(excerpt.text).not.toContain("cinco");
  });

  it("guarda o fim quando passa do teto", () => {
    const excerpt = excerptOf(paragraphs, 0, words.length, 22);
    expect(excerpt.truncated).toBe(true);
    expect(excerpt.text.endsWith("seis sete oito nove")).toBe(true);
    expect(excerpt.endWord).toBe(words.length);
    expect(words[excerpt.startWord]).toBe(excerpt.text.split(/\s+/)[0]);
  });

  it("corta pelo fim um paragrafo sozinho maior que o teto", () => {
    const excerpt = excerptOf(paragraphs, 5, 9, 10);
    expect(excerpt.truncated).toBe(true);
    expect(excerpt.text.length).toBeLessThanOrEqual(10);
    expect(excerpt.endWord).toBe(9);
    expect(words.slice(excerpt.startWord, excerpt.endWord).join(" ")).toBe(excerpt.text);
  });
});

describe("wordAtChar", () => {
  it("leva o caractere de uma citacao a palavra do texto inteiro", () => {
    const excerpt = excerptOf(paragraphs, 2, 9);
    const char = excerpt.text.indexOf("cinco");
    expect(words[wordAtChar(excerpt, char)]).toBe("cinco");
    expect(words[wordAtChar(excerpt, char + 2)]).toBe("cinco");
  });
});
