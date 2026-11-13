import { expect, test, type Page } from "@playwright/test";
import {
  createText,
  openReader,
  progressOf,
  randomIp,
  readerAction,
  registerByApi,
  updateSettings,
} from "./helpers";

/**
 * Rolagem continua: o texto inteiro numa coluna que o leitor arrasta.
 *
 * O arraste e simulado pelo protocolo do Chrome (`Input.dispatchTouchEvent`),
 * que passa pelo mesmo caminho de um dedo na tela e rola a coluna de verdade.
 */

test.beforeEach(async ({ context }) => {
  await context.setExtraHTTPHeaders({ "x-forwarded-for": randomIp() });
});

const frame = (page: Page) => page.getByTestId("quadro-pagina");
const scrollTop = (page: Page) => frame(page).evaluate((element) => element.scrollTop);
/** Linha de estado da barra: na rolagem, o quanto do texto ja passou. */
const status = (page: Page, text: RegExp) => page.locator(".reader-bar-status").filter({ hasText: text });

/** Arrasta o dedo de baixo para cima na coluna: o texto sobe. */
async function dragUp(page: Page, distance: number) {
  const box = (await frame(page).boundingBox())!;
  const x = box.x + box.width / 2;
  const from = box.y + box.height * 0.8;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y: from }] });
  for (let step = 1; step <= 12; step += 1) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x, y: from - (distance * step) / 12 }],
    });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}

/**
 * Centro de uma palavra a vista, no meio da coluna. Um ponto qualquer da
 * linha pode cair no espaco entre duas palavras, que nao e palavra nenhuma.
 */
async function wordPoint(page: Page): Promise<{ x: number; y: number }> {
  const point = await frame(page).evaluate((element) => {
    const column = element.getBoundingClientRect();
    const middle = column.top + column.height / 2;
    let best: { x: number; y: number; distance: number } | null = null;
    for (const block of element.querySelectorAll(".reader-prose > p")) {
      const box = block.getBoundingClientRect();
      if (box.bottom < column.top + 40 || box.top > column.bottom - 40) continue;
      const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        for (const match of (node.textContent ?? "").matchAll(/\S{5,}/g)) {
          const range = document.createRange();
          range.setStart(node, match.index);
          range.setEnd(node, match.index + match[0].length);
          const word = range.getBoundingClientRect();
          // Inteira na tela e numa linha so (palavra partida tem caixa alta).
          if (word.top < column.top + 40 || word.bottom > column.bottom - 40) continue;
          if (word.height > 60) continue;
          const y = word.top + word.height / 2;
          const distance = Math.abs(y - middle);
          if (!best || distance < best.distance) {
            best = { x: word.left + word.width / 2, y, distance };
          }
        }
      }
    }
    return best ? { x: best.x, y: best.y } : null;
  });
  expect(point).not.toBeNull();
  return point!;
}

/** Espera a coluna parar: o impulso do arraste segue por um tempo depois do dedo. */
async function settled(page: Page): Promise<number> {
  let last = await scrollTop(page);
  await expect
    .poll(
      async () => {
        const before = last;
        last = await scrollTop(page);
        return last === before;
      },
      { intervals: [250] }
    )
    .toBe(true);
  return last;
}

async function setup(page: Page, words: number, settings: Record<string, unknown> = {}) {
  await registerByApi(page.request);
  await updateSettings(page.request, { readerTipsSeen: true, warmup: false, ...settings });
  return createText(page.request, "Texto rolado", words);
}

/** Liga a rolagem antes de a tela carregar: a opcao e do aparelho. */
async function scrollModeOn(page: Page) {
  await page.addInitScript(() => localStorage.setItem("rk-leitura:rolagem", "1"));
}

test("ligar a rolagem mostra o texto inteiro, e arrastar muda e guarda a posicao", async ({
  page,
}) => {
  const text = await setup(page, 900);
  await openReader(page, text.id);
  await expect(page.getByText(/^Página 1 de \d+$/)).toBeVisible();

  await readerAction(page, "Ajustes de leitura");
  await page.getByTestId("opcao-rolagem").getByRole("checkbox").check();
  await page.keyboard.press("Escape");
  expect(await page.evaluate(() => localStorage.getItem("rk-leitura:rolagem"))).toBe("1");

  // Sem paginas: a coluna rola e tem todos os paragrafos do texto (900 / 60).
  await expect(frame(page)).toHaveAttribute("data-rolagem", "sim");
  await expect(status(page, /^0%$/)).toBeVisible();
  await expect(frame(page).locator(".reader-prose > p")).toHaveCount(15);
  expect(await scrollTop(page)).toBe(0);

  await dragUp(page, 300);
  await expect.poll(() => scrollTop(page)).toBeGreaterThan(100);
  await expect(status(page, /^[1-9]\d*%$/)).toBeVisible();
  // A posicao que veio da rolagem nao ganha marca de palavra atual.
  await expect(page.getByTestId("palavra-atual")).toHaveCount(0);

  // Sair grava a posicao; abrir de novo volta ao mesmo lugar, ja rolado.
  await page.getByRole("link", { name: "Voltar" }).click();
  await expect(page).toHaveURL(/\/textos/);
  await expect.poll(() => progressOf(page.request, text.id)).toBeGreaterThan(0);
  const saved = await progressOf(page.request, text.id);

  await openReader(page, text.id);
  await expect(frame(page)).toHaveAttribute("data-rolagem", "sim");
  await expect.poll(() => scrollTop(page)).toBeGreaterThan(100);
  await expect(page.getByTestId("palavra-atual")).toBeInViewport();
  expect(await progressOf(page.request, text.id)).toBe(saved);
});

