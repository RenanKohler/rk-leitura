import { expect, test, type Page } from "@playwright/test";
import {
  createText,
  openReader,
  progressOf,
  randomIp,
  registerByApi,
  sampleText,
  updateSettings,
} from "./helpers";

test.beforeEach(async ({ context }) => {
  await context.setExtraHTTPHeaders({ "x-forwarded-for": randomIp() });
});

/**
 * Biblioteca compacta, na ordem da ultima leitura (US-230).
 */

const FIRST = "Importado primeiro";
const MIDDLE = "Importado no meio";
const LAST = "Importado por ultimo";

/**
 * Os tres textos do teste, na ordem em que a lista os mostra. A conta nova
 * ja vem com o texto de boas-vindas, que nao interessa aqui.
 */
async function listed(page: Page): Promise<string[]> {
  const titles = await page.getByTestId("titulo-do-item").allTextContents();
  return titles.filter((title) => [FIRST, MIDDLE, LAST].includes(title));
}

test("abre na ordem da ultima leitura; a ordem de importacao e uma escolha guardada no aparelho", async ({
  page,
}) => {
  await registerByApi(page.request);
  await updateSettings(page.request, { baseWpm: 300, warmup: false });
  const first = await createText(page.request, FIRST, 300);
  await createText(page.request, MIDDLE, 300);
  await createText(page.request, LAST, 300);

  // Nada lido ainda: vale a data de importacao, com o mais novo em cima.
  await page.goto("/textos");
  const order = page.getByLabel("Ordem", { exact: true });
  await expect(order).toHaveValue("leitura");
  await expect.poll(() => listed(page)).toEqual([LAST, MIDDLE, FIRST]);

  // Le um pouco do texto importado antes dos outros e volta a biblioteca.
  await openReader(page, first.id);
  await page.getByRole("button", { name: "Iniciar leitura" }).click();
  // Pelo menos vinte palavras: abaixo de dez a sessao nem e gravada.
  await expect(page.locator("header .tabular")).toContainText(/^[2-9]\d \//, { timeout: 20_000 });
  await page.getByRole("button", { name: "Pausar" }).click();
  await page.getByRole("link", { name: "Voltar" }).click();
  await expect(page).toHaveURL(/\/textos$/);

  // A posicao e a sessao sao gravadas ao sair do leitor, depois de a lista ja
  // ter sido pedida: o teste espera as duas e so entao confere a ordem.
  await expect.poll(() => progressOf(page.request, first.id)).toBeGreaterThan(0);
  await expect
    .poll(async () => {
      const history = await (await page.request.get("/api/reading-sessions")).json();
      return (history.sessions as unknown[]).length;
    })
    .toBeGreaterThan(0);

  await page.reload();
  await expect.poll(() => listed(page)).toEqual([FIRST, LAST, MIDDLE]);
  // Em andamento: a linha de dados diz quanto, e o indicador fino aparece.
  const read = page.getByTestId("item-da-biblioteca").filter({ hasText: FIRST });
  await expect(read).toContainText("% lido");
  await expect(read.getByTestId("progresso-do-item")).toHaveCount(1);

  // "Data de importacao" devolve a ordem de antes...
  await order.selectOption("importacao");
  await expect.poll(() => listed(page)).toEqual([LAST, MIDDLE, FIRST]);

  // ...e a escolha sobrevive a recarregar. A lista ja chega do servidor nessa
  // ordem, pelo cookie, sem ser pedida de novo depois de a tela montar.
  let refetches = 0;
  await page.route(/\/api\/texts\?/, (route) => {
    refetches += 1;
    return route.continue();
  });
  await page.reload();
  await page.waitForLoadState("networkidle");
  await expect(order).toHaveValue("importacao");
  await expect.poll(() => listed(page)).toEqual([LAST, MIDDLE, FIRST]);
  expect(await page.evaluate(() => localStorage.getItem("rk-leitura:ordem-biblioteca"))).toBe(
    "importacao"
  );
  expect(refetches).toBe(0);
  await page.unroute(/\/api\/texts\?/);

  // De volta a "Ultima leitura", o texto lido sobe de novo.
  await order.selectOption("leitura");
  await expect.poll(() => listed(page)).toEqual([FIRST, LAST, MIDDLE]);
});

test("escolha guardada so no aparelho (sem o cookie) ainda vale: a lista e pedida de novo", async ({
  page,
  context,
}) => {
  await registerByApi(page.request);
  const first = await createText(page.request, FIRST, 300);
  await createText(page.request, MIDDLE, 300);
  await createText(page.request, LAST, 300);
  // Uma leitura do mais antigo, direto pela rota: aqui o que se testa e a
  // escolha da ordem, nao o leitor.
  const session = await page.request.post("/api/reading-sessions", {
    data: { textId: first.id, wordsRead: 120, durationMs: 60_000, completed: false },
  });
  expect(session.ok()).toBeTruthy();

  await page.goto("/textos");
  await expect.poll(() => listed(page)).toEqual([FIRST, LAST, MIDDLE]);
  await page.getByLabel("Ordem", { exact: true }).selectOption("importacao");
  await expect.poll(() => listed(page)).toEqual([LAST, MIDDLE, FIRST]);

  // O cookie venceu ou foi apagado; o `localStorage` continua la.
  await context.clearCookies({ name: "rk-leitura-ordem" });

  await page.reload();
  await expect(page.getByLabel("Ordem", { exact: true })).toHaveValue("importacao");
  await expect.poll(() => listed(page)).toEqual([LAST, MIDDLE, FIRST]);
  // E o cookie volta, para a proxima visita ja chegar na ordem certa.
  await expect
    .poll(async () => {
      const cookies = await context.cookies();
      return cookies.find((cookie) => cookie.name === "rk-leitura-ordem")?.value;
    })
    .toBe("importacao");
});

test("Estudar e Do que se trata? ficam na folha Mais acoes do item", async ({ page }) => {
  await registerByApi(page.request);
  await updateSettings(page.request, { aiEnabled: true });
  const text = await createText(page.request, "Texto das acoes", 400);

  let asked = 0;
  await page.route(`**/api/texts/${text.id}/sinopse`, (route) => {
    asked += 1;
    return route.fulfill({ json: { synopsis: "Uma leitura sobre ritmo e atenção." } });
  });

  await page.goto("/textos");
  const item = page.getByTestId("item-da-biblioteca").filter({ hasText: "Texto das acoes" });
  // O item tem so o link do leitor e um botao: o resto saiu do cartao.
  await expect(item.getByRole("link")).toHaveCount(1);
  await expect(item.getByRole("link")).toHaveAttribute("href", `/leitor/${text.id}`);
  await expect(item.getByRole("button")).toHaveCount(1);
  await expect(item.getByTestId("sinopse")).toHaveCount(0);

  const more = page.getByRole("button", { name: "Mais ações: Texto das acoes" });
  // Alvo de toque de acao principal: 48px.
  const target = (await more.boundingBox())!;
  expect(target.width).toBeGreaterThanOrEqual(48);
  expect(target.height).toBeGreaterThanOrEqual(48);

  await more.click();
  const sheet = page.getByRole("dialog");
  await sheet.getByRole("button", { name: "Do que se trata?" }).click();
  await expect(sheet.getByTestId("sinopse")).toContainText("ritmo e atenção");

  // Fechar e abrir de novo: a sinopse continua na folha, sem outro pedido.
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  await more.click();
  await expect(sheet.getByTestId("sinopse")).toContainText("ritmo e atenção");
  await expect(sheet.getByRole("button", { name: "Do que se trata?" })).toHaveCount(0);
  expect(asked).toBe(1);

  await sheet.getByRole("link", { name: "Estudar" }).click();
  await expect(page).toHaveURL(`/textos/${text.id}/estudar`);
});

test("no celular o primeiro texto comeca ate y = 300 e cabem quatro na primeira tela", async ({
  page,
}) => {
  // A tela em que o problema foi medido; sem animacao, para as caixas ja
  // estarem no lugar na hora de medir.
  await page.setViewportSize({ width: 412, height: 839 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await registerByApi(page.request);

  // Com etiquetas, para a faixa delas entrar na conta do cabecalho, e com um
  // titulo de duas linhas, que e o item mais alto.
  const long = await page.request.post("/api/texts", {
    data: {
      title: "Um titulo comprido o bastante para ocupar duas linhas inteiras na tela do celular",
      content: sampleText(300),
      tags: ["estudo", "trabalho"],
      author: "Ana C. Souza",
    },
  });
  expect(long.ok()).toBeTruthy();
  for (const title of ["Segundo texto", "Terceiro texto", "Quarto texto"]) {
    await createText(page.request, title, 300);
  }

  await page.goto("/textos");
  const items = page.getByTestId("item-da-biblioteca");
  // Os quatro criados aqui e o de boas-vindas.
  await expect(items).toHaveCount(5);

  const first = (await items.nth(0).boundingBox())!;
  expect(first.y).toBeLessThanOrEqual(300);

  // O quarto item inteiro acima da barra de navegacao.
  const fourth = (await items.nth(3).boundingBox())!;
  const bar = (await page
    .getByRole("navigation", { name: "Navegação principal" })
    .boundingBox())!;
  expect(fourth.y + fourth.height).toBeLessThanOrEqual(bar.y);

  // Nada estoura a largura com o titulo comprido.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test("cabecalho: a fila tem rotulo, e a etiqueta sem texto sai da faixa mas nao some", async ({
  page,
}) => {
  await registerByApi(page.request);
  const empty = await page.request.post("/api/etiquetas", { data: { name: "sem texto" } });
  expect(empty.ok()).toBeTruthy();
  const tagged = await page.request.post("/api/texts", {
    data: { title: "Com etiqueta", content: sampleText(60), tags: ["estudo"] },
  });
  expect(tagged.ok()).toBeTruthy();

  await page.goto("/textos");

  const queue = page.getByRole("link", { name: "Fila de leitura" });
  await expect(queue).toHaveText("Fila");
  await queue.click();
  await expect(page).toHaveURL("/textos/fila");
  await page.goBack();

  // As etiquetas do item numa linha so, como texto.
  const item = page.getByTestId("item-da-biblioteca").filter({ hasText: "Com etiqueta" });
  await expect(item.getByTestId("etiquetas-do-item")).toContainText("estudo");

  const strip = page.getByRole("group", { name: "Filtrar por etiqueta" });
  await expect(strip.getByRole("button", { name: /estudo/ })).toBeVisible();
  await expect(strip.getByRole("button", { name: /sem texto/ })).toHaveCount(0);

  // A etiqueta sem texto continua em "Organizar etiquetas".
  await page.getByRole("button", { name: "Organizar etiquetas" }).click();
  await expect(page.getByRole("dialog", { name: "Etiquetas" })).toContainText("sem texto");
});
