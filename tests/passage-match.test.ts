import { describe, expect, it } from "vitest";
import { cleanQuote, findPhrase, findQuote, matchKey, matchKeys, spanText } from "@/lib/passage-match";
import { parseParagraphs } from "@/lib/reading";

const { words } = parseParagraphs(
  "A Mais-valia é central. O capital — dizia ele — cresce.\n\nA mais-valia volta aqui, no fim."
);
const keys = matchKeys(words);

describe("matchKey", () => {
  it("ignora maiusculas e a pontuacao das pontas, mas nao o hifen do meio", () => {
    expect(matchKey("“Mais-valia,”")).toBe("mais-valia");
    expect(matchKey("—")).toBe("");
  });
});

describe("findPhrase", () => {
  it("acha a primeira ocorrencia e devolve o intervalo de palavras", () => {
    expect(findPhrase(keys, "mais-valia")).toEqual({ start: 1, end: 2 });
  });

  it("respeita o intervalo pedido", () => {
    const second = words.indexOf("mais-valia");
    expect(findPhrase(keys, "Mais-valia", 2)).toEqual({ start: second, end: second + 1 });
    expect(findPhrase(keys, "volta aqui", 0, second + 2)).toBeNull();
  });

  it("pula travessoes do texto no meio da frase", () => {
    const span = findPhrase(keys, "capital dizia ele cresce");
    expect(span).not.toBeNull();
    expect(spanText(words, span!)).toBe("capital — dizia ele — cresce.");
  });

  it("nao acha o que nao esta literalmente no texto", () => {
    expect(findPhrase(keys, "mais valia")).toBeNull();
    expect(findPhrase(keys, "")).toBeNull();
  });
});

describe("findQuote", () => {
  it("tira aspas e exige ao menos 3 palavras", () => {
    expect(cleanQuote('  "O capital cresce"  ')).toBe("O capital cresce");
    expect(findQuote(keys, "“A mais-valia volta aqui”", 0, words.length)).not.toBeNull();
    expect(findQuote(keys, "mais-valia volta", 0, words.length)).toBeNull();
  });

  it("descarta citacao fora do intervalo enviado", () => {
    expect(findQuote(keys, "A mais-valia volta aqui", 0, 8)).toBeNull();
  });
});
