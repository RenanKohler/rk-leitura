import { expect, test } from "@playwright/test";
import { runSql } from "./db";
import { createText, openReader, randomIp, registerByApi, sampleText, updateSettings } from "./helpers";

/**
 * Titulo e autor na importacao (US-152), secoes de documento longo (US-153)
 * e ideias da semana (US-154). O modelo nao roda aqui: as respostas dele sao
 * simuladas na rede, e o teste confere o que a tela faz com elas e o que
 * chega ao banco.
 */

// Com o service worker no ar, o pedido sai por ele e escapa do `page.route`.
test.use({ serviceWorkers: "block" });

test.beforeEach(async ({ context }) => {
  await context.setExtraHTTPHeaders({ "x-forwarded-for": randomIp() });
});

const CONTEUDO = [
  "Por Ana Souza",
  "O primeiro parágrafo do artigo fala do assunto principal com calma e detalhe suficiente.",
  "O segundo parágrafo continua o raciocínio e fecha o argumento da autora.",
].join("\n\n");

test("pagina sem titulo: titulo e autor sugeridos, o que digito vale", async ({ page }) => {
  await registerByApi(page.request);
  await updateSettings(page.request, { aiEnabled: true });

  await page.route("**/api/import-url", (route) =>
    route.fulfill({
      json: {
        title: "Sem título",
        content: CONTEUDO,
        wordCount: 30,
        sourceUrl: "https://exemplo.com/sem-titulo",
        language: "pt-BR",
        extraction: "exata",
        author: null,
      },
    })
  );
  let analysisBody: Record<string, unknown> | null = null;
  await page.route("**/api/import-url/analise", (route) => {
    analysisBody = route.request().postDataJSON();
    return route.fulfill({
      json: {
        leftovers: [],
        suggestedTags: [],
        suggestedTitle: "O assunto principal com calma",
        suggestedAuthor: "Ana Souza",
      },
    });
  });

  await page.goto("/textos/novo");
  await page.getByRole("textbox", { name: "Endereço do artigo" }).fill("https://exemplo.com/sem-titulo");
  await page.getByRole("button", { name: "Importar" }).click();

  const titulo = page.getByRole("textbox", { name: "Título" });
  const autor = page.getByRole("textbox", { name: "Autor" });
  await expect(titulo).toHaveValue("O assunto principal com calma");
  await expect(page.getByTestId("sugerido-title")).toHaveText("Sugerido");
  await expect(autor).toHaveValue("Ana Souza");
  await expect(page.getByTestId("sugerido-author")).toBeVisible();
  expect(analysisBody).toMatchObject({ meta: true, extraction: "exata" });

  // Editar a sugestao: vale o que foi digitado, e a marca sai.
  await autor.fill("Ana C. Souza");
  await expect(page.getByTestId("sugerido-author")).toHaveCount(0);

  const saved = page.waitForResponse(
    (response) => response.url().endsWith("/api/texts") && response.request().method() === "POST"
  );
  await page.getByRole("button", { name: "Salvar e ler" }).click();
  const { text } = (await (await saved).json()) as { text: { id: string } };

  const stored = await (await page.request.get(`/api/texts/${text.id}`)).json();
  expect(stored.text.title).toBe("O assunto principal com calma");
  expect(stored.text.author).toBe("Ana C. Souza");

  // O autor aparece no cartao da biblioteca.
  await page.goto("/textos");
  const cartao = page.locator("li").filter({ hasText: "O assunto principal com calma" });
  await expect(cartao.getByTestId("autor")).toHaveText("Ana C. Souza");
});

test("analise que falha deixa titulo e autor como hoje", async ({ page }) => {
  await registerByApi(page.request);
  await updateSettings(page.request, { aiEnabled: true });

  await page.route("**/api/import-url", (route) =>
    route.fulfill({
      json: {
        title: "Sem título",
        content: CONTEUDO,
        wordCount: 30,
        sourceUrl: "https://exemplo.com/falha",
        language: "pt-BR",
        extraction: "exata",
      },
    })
  );
  await page.route("**/api/import-url/analise", (route) =>
    route.fulfill({ status: 500, json: { error: "falhou" } })
  );

  await page.goto("/textos/novo");
  await page.getByRole("textbox", { name: "Endereço do artigo" }).fill("https://exemplo.com/falha");
  await page.getByRole("button", { name: "Importar" }).click();

  await expect(page.getByRole("textbox", { name: "Título" })).toHaveValue("Sem título");
  await page.waitForTimeout(500);
  await expect(page.getByRole("textbox", { name: "Autor" })).toHaveValue("");
  await expect(page.getByTestId("sugerido-title")).toHaveCount(0);
});

