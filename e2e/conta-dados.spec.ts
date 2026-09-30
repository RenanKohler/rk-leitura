import { expect, test, type APIRequestContext } from "@playwright/test";
import { createText, randomIp, registerByApi, uniqueEmail } from "./helpers";

test.beforeEach(async ({ context, page }) => {
  await context.setExtraHTTPHeaders({ "x-forwarded-for": randomIp() });
  await page.emulateMedia({ reducedMotion: "reduce" });
});

const PASSWORD = "senha-e2e-123";

/** US-96: codigo de recuperacao redefine a senha uma unica vez. */
test("codigo de recuperacao redefine a senha", async ({ page, playwright }) => {
  const email = await registerByApi(page.request);

  const denied = await page.request.post("/api/auth/codigos", { data: { password: "errada-123" } });
  expect(denied.status()).toBe(403);

  const issued = await page.request.post("/api/auth/codigos", { data: { password: PASSWORD } });
  expect(issued.status()).toBe(201);
  const { codes } = (await issued.json()) as { codes: string[] };
  expect(codes).toHaveLength(8);

  const base = test.info().project.use.baseURL!;
  const guest = await playwright.request.newContext({
    baseURL: base,
    extraHTTPHeaders: { "x-forwarded-for": randomIp() },
  });
  const post = (api: APIRequestContext, data: object) => api.post(`${base}/api/auth/recuperar`, { data });

  const wrong = await post(guest, { email, code: "AAAAA-AAAAA", newPassword: "nova-senha-1" });
  expect(wrong.status()).toBe(400);
  expect((await wrong.json()).error).toBe("Codigo invalido.");

  const ok = await post(guest, { email, code: codes[0]!.toLowerCase(), newPassword: "nova-senha-1" });
  expect(ok.status()).toBe(200);

  const reused = await post(guest, { email, code: codes[0], newPassword: "outra-senha-1" });
  expect(reused.status()).toBe(400);

  // A sessao antiga caiu com a troca de senha.
  expect((await page.request.get("/api/texts")).status()).toBe(401);

  const login = await guest.post(`${base}/api/auth/login`, { data: { email, password: "nova-senha-1" } });
  expect(login.ok()).toBeTruthy();
  await guest.dispose();
});

/** US-97: um aparelho ve o outro e o desconecta. */
test("desconectar outro aparelho", async ({ page, browser }) => {
  const email = uniqueEmail();
  const register = await page.request.post("/api/auth/register", {
    data: { name: "A", email, password: PASSWORD },
  });
  expect(register.ok()).toBeTruthy();

  const other = await browser.newContext({
    baseURL: test.info().project.use.baseURL,
    extraHTTPHeaders: { "x-forwarded-for": randomIp() },
  });
  const login = await other.request.post(`${test.info().project.use.baseURL}/api/auth/login`, {
    data: { email, password: PASSWORD },
  });
  expect(login.ok()).toBeTruthy();

  await page.goto("/ajustes");
  const list = page.getByTestId("aparelhos");
  await expect(list.getByRole("listitem")).toHaveCount(2);
  await expect(list.getByText("Este aparelho")).toHaveCount(1);
  await list.getByRole("button", { name: "Desconectar" }).dispatchEvent("click");
  await expect(list.getByRole("listitem")).toHaveCount(1);

  const after = await other.request.get(`${test.info().project.use.baseURL}/api/texts`);
  expect(after.status()).toBe(401);
  expect((await page.request.get("/api/texts")).ok()).toBeTruthy();
  await other.close();
});

/** US-98: exportar de uma conta e restaurar em outra, sem duplicar na segunda vez. */
test("restaurar a biblioteca a partir do arquivo exportado", async ({ page }) => {
  await registerByApi(page.request);
  const first = await createText(page.request, "Primeiro texto", 40);
  await page.request.post(`/api/texts/${first.id}/destaques`, { data: { start: 0, end: 3 } });
  await page.request.post(`/api/texts/${first.id}/marcadores`, { data: { position: 5, label: "Aqui" } });
  const exported = await (await page.request.get("/api/exportar?tipo=biblioteca")).text();
  expect(JSON.parse(exported).versao).toBe(2);

  await page.request.post("/api/auth/logout");
  await registerByApi(page.request);
  await page.goto("/ajustes");

  const input = page.getByTestId("restaurar-arquivo");
  const file = { name: "leitura-biblioteca.json", mimeType: "application/json", buffer: Buffer.from(exported) };
  await input.setInputFiles(file);
  // O texto de boas-vindas esta nas duas contas: e reconhecido e pulado.
  await expect(page.getByText("1 texto restaurado. 1 ja existia.")).toBeVisible();

  const library = await (await page.request.get("/api/texts")).json();
  expect(library.items).toHaveLength(2);
  const restored = library.items.find(
    (item: { text: { title: string } }) => item.text.title === "Primeiro texto"
  ).text.id as string;
  const marks = await (await page.request.get(`/api/texts/${restored}/destaques`)).json();
  expect(marks.highlights).toHaveLength(1);
  const points = await (await page.request.get(`/api/texts/${restored}/marcadores`)).json();
  expect(points.bookmarks[0].label).toBe("Aqui");

  await input.setInputFiles({ ...file, buffer: Buffer.from('{"outra":"coisa"}') });
  await expect(page.getByText(/Arquivo nao reconhecido/)).toBeVisible();
});

