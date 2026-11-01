import { expect, test, type Page } from "@playwright/test";
import { createText, openReader, randomIp, registerByApi, updateSettings } from "./helpers";

/*
 * Leitura no celular (docs/backlog-celular.md, US-210 a US-217).
 *
 * O toque e simulado pelo protocolo do Chrome (`Input.dispatchTouchEvent`):
 * gera os mesmos `touchstart`/`touchmove`/`touchend` de um dedo de verdade,
 * com o projeto rodando como Pixel 7.
 */

test.beforeEach(async ({ context }) => {
  await context.setExtraHTTPHeaders({ "x-forwarded-for": randomIp() });
});

interface Point {
  x: number;
  y: number;
}

async function swipe(page: Page, from: Point, to: Point, steps = 10) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: from.x, y: from.y }],
  });
  for (let step = 1; step <= steps; step += 1) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        {
          x: from.x + ((to.x - from.x) * step) / steps,
          y: from.y + ((to.y - from.y) * step) / steps,
        },
      ],
    });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}

/** Centro do quadro da pagina, para os deslizes. */
async function pageCenter(page: Page): Promise<Point & { width: number }> {
  const box = (await page.getByTestId("quadro-pagina").boundingBox())!;
  const width = page.viewportSize()!.width;
  return { x: width / 2, y: box.y + box.height / 2, width };
}

async function setup(page: Page, words: number, settings: Record<string, unknown> = {}) {
  await registerByApi(page.request);
  await updateSettings(page.request, { readerTipsSeen: true, warmup: false, ...settings });
  return createText(page.request, "Texto no celular", words);
}

const counter = (page: Page) => page.getByText(/^Página \d+ de \d+$/);

test("US-211: deslizar vira a página e volta, sem disputar com a borda nem com a vertical", async ({
  page,
}) => {
  const text = await setup(page, 900);
  await openReader(page, text.id);
  await expect(counter(page)).toHaveText(/^Página 1 de \d+$/);
  const center = await pageCenter(page);

  // Primeira pagina: deslizar para a direita nao sai do texto.
  await swipe(page, { x: center.x - 80, y: center.y }, { x: center.x + 80, y: center.y });
  await expect(counter(page)).toHaveText(/^Página 1 de \d+$/);

  // Para a esquerda avanca.
  await swipe(page, { x: center.x + 80, y: center.y }, { x: center.x - 80, y: center.y });
  await expect(counter(page)).toHaveText(/^Página 2 de \d+$/);

  // Deslocamento vertical maior que o horizontal nao vira.
  await swipe(page, { x: center.x + 40, y: center.y - 100 }, { x: center.x - 40, y: center.y + 100 });
  await page.waitForTimeout(300);
  await expect(counter(page)).toHaveText(/^Página 2 de \d+$/);

  // Comecando a menos de 24 px da borda, o gesto e do sistema. (Da borda
  // esquerda o Chrome volta no historico de verdade; a direita nao tem efeito
  // no navegador e mostra so o que o leitor faz.)
  await swipe(page, { x: center.width - 10, y: center.y }, { x: center.width - 200, y: center.y });
  await page.waitForTimeout(300);
  await expect(counter(page)).toHaveText(/^Página 2 de \d+$/);

  // Curto demais (menos de 60 px) tambem nao.
  await swipe(page, { x: center.x, y: center.y }, { x: center.x + 40, y: center.y });
  await page.waitForTimeout(300);
  await expect(counter(page)).toHaveText(/^Página 2 de \d+$/);

  // Para a direita volta.
  await swipe(page, { x: center.x - 80, y: center.y }, { x: center.x + 80, y: center.y });
  await expect(counter(page)).toHaveText(/^Página 1 de \d+$/);

  // Os botoes continuam.
  await page.getByRole("button", { name: "Próxima página" }).click();
  await expect(counter(page)).toHaveText(/^Página 2 de \d+$/);
});

