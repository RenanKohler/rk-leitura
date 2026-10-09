import { describe, expect, it } from "vitest";
import {
  applyRemovals,
  MAX_PARAGRAPH_CHARS,
  numberedParagraphs,
  splitParagraphs,
  tagExcerpt,
  validLeftovers,
  validSuggestions,
} from "@/lib/import-analysis";

/**
 * A analise da previa nunca reescreve o texto (US-136, criterio 5): o modelo
 * aponta indices, e o que e salvo sai daqui. Os testes garantem que os
 * paragrafos mantidos chegam identicos ao extraido.
 */

const EXTRAIDO = [
  "Inicio | Politica | Esportes | Assine",
  "O primeiro paragrafo do artigo, com  espacos duplos e acentuação preservados.",
  "O segundo paragrafo continua a historia.",
  "Leia também: dez coisas que voce precisa saber",
  "Aceitamos cookies para melhorar sua experiencia.",
].join("\n\n");

describe("applyRemovals", () => {
  it("tira so os paragrafos apontados e mantem os demais identicos", () => {
    const salvo = applyRemovals(EXTRAIDO, [0, 3, 4]);
    const original = splitParagraphs(EXTRAIDO);
    expect(splitParagraphs(salvo)).toEqual([original[1], original[2]]);
    for (const paragrafo of splitParagraphs(salvo)) expect(EXTRAIDO).toContain(paragrafo);
  });

  it("sem remocao devolve o texto extraido sem tocar em nada", () => {
    expect(applyRemovals(EXTRAIDO, [])).toBe(EXTRAIDO);
  });

  it("devolver um paragrafo (Manter) faz ele voltar ao texto salvo", () => {
    const marcados = [0, 3, 4];
    const mantidos = new Set([3]);
    const salvo = applyRemovals(
      EXTRAIDO,
      marcados.filter((index) => !mantidos.has(index))
    );
    expect(salvo).toContain("Leia também");
    expect(salvo).not.toContain("Assine");
  });
});

describe("validLeftovers", () => {
  it("ignora indice fora do texto, repetido ou que nao e inteiro", () => {
    const resposta = [
      { index: 4, reason: "aviso" },
      { index: 0, reason: "navegação" },
      { index: 0, reason: "anúncio" },
      { index: 9, reason: "anúncio" },
      { index: 1.5, reason: "outro" },
      { index: "2", reason: "outro" },
    ];
    expect(validLeftovers(resposta, 5)).toEqual([
      { index: 0, reason: "navegação" },
      { index: 4, reason: "aviso" },
    ]);
  });

  it("troca motivo desconhecido por outro", () => {
    expect(validLeftovers([{ index: 1, reason: "spam" }], 3)).toEqual([
      { index: 1, reason: "outro" },
    ]);
  });

  it("nao marca nada quando o modelo aponta todos os paragrafos", () => {
    expect(validLeftovers([{ index: 0 }, { index: 1 }], 2)).toEqual([]);
  });

  it("resposta vazia ou malformada nao marca nada", () => {
    expect(validLeftovers(null, 5)).toEqual([]);
    expect(validLeftovers("0,1", 5)).toEqual([]);
  });
});

describe("numberedParagraphs", () => {
  it("numera cada paragrafo pelo indice usado na remocao", () => {
    const { prompt, count } = numberedParagraphs(EXTRAIDO);
    expect(count).toBe(5);
    expect(prompt.split("\n")[3]).toBe("[3] Leia também: dez coisas que voce precisa saber");
  });

  it("corta paragrafo longo e para no teto do pedido", () => {
    const longo = "palavra ".repeat(200).trim();
    const texto = [longo, longo, longo].join("\n\n");
    const { prompt, count } = numberedParagraphs(texto, 700);
    expect(count).toBe(2);
    expect(prompt.split("\n")[0]!.length).toBeLessThanOrEqual(MAX_PARAGRAPH_CHARS + 10);
  });
});

describe("tagExcerpt", () => {
  it("envia o titulo e so as primeiras palavras", () => {
    const texto = Array.from({ length: 3000 }, (_, index) => `p${index}`).join(" ");
    const recorte = tagExcerpt("Titulo", texto, 1500);
    expect(recorte.startsWith("Título: Titulo")).toBe(true);
    expect(recorte).toContain("p1499");
    expect(recorte).not.toContain("p1500");
  });
});

describe("validSuggestions", () => {
  const conta = ["Ficção", "estudo", "Trabalho", "Política"];

  it("so aceita etiquetas da conta, na grafia guardada, ate tres", () => {
    expect(
      validSuggestions(["ficcao", "Inventada", "ESTUDO", "trabalho", "Política"], conta)
    ).toEqual(["Ficção", "estudo", "Trabalho"]);
  });

  it("nao repete as ja escolhidas", () => {
    expect(validSuggestions(["Ficção", "estudo"], conta, ["ficção"])).toEqual(["estudo"]);
  });

  it("resposta malformada nao sugere nada", () => {
    expect(validSuggestions(undefined, conta)).toEqual([]);
  });
});
