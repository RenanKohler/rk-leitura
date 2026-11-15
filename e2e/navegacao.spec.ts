import { expect, test, type Page } from "@playwright/test";
import {
  openReader,
  randomIp,
  registerByApi,
  updateSettings,
  readerAction,
  sampleText,
} from "./helpers";

test.beforeEach(async ({ context, page }) => {
  await context.setExtraHTTPHeaders({ "x-forwarded-for": randomIp() });
  await page.emulateMedia({ reducedMotion: "reduce" });
});

async function createText(page: Page, content: string, format = "plain") {
  const response = await page.request.post("/api/texts", {
    data: { title: "Navegacao", content, format },
  });
  expect(response.ok()).toBeTruthy();
  return (await response.json()).text as { id: string };
}

const position = (page: Page) =>
  page.locator("header .tabular").innerText().then((text) => Number(text.split("/")[0]!.trim()));

/** US-90: busca ignora acento e caixa, conta e circula pelos resultados. */
test("busca no texto posiciona a leitura no resultado", async ({ page }) => {
  await registerByApi(page.request);
  const text = await createText(
    page,
    "A Memória de trabalho guarda pouco. Outra frase qualquer aqui. A memoria de trabalho cansa. Fim da memória de trabalho, enfim."
  );

  await openReader(page, text.id);
  await readerAction(page, "Navegar no texto");
  const field = page.getByRole("searchbox", { name: "Buscar no texto" });
  await field.fill("memoria de trabalho");
  await expect(page.getByTestId("busca-contagem")).toHaveText("1 de 3");

  await page.getByRole("button", { name: "Próximo" }).click();
  await expect(page.getByTestId("busca-contagem")).toHaveText("2 de 3");
  await page.getByRole("button", { name: "Próximo" }).click();
  await page.getByRole("button", { name: "Próximo" }).click();
  await expect(page.getByTestId("busca-contagem")).toHaveText("1 de 3");

  await field.fill("inexistente");
  await expect(page.getByText("Nada encontrado")).toBeVisible();

  await field.fill("memoria de trabalho");
  await page.getByRole("region", { name: "Buscar no texto" }).getByRole("listitem").nth(1).getByRole("button").click();
  expect(await position(page)).toBe(12);
});

/** Centro da palavra `word` na pagina, para tocar nela. */
async function wordPoint(page: Page, word: string) {
  return page.locator(".reader-prose").first().evaluate((root, target) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const at = node.textContent?.indexOf(target) ?? -1;
      if (at < 0) continue;
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + target.length);
      const rect = range.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }
    throw new Error(`palavra ${target} fora da pagina`);
  }, word);
}

