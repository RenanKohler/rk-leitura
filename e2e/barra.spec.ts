import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { createText, randomIp, registerByApi } from "./helpers";
import { runSql } from "./db";

/**
 * Inicio mais curto (US-228) e a aba "Revisar" na barra de navegacao, com o
 * selo dos itens vencidos (US-229).
 *
 * O projeto roda como Pixel 7, entao a barra e a de baixo; a lateral do
 * desktop e conferida trocando o tamanho da janela. Os itens vencidos entram
 * por SQL, como em `estudo-revisao`: nenhuma rota escreve datas no passado.
 */

// Sem o service worker no meio: `page.route` precisa ver o pedido da contagem.
test.use({ serviceWorkers: "block" });

test.beforeEach(async ({ context, page }) => {
  await context.setExtraHTTPHeaders({ "x-forwarded-for": randomIp() });
  await page.emulateMedia({ reducedMotion: "reduce" });
});

const COUNT_ROUTE = "**/api/revisar/contagem";

async function userId(request: APIRequestContext): Promise<string> {
  const me = await (await request.get("/api/auth/me")).json();
  return me.user.id as string;
}

/** Palavras salvas e ja vencidas: os itens mais simples da Revisao do dia. */
async function dueWords(page: Page, textId: string, words: string[]) {
  for (const word of words) {
    const saved = await page.request.post("/api/palavras", {
      data: { word, context: "ao ritmo das frases", textId },
    });
    expect(saved.status()).toBe(201);
  }
  await runSql("update saved_words set next_review_on = current_date - 1 where user_id = $1", [
    await userId(page.request),
  ]);
}

/** A navegacao que esta na tela: a de baixo no celular, a lateral no desktop. */
const mainNav = (page: Page) => page.getByRole("navigation", { name: "Navegação principal" });
const badge = (page: Page) => mainNav(page).getByTestId("selo-revisar");

/** Responde a palavra da tela e espera a nota entrar (a tela so avanca depois). */
async function answerWord(page: Page) {
  await expect(page.getByTestId("item-revisao")).toHaveAttribute("data-kind", "palavra");
  await page.getByRole("button", { name: "Mostrar resposta" }).click();
  await page.getByRole("button", { name: /^Bom/ }).click();
}

test("Inicio sem o campo de link e sem o cartao de destaques", async ({ page }) => {
  await registerByApi(page.request);
  const text = await createText(page.request, "Texto com destaque", 300);
  // Um destaque vencido era o que fazia o cartao "Revisar destaques" aparecer.
  const highlight = await (
    await page.request.post(`/api/texts/${text.id}/destaques`, { data: { start: 13, end: 26 } })
  ).json();
  await runSql("update highlights set review_due_on = current_date - 2 where id = $1", [highlight.id]);

  await page.goto("/dashboard");
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { name: /^Olá/ })).toBeVisible();
  await expect(main.getByText("Adicionados recentemente")).toBeVisible();

  await expect(page.getByTestId("cartao-revisar-destaques")).toHaveCount(0);
  await expect(main.getByRole("link", { name: /Revisar destaques/ })).toHaveCount(0);
  await expect(main.getByText("Importar de um link")).toHaveCount(0);
  // O campo de link era a unica caixa de texto do Inicio.
  await expect(main.getByRole("textbox")).toHaveCount(0);

  // Importar continua a um toque: o botao "+" da barra.
  await expect(mainNav(page).getByRole("link", { name: "Importar novo texto" })).toHaveAttribute(
    "href",
    "/textos/novo"
  );
});

test("biblioteca vazia aponta o botao + em vez do campo que saiu", async ({ page }) => {
  await registerByApi(page.request);
  // A conta nasce com o texto de boas-vindas: sem ele a biblioteca fica vazia.
  const { texts } = (await (await page.request.get("/api/texts/recentes?perPage=5")).json()) as {
    texts: { id: string }[];
  };
  for (const text of texts) {
    expect((await page.request.delete(`/api/texts/${text.id}`)).ok()).toBeTruthy();
  }

  await page.goto("/dashboard");
  const main = page.getByRole("main");
  await expect(main.getByText("Biblioteca vazia")).toBeVisible();
  await expect(
    main.getByText("Use o botão + para importar um artigo por link ou escrever seu próprio texto.")
  ).toBeVisible();
  await expect(main.getByText(/link de um artigo acima/)).toHaveCount(0);
});

