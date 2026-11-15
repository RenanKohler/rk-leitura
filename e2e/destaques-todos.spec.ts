import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { createText, randomIp, registerByApi, updateSettings } from "./helpers";
import { runSql } from "./db";

/**
 * Destaques e notas de todos os textos (US-224): a tela /destaques e a
 * exportacao de tudo.
 *
 * Os textos entram pela API com conteudo proprio, e nao pelo `sampleText`:
 * a busca precisa de palavras com acento no trecho e de uma palavra que so
 * exista na nota.
 */

test.beforeEach(async ({ context, page }) => {
  await context.setExtraHTTPHeaders({ "x-forwarded-for": randomIp() });
  await page.emulateMedia({ reducedMotion: "reduce" });
});

const WINTER = {
  title: "Caderno de inverno",
  // 0 A  1 lareira  2 aquece  3 a  4 cabana  5 durante  6 a  7 estação  8 fria.
  // 9 O  10 coração  11 da  12 casa  13 fica  14 perto  15 do  16 fogo,  17 e
  // 18 ninguém  19 discorda ...
  content:
    "A lareira aquece a cabana durante a estação fria. O coração da casa fica perto do fogo, e ninguém discorda disso.",
};

const TRAVEL = {
  title: "Notas de viagem",
  // 0 O  1 trem  2 atravessa  3 a  4 planície  5 antes  6 do  7 amanhecer.
  // 8 Viajar  9 devagar  10 ensina  11 a  12 olhar  13 pela  14 janela  15 sem ...
  content:
    "O trem atravessa a planície antes do amanhecer. Viajar devagar ensina a olhar pela janela sem pressa alguma.",
  author: "Ana Lima",
  sourceUrl: "https://exemplo.com/viagem",
  tags: ["viagens"],
};

const HEART = "O coração da casa fica perto do fogo, e ninguém";
const FIRE = "A lareira aquece a cabana";
const WINDOW = "Viajar devagar ensina a olhar pela janela";
const HEART_NOTE = "lembrar da varanda antiga";
const WINDOW_NOTE = "comparar com o diário de bordo";

async function addText(request: APIRequestContext, data: Record<string, unknown>): Promise<string> {
  const response = await request.post("/api/texts", { data });
  expect(response.status()).toBe(201);
  return (await response.json()).text.id as string;
}

/** Destaca `[start, end)` e, se vier, escreve a nota; devolve o id. */
async function addHighlight(
  request: APIRequestContext,
  textId: string,
  start: number,
  end: number,
  note?: string
): Promise<string> {
  const created = await request.post(`/api/texts/${textId}/destaques`, { data: { start, end } });
  expect(created.status()).toBe(201);
  const id = (await created.json()).id as string;
  if (note) {
    const noted = await request.patch(`/api/texts/${textId}/destaques/${id}`, { data: { note } });
    expect(noted.ok()).toBeTruthy();
  }
  return id;
}

/**
 * Dois textos, tres destaques, duas notas. Os do caderno ficam com tres dias,
 * para o texto de viagem ser o do destaque mais recente.
 */
async function seed(request: APIRequestContext) {
  const winter = await addText(request, WINTER);
  const travel = await addText(request, TRAVEL);
  const heart = await addHighlight(request, winter, 9, 19, HEART_NOTE);
  const fire = await addHighlight(request, winter, 0, 5);
  const windowMark = await addHighlight(request, travel, 8, 15, WINDOW_NOTE);
  await runSql("update highlights set created_at = now() - interval '3 days' where text_id = $1", [
    winter,
  ]);
  return { winter, travel, heart, fire, windowMark };
}

const cards = (page: Page) => page.getByTestId("destaque");
const groups = (page: Page) => page.getByTestId("grupo-destaques");
const search = (page: Page) => page.getByRole("searchbox", { name: "Buscar" });
const result = (page: Page) => page.getByTestId("destaques-resultado");

