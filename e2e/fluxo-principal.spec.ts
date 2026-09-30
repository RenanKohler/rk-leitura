import { expect, test } from "@playwright/test";
import {
  createText,
  openReader,
  progressOf,
  randomIp,
  registerByApi,
  sampleText,
  uniqueEmail,
  updateSettings,
} from "./helpers";


test.beforeEach(async ({ context }) => {
  await context.setExtraHTTPHeaders({ "x-forwarded-for": randomIp() });
});

/**
 * Fluxo principal (US-74): cadastro, texto colado, leitura no Word Runner ate
 * o fim e a sessao registrada no historico.
 */
test("cadastro, texto colado, leitura no Word Runner e historico", async ({ page }) => {
  await page.goto("/cadastro");
  await page.getByLabel("Nome").fill("Leitora E2E");
  await page.getByLabel("E-mail").fill(uniqueEmail("fluxo"));
  await page.getByLabel("Senha").fill("senha-e2e-123");
  await page.getByRole("button", { name: "Criar conta" }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  // Velocidade maxima e sem rampa: o objetivo e o fluxo, nao o ritmo.
  await updateSettings(page.request, { baseWpm: 1200, warmup: false });

  await page.goto("/textos/novo");
  await page.getByRole("radio", { name: "Colar" }).click();
  await page.getByRole("textbox", { name: "Título" }).fill("Texto do teste de ponta a ponta");
  await page.getByRole("textbox", { name: "Texto" }).fill(sampleText(40));
  await page.getByRole("button", { name: "Salvar e ler" }).click();

  await expect(page).toHaveURL(/\/leitor\//);
  await page.getByRole("button", { name: "Iniciar leitura" }).click();
  await expect(page.getByRole("heading", { name: "Leitura concluída" })).toBeVisible({
    timeout: 20_000,
  });

  await page.goto("/historico");
  await expect(page.getByText("Texto do teste de ponta a ponta").first()).toBeVisible();
});

/**
 * O leitor abre em paginas: o toque na lateral vira a pagina, e a posicao
 * gravada ao sair e a do inicio da pagina exibida.
 */
test("a pagina vira por toque lateral e grava a pagina exibida", async ({ page }) => {
  await registerByApi(page.request);
  const text = await createText(page.request, "Texto longo em paginas", 900);

  await openReader(page, text.id);
  const counter = page.getByText(/^Página \d+ de \d+$/);
  await expect(counter).toHaveText(/^Página 1 de \d+$/);

  // Toque na borda direita do texto vira a pagina.
  const box = (await page.locator("main").boundingBox())!;
  await page.mouse.click(box.x + box.width - 8, box.y + box.height / 2);
  await expect(counter).toHaveText(/^Página 2 de \d+$/);

  // Sair do leitor grava a posicao.
  await page.getByRole("link", { name: "Voltar" }).click();
  await expect(page).toHaveURL(/\/textos/);
  await expect.poll(() => progressOf(page.request, text.id)).toBeGreaterThan(0);

  await openReader(page, text.id);
  await expect(page.getByText(/^Página \d+ de \d+$/)).toHaveText(/^Página 2 de \d+$/);
});

/**
 * Tela unica: parado, o texto aparece em paginas; o play cobre a pagina com o
 * Word Runner e a frase em volta; pausar devolve a pagina com a palavra atual
 * marcada.
 */
test("o Word Runner roda sobre a pagina e pausar volta a ela", async ({ page }) => {
  await registerByApi(page.request);
  await updateSettings(page.request, { baseWpm: 100, warmup: false });
  const text = await createText(page.request, "Texto para o Word Runner", 200);

  await openReader(page, text.id);
  await expect(page.getByText(/^Página 1 de \d+$/)).toBeVisible();
  await expect(page.getByTestId("word-runner")).toHaveCount(0);

  await page.getByRole("button", { name: "Iniciar leitura" }).click();
  const runner = page.getByTestId("word-runner");
  await expect(runner).toBeVisible();
  // A linha de contexto traz a frase, com a palavra atual em destaque.
  const current = runner.locator("[data-current]");
  await expect(current).toHaveCount(1);
  await expect(current).toHaveText(/^\S+$/);
  await expect(page.locator("header .tabular")).toContainText(/^[3-9] \//, { timeout: 10_000 });

  await runner.click();
  await expect(runner).toHaveCount(0);
  await expect(page.getByTestId("palavra-atual")).toBeVisible();
  await expect(page.getByText(/^Página 1 de \d+$/)).toBeVisible();
});

/**
 * APP-11: formato desconhecido e recusado antes de chegar ao leitor de PDF,
 * e .txt entra como texto simples.
 */
test("importacao de arquivo recusa formato desconhecido e aceita .txt", async ({ page }) => {
  await registerByApi(page.request);
  await page.goto("/textos/novo");
  await page.getByRole("radio", { name: "Arquivo" }).click();
  const input = page.locator('input[type="file"]');

  await input.setInputFiles({ name: "foto.png", mimeType: "image/png", buffer: Buffer.from("png") });
  await expect(
    page.getByText("Formato não suportado. Use PDF, EPUB, DOCX, MD ou TXT")
  ).toBeVisible();
  await expect(page.getByText(/Invalid PDF/)).toHaveCount(0);

  await input.setInputFiles({
    name: "conto curto.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(sampleText(30)),
  });
  await expect(page.getByRole("textbox", { name: "Título" })).toHaveValue("conto curto");
  await expect(page.getByText("30 palavras")).toBeVisible();
});