test("US-212: deslizar no Word Runner muda a velocidade sem parar; tocar continua freando", async ({
  page,
}) => {
  const text = await setup(page, 1500, { baseWpm: 300 });
  await openReader(page, text.id);
  await page.getByRole("button", { name: "Iniciar leitura" }).click();
  const runner = page.getByTestId("word-runner");
  await expect(runner).toBeVisible();

  const box = (await runner.boundingBox())!;
  const y = box.y + box.height / 2;
  const x = box.x + box.width / 2;

  // 100 px para a direita: dois passos de 25 ppm.
  await swipe(page, { x: x - 50, y }, { x: x + 50, y });
  await expect(page.getByTestId("velocidade-deslize")).toHaveText("350 ppm");
  await expect(runner).toBeVisible();
  // O indicador some em cerca de 1 segundo.
  await expect(page.getByTestId("velocidade-deslize")).toHaveCount(0, { timeout: 3_000 });

  // Para a esquerda desce na mesma proporcao.
  await swipe(page, { x: x + 60, y }, { x: x - 60, y });
  await expect(page.getByTestId("velocidade-deslize")).toHaveText("275 ppm");
  await expect(runner).toBeVisible();

  // Da borda, e ignorado.
  await page.waitForTimeout(1_200);
  const width = page.viewportSize()!.width;
  await swipe(page, { x: width - 8, y }, { x: width - 200, y });
  await page.waitForTimeout(300);
  await expect(page.getByTestId("velocidade-deslize")).toHaveCount(0);
  await expect(runner).toBeVisible();

  // Toque sem deslize: freio.
  await page.waitForTimeout(500);
  await page.touchscreen.tap(x, y);
  await expect(runner).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Velocidade: 275 ppm" })).toBeVisible();

  // A velocidade nova e gravada na conta.
  await expect
    .poll(async () => (await (await page.request.get("/api/settings")).json()).settings.baseWpm)
    .toBe(275);
});

test.describe("US-213: controles escondidos", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("rk-leitura:esconder-controles", "1"));
  });

  test("somem na leitura e depois de 4 s parado, sem refazer a página", async ({ page }) => {
    const text = await setup(page, 900, { baseWpm: 200 });
    await openReader(page, text.id);
    const top = page.getByTestId("controles-topo");
    const bottom = page.getByTestId("controles-rodape");
    await expect(counter(page)).toHaveText(/^Página 1 de \d+$/);
    const frameBefore = (await page.getByTestId("quadro-pagina").boundingBox())!;
    const firstWord = await page.getByTestId("quadro-pagina").locator("p").first().innerText();

    // Parado, sem tocar nos controles: saem depois de 4 segundos.
    await expect(bottom).not.toHaveAttribute("data-hidden");
    await expect(bottom).toHaveAttribute("data-hidden", "true", { timeout: 6_000 });
    await expect(top).toHaveAttribute("data-hidden", "true");

    // A pagina nao foi refeita: o quadro tem a mesma altura e o mesmo texto.
    const frameAfter = (await page.getByTestId("quadro-pagina").boundingBox())!;
    expect(frameAfter.height).toBe(frameBefore.height);
    expect(await page.getByTestId("quadro-pagina").locator("p").first().innerText()).toBe(firstWord);

    // Tocar fora das palavras traz de volta.
    const stage = (await page.getByTestId("quadro-pagina").boundingBox())!;
    await page.touchscreen.tap(stage.x + stage.width / 2, stage.y - 8);
    await expect(bottom).not.toHaveAttribute("data-hidden");
    await expect(top).not.toHaveAttribute("data-hidden");

    // No Word Runner saem; ao pausar voltam.
    await page.getByRole("button", { name: "Iniciar leitura" }).click();
    await expect(bottom).toHaveAttribute("data-hidden", "true");
    const runner = page.getByTestId("word-runner");
    const box = (await runner.boundingBox())!;
    await page.waitForTimeout(500);
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await expect(runner).toHaveCount(0);
    await expect(bottom).not.toHaveAttribute("data-hidden");
  });

  test("ficam com folha aberta, com o foco nos controles e quando a opção é desligada", async ({
    page,
  }) => {
    const text = await setup(page, 900);
    await openReader(page, text.id);
    const bottom = page.getByTestId("controles-rodape");

    // Folha aberta: os controles nao somem.
    await page.getByRole("button", { name: "Mais ações", exact: true }).click();
    await expect(page.getByTestId("mais-acoes")).toBeVisible();
    await page.waitForTimeout(5_000);
    await expect(bottom).not.toHaveAttribute("data-hidden");
    await page.getByTestId("mais-acoes").getByRole("button", { name: "Ajustes de leitura" }).click();

    // Desligar nos ajustes volta ao comportamento antigo.
    const option = page.getByTestId("opcao-esconder-controles").getByRole("checkbox");
    await expect(option).toBeChecked();
    await option.uncheck();
    await page.keyboard.press("Escape");
    await page.waitForTimeout(5_000);
    await expect(bottom).not.toHaveAttribute("data-hidden");
    expect(await page.evaluate(() => localStorage.getItem("rk-leitura:esconder-controles"))).toBe("0");

    // Religada, o foco do teclado dentro dos controles os mantem na tela.
    await page.evaluate(() => {
      localStorage.setItem("rk-leitura:esconder-controles", "1");
      window.dispatchEvent(new Event("rk-leitura:opcao-aparelho"));
    });
    await page.getByRole("button", { name: "Iniciar leitura" }).focus();
    await page.waitForTimeout(5_000);
    await expect(bottom).not.toHaveAttribute("data-hidden");
  });
});

