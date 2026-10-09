import { expect, test, type Page } from "@playwright/test";
import { createText, openReader, randomIp, registerByApi, updateSettings } from "./helpers";

/**
 * Explicar a frase (US-127), perguntar ao texto (US-128) e guardar a resposta
 * como nota (US-129). O modelo nao roda aqui: as rotas de IA sao simuladas no
 * navegador, e o resto (leitor, destaques, notas) e o de verdade.
 */

// O service worker do app atende os fetch por conta propria, e o que passa
// por ele nao chega ao `page.route`.
test.use({ serviceWorkers: "block" });

test.beforeEach(async ({ context, page }) => {
  await context.setExtraHTTPHeaders({ "x-forwarded-for": randomIp() });
  await page.emulateMedia({ reducedMotion: "reduce" });
});

/** Atalho de teclado, repetido ate o leitor hidratado atender. */
async function shortcut(page: Page, key: string, title: string) {
  const sheet = page.getByRole("dialog", { name: title });
  await expect(async () => {
    await page.keyboard.press(key);
    await expect(sheet).toBeVisible({ timeout: 1_000 });
  }).toPass();
  return sheet;
}

const position = (page: Page) =>
  page.locator("header .tabular").first().innerText().then((text) => Number(text.split("/")[0]!.replace(/\D/g, "")));

async function setup(page: Page, words: number) {
  await registerByApi(page.request);
  await updateSettings(page.request, { readerTipsSeen: true, aiEnabled: true });
  return createText(page.request, "Texto com IA", words);
}

