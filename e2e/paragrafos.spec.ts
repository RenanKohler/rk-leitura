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

/** Pagina: o paragrafo abre com recuo de primeira linha, sem texto extra. */
test("paragrafo comeca com recuo na pagina", async ({ page }) => {
  await registerByApi(page.request);
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
 * Word Runner: a ultima palavra do paragrafo sai sem o sinal; a primeira do
 * seguinte abre com ele.
 */
test("o Word Runner sinaliza o inicio do paragrafo", async ({ page }) => {
  await registerByApi(page.request);
  await updateSettings(page.request, { baseWpm: 100, warmup: false });
  const text = await createTwoParagraphs(page);

  await openReader(page, text.id);
  await expect(page.getByTestId("inicio-paragrafo")).toHaveCount(0);
  await page.getByRole("button", { name: "Iniciar leitura" }).click();

  const word = page.getByTestId("palavra-runner");
  await expect(word).toHaveText("aqui.", { timeout: 15_000 });
  await expect(page.getByTestId("inicio-paragrafo")).toHaveCount(0);
  await expect(word).toHaveText("O", { timeout: 15_000 });
  await expect(page.getByTestId("inicio-paragrafo")).toBeVisible();
});
