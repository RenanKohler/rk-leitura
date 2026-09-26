import { describe, expect, it } from "vitest";
import { countCitations, importContent, looksScientific, stripCitations } from "@/lib/citations";

describe("stripCitations", () => {
  it("remove citacoes numericas", () => {
    const { text, removed } = stripCitations(
      "A memoria de trabalho e limitada [1]. Estudos recentes [2, 3] e revisoes [4-7] confirmam [8–10, 12]."
    );
    expect(text).toBe("A memoria de trabalho e limitada. Estudos recentes e revisoes confirmam.");
    expect(removed).toBe(4);
  });

  it("remove citacoes autor-data entre parenteses", () => {
    const { text } = stripCitations(
      "O efeito foi descrito antes (Silva, 2020) e replicado (Silva et al., 2021; Souza & Lima, 2019a). " +
        "Ha excecoes (SMITH, 2018, p. 12), segundo a literatura (cf. Jones and Brown 2017)."
    );
    expect(text).toBe("O efeito foi descrito antes e replicado. Ha excecoes, segundo a literatura.");
  });

  it("na citacao narrativa mantem o nome e tira o ano", () => {
    expect(stripCitations("Como Miller (1956) mostrou, e Cowan (2001, p. 90) confirmou.").text).toBe(
      "Como Miller mostrou, e Cowan confirmou."
    );
  });

  it("remove link Markdown para a referencia, nota de rodape e sobrescrito", () => {
    expect(stripCitations("Texto [3](#ref-3) com nota [^2] e sobrescrito¹².").text).toBe(
      "Texto com nota e sobrescrito."
    );
  });

  it("mantem parenteses que nao sao citacao", () => {
    const source = "O teste (feito em 2020 com alunos) usou a escala (de 1 a 5) e o Brasil (pais) venceu [a].";
    expect(stripCitations(source).text).toBe(source);
    expect(countCitations(source)).toBe(0);
  });

  it("corta a lista de referencias no fim", () => {
    const body = "Primeira parte com citacao [1]. ".repeat(20);
    const result = stripCitations(`${body}\n\n## Referências\n\n1. Silva, J. Titulo. 2020.`);
    expect(result.referencesCut).toBe(true);
    expect(result.text).not.toMatch(/Referências|Titulo/);
  });

  it("titulo de referencias no comeco nao corta o texto", () => {
    const result = stripCitations(`References\n\n${"Texto sem nada. ".repeat(20)}`);
    expect(result.referencesCut).toBe(false);
  });
});

describe("importContent", () => {
  it("so limpa texto com pelo menos 3 citacoes", () => {
    expect(looksScientific("Um caso [1] e outro [2].")).toBe(false);
    expect(importContent("Um caso [1] e outro [2].", false)).toBe("Um caso [1] e outro [2].");
    expect(importContent("Um [1], dois [2] e tres (Silva, 2020).", false)).toBe("Um, dois e tres.");
  });

  it("respeita o pedido para manter", () => {
    const source = "Um [1], dois [2] e tres (Silva, 2020).";
    expect(importContent(source, true)).toBe(source);
  });
});
