import { expect, test } from "@playwright/test";
import { randomIp, registerByApi } from "./helpers";
import { bookmarkletCode } from "../src/lib/bookmarklet";

/**
 * "Enviar para o Leitura": o favorito roda num site que recusaria o servidor,
 * le a pagina aberta e a seguinte (`?page=2`) pelo proprio navegador, envia o
 * HTML a `/api/receber` e o app abre a previa. O site e simulado na rede; o
 * app e o de verdade.
 */

test.use({ serviceWorkers: "block" });

test.beforeEach(async ({ context }) => {
  await context.setExtraHTTPHeaders({ "x-forwarded-for": randomIp() });
});

const SITE = "http://historias.example/s/o-conto";

function storyPage(n: number, hasNext: boolean): string {
  const paragraphs = [1, 2]
    .map((i) => `<p>Página ${n}, parágrafo ${i}: frases suficientes para formar um trecho de leitura de verdade.</p>`)
    .join("");
  const next = hasNext ? `<a href="?page=${n + 1}">Próxima</a>` : "";
  return `<!doctype html><html lang="pt-BR"><head><title>O conto enviado</title>
<script>window.rastreio = true;</script></head>
<body><nav>Menu do site</nav><article>${paragraphs}</article>${next}</body></html>`;
}

test("o favorito envia as paginas e o app abre a previa completa", async ({ page, baseURL }) => {
  await registerByApi(page.request);
  await page.route("http://historias.example/**", (route) => {
    const url = new URL(route.request().url());
    const n = Number(url.searchParams.get("page")) || 1;
    if (n > 2) return route.fulfill({ status: 404, body: "" });
    return route.fulfill({ contentType: "text/html; charset=utf-8", body: storyPage(n, n < 2) });
  });

  await page.goto(SITE);
  await page.evaluate(bookmarkletCode(baseURL!));

  await page.waitForURL("**/textos/novo");
  await expect(page.getByTestId("paginas")).toHaveText("2 páginas importadas, até o fim do texto.");
  await expect(page.getByRole("textbox", { name: "Título" })).toHaveValue("O conto enviado");
  await expect(page.getByRole("textbox", { name: "Endereço do artigo" })).toHaveValue(SITE);

  const saved = page.waitForResponse(
    (response) => response.url().endsWith("/api/texts") && response.request().method() === "POST"
  );
  await page.getByRole("button", { name: "Salvar e ler" }).click();
  const body = (await saved).request().postDataJSON() as { content: string; sourceUrl: string; lastPage: number };
  expect(body.sourceUrl).toBe(SITE);
  expect(body.lastPage).toBe(2);
  expect(body.content).toContain("Página 2, parágrafo 2");
  expect(body.content).not.toContain("Menu do site");
});

test("recarregar depois do envio nao reabre a previa", async ({ page, baseURL }) => {
  await registerByApi(page.request);
  await page.route("http://historias.example/**", (route) =>
    route.fulfill({ contentType: "text/html; charset=utf-8", body: storyPage(1, false) })
  );

  await page.goto(SITE);
  await page.evaluate(bookmarkletCode(baseURL!));
  await page.waitForURL("**/textos/novo");
  await expect(page.getByRole("button", { name: "Salvar e ler" })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("heading", { name: "Novo texto" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Salvar e ler" })).toHaveCount(0);
});

test("envio sem texto mostra o motivo no formulario", async ({ page, baseURL }) => {
  await registerByApi(page.request);
  await page.route("http://historias.example/**", (route) =>
    route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: "<!doctype html><html><head><title>Vazia</title></head><body><p>Pouco.</p></body></html>",
    })
  );

  await page.goto(SITE);
  await page.evaluate(bookmarkletCode(baseURL!));
  await page.waitForURL("**/textos/novo");
  await expect(page.getByText("Não encontrei texto suficiente nessa página.")).toBeVisible();
});
