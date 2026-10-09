import { describe, expect, it } from "vitest";
import {
  analysisPrompt,
  META_EXCERPT_CHARS,
  metaExcerpt,
  normalizeAuthor,
  UNTITLED,
  validSuggestedAuthor,
  validSuggestedTitle,
} from "@/lib/import-analysis";
import { extractTextFromHtml } from "@/lib/parser";

/**
 * Titulo e autor sugeridos na previa da importacao (US-152). Do texto so vai
 * o comeco, e o autor so vale quando esta escrito nele.
 */

describe("metaExcerpt", () => {
  it("devolve o texto inteiro quando cabe", () => {
    expect(metaExcerpt("  Um texto curto.  ")).toBe("Um texto curto.");
  });

  it("corta em ate 2.000 caracteres sem partir palavra", () => {
    const longo = "palavra ".repeat(600);
    const recorte = metaExcerpt(longo);
    expect(recorte.length).toBeLessThanOrEqual(META_EXCERPT_CHARS);
    expect(recorte.endsWith("palavra")).toBe(true);
  });
});

describe("analysisPrompt", () => {
  const conteudo = ["Menu | Assine", "Primeiro paragrafo.", "Segundo paragrafo."].join("\n\n");

  it("junta limpeza e comeco na mesma mensagem", () => {
    const { prompt, count } = analysisPrompt(conteudo, { cleanup: true, meta: true });
    expect(count).toBe(3);
    expect(prompt).toContain("<paragrafos>\n[0] Menu | Assine");
    expect(prompt).toContain("<comeco>\nMenu | Assine");
  });

  it("so o comeco quando a limpeza nao foi pedida", () => {
    const { prompt, count } = analysisPrompt(conteudo, { cleanup: false, meta: true });
    expect(count).toBe(0);
    expect(prompt).not.toContain("<paragrafos>");
    expect(prompt).toContain("<comeco>");
  });

  it("o comeco nunca passa de 2.000 caracteres", () => {
    const longo = "x ".repeat(5_000);
    const { prompt } = analysisPrompt(longo, { cleanup: false, meta: true });
    expect(prompt.length).toBeLessThanOrEqual(META_EXCERPT_CHARS + "<comeco>\n\n</comeco>".length);
  });
});

describe("validSuggestedTitle", () => {
  it("limpa aspas e pontuacao final", () => {
    expect(validSuggestedTitle('  "A reforma da previdência."  ')).toBe("A reforma da previdência");
  });

  it("corta em 12 palavras", () => {
    const titulo = validSuggestedTitle("um dois tres quatro cinco seis sete oito nove dez onze doze treze");
    expect(titulo?.split(" ")).toHaveLength(12);
  });

  it("recusa vazio, curto demais e o titulo padrao", () => {
    expect(validSuggestedTitle("")).toBeNull();
    expect(validSuggestedTitle("ab")).toBeNull();
    expect(validSuggestedTitle(UNTITLED)).toBeNull();
    expect(validSuggestedTitle(42)).toBeNull();
  });
});

describe("validSuggestedAuthor", () => {
  const comeco = "Ensaio sobre a cegueira\n\nPor José Saramago\n\nEra uma vez...";

  it("aceita o nome escrito no comeco, sem o 'Por'", () => {
    expect(validSuggestedAuthor("Por José Saramago", comeco)).toBe("José Saramago");
    expect(validSuggestedAuthor("jose saramago", comeco)).toBe("jose saramago");
  });

  it("recusa nome que nao aparece no trecho", () => {
    expect(validSuggestedAuthor("Machado de Assis", comeco)).toBeNull();
  });

  it("recusa vazio e texto longo demais", () => {
    expect(validSuggestedAuthor("", comeco)).toBeNull();
    expect(validSuggestedAuthor("a".repeat(200), "a".repeat(400))).toBeNull();
  });
});

describe("normalizeAuthor", () => {
  it("guarda o nome sem espacos extras, ou nulo", () => {
    expect(normalizeAuthor("  Clarice   Lispector ")).toBe("Clarice Lispector");
    expect(normalizeAuthor("   ")).toBeNull();
    expect(normalizeAuthor(undefined)).toBeNull();
    expect(normalizeAuthor("x".repeat(500))).toHaveLength(120);
  });
});

describe("autor declarado pela pagina", () => {
  const corpo = `<article><p>${"Um paragrafo de texto com palavras suficientes para contar. ".repeat(5)}</p></article>`;

  it("le o autor do JSON-LD", () => {
    const html = `<html><head><title>Artigo</title><script type="application/ld+json">${JSON.stringify({
      "@type": "Article",
      headline: "Artigo",
      author: { "@type": "Person", name: "Ana Souza" },
    })}</script></head><body>${corpo}</body></html>`;
    expect(extractTextFromHtml(html).author).toBe("Ana Souza");
  });

  it("le a meta author e ignora endereco de perfil", () => {
    const meta = `<html><head><meta name="author" content="Bruno Lima"></head><body>${corpo}</body></html>`;
    expect(extractTextFromHtml(meta).author).toBe("Bruno Lima");
    const perfil = `<html><head><meta property="article:author" content="https://site.com/autor/x"></head><body>${corpo}</body></html>`;
    expect(extractTextFromHtml(perfil).author).toBeNull();
  });
});