test("tocar numa palavra a vista nao faz o texto pular", async ({ page }) => {
  await scrollModeOn(page);
  const text = await setup(page, 900);
  await openReader(page, text.id);
  await dragUp(page, 250);
  await expect.poll(() => scrollTop(page)).toBeGreaterThan(100);
  // A rolagem assenta antes do toque.
  await expect(status(page, /^[1-9]\d*%$/)).toBeVisible();
  const before = await scrollTop(page);

  const point = await wordPoint(page);
  await page.touchscreen.tap(point.x, point.y);
  await expect(page.getByTestId("palavra-atual")).toBeInViewport();
  expect(await scrollTop(page)).toBe(before);
});

test("pausar o Word Runner leva a coluna ate a palavra em que a leitura parou", async ({
  page,
}) => {
  await scrollModeOn(page);
  const text = await setup(page, 1500, { baseWpm: 1200 });
  await page.clock.install();
  await openReader(page, text.id);
  expect(await scrollTop(page)).toBe(0);

  await page.getByRole("button", { name: "Iniciar leitura" }).click();
  await expect(page.getByTestId("word-runner")).toBeVisible();
  for (let step = 0; step < 500; step += 1) await page.clock.runFor(120);
  await page.getByRole("button", { name: "Pausar" }).click();
  await expect(page.getByTestId("word-runner")).toHaveCount(0);

  await expect(page.getByTestId("palavra-atual")).toBeInViewport();
  expect(await scrollTop(page)).toBeGreaterThan(200);
});

test("ler rolando conta como leitura e o fim do texto conclui pelo botao", async ({ page }) => {
  await scrollModeOn(page);
  const text = await setup(page, 300);
  await page.clock.install();
  await openReader(page, text.id);
  await expect(status(page, /^0%$/)).toBeVisible();

  const posted = page.waitForRequest(
    (request) => request.url().endsWith("/api/reading-sessions") && request.method() === "POST"
  );

  // Um minuto na tela e a coluna vai ate o fim: tempo plausivel para o trecho.
  await page.clock.fastForward(60_000);
  await frame(page).evaluate((element) => element.scrollTo(0, element.scrollHeight));
  await page.clock.runFor(400);
  await expect(status(page, /^[1-9]\d*%$/)).toBeVisible();
  // Chegar ao fundo nao conclui sozinho.
  await expect(page.getByRole("heading", { name: "Leitura concluída" })).toHaveCount(0);

  await page.clock.fastForward(40_000);
  await page.getByRole("button", { name: "Concluir leitura" }).click();
  await expect(page.getByRole("heading", { name: "Leitura concluída" })).toBeVisible();

  const body = (await posted).postDataJSON() as { mode: string; completed: boolean; wordsRead: number };
  expect(body).toMatchObject({ mode: "pagina", completed: true });
  expect(body.wordsRead).toBeGreaterThan(250);
  await expect.poll(() => progressOf(page.request, text.id)).toBe(text.wordCount);
});

test("o guia na pagina segue pela coluna rolada, com a palavra atual a vista", async ({ page }) => {
  await scrollModeOn(page);
  await page.addInitScript(() => localStorage.setItem("rk-leitura:play-mode", "guia"));
  const text = await setup(page, 1500, { baseWpm: 1200 });
  await page.clock.install();
  await openReader(page, text.id);

  await page.getByRole("button", { name: "Iniciar leitura" }).click();
  for (let step = 0; step < 500; step += 1) await page.clock.runFor(120);
  await expect(page.getByTestId("palavra-atual")).toBeInViewport();
  expect(await scrollTop(page)).toBeGreaterThan(200);
  await page.getByRole("button", { name: "Pausar" }).click();
  await expect(page.getByTestId("palavra-atual")).toBeInViewport();
});

