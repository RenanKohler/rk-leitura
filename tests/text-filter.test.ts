import { describe, expect, it } from "vitest";
import {
  ACCENTED,
  asTextStatus,
  escapeLike,
  foldForSearch,
  MAX_QUERY_CHARS,
  normalizeQuery,
  UNACCENTED,
} from "@/lib/text-filter";

/**
 * A dobra de acento acontece duas vezes: aqui, no termo digitado, e em SQL,
 * no titulo consultado. Se as duas divergirem, "coracao" deixa de achar
 * "coração" sem que nada falhe de forma visivel.
 */

describe("mapa de acentos", () => {
  it("tem o mesmo tamanho dos dois lados", () => {
    // `translate()` no Postgres apaga os caracteres de `from` que nao tem par
    // em `to`. Listas de tamanhos diferentes fariam letras sumirem do titulo.
    expect([...ACCENTED]).toHaveLength([...UNACCENTED].length);
  });

  it("nao repete letra na lista acentuada", () => {
    expect(new Set([...ACCENTED]).size).toBe([...ACCENTED].length);
  });

  it("mapeia so para letras sem acento", () => {
    expect(UNACCENTED).toMatch(/^[a-z]+$/);
  });
});

describe("foldForSearch", () => {
  it("tira acento e caixa", () => {
    expect(foldForSearch("Coração")).toBe("coracao");
    expect(foldForSearch("ATENÇÃO")).toBe("atencao");
    expect(foldForSearch("Ilusões")).toBe("ilusoes");
  });

  it("colapsa espaco e apara as bordas", () => {
    expect(foldForSearch("  a   cabana  ")).toBe("a cabana");
  });

  it("deixa passar o que nao tem acento", () => {
    expect(foldForSearch("The Cabin Ch. 01")).toBe("the cabin ch. 01");
  });

  it("e idempotente", () => {
    const uma = foldForSearch("Coração Partido");
    expect(foldForSearch(uma)).toBe(uma);
  });
});

describe("normalizeQuery", () => {
  it("devolve null quando nao ha o que filtrar", () => {
    expect(normalizeQuery("")).toBeNull();
    expect(normalizeQuery("   ")).toBeNull();
    expect(normalizeQuery(null)).toBeNull();
    expect(normalizeQuery(42)).toBeNull();
  });

  it("dobra e corta o termo longo demais", () => {
    expect(normalizeQuery(" Coração ")).toBe("coracao");
    expect(normalizeQuery("a".repeat(500))).toHaveLength(MAX_QUERY_CHARS);
  });
});

describe("escapeLike", () => {
  it("trata os curingas como texto comum", () => {
    // Sem isto, buscar "100%" listaria a biblioteca inteira.
    expect(escapeLike("100%")).toBe("100\\%");
    expect(escapeLike("a_b")).toBe("a\\_b");
    expect(escapeLike("c:\\temp")).toBe("c:\\\\temp");
  });

  it("nao mexe em texto comum", () => {
    expect(escapeLike("the cabin")).toBe("the cabin");
  });
});

describe("asTextStatus", () => {
  it("aceita os quatro estados", () => {
    for (const valor of ["todos", "nao-iniciados", "em-andamento", "concluidos"]) {
      expect(asTextStatus(valor)).toBe(valor);
    }
  });

  it("cai no padrao para qualquer outra coisa", () => {
    expect(asTextStatus("inventado")).toBe("todos");
    expect(asTextStatus(null)).toBe("todos");
    expect(asTextStatus(undefined)).toBe("todos");
  });
});
