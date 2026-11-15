import { expect, test } from "@playwright/test";
import { runSql } from "./db";
import { createText, randomIp, registerByApi, updateSettings } from "./helpers";

/**
 * Perfil de leitura do mes (US-234). O modelo nao roda aqui: a resposta da
 * rota e simulada na rede quando o teste precisa de um perfil, e o teste
 * confere o que o cartao faz com ela. Com pouco dado a rota real responde o
 * que falta sem chamar o modelo, e isso e conferido sem simulacao.
 */

// Com o service worker no ar, o pedido sai por ele e escapa do `page.route`.
test.use({ serviceWorkers: "block" });

test.beforeEach(async ({ context }) => {
  await context.setExtraHTTPHeaders({ "x-forwarded-for": randomIp() });
});

const PERFIL = {
  month: "2026-10",
  basis: "mes",
  from: "2026-10-01",
  to: "2026-11-01",
  base: "12 sessões, 3 questionários",
  generatedAt: "2026-11-15T12:00:00.000Z",
  patterns: [
    {
      title: "Você freia em frases longas com muitas vírgulas",
      detail: "Quase todos os freios caem em frases de mais de 30 palavras.",
      example: { text: "... o autor, que antes, [porém], dizia ...", source: "Ensaio" },
      suggestion: "Baixe 25 ppm nos textos técnicos.",
      action: "velocidade",
    },
    {
      title: "Você erra mais nas sessões rápidas",
      detail: "A compreensão cai acima de 400 ppm.",
      example: { text: "Compreensão de 55% nas sessões mais rápidas.", source: null },
      suggestion: "Faça o treino do dia com o piso de compreensão.",
      action: "treino",
    },
  ],
};

const ESTADO_BASE = {
  month: "2026-10",
  period: "Leituras de outubro de 2026",
  missing: [] as string[],
  unavailable: null as string | null,
};

test("pouco dado: o cartao diz o que falta e a rota nao gera", async ({ page }) => {
  await registerByApi(page.request);
  await updateSettings(page.request, { aiEnabled: true });

  const state = await (await page.request.get("/api/perfil-leitura")).json();
  expect(state.profile).toBeNull();
  expect(state.canGenerate).toBe(false);
  expect(state.missing).toEqual([
    "Faltam 3 sessões de leitura no período (mínimo de 3).",
    "Responda pelo menos um questionário de compreensão ao fim de uma leitura.",
  ]);

  const recusa = await page.request.post("/api/perfil-leitura");
  expect(recusa.status()).toBe(422);
  expect((await recusa.json()).missing).toHaveLength(2);

  await page.goto("/estatisticas");
  const cartao = page.locator("#perfil-leitura");
  await expect(cartao.getByTestId("perfil-falta")).toContainText("Faltam 3 sessões");
  await expect(page.getByRole("button", { name: "Gerar perfil do mês" })).toHaveCount(0);
});

test("dados do mes anterior: a falta some, so do proprio usuario", async ({ page }) => {
  await registerByApi(page.request);
  await updateSettings(page.request, { aiEnabled: true });
  const text = await createText(page.request, "Texto do mês", 600);
  // Tres sessoes no mes anterior, uma com questionario respondido.
  await runSql(
    `insert into reading_sessions (user_id, text_id, wpm, words_read, duration_ms, comprehension, brakes, created_at)
     select user_id, id, 300, 600, 120000, c, '[10, 40]'::jsonb,
            date_trunc('month', now()) - interval '10 days'
       from texts, unnest(array[80, null, null]::int[]) as c
      where id = $1`,
    [text.id]
  );

  const state = await (await page.request.get("/api/perfil-leitura")).json();
  expect(state.missing).toEqual([]);
  expect(state.period).toMatch(/^Leituras de /);
  // Sem chave no ambiente de teste, o botao nao aparece e o motivo e dito.
  if (!process.env.ANTHROPIC_API_KEY) {
    expect(state.canGenerate).toBe(false);
    expect(state.unavailable).toContain("não está configurado");
  }

  // Outra conta nao ve os dados desta.
  await page.context().clearCookies();
  await registerByApi(page.request);
  const other = await (await page.request.get("/api/perfil-leitura")).json();
  expect(other.missing).toContain("Faltam 3 sessões de leitura no período (mínimo de 3).");
});

test("gerar perfil do mes: mostra os padroes e, reaberto, o guardado sem nova chamada", async ({ page }) => {
  await registerByApi(page.request);
  await updateSettings(page.request, { aiEnabled: true });

  let stored: typeof PERFIL | null = null;
  let generated = 0;
  await page.route("**/api/perfil-leitura", (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({
        json: { ...ESTADO_BASE, profile: stored, canGenerate: stored === null },
      });
    }
    generated += 1;
    stored = PERFIL;
    return route.fulfill({ json: { profile: PERFIL } });
  });

  await page.goto("/estatisticas");
  const gerar = page.getByRole("button", { name: "Gerar perfil do mês" });
  await gerar.scrollIntoViewIfNeeded();
  const box = await gerar.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(48);
  await gerar.click();

  const perfil = page.getByTestId("perfil-leitura");
  await expect(perfil).toContainText("Você freia em frases longas com muitas vírgulas");
  await expect(perfil).toContainText("[porém]");
  await expect(perfil).toContainText("Leituras de outubro de 2026 · 12 sessões, 3 questionários");
  await expect(perfil.getByRole("link", { name: "Ajustar a velocidade" })).toHaveAttribute(
    "href",
    "/ajustes#leitura"
  );
  await expect(perfil.getByRole("link", { name: "Abrir o treino" })).toHaveAttribute("href", "/treino");
  expect(generated).toBe(1);

  // Reaberto no mesmo mes: aparece direto, sem botao e sem gerar outro.
  await page.reload();
  await expect(page.getByTestId("perfil-leitura")).toContainText("Você erra mais nas sessões rápidas");
  await expect(page.getByRole("button", { name: "Gerar perfil do mês" })).toHaveCount(0);
  expect(generated).toBe(1);
});

test("sem permissao da IA: o aviso de consentimento aparece no cartao", async ({ page }) => {
  await registerByApi(page.request);

  await page.route("**/api/perfil-leitura", (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({ json: { ...ESTADO_BASE, profile: null, canGenerate: true } });
    }
    return route.fulfill({
      status: 403,
      json: { error: "Permita o envio do conteúdo ao serviço de IA para usar esta função.", consent: "pending" },
    });
  });

  await page.goto("/estatisticas");
  await page.getByRole("button", { name: "Gerar perfil do mês" }).click();
  await expect(page.locator("#perfil-leitura").getByTestId("ia-consentimento")).toBeVisible();
});

test("Você leva ao cartao do perfil nas estatisticas", async ({ page }) => {
  await registerByApi(page.request);

  await page.goto("/voce");
  const link = page.getByRole("link", { name: /^Perfil de leitura/ });
  await expect(link).toHaveAttribute("href", "/estatisticas#perfil-leitura");
  await link.click();
  await expect(page).toHaveURL(/\/estatisticas#perfil-leitura$/);
  await expect(page.locator("#perfil-leitura")).toBeVisible();
});