test("arquivo sem titulo: so o comeco vai para a sugestao", async ({ page }) => {
  await registerByApi(page.request);
  await updateSettings(page.request, { aiEnabled: true });

  let analysisBody: Record<string, unknown> | null = null;
  await page.route("**/api/import-url/analise", (route) => {
    analysisBody = route.request().postDataJSON();
    return route.fulfill({
      json: { suggestedTitle: "Notas sobre leitura lenta", suggestedAuthor: null },
    });
  });

  await page.goto("/textos/novo");
  await page.getByRole("radio", { name: "Arquivo" }).click();
  await page.locator("input[type=file]").setInputFiles({
    name: "documento_final_v2.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(sampleText(1_200)),
  });

  const titulo = page.getByRole("textbox", { name: "Título" });
  await expect(titulo).toHaveValue("Notas sobre leitura lenta");
  await expect(page.getByTestId("sugerido-titulo-arquivo")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Autor" })).toHaveValue("");
  expect(analysisBody).toMatchObject({ meta: true, tags: false });
  expect(String(analysisBody!.content).length).toBeLessThanOrEqual(2_000);
});

test("secoes: sugerir, revisar, aplicar e navegar sem mudar o conteudo", async ({ page }) => {
  await registerByApi(page.request);
  await updateSettings(page.request, { aiEnabled: true });
  // Paragrafos de 60 palavras: o paragrafo n comeca na palavra 60n.
  const text = await createText(page.request, "Documento longo", 5_400);
  const before = (await (await page.request.get(`/api/texts/${text.id}`)).json()).text;

  let suggested = 0;
  await page.route(`**/api/texts/${text.id}/secoes`, (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    suggested += 1;
    return route.fulfill({
      json: {
        suggestions: [
          { index: 0, title: "Abertura" },
          { index: 1_800, title: "O ritmo das frases" },
          { index: 3_600, title: "Parte a remover" },
          { index: 4_800, title: "Fechamento" },
        ],
      },
    });
  });

  await openReader(page, text.id);
  await page.getByRole("button", { name: "Navegar no texto" }).click();
  await page.getByRole("button", { name: "Sugerir seções" }).click();

  const revisao = page.getByTestId("revisao-secoes");
  await expect(revisao.getByRole("textbox")).toHaveCount(4);
  await revisao.getByRole("textbox", { name: "Título da seção 2" }).fill("Atenção ao sentido");
  await revisao.getByRole("button", { name: "Remover seção Parte a remover" }).click();
  await expect(revisao.getByRole("textbox")).toHaveCount(3);
  await revisao.getByRole("button", { name: "Aplicar seções" }).click();
  await expect(revisao).toHaveCount(0);

  const sumario = page.getByRole("region", { name: "Sumário" });
  await expect(sumario.getByRole("button", { name: "Atenção ao sentido", exact: true })).toBeVisible();
  await expect(sumario.getByRole("button", { name: "Fechamento", exact: true })).toBeVisible();
  await expect(sumario.getByRole("button", { name: "Parte a remover", exact: true })).toHaveCount(0);
  expect(suggested).toBe(1);

  // O conteudo e a contagem nao mudam; as secoes ficam ao lado.
  const after = (await (await page.request.get(`/api/texts/${text.id}`)).json()).text;
  expect(after.content).toBe(before.content);
  expect(after.wordCount).toBe(before.wordCount);
  const secoes = await (await page.request.get(`/api/texts/${text.id}/secoes`)).json();
  expect(secoes.sections).toEqual([
    { index: 0, title: "Abertura" },
    { index: 1_800, title: "Atenção ao sentido" },
    { index: 4_800, title: "Fechamento" },
  ]);

  // Ir pela secao leva a posicao dela.
  await sumario.getByRole("button", { name: "Fechamento", exact: true }).click();
  await page.getByRole("button", { name: "Navegar no texto" }).click();
  await expect(
    page.getByRole("region", { name: "Sumário" }).getByRole("button", { name: "Fechamento", exact: true })
  ).toHaveAttribute("aria-current", "location");

  // Reescrever o conteudo tira as secoes, que apontavam para o antigo.
  const editado = await page.request.put(`/api/texts/${text.id}`, {
    data: { title: "Documento longo", content: sampleText(5_460) },
  });
  expect(editado.ok()).toBeTruthy();
  const depois = await (await page.request.get(`/api/texts/${text.id}/secoes`)).json();
  expect(depois.sections).toEqual([]);
});

test("secoes: texto com titulos ou curto nao oferece a opcao", async ({ page }) => {
  await registerByApi(page.request);
  await updateSettings(page.request, { aiEnabled: true });
  const comTitulos = await page.request.post("/api/texts", {
    data: {
      title: "Com títulos",
      format: "markdown",
      content: `# Primeira parte\n\n${sampleText(3_000)}\n\n# Segunda parte\n\n${sampleText(3_000)}`,
    },
  });
  const { text } = (await comTitulos.json()) as { text: { id: string } };

  await openReader(page, text.id);
  await page.getByRole("button", { name: "Navegar no texto" }).click();
  const sumario = page.getByRole("region", { name: "Sumário" });
  await expect(sumario.getByRole("button", { name: "Segunda parte", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sugerir seções" })).toHaveCount(0);

  const curto = await createText(page.request, "Curto", 600);
  await openReader(page, curto.id);
  await page.getByRole("button", { name: "Navegar no texto" }).click();
  await expect(page.getByRole("button", { name: "Sugerir seções" })).toHaveCount(0);
  const recusa = await page.request.post(`/api/texts/${text.id}/secoes`);
  expect(recusa.status()).toBe(409);
});

/** Duas leituras na semana passada, para o cartao do resumo aparecer. */
async function readLastWeek(ids: string[]) {
  await runSql(
    `insert into reading_sessions (user_id, text_id, wpm, words_read, duration_ms, created_at)
     select user_id, id, 300, 600, 120000, now() - interval '7 days' from texts where id = any($1::uuid[])`,
    [ids]
  );
}

test("ideias da semana: botao, paragrafo e guardado sem nova chamada", async ({ page }) => {
  await registerByApi(page.request);
  await updateSettings(page.request, { aiEnabled: true });
  const a = await createText(page.request, "Primeiro texto", 300);
  const b = await createText(page.request, "Segundo texto", 300);
  await readLastWeek([a.id, b.id]);

  let state = { available: true, ideas: null as string | null };
  let generated = 0;
  await page.route("**/api/resumo-semanal/ideias", (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: state });
    generated += 1;
    return route.fulfill({
      json: { ideas: "Em \"Primeiro texto\" e \"Segundo texto\", o ritmo pede atenção." },
    });
  });

  await page.goto("/dashboard");
  await expect(page.getByText("Semana passada")).toBeVisible();
  await page.getByRole("button", { name: "Ver as ideias da semana" }).click();
  await expect(page.getByTestId("ideias-semana")).toContainText('"Primeiro texto"');
  expect(generated).toBe(1);

  // Reaberto na mesma semana: o paragrafo guardado aparece sem gerar outro.
  state = { available: true, ideas: "Parágrafo guardado da semana." };
  await page.reload();
  await page.getByRole("button", { name: "Ver as ideias da semana" }).click();
  await expect(page.getByTestId("ideias-semana")).toContainText("Parágrafo guardado da semana.");
  expect(generated).toBe(1);
});

test("ideias da semana: sem IA configurada o cartao fica so com os numeros", async ({ page }) => {
  await registerByApi(page.request);
  await updateSettings(page.request, { aiEnabled: true });
  const a = await createText(page.request, "Um", 300);
  const b = await createText(page.request, "Dois", 300);
  await readLastWeek([a.id, b.id]);

  const state = await (await page.request.get("/api/resumo-semanal/ideias")).json();
  // Sem chave no ambiente de teste, a rota real nao oferece o botao.
  if (!process.env.ANTHROPIC_API_KEY) expect(state).toEqual({ available: false, ideas: null });

  await page.goto("/dashboard");
  await expect(page.getByText("Semana passada")).toBeVisible();
  await page.waitForTimeout(500);
  if (!process.env.ANTHROPIC_API_KEY) {
    await expect(page.getByRole("button", { name: "Ver as ideias da semana" })).toHaveCount(0);
  }
});
