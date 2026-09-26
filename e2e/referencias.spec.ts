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

/** Texto ja salvo: omitir e restaurar mantem destaque, marcador e posicao nas mesmas palavras. */
test("reprocessar texto salvo remapeia destaques, marcadores e posicao", async ({ page }) => {
  await registerByApi(page.request);
  await updateSettings(page.request, { readingMode: "flow" });
  const created = await page.request.post("/api/texts", {
    data: { title: "Artigo antigo", content: ARTICLE, keepCitations: true },
  });
  const { id } = (await created.json()).text as { id: string };
  // 0 A 1 memoria 2 de 3 trabalho 4 guarda 5 poucos 6 itens 7 por 8 vez 9 [1]. 10 Miller 11 (1956) 12 estimou 13 sete 14 itens,
  const excerpt = async () =>
    ((await (await page.request.get(`/api/texts/${id}/destaques`)).json()).highlights[0].excerpt as string);
  const detail = async () => (await (await page.request.get(`/api/texts/${id}`)).json()).text;
  const bookmark = async () =>
    (await (await page.request.get(`/api/texts/${id}/marcadores`)).json()).bookmarks[0].position as number;
  await page.request.post(`/api/texts/${id}/destaques`, { data: { start: 12, end: 14 } });
  await page.request.post(`/api/texts/${id}/marcadores`, { data: { position: 10, label: "Miller" } });
  await page.request.patch(`/api/texts/${id}`, { data: { progressIndex: 12, at: new Date().toISOString() } });
  expect((await detail()).progressIndex).toBe(12);

  expect(await excerpt()).toBe("estimou sete");

  await page.goto("/ajustes");
  await page.getByRole("button", { name: "Procurar artigos com referencias" }).dispatchEvent("click");
  await expect(page.getByTestId("reprocessar-lista")).toContainText("Artigo antigo");
  await page.getByRole("button", { name: /Omitir em 1 texto/ }).dispatchEvent("click");
  await expect(page.getByText("Referencias omitidas em 1 texto.")).toBeVisible();

  const omitted = await detail();
  expect(omitted.content).not.toContain("[1]");
  expect(omitted.content).not.toContain("Baddeley");
  expect(await excerpt()).toBe("estimou sete");
  expect(omitted.progressIndex).toBe(10); // "estimou" sem [1]. e (1956)
  expect(await bookmark()).toBe(9); // "Miller"

  await page.goto(`/leitor/${id}`);
  await page.getByRole("button", { name: "Ajustes de leitura" }).click();
  await page.getByRole("button", { name: "Restaurar referencias" }).click();
  await expect(page.locator(".reader-prose").first()).toContainText("[1]");

  const restored = await detail();
  expect(restored.content).toBe(ARTICLE);
  expect(await excerpt()).toBe("estimou sete");
  expect(restored.progressIndex).toBe(12);
  expect(await bookmark()).toBe(10);
});
