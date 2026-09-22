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
 * Fluxo principal (US-74): cadastro, texto colado, leitura no modo Foco ate o
 * fim e a sessao registrada no historico.
 */
test("cadastro, texto colado, leitura no modo Foco e historico", async ({ page }) => {
  await page.goto("/cadastro");
  await page.getByLabel("Nome").fill("Leitora E2E");
  await page.getByLabel("E-mail").fill(uniqueEmail("fluxo"));
  await page.getByLabel("Senha").fill("senha-e2e-123");
  await page.getByRole("button", { name: "Criar conta" }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  // Velocidade maxima e sem rampa: o objetivo e o fluxo, nao o ritmo.
  await updateSettings(page.request, { readingMode: "rsvp", baseWpm: 1200, warmup: false });

  await page.goto("/textos/novo");
  await page.getByRole("button", { name: "Colar" }).click();
  await page.getByRole("textbox", { name: "Titulo" }).fill("Texto do teste de ponta a ponta");
  await page.getByRole("textbox", { name: "Texto" }).fill(sampleText(40));
  await page.getByRole("button", { name: "Salvar e ler" }).click();

  await expect(page).toHaveURL(/\/leitor\//);
  await page.getByRole("button", { name: "Iniciar leitura" }).click();
  await expect(page.getByRole("heading", { name: "Leitura concluida" })).toBeVisible({
    timeout: 20_000,
  });

  await page.goto("/historico");
  await expect(page.getByText("Texto do teste de ponta a ponta").first()).toBeVisible();
});

/**
 * Modo Paginas: o toque na lateral vira a pagina, e a posicao gravada ao sair
 * e a do inicio da pagina exibida.
 */
test("modo Paginas vira por toque lateral e grava a pagina exibida", async ({ page }) => {
  await registerByApi(page.request);
  await updateSettings(page.request, { readingMode: "page" });
  const text = await createText(page.request, "Texto longo em paginas", 900);

  await openReader(page, text.id);
  const counter = page.getByText(/^Pagina \d+ de \d+$/);
  await expect(counter).toHaveText(/^Pagina 1 de \d+$/);

  // A zona de toque fica sobre o texto; o botao do rodape tem o mesmo rotulo.
  await page.locator("main").getByRole("button", { name: "Proxima pagina" }).click();
  await expect(counter).toHaveText(/^Pagina 2 de \d+$/);

  // Sair do leitor grava a posicao.
  await page.getByRole("link", { name: "Voltar" }).click();
  await expect(page).toHaveURL(/\/textos/);
  await expect.poll(() => progressOf(page.request, text.id)).toBeGreaterThan(0);

  await openReader(page, text.id);
  await expect(page.getByText(/^Pagina \d+ de \d+$/)).toHaveText(/^Pagina 2 de \d+$/);
});
