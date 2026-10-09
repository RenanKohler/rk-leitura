import { describe, expect, it } from "vitest";
import {
  explainRequest,
  explanationFields,
  explanationKey,
  FOLLOW_UP_WORDS,
  followUpKey,
  followUpPrompt,
  limitWords,
  normalizeFollowUp,
  parseFollowUp,
  MAX_EXPLANATION_WORDS,
  MAX_SENTENCE_WORDS,
  parseExplanation,
} from "@/lib/explain";
import { parseParagraphs } from "@/lib/reading";

const CONTENT = [
  "O primeiro paragrafo abre o texto. Ele tem duas frases.",
  "O Sr. Silva chegou cedo. Depois saiu sem dizer nada. Ninguem entendeu.",
  "Este paragrafo vem depois e nunca deve ser enviado.",
].join("\n\n");

const { words, paragraphs } = parseParagraphs(CONTENT);

describe("explainRequest", () => {
  it("usa a frase do segmentador unico", () => {
    const index = words.indexOf("Silva");
    const request = explainRequest(words, paragraphs, index)!;
    expect(request.sentence).toBe("O Sr. Silva chegou cedo.");
    expect(words.slice(request.start, request.end).join(" ")).toBe(request.sentence);
  });

  it("leva o paragrafo anterior e o comeco do paragrafo, nunca o que vem depois", () => {
    const index = words.indexOf("saiu");
    const request = explainRequest(words, paragraphs, index)!;
    expect(request.sentence).toBe("Depois saiu sem dizer nada.");
    expect(request.before).toBe(
      "O primeiro paragrafo abre o texto. Ele tem duas frases.\n\nO Sr. Silva chegou cedo."
    );
    const sent = `${request.before} ${request.sentence}`;
    expect(sent).not.toContain("Ninguem");
    expect(sent).not.toContain("nunca deve");
  });

  it("nao atravessa o paragrafo quando falta ponto final", () => {
    const { words: w, paragraphs: p } = parseParagraphs("Um titulo sem ponto\n\nA frase seguinte.");
    const request = explainRequest(w, p, 1)!;
    expect(request.sentence).toBe("Um titulo sem ponto");
    expect(request.before).toBe("");
  });

  it("recorta uma frase longa demais em volta da palavra tocada", () => {
    const long = Array.from({ length: 400 }, (_, i) => `p${i}`).join(" ");
    const { words: w, paragraphs: p } = parseParagraphs(long);
    const request = explainRequest(w, p, 300)!;
    expect(request.end - request.start).toBe(MAX_SENTENCE_WORDS);
    expect(request.start).toBeLessThanOrEqual(300);
    expect(request.end).toBeGreaterThan(300);
  });
});

describe("explanationKey", () => {
  it("muda com o conteudo, o idioma e o intervalo da frase", () => {
    const range = { start: 3, end: 9 };
    const base = explanationKey("t1", "abc", "pt-BR", range);
    expect(explanationKey("t1", "abc", "pt-BR", range)).toBe(base);
    expect(explanationKey("t1", "abd", "pt-BR", range)).not.toBe(base);
    expect(explanationKey("t1", "abc", "en", range)).not.toBe(base);
    expect(explanationKey("t1", "abc", "pt-BR", { start: 3, end: 10 })).not.toBe(base);
    expect(explanationKey("t2", "abc", "pt-BR", range)).not.toBe(base);
  });
});

describe("parseExplanation", () => {
  it("corta a explicacao em 80 palavras", () => {
    const long = Array.from({ length: 120 }, () => "palavra").join(" ");
    const parsed = parseExplanation({ simple: "Simples.", translation: "", explanation: long }, false)!;
    expect(parsed.explanation.split(/\s+/)).toHaveLength(MAX_EXPLANATION_WORDS);
    expect(parsed.explanation.endsWith("…")).toBe(true);
  });

  it("mostra a traducao so em texto de outro idioma", () => {
    const raw = { simple: "Ele saiu.", translation: "Ele foi embora.", explanation: "Foi embora." };
    expect(parseExplanation(raw, true)?.translation).toBe("Ele foi embora.");
    expect(parseExplanation(raw, false)?.translation).toBeNull();
  });

  it("recusa resposta sem reescrita ou sem explicacao", () => {
    expect(parseExplanation({ simple: "", explanation: "x" }, false)).toBeNull();
    expect(parseExplanation({ simple: "x", explanation: " " }, false)).toBeNull();
    expect(parseExplanation(null, false)).toBeNull();
  });

  it("limitWords deixa intacto o que cabe", () => {
    expect(limitWords("  uma  frase curta ", 10)).toBe("uma frase curta");
  });
});

describe("continuacoes (US-146)", () => {
  const request = explainRequest(words, paragraphs, words.indexOf("saiu"))!;

  it("reaproveita o recorte: nada depois da frase entra no pedido", () => {
    for (const kind of ["simples", "exemplo"] as const) {
      const prompt = followUpPrompt(request, kind);
      expect(prompt).toContain("Depois saiu sem dizer nada.");
      expect(prompt).toContain("O Sr. Silva chegou cedo.");
      expect(prompt).not.toContain("Ninguem");
      expect(prompt).not.toContain("nunca deve ser enviado");
      expect(prompt).toContain(`${FOLLOW_UP_WORDS[kind]} palavras`);
    }
  });

  it("leva a explicacao ja dada, quando ha", () => {
    const prompt = followUpPrompt(request, "simples", {
      simple: "Ele foi embora calado.",
      explanation: "A saida sem aviso cria suspense.",
    });
    expect(prompt).toContain("Ele foi embora calado.");
    expect(prompt).toContain("A saida sem aviso cria suspense.");
  });

  it("corta no teto de cada tipo", () => {
    const long = Array.from({ length: 80 }, (_, index) => `p${index}`).join(" ");
    expect(parseFollowUp(long, "simples")!.split(" ")).toHaveLength(40);
    expect(parseFollowUp(long, "exemplo")!.split(" ")).toHaveLength(50);
    expect(parseFollowUp("   ", "exemplo")).toBeNull();
    expect(parseFollowUp("Um  exemplo\ncurto.", "exemplo")).toBe("Um exemplo curto.");
  });

  it("aceita so os dois tipos e separa a chave do cache", () => {
    expect(normalizeFollowUp("simples")).toBe("simples");
    expect(normalizeFollowUp("exemplo")).toBe("exemplo");
    expect(normalizeFollowUp("outro")).toBeNull();
    expect(followUpKey("k", "exemplo")).toBe("k:exemplo");
  });

  it("lista os campos na ordem do esquema", () => {
    expect(explanationFields(false)).toEqual(["simple", "explanation"]);
    expect(explanationFields(true)).toEqual(["simple", "translation", "explanation"]);
  });
});