test("US-214: o botão de modo alterna Word Runner e Guia na página", async ({ page }) => {
  const text = await setup(page, 900, { baseWpm: 200 });
  await openReader(page, text.id);
  const mode = page.getByTestId("modo-play");
  await expect(mode).toHaveAttribute("data-mode", "runner");

  await mode.click();
  await expect(mode).toHaveAttribute("data-mode", "guia");
  expect(await page.evaluate(() => localStorage.getItem("rk-leitura:play-mode"))).toBe("guia");

  // Play no modo novo: guia na pagina, sem o Word Runner.
  await page.getByRole("button", { name: "Iniciar leitura" }).click();
  await expect(page.getByTestId("word-runner")).toHaveCount(0);
  await expect(page.getByTestId("palavra-atual")).toBeVisible();

  // Trocar com a leitura em andamento continua no modo novo, da palavra atual.
  const before = await page.locator("header .tabular").innerText();
  await mode.click();
  await expect(page.getByTestId("word-runner")).toBeVisible();
  await expect(page.getByRole("button", { name: "Pausar" })).toBeVisible();
  const position = (value: string) => Number(value.split(" /")[0]!.replace(/\D/g, ""));
  expect(position(await page.locator("header .tabular").innerText())).toBeGreaterThanOrEqual(
    position(before)
  );

  // Os ajustes refletem o valor novo.
  await page.getByRole("button", { name: "Pausar" }).click();
  await page.getByRole("button", { name: "Mais ações", exact: true }).click();
  await page.getByTestId("mais-acoes").getByRole("button", { name: "Ajustes de leitura" }).click();
  await expect(
    page.getByRole("dialog", { name: "Ajustes de leitura" }).getByRole("radio", { name: "Word Runner" })
  ).toBeChecked();
});