test("barra do celular: Inicio, Textos, Revisar e Voce, uma aba acesa por vez", async ({ page }) => {
  await registerByApi(page.request);

  const counted = page.waitForResponse((response) => response.url().endsWith("/api/revisar/contagem"));
  await page.goto("/dashboard");
  const bar = mainNav(page);
  const tab = (name: string) => bar.getByRole("link", { name, exact: true });
  const lit = bar.locator('[aria-current="page"]');

  for (const name of ["Início", "Textos", "Revisar", "Você"]) {
    await expect(tab(name)).toBeVisible();
  }
  await expect(bar.getByRole("link", { name: "Importar novo texto" })).toBeVisible();
  // Ajustes saiu da barra do celular: chega-se a ele por "Voce".
  await expect(bar.getByRole("link", { name: /Ajustes/ })).toHaveCount(0);
  await expect(bar.getByRole("link")).toHaveCount(5);

  // Conta nova nao tem nada vencido: sem selo, e o nome da aba e so o rotulo.
  expect(((await (await counted).json()) as { total: number }).total).toBe(0);
  await expect(badge(page)).toHaveCount(0);

  await expect(tab("Início")).toHaveAttribute("aria-current", "page");
  await expect(lit).toHaveCount(1);

  await tab("Revisar").click();
  await expect(page).toHaveURL("/revisar");
  await expect(page.getByRole("heading", { name: "Revisão em dia." })).toBeVisible();
  await expect(tab("Revisar")).toHaveAttribute("aria-current", "page");
  await expect(lit).toHaveCount(1);

  // "Voce" perdeu a Revisao do dia e ganhou "Destaques e notas".
  await tab("Você").click();
  await expect(page).toHaveURL("/voce");
  await expect(tab("Você")).toHaveAttribute("aria-current", "page");
  const main = page.getByRole("main");
  await expect(main.getByRole("link", { name: /Revisão do dia/ })).toHaveCount(0);
  const marks = main.getByRole("link", { name: /^Destaques e notas/ });
  await expect(marks).toHaveAttribute("href", "/destaques");
  await expect(marks).toContainText("Trechos marcados e notas de todos os textos");

  // Em Ajustes a aba acesa e "Voce".
  await main.getByRole("link", { name: /^Ajustes/ }).click();
  await expect(page).toHaveURL("/ajustes");
  await expect(tab("Você")).toHaveAttribute("aria-current", "page");
  await expect(lit).toHaveCount(1);

  // As revisoes dedicadas acendem o destino para onde a seta de voltar leva.
  await page.goto("/palavras/revisar");
  await expect(tab("Você")).toHaveAttribute("aria-current", "page");
  await expect(lit).toHaveCount(1);
  // A revisao so de destaques volta para "Destaques e notas", que e de "Voce".
  await page.goto("/textos/destaques/revisar");
  await expect(tab("Você")).toHaveAttribute("aria-current", "page");
  await expect(lit).toHaveCount(1);
  await expect(page.getByRole("main").getByRole("link", { name: "Voltar" })).toHaveAttribute(
    "href",
    "/destaques"
  );
});

test("selo da aba Revisar mostra os itens vencidos e some depois da revisao", async ({ page }) => {
  await registerByApi(page.request);
  const text = await createText(page.request, "Revisao pela barra", 300);
  await dueWords(page, text.id, ["ritmo", "frases"]);

  await page.goto("/dashboard");
  const bar = mainNav(page);
  await expect(badge(page)).toHaveText("2");
  // O selo e so visual: a contagem vai inteira no nome acessivel da aba.
  await expect(badge(page)).toHaveAttribute("aria-hidden", "true");
  const withTwo = bar.getByRole("link", { name: "Revisar, 2 itens vencidos", exact: true });
  await expect(withTwo).toBeVisible();
  // O mesmo numero do cartao do Inicio.
  await expect(page.getByTestId("cartao-revisao-do-dia")).toContainText("Revisão do dia: 2 itens");

  await withTwo.click();
  await expect(page).toHaveURL("/revisar");
  await expect(bar.getByRole("link", { name: /^Revisar/ })).toHaveAttribute("aria-current", "page");
  await expect(page.getByText("1 de 2")).toBeVisible();

  // Uma respondida: o selo cai na hora, ainda dentro da revisao.
  await answerWord(page);
  await expect(page.getByText("2 de 2")).toBeVisible();
  await expect(badge(page)).toHaveText("1");
  await bar.getByRole("link", { name: "Início", exact: true }).click();
  await expect(page).toHaveURL("/dashboard");
  await expect(badge(page)).toHaveText("1");
  await expect(bar.getByRole("link", { name: "Revisar, 1 item vencido", exact: true })).toBeVisible();

  // A ultima: sem itens nao ha selo, e o nome volta a ser so "Revisar".
  await bar.getByRole("link", { name: /^Revisar/ }).click();
  await expect(page).toHaveURL("/revisar");
  await answerWord(page);
  await expect(page.getByRole("heading", { name: "Revisão concluída" })).toBeVisible();
  await expect(badge(page)).toHaveCount(0);
  await page.getByRole("link", { name: "Voltar ao início" }).click();
  await expect(page).toHaveURL("/dashboard");
  await expect(badge(page)).toHaveCount(0);
  await expect(bar.getByRole("link", { name: "Revisar", exact: true })).toBeVisible();
});

