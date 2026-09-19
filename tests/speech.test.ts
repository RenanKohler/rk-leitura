import { describe, expect, it } from "vitest";
import {
  BASE_SPEECH_WPM,
  MAX_RATE,
  MIN_RATE,
  pickVoice,
  rateFor,
  rateNotice,
  speechChunks,
  withinVoiceRange,
  wordAtCharIndex,
  wpmFor,
} from "@/lib/speech";

describe("velocidade da voz", () => {
  it("o ritmo base corresponde a velocidade 1", () => {
    expect(rateFor(BASE_SPEECH_WPM)).toBe(1);
  });

  it("limita o que a voz nao entrega", () => {
    expect(rateFor(2_000)).toBe(MAX_RATE);
    expect(rateFor(10)).toBe(MIN_RATE);
  });

  it("converte de volta para ppm", () => {
    expect(wpmFor(1)).toBe(BASE_SPEECH_WPM);
    expect(wpmFor(MAX_RATE)).toBe(450);
  });

  it("reconhece o que esta fora da faixa", () => {
    expect(withinVoiceRange(300)).toBe(true);
    expect(withinVoiceRange(800)).toBe(false);
  });
});

describe("rateNotice", () => {
  it("nao avisa quando o ritmo cabe", () => {
    expect(rateNotice(300)).toBeNull();
  });

  it("avisa o ritmo aplicado quando o pedido nao cabe", () => {
    const aviso = rateNotice(800)!;
    expect(aviso).toContain("450");
    expect(aviso).toContain("800");
  });
});

describe("pickVoice", () => {
  const vozes = [
    { name: "Ingles", lang: "en-US", localService: true },
    { name: "Portugal rede", lang: "pt-PT", localService: false },
    { name: "Brasil rede", lang: "pt-BR", localService: false },
    { name: "Brasil local", lang: "pt-BR", localService: true },
  ];

  it("prefere a variante exata", () => {
    expect(pickVoice(vozes)!.lang).toBe("pt-BR");
  });

  it("prefere a voz local a de rede", () => {
    expect(pickVoice(vozes)!.name).toBe("Brasil local");
  });

  it("aceita outra variante do mesmo idioma", () => {
    const so = [{ name: "Portugal", lang: "pt-PT" }, { name: "Ingles", lang: "en-US" }];
    expect(pickVoice(so)!.name).toBe("Portugal");
  });

  it("aceita o separador com sublinhado", () => {
    expect(pickVoice([{ name: "x", lang: "pt_BR" }])!.name).toBe("x");
  });

  it("devolve nulo quando o idioma nao existe no aparelho", () => {
    expect(pickVoice([{ name: "Ingles", lang: "en-US" }])).toBeNull();
    expect(pickVoice([])).toBeNull();
  });
});

describe("speechChunks", () => {
  const words = "Primeira frase curta. Segunda frase um pouco maior aqui. Terceira!".split(" ");

  it("quebra por frase", () => {
    const chunks = speechChunks(words, 0);
    expect(chunks).toHaveLength(3);
    expect(chunks[0]!.words.join(" ")).toBe("Primeira frase curta.");
  });

  it("os indices seguem a posicao no texto", () => {
    const chunks = speechChunks(words, 0);
    expect(chunks[0]!.start).toBe(0);
    expect(chunks[1]!.start).toBe(3);
  });

  it("comeca de onde a leitura esta", () => {
    const chunks = speechChunks(words, 3);
    expect(chunks[0]!.start).toBe(3);
    expect(chunks[0]!.words[0]).toBe("Segunda");
  });

  it("nao deixa uma fala longa demais", () => {
    const longo = Array.from({ length: 100 }, () => "palavra");
    for (const chunk of speechChunks(longo, 0, 40)) {
      expect(chunk.words.length).toBeLessThanOrEqual(40);
    }
  });

  it("cobre todas as palavras sem buraco", () => {
    const chunks = speechChunks(words, 0);
    expect(chunks.flatMap((chunk) => chunk.words)).toEqual(words);
  });
});

describe("wordAtCharIndex", () => {
  const words = ["Marina", "chegou", "a", "cabana"];

  it("mapeia o deslocamento em caracteres para a palavra", () => {
    expect(wordAtCharIndex(words, 0)).toBe(0);
    expect(wordAtCharIndex(words, 7)).toBe(1);
    expect(wordAtCharIndex(words, 14)).toBe(2);
  });

  it("nao estoura no fim", () => {
    expect(wordAtCharIndex(words, 9_999)).toBe(3);
  });
});
