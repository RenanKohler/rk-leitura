import { expect, test } from "@playwright/test";
import { runSql } from "./db";
import { createText, randomIp, registerByApi, sampleText, updateSettings } from "./helpers";

/**
 * Biblioteca assistida por IA (US-136 a US-138). O modelo nao roda aqui: as
 * respostas dele sao simuladas na rede, e o teste confere o que a tela faz
 * com elas e o que chega ao banco.
 */

// Com o service worker no ar, o pedido sai por ele e escapa do `page.route`.
test.use({ serviceWorkers: "block" });

test.beforeEach(async ({ context }) => {
  await context.setExtraHTTPHeaders({ "x-forwarded-for": randomIp() });
});

const PARAGRAFOS = [
  "Início | Política | Esportes | Assine já",
  "O primeiro parágrafo do artigo fala do assunto principal com calma e detalhe suficiente.",
  "Leia também: dez coisas que você precisa saber antes de sair de casa hoje",
  "O segundo parágrafo continua o raciocínio e fecha o argumento do autor.",
  "Aceitamos cookies para melhorar sua experiência de navegação neste site.",
];

test("previa risca restos de pagina, Manter devolve e sugestao nao se aplica sozinha", async ({
  page,
}) => {
  await registerByApi(page.request);
  await updateSettings(page.request, { aiEnabled: true });
  await page.request.post("/api/etiquetas", { data: { name: "Política" } });

  await page.route("**/api/import-url", (route) =>
    route.fulfill({
      json: {
        title: "Artigo de teste",
        content: PARAGRAFOS.join("\n\n"),
        wordCount: 60,
        sourceUrl: "https://exemplo.com/artigo",
        language: "pt-BR",
        extraction: "palpite",
      },
    })
  );
  let analysisBody: Record<string, unknown> | null = null;
  await page.route("**/api/import-url/analise", (route) => {
    analysisBody = route.request().postDataJSON();
    return route.fulfill({
      json: {
        leftovers: [
          { index: 0, reason: "navegação" },
          { index: 2, reason: "leia também" },
          { index: 4, reason: "aviso" },
        ],
        suggestedTags: ["Política"],
      },
    });
  });

  await page.goto("/textos/novo");
  await page.getByRole("textbox", { name: "Endereço do artigo" }).fill("https://exemplo.com/artigo");
  await page.getByRole("button", { name: "Importar" }).click();

  const marcados = page.getByTestId("resto-de-pagina");
  await expect(marcados).toHaveCount(3);
  await expect(marcados.first()).toContainText("Provável resto de página");
  expect(analysisBody).toMatchObject({ extraction: "palpite" });

  // "Manter" no "leia também" devolve o paragrafo ao texto salvo.
  await marcados.nth(1).getByRole("button", { name: "Manter" }).click();
  await expect(marcados.nth(1)).toContainText("Mantido no texto");

  const sugerida = page.getByTestId("etiqueta-sugerida");
  await expect(sugerida).toContainText("Política");
  await expect(sugerida).toContainText("Sugerida");

  const saved = page.waitForResponse(
    (response) => response.url().endsWith("/api/texts") && response.request().method() === "POST"
  );
  await page.getByRole("button", { name: "Salvar e ler" }).click();
  const { text } = (await (await saved).json()) as { text: { id: string } };

  const stored = await (await page.request.get(`/api/texts/${text.id}`)).json();
  expect(stored.text.content).toBe([PARAGRAFOS[1], PARAGRAFOS[2], PARAGRAFOS[3]].join("\n\n"));
  // A sugestao nao tocada nao entra.
  expect(stored.text.tags).toEqual([]);
});

test("extracao exata e conta sem etiquetas nao chamam a analise", async ({ page }) => {
  await registerByApi(page.request);
  await updateSettings(page.request, { aiEnabled: true });

  await page.route("**/api/import-url", (route) =>
    route.fulfill({
      json: {
        title: "Artigo exato",
        content: PARAGRAFOS.join("\n\n"),
        wordCount: 60,
        sourceUrl: "https://exemplo.com/exato",
        language: "pt-BR",
        extraction: "exata",
      },
    })
  );
  let called = false;
  await page.route("**/api/import-url/analise", (route) => {
    called = true;
    return route.fulfill({ json: { leftovers: [], suggestedTags: [] } });
  });

  await page.goto("/textos/novo");
  await page.getByRole("textbox", { name: "Endereço do artigo" }).fill("https://exemplo.com/exato");
  await page.getByRole("button", { name: "Importar" }).click();
  await expect(page.getByRole("heading", { name: "Conferir e salvar" })).toBeVisible({
    timeout: 15_000,
  });
  await page.waitForTimeout(500);

  expect(called).toBe(false);
  await expect(page.getByTestId("resto-de-pagina")).toHaveCount(0);
  await expect(page.getByTestId("etiqueta-sugerida")).toHaveCount(0);
});

test("sinopse: pedida no cartao, guardada e descartada quando o conteudo muda", async ({
  page,
}) => {
  await registerByApi(page.request);
  await updateSettings(page.request, { aiEnabled: true });
  const longo = await createText(page.request, "Texto longo", 400);
  await createText(page.request, "Texto curto", 120);

  await page.route(`**/api/texts/${longo.id}/sinopse`, (route) =>
    route.fulfill({ json: { synopsis: "Uma leitura sobre ritmo e atenção." } })
  );

  await page.goto("/textos");
  const cartaoLongo = page.locator("li").filter({ hasText: "Texto longo" });
  const cartaoCurto = page.locator("li").filter({ hasText: "Texto curto" });
  // Menos de 200 palavras: a opcao nao aparece.
  await expect(cartaoCurto.getByRole("button", { name: "Do que se trata?" })).toHaveCount(0);

  await cartaoLongo.getByRole("button", { name: "Do que se trata?" }).click();
  await expect(cartaoLongo.getByTestId("sinopse")).toContainText("ritmo e atenção");

  // Guardada no banco para o conteudo atual, ela vem com a lista.
  await page.unroute(`**/api/texts/${longo.id}/sinopse`);
  await runSql(
    `insert into ai_results (user_id, text_id, kind, key, payload)
     select user_id, id, 'sinopse', id::text || ':e2e',
            jsonb_build_object('synopsis', 'Sinopse guardada do texto.', 'fingerprint', md5(content))
       from texts where id = $1`,
    [longo.id]
  );
  await page.reload();
  await expect(cartaoLongo.getByTestId("sinopse")).toContainText("Sinopse guardada do texto.");

  // Conteudo editado: a sinopse antiga deixa de valer e a opcao volta.
  const editado = await page.request.put(`/api/texts/${longo.id}`, {
    data: { title: "Texto longo", content: sampleText(420) },
  });
  expect(editado.ok()).toBeTruthy();
  await page.reload();
  await expect(cartaoLongo.getByTestId("sinopse")).toHaveCount(0);
  await expect(cartaoLongo.getByRole("button", { name: "Do que se trata?" })).toBeVisible();
});
