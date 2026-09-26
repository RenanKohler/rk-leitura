import { expect, test, type Page } from "@playwright/test";
import { randomIp, registerByApi, updateSettings } from "./helpers";

test.beforeEach(async ({ context }) => {
  await context.setExtraHTTPHeaders({ "x-forwarded-for": randomIp() });
});

const ARTICLE = [
  "A memoria de trabalho guarda poucos itens por vez [1]. Miller (1956) estimou sete itens, e trabalhos",
  "posteriores reduziram esse numero (Cowan, 2001; Oberauer et al., 2016). A leitura depende dela [2, 3].",
  "",
  "Referências",
  "",
  "1. Baddeley A. Working memory. Science. 1992.",
].join("\n");

async function paste(page: Page) {
  await page.goto("/textos/novo");
  await page.getByRole("button", { name: "Colar" }).click();
  await page.getByRole("textbox", { name: "Titulo" }).fill("Artigo");
  await page.getByRole("textbox", { name: "Texto" }).fill(ARTICLE);
}

/** Artigo cientifico: citacoes e lista de referencias ficam fora da leitura. */
test("referencias do corpo sao omitidas na importacao", async ({ page }) => {
  await registerByApi(page.request);
  await updateSettings(page.request, { readingMode: "flow" });
  await paste(page);

  const option = page.getByTestId("referencias");
  await expect(option).toContainText("citacoes");
  await expect(option.getByRole("checkbox")).toBeChecked();
  await page.getByRole("button", { name: "Salvar e ler" }).click();

  await expect(page).toHaveURL(/\/leitor\//);
  const prose = page.locator(".reader-prose").first();
  await expect(prose).toContainText("guarda poucos itens por vez.");
  await expect(prose).toContainText("Miller estimou sete itens");
  await expect(prose).not.toContainText("[1]");
  await expect(prose).not.toContainText("Cowan");
  await expect(prose).not.toContainText("Baddeley");
});

test("leitor pode manter as referencias", async ({ page }) => {
  await registerByApi(page.request);
  await updateSettings(page.request, { readingMode: "flow" });
  await paste(page);

  await page.getByTestId("referencias").getByRole("checkbox").uncheck();
  await page.getByRole("button", { name: "Salvar e ler" }).click();

  await expect(page).toHaveURL(/\/leitor\//);
  await expect(page.locator(".reader-prose").first()).toContainText("[1]");
});