test("lista os destaques de todos os textos, agrupados por texto", async ({ page }) => {
  await registerByApi(page.request);
  const { winter, travel } = await seed(page.request);
  // Texto concluido vai para "Arquivados": os destaques dele continuam aqui.
  await runSql("update texts set archived_at = now() where id = $1", [winter]);

  await page.goto("/destaques");
  await expect(page.getByRole("heading", { level: 1, name: "Destaques e notas" })).toBeVisible();
  await expect(page).toHaveTitle(/Destaques e notas/);
  await expect(page.getByTestId("destaques-contagem")).toHaveText("3 destaques em 2 textos");

  // O texto do destaque mais recente primeiro; o titulo leva aos destaques dele.
  await expect(groups(page)).toHaveCount(2);
  const first = groups(page).nth(0);
  const second = groups(page).nth(1);
  await expect(first.getByRole("link", { name: "Notas de viagem" })).toHaveAttribute(
    "href",
    `/textos/${travel}/destaques`
  );
  await expect(first.getByTestId("grupo-contagem")).toHaveText("1 destaque");
  await expect(second.getByRole("link", { name: "Caderno de inverno" })).toHaveAttribute(
    "href",
    `/textos/${winter}/destaques`
  );
  await expect(second.getByTestId("grupo-contagem")).toHaveText("2 destaques");

  // Dentro do texto, a ordem do texto: o trecho do comeco antes do do meio,
  // embora tenha sido marcado depois.
  const winterCards = second.getByTestId("destaque");
  await expect(winterCards).toHaveCount(2);
  await expect(winterCards.nth(0).locator("blockquote")).toHaveText(FIRE);
  await expect(winterCards.nth(1).locator("blockquote")).toHaveText(HEART);

  // Trecho, nota, data e o link que abre o leitor naquele ponto.
  const heart = winterCards.nth(1);
  await expect(heart.getByTestId("destaque-nota")).toHaveText(HEART_NOTE);
  await expect(heart).toContainText(/\d{2}\/\d{2}\/\d{4}/);
  await expect(heart.getByRole("link", { name: "Ler a partir daqui" })).toHaveAttribute(
    "href",
    `/leitor/${winter}?de=9`
  );
  await expect(winterCards.nth(0).getByTestId("destaque-nota")).toHaveCount(0);

  // O trecho e o mesmo que a tela de destaques do texto mostra.
  const perText = await (await page.request.get(`/api/texts/${winter}/destaques`)).json();
  const excerpts = (perText.highlights as { excerpt: string }[]).map((item) => item.excerpt);
  expect(excerpts).toEqual([FIRE, HEART]);
});

test("busca no trecho, na nota e no titulo, sem acento; filtro Com nota", async ({ page }) => {
  await registerByApi(page.request);
  await seed(page.request);

  await page.goto("/destaques");
  await expect(cards(page)).toHaveCount(3);
  // Sem busca nem filtro nao ha frase de resultado.
  await expect(result(page)).toHaveText("");

  // Palavra que so esta numa nota.
  await search(page).fill("varanda");
  await expect(cards(page)).toHaveCount(1);
  await expect(cards(page).locator("blockquote")).toHaveText(HEART);
  await expect(result(page)).toHaveText("1 destaque corresponde à busca.");
  await expect(groups(page)).toHaveCount(1);
  // A contagem da tela continua a de tudo.
  await expect(page.getByTestId("destaques-contagem")).toHaveText("3 destaques em 2 textos");

  // Palavra do trecho escrita sem acento, e em maiuscula.
  await search(page).fill("coracao");
  await expect(cards(page)).toHaveCount(1);
  await expect(cards(page).locator("blockquote")).toHaveText(HEART);
  await search(page).fill("CORACAO DA CASA");
  await expect(cards(page)).toHaveCount(1);
  await expect(cards(page).locator("blockquote")).toHaveText(HEART);

  // A virgula do trecho nao atrapalha a frase digitada sem ela.
  await search(page).fill("fogo e ninguem");
  await expect(cards(page)).toHaveCount(1);
  await expect(cards(page).locator("blockquote")).toHaveText(HEART);

  // Pelo titulo do texto vem todos os destaques dele.
  await search(page).fill("caderno");
  await expect(cards(page)).toHaveCount(2);
  await expect(result(page)).toHaveText("2 destaques correspondem à busca.");
  await expect(groups(page).getByRole("link", { name: "Caderno de inverno" })).toBeVisible();

  // Nada encontrado: a tela diz e oferece voltar.
  await search(page).fill("xilofone");
  await expect(cards(page)).toHaveCount(0);
  await expect(result(page)).toHaveText("Nenhum destaque corresponde à busca.");
  await expect(page.getByRole("heading", { name: "Nada encontrado" })).toBeVisible();
  await page.getByRole("button", { name: "Ver todos os destaques" }).click();
  await expect(search(page)).toHaveValue("");
  await expect(cards(page)).toHaveCount(3);

  // "Com nota" deixa so os anotados; "Todos" devolve a lista.
  const withNote = page.getByRole("button", { name: "Com nota", exact: true });
  const all = page.getByRole("button", { name: "Todos", exact: true });
  await expect(all).toHaveAttribute("aria-pressed", "true");
  await withNote.click();
  await expect(withNote).toHaveAttribute("aria-pressed", "true");
  await expect(all).toHaveAttribute("aria-pressed", "false");
  await expect(cards(page)).toHaveCount(2);
  await expect(page.getByTestId("destaque-nota")).toHaveText([WINDOW_NOTE, HEART_NOTE]);
  await expect(result(page)).toHaveText("2 destaques com nota.");

  // Busca e filtro valem juntos: o trecho da lareira nao tem nota.
  await search(page).fill("lareira");
  await expect(cards(page)).toHaveCount(0);
  await expect(result(page)).toHaveText("Nenhum destaque com nota corresponde à busca.");
  await all.click();
  await expect(cards(page)).toHaveCount(1);
  await expect(cards(page).locator("blockquote")).toHaveText(FIRE);
});

