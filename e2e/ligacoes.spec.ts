import { expect, test, type Page, type Route } from "@playwright/test";
import { createText, randomIp, registerByApi, updateSettings } from "./helpers";

/**
 * Ligacoes entre textos (US-232), na tela Estudar. O modelo nao roda aqui:
 * o POST da rota e simulado no navegador quando a resposta precisa de IA. O
 * caso sem candidatos usa a rota de verdade, que responde sem chamar o
 * modelo, e prova que o texto de outra conta nao entra.
 */

// O service worker do app atende os fetch por conta propria, e o que passa
// por ele nao chega ao `page.route`.
test.use({ serviceWorkers: "block" });

test.beforeEach(async ({ context, page }) => {
  await context.setExtraHTTPHeaders({ "x-forwarded-for": randomIp() });
  await page.emulateMedia({ reducedMotion: "reduce" });
});

/** Simula so o POST da rota; conta as chamadas. */
async function mockLinks(page: Page, handler: (route: Route) => Promise<void> | void) {
  const calls: unknown[] = [];
  await page.route("**/api/texts/*/ligacoes", (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    calls.push(route.request().postData());
    return handler(route);
  });
  return calls;
}

test("sem outro texto sobre o assunto: avisa sem chamar o modelo, e outra conta nao conta", async ({
  browser,
  page,
}) => {
  // Outra conta com um texto do mesmo vocabulario.
  const baseURL = test.info().project.use.baseURL;
  const stranger = await browser.newContext({ baseURL, extraHTTPHeaders: { "x-forwarded-for": randomIp() } });
  await registerByApi(stranger.request, "Outra pessoa");
  await createText(stranger.request, "Texto de outra conta", 600);
  await stranger.close();

  await registerByApi(page.request);
  await updateSettings(page.request, { readerTipsSeen: true, aiEnabled: true });
  const text = await createText(page.request, "Único texto", 600);

  await page.goto(`/textos/${text.id}/estudar`);
  const panel = page.getByTestId("ligacoes");
  await expect(page.getByRole("heading", { name: "Ligações com outros textos" })).toBeVisible();
  await panel.getByRole("button", { name: "Procurar ligações" }).click();
  await expect(panel.getByText("Nenhum outro texto da biblioteca trata deste assunto ainda.")).toBeVisible();
  await expect(panel.getByTestId("ligacao")).toHaveCount(0);

  // A rota responde o mesmo sem gastar cota nem pedir consentimento.
  const response = await page.request.post(`/api/texts/${text.id}/ligacoes`);
  expect(response.ok()).toBeTruthy();
  const body = await response.json();
  expect(body.links).toEqual([]);
  expect(body.message).toBe("Nenhum outro texto da biblioteca trata deste assunto ainda.");
});

test("ligacoes com titulo, relacao, os dois trechos e ler a partir daqui", async ({ page }) => {
  await registerByApi(page.request);
  await updateSettings(page.request, { readerTipsSeen: true, aiEnabled: true });
  const text = await createText(page.request, "Texto de estudo", 600);
  const other = await createText(page.request, "Outro texto", 600);

  const calls = await mockLinks(page, (route) =>
    route.fulfill({
      json: {
        links: [
          {
            textId: other.id,
            title: "Outro texto",
            relation: "Complementa com outra visão sobre o ritmo das frases.",
            here: { quote: "leitura rapida exige atencao", start: 0, end: 4 },
            other: { quote: "ao ritmo das frases e ao sentido", start: 17, end: 23 },
            sameSeries: false,
          },
        ],
        message: null,
        cached: false,
      },
    })
  );

  await page.goto(`/textos/${text.id}/estudar`);
  const panel = page.getByTestId("ligacoes");
  expect(calls).toHaveLength(0);
  await panel.getByRole("button", { name: "Procurar ligações" }).click();

  const link = panel.getByTestId("ligacao");
  await expect(link).toHaveCount(1);
  await expect(link.getByRole("heading", { name: "Outro texto" })).toBeVisible();
  await expect(link.getByText("Complementa com outra visão sobre o ritmo das frases.")).toBeVisible();
  await expect(link.getByText("“ao ritmo das frases e ao sentido”")).toBeVisible();
  expect(calls).toHaveLength(1);

  // O trecho deste texto abre o leitor aqui.
  await expect(link.getByRole("link", { name: /leitura rapida exige atencao/ })).toHaveAttribute(
    "href",
    `/leitor/${text.id}?de=0`
  );

  // "Ler a partir daqui" abre o outro texto no trecho citado.
  const read = link.getByRole("link", { name: "Ler Outro texto a partir deste trecho" });
  await expect(read).toHaveText("Ler a partir daqui");
  const box = await read.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(48);
  await read.click();
  await expect(page).toHaveURL(new RegExp(`/leitor/${other.id}\\?de=17`));
});

test("o modelo nao achou ligacao clara: mostra o aviso", async ({ page }) => {
  await registerByApi(page.request);
  await updateSettings(page.request, { readerTipsSeen: true, aiEnabled: true });
  const text = await createText(page.request, "Texto de estudo", 600);
  await mockLinks(page, (route) =>
    route.fulfill({
      json: {
        links: [],
        message: "Não encontrei ligações claras com os outros textos da biblioteca.",
        cached: false,
      },
    })
  );

  await page.goto(`/textos/${text.id}/estudar`);
  const panel = page.getByTestId("ligacoes");
  await panel.getByRole("button", { name: "Procurar ligações" }).click();
  await expect(panel.getByText("Não encontrei ligações claras com os outros textos da biblioteca.")).toBeVisible();
});

test("texto de outra conta nao abre ligacoes", async ({ browser, page }) => {
  await registerByApi(page.request);
  const mine = await createText(page.request, "Meu texto", 300);

  const baseURL = test.info().project.use.baseURL;
  const stranger = await browser.newContext({ baseURL, extraHTTPHeaders: { "x-forwarded-for": randomIp() } });
  await registerByApi(stranger.request, "Outra pessoa");
  const response = await stranger.request.post(`/api/texts/${mine.id}/ligacoes`);
  expect(response.status()).toBe(404);
  await stranger.close();
});
