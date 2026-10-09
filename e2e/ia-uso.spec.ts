import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { runSql } from "./db";
import { createText, randomIp, registerByApi, updateSettings } from "./helpers";

/**
 * Historico de envios (US-144) e exclusao do que a IA gerou (US-143).
 *
 * O ambiente de teste nao tem chave: `/api/ia/uso` e simulado como
 * configurado, para o cartao aparecer. O resto e de verdade: as linhas de
 * `ai_usage`, `ai_results` e `ask_turns` vao direto no banco, como se as
 * chamadas tivessem acontecido.
 */

test.use({ serviceWorkers: "block" });

test.beforeEach(async ({ context, page }) => {
  await context.setExtraHTTPHeaders({ "x-forwarded-for": randomIp() });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("**/api/ia/uso", (route) =>
    route.fulfill({ json: { configured: true, consent: "on", timezone: "UTC", quotas: [] } })
  );
});

async function userId(request: APIRequestContext): Promise<string> {
  const me = await (await request.get("/api/auth/me")).json();
  return me.user.id as string;
}

async function openAiSettings(page: Page) {
  await page.goto("/ajustes#ia");
  await expect(page.getByRole("button", { name: "Histórico de envios" })).toBeVisible();
}

async function storeResults(user: string, textId: string) {
  await runSql(
    `insert into ai_results (user_id, text_id, kind, key, payload)
     values ($1, $2::uuid, 'resumo', $2::text || ':e2e', '{"points":["Um","Dois","Tres"]}')`,
    [user, textId]
  );
  await runSql(
    `insert into ask_turns (user_id, text_id, question, answer, position, fingerprint)
     values ($1, $2, 'Quem narra?', '{"text":"O narrador."}', 100, 'e2e')`,
    [user, textId]
  );
}

test("o historico mostra funcao, texto, palavras e o texto excluido", async ({ page }) => {
  await registerByApi(page.request);
  const user = await userId(page.request);
  const kept = await createText(page.request, "Texto guardado", 120);
  const gone = await createText(page.request, "Texto que some", 120);

  const insert = (minutesAgo: number, feature: string, textId: string | null, words: number) =>
    runSql(
      `insert into ai_usage (user_id, feature, model, text_id, words_sent, outcome, created_at)
       values ($1, $2, 'claude-sonnet-5-5', $3, $4, $5, now() - make_interval(mins => $6))`,
      [user, feature, textId, words, feature === "explicacao" ? "tempo" : "sucesso", minutesAgo]
    );
  await insert(3, "resumo", kept.id, 900);
  await insert(2, "dicionario", null, 1);
  await insert(1, "explicacao", gone.id, 40);
  expect((await page.request.delete(`/api/texts/${gone.id}`)).ok()).toBeTruthy();

  await openAiSettings(page);
  await page.getByRole("button", { name: "Histórico de envios" }).click();

  const items = page.getByTestId("ia-historico").getByRole("listitem");
  await expect(items).toHaveCount(3);
  // Do mais recente ao mais antigo.
  await expect(items.nth(0)).toContainText("Explicação de frase");
  await expect(items.nth(0)).toContainText("Texto excluído");
  await expect(items.nth(0)).toContainText("40 palavras · Tempo esgotado");
  await expect(items.nth(1)).toContainText("Dicionário");
  await expect(items.nth(1)).toContainText("Palavra consultada");
  await expect(items.nth(1)).toContainText("1 palavra · Concluída");
  await expect(items.nth(2)).toContainText("Resumo");
  await expect(items.nth(2)).toContainText("Texto guardado");
  await expect(items.nth(2)).toContainText("900 palavras");
});

test("sem chamadas, o historico diz que nada foi enviado", async ({ page }) => {
  await registerByApi(page.request);
  await openAiSettings(page);
  await page.getByRole("button", { name: "Histórico de envios" }).click();
  await expect(page.getByTestId("ia-historico-vazio")).toHaveText("Nenhum envio registrado.");
});

test("apagar o que a IA gerou leva resultados e perguntas, com confirmacao", async ({ page }) => {
  await registerByApi(page.request);
  const user = await userId(page.request);
  const text = await createText(page.request, "Com resumo", 120);
  await storeResults(user, text.id);
  expect((await (await page.request.get("/api/ia/resultados")).json()).count).toBe(2);

  await openAiSettings(page);
  await page.getByRole("button", { name: "Apagar o que a IA gerou" }).click();
  const dialog = page.getByRole("dialog", { name: "Apagar o que a IA gerou" });
  await expect(dialog).toContainText("perguntas feitas aos textos");
  await expect(dialog).toContainText(
    "As definições salvas em Palavras e as notas criadas a partir de respostas são suas e continuam guardadas."
  );
  await dialog.getByRole("button", { name: "Apagar", exact: true }).click();

  await expect(page.getByText("Resultados de IA apagados.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Nada guardado." })).toBeDisabled();
  expect((await (await page.request.get("/api/ia/resultados")).json()).count).toBe(0);
});

test("conta sem nada guardado mostra o botao desativado", async ({ page }) => {
  await registerByApi(page.request);
  await openAiSettings(page);
  await expect(page.getByRole("button", { name: "Nada guardado." })).toBeDisabled();
});

test("desligar a IA oferece apagar os resultados na mesma confirmacao", async ({ page }) => {
  await registerByApi(page.request);
  const user = await userId(page.request);
  const text = await createText(page.request, "Desligar", 120);
  await storeResults(user, text.id);
  await updateSettings(page.request, { aiEnabled: true });

  await openAiSettings(page);
  await page.getByRole("radio", { name: "Desligado" }).click();
  const dialog = page.getByRole("dialog", { name: "Desligar os recursos de IA" });
  await dialog.getByRole("checkbox", { name: /Apagar também o que a IA gerou/ }).check();
  await dialog.getByRole("button", { name: "Desligar" }).click();

  await expect(page.getByText("Resultados de IA apagados.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Nada guardado." })).toBeDisabled();
  const settings = await (await page.request.get("/api/settings")).json();
  expect(settings.settings.aiEnabled).toBe(false);
  expect((await (await page.request.get("/api/ia/resultados")).json()).count).toBe(0);
});