test('selo mostra "99+" acima de 99 e o nome da aba traz o numero inteiro', async ({ page }) => {
  await registerByApi(page.request);
  await page.route(COUNT_ROUTE, (route) => route.fulfill({ json: { total: 120 } }));

  await page.goto("/textos");
  await expect(badge(page)).toHaveText("99+");
  await expect(
    mainNav(page).getByRole("link", { name: "Revisar, 120 itens vencidos", exact: true })
  ).toBeVisible();

  // O selo fica dentro da barra, sobre o canto do icone, sem estourar a tela.
  const box = await badge(page).boundingBox();
  const tab = await mainNav(page).getByRole("link", { name: /^Revisar/ }).boundingBox();
  expect(box).not.toBeNull();
  expect(tab).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(tab!.x);
  expect(box!.x + box!.width).toBeLessThanOrEqual(tab!.x + tab!.width);
  expect(box!.y).toBeGreaterThanOrEqual(tab!.y);
  // Selo grande do M3: 16px de altura.
  expect(box!.height).toBeCloseTo(16, 0);
});

test("falha na contagem tira o selo sem erro na tela; um pedido por troca de rota", async ({ page }) => {
  await registerByApi(page.request);
  const text = await createText(page.request, "Contagem que falha", 300);
  await dueWords(page, text.id, ["ritmo"]);

  await page.goto("/dashboard");
  const bar = mainNav(page);
  await expect(badge(page)).toHaveText("1");

  // Daqui em diante a rota falha, como numa queda do servidor.
  let calls = 0;
  await page.route(COUNT_ROUTE, (route) => {
    calls += 1;
    return route.fulfill({ status: 500, json: { error: "falhou" } });
  });

  await bar.getByRole("link", { name: "Textos", exact: true }).click();
  await expect(page).toHaveURL("/textos");
  await expect(badge(page)).toHaveCount(0);
  await expect(bar.getByRole("link", { name: "Revisar", exact: true })).toBeVisible();
  // Um pedido so nesta navegacao, e nenhum aviso: o selo e so um convite.
  expect(calls).toBe(1);
  await expect(page.locator(".toast-region > div")).toHaveCount(0);

  // Sem rede e a mesma coisa: sem selo e sem erro.
  await page.unroute(COUNT_ROUTE);
  await page.route(COUNT_ROUTE, (route) => route.abort("internetdisconnected"));
  await bar.getByRole("link", { name: "Você", exact: true }).click();
  await expect(page).toHaveURL("/voce");
  await expect(badge(page)).toHaveCount(0);
  await expect(page.locator(".toast-region > div")).toHaveCount(0);

  // A rota voltou: na navegacao seguinte o selo volta.
  await page.unroute(COUNT_ROUTE);
  await bar.getByRole("link", { name: "Início", exact: true }).click();
  await expect(page).toHaveURL("/dashboard");
  await expect(badge(page)).toHaveText("1");
});

test("no desktop a lateral tem Revisar com o contador e Ajustes com item proprio", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await registerByApi(page.request);
  const text = await createText(page.request, "Revisao pela lateral", 300);
  await dueWords(page, text.id, ["ritmo"]);

  await page.goto("/dashboard");
  // A barra de baixo some a partir de lg: sobra uma navegacao principal, a lateral.
  const side = mainNav(page);
  await expect(side).toHaveCount(1);
  const item = (name: string) => side.getByRole("link", { name, exact: true });
  const lit = side.locator('[aria-current="page"]');

  for (const name of ["Início", "Textos", "Você", "Ajustes"]) {
    await expect(item(name)).toBeVisible();
  }
  await expect(item("Revisar, 1 item vencido")).toBeVisible();
  await expect(badge(page)).toHaveText("1");
  await expect(side.getByRole("link", { name: "Novo texto" })).toBeVisible();

  await item("Revisar, 1 item vencido").click();
  await expect(page).toHaveURL("/revisar");
  await expect(side.getByRole("link", { name: /^Revisar/ })).toHaveAttribute("aria-current", "page");
  await expect(lit).toHaveCount(1);

  // Na lateral Ajustes acende o proprio item, e "Voce" fica apagado.
  await item("Ajustes").click();
  await expect(page).toHaveURL("/ajustes");
  await expect(item("Ajustes")).toHaveAttribute("aria-current", "page");
  await expect(item("Você")).not.toHaveAttribute("aria-current", "page");
  await expect(lit).toHaveCount(1);

  await item("Você").click();
  await expect(page).toHaveURL("/voce");
  await expect(item("Você")).toHaveAttribute("aria-current", "page");
  await expect(lit).toHaveCount(1);
});
