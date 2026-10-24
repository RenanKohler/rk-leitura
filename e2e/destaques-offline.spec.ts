import { expect, test, type Page } from "@playwright/test";
import { createText, randomIp, registerByApi } from "./helpers";

/**
 * Destacar sem conexao (US-177): o service worker guarda o destaque e o envia
 * quando a rede volta; texto apagado nesse meio tempo descarta a entrada.
 */

test.beforeEach(async ({ context }) => {
  await context.setExtraHTTPHeaders({ "x-forwarded-for": randomIp() });
});

/** Espera o service worker assumir a pagina. */
async function controlled(page: Page) {
  await page.evaluate(() => navigator.serviceWorker.ready);
  if (!(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)))) {
    await page.reload();
    await page.evaluate(() => navigator.serviceWorker.ready);
  }
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
}

/** POST feito pela pagina, passando pelo service worker. */
function postFromPage(page: Page, url: string, data: object) {
  return page.evaluate(
    async ({ url, data }) => {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      return { status: response.status, body: await response.json() };
    },
    { url, data }
  );
}

const flush = (page: Page) =>
  page.evaluate(() =>
    navigator.serviceWorker.ready.then((registration) => registration.active?.postMessage({ type: "flush" }))
  );

test("destaque feito offline chega ao servidor quando a rede volta", async ({ page, context }) => {
  await registerByApi(page.request);
  const text = await createText(page.request, "Texto para destacar offline", 120);
  await page.goto("/dashboard");
  await controlled(page);

  await context.setOffline(true);
  const queued = await postFromPage(page, `/api/texts/${text.id}/destaques`, { start: 2, end: 6 });
  expect(queued).toEqual({ status: 202, body: { queued: true } });

  await context.setOffline(false);
  await flush(page);
  await expect
    .poll(async () => {
      const data = await (await page.request.get(`/api/texts/${text.id}/destaques`)).json();
      return data.highlights.map((item: { start: number; end: number }) => [item.start, item.end]);
    })
    .toEqual([[2, 6]]);
});

test("destaque enfileirado de um texto apagado é descartado sem erro", async ({ page, context }) => {
  await registerByApi(page.request);
  const text = await createText(page.request, "Texto que vai sumir", 80);
  const other = await createText(page.request, "Texto que fica", 80);
  await page.goto("/dashboard");
  await controlled(page);

  await context.setOffline(true);
  await postFromPage(page, `/api/texts/${text.id}/destaques`, { start: 0, end: 3 });
  await postFromPage(page, `/api/texts/${other.id}/destaques`, { start: 1, end: 4 });
  await context.setOffline(false);

  // Apagado em outro aparelho enquanto a fila esperava.
  expect((await page.request.delete(`/api/texts/${text.id}`)).ok()).toBeTruthy();
  await flush(page);

  // O 404 do texto apagado sai da fila e nao trava a entrada seguinte.
  await expect
    .poll(async () => (await (await page.request.get(`/api/texts/${other.id}/destaques`)).json()).highlights.length)
    .toBe(1);
  // Nenhum aviso com texto na tela (o anunciador de rotas do Next e um alerta vazio).
  await expect(page.getByRole("alert").filter({ hasText: /\S/ })).toHaveCount(0);
});

test("no leitor, o destaque offline aparece e é enviado depois", async ({ page, context }) => {
  await registerByApi(page.request);
  const text = await createText(page.request, "Texto do leitor offline", 200);
  await page.goto(`/leitor/${text.id}`);
  await expect(page.getByRole("button", { name: "Iniciar leitura" })).toBeVisible();
  await controlled(page);
  await expect(page.getByRole("button", { name: "Iniciar leitura" })).toBeVisible();

  await context.setOffline(true);
  await page.getByRole("button", { name: "Iniciar leitura" }).click();
  await page.getByRole("button", { name: "Destacar frase" }).first().click();
  await expect(page.getByText("Vai ser enviado quando a conexão voltar.").first()).toBeAttached();

  await context.setOffline(false);
  await flush(page);
  await expect
    .poll(async () => (await (await page.request.get(`/api/texts/${text.id}/destaques`)).json()).highlights.length)
    .toBe(1);
});
