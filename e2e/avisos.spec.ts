import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { openReader, randomIp, registerByApi, updateSettings } from "./helpers";

test.beforeEach(async ({ context, page }) => {
  await context.setExtraHTTPHeaders({ "x-forwarded-for": randomIp() });
  await page.emulateMedia({ reducedMotion: "reduce" });
});

const PROSE = [
  "A pescadora saiu cedo para o mar enquanto a cidade ainda dormia tranquila.",
  "Carregava uma rede remendada e uma garrafa de cafe quente embaixo do braco.",
  "No meio da travessia, o vento mudou de direcao e o barco balancou perigosamente.",
  "Ela segurou o leme com firmeza e esperou a tempestade passar sem desespero.",
  "Quando o sol voltou, havia peixes prateados pulando ao redor da pequena embarcacao.",
  "Maria voltou para casa contente, com historias novas para contar aos vizinhos curiosos.",
  "Os vizinhos escutaram tudo sentados na calcada, admirados com a coragem da mulher.",
  "Naquela noite, a vila inteira jantou peixe assado e conversou sobre o oceano generoso.",
].join(" ");

async function createText(request: APIRequestContext, title: string, content: string) {
  const response = await request.post("/api/texts", { data: { title, content } });
  expect(response.ok()).toBeTruthy();
  return (await response.json()).text as { id: string };
}

/** Le no Word Runner por `steps` avancos do relogio da pagina e pausa. */
async function readInRunner(page: Page, steps: number) {
  await page.getByRole("button", { name: "Iniciar leitura" }).click();
  await expect(page.getByTestId("word-runner")).toBeVisible();
  for (let step = 0; step < steps; step += 1) await page.clock.runFor(120);
  await page.getByRole("button", { name: "Pausar" }).click();
  await expect(page.getByTestId("word-runner")).toHaveCount(0);
}

/**
 * Avisos na leitura (US-218 e US-219): uma sugestao por vez acima da barra, e
 * a que foi dispensada nao volta na pausa seguinte nem na proxima abertura.
 */
test("sugestoes aparecem uma por vez e a dispensada nao volta", async ({ page }) => {
  test.setTimeout(120_000);
  await registerByApi(page.request);
  await updateSettings(page.request, {
    baseWpm: 1200,
    warmup: false,
    askCheckpoints: false,
    readerTipsSeen: true,
  });
  // Longo o bastante para tres leituras sem chegar ao fim do texto.
  const text = await createText(page.request, "Avisos", Array(90).fill(PROSE).join("\n\n"));

  // Tres sessoes com muitos freios: ha sugestao de reduzir a velocidade.
  for (let i = 0; i < 3; i += 1) {
    const created = await page.request.post("/api/reading-sessions", {
      data: { textId: text.id, wordsRead: 150, durationMs: 30_000, mode: "runner", brakes: [3, 20, 40] },
    });
    expect(created.ok()).toBeTruthy();
  }

  await page.clock.install();
  await openReader(page, text.id);
  const slowdown = page.getByRole("button", { name: "Dispensar sugestão" });
  const check = page.getByTestId("checar-sessao");
  await expect(slowdown).toBeVisible();

  // Pausa depois de 800 palavras: as duas estao pendentes, so a checagem aparece.
  await readInRunner(page, 1100);
  await expect(check).toBeVisible();
  await expect(slowdown).toHaveCount(0);
  await expect
    .poll(async () => (await (await page.request.get(`/api/texts/${text.id}`)).json()).text.sessionCheckOfferedAt)
    .not.toBeNull();

  // Dispensada a checagem, a outra espera a proxima pausa.
  await check.getByRole("button", { name: "Dispensar a checagem" }).click();
  await expect(check).toHaveCount(0);
  await expect(slowdown).toHaveCount(0);

  // Pausa seguinte: a checagem ja foi oferecida hoje; e a vez da velocidade.
  await readInRunner(page, 60);
  await expect(slowdown).toBeVisible();
  await expect(check).toHaveCount(0);

  const answered = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/reading-sessions/sugestao") &&
      response.request().method() === "POST"
  );
  await slowdown.click();
  expect((await answered).ok()).toBeTruthy();
  await expect(slowdown).toHaveCount(0);

  // Outra abertura: a sugestao dispensada nao volta, nem a checagem do dia.
  const fetched = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/reading-sessions/sugestao") &&
      response.request().method() === "GET"
  );
  await openReader(page, text.id);
  expect((await (await fetched).json()).suggestion).toBeNull();
  await expect(slowdown).toHaveCount(0);
  const progress = async () =>
    (await (await page.request.get(`/api/texts/${text.id}`)).json()).text.progressIndex as number;
  const before = await progress();
  await readInRunner(page, 1000);
  await expect(page.getByRole("button", { name: "Iniciar leitura" })).toBeVisible();
  // Sessao nova com mais de 800 palavras: sem a regra do dia, a oferta voltaria.
  await expect.poll(async () => (await progress()) - before).toBeGreaterThanOrEqual(800);
  await expect(check).toHaveCount(0);
});