/**
 * APP-1 e PROD-5: a conta nasce com a linha de preferencias e com o texto de
 * boas-vindas. Antes, aceitar a sugestao do teste de nivelamento numa conta
 * recem-criada respondia "aplicado" e a velocidade continuava a padrao.
 */
test("conta nova aceita a sugestao do teste de nivelamento", async ({ page }) => {
  await registerByApi(page.request);

  const before = (await (await page.request.get("/api/settings")).json()).settings;
  expect(before.eyeRest).toBe(true);

  const library = await (await page.request.get("/api/texts")).json();
  expect(library.items).toHaveLength(1);
  expect(library.items[0].text.title).toBe("Boas-vindas ao Leitura");
  expect(library.items[0].text.wordCount).toBeGreaterThan(200);

  const material = await (await page.request.get("/api/teste-de-leitura")).json();
  // Leitura a 250 ppm, com todas as respostas certas.
  const durationMs = Math.round((material.words / 250) * 60_000);
  const result = await page.request.post("/api/teste-de-leitura", {
    data: { durationMs, answers: [1, 2, 1, 1, 2], accept: true },
  });
  expect(result.ok()).toBeTruthy();
  const { suggested, applied, wpm } = await result.json();
  expect(applied).toBe(true);

  const after = (await (await page.request.get("/api/settings")).json()).settings;
  expect(after.baseWpm).toBe(suggested);
  expect(after.placementWpm).toBe(wpm);
  expect(after.placementSeen).toBe(true);
});

/** APP-13: painel, biblioteca e etiquetas contam os mesmos textos. */
test("contagens do painel, da biblioteca e das etiquetas batem", async ({ page }) => {
  await registerByApi(page.request);
  const kept = await page.request.post("/api/texts", {
    data: { title: "Fica", content: "palavra ".repeat(30), tags: ["contagem"] },
  });
  const dropped = await page.request.post("/api/texts", {
    data: { title: "Largado", content: "palavra ".repeat(30), tags: ["contagem"] },
  });
  expect(kept.ok() && dropped.ok()).toBeTruthy();
  const droppedId = (await dropped.json()).text.id as string;
  expect((await page.request.post(`/api/texts/${droppedId}/largar`)).ok()).toBeTruthy();

  const library = await (await page.request.get("/api/texts")).json();
  const stats = await (await page.request.get("/api/stats")).json();
  const { tags } = await (await page.request.get("/api/etiquetas")).json();

  // Boas-vindas e "Fica"; o largado so aparece no filtro proprio.
  expect(library.texts).toBe(2);
  expect(stats.stats.texts).toBe(library.texts);
  expect(tags.find((tag: { name: string }) => tag.name === "contagem").texts).toBe(1);
});

/** US-101 e US-102: historico do texto e calendario do ano. */
test("historico do texto e calendario", async ({ page, browser }) => {
  await registerByApi(page.request);
  const text = await createText(page.request, "Texto medido", 200);
  const session = await page.request.post("/api/reading-sessions", {
    data: { textId: text.id, wordsRead: 120, durationMs: 60_000, completed: false },
  });
  expect(session.ok()).toBeTruthy();

  await page.goto(`/textos/${text.id}/leituras`);
  const summary = page.getByTestId("resumo-texto");
  await expect(summary.getByText("Sessoes")).toBeVisible();
  await expect(summary.getByText("1:00")).toBeVisible();

  await page.goto("/estatisticas");
  await expect(page.getByText(/1 dia com leitura/)).toBeVisible();
  await expect(page.getByTestId("calendario").locator('[data-level="1"]')).toHaveCount(1);

  // A11Y-9: uma parada de Tab so, e as setas andam por dia e por semana.
  const grid = page.getByRole("grid", { name: "Minutos lidos por dia no ultimo ano" });
  await expect(grid.locator('[tabindex="0"]')).toHaveCount(1);
  const today = grid.locator('[tabindex="0"]');
  await today.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(grid.locator('[tabindex="0"]')).toBeFocused();
  await expect(grid.locator('[tabindex="0"]')).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Home");
  await expect(grid.locator('[tabindex="0"]')).toBeFocused();
  await page.keyboard.press("End");
  await expect(grid.locator('[tabindex="0"]')).toHaveAttribute("data-level", "1");

  const stranger = await browser.newContext({
    baseURL: test.info().project.use.baseURL,
    extraHTTPHeaders: { "x-forwarded-for": randomIp() },
  });
  const strangerPage = await stranger.newPage();
  await registerByApi(strangerPage.request);
  // A pagina fica sob um loading.tsx, entao o status ja saiu 200 quando o
  // notFound() dispara; o que vale e a tela de nao encontrado, sem os dados.
  await strangerPage.goto(`/textos/${text.id}/leituras`);
  await expect(strangerPage.getByTestId("resumo-texto")).toHaveCount(0);
  await expect(strangerPage.locator("h1")).toContainText(/nao encontrad/i);
  await stranger.close();
});
