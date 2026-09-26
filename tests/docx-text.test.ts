import { describe, expect, it } from "vitest";
import { DocxError, docxTitle, docxToMarkdown } from "@/lib/docx-text";

const doc = (body: string) =>
  `<?xml version="1.0"?><w:document xmlns:w="x"><w:body>${body}<w:sectPr/></w:body></w:document>`;
const p = (runs: string, props = "") => `<w:p>${props ? `<w:pPr>${props}</w:pPr>` : ""}${runs}</w:p>`;
const r = (text: string, props = "") =>
  `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ""}<w:t xml:space="preserve">${text}</w:t></w:r>`;

const numbering = `<w:numbering>
  <w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum>
  <w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum>
  <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
  <w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>
</w:numbering>`;

describe("docxToMarkdown (US-99)", () => {
  it("titulos, paragrafos, negrito e italico", () => {
    const md = docxToMarkdown(
      doc(
        p(r("Relatorio"), '<w:pStyle w:val="Heading1"/>') +
          p(r("Texto com ") + r("forte", "<w:b/>") + r(" e ") + r("leve", "<w:i/>") + r(".")) +
          p(r("Sub"), '<w:pStyle w:val="Heading2"/>')
      )
    );
    expect(md).toBe("# Relatorio\n\nTexto com **forte** e *leve*.\n\n## Sub");
  });

  it("listas com marcador e numeradas", () => {
    const md = docxToMarkdown(
      doc(
        p(r("um"), '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>') +
          p(r("primeiro"), '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr>') +
          p(r("segundo"), '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr>')
      ),
      numbering
    );
    expect(md).toBe("- um\n\n1. primeiro\n\n2. segundo");
  });

  it("tabela vira linhas com celulas separadas por |", () => {
    const cell = (text: string) => `<w:tc>${p(r(text))}</w:tc>`;
    const md = docxToMarkdown(
      doc(`<w:tbl><w:tr>${cell("Nome")}${cell("Idade")}</w:tr><w:tr>${cell("Ana")}${cell("30")}</w:tr></w:tbl>`)
    );
    expect(md).toBe("Nome | Idade\n\nAna | 30");
  });

  it("ignora imagens e paragrafos vazios, decodifica entidades", () => {
    const md = docxToMarkdown(
      doc(p("<w:r><w:drawing>img</w:drawing></w:r>") + "<w:p/>" + p(r("A &amp; B &lt;ok&gt;")))
    );
    expect(md).toBe("A & B <ok>");
  });

  it("negrito desligado explicitamente nao marca", () => {
    expect(docxToMarkdown(doc(p(r("normal", '<w:b w:val="0"/>'))))).toBe("normal");
  });

  it("XML sem corpo e erro", () => {
    expect(() => docxToMarkdown("<nada/>")).toThrow(DocxError);
  });

  it("titulo das propriedades", () => {
    expect(docxTitle("<cp:coreProperties><dc:title>Plano &amp; metas</dc:title></cp:coreProperties>")).toBe(
      "Plano & metas"
    );
    expect(docxTitle(null)).toBeNull();
  });
});
