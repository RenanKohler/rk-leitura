import { expect, test, type Page } from "@playwright/test";
import { createText, openReader, randomIp, registerByApi, updateSettings } from "./helpers";

test.beforeEach(async ({ context }) => {
  await context.setExtraHTTPHeaders({ "x-forwarded-for": randomIp() });
});

interface Point {
  x: number;
  y: number;
}

/**
 * Arraste de dedo de verdade, pelo protocolo do navegador: os eventos passam
 * pelo mesmo caminho de um toque na tela, inclusive o `touch-action`, que um
 * `dispatchEvent` de teste nao exercitaria.
 */
async function drag(page: Page, from: Point, to: Point, steps = 6) {
  const client = await page.context().newCDPSession(page);
  const point = (at: Point) => [{ x: Math.round(at.x), y: Math.round(at.y) }];
  await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: point(from) });
  for (let step = 1; step <= steps; step += 1) {
    const at = {
      x: from.x + ((to.x - from.x) * step) / steps,
      y: from.y + ((to.y - from.y) * step) / steps,
    };
    await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: point(at) });
  }
  await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await client.detach();
}

/** Segura o dedo parado e so depois arrasta: toque longo seguido de movimento. */
async function holdThenDrag(page: Page, from: Point, to: Point, holdMs: number) {
  const client = await page.context().newCDPSession(page);
  const point = (at: Point) => [{ x: Math.round(at.x), y: Math.round(at.y) }];
  await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: point(from) });
  await page.waitForTimeout(holdMs);
  await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: point(to) });
  await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await client.detach();
}

async function openLongText(page: Page, words = 900) {
  await registerByApi(page.request);
  await updateSettings(page.request, { readerTipsSeen: true });
  const text = await createText(page.request, "Texto para deslizar", words);
  await openReader(page, text.id);
  const counter = page.getByText(/^Página \d+ de \d+$/);
  await expect(counter).toHaveText(/^Página 1 de \d+$/);
  const box = (await page.locator("main").boundingBox())!;
  return { counter, box, middle: box.y + box.height / 3 };
}

/** Deslizar vira a pagina nos dois sentidos (US-211, criterios 1 e 2). */
test("deslizar para a esquerda avanca e para a direita volta", async ({ page }) => {
  const { counter, box, middle } = await openLongText(page);
  const center = box.x + box.width / 2;

  await drag(page, { x: center + 60, y: middle }, { x: center - 60, y: middle });
  await expect(counter).toHaveText(/^Página 2 de \d+$/);

  await drag(page, { x: center - 60, y: middle }, { x: center + 60, y: middle });
  await expect(counter).toHaveText(/^Página 1 de \d+$/);
});

/** Arraste curto ou mais vertical que horizontal nao vira (criterio 1). */
test("arraste curto ou vertical nao vira a pagina", async ({ page }) => {
  const { counter, box, middle } = await openLongText(page);
  const center = box.x + box.width / 2;

  await drag(page, { x: center + 20, y: middle }, { x: center - 20, y: middle });
  await drag(page, { x: center + 40, y: middle }, { x: center - 40, y: middle + 160 });
  // Um deslize valido depois: se algum dos anteriores tivesse virado, seria a 3.
  await drag(page, { x: center + 60, y: middle }, { x: center - 60, y: middle });
  await expect(counter).toHaveText(/^Página 2 de \d+$/);
});

/** A borda lateral e do gesto de voltar do Android (criterio 4). */
test("deslize que comeca na borda lateral e ignorado", async ({ page }) => {
  const { counter, box, middle } = await openLongText(page);

  await drag(page, { x: box.x + box.width - 10, y: middle }, { x: box.x + box.width - 160, y: middle });
  await drag(page, { x: box.x + box.width - 40, y: middle }, { x: box.x + box.width - 190, y: middle });
  await expect(counter).toHaveText(/^Página 2 de \d+$/);
});

/** Nas pontas do texto o deslize nao sai da pagina nem conclui (criterio 5). */
test("deslizar para fora do texto nao muda a pagina nem conclui a leitura", async ({ page }) => {
  const { counter, box, middle } = await openLongText(page, 300);
  const center = box.x + box.width / 2;
  const pages = Number((await counter.innerText()).match(/de (\d+)/)![1]);

  // Primeira pagina, para tras.
  await drag(page, { x: center - 60, y: middle }, { x: center + 60, y: middle });
  await expect(counter).toHaveText(/^Página 1 de \d+$/);
  await expect(page.getByText("Início do texto.")).toHaveCount(0);

  for (let turn = 1; turn < pages; turn += 1) {
    await drag(page, { x: center + 60, y: middle }, { x: center - 60, y: middle });
    await expect(counter).toHaveText(new RegExp(`^Página ${turn + 1} de \\d+$`));
  }

  // Ultima pagina, para a frente: fica nela; o botao continua concluindo.
  await drag(page, { x: center + 60, y: middle }, { x: center - 60, y: middle });
  await expect(counter).toHaveText(new RegExp(`^Página ${pages} de \\d+$`));
  await expect(page.getByRole("heading", { name: "Leitura concluída" })).toHaveCount(0);

  await page.getByRole("button", { name: "Próxima página" }).click();
  await expect(page.getByRole("heading", { name: "Leitura concluída" })).toBeVisible();
});

/** O toque longo e do dicionario: arrastar depois dele nao vira (criterio 3). */
test("arrastar depois do toque longo abre a palavra e nao vira a pagina", async ({ page }) => {
  const { counter, box, middle } = await openLongText(page);
  const center = box.x + box.width / 2;

  await holdThenDrag(page, { x: center + 60, y: middle }, { x: center - 80, y: middle }, 700);
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(counter).toHaveText(/^Página 1 de \d+$/);
});
