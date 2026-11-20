import { expect, test, type Page, type Route } from "@playwright/test";
import { runSql } from "./db";
import { openReader, randomIp, readerAction, registerByApi, sampleText, updateSettings } from "./helpers";

/**
 * IA dentro do leitor: explicar a secao com as proprias palavras (US-231) e
 * a previa antes de ler (US-233). O modelo nao roda aqui: os POST de IA (e o
 * GET da previa, que depende da chave configurada) sao simulados no
 * navegador; o leitor, a gravacao da posicao e as partes lidas sao de verdade.
 */

test.use({ serviceWorkers: "block" });

test.beforeEach(async ({ context, page }) => {
  await context.setExtraHTTPHeaders({ "x-forwarded-for": randomIp() });
  await page.emulateMedia({ reducedMotion: "reduce" });
});

async function mockPost(page: Page, path: string, handler: (route: Route) => Promise<void> | void) {
  const calls: unknown[] = [];
  await page.route(`**/api/texts/*/${path}`, (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    calls.push(route.request().postDataJSON() ?? null);
    return handler(route);
  });
  return calls;
}

async function createMarkdown(page: Page, title: string, content: string) {
  const response = await page.request.post("/api/texts", { data: { title, format: "markdown", content } });
  expect(response.ok()).toBeTruthy();
  return (await response.json()).text as { id: string };
}

/** Vira paginas ate o elemento aparecer (ou o texto acabar). */
async function pageUntil(page: Page, testId: string, max = 12) {
  const target = page.getByTestId(testId);
  for (let turn = 0; turn < max; turn += 1) {
    if (await target.isVisible()) return;
    const next = page.getByRole("button", { name: "Próxima página" });
    if (!(await next.isVisible())) break;
    await next.click();
  }
  await expect(target).toBeVisible();
}

const EXPLANATION = Array.from({ length: 32 }, (_, i) => (i % 2 ? "ritmo" : "leitura")).join(" ");

test("explicar a secao: oferta ao cruzar o fim, rascunho guardado e a parte certa enviada", async ({ page }) => {
  await registerByApi(page.request);
  await updateSettings(page.request, { readerTipsSeen: true, aiEnabled: true });
  const text = await createMarkdown(
    page,
    "Com secoes",
    `# Parte um\n\n${sampleText(200)}\n\n# Parte dois\n\n${sampleText(200)}`
  );
  const calls = await mockPost(page, "apontamentos", (route) =>
    route.fulfill({
      json: { points: [{ text: "Faltou o sentido do texto.", quote: "ao sentido do texto.", start: 10, end: 14 }] },
    })
  );

  await openReader(page, text.id);
  await expect(page.getByTestId("oferta-explicar")).toHaveCount(0);
  await pageUntil(page, "oferta-explicar");

  await page.getByRole("button", { name: "Explicar esta seção com suas palavras" }).click();
  const sheet = page.getByRole("dialog", { name: "Explicar com suas palavras" });
  await expect(sheet.getByText("Parte um")).toBeVisible();
  await sheet.getByLabel("Sua explicação").fill(EXPLANATION);

  // Fechar sem conferir nao perde o texto: a oferta volta e o rascunho tambem.
  await sheet.getByRole("button", { name: "Fechar" }).first().click();
  await expect(sheet).toHaveCount(0);
  await page.getByRole("button", { name: "Explicar esta seção com suas palavras" }).click();
  await expect(sheet.getByLabel("Sua explicação")).toHaveValue(EXPLANATION);

  await sheet.getByRole("button", { name: "Conferir" }).click();
  await expect(sheet.getByTestId("apontamento")).toHaveCount(1);
  expect(calls).toEqual([{ start: 0, explanation: EXPLANATION }]);
});

test("explicar sem secoes: so na conclusao, para o texto lido; sem IA, nada", async ({ page }) => {
  await registerByApi(page.request);
  await updateSettings(page.request, { readerTipsSeen: true, aiEnabled: true });
  const text = await createMarkdown(page, "Sem secoes", sampleText(160));

  await openReader(page, text.id);
  await expect(page.getByTestId("oferta-explicar")).toHaveCount(0);
  for (let turn = 0; turn < 10; turn += 1) {
    if (await page.getByRole("heading", { name: "Leitura concluída" }).isVisible()) break;
    await page.getByRole("button", { name: "Próxima página" }).click();
  }
  await page.getByRole("button", { name: "Explicar o texto com suas palavras" }).click();
  const sheet = page.getByRole("dialog", { name: "Explicar com suas palavras" });
  await expect(sheet.getByText("Todo o trecho lido")).toBeVisible();

  // Com a IA desligada, a conclusao nao oferece.
  await updateSettings(page.request, { aiEnabled: false });
  await page.reload();
  // Texto concluido reabre na ultima pagina; a conclusao vem ao virar.
  for (let turn = 0; turn < 10; turn += 1) {
    if (await page.getByRole("heading", { name: "Leitura concluída" }).isVisible()) break;
    await page.getByRole("button", { name: "Próxima página" }).click();
  }
  await expect(page.getByRole("heading", { name: "Leitura concluída" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Explicar o texto com suas palavras" })).toHaveCount(0);
});

test("previa: so pelo toque, sem spoiler, e as perguntas seguem em Mais acoes", async ({ page }) => {
  await registerByApi(page.request);
  await updateSettings(page.request, { readerTipsSeen: true, aiEnabled: true });
  const text = await createMarkdown(page, "Nao comecado", sampleText(600));
  const preview = {
    about: "Um ensaio sobre ler com atenção ao ritmo.",
    focus: ["O ritmo das frases", "O sentido do texto"],
    questions: ["O que a leitura rápida exige?", "Como o ritmo muda o sentido?"],
  };
  let stored = false;
  await page.route(`**/api/texts/${text.id}/previa`, (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({ json: { preview: stored ? preview : null, available: true } });
    }
    return route.fallback();
  });
  const calls = await mockPost(page, "previa", (route) => {
    stored = true;
    return route.fulfill({ json: { preview } });
  });

  await openReader(page, text.id);
  const card = page.getByTestId("cartao-previa");
  await expect(card).toBeVisible();
  // Abrir o texto nao gera nada: so o toque em "Ver prévia".
  expect(calls).toHaveLength(0);
  await card.getByRole("button", { name: "Ver prévia" }).click();
  await expect(card.getByText(preview.about)).toBeVisible();
  await expect(card.getByText(preview.questions[0]!)).toBeVisible();
  expect(calls).toHaveLength(1);

  await card.getByRole("button", { name: "Começar a ler" }).click();
  await expect(card).toHaveCount(0);
  // Pausado (espaco, como no teclado), o "Mais ações" do rodape volta a mao.
  await page.keyboard.press("Space");
  await expect(page.getByRole("button", { name: "Iniciar leitura" })).toBeVisible();

  await readerAction(page, "Perguntas da prévia");
  const sheet = page.getByRole("dialog", { name: "Perguntas da prévia" });
  await expect(sheet.getByText(preview.questions[1]!)).toBeVisible();
});

test("previa: texto ja comecado nao mostra o cartao", async ({ page }) => {
  await registerByApi(page.request);
  await updateSettings(page.request, { readerTipsSeen: true, aiEnabled: true });
  const text = await createMarkdown(page, "Comecado", sampleText(600));
  await page.route(`**/api/texts/${text.id}/previa`, (route) =>
    route.fulfill({ json: { preview: null, available: true } })
  );
  await runSql("update texts set progress_index = 50 where id = $1", [text.id]);

  await openReader(page, text.id);
  await expect(page.getByTestId("cartao-previa")).toHaveCount(0);
});
