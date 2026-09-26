import JSZip from "jszip";
import { expect, test } from "@playwright/test";
import { randomIp, registerByApi, updateSettings } from "./helpers";

test.beforeEach(async ({ context }) => {
  await context.setExtraHTTPHeaders({ "x-forwarded-for": randomIp() });
});

async function docx(): Promise<Buffer> {
  const zip = new JSZip();
  const p = (text: string, props = "") =>
    `<w:p>${props ? `<w:pPr>${props}</w:pPr>` : ""}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
  zip.file(
    "word/document.xml",
    `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>` +
      p("Relatorio anual", '<w:pStyle w:val="Heading1"/>') +
      `<w:p><w:r><w:t xml:space="preserve">Resultado </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>positivo</w:t></w:r><w:r><w:t xml:space="preserve"> no periodo.</w:t></w:r></w:p>` +
      `</w:body></w:document>`
  );
  zip.file("docProps/core.xml", "<cp:coreProperties><dc:title>Relatorio 2026</dc:title></cp:coreProperties>");
  return zip.generateAsync({ type: "nodebuffer" });
}

/** US-99: documento do Word entra como Markdown, com titulo e negrito. */
test("arquivo .docx e importado com a formatacao", async ({ page }) => {
  await registerByApi(page.request);
  await updateSettings(page.request, { readingMode: "flow" });

  await page.goto("/textos/novo");
  await page.getByRole("button", { name: "Arquivo" }).click();
  await page.locator('input[type="file"]').setInputFiles({
    name: "relatorio.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: await docx(),
  });

  await expect(page.getByRole("textbox", { name: "Titulo" })).toHaveValue("Relatorio 2026");
  await page.getByRole("button", { name: "Salvar na biblioteca" }).click();

  await expect(page).toHaveURL(/\/leitor\//);
  const prose = page.locator(".reader-prose").first();
  await expect(prose.locator('p[data-kind="h1"]')).toHaveText(/Relatorio anual/);
  await expect(prose.locator(".md-bold")).toHaveText(/positivo/);
});

test("arquivo que nao e .docx valido mostra erro", async ({ page }) => {
  await registerByApi(page.request);
  await page.goto("/textos/novo");
  await page.getByRole("button", { name: "Arquivo" }).click();
  await page.locator('input[type="file"]').setInputFiles({
    name: "protegido.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: Buffer.from("nao e zip"),
  });
  await expect(page.getByText(/Nao foi possivel ler o documento/)).toBeVisible();
});
