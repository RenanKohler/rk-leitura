import { expect, test } from "@playwright/test";
import { randomIp, registerByApi, updateSettings } from "./helpers";

test.beforeEach(async ({ context }) => {
  await context.setExtraHTTPHeaders({ "x-forwarded-for": randomIp() });
});

const SOURCE = [
  "# Guia de leitura",
  "",
  "Um paragrafo com **negrito**, *italico* e [um link](https://exemplo.com).",
  "",
  "## Passos",
  "",
  "- primeiro item da lista",
  "- segundo item da lista",
  "",
  "1. abrir o texto",
  "2. ler com calma",
  "",
  "> Uma citacao para fechar.",
].join("\n");

/**
 * Markdown colado: detectado sozinho, salvo como Markdown e exibido com a
 * formatacao, sem os simbolos no texto.
 */
test("texto colado em Markdown chega formatado ao leitor", async ({ page }) => {
  await registerByApi(page.request);
  await updateSettings(page.request, { readingMode: "flow" });

  await page.goto("/textos/novo");
  await page.getByRole("button", { name: "Colar" }).click();
  await page.getByRole("textbox", { name: "Texto" }).fill(SOURCE);
  await expect(page.getByRole("checkbox", { name: /Interpretar formatacao Markdown/ })).toBeChecked();
  await page.getByRole("button", { name: "Salvar e ler" }).click();

  await expect(page).toHaveURL(/\/leitor\//);
  // Sem titulo informado, vale o primeiro titulo do documento.
  await expect(page.getByText("Guia de leitura").first()).toBeVisible();

  const prose = page.locator(".reader-prose").first();
  await expect(prose.locator('p[data-kind="h1"]')).toHaveText(/Guia de leitura/);
  await expect(prose.locator('p[data-kind="h2"]')).toHaveText(/Passos/);
  await expect(prose.locator('p[data-kind="li"]')).toHaveCount(2);
  await expect(prose.locator('p[data-kind="oli"]').first()).toHaveAttribute("data-marker", "1.");
  await expect(prose.locator('p[data-kind="quote"]')).toHaveText(/Uma citacao para fechar\./);
  await expect(prose.locator(".md-bold")).toHaveText("negrito,");
  await expect(prose.locator(".md-italic")).toHaveText("italico");
  await expect(prose.locator(".md-link")).toHaveText(["um", "link."]);

  // Nenhum simbolo de formatacao no texto exibido.
  const shown = (await prose.textContent()) ?? "";
  expect(shown).not.toMatch(/[#*>\[\]]/);
});

/** Arquivo .md: importado pela aba Arquivo e lido no modo Paginas. */
test("arquivo .md e importado com a formatacao", async ({ page }) => {
  await registerByApi(page.request);
  await updateSettings(page.request, { readingMode: "page" });

  await page.goto("/textos/novo");
  await page.getByRole("button", { name: "Arquivo" }).click();
  await page.locator('input[type="file"]').setInputFiles({
    name: "guia.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(SOURCE, "utf8"),
  });

  await expect(page.getByRole("textbox", { name: "Titulo" })).toHaveValue("Guia de leitura");
  await page.getByRole("button", { name: "Salvar na biblioteca" }).click();

  await expect(page).toHaveURL(/\/leitor\//);
  const prose = page.locator(".reader-prose").first();
  await expect(prose.locator('p[data-kind="h1"]')).toHaveText(/Guia de leitura/);
  await expect(prose.locator('p[data-kind="li"]')).toHaveCount(2);
});
