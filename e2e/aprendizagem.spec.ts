import { expect, test, type APIRequestContext } from "@playwright/test";
import { randomIp, registerByApi, updateSettings } from "./helpers";
import { runSql } from "./db";

test.beforeEach(async ({ context, page }) => {
  await context.setExtraHTTPHeaders({ "x-forwarded-for": randomIp() });
  await page.emulateMedia({ reducedMotion: "reduce" });
});

/** Prosa com vocabulario variado: as lacunas precisam de alternativas de tamanho parecido. */
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

async function createText(request: APIRequestContext, title: string, content: string, extra = {}) {
  const response = await request.post("/api/texts", { data: { title, content, ...extra } });
  expect(response.ok()).toBeTruthy();
  return (await response.json()).text as { id: string; wordCount: number };
}

async function userId(request: APIRequestContext): Promise<string> {
  const me = await (await request.get("/api/auth/me")).json();
  return me.user.id as string;
}

/** Preferencia do guia do leitor, por conta. */
test("guia do leitor fica marcado na conta", async ({ page }) => {
  await registerByApi(page.request);
  const before = await (await page.request.get("/api/settings")).json();
  expect(before.settings.readerTipsSeen).toBe(false);
  await updateSettings(page.request, { readerTipsSeen: true });
  const after = await (await page.request.get("/api/settings")).json();
  expect(after.settings.readerTipsSeen).toBe(true);
});

/** PROD-10: modo e freios na sessao, sugestao de desacelerar e ppm por modo. */
test("sessao com modo e freios, sugestao e ritmo por modo", async ({ page }) => {
  await registerByApi(page.request);
  const text = await createText(page.request, "Sessoes", PROSE.repeat(4));

  const post = (data: Record<string, unknown>) =>
    page.request.post("/api/reading-sessions", {
      data: { textId: text.id, wordsRead: 150, durationMs: 30_000, ...data },
    });

  expect((await post({ mode: "rsvp" })).status()).toBe(400);
  expect((await post({ brakes: Array.from({ length: 201 }, () => 1) })).status()).toBe(400);

  const narrated = await (await post({ narrated: true, mode: "runner" })).json();
  expect(narrated.session.mode).toBe("narracao");
  expect(narrated.session.narrated).toBe(true);

  let suggestion = await (await page.request.get("/api/reading-sessions/sugestao")).json();
  expect(suggestion.suggestion).toBeNull();

  for (let i = 0; i < 3; i += 1) {
    const created = await (await post({ mode: "runner", brakes: [3, 20, 40] })).json();
    expect(created.session.brakes).toEqual([3, 20, 40]);
  }
  await post({ mode: "pagina" });

  suggestion = await (await page.request.get("/api/reading-sessions/sugestao")).json();
  expect(suggestion.suggestion.deltaWpm).toBe(-25);
  expect(suggestion.suggestedWpm).toBe(suggestion.baseWpm - 25);

  await page.goto("/estatisticas");
  const modes = page.getByTestId("ritmo-por-modo");
  await expect(modes).toContainText("Guiada");
  await expect(modes).toContainText("Narracao");
  await expect(modes).toContainText("Pagina");
});

