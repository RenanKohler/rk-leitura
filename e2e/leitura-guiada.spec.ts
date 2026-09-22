import { expect, test } from "@playwright/test";
import {
  createText,
  openReader,
  progressOf,
  randomIp,
  registerByApi,
  updateSettings,
} from "./helpers";

test.beforeEach(async ({ context }) => {
  await context.setExtraHTTPHeaders({ "x-forwarded-for": randomIp() });
});

/**
 * Tempo livre (US-84, US-85): a sugestao abre o leitor com o ponto de parada,
 * e a leitura pausa no fim do trecho mostrando previsto e real.
 */
test("tempo livre sugere o texto que cabe no tempo", async ({ page }) => {
  await registerByApi(page.request);
  await updateSettings(page.request, { readingMode: "rsvp", baseWpm: 1200, warmup: false });
  // 3 paragrafos de 60 palavras: a 1200 ppm, 5 minutos cobrem o texto todo.
  await createText(page.request, "Texto curto para o tempo livre", 180);

  await page.goto("/dashboard");
  await page.getByRole("button", { name: "5 min" }).click();
  const suggestion = page
    .locator("#tempo-livre")
    .getByRole("link", { name: /Texto curto para o tempo livre/ });
  await expect(suggestion).toBeVisible();
  await expect(suggestion).toContainText("ate o fim do texto");
});

test("o leitor pausa no ponto de parada e compara previsto e real", async ({ page }) => {
  await registerByApi(page.request);
  await updateSettings(page.request, { readingMode: "rsvp", baseWpm: 1200, warmup: false });
  const text = await createText(page.request, "Texto com ponto de parada", 180);

  await page.goto(`/leitor/${text.id}?ate=60&previsto=3000`);
  await page.getByRole("button", { name: "Iniciar leitura" }).click();

  const sheet = page.getByRole("dialog", { name: "Fim do trecho previsto" });
  await expect(sheet).toBeVisible({ timeout: 15_000 });
  await expect(sheet).toContainText("previsto");
  await expect(sheet).toContainText("real");
  await expect.poll(() => progressOf(page.request, text.id)).toBeGreaterThanOrEqual(60);

  await sheet.getByRole("button", { name: "Continuar" }).click();
  await expect(page.getByRole("heading", { name: "Leitura concluida" })).toBeVisible({
    timeout: 15_000,
  });
});

/** Largar e retomar (US-79). */
test("largar tira o texto da lista e retomar o devolve", async ({ page }) => {
  await registerByApi(page.request);
  const text = await createText(page.request, "Texto que vai ser largado", 300);

  await openReader(page, text.id);
  await page.getByRole("button", { name: "Ajustes de leitura" }).click();
  await page.getByRole("button", { name: "Largar texto" }).click();
  await page
    .getByRole("dialog", { name: "Largar este texto?" })
    .getByRole("button", { name: "Largar texto" })
    .click();
  await expect(page).toHaveURL(/\/textos$/);

  await expect(page.getByText("Texto que vai ser largado")).toHaveCount(0);
  await page.getByRole("button", { name: "Largados" }).click();
  await expect(page.getByText("Texto que vai ser largado")).toBeVisible();

  await page.getByRole("button", { name: "Retomar" }).click();
  await page.getByRole("button", { name: "Todos" }).click();
  await expect(page.getByText("Texto que vai ser largado")).toBeVisible();
});

/** "Isso ainda vale?" (US-80): pergunta em 25% e nao repete o marco. */
test("marco de 25% pergunta uma vez", async ({ page }) => {
  await registerByApi(page.request);
  await updateSettings(page.request, {
    readingMode: "rsvp",
    baseWpm: 1200,
    warmup: false,
    askCheckpoints: true,
  });
  const text = await createText(page.request, "Texto longo com marcos", 900);

  await openReader(page, text.id);
  await page.getByRole("button", { name: "Iniciar leitura" }).click();

  const question = page.getByRole("dialog", { name: "Isso ainda vale?" });
  await expect(question).toBeVisible({ timeout: 20_000 });
  await expect(question).toContainText("25%");
  await question.getByRole("button", { name: "Continuar" }).click();

  // O marco respondido fica no servidor, para nao perguntar de novo.
  await expect
    .poll(async () => {
      const response = await page.request.get(`/api/texts/${text.id}`);
      return (await response.json()).text.checkpointAnswered;
    })
    .toBe(25);
});
