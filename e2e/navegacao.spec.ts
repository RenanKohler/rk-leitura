import { expect, test, type Page } from "@playwright/test";
import { openReader, randomIp, registerByApi, updateSettings } from "./helpers";

test.beforeEach(async ({ context, page }) => {
  await context.setExtraHTTPHeaders({ "x-forwarded-for": randomIp() });
  await page.emulateMedia({ reducedMotion: "reduce" });
});

async function createText(page: Page, content: string, format = "plain") {
  const response = await page.request.post("/api/texts", {
    data: { title: "Navegacao", content, format },
  });
  expect(response.ok()).toBeTruthy();
  return (await response.json()).text as { id: string };
}

const position = (page: Page) =>
  page.locator("header p.tabular").innerText().then((text) => Number(text.split("/")[0]!.trim()));

/** US-90: busca ignora acento e caixa, conta e circula pelos resultados. */
test("busca no texto posiciona a leitura no resultado", async ({ page }) => {
  await registerByApi(page.request);
  await updateSettings(page.request, { readingMode: "flow" });
  const text = await createText(
    page,
    "A Memória de trabalho guarda pouco. Outra frase qualquer aqui. A memoria de trabalho cansa. Fim da memória de trabalho, enfim."
  );

  await openReader(page, text.id);
  await page.getByRole("button", { name: "Navegar no texto" }).click();
  const field = page.getByRole("searchbox", { name: "Buscar no texto" });
  await field.fill("memoria de trabalho");
  await expect(page.getByTestId("busca-contagem")).toHaveText("1 de 3");

  await page.getByRole("button", { name: "Proximo" }).click();
  await expect(page.getByTestId("busca-contagem")).toHaveText("2 de 3");
  await page.getByRole("button", { name: "Proximo" }).click();
  await page.getByRole("button", { name: "Proximo" }).click();
  await expect(page.getByTestId("busca-contagem")).toHaveText("1 de 3");

  await field.fill("inexistente");
  await expect(page.getByText("Nada encontrado")).toBeVisible();

  await field.fill("memoria de trabalho");
  await page.getByRole("region", { name: "Buscar no texto" }).getByRole("listitem").nth(1).getByRole("button").click();
  expect(await position(page)).toBe(12);
});

/** US-91 e US-93: voltar a frase pelo botao e pelo teclado; velocidade e modo pelo teclado. */
test("voltar a frase e atalhos de teclado", async ({ page }) => {
  await registerByApi(page.request);
  await updateSettings(page.request, { readingMode: "flow", baseWpm: 300 });
  const text = await createText(page, "Primeira frase curta. Segunda frase tem seis palavras aqui. Terceira.");

  await openReader(page, text.id);
  await page.locator('[data-start="7"]').click();
  expect(await position(page)).toBe(8);
  await page.getByRole("button", { name: "Voltar a frase" }).click();
  expect(await position(page)).toBe(4);
  await page.keyboard.press("Shift+ArrowLeft");
  expect(await position(page)).toBe(1);

  await page.keyboard.press("ArrowUp");
  await expect(page.getByText("325 ppm").first()).toBeVisible();
  await page.keyboard.press("3");
  await expect(page.getByRole("button", { name: "Proxima pagina" }).first()).toBeVisible();

  await page.keyboard.press("?");
  await expect(page.getByRole("dialog", { name: "Atalhos de teclado" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Atalhos de teclado" })).toHaveCount(0);
});

/** US-89 e US-92: sumario de titulos e marcadores. */
test("sumario leva ao titulo e marcador guarda a posicao", async ({ page }) => {
  await registerByApi(page.request);
  await updateSettings(page.request, { readingMode: "flow" });
  const text = await createText(
    page,
    "# Inicio\n\nTexto de abertura aqui.\n\n## Segunda parte\n\nMais texto nesta parte.\n\n## Terceira parte\n\nFim.",
    "markdown"
  );

  await openReader(page, text.id);
  await page.getByRole("button", { name: "Navegar no texto" }).click();
  const sumario = page.getByRole("region", { name: "Sumario" });
  await expect(sumario.getByRole("button")).toHaveCount(3);
  await sumario.getByRole("button", { name: "Segunda parte" }).click();
  expect(await position(page)).toBe(6);

  await page.getByRole("button", { name: "Navegar no texto" }).click();
  await page.getByLabel("Nome do marcador").fill("Ponto chave");
  await page.getByRole("button", { name: "Marcar" }).click();
  await expect(page.getByRole("button", { name: /^Ponto chave/ })).toBeVisible();
  await page.keyboard.press("Escape");

  await page.locator('[data-start="0"]').click();
  expect(await position(page)).toBe(1);

  await page.getByRole("button", { name: "Navegar no texto" }).click();
  await page.getByRole("button", { name: /^Ponto chave/ }).click();
  expect(await position(page)).toBe(6);
});

/** US-103: com a opcao ligada, so a linha atual fica com cor cheia durante a leitura. */
test("linhas fora da atual ficam apagadas enquanto le", async ({ page }) => {
  await registerByApi(page.request);
  await updateSettings(page.request, { readingMode: "flow", dimLines: true, baseWpm: 60, warmup: false });
  const words = Array.from({ length: 120 }, (_, i) => `palavra${i}`).join(" ");
  const text = await createText(page, words);

  await openReader(page, text.id);
  await expect(page.locator("[data-dim]")).toHaveCount(0);
  await page.getByRole("button", { name: "Iniciar leitura" }).click();
  await expect(page.locator("[data-dim]")).toHaveCount(1);
  const opacity = (selector: string) =>
    page.locator(selector).first().evaluate((el) => Number(getComputedStyle(el).opacity));
  await expect.poll(() => opacity('[data-start="0"]')).toBe(1);
  await expect.poll(() => opacity('[data-start="100"]')).toBeLessThan(0.5);
  await page.getByRole("button", { name: "Pausar" }).first().click();
  await expect(page.locator("[data-dim]")).toHaveCount(0);
});

/** US-95: depois de uma pausa longa, a leitura recomeca algumas palavras antes. */
test("retomar depois de pausa longa recua ate 5 palavras", async ({ page }) => {
  await registerByApi(page.request);
  await updateSettings(page.request, { readingMode: "rsvp", baseWpm: 150, warmup: false, wordsPerChunk: 1 });
  const words = Array.from({ length: 60 }, (_, i) => `termo${i}`).join(" ");
  const text = await createText(page, words);

  await openReader(page, text.id);
  await page.getByRole("button", { name: "Iniciar leitura" }).click();
  await page.waitForTimeout(4_000);
  await page.getByRole("button", { name: "Pausar" }).first().click();
  const paused = await position(page);
  expect(paused).toBeGreaterThan(6);

  await page.waitForTimeout(5_300);
  await page.getByRole("button", { name: "Iniciar leitura" }).click();
  expect(await position(page)).toBe(paused - 5);
});
