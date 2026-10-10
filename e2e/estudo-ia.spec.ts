import { config } from "dotenv";
import { Client } from "pg";
import { expect, test, type Page, type Route } from "@playwright/test";
import { runSql } from "./db";
import { createText, openReader, randomIp, registerByApi, sampleText, updateSettings } from "./helpers";

/**
 * Ferramentas de estudo com IA: cartao de um trecho (US-158), glossario
 * (US-164), fichamento (US-165), perguntas-guia (US-166) e explicar com as
 * proprias palavras (US-167). O modelo nao roda aqui: os POST de IA sao
 * simulados no navegador; o resto (leitor, gravacao dos cartoes, partes
 * lidas) e o de verdade.
 */

config({ path: ".env.local", quiet: true });

// O service worker do app atende os fetch por conta propria, e o que passa
// por ele nao chega ao `page.route`.
test.use({ serviceWorkers: "block" });

test.beforeEach(async ({ context, page }) => {
  await context.setExtraHTTPHeaders({ "x-forwarded-for": randomIp() });
  await page.emulateMedia({ reducedMotion: "reduce" });
});

async function cardsOf(textId: string): Promise<Record<string, unknown>[]> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const result = await client.query(
      "select front, back, kind, source_start, source_end, next_review_on from study_cards where text_id = $1 order by created_at",
      [textId]
    );
    return result.rows;
  } finally {
    await client.end();
  }
}

/** Simula so o POST da rota; conta as chamadas. */
async function mockPost(page: Page, path: string, handler: (route: Route) => Promise<void> | void) {
  const calls: unknown[] = [];
  await page.route(`**/api/texts/*/${path}`, (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    calls.push(route.request().postDataJSON());
    return handler(route);
  });
  return calls;
}

async function setup(page: Page, words: number, progress: number) {
  await registerByApi(page.request);
  await updateSettings(page.request, { readerTipsSeen: true, aiEnabled: true });
  const text = await createText(page.request, "Texto de estudo", words);
  await runSql("update texts set progress_index = $1 where id = $2", [progress, text.id]);
  return text;
}

const position = (page: Page) =>
  page
    .locator("header .tabular")
    .first()
    .innerText()
    .then((text) => Number(text.split("/")[0]!.replace(/\D/g, "")));

test("glossario do trecho lido: abre o leitor no termo e vira cartao sem nova chamada", async ({ page }) => {
  const text = await setup(page, 3000, 1500);
  // "ritmo" e a 7a palavra do texto de exemplo.
  const calls = await mockPost(page, "glossario", (route) =>
    route.fulfill({
      json: {
        terms: [
          { term: "atencao", definition: "Foco no que se lê.", start: 3, end: 4 },
          { term: "ritmo", definition: "Velocidade constante da leitura.", start: 6, end: 7 },
        ],
        cut: 1000,
        cached: false,
      },
    })
  );

  await page.goto(`/textos/${text.id}/estudar`);
  const panel = page.getByTestId("glossario");
  await panel.getByRole("button", { name: "Glossário" }).click();
  const terms = panel.getByTestId("glossario-termo");
  await expect(terms).toHaveCount(2);
  await expect(terms.first()).toContainText("atencao");
  await expect(terms.first()).toContainText("Aparece na palavra 4");

  await terms.nth(1).getByRole("button", { name: "Virar cartão" }).click();
  await expect(terms.nth(1).getByRole("button", { name: "Cartão criado" })).toBeVisible({ timeout: 30_000 });
  expect(calls).toHaveLength(1);
  expect(await cardsOf(text.id)).toEqual([
    {
      front: "ritmo",
      back: "Velocidade constante da leitura.",
      kind: "glossario",
      source_start: 6,
      source_end: 7,
      next_review_on: null,
    },
  ]);

  // Tocar no termo abre o leitor na primeira ocorrencia.
  await terms.nth(1).getByRole("link").click();
  await expect(page).toHaveURL(new RegExp(`/leitor/${text.id}\\?de=6`));
  await expect.poll(() => position(page)).toBe(7);
});

test("glossario pede 500 palavras lidas e nada e enviado antes", async ({ page }) => {
  const text = await setup(page, 3000, 100);
  const calls = await mockPost(page, "glossario", (route) => route.fulfill({ json: { terms: [] } }));
  await page.goto(`/textos/${text.id}/estudar`);
  const panel = page.getByTestId("glossario");
  await expect(panel.getByText("Leia pelo menos 500 palavras para gerar o glossário.")).toBeVisible();
  await expect(panel.getByRole("button", { name: "Glossário" })).toBeDisabled();
  expect(calls).toHaveLength(0);

  // O servidor recusa do mesmo jeito.
  await page.unroute("**/api/texts/*/glossario");
  const response = await page.request.post(`/api/texts/${text.id}/glossario`);
  expect(response.status()).toBe(400);
});