test("exportar tudo baixa um Markdown com os dois textos", async ({ page, playwright }) => {
  await registerByApi(page.request);
  await updateSettings(page.request, { timezone: "America/Sao_Paulo" });
  await seed(page.request);

  await page.goto("/destaques");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Exportar tudo (.md)" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^destaques-\d{4}-\d{2}-\d{2}\.md$/);
  const markdown = Buffer.concat(await (await download.createReadStream()).toArray()).toString("utf8");

  expect(markdown).toContain("# Destaques e notas");
  expect(markdown).toContain("3 destaques em 2 textos.");
  expect(markdown).toContain("## Notas de viagem");
  expect(markdown).toContain("## Caderno de inverno");
  // O texto do destaque mais recente primeiro, como na tela.
  expect(markdown.indexOf("## Notas de viagem")).toBeLessThan(markdown.indexOf("## Caderno de inverno"));

  // Dados do texto, so os que existem.
  expect(markdown).toContain("- Autor: Ana Lima");
  expect(markdown).toContain("- Origem: <https://exemplo.com/viagem>");
  expect(markdown).toContain("- Etiquetas: viagens");
  expect(markdown).toMatch(/- Adicionado em: \d{2}\/\d{2}\/\d{4}/);
  expect(markdown).toMatch(/- Destacado em: \d{2}\/\d{2}\/\d{4}/);
  expect(markdown.match(/- Autor:/g)).toHaveLength(1);

  // Trecho em citacao e a nota abaixo, na ordem do texto.
  expect(markdown).toContain(`> ${WINDOW}\n\n${WINDOW_NOTE}\n`);
  expect(markdown).toContain(`> ${FIRE}\n\n> ${HEART}\n\n${HEART_NOTE}\n`);

  // A rota devolve o mesmo arquivo, como anexo e sem cache.
  const response = await page.request.get("/api/destaques/exportar");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("text/markdown");
  expect(response.headers()["content-disposition"]).toMatch(
    /^attachment; filename="destaques-\d{4}-\d{2}-\d{2}\.md"$/
  );
  expect(response.headers()["cache-control"]).toContain("no-store");
  expect(await response.text()).toBe(markdown);

  // Sem sessao a rota nao entrega nada.
  const base = test.info().project.use.baseURL!;
  const guest = await playwright.request.newContext({
    baseURL: base,
    extraHTTPHeaders: { "x-forwarded-for": randomIp() },
  });
  expect((await guest.get(`${base}/api/destaques/exportar`)).status()).toBe(401);
  await guest.dispose();
});

