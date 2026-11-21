import { expect, test } from "@playwright/test";
import { createText, randomIp, registerByApi } from "./helpers";

/**
 * "Adicionar a uma serie": vincula textos soltos a mao, pela folha "Mais
 * acoes" da biblioteca. A deteccao automatica fica em `tests/series.test.ts`.
 */

test.use({ serviceWorkers: "block" });

test.beforeEach(async ({ context }) => {
  await context.setExtraHTTPHeaders({ "x-forwarded-for": randomIp() });
});

async function openSeriesSheet(page: import("@playwright/test").Page, title: string) {
  await page.getByRole("button", { name: `Mais ações: ${title}` }).click();
  await page.getByRole("button", { name: "Adicionar a uma série" }).click();
  const sheet = page.getByTestId("adicionar-serie");
  await expect(sheet.getByLabel("Série", { exact: true })).toBeVisible();
  return sheet;
}

test("cria a serie com um texto e junta outro como capitulo seguinte", async ({ page }) => {
  await registerByApi(page.request);
  await createText(page.request, "Primeira noite", 80);
  await createText(page.request, "Segunda noite", 80);

  await page.goto("/textos");
  const main = page.locator("#conteudo");

  let sheet = await openSeriesSheet(page, "Primeira noite");
  await expect(sheet.getByLabel("Série", { exact: true })).toHaveValue("__nova__");
  await sheet.getByLabel("Nome da nova série").fill("Noites no campo");
  await expect(sheet.getByLabel("Número do capítulo")).toHaveValue("1");
  await page.getByRole("button", { name: "Adicionar", exact: true }).click();
  await expect(page.getByText('Adicionado a "Noites no campo" como capítulo 1.')).toBeVisible();

  sheet = await openSeriesSheet(page, "Segunda noite");
  // A serie que existe vem escolhida, com o capitulo seguinte ao ultimo.
  await expect(sheet.getByLabel("Série", { exact: true })).not.toHaveValue("__nova__");
  await expect(sheet.getByLabel("Número do capítulo")).toHaveValue("2");
  await page.getByRole("button", { name: "Adicionar", exact: true }).click();
  await expect(page.getByText('Adicionado a "Noites no campo" como capítulo 2.')).toBeVisible();

  await expect(main.getByTestId("titulo-do-item").filter({ hasText: "Noites no campo" })).toBeVisible();
  await expect(main.getByText(/cap\. \d de 2/)).toBeVisible();
  await expect(main.getByRole("button", { name: "Mais ações: Segunda noite" })).toHaveCount(0);
});

test("capitulo ocupado e recusado com o nome de quem o ocupa", async ({ page }) => {
  await registerByApi(page.request);
  const first = await createText(page.request, "Capítulo de abertura", 80);
  await createText(page.request, "Outro texto", 80);
  const linked = await page.request.post("/api/series", {
    data: { texto: first.id, titulo: "Saga", capitulo: 1 },
  });
  expect(linked.ok()).toBeTruthy();

  await page.goto("/textos");
  const sheet = await openSeriesSheet(page, "Outro texto");
  await sheet.getByLabel("Número do capítulo").fill("1");
  await page.getByRole("button", { name: "Adicionar", exact: true }).click();
  await expect(sheet.getByText('O capítulo 1 desta série já é "Capítulo de abertura". Escolha outro número.')).toBeVisible();
});

test("texto de outra conta nao entra na serie", async ({ page, browser }) => {
  await registerByApi(page.request);
  const mine = await createText(page.request, "Meu texto", 80);

  const other = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": randomIp() } });
  await registerByApi(other.request);
  const response = await other.request.post("/api/series", {
    data: { texto: mine.id, titulo: "Invasão", capitulo: 1 },
  });
  expect(response.status()).toBe(404);
  await other.close();
});