test("fichamento: so de texto concluido, com citacoes e exportacao", async ({ page }) => {
  const text = await setup(page, 400, 10);
  const notes = {
    ideia: [{ text: "Ler rápido exige atenção.", quote: "leitura rapida exige atencao", start: 0, end: 4 }],
    argumentos: [{ text: "O ritmo importa.", quote: "ao ritmo das frases", start: 5, end: 9 }],
    evidencias: [],
    conclusoes: [{ text: "O sentido vem do texto.", quote: "ao sentido do texto.", start: 10, end: 14 }],
  };
  const calls = await mockPost(page, "fichamento", (route) =>
    route.fulfill({ json: { notes, sourceUrl: null, cached: false } })
  );

  await page.goto(`/textos/${text.id}/estudar`);
  const panel = page.getByTestId("fichamento");
  await expect(panel.getByText("Disponível ao concluir o texto.")).toBeVisible();
  await expect(panel.getByRole("button", { name: "Fichamento" })).toBeDisabled();
  expect(calls).toHaveLength(0);

  await runSql("update texts set progress_index = $1 where id = $2", [400, text.id]);
  await page.reload();
  await panel.getByRole("button", { name: "Fichamento" }).click();
  await expect(panel.getByRole("heading", { name: "Ideia central" })).toBeVisible();
  await expect(panel.getByRole("heading", { name: "Argumentos" })).toBeVisible();
  await expect(panel.getByRole("heading", { name: "Evidências" })).toBeVisible();
  await expect(panel.getByRole("heading", { name: "Conclusões" })).toBeVisible();
  await expect(panel.getByText("O ritmo importa.")).toBeVisible();
  expect(calls).toHaveLength(1);

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Exportar" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("texto-de-estudo-fichamento.md");
  const body = await (await download.createReadStream()).toArray();
  const markdown = Buffer.concat(body).toString("utf8");
  expect(markdown).toContain("# Texto de estudo");
  expect(markdown).toContain("## Argumentos\n\n- O ritmo importa.\n\n> ao ritmo das frases");

  // A citacao abre o leitor no trecho citado.
  await panel.getByRole("link", { name: /ao ritmo das frases/ }).click();
  await expect(page).toHaveURL(new RegExp(`/leitor/${text.id}\\?de=5`));
});

test("explicar com as proprias palavras: minimo de 30 palavras e apontamentos sem nota", async ({ page }) => {
  const text = await setup(page, 1000, 499);
  const calls = await mockPost(page, "apontamentos", (route) =>
    route.fulfill({
      json: {
        points: [
          { text: "Faltou falar do sentido do texto.", quote: "ao sentido do texto.", start: 10, end: 14 },
        ],
      },
    })
  );

  await page.goto(`/textos/${text.id}/estudar`);
  const panel = page.getByTestId("apontamentos");
  // Sem secoes, a parte e todo o trecho lido.
  await expect(panel.getByText("Todo o trecho lido")).toBeVisible();
  const field = panel.getByLabel("Sua explicação");
  await field.fill("O texto fala de leitura rápida.");
  await panel.getByRole("button", { name: "Conferir" }).click();
  await expect(panel.getByText("Escreva pelo menos 30 palavras.")).toBeVisible();
  expect(calls).toHaveLength(0);

  const explanation = Array.from({ length: 32 }, (_, i) => (i % 2 ? "ritmo" : "leitura")).join(" ");
  await field.fill(explanation);
  await panel.getByRole("button", { name: "Conferir" }).click();
  await expect(panel.getByTestId("apontamento")).toHaveCount(1);
  await expect(panel.getByText("Faltou falar do sentido do texto.")).toBeVisible();
  await expect(panel.getByText(/%|nota \d/i)).toHaveCount(0);
  expect(calls).toEqual([{ start: 0, explanation }]);
});

/** Seleciona as primeiras `count` palavras do primeiro pedaco da pagina. */
async function selectWords(page: Page, count: number) {
  await page.evaluate((size) => {
    const holder = document.querySelector<HTMLElement>("main [data-start]")!;
    const node = document.createTreeWalker(holder, NodeFilter.SHOW_TEXT).nextNode()!;
    const content = node.textContent ?? "";
    let end = 0;
    for (let word = 0; word < size; word += 1) {
      while (end < content.length && /\s/.test(content[end]!)) end += 1;
      while (end < content.length && !/\s/.test(content[end]!)) end += 1;
    }
    const range = document.createRange();
    range.setStart(node, 0);
    range.setEnd(node, end);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
  }, count);
}

