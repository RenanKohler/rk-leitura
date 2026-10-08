import { describe, expect, it } from "vitest";
import { contentKey } from "@/lib/quiz";
import { parseParagraphs } from "@/lib/reading";
import {
  buildChapterSummaryRequest,
  buildNamesRequest,
  buildReadSummaryRequest,
  canReuseNames,
  canReuseReadSummary,
  chapterSummaryKey,
  clampPosition,
  MAX_DESCRIBED_NAMES,
  namesKey,
  namesToDescribe,
  normalizeDescriptions,
  normalizePoints,
  paragraphStartAt,
  readSummaryKey,
  SUMMARY_MAX_WORDS,
} from "@/lib/summaries";
import { namesInText } from "@/lib/xray";

// Cada palavra e unica: da para saber exatamente o que foi enviado.
const content = [
  "Ana chegou cedo. Depois Ana abriu a loja.",
  "Bruno trouxe o pão. Ana sorriu para Bruno.",
  "Carla apareceu depois. Bruno saiu. Carla ficou com Ana.",
  "No fim Carla contou o segredo. Carla partiu.",
].join("\n\n");
const { words, paragraphs } = parseParagraphs(content);

/** Palavras do texto que aparecem no pedido, depois da posicao. */
function wordsAfter(prompt: string, position: number, excerpt: string): string[] {
  const sent = excerpt.split(/\s+/).filter(Boolean);
  expect(prompt).toContain(excerpt);
  return sent.slice(position);
}

describe("buildReadSummaryRequest", () => {
  it("termina exatamente na palavra N, em qualquer posicao", () => {
    for (let position = 1; position <= words.length; position += 1) {
      const { excerpt, prompt } = buildReadSummaryRequest({
        title: "Loja",
        paragraphs,
        position,
        language: "pt-BR",
      });
      expect(excerpt.endWord).toBe(position);
      expect(excerpt.text.split(/\s+/).filter(Boolean)).toEqual(words.slice(0, position));
      expect(wordsAfter(prompt, position, excerpt.text)).toEqual([]);
    }
  });

  it("nunca inclui a palavra seguinte a posicao", () => {
    // "segredo" so aparece no ultimo paragrafo.
    const position = words.indexOf("segredo.");
    const { prompt } = buildReadSummaryRequest({ title: "Loja", paragraphs, position, language: "pt-BR" });
    expect(prompt).not.toContain("segredo");
    expect(prompt).not.toContain("partiu");
  });

  it("pede em portugues e mantem o original em outro idioma", () => {
    const { prompt } = buildReadSummaryRequest({ title: "T", paragraphs, position: 5, language: "en" });
    expect(prompt).toContain("português do Brasil");
  });
});

describe("buildNamesRequest", () => {
  it("o trecho termina na palavra N e so leva os nomes ja vistos", () => {
    const position = words.indexOf("Carla");
    const names = namesInText(words, paragraphs);
    const { listed, sent } = namesToDescribe(names, position);
    expect(listed).toContain("Carla");
    expect(sent).toEqual(expect.arrayContaining(["Ana", "Bruno"]));
    expect(sent).not.toContain("Carla");

    const { excerpt, prompt } = buildNamesRequest({
      title: "Loja",
      paragraphs,
      position,
      names: sent,
      language: "pt-BR",
    });
    expect(excerpt.endWord).toBe(position);
    expect(prompt).not.toContain("Carla");
    expect(prompt).not.toContain("segredo");
  });

  it("descreve no maximo 30 nomes", () => {
    const many = Array.from({ length: 40 }, (_, index) => ({
      name: `Nome${index}`,
      count: 3,
      positions: [index],
    }));
    const { listed, sent } = namesToDescribe(many, 1000);
    expect(listed).toHaveLength(MAX_DESCRIBED_NAMES);
    expect(sent).toHaveLength(MAX_DESCRIBED_NAMES);
  });
});

describe("buildChapterSummaryRequest", () => {
  it("leva o capitulo concluido inteiro", () => {
    const { excerpt } = buildChapterSummaryRequest({
      title: "Cap. 1",
      paragraphs,
      wordCount: words.length,
      language: "pt-BR",
    });
    expect(excerpt.endWord).toBe(words.length);
    expect(excerpt.text).toContain("partiu.");
  });
});