test("explicar a frase atual pausa e mostra a explicacao", async ({ page }) => {
  const text = await setup(page, 200);
  let calls = 0;
  let body: unknown = null;
  await page.route("**/api/texts/*/explicacao", async (route) => {
    calls += 1;
    body = route.request().postDataJSON();
    await route.fulfill({
      json: {
        explanation: {
          simple: "Ler rápido pede atenção ao ritmo.",
          translation: null,
          explanation: "A frase diz que a velocidade depende de acompanhar o sentido.",
        },
        sentence: "leitura rapida exige atencao",
        start: 0,
        end: 12,
        cached: false,
      },
    });
  });

  await openReader(page, text.id);
  const sheet = await shortcut(page, "e", "Explicar frase");
  await expect(sheet.getByText("Ler rápido pede atenção ao ritmo.")).toBeVisible();
  await expect(sheet.getByText("Explicação")).toBeVisible();
  await expect(sheet.getByText("Tradução")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  // Em desenvolvimento o efeito roda duas vezes e o primeiro pedido e abortado.
  expect(calls).toBeGreaterThanOrEqual(1);
  expect(body).toEqual({ index: 0 });
  expect(await position(page)).toBe(1);
});

test("limite de explicacoes mostra o aviso e nao muda a posicao", async ({ page }) => {
  const text = await setup(page, 200);
  await page.route("**/api/texts/*/explicacao", (route) =>
    route.fulfill({
      status: 429,
      json: { error: "Limite diário de explicações atingido. Volta a valer amanhã." },
    })
  );

  await openReader(page, text.id);
  const sheet = await shortcut(page, "e", "Explicar frase");
  await expect(
    sheet.getByText("Limite diário de explicações atingido. Volta a valer amanhã.")
  ).toBeVisible();
  await page.keyboard.press("Escape");
  expect(await position(page)).toBe(1);
});

test("perguntar ao texto, guardar como nota e ir ate a citacao", async ({ page }) => {
  const text = await setup(page, 1500);
  const answer = "A leitura rápida depende do ritmo das frases.";
  let sent: Record<string, unknown> | null = null;
  await page.route("**/api/texts/*/pergunta", async (route) => {
    sent = route.request().postDataJSON();
    await route.fulfill({
      json: {
        answer: {
          text: answer,
          citations: [{ start: 1200, end: 1206, quote: "ao ritmo das frases e ao" }],
        },
        recentOnly: true,
      },
    });
  });

  await openReader(page, text.id);
  await page.getByRole("button", { name: "Perguntar ao texto" }).click();
  const sheet = page.getByRole("dialog", { name: "Perguntar ao texto" });
  await sheet.getByLabel("Sua pergunta").fill("Do que depende a leitura?");
  await sheet.getByRole("button", { name: "Perguntar" }).click();

  await expect(sheet.getByText(answer)).toBeVisible();
  await expect(sheet.getByText("Considerando só o trecho mais recente.")).toBeVisible();
  expect(sent).toMatchObject({ question: "Do que depende a leitura?", position: 0, history: [] });
  await expect(sheet.getByLabel("Sua pergunta")).toHaveValue("");

  // US-129: a resposta vira nota do primeiro trecho citado.
  await sheet.getByRole("button", { name: "Guardar como nota" }).click();
  // A primeira ida as rotas de destaque compila no servidor de desenvolvimento.
  await expect(sheet.getByText("Guardada como nota no trecho citado.")).toBeVisible({
    timeout: 30_000,
  });
  const saved = await (await page.request.get(`/api/texts/${text.id}/destaques`)).json();
  expect(saved.highlights).toHaveLength(1);
  expect(saved.highlights[0]).toMatchObject({ start: 1200, end: 1206, note: answer });

  // US-128: a citacao leva ao trecho, e o leitor oferece a volta.
  await sheet.getByRole("button", { name: /Ir para o trecho citado/ }).click();
  await expect(sheet).toHaveCount(0);
  expect(await position(page)).toBe(1201);
  const back = page.getByRole("button", { name: /Voltar para onde parou/ });
  await expect(back).toBeVisible();
  await back.click();
  expect(await position(page)).toBe(1);

  // A conversa continua na folha ao reabrir; a segunda pergunta leva o historico.
  await page.getByRole("button", { name: "Perguntar ao texto" }).click();
  await expect(sheet.getByText(answer)).toBeVisible();
  await sheet.getByLabel("Sua pergunta").fill("E depois?");
  await sheet.getByRole("button", { name: "Perguntar" }).click();
  await expect(sheet.getByTestId("pergunta-resposta")).toHaveCount(2);
  expect(sent).toMatchObject({ history: [{ question: "Do que depende a leitura?", answer }] });

  // Guardar a segunda no mesmo trecho acrescenta a nota, sem outro destaque.
  await sheet.getByRole("button", { name: "Guardar como nota" }).click();
  await expect(sheet.getByText("Guardada como nota no trecho citado.")).toHaveCount(2, {
    timeout: 15_000,
  });
  const after = await (await page.request.get(`/api/texts/${text.id}/destaques`)).json();
  expect(after.highlights).toHaveLength(1);
  expect(after.highlights[0].note).toBe(`${answer}\n\n${answer}`);
});

test("resposta sem citacao nao oferece guardar e o limite mantem a pergunta", async ({ page }) => {
  const text = await setup(page, 200);
  let quota = false;
  await page.route("**/api/texts/*/pergunta", (route) =>
    quota
      ? route.fulfill({
          status: 429,
          json: { error: "Limite diário de perguntas atingido. Volta a valer amanhã." },
        })
      : route.fulfill({
          json: {
            answer: { text: "O trecho lido até aqui não responde a isso.", citations: [] },
            recentOnly: false,
          },
        })
  );

  await openReader(page, text.id);
  const sheet = await shortcut(page, "p", "Perguntar ao texto");
  await sheet.getByLabel("Sua pergunta").fill("Quem e o autor?");
  await sheet.getByRole("button", { name: "Perguntar" }).click();
  await expect(sheet.getByText("O trecho lido até aqui não responde a isso.")).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Guardar como nota" })).toHaveCount(0);

  quota = true;
  await sheet.getByLabel("Sua pergunta").fill("Outra pergunta?");
  await sheet.getByRole("button", { name: "Perguntar" }).click();
  await expect(
    sheet.getByText("Limite diário de perguntas atingido. Volta a valer amanhã.")
  ).toBeVisible();
  await expect(sheet.getByLabel("Sua pergunta")).toHaveValue("Outra pergunta?");
});

test("a rota de pergunta recusa pergunta longa demais", async ({ page }) => {
  const text = await setup(page, 50);
  const response = await page.request.post(`/api/texts/${text.id}/pergunta`, {
    data: { question: "a".repeat(501), position: 10 },
  });
  expect(response.status()).toBe(400);
});
