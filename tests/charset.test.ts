import { describe, expect, it } from "vitest";
import { charsetFromContentType, charsetFromDocument, decodeBody, decodeTextFile } from "@/lib/charset";

const latin1 = (text: string) => new Uint8Array([...text].map((char) => char.charCodeAt(0)));
const utf8 = (text: string) => new TextEncoder().encode(text);

describe("codificacao das importacoes (US-178)", () => {
  it("usa o charset do cabecalho", () => {
    const bytes = latin1("<p>atenção</p>");
    expect(decodeBody(bytes, "text/html; charset=iso-8859-1")).toBe("<p>atenção</p>");
    expect(decodeBody(bytes, 'text/html; charset="windows-1252"')).toBe("<p>atenção</p>");
  });

  it("sem charset no cabecalho, vale a declaracao do documento", () => {
    const html = latin1('<html><head><meta charset="windows-1252"></head><body>ação</body></html>');
    expect(decodeBody(html, "text/html")).toContain("ação");

    const equiv = latin1(
      '<meta http-equiv="Content-Type" content="text/html; charset=ISO-8859-1"><p>coração</p>'
    );
    expect(decodeBody(equiv, null)).toContain("coração");

    const xml = latin1('<?xml version="1.0" encoding="ISO-8859-1"?><rss><title>Notícia</title></rss>');
    expect(decodeBody(xml, "application/rss+xml")).toContain("Notícia");
  });

  it("o cabecalho vence a declaracao do documento", () => {
    const bytes = utf8('<meta charset="iso-8859-1"><p>atenção</p>');
    expect(decodeBody(bytes, "text/html; charset=utf-8")).toContain("atenção");
  });

  it("codificacao nao reconhecida vale UTF-8", () => {
    const bytes = utf8("<p>atenção</p>");
    expect(decodeBody(bytes, "text/html; charset=x-inventada")).toBe("<p>atenção</p>");
    expect(charsetFromContentType("text/html; charset=x-inventada")).toBeNull();
    expect(charsetFromDocument(utf8('<meta charset="nada">'))).toBeNull();
  });

  it("sem declaracao nenhuma vale UTF-8", () => {
    expect(decodeBody(utf8("<p>atenção</p>"))).toBe("<p>atenção</p>");
  });

  it(".txt em Windows-1252 cai para Windows-1252 quando nao e UTF-8 valido", () => {
    expect(decodeTextFile(latin1("Não há acentuação perdida."))).toBe("Não há acentuação perdida.");
    // Aspas tipograficas do Windows (0x93, 0x94).
    expect(decodeTextFile(new Uint8Array([0x93, 0x6f, 0x69, 0x94]))).toBe("“oi”");
  });

  it(".txt em UTF-8 continua UTF-8", () => {
    expect(decodeTextFile(utf8("atenção"))).toBe("atenção");
    expect(decodeTextFile(new Uint8Array([0xef, 0xbb, 0xbf, ...utf8("ação")]))).toBe("ação");
  });
});