describe("chaves e reaproveitamento", () => {
  it("o resumo do que li e por paragrafo da posicao e muda com o conteudo", () => {
    const second = paragraphs[1]!.start;
    expect(paragraphStartAt(paragraphs, second + 2)).toBe(second);
    expect(readSummaryKey("t", content, paragraphs, second + 1)).toBe(
      readSummaryKey("t", content, paragraphs, second + 3)
    );
    expect(readSummaryKey("t", content, paragraphs, second + 1)).not.toBe(
      readSummaryKey("t", `${content} mais`, paragraphs, second + 1)
    );
    expect(readSummaryKey("t", content, paragraphs, second)).toContain(contentKey(content));
  });

  it("nao reaproveita resumo que passa da posicao", () => {
    expect(canReuseReadSummary({ points: ["a"], to: 10 }, 10)).toBe(true);
    expect(canReuseReadSummary({ points: ["a"], to: 10 }, 12)).toBe(true);
    expect(canReuseReadSummary({ points: ["a"], to: 10 }, 9)).toBe(false);
    expect(canReuseReadSummary(null, 9)).toBe(false);
  });

  it("o capitulo muda de chave quando o conteudo muda", () => {
    expect(chapterSummaryKey("c", "um dois")).not.toBe(chapterSummaryKey("c", "um dois tres"));
    expect(chapterSummaryKey("c", "um dois")).toBe(chapterSummaryKey("c", "um dois"));
  });

  it("descricoes valem por menos de 10% de avanco e nunca para tras", () => {
    const key = contentKey(content);
    const stored = { contentKey: key, position: 100, descriptions: {} };
    expect(canReuseNames(stored, key, 100, 1000)).toBe(true);
    expect(canReuseNames(stored, key, 199, 1000)).toBe(true);
    expect(canReuseNames(stored, key, 200, 1000)).toBe(false);
    expect(canReuseNames(stored, key, 99, 1000)).toBe(false);
    expect(canReuseNames(stored, "outra", 150, 1000)).toBe(false);
    expect(namesKey("t", content, 99, 1000)).not.toBe(namesKey("t", content, 100, 1000));
  });

  it("limita a posicao ao texto", () => {
    expect(clampPosition("12", 10)).toBe(10);
    expect(clampPosition(-3, 10)).toBe(0);
    expect(clampPosition("x", 10)).toBe(0);
    expect(clampPosition(4.7, 10)).toBe(4);
  });
});

describe("normalizacao da resposta", () => {
  it("corta topicos vazios, o excesso e o total de palavras", () => {
    const long = Array.from({ length: 50 }, (_, index) => `p${index}`).join(" ");
    const points = normalizePoints(["- um", "", long, long, long, "seis", "sete"], 5, SUMMARY_MAX_WORDS);
    expect(points[0]).toBe("um");
    expect(points.length).toBeLessThanOrEqual(5);
    const total = points.join(" ").split(/\s+/).length;
    expect(total).toBeLessThanOrEqual(SUMMARY_MAX_WORDS);
    expect(normalizePoints("x", 5, 120)).toEqual([]);
  });

  it("indexa pelo nome, marca pouco contexto e ignora nome inventado", () => {
    const long = Array.from({ length: 40 }, () => "palavra").join(" ");
    const result = normalizeDescriptions(["Ana", "Bruno", "Carla", "Davi"], ["Ana", "Bruno", "Davi"], [
      { name: "ana", known: true, description: "Dona da loja." },
      { name: "Bruno", known: false, description: "" },
      { name: "Davi", known: true, description: long },
      { name: "Zeca", known: true, description: "Inventado." },
      { name: "Carla", known: true, description: "Nao foi enviada." },
    ]);
    expect(result).toEqual({
      Ana: "Dona da loja.",
      Bruno: null,
      Carla: null,
      Davi: expect.any(String),
    });
    expect(result.Davi!.split(" ")).toHaveLength(25);
    expect("Zeca" in result).toBe(false);
  });
});