test("destaque vencido mostra o atalho da revisao; fora da revisao leva o rotulo", async ({
  page,
}) => {
  await registerByApi(page.request);
  const { winter, heart, fire } = await seed(page.request);
  // Um vencido ha dois dias e um tirado da revisao pelo leitor (US-223).
  await runSql("update highlights set review_due_on = current_date - 2 where id = $1", [heart]);
  const off = await page.request.patch(`/api/texts/${winter}/destaques/${fire}`, {
    data: { review: false },
  });
  expect(off.ok()).toBeTruthy();
  // Os tres dias do `seed` venceriam os dois do caderno; fora da revisao nao vence.

  await page.goto("/destaques");
  const review = page.getByTestId("revisar-destaques");
  await expect(review).toHaveText("Revisar destaques (1)");
  await expect(review).toHaveAttribute("href", "/textos/destaques/revisar");

  await expect(page.getByTestId("fora-da-revisao")).toHaveCount(1);
  const fireCard = cards(page).filter({ hasText: FIRE });
  await expect(fireCard.getByTestId("fora-da-revisao")).toHaveText("Fora da revisão");

  await review.click();
  await expect(page).toHaveURL("/textos/destaques/revisar");
  await expect(page.getByRole("heading", { name: "Revisar destaques" })).toBeVisible();
});

test("acima do limite a tela avisa, desenha por partes e a exportacao leva tudo", async ({
  page,
}) => {
  await registerByApi(page.request);
  const me = await (await page.request.get("/api/auth/me")).json();
  const text = await createText(page.request, "Texto muito marcado", 4_100);
  // 2.001 destaques de uma palavra, um a mais que o limite da tela. Entram
  // por SQL: pela rota seriam dois mil pedidos.
  await runSql(
    `insert into highlights (user_id, text_id, start_index, end_index)
     select $1::uuid, $2::uuid, n * 2, n * 2 + 1 from generate_series(0, 2000) as n`,
    [me.user.id, text.id]
  );

  await page.goto("/destaques");
  // O corte e dito, com os dois numeros.
  await expect(page.getByTestId("destaques-limite")).toContainText(
    "Mostrando os 2.000 mais recentes de 2.001."
  );
  await expect(page.getByTestId("destaques-contagem")).toHaveText("2.000 destaques em 1 texto");
  await expect(page.getByTestId("grupo-contagem")).toHaveText("2.000 destaques");

  // A lista vem por partes; a contagem e a busca valem para todos os carregados.
  await expect(cards(page)).toHaveCount(60);
  const more = page.getByRole("button", { name: /^Mostrar mais/ });
  await expect(more).toHaveText("Mostrar mais (faltam 1.940)");
  await more.click();
  await expect(cards(page)).toHaveCount(120);
  await expect(more).toHaveText("Mostrar mais (faltam 1.880)");

  // Buscar volta ao comeco da lista.
  await search(page).fill("leitura");
  await expect(result(page)).toHaveText(/^\d+ destaques correspondem à busca\.$/);
  await expect(cards(page)).toHaveCount(60);

  // O limite e so da tela: o arquivo traz os 2.001.
  const exported = await (await page.request.get("/api/destaques/exportar")).text();
  expect(exported).toContain("2.001 destaques em 1 texto.");
  expect(exported).not.toContain("Este arquivo traz");
});

test("sem destaque, a tela diz como criar e nao oferece busca nem exportacao", async ({ page }) => {
  await registerByApi(page.request);

  await page.goto("/destaques");
  await expect(page.getByRole("heading", { level: 1, name: "Destaques e notas" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Nenhum destaque ainda" })).toBeVisible();
  await expect(page.getByRole("main")).toContainText("Destacar frase");
  await expect(page.getByRole("main")).toContainText("selecione um trecho");
  await expect(search(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Exportar tudo (.md)" })).toHaveCount(0);
  // Nada vencido: sem o atalho para a revisao.
  await expect(page.getByTestId("revisar-destaques")).toHaveCount(0);

  // A rota responde mesmo assim, com o arquivo vazio.
  const response = await page.request.get("/api/destaques/exportar");
  expect(response.status()).toBe(200);
  expect(await response.text()).toBe("# Destaques e notas\n\n_Nenhum destaque._\n");
});
