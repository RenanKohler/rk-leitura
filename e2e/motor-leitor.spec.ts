import { expect, test } from "@playwright/test";
import { createText, openReader, progressOf, randomIp, registerByApi, updateSettings } from "./helpers";

test.beforeEach(async ({ context }) => {
  await context.setExtraHTTPHeaders({ "x-forwarded-for": randomIp() });
});

/** Folha aberta para o Word Runner: antes ele seguia correndo atras dela. */
test("abrir os ajustes pausa o Word Runner", async ({ page }) => {
  await registerByApi(page.request);
  await updateSettings(page.request, { baseWpm: 300, warmup: false });
  const text = await createText(page.request, "Texto para pausar", 400);

  await openReader(page, text.id);
  await page.getByRole("button", { name: "Iniciar leitura" }).click();
  await expect(page.getByTestId("word-runner")).toBeVisible();
  await page.getByRole("button", { name: "Ajustes de leitura" }).click();

  await expect(page.getByTestId("word-runner")).toHaveCount(0);
  const before = await page.locator("header .tabular").innerText();
  await page.waitForTimeout(1_000);
  expect(await page.locator("header .tabular").innerText()).toBe(before);
});

/** Aba escondida: o runner para e a sessao e gravada na hora. */
test("esconder a aba pausa e grava a sessao", async ({ page }) => {
  await registerByApi(page.request);
  await updateSettings(page.request, { baseWpm: 600, warmup: false });
  const text = await createText(page.request, "Texto para esconder", 600);

  await openReader(page, text.id);
  await page.getByRole("button", { name: "Iniciar leitura" }).click();
  await page.waitForTimeout(3_000);

  const posted = page.waitForRequest(
    (request) => request.url().endsWith("/api/reading-sessions") && request.method() === "POST"
  );
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });

  const body = (await posted).postDataJSON() as { wordsRead: number; durationMs: number; mode: string };
  expect(body.mode).toBe("runner");
  expect(body.wordsRead).toBeGreaterThan(10);
  // As pausas de pontuacao saem do tempo: o ritmo gravado fica perto do escolhido.
  const wpm = body.wordsRead / (body.durationMs / 60_000);
  expect(wpm).toBeGreaterThan(540);
  await expect(page.getByTestId("word-runner")).toHaveCount(0);
  await expect.poll(() => progressOf(page.request, text.id)).toBeGreaterThan(0);
});

/** Ler virando paginas conta como sessao e conclui o texto. */
test("virar as paginas conta a leitura e conclui o texto", async ({ page }) => {
  await registerByApi(page.request);
  const text = await createText(page.request, "Texto lido na pagina", 300);

  await page.clock.install();
  await openReader(page, text.id);
  const counter = page.getByText(/^Pagina \d+ de \d+$/);
  await expect(counter).toBeVisible();
  const pages = Number((await counter.innerText()).match(/de (\d+)/)![1]);

  const posted = page.waitForRequest(
    (request) => request.url().endsWith("/api/reading-sessions") && request.method() === "POST"
  );
  for (let turn = 0; turn < pages; turn += 1) {
    await page.clock.fastForward(40_000);
    await page.getByRole("button", { name: "Proxima pagina" }).click();
  }

  await expect(page.getByRole("heading", { name: "Leitura concluida" })).toBeVisible();
  const body = (await posted).postDataJSON() as { mode: string; completed: boolean; wordsRead: number };
  expect(body).toMatchObject({ mode: "pagina", completed: true });
  expect(body.wordsRead).toBeGreaterThan(250);
});

/** Toque duplo no freio nao vira a pagina (o segundo toque caia na pagina). */
test("toque duplo no Word Runner nao pula texto", async ({ page }) => {
  await registerByApi(page.request);
  await updateSettings(page.request, { baseWpm: 300, warmup: false });
  const text = await createText(page.request, "Texto do freio", 900);

  await openReader(page, text.id);
  await page.getByRole("button", { name: "Iniciar leitura" }).click();
  await page.waitForTimeout(800);
  const box = (await page.getByTestId("word-runner").boundingBox())!;
  await page.mouse.dblclick(box.x + box.width - 10, box.y + box.height / 2);
  await expect(page.getByText(/^Pagina 1 de \d+$/)).toBeVisible();
});