/** US-91 e US-93: tocar numa palavra, voltar a frase e velocidade pelo teclado. */
test("tocar na palavra, voltar a frase e atalhos de teclado", async ({ page }) => {
  await registerByApi(page.request);
  await updateSettings(page.request, { baseWpm: 300 });
  // Palavras curtas no inicio da linha deixam "palavras" longe das bordas,
  // fora das zonas de virar a pagina.
  const text = await createText(page, "Primeira frase curta. Segunda frase tem seis palavras aqui. Terceira.");

  await openReader(page, text.id);
  const point = await wordPoint(page, "palavras");
  await page.mouse.click(point.x, point.y);
  expect(await position(page)).toBe(8);
  await expect(page.getByTestId("palavra-atual")).toHaveText("palavras");
  await page.keyboard.press("Shift+ArrowLeft");
  expect(await position(page)).toBe(4);
  await page.keyboard.press("Shift+ArrowLeft");
  expect(await position(page)).toBe(1);

  await page.keyboard.press("ArrowUp");
  await expect(page.getByText("325 ppm").first()).toBeVisible();

  await page.keyboard.press("?");
  await expect(page.getByRole("dialog", { name: "Como usar o leitor" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Como usar o leitor" })).toHaveCount(0);
});

/** No Word Runner, os botoes andam por frase sem parar a leitura. */
test("Word Runner volta e avanca por frase", async ({ page }) => {
  await registerByApi(page.request);
  await updateSettings(page.request, { baseWpm: 100, warmup: false });
  const frases = Array.from({ length: 8 }, (_, i) => `Frase numero ${i} com cinco palavras.`).join(" ");
  const text = await createText(page, frases);

  await openReader(page, text.id);
  await page.getByRole("button", { name: "Iniciar leitura" }).click();
  const runner = page.getByTestId("palavra-runner");
  await page.getByRole("button", { name: "Avançar a frase" }).click();
  await expect(runner).toHaveText("Frase");
  await page.getByRole("button", { name: "Avançar a frase" }).click();
  await expect(page.getByTestId("word-runner")).toContainText("Frase numero 2");
  await page.getByRole("button", { name: "Voltar a frase" }).click();
  await expect(page.getByTestId("word-runner")).toContainText(/Frase numero [12]/);
  await expect(page.getByTestId("word-runner")).toBeVisible();
});

/** US-89 e US-92: sumario de titulos e marcadores. */
test("sumario leva ao titulo e marcador guarda a posicao", async ({ page }) => {
  await registerByApi(page.request);
  const text = await createText(
    page,
    "# Inicio\n\nTexto de abertura aqui.\n\n## Segunda parte\n\nMais texto nesta parte.\n\n## Terceira parte\n\nFim.",
    "markdown"
  );

  await openReader(page, text.id);
  await readerAction(page, "Navegar no texto");
  const sumario = page.getByRole("region", { name: "Sumário" });
  await expect(sumario.getByRole("button")).toHaveCount(3);
  await sumario.getByRole("button", { name: "Segunda parte" }).click();
  expect(await position(page)).toBe(6);

  await readerAction(page, "Navegar no texto");
  await page.getByLabel("Nome do marcador").fill("Ponto chave");
  await page.getByRole("button", { name: "Marcar" }).click();
  await expect(page.getByRole("button", { name: /^Ponto chave/ })).toBeVisible();
  await page.keyboard.press("Escape");

  // Sai da posicao marcada (voltar a frase) antes de usar o marcador.
  await page.keyboard.press("Shift+ArrowLeft");
  expect(await position(page)).toBeLessThan(6);

  await readerAction(page, "Navegar no texto");
  await page.getByRole("button", { name: /^Ponto chave/ }).click();
  expect(await position(page)).toBe(6);
});

/** US-95 e ALG-17: depois de uma pausa de 5 s ou mais, a leitura recomeca no inicio da frase. */
test("retomar depois de pausa longa volta ao inicio da frase", async ({ page }) => {
  await registerByApi(page.request);
  await updateSettings(page.request, { baseWpm: 150, warmup: false, resumeRewind: true });
  // Frases de 10 palavras: o inicio de cada uma e a posicao 1, 11, 21...
  const words = Array.from({ length: 60 }, (_, i) => `termo${i}${i % 10 === 9 ? "." : ""}`).join(" ");
  const text = await createText(page, words);

  await openReader(page, text.id);
  await page.getByRole("button", { name: "Iniciar leitura" }).click();
  await page.waitForTimeout(4_000);
  await page.getByRole("button", { name: "Pausar" }).first().click();
  const paused = await position(page);
  expect(paused).toBeGreaterThan(6);

  await page.waitForTimeout(5_300);
  await page.getByRole("button", { name: "Iniciar leitura" }).click();
  const sentenceStart = Math.floor((paused - 1) / 10) * 10 + 1;
  expect(await position(page)).toBe(sentenceStart);
});

/** US-227: "Ir para" leva ao comeco do paragrafo da porcentagem escolhida. */
test("Ir para: o slider pelo teclado leva a leitura a 50% do texto", async ({ page }) => {
  await registerByApi(page.request);
  // 600 palavras em paragrafos de 60: a palavra 300 abre o sexto paragrafo.
  const text = await createText(page, sampleText(600));

  await openReader(page, text.id);
  await readerAction(page, "Navegar no texto");
  const sheet = page.getByRole("dialog", { name: "Navegar no texto" });
  const slider = sheet.getByRole("slider", { name: "Ir para" });
  // Abre no progresso atual: a leitura esta no comeco.
  await expect(slider).toHaveValue("0");
  // Texto solto nao tem capitulos para trocar.
  await expect(sheet.getByRole("region", { name: "Capítulos" })).toHaveCount(0);

  await slider.focus();
  for (let step = 0; step < 50; step += 1) await page.keyboard.press("ArrowRight");
  await expect(slider).toHaveValue("50");
  await expect(slider).toHaveAttribute("aria-valuetext", "50%");
  // O destino aparece antes de ir: quanto falta dali ate o fim.
  await expect(sheet.getByTestId("ir-para-destino")).toContainText("faltam");

  await sheet.getByRole("button", { name: "Ir para 50%" }).click();
  await expect(sheet).toHaveCount(0);
  // O cabecalho conta a partir de 1: a palavra 300 e a 301a de 600.
  expect(await position(page)).toBe(301);

  // De volta a folha, o controle abre onde a leitura esta agora.
  await readerAction(page, "Navegar no texto");
  await expect(slider).toHaveValue("50");
  // 100% e o comeco do ultimo paragrafo, nao o fim do texto.
  await slider.focus();
  await page.keyboard.press("End");
  await expect(slider).toHaveValue("100");
  await sheet.getByRole("button", { name: "Ir para 100%" }).click();
  await expect(sheet).toHaveCount(0);
  expect(await position(page)).toBe(541);
});

/** US-227: com titulos no texto, o destino diz em que secao cai. */
test("Ir para mostra a secao do destino", async ({ page }) => {
  await registerByApi(page.request);
  // 243 palavras: "Abertura" (0), 120 de texto, "Segunda parte" (121 e 122) e
  // mais 120. O ultimo paragrafo comeca na 183.
  const text = await createText(
    page,
    `# Abertura\n\n${sampleText(120)}\n\n## Segunda parte\n\n${sampleText(120)}`,
    "markdown"
  );

  await openReader(page, text.id);
  await readerAction(page, "Navegar no texto");
  const sheet = page.getByRole("dialog", { name: "Navegar no texto" });
  const slider = sheet.getByRole("slider", { name: "Ir para" });
  const destination = sheet.getByTestId("ir-para-destino");
  await expect(destination).toContainText("Abertura");

  await slider.focus();
  await page.keyboard.press("End");
  await expect(destination).toContainText("Segunda parte");
  await sheet.getByRole("button", { name: "Ir para 100%" }).click();
  await expect(sheet).toHaveCount(0);
  expect(await position(page)).toBe(184);
});

/** Capitulo de uma serie declarada, como a importacao de EPUB a cria. */
async function createChapter(page: Page, title: string, chapter: number) {
  const response = await page.request.post("/api/texts", {
    data: { title, content: sampleText(120), series: { title: "A travessia", chapter } },
  });
  expect(response.ok()).toBeTruthy();
  return (await response.json()).text as { id: string; wordCount: number };
}

async function setProgress(page: Page, id: string, progressIndex: number) {
  const response = await page.request.patch(`/api/texts/${id}`, {
    data: { progressIndex, at: new Date().toISOString() },
  });
  expect(response.ok()).toBeTruthy();
}

/** US-226: a folha Navegar lista os capitulos da serie e troca de capitulo. */
test("capitulos da serie: o aberto vem marcado e tocar em outro abre o leitor dele", async ({
  page,
}) => {
  await registerByApi(page.request);
  // Importados fora de ordem: a lista segue o numero do capitulo.
  const third = await createChapter(page, "A volta", 3);
  const first = await createChapter(page, "A partida", 1);
  const second = await createChapter(page, "O mar aberto", 2);
  // O primeiro lido ate o fim (o que o arquiva); o segundo pela metade.
  await setProgress(page, first.id, first.wordCount);
  await setProgress(page, second.id, 60);

  await openReader(page, second.id);
  await readerAction(page, "Navegar no texto");
  const sheet = page.getByRole("dialog", { name: "Navegar no texto" });
  const chapters = sheet.getByRole("region", { name: "Capítulos" });
  const rows = chapters.getByRole("listitem");
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText("A partida");
  await expect(rows.nth(0).getByTestId("estado-do-capitulo")).toHaveText("lido");
  await expect(rows.nth(1)).toContainText("O mar aberto");
  await expect(rows.nth(1).getByTestId("estado-do-capitulo")).toHaveText(/^\d{1,2}%$/);
  await expect(rows.nth(2)).toContainText("A volta");
  await expect(rows.nth(2).getByTestId("estado-do-capitulo")).toHaveText("não lido");

  // O aberto e marcado e nao e link; os outros dois sao.
  const current = chapters.locator('[aria-current="page"]');
  await expect(current).toHaveCount(1);
  await expect(current).toContainText("O mar aberto");
  await expect(rows.nth(1).getByRole("link")).toHaveCount(0);
  await expect(chapters.getByRole("link")).toHaveCount(2);
  // Poucos capitulos: a lista aparece inteira, sem "Mostrar todos".
  await expect(chapters.getByRole("button")).toHaveCount(0);

  await chapters.getByRole("link", { name: /A volta/ }).click();
  await expect(page).toHaveURL(new RegExp(`/leitor/${third.id}$`));
  await expect(page.getByRole("heading", { level: 1, name: "A volta" })).toBeVisible();
  await expect(sheet).toHaveCount(0);

  // No capitulo novo a lista e a mesma, com a marca no terceiro.
  await expect(page.getByRole("button", { name: "Iniciar leitura" })).toBeVisible();
  await readerAction(page, "Navegar no texto");
  await expect(rows).toHaveCount(3);
  await expect(current).toContainText("A volta");
  await expect(chapters.getByRole("link", { name: /O mar aberto/ })).toBeVisible();
});

/** US-226: serie longa abre so na vizinhanca do capitulo aberto. */
test("serie longa mostra os vizinhos do capitulo aberto e, a pedido, todos", async ({ page }) => {
  await registerByApi(page.request);
  // Dois digitos no titulo: "Parte 01" nao e prefixo de "Parte 10".
  const ids: string[] = [];
  for (let chapter = 1; chapter <= 12; chapter += 1) {
    const title = `Parte ${String(chapter).padStart(2, "0")}`;
    ids.push((await createChapter(page, title, chapter)).id);
  }

  await openReader(page, ids[9]!);
  await readerAction(page, "Navegar no texto");
  const sheet = page.getByRole("dialog", { name: "Navegar no texto" });
  const chapters = sheet.getByRole("region", { name: "Capítulos" });
  const rows = chapters.getByRole("listitem");
  const current = chapters.locator('[aria-current="page"]');
  // O aberto (10) com o anterior e o seguinte.
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText("Parte 09");
  await expect(current).toContainText("Parte 10");
  await expect(rows.nth(2)).toContainText("Parte 11");

  const toggle = chapters.getByRole("button", { name: "Mostrar todos os 12 capítulos" });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  await expect(rows).toHaveCount(12);
  await expect(rows.nth(0)).toContainText("Parte 01");
  await expect(current).toContainText("Parte 10");
  // A lista inteira tem rolagem propria e abre no capitulo aberto: sem isso
  // a caixa mostraria do 1 ao 6, e o 10 ficaria fora da vista.
  await expect(current).toBeInViewport();
  await expect(rows.nth(0)).not.toBeInViewport();

  const less = chapters.getByRole("button", { name: "Mostrar menos" });
  await expect(less).toHaveAttribute("aria-expanded", "true");
  await less.click();
  await expect(rows).toHaveCount(3);
});
