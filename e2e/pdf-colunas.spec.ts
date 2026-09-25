import { expect, test } from "@playwright/test";
import path from "node:path";
import { randomIp, registerByApi, updateSettings } from "./helpers";

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
  await updateSettings(page.request, { readingMode: "flow" });

  await page.goto("/textos/novo");
  await page.getByRole("button", { name: "Arquivo" }).click();
  await page
    .locator('input[type="file"]')
    .setInputFiles(path.join(__dirname, "fixtures", "artigo-duas-colunas.pdf"));

  // Sem titulo nos metadados, vale o primeiro titulo do documento.
  await expect(page.getByRole("textbox", { name: "Titulo" })).toHaveValue(
    "Recent theoretical, neural, and clinical advances in sustained attention research",
    { timeout: 20_000 }
  );
  await page.getByRole("button", { name: "Salvar na biblioteca" }).click();
  await expect(page).toHaveURL(/\/leitor\//);

  const prose = page.locator(".reader-prose").first();
  await expect(prose.locator('p[data-kind="h1"]')).toHaveText(/sustained attention research/);
  await expect(prose.locator('p[data-kind="h2"]').first()).toHaveText(/Introduction/);

  // O texto salvo: a tela so renderiza uma janela ao redor da posicao.
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
