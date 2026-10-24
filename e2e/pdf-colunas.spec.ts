import { expect, test } from "@playwright/test";
import path from "node:path";
import { randomIp, registerByApi } from "./helpers";

test.beforeEach(async ({ context }) => {
  await context.setExtraHTTPHeaders({ "x-forwarded-for": randomIp() });
});

/**
 * Artigo em duas colunas com cabecalho de largura cheia: a importacao le a
 * coluna da esquerda inteira antes da direita, mantem a frase que atravessa
 * a troca de coluna e marca os titulos.
 */
test("PDF de artigo em duas colunas chega na ordem de leitura", async ({ page }) => {
  await registerByApi(page.request);

  await page.goto("/textos/novo");
  await page.getByRole("radio", { name: "Arquivo" }).click();
  await page
    .locator('input[type="file"]')
    .setInputFiles(path.join(__dirname, "fixtures", "artigo-duas-colunas.pdf"));

  // Sem titulo nos metadados, vale o primeiro titulo do documento.
  await expect(page.getByRole("textbox", { name: "Título" })).toHaveValue(
    "Recent theoretical, neural, and clinical advances in sustained attention research",
    { timeout: 20_000 }
  );
  await page.getByRole("button", { name: "Salvar na biblioteca" }).click();
  await expect(page).toHaveURL(/\/leitor\//);

  const prose = page.locator(".reader-prose").first();
  await expect(prose.locator('p[data-kind="h1"]')).toHaveText(/sustained attention research/);
  // A pagina mostra so o comeco; os demais titulos aparecem no sumario.
  await page.getByRole("button", { name: "Navegar no texto" }).click();
  await expect(
    page.getByRole("region", { name: "Sumário" }).getByRole("button", { name: /Introduction/ })
  ).toBeVisible();
  await page.keyboard.press("Escape");

  // O texto salvo: a tela so mostra uma pagina por vez.
  const id = page.url().split("/leitor/")[1]!.split(/[?#]/)[0];
  const { text } = await (await page.request.get(`/api/texts/${id}`)).json();
  const content: string = text.content;
  expect(text.format).toBe("markdown");
  // O fim da coluna esquerda emenda no alto da direita, no mesmo paragrafo.
  expect(content).toContain("broadly defined and those whose research focuses");
  expect(content.indexOf("Paragraph 1 of the body")).toBeLessThan(
    content.indexOf("Paragraph 2 of the body")
  );
  // Cabecalho corrido e tarja lateral nao entram no texto.
  expect(content).not.toContain("ISSN");
  expect(content).not.toContain("Downloaded from");
});

/** US-181: PDF com senha e PDF danificado explicam o motivo, em portugues. */
test("PDF que não abre explica o motivo", async ({ page }) => {
  await registerByApi(page.request);
  await page.goto("/textos/novo");
  await page.getByRole("radio", { name: "Arquivo" }).click();
  const input = page.locator('input[type="file"]');

  await input.setInputFiles(path.join(__dirname, "fixtures", "protegido.pdf"));
  await expect(
    page.getByText("Este PDF é protegido por senha. Remova a senha e tente de novo.")
  ).toBeVisible({ timeout: 20_000 });

  await input.setInputFiles({
    name: "danificado.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\nisto nao e um pdf de verdade\n%%EOF"),
  });
  await expect(
    page.getByText("Não foi possível ler este PDF. O arquivo pode estar corrompido.")
  ).toBeVisible({ timeout: 20_000 });
});
