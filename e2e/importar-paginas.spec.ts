import { expect, test } from "@playwright/test";
import { randomIp, registerByApi } from "./helpers";

/**
 * Importar o texto completo: a caixa pede todas as paginas (`?page=`), a
 * previa diz quantas vieram e o texto salvo guarda a ultima, para "Continuar"
 * seguir dali. A busca na origem e simulada na rede: o laco que junta as
 * paginas e testado sem rede em `tests/continuation.test.ts`.
 */

test.use({ serviceWorkers: "block" });

test.beforeEach(async ({ context }) => {
  await context.setExtraHTTPHeaders({ "x-forwarded-for": randomIp() });
});

const PARTES = [1, 2, 3]
  .map((n) => `Parte ${n} do conto, com frases suficientes para formar um parágrafo de leitura.`)
  .join("\n\n");

function imported(pages?: { first: number; last: number; complete: boolean; stopMessage: string }) {
  return {
    title: "Conto em partes",
    content: PARTES,
    wordCount: 42,
    sourceUrl: "https://exemplo.com/conto",
    language: "pt-BR",
    extraction: "exata",
    author: null,
    ...(pages ? { pages } : {}),
  };
}

test("marcar a caixa importa todas as paginas e guarda a ultima", async ({ page }) => {
  await registerByApi(page.request);
  let body: Record<string, unknown> | null = null;
  await page.route("**/api/import-url", (route) => {
    body = route.request().postDataJSON();
    return route.fulfill({
      json: imported({ first: 1, last: 3, complete: true, stopMessage: "" }),
    });
  });

  await page.goto("/textos/novo");
  await page.getByRole("textbox", { name: "Endereço do artigo" }).fill("https://exemplo.com/conto");
  const caixa = page.getByRole("checkbox", { name: /Importar o texto completo/ });
  await expect(caixa).not.toBeChecked();
  await caixa.check();
  await page.getByRole("button", { name: "Importar" }).click();

  await expect(page.getByTestId("paginas")).toHaveText("3 páginas importadas, até o fim do texto.");
  expect(body).toEqual({ url: "https://exemplo.com/conto", allPages: true });

  const saved = page.waitForResponse(
    (response) => response.url().endsWith("/api/texts") && response.request().method() === "POST"
  );
  await page.getByRole("button", { name: "Salvar e ler" }).click();
  const response = await saved;
  expect(response.request().postDataJSON()).toMatchObject({ lastPage: 3 });
  const { text } = (await response.json()) as { text: { id: string; sourcePage: number } };
  expect(text.sourcePage).toBe(3);
});

test("parada antes do fim avisa o motivo e o caminho para o resto", async ({ page }) => {
  await registerByApi(page.request);
  await page.route("**/api/import-url", (route) =>
    route.fulfill({
      json: imported({
        first: 1,
        last: 2,
        complete: false,
        stopMessage: "A origem demorou demais para responder.",
      }),
    })
  );

  await page.goto("/textos/novo");
  await page.getByRole("textbox", { name: "Endereço do artigo" }).fill("https://exemplo.com/conto");
  await page.getByRole("checkbox", { name: /Importar o texto completo/ }).check();
  await page.getByRole("button", { name: "Importar" }).click();

  await expect(page.getByTestId("paginas")).toHaveText(
    "2 páginas importadas, até a página 2. A origem demorou demais para responder. O restante pode ser buscado com Continuar, no leitor."
  );
});

test("sem a caixa a importacao continua sendo so da pagina pedida", async ({ page }) => {
  await registerByApi(page.request);
  let body: Record<string, unknown> | null = null;
  await page.route("**/api/import-url", (route) => {
    body = route.request().postDataJSON();
    return route.fulfill({ json: imported() });
  });

  await page.goto("/textos/novo");
  await page.getByRole("textbox", { name: "Endereço do artigo" }).fill("https://exemplo.com/conto");
  await page.getByRole("button", { name: "Importar" }).click();

  await expect(page.getByRole("textbox", { name: "Título" })).toHaveValue("Conto em partes");
  await expect(page.getByTestId("paginas")).toHaveCount(0);
  expect(body).toEqual({ url: "https://exemplo.com/conto" });

  const saved = page.waitForResponse(
    (response) => response.url().endsWith("/api/texts") && response.request().method() === "POST"
  );
  await page.getByRole("button", { name: "Salvar e ler" }).click();
  const { text } = (await (await saved).json()) as { text: { sourcePage: number } };
  expect(text.sourcePage).toBe(1);
});
