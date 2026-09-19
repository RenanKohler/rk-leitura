import { describe, expect, it } from "vitest";
import {
  MAX_CONTEXT_CHARS,
  MAX_WORD_CHARS,
  normalizeWord,
  parseEntry,
  sentenceAround,
  trimContext,
  unescapeUnicode,
  wordAround,
  wordKey,
} from "@/lib/dictionary";

describe("normalizeWord", () => {
  it("tira pontuacao das pontas", () => {
    expect(normalizeWord('"casa",')).toBe("casa");
    expect(normalizeWord("(intransitavel)")).toBe("intransitavel");
  });

  it("preserva hifen e apostrofo internos", () => {
    expect(normalizeWord("guarda-chuva")).toBe("guarda-chuva");
    expect(normalizeWord("d'agua")).toBe("d'agua");
  });

  it("recusa o que nao tem letra", () => {
    expect(normalizeWord("—")).toBeNull();
    expect(normalizeWord("123")).toBeNull();
    expect(normalizeWord("  ")).toBeNull();
    expect(normalizeWord(42)).toBeNull();
  });

  it("corta no tamanho maximo", () => {
    expect(normalizeWord("a".repeat(MAX_WORD_CHARS + 20))!.length).toBe(MAX_WORD_CHARS);
  });
});

describe("wordKey", () => {
  it("ignora caixa e acento", () => {
    expect(wordKey("Intransitável")).toBe(wordKey("intransitavel"));
  });
});

describe("wordAround", () => {
  const texto = "A estrada de terra estava intransitavel, e ela deixou o carro.";

  it("acha a palavra sob o toque", () => {
    expect(wordAround(texto, texto.indexOf("intransitavel") + 3)).toBe("intransitavel");
  });

  it("acha a palavra pela primeira letra", () => {
    expect(wordAround(texto, texto.indexOf("estrada"))).toBe("estrada");
  });

  it("um toque na pontuacao colada resolve para a palavra anterior", () => {
    expect(wordAround(texto, texto.indexOf("intransitavel,") + 13)).toBe("intransitavel");
  });

  it("o espaco logo apos a palavra ainda resolve para ela", () => {
    expect(wordAround("a  b", 1)).toBe("a");
  });

  it("longe de qualquer palavra nao resolve para nada", () => {
    expect(wordAround("a  b", 2)).toBeNull();
    expect(wordAround("  ab", 0)).toBeNull();
  });

  it("devolve nulo quando nao ha palavra por perto", () => {
    expect(wordAround("   ", 1)).toBeNull();
  });

  it("junta a palavra composta", () => {
    expect(wordAround("um guarda-chuva novo", 6)).toBe("guarda-chuva");
  });

  it("aguenta posicao fora do texto", () => {
    expect(wordAround("casa", 999)).toBe("casa");
    expect(wordAround("", 0)).toBeNull();
  });
});

describe("sentenceAround", () => {
  it("recorta em volta da posicao", () => {
    const longo = "palavra ".repeat(200);
    expect(sentenceAround(longo, 800).length).toBeLessThanOrEqual(MAX_CONTEXT_CHARS);
  });

  it("nao estoura no comeco do texto", () => {
    expect(sentenceAround("uma frase curta", 2)).toBe("uma frase curta");
  });
});

describe("trimContext", () => {
  it("junta espacos e corta no limite", () => {
    expect(trimContext("  a   b  ")).toBe("a b");
    expect(trimContext("x".repeat(1000)).length).toBe(MAX_CONTEXT_CHARS);
    expect(trimContext(null)).toBe("");
  });
});

describe("parseEntry", () => {
  it("aceita uma definicao completa", () => {
    const entry = parseEntry(
      { base: "intransitável", kind: "adjetivo", definition: "por onde nao se pode passar" },
      "intransitavel"
    )!;
    expect(entry.base).toBe("intransitável");
    expect(entry.word).toBe("intransitavel");
  });

  it("recusa resposta sem definicao", () => {
    expect(parseEntry({ base: "x" }, "x")).toBeNull();
    expect(parseEntry(null, "x")).toBeNull();
    expect(parseEntry({ definition: "   " }, "x")).toBeNull();
  });

  it("cai na propria palavra quando nao vem forma base", () => {
    expect(parseEntry({ definition: "algo" }, "casas")!.base).toBe("casas");
  });
});

describe("unescapeUnicode", () => {
  it("decodifica o escape que o modelo escreveu como texto", () => {
    expect(unescapeUnicode("bra\\u00e7o")).toBe("braço");
    expect(unescapeUnicode("espa\\u00e7o e a\\u00e7\\u00e3o")).toBe("espaço e ação");
  });

  it("deixa intacto o que nao e escape", () => {
    expect(unescapeUnicode("braço")).toBe("braço");
    expect(unescapeUnicode("c:\\users\\joao")).toBe("c:\\users\\joao");
  });

  it("nao monta substituto solto", () => {
    expect(unescapeUnicode("\\ud800")).toBe("\\ud800");
  });

  it("a definicao chega limpa ao painel", () => {
    const entry = parseEntry({ definition: "parte que cobre o bra\\u00e7o" }, "manga")!;
    expect(entry.definition).toBe("parte que cobre o braço");
  });
});