/** PROD-3 e PROD-13: sem IA, as lacunas medem a compreensao e ela chega as estatisticas. */
test("lacunas substituem o questionario sem IA e alimentam a compreensao", async ({ page }) => {
  await registerByApi(page.request);
  const text = await createText(page.request, "Pescadora", PROSE.repeat(3));
  await page.request.patch(`/api/texts/${text.id}`, { data: { progressIndex: text.wordCount, at: new Date().toISOString() } });
  await page.request.post("/api/reading-sessions", {
    data: { textId: text.id, wordsRead: text.wordCount, durationMs: 60_000, completed: true },
  });

  // Sem chave neste ambiente: o questionario por IA fica indisponivel.
  const ai = await page.request.post(`/api/texts/${text.id}/questionario`);
  expect([422, 429, 503]).toContain(ai.status());

  const cloze = await (await page.request.post(`/api/texts/${text.id}/lacunas`)).json();
  expect(cloze.questions).toBeGreaterThanOrEqual(2);
  expect(cloze.quiz.questions[0].choices).toHaveLength(4);
  expect(cloze.quiz.questions[0].answer).toBeUndefined();

  const answered = await (
    await page.request.post(`/api/texts/${text.id}/lacunas/respostas`, {
      data: { answers: cloze.quiz.questions.map(() => 0), from: cloze.from, to: cloze.to },
    })
  ).json();
  const correct = answered.results.map((result: { answer: number }) => result.answer);
  const perfect = await (
    await page.request.post(`/api/texts/${text.id}/lacunas/respostas`, {
      data: { answers: correct, from: cloze.from, to: cloze.to },
    })
  ).json();
  expect(perfect.score).toBe(100);

  const sessions = await (await page.request.get("/api/reading-sessions")).json();
  expect(sessions.sessions[0].comprehension).toBe(100);

  await page.goto("/estatisticas");
  await expect(page.getByTestId("ritmo-eficaz")).toContainText("100% de acertos");
});

/** PROD-6 e PROD-7: guardar sem definicao e revisar com quatro respostas. */
test("palavra guardada sem definicao e revisao com quatro respostas", async ({ page }) => {
  await registerByApi(page.request);
  const text = await createText(page.request, "Palavras", PROSE);

  const lookup = await page.request.post("/api/dicionario", {
    data: { word: "remendada", context: "Carregava uma rede remendada", textId: text.id },
  });
  expect(lookup.ok()).toBe(false);
  expect((await lookup.json()).saved).toBe(false);

  const saved = await page.request.post("/api/palavras", {
    data: { word: "remendada", context: "Carregava uma rede remendada", textId: text.id },
  });
  expect(saved.status()).toBe(201);
  const again = await page.request.post("/api/dicionario", {
    data: { word: "remendada", context: "Carregava uma rede remendada", textId: text.id },
  });
  expect((await again.json()).saved).toBe(true);

  // Vence hoje: a revisao so mostra palavras vencidas.
  await runSql("update saved_words set next_review_on = current_date - 1 where user_id = $1", [
    await userId(page.request),
  ]);

  await page.goto("/palavras/revisar");
  await expect(page.getByText("remendada", { exact: true })).toBeVisible();
  await expect(page.getByText("Carregava uma rede remendada")).toBeVisible();
  await page.getByRole("button", { name: "Mostrar" }).click();
  await expect(page.getByText("sem definicao")).toBeVisible();
  await expect(page.getByRole("button", { name: /Errei/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Dificil/ })).toBeVisible();
  await page.getByRole("button", { name: /Facil, volta em 4 dias/ }).click();
  await expect(page.getByText("Revisao concluida")).toBeVisible();

  await page.goto("/palavras");
  await expect(page.getByTestId("retencao")).toHaveText("Retencao em 30 dias: 100% de 1 resposta");
  await page.getByRole("button", { name: "Escrever" }).click();
  await page.getByRole("textbox", { name: "Definicao de remendada" }).fill("Consertada com remendos.");
  await page.getByRole("button", { name: "Salvar" }).click();
  await expect(page.getByText("Consertada com remendos.")).toBeVisible();
});

