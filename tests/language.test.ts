import { describe, expect, it } from "vitest";
import { asLanguage, languageName, normalizeLanguage, speechLanguage } from "@/lib/language";
import { extractTextFromHtml } from "@/lib/parser";
import { parseOpf } from "@/lib/epub-text";
import { contentKey, quizKey } from "@/lib/quiz";

const body = "<p>" + "palavra ".repeat(40) + "</p>";

describe("idioma do texto", () => {
  it("normaliza variantes regionais para a lista", () => {
    expect(normalizeLanguage("en-US")).toBe("en");
    expect(normalizeLanguage("en_GB")).toBe("en");
    expect(normalizeLanguage("pt-PT")).toBe("pt-BR");
    expect(normalizeLanguage("PT")).toBe("pt-BR");
    expect(normalizeLanguage("es")).toBe("es");
  });

  it("fora da lista vira portugues", () => {
    expect(normalizeLanguage("ja")).toBeNull();
    expect(asLanguage("ja")).toBe("pt-BR");
    expect(asLanguage(undefined)).toBe("pt-BR");
    expect(asLanguage("")).toBe("pt-BR");
  });

  it("le o lang da pagina", () => {
    const html = `<html lang="en-US"><head><title>T</title></head><body><article>${body}</article></body></html>`;
    expect(extractTextFromHtml(html).language).toBe("en");
  });

  it("usa og:locale quando a raiz nao declara", () => {
    const html = `<html><head><meta property="og:locale" content="es_ES"><title>T</title></head><body><article>${body}</article></body></html>`;
    expect(extractTextFromHtml(html).language).toBe("es");
  });

  it("sem declaracao, nao inventa idioma", () => {
    const html = `<html><head><title>T</title></head><body><article>${body}</article></body></html>`;
    expect(extractTextFromHtml(html).language).toBeNull();
  });

  it("le o dc:language do EPUB", () => {
    const opf = `<package><metadata><dc:title>Livro</dc:title><dc:language>fr-FR</dc:language></metadata>
      <manifest><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/></manifest>
      <spine><itemref idref="c1"/></spine></package>`;
    expect(normalizeLanguage(parseOpf(opf, "").language)).toBe("fr");
  });

  it("nomeia e escolhe a voz do idioma", () => {
    expect(languageName("en")).toBe("Ingles");
    expect(speechLanguage("en")).toBe("en-US");
    expect(speechLanguage("pt-BR")).toBe("pt-BR");
  });
});

describe("chave do questionario por idioma", () => {
  it("portugues mantem a chave de antes", () => {
    expect(quizKey("abc", "pt-BR")).toBe(contentKey("abc"));
  });

  it("trocar o idioma gera outra chave", () => {
    expect(quizKey("abc", "en")).not.toBe(quizKey("abc", "pt-BR"));
    expect(quizKey("abc", "en")).not.toBe(quizKey("abc", "es"));
  });
});