test("criar cartao de um trecho selecionado: proposta editavel e gravada", async ({ page }) => {
  const text = await setup(page, 400, 0);
  const calls = await mockPost(page, "cartao", (route) =>
    route.fulfill({ json: { proposal: { front: "O que a leitura exige?", back: "Atenção constante." } } })
  );

  await openReader(page, text.id);
  await expect(async () => {
    await selectWords(page, 4);
    await expect(page.getByRole("button", { name: "Criar cartão" })).toBeVisible({ timeout: 1_000 });
  }).toPass();
  await page.getByRole("button", { name: "Criar cartão" }).click();

  const sheet = page.getByRole("dialog", { name: "Criar cartão" });
  await expect(sheet.getByLabel("Frente")).toHaveValue("O que a leitura exige?");
  await sheet.getByLabel("Verso").fill("Atenção constante ao ritmo.");
  await sheet.getByRole("button", { name: "Salvar cartão" }).click();
  await expect(sheet).toHaveCount(0, { timeout: 30_000 });
  // Em desenvolvimento o efeito roda duas vezes; todo pedido leva so o trecho.
  expect(calls.length).toBeGreaterThanOrEqual(1);
  for (const call of calls) expect(call).toEqual({ start: 0, end: 4 });
  expect(await cardsOf(text.id)).toEqual([
    {
      front: "O que a leitura exige?",
      back: "Atenção constante ao ritmo.",
      kind: "trecho",
      source_start: 0,
      source_end: 4,
      next_review_on: null,
    },
  ]);
});

test("criar cartao sem IA abre o formulario com o trecho no verso", async ({ page }) => {
  const text = await setup(page, 400, 0);
  await mockPost(page, "cartao", (route) =>
    route.fulfill({ status: 503, json: { error: "Não consegui propor um cartão agora." } })
  );

  await openReader(page, text.id);
  await expect(async () => {
    await selectWords(page, 3);
    await expect(page.getByRole("button", { name: "Criar cartão" })).toBeVisible({ timeout: 1_000 });
  }).toPass();
  await page.getByRole("button", { name: "Criar cartão" }).click();
  const sheet = page.getByRole("dialog", { name: "Criar cartão" });
  await expect(sheet.getByLabel("Verso")).toHaveValue("leitura rapida exige");
  await expect(sheet.getByLabel("Frente")).toHaveValue("");
  await expect(sheet.getByRole("button", { name: "Salvar cartão" })).toBeDisabled();
});

test("trecho de mais de 300 palavras e recusado antes de qualquer envio", async ({ page }) => {
  const text = await setup(page, 400, 0);
  const response = await page.request.post(`/api/texts/${text.id}/cartao`, { data: { start: 0, end: 301 } });
  expect(response.status()).toBe(400);
  expect((await response.json()).error).toBe("Selecione um trecho menor, de até 300 palavras.");
});

test("perguntas-guia: opcao por aparelho, perguntas no inicio da secao e de volta na seguinte", async ({
  page,
}) => {
  await registerByApi(page.request);
  await updateSettings(page.request, { readerTipsSeen: true, aiEnabled: true });
  const plain = await createText(page.request, "Sem secoes", 200);
  const created = await page.request.post("/api/texts", {
    data: {
      title: "Com secoes",
      format: "markdown",
      content: `# Parte um\n\n${sampleText(120)}\n\n# Parte dois\n\n${sampleText(120)}`,
    },
  });
  const text = (await created.json()).text as { id: string };

  const calls = await mockPost(page, "guia", (route) => {
    const body = route.request().postDataJSON() as { section: number; cachedOnly?: boolean };
    const questions =
      body.section === 0
        ? [{ question: "O que a leitura exige?", quote: "leitura rapida exige atencao", start: 3, end: 7 }]
        : [{ question: "E o sentido?", quote: "ao sentido do texto.", start: 140, end: 144 }];
    return route.fulfill({ json: { questions } });
  });

  // Sem secoes, a opcao aparece desativada.
  await openReader(page, plain.id);
  await page.getByRole("button", { name: "Navegar no texto" }).click();
  const option = page.getByTestId("perguntas-guia-opcao");
  await expect(option).toContainText("Este texto não tem seções.");
  await expect(option.getByRole("checkbox")).toBeDisabled();

  // Ligada, a folha abre no inicio da primeira secao.
  await page.evaluate(() => localStorage.setItem("rk-leitura:perguntas-guia", "1"));
  await openReader(page, text.id);
  const sheet = page.getByRole("dialog", { name: "Perguntas-guia" });
  await expect(sheet.getByText("O que a leitura exige?")).toBeVisible();
  await sheet.getByRole("button", { name: "Começar a ler" }).click();
  await expect(sheet).toHaveCount(0);

  // Indo para a segunda secao, as perguntas anteriores voltam com "Ver no texto".
  await page.getByRole("button", { name: "Navegar no texto" }).click();
  await page.getByRole("dialog", { name: "Navegar no texto" }).getByRole("button", { name: "Parte dois" }).click();
  await expect(sheet.getByText("E o sentido?")).toBeVisible();
  const previous = sheet.getByTestId("perguntas-anteriores");
  await expect(previous.getByText("O que a leitura exige?")).toBeVisible();
  expect(calls.some((call) => (call as { section: number }).section > 0)).toBe(true);
  await previous.getByRole("button", { name: "Ver no texto" }).click();
  await expect(sheet).toHaveCount(0);
  await expect.poll(() => position(page)).toBe(4);
});