/** PROD-4: destaque vencido aparece no painel e na revisao em lacuna. */
test("revisao espacada de destaques", async ({ page }) => {
  await registerByApi(page.request);
  const text = await createText(page.request, "Destaques", PROSE);
  const created = await (
    await page.request.post(`/api/texts/${text.id}/destaques`, { data: { start: 13, end: 26 } })
  ).json();
  await page.request.patch(`/api/texts/${text.id}/destaques/${created.id}`, {
    data: { note: "Coragem sem desespero" },
  });
  await runSql("update highlights set created_at = now() - interval '2 days' where id = $1", [
    created.id,
  ]);

  await page.goto("/dashboard");
  await page.getByTestId("cartao-revisar-destaques").click();
  await expect(page.getByRole("heading", { name: "Revisar destaques" })).toBeVisible();
  await expect(page.getByTestId("lacuna")).toHaveCount(1);
  await page.getByRole("button", { name: "Mostrar" }).click();
  await expect(page.getByTestId("lacuna")).toHaveCount(0);
  await expect(page.getByText("Coragem sem desespero")).toBeVisible();
  await page.getByRole("button", { name: /^Bom/ }).click();
  await expect(page.getByText("Revisao concluida")).toBeVisible();

  const review = await (await page.request.get("/api/destaques/revisao")).json();
  expect(review.due).toBe(0);
});

/** APP-16: busca no conteudo leva a palavra encontrada. */
test("busca no conteudo da biblioteca", async ({ page }) => {
  await registerByApi(page.request);
  const text = await createText(page.request, "Relato do mar", PROSE);
  await createText(page.request, "Outro texto", "Nada a ver com o assunto aqui.");

  await page.goto("/textos");
  await page.getByRole("searchbox", { name: "Buscar" }).fill("travessia");
  const results = page.getByTestId("busca-conteudo");
  await expect(results).toContainText("Relato do mar");
  // "travessia," e a 30a palavra (indice 29).
  await expect(results.getByRole("link")).toHaveAttribute("href", `/leitor/${text.id}?de=29`);
  await expect(results.locator("mark")).toHaveText("travessia");
});

/** PROD-17: lote de links com falha por item e resumo. */
test("importacao de links em lote mostra previa e resumo", async ({ page }) => {
  await registerByApi(page.request);
  await page.goto("/textos/novo");
  await page.getByRole("radio", { name: "Lote" }).click();
  const csv = "URL,Title\nhttps://exemplo.invalid/a,Artigo A\nhttps://exemplo.invalid/b,Artigo B\n";
  await page.getByLabel("Arquivo com links").setInputFiles({
    name: "instapaper-export.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv),
  });
  const list = page.getByTestId("lote-lista");
  await expect(list.getByRole("listitem")).toHaveCount(2);
  await expect(list).toContainText("Artigo A");
  await page.getByRole("button", { name: "Importar todos" }).click();
  await expect(page.getByTestId("lote-resumo")).toHaveText("0 importados, 2 com falha.", {
    timeout: 30_000,
  });
  await expect(page.getByRole("button", { name: "Tentar as que falharam" })).toBeVisible();
});

/** PROD-12: recapitulacao do capitulo anterior no carregamento do leitor. */
test("capitulo seguinte traz a recapitulacao do anterior depois de 48h", async ({ page }) => {
  await registerByApi(page.request);
  const series = { title: "A travessia" };
  const first = await createText(page.request, "Capitulo 1", PROSE, {
    series: { ...series, chapter: 1 },
  });
  const second = await createText(page.request, "Capitulo 2", "Outro dia comecou no porto.", {
    series: { ...series, chapter: 2 },
  });
  await page.request.patch(`/api/texts/${first.id}`, { data: { progressIndex: first.wordCount, at: new Date().toISOString() } });
  await page.request.post(`/api/texts/${first.id}/destaques`, { data: { start: 0, end: 4 } });
  await page.request.post("/api/reading-sessions", {
    data: { textId: first.id, wordsRead: first.wordCount, durationMs: 60_000, completed: true },
  });

  // Concluido agora: ainda lembra, sem recapitulacao.
  let html = await (await page.request.get(`/leitor/${second.id}`)).text();
  expect(html).not.toContain("previousChapter");

  await runSql(
    "update reading_sessions set created_at = now() - interval '3 days' where text_id = $1",
    [first.id]
  );
  html = await (await page.request.get(`/leitor/${second.id}`)).text();
  expect(html).toContain("previousChapter");
  expect(html).toContain("A pescadora saiu cedo");
});
