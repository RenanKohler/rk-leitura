import { expect, test, type Page } from "@playwright/test";
import { createText, openReader, randomIp, registerByApi, updateSettings } from "./helpers";

/**
 * Plataforma de IA (US-123 a US-126). O ambiente de teste nao tem chave da
 * API: o que depende do modelo e simulado na rota, e o que se verifica e o
 * comportamento da aplicacao em volta dele.
 */

/**
 * Abre o significado da palavra atual pelo teclado. A primeira tecla logo
 * depois da hidratacao pode chegar antes do atalho estar ligado: repete ate
 * a folha abrir.
 */
async function openMeaning(page: Page) {
  await expect(async () => {
    await page.keyboard.press("d");
    await expect(page.getByRole("dialog")).toHaveCount(1, { timeout: 1000 });
  }).toPass();
}

// O service worker atende o fetch antes do page.route: bloqueado, a simulacao vale.
test.use({ serviceWorkers: "block" });

test.beforeEach(async ({ context, page }) => {
  await context.setExtraHTTPHeaders({ "x-forwarded-for": randomIp() });
  await page.emulateMedia({ reducedMotion: "reduce" });
});

test("sem chave, Ajustes e o diagnostico dizem que a IA nao esta configurada", async ({ page }) => {
  await registerByApi(page.request);

  const health = await (await page.request.get("/api/health")).json();
  expect(health.config.anthropicApiKey).toBe(false);
  expect((await page.request.get("/api/uso-ia")).status()).toBe(401);

  const usage = await (await page.request.get("/api/ia/uso")).json();
  expect(usage).toMatchObject({ configured: false, consent: "pending", quotas: [] });

  await page.goto("/ajustes#ia");
  await expect(page.getByTestId("ia-nao-configurada")).toHaveText(
    "Recursos de IA não configurados nesta instalação."
  );
});

test("o aviso de envio aparece antes da consulta e a escolha fica na conta", async ({ page }) => {
  await registerByApi(page.request);
  const text = await createText(page.request, "Consentimento", 80);

  await page.route("**/api/dicionario", async (route) => {
    const settings = await (await page.request.get("/api/settings")).json();
    if (settings.settings.aiEnabled !== true) {
      await route.fulfill({
        status: 403,
        json: { error: "Permita o envio.", consent: "pending", saved: false },
      });
      return;
    }
    await route.fulfill({
      json: {
        entry: { word: "x", base: "palavra", kind: "substantivo", definition: "Definição simulada.", translation: null },
        cached: false,
      },
    });
  });

  // O guia de primeiro uso cobriria a folha.
  await updateSettings(page.request, { readerTipsSeen: true });
  await openReader(page, text.id);
  await openMeaning(page);
  await expect(page.getByTestId("ia-consentimento")).toBeVisible();
  await expect(page.getByText("serviço externo (Anthropic)")).toBeVisible();

  await page.getByRole("button", { name: "Permitir" }).click();
  await expect(page.getByText("Definição simulada.")).toBeVisible();

  const settings = await (await page.request.get("/api/settings")).json();
  expect(settings.settings.aiEnabled).toBe(true);

  // Quem salva as preferencias sem conhecer o campo nao apaga a escolha.
  const { aiEnabled: _ignored, ...rest } = settings.settings;
  void _ignored;
  await page.request.put("/api/settings", { data: rest });
  expect((await (await page.request.get("/api/settings")).json()).settings.aiEnabled).toBe(true);
});

test("com a IA desligada, a palavra pode ser guardada para revisar", async ({ page }) => {
  await registerByApi(page.request);
  const text = await createText(page.request, "Desligada", 80);
  await page.route("**/api/dicionario", (route) =>
    route.fulfill({
      status: 403,
      json: { error: "Os recursos de IA estão desligados nesta conta.", consent: "off", saved: false },
    })
  );

  // O guia de primeiro uso cobriria a folha.
  await updateSettings(page.request, { readerTipsSeen: true });
  await openReader(page, text.id);
  await openMeaning(page);
  await expect(page.getByTestId("ia-desligada")).toBeVisible();
  await expect(page.getByRole("button", { name: "Guardar para revisar" })).toBeVisible();
});