test("US-215: ações do texto no rodapé, com área de toque de 48 px", async ({ page }) => {
  const text = await setup(page, 400);
  await openReader(page, text.id);

  // No celular o cabecalho fica so com Voltar e o progresso.
  const header = page.locator("header");
  await expect(header.getByRole("link", { name: "Voltar" })).toBeVisible();
  await expect(header.getByRole("button", { name: "Ajustes de leitura" })).toBeHidden();
  await expect(header.getByRole("button", { name: "Navegar no texto" })).toBeHidden();

  // Todos os controles do rodape com pelo menos 48 x 48 px.
  const sizes = await page
    .getByTestId("controles-rodape")
    .locator("button")
    .evaluateAll((buttons) =>
      buttons
        .filter((button) => button.getBoundingClientRect().width > 0)
        .map((button) => {
          const box = button.getBoundingClientRect();
          return { name: button.getAttribute("aria-label") ?? button.textContent, w: box.width, h: box.height };
        })
    );
  expect(sizes.length).toBeGreaterThanOrEqual(7);
  for (const size of sizes) {
    expect(size.w, String(size.name)).toBeGreaterThanOrEqual(48);
    expect(size.h, String(size.name)).toBeGreaterThanOrEqual(48);
  }

  await page.getByRole("button", { name: "Mais ações", exact: true }).click();
  const sheet = page.getByTestId("mais-acoes");
  await expect(sheet.getByRole("button", { name: "Perguntar ao texto" })).toBeVisible();
  await expect(sheet.getByRole("link", { name: "Estudar" })).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Navegar no texto" })).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Ajustes de leitura" })).toBeVisible();

  await sheet.getByRole("button", { name: "Navegar no texto" }).click();
  await expect(page.getByRole("dialog", { name: "Navegar no texto" })).toBeVisible();
});

test("US-215: em tela larga o cabeçalho mantém as ações", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 800 });
  const text = await setup(page, 400);
  await openReader(page, text.id);
  await expect(page.locator("header").getByRole("button", { name: "Ajustes de leitura" })).toBeVisible();
});

test("US-217: deitado, a coluna fica limitada e os controles cabem em 25% da altura", async ({
  page,
}) => {
  const text = await setup(page, 900, { baseWpm: 150 });
  await page.setViewportSize({ width: 839, height: 412 });
  await openReader(page, text.id);
  await expect(counter(page)).toBeHidden(); // a linha de estado sai na horizontal
  // Coluna de cerca de 70 caracteres: 38 vezes o tamanho da letra, centralizada.
  const frame = (await page.getByTestId("quadro-pagina").boundingBox())!;
  const fontSize = await page
    .getByTestId("quadro-pagina")
    .locator(".reader-prose")
    .first()
    .evaluate((element) => parseFloat(getComputedStyle(element).fontSize));
  expect(frame.width).toBeLessThanOrEqual(fontSize * 38 + 1);
  expect(frame.width).toBeLessThan(839 - 40);
  expect(Math.abs(frame.x + frame.width / 2 - 839 / 2)).toBeLessThan(2);

  const top = (await page.getByTestId("controles-topo").locator("header").boundingBox())!;
  const bottom = (await page.getByTestId("controles-rodape").boundingBox())!;
  expect(top.height + bottom.height).toBeLessThanOrEqual(412 * 0.25);

  // Sem rolagem horizontal.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(839);

  // Girar no meio do Word Runner nao para a leitura nem pula palavras.
  await page.getByRole("button", { name: "Iniciar leitura" }).click();
  const word = page.getByTestId("palavra-runner");
  await expect(word).toBeVisible();
  const wordBox = (await word.boundingBox())!;
  expect(wordBox.y).toBeGreaterThanOrEqual(0);
  expect(wordBox.y + wordBox.height).toBeLessThanOrEqual(412);
  const before = await page.locator("header .tabular").innerText();
  await page.setViewportSize({ width: 412, height: 839 });
  await expect(page.getByTestId("word-runner")).toBeVisible();
  await page.waitForTimeout(800);
  const position = (value: string) => Number(value.split(" /")[0]!.replace(/\D/g, ""));
  const after = position(await page.locator("header .tabular").innerText());
  expect(after).toBeGreaterThan(position(before));
  // 150 ppm: em menos de 1 s nao passam mais de 4 palavras.
  expect(after - position(before)).toBeLessThanOrEqual(4);
});

test("US-217: o app instalado acompanha a orientação do aparelho", async ({ page }) => {
  const response = await page.request.get("/manifest.webmanifest");
  expect(response.ok()).toBeTruthy();
  expect((await response.json()).orientation).toBe("any");
});
