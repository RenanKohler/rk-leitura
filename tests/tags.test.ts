import { describe, expect, it } from "vitest";
import {
  MAX_TAG_CHARS,
  MAX_TAGS_PER_TEXT,
  normalizeTagList,
  normalizeTagName,
  sameTag,
  sortTags,
  tagKey,
} from "@/lib/tags";
import { isUniqueViolation } from "@/lib/api";

describe("normalizeTagName", () => {
  it("tira espaco sobrando e junta espacos internos", () => {
    expect(normalizeTagName("  ficcao   cientifica  ")).toBe("ficcao cientifica");
  });

  it("preserva a caixa digitada", () => {
    expect(normalizeTagName("Estudo")).toBe("Estudo");
  });

  it("corta no tamanho maximo", () => {
    expect(normalizeTagName("x".repeat(MAX_TAG_CHARS + 10))!.length).toBe(MAX_TAG_CHARS);
  });

  it("recusa o que nao e nome", () => {
    expect(normalizeTagName("   ")).toBeNull();
    expect(normalizeTagName(12)).toBeNull();
    expect(normalizeTagName(null)).toBeNull();
  });
});

describe("comparacao de etiquetas", () => {
  it("ignora caixa e acento", () => {
    expect(sameTag("Ficção", "ficcao")).toBe(true);
    expect(tagKey("TRABALHO")).toBe("trabalho");
  });

  it("nomes diferentes continuam diferentes", () => {
    expect(sameTag("estudo", "estudos")).toBe(false);
  });
});

describe("normalizeTagList", () => {
  it("remove repeticao pela comparacao, nao pelo texto", () => {
    expect(normalizeTagList(["Estudo", "estudo", "ESTUDO"])).toEqual(["Estudo"]);
  });

  it("descarta entradas invalidas sem quebrar a lista", () => {
    expect(normalizeTagList(["ok", "", 5, null, " outra "])).toEqual(["ok", "outra"]);
  });

  it("limita a quantidade por texto", () => {
    const muitas = Array.from({ length: MAX_TAGS_PER_TEXT + 5 }, (_, i) => `e${i}`);
    expect(normalizeTagList(muitas)).toHaveLength(MAX_TAGS_PER_TEXT);
  });

  it("o que nao e lista vira lista vazia", () => {
    expect(normalizeTagList("estudo")).toEqual([]);
    expect(normalizeTagList(undefined)).toEqual([]);
  });
});

describe("sortTags", () => {
  it("ordena ignorando acento", () => {
    const ordenadas = sortTags([{ name: "zoologia" }, { name: "Ética" }, { name: "arte" }]);
    expect(ordenadas.map((tag) => tag.name)).toEqual(["arte", "Ética", "zoologia"]);
  });

  it("nao altera a lista recebida", () => {
    const original = [{ name: "b" }, { name: "a" }];
    sortTags(original);
    expect(original.map((tag) => tag.name)).toEqual(["b", "a"]);
  });
});

describe("isUniqueViolation", () => {
  it("acha o codigo no erro cru", () => {
    expect(isUniqueViolation({ code: "23505" })).toBe(true);
  });

  it("acha o codigo dentro da causa, como o Drizzle entrega", () => {
    expect(isUniqueViolation(new Error("falhou", { cause: { code: "23505" } }))).toBe(true);
  });

  it("nao confunde com outra falha", () => {
    expect(isUniqueViolation(new Error("falhou", { cause: { code: "23503" } }))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation("23505")).toBe(false);
  });

  it("nao entra em laco com causa circular", () => {
    const loop: { cause?: unknown } = {};
    loop.cause = loop;
    expect(isUniqueViolation(loop)).toBe(false);
  });
});