test("com os controles escondidos, o texto fica no lugar quando eles saem da tela", async ({
  page,
}) => {
  await scrollModeOn(page);
  await page.addInitScript(() => localStorage.setItem("rk-leitura:esconder-controles", "1"));
  const text = await setup(page, 900);
  await openReader(page, text.id);
  await dragUp(page, 300);
  await expect(status(page, /^[1-9]\d*%$/)).toBeVisible();

  // Um paragrafo a vista serve de referencia: onde ele esta na tela.
  const reference = async () =>
    frame(page).evaluate((element) => {
      const column = element.getBoundingClientRect();
      const blocks = [...element.querySelectorAll(".reader-prose > p")];
      const at = blocks.findIndex((block) => block.getBoundingClientRect().top > column.top + 40);
      return { at, top: Math.round(blocks[at]!.getBoundingClientRect().top) };
    });
  const before = await reference();
  const heightBefore = (await frame(page).boundingBox())!.height;

  // Quatro segundos parado: cabecalho e rodape saem e a coluna cresce.
  await expect(page.locator("footer.reader-footer")).toHaveAttribute("data-hidden", "true", {
    timeout: 8_000,
  });
  await expect.poll(async () => (await frame(page).boundingBox())!.height).toBeGreaterThan(heightBefore);
  const after = await frame(page).evaluate((element, at) => {
    const block = element.querySelectorAll(".reader-prose > p")[at]!;
    return Math.round(block.getBoundingClientRect().top);
  }, before.at);
  expect(Math.abs(after - before.top)).toBeLessThanOrEqual(1);
});

test("segurar o dedo numa palavra abre o dicionario, sem rolar nem mudar a posicao", async ({
  page,
}) => {
  await scrollModeOn(page);
  const text = await setup(page, 900);
  await openReader(page, text.id);
  await dragUp(page, 250);
  await expect(status(page, /^[1-9]\d*%$/)).toBeVisible();
  const before = await scrollTop(page);

  const point = await wordPoint(page);

  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
  await page.waitForTimeout(700);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();

  await expect(page.getByRole("dialog")).toBeVisible();
  expect(await scrollTop(page)).toBe(before);
});

test("rolar para tras, com os controles escondidos, deixa o texto parado e mostra o atalho de volta", async ({
  page,
}) => {
  await scrollModeOn(page);
  await page.addInitScript(() => localStorage.setItem("rk-leitura:esconder-controles", "1"));
  const text = await setup(page, 3000);
  await openReader(page, text.id);

  // Com os controles fora da tela, a leitura avanca bastante e depois volta.
  await expect(page.locator("footer.reader-footer")).toHaveAttribute("data-hidden", "true", {
    timeout: 8_000,
  });
  // O impulso de cada arraste varia: arrasta ate passar de 3000 px.
  let far = 0;
  for (let drag = 0; drag < 20 && far <= 3000; drag += 1) {
    await dragUp(page, 400);
    far = await settled(page);
  }
  expect(far).toBeGreaterThan(3000);
  await expect(status(page, /^[1-9]\d*%$/)).toBeVisible();
  // Bem mais que uma tela para tras: longe do lugar onde a leitura estava.
  await frame(page).evaluate((element) => element.scrollBy(0, -2800));
  expect(await settled(page)).toBeLessThan(far - 2000);

  // O atalho aparece e segura os controles na tela.
  await expect(page.getByRole("button", { name: "Voltar para onde parou" })).toBeVisible();
  await expect(page.locator("footer.reader-footer")).not.toHaveAttribute("data-hidden");

  // Nada fica se alternando: a coluna para de se mexer.
  const seen = new Set<number>();
  for (let sample = 0; sample < 15; sample += 1) {
    seen.add(Math.round(await scrollTop(page)));
    await page.waitForTimeout(150);
  }
  expect([...seen]).toHaveLength(1);

  await page.getByRole("button", { name: "Voltar para onde parou" }).click();
  await expect.poll(() => scrollTop(page)).toBeGreaterThan(far - 300);
  await expect(page.getByRole("button", { name: "Voltar para onde parou" })).toHaveCount(0);
});

test("os botoes de pagina rolam uma tela e nao concluem a leitura", async ({ page }) => {
  await scrollModeOn(page);
  const text = await setup(page, 900);
  await openReader(page, text.id);
  const height = (await frame(page).boundingBox())!.height;

  await page.getByRole("button", { name: "Próxima página" }).click();
  await expect.poll(() => scrollTop(page)).toBeGreaterThan(height * 0.7);
  expect(await scrollTop(page)).toBeLessThanOrEqual(height);
  await expect(status(page, /^[1-9]\d*%$/)).toBeVisible();

  await page.getByRole("button", { name: "Página anterior" }).click();
  // Volta ao comeco (a conta de 90% da tela pode sobrar um pixel).
  await expect.poll(() => scrollTop(page)).toBeLessThanOrEqual(2);

  // No fundo do texto, "próxima página" nao tem para onde ir e nao conclui.
  await frame(page).evaluate((element) => element.scrollTo(0, element.scrollHeight));
  await expect(page.getByRole("button", { name: "Concluir leitura" })).toBeInViewport();
  await page.getByRole("button", { name: "Próxima página" }).click();
  await page.waitForTimeout(500);
  await expect(page.getByRole("heading", { name: "Leitura concluída" })).toHaveCount(0);
});
