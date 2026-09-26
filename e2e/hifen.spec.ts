import { expect, test, type Page } from "@playwright/test";
import { openReader, randomIp, registerByApi, updateSettings } from "./helpers";

test.beforeEach(async ({ context }) => {
  await context.setExtraHTTPHeaders({ "x-forwarded-for": randomIp() });
});

// Tamanhos variados deslocam as palavras compostas por toda a largura da
// linha: alguma cai no fim, onde o navegador partiria no hifen.
const CONTENT = Array.from(
  { length: 40 },
  (_, i) => `${"a".repeat((i % 7) + 1)} guarda-chuva bem-${"v".repeat((i % 5) + 2)}indo`
).join(" ");

async function brokenCompounds(page: Page): Promise<number> {
  await expect(page.locator(".reader-prose .nobreak").first()).toBeVisible();
  return page.locator(".reader-prose .nobreak").evaluateAll(
    (spans) => spans.filter((span) => span.getClientRects().length > 1).length
  );
}

for (const mode of ["flow", "page"] as const) {
  test(`palavra com hifen nao quebra no fim da linha (${mode})`, async ({ page }) => {
    await registerByApi(page.request);
    await updateSettings(page.request, { readingMode: mode });
    const response = await page.request.post("/api/texts", { data: { title: "Hifen", content: CONTENT } });
    const text = (await response.json()).text as { id: string };

    await openReader(page, text.id);
    expect(await page.locator(".reader-prose .nobreak").count()).toBeGreaterThan(5);
    expect(await brokenCompounds(page)).toBe(0);
  });
}
