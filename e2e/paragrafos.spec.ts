import { expect, test } from "@playwright/test";
import { openReader, randomIp, registerByApi, updateSettings } from "./helpers";

test.beforeEach(async ({ context }) => {
  await context.setExtraHTTPHeaders({ "x-forwarded-for": randomIp() });
});

const CONTENT = [
  "O primeiro paragrafo tem palavras e termina aqui.",
  "O segundo paragrafo comeca nesta linha e segue ate o ponto final.",
].join("\n\n");

async function createTwoParagraphs(page: import("@playwright/test").Page) {
  const response = await page.request.post("/api/texts", {
    data: { title: "Dois paragrafos", content: CONTENT },
  });
  expect(response.ok()).toBeTruthy();
  return (await response.json()).text as { id: string };
}

/** Rolagem: o paragrafo abre com recuo de primeira linha, sem texto extra. */
test("paragrafo comeca com recuo na rolagem", async ({ page }) => {
  await registerByApi(page.request);
  await updateSettings(page.request, { readingMode: "flow" });
  const text = await createTwoParagraphs(page);

  await openReader(page, text.id);
  const paragraphs = page.locator(".reader-prose p");
  await expect(paragraphs).toHaveCount(2);
  for (const index of [0, 1]) {
    const indent = await paragraphs.nth(index).evaluate((el) => getComputedStyle(el).textIndent);
    expect(parseFloat(indent)).toBeGreaterThan(0);
  }
  await expect(paragraphs.nth(1)).toHaveText(/^O segundo paragrafo/);
});

/**
 * Foco: com blocos de 3 palavras, o bloco para no fim do paragrafo e o
 * seguinte abre com o sinal de paragrafo.
 */
test("modo foco sinaliza o inicio do paragrafo", async ({ page }) => {
  await registerByApi(page.request);
  await updateSettings(page.request, {
    readingMode: "rsvp",
    wordsPerChunk: 3,
    baseWpm: 100,
    warmup: false,
  });
  const text = await createTwoParagraphs(page);

  await openReader(page, text.id);
  await expect(page.getByTestId("inicio-paragrafo")).toHaveCount(0);
  await page.getByRole("button", { name: "Iniciar leitura" }).click();

  // 8 palavras no primeiro paragrafo: o terceiro bloco fica com 2 palavras
  // em vez de juntar "aqui." com o comeco do paragrafo seguinte.
  const word = page.locator(".reader-word").first();
  await expect(word).toHaveText("termina aqui.", { timeout: 15_000 });
  await expect(page.getByTestId("inicio-paragrafo")).toHaveCount(0);
  await expect(word).toHaveText("O segundo paragrafo", { timeout: 15_000 });
  await expect(page.getByTestId("inicio-paragrafo")).toBeVisible();
});
