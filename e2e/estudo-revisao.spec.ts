import { expect, test, type APIRequestContext } from "@playwright/test";
import { Client } from "pg";
import { createText, randomIp, registerByApi } from "./helpers";
import { runSql } from "./db";
import { quizKey } from "../src/lib/quiz";

/**
 * Revisao dos cartoes de estudo (US-156), analogia (US-168), retencao
 * (US-162), revisao do dia (US-161), questionario refeito (US-169) e o
 * lembrete de revisao (US-163).
 *
 * Os cartoes entram por SQL: a criacao deles e outra entrega. A IA e
 * simulada com `page.route`.
 */

// Sem o service worker no meio: `page.route` precisa ver os pedidos.
test.use({ serviceWorkers: "block" });

test.beforeEach(async ({ context, page }) => {
  await context.setExtraHTTPHeaders({ "x-forwarded-for": randomIp() });
  await page.emulateMedia({ reducedMotion: "reduce" });
});

async function query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return (await client.query(sql, params)).rows as T[];
  } finally {
    await client.end();
  }
}

async function userId(request: APIRequestContext): Promise<string> {
  const me = await (await request.get("/api/auth/me")).json();
  return me.user.id as string;
}

interface CardSeed {
  front: string;
  back: string;
  start: number;
  end: number;
  next?: string | null;
  interval?: number;
  pretest?: string | null;
}

/** Cartoes direto no banco; devolve os ids na mesma ordem. */
async function seedCards(user: string, textId: string, cards: CardSeed[]): Promise<string[]> {
  const ids: string[] = [];
  for (const card of cards) {
    const [row] = await query<{ id: string }>(
      `insert into study_cards (user_id, text_id, front, back, kind, source_start, source_end, next_review_on, review_interval, pretest)
       values ($1, $2, $3, $4, 'conceito', $5, $6, ${card.next ?? "null"}, $7, $8) returning id`,
      [user, textId, card.front, card.back, card.start, card.end, card.interval ?? 0, card.pretest ?? null]
    );
    ids.push(row!.id);
  }
  return ids;
}

async function readUpTo(textId: string, index: number) {
  await runSql("update texts set progress_index = $2 where id = $1", [textId, index]);
}

test("revisar os cartoes de um texto, com analogia depois de errar", async ({ page }) => {
  await registerByApi(page.request);
  const user = await userId(page.request);
  const text = await createText(page.request, "Estudo de cartoes", 400);
  await readUpTo(text.id, 200);
  const [lido, , naoLido] = await seedCards(user, text.id, [
    { front: "Frente lida", back: "Verso lido", start: 10, end: 20 },
    { front: "Frente futura", back: "Verso futuro", start: 30, end: 40, next: "current_date + 5" },
    // Data vencida, mas o trecho ainda nao foi lido: nunca aparece.
    { front: "Frente nao lida", back: "Verso nao lido", start: 300, end: 320, next: "'2020-01-01'" },
  ]);

  // Cartao de trecho nao lido nao e revisado.
  const refused = await page.request.post(`/api/cartoes/${naoLido}/revisao`, { data: { grade: "bom" } });
  expect(refused.status()).toBe(409);

  await page.route("**/api/cartoes/*/analogia", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    await route.fulfill({ json: { analogy: "Como uma usina que transforma sol em energia." } });
  });

  await page.goto(`/textos/${text.id}/estudar`);
  await expect(page.getByTestId("retencao")).toContainText("Poucas revisões para medir.");
  await page.getByRole("link", { name: "Revisar cartões (1)" }).click();

  await expect(page.getByRole("heading", { name: "Revisar cartões" })).toBeVisible();
  await expect(page.getByTestId("cartao-frente")).toHaveText("Frente lida");
  await expect(page.getByText("Frente nao lida")).toHaveCount(0);
  await expect(page.getByTestId("cartao-verso")).toHaveCount(0);

  await page.getByRole("button", { name: "Mostrar resposta" }).click();
  await expect(page.getByTestId("cartao-verso")).toHaveText("Verso lido");
  await expect(page.getByRole("link", { name: "Ver no texto" })).toHaveAttribute(
    "href",
    `/leitor/${text.id}?de=10`
  );

  await page.getByRole("button", { name: /^Errei/ }).click();
  await expect(page.getByText("O cartão volta amanhã.")).toBeVisible();
  await page.getByRole("button", { name: "Explicar de outro jeito" }).click();
  await expect(page.getByTestId("analogia-nova")).toContainText("usina");
  await page.getByRole("button", { name: "Guardar no cartão" }).click();
  // A primeira chamada compila a rota no servidor de desenvolvimento.
  await expect(page.getByText("Analogia guardada no cartão.")).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Continuar" }).click();

  await expect(page.getByRole("heading", { name: "Revisão concluída" })).toBeVisible();

  const [card] = await query<{ analogy: string; next: string; interval: number }>(
    "select analogy, to_char(next_review_on, 'YYYY-MM-DD') as next, review_interval as interval from study_cards where id = $1",
    [lido]
  );
  expect(card!.analogy).toBe("Como uma usina que transforma sol em energia.");
  expect(card!.interval).toBe(1);
  const answers = await query<{ grade: string }>(
    "select grade from review_answers where user_id = $1 and kind = 'cartao'",
    [user]
  );
  expect(answers.map((answer) => answer.grade)).toEqual(["errei"]);

  // Sem cartao vencido: a data da proxima revisao.
  await page.reload();
  await expect(page.getByRole("heading", { name: "Nenhum cartão para hoje." })).toBeVisible();
  await expect(page.getByText(/A próxima revisão é em/)).toBeVisible();

  // A analogia guardada aparece no verso quando o cartao volta.
  await runSql("update study_cards set next_review_on = current_date where id = $1", [lido]);
  await page.reload();
  await page.getByRole("button", { name: "Mostrar resposta" }).click();
  await expect(page.getByTestId("cartao-analogia")).toContainText("usina");
});

test("cota de estudo esgotada nao interrompe a revisao", async ({ page }) => {
  await registerByApi(page.request);
  const user = await userId(page.request);
  const text = await createText(page.request, "Cota", 300);
  await readUpTo(text.id, 299);
  await seedCards(user, text.id, [
    { front: "Primeira", back: "Um", start: 0, end: 5 },
    { front: "Segunda", back: "Dois", start: 5, end: 10 },
  ]);

  await page.route("**/api/cartoes/*/analogia", (route) =>
    route.fulfill({
      status: 429,
      json: { error: "Limite diário de recursos de estudo atingido. Volta a valer amanhã." },
    })
  );

  await page.goto(`/textos/${text.id}/estudar/revisar`);
  await page.getByRole("button", { name: "Mostrar resposta" }).click();
  await page.getByRole("button", { name: /^Errei/ }).click();
  await page.getByRole("button", { name: "Explicar de outro jeito" }).click();
  await expect(page.getByText("Limite diário de recursos de estudo atingido.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Continuar" }).click();

  await expect(page.getByTestId("cartao-frente")).toHaveText("Segunda");
  await page.getByRole("button", { name: "Mostrar resposta" }).click();
  await page.getByRole("button", { name: /^Bom/ }).click();
  await expect(page.getByRole("heading", { name: "Revisão concluída" })).toBeVisible();
});

test("retencao do texto, conhecimento previo e lista para reler", async ({ page }) => {
  await registerByApi(page.request);
  const user = await userId(page.request);
  const good = await createText(page.request, "Texto bem lembrado", 300);
  const bad = await createText(page.request, "Texto esquecido", 300);
  // Os cartoes do teste previo sao de trechos ainda nao lidos.
  await readUpTo(good.id, 100);
  await readUpTo(bad.id, 299);

  const goodCards = await seedCards(user, good.id, [
    { front: "A", back: "a", start: 0, end: 5, next: "current_date + 30", interval: 25 },
    { front: "B", back: "b", start: 5, end: 10, next: "current_date + 3", interval: 3 },
    { front: "C", back: "c", start: 200, end: 210, pretest: "sabia" },
    { front: "D", back: "d", start: 210, end: 220, pretest: "nao_sabia" },
  ]);
  const [badCard] = await seedCards(user, bad.id, [
    { front: "E", back: "e", start: 0, end: 5, next: "current_date + 1", interval: 1 },
  ]);

  const answer = (item: string, grade: string) =>
    runSql("insert into review_answers (user_id, kind, item_id, grade) values ($1, 'cartao', $2, $3)", [
      user,
      item,
      grade,
    ]);
  for (let index = 0; index < 10; index += 1) {
    await answer(goodCards[index % 2]!, index < 7 ? "bom" : "errei");
    await answer(badCard!, index < 4 ? "dificil" : "errei");
  }
  // Fora da janela de 30 dias: nao conta.
  await runSql(
    "insert into review_answers (user_id, kind, item_id, grade, created_at) values ($1, 'cartao', $2, 'errei', now() - interval '40 days')",
    [user, goodCards[0]]
  );

  await page.goto(`/textos/${good.id}/estudar`);
  const panel = page.getByTestId("retencao");
  await expect(panel).toContainText("70%");
  await expect(panel).toContainText("1");
  await expect(panel).toContainText("cartão maduro");
  await expect(page.getByTestId("conhecimento-previo")).toContainText("Conhecimento prévio: 50%");
  await expect(page.getByRole("link", { name: "Revisar cartões (0)" })).toBeVisible();

  await page.goto("/voce");
  const reread = page.getByTestId("para-reler");
  await expect(reread).toContainText("Texto esquecido");
  await expect(reread).toContainText("40%");
  await expect(reread).not.toContainText("Texto bem lembrado");
});

test("revisao do dia intercala palavras, destaques e cartoes e continua de onde parou", async ({
  page,
}) => {
  await registerByApi(page.request);
  const user = await userId(page.request);
  const text = await createText(page.request, "Revisao unificada", 300);
  await readUpTo(text.id, 299);

  const saved = await page.request.post("/api/palavras", {
    data: { word: "ritmo", context: "ao ritmo das frases", textId: text.id },
  });
  expect(saved.status()).toBe(201);
  await runSql("update saved_words set next_review_on = current_date - 3 where user_id = $1", [user]);

  const highlight = await (
    await page.request.post(`/api/texts/${text.id}/destaques`, { data: { start: 13, end: 26 } })
  ).json();
  await runSql("update highlights set review_due_on = current_date - 2 where id = $1", [highlight.id]);

  await seedCards(user, text.id, [
    { front: "Cartao do dia", back: "Resposta do dia", start: 0, end: 5, next: "current_date - 1" },
    // Trecho lido so ate a posicao: este fica fora.
    { front: "Cartao futuro", back: "x", start: 0, end: 5, next: "current_date + 4" },
  ]);

  await page.goto("/dashboard");
  await expect(page.getByTestId("cartao-revisao-do-dia")).toContainText("Revisão do dia: 3 itens");
  await page.getByTestId("cartao-revisao-do-dia").click();

  await expect(page.getByRole("heading", { name: "Revisão do dia" })).toBeVisible();
  await expect(page.getByTestId("contagem-revisao")).toHaveText("1 palavra · 1 destaque · 1 cartão");
  await expect(page.getByText("1 de 3")).toBeVisible();

  // O mais atrasado primeiro: a palavra, vencida ha 3 dias.
  const item = page.getByTestId("item-revisao");
  await expect(item).toHaveAttribute("data-kind", "palavra");
  await page.getByRole("button", { name: "Mostrar resposta" }).click();
  await page.getByRole("button", { name: /^Errei/ }).click();
  await expect(page.getByText("2 de 3")).toBeVisible();

  // Interrompe e volta: continua do proximo item.
  await page.reload();
  await expect(page.getByText("1 de 2")).toBeVisible();
  await expect(item).toHaveAttribute("data-kind", "destaque");
  await page.getByRole("button", { name: "Mostrar resposta" }).click();
  await page.getByRole("button", { name: /^Bom/ }).click();

  await expect(item).toHaveAttribute("data-kind", "cartao");
  await page.getByRole("button", { name: "Mostrar resposta" }).click();
  await page.getByRole("button", { name: /^Fácil/ }).click();
  await expect(page.getByRole("heading", { name: "Revisão concluída" })).toBeVisible();

  // As notas foram para as rotas de sempre.
  const kinds = await query<{ kind: string }>(
    "select kind from review_answers where user_id = $1 order by created_at",
    [user]
  );
  expect(kinds.map((row) => row.kind)).toEqual(["palavra", "destaque", "cartao"]);

  await page.reload();
  await expect(page.getByRole("heading", { name: "Revisão em dia." })).toBeVisible();
  // A palavra errada volta amanha.
  await expect(page.getByText("Amanhã vencem 1 item.")).toBeVisible();

  await page.goto("/dashboard");
  await expect(page.getByTestId("cartao-revisao-do-dia")).toHaveCount(0);
  // A revisao separada de palavras continua existindo.
  await page.goto("/palavras/revisar");
  await expect(page.getByRole("heading", { name: "Revisar palavras" })).toBeVisible();
});

test("questionario volta aos 7 e aos 30 dias, so com questionario guardado", async ({ page }) => {
  await registerByApi(page.request);
  const user = await userId(page.request);
  const text = await createText(page.request, "Texto concluido", 300);
  const plain = await createText(page.request, "Sem questionario", 300);
  const detail = (await (await page.request.get(`/api/texts/${text.id}`)).json()).text as {
    content: string;
    language: string;
  };

  const quiz = {
    questions: [
      { prompt: "Pergunta um", choices: ["alfa", "beta", "gama", "delta"], answer: 0, evidence: "" },
      { prompt: "Pergunta dois", choices: ["um", "dois", "tres", "quatro"], answer: 2, evidence: "" },
      { prompt: "Pergunta tres", choices: ["sol", "lua", "mar", "rio"], answer: 3, evidence: "" },
    ],
  };
  await runSql(
    "insert into comprehension_quizzes (text_id, content_key, questions) values ($1, $2, $3)",
    [text.id, quizKey(detail.content, detail.language), JSON.stringify(quiz)]
  );
  const conclude = (id: string, daysAgo: number) =>
    runSql(
      `insert into reading_sessions (user_id, text_id, wpm, words_read, duration_ms, completed, comprehension, created_at)
       values ($1, $2, 300, 300, 60000, true, 67, now() - interval '${daysAgo} days')`,
      [user, id]
    );
  await conclude(text.id, 8);
  // Concluido, mas sem questionario guardado: nunca volta.
  await conclude(plain.id, 8);

  // Media de compreensao do treino antes de refazer.
  const before = await (await page.request.get("/api/stats")).text();

  await page.goto("/revisar");
  await expect(page.getByTestId("contagem-revisao")).toHaveText("1 questionário");
  await expect(page.getByText("Recordar: Texto concluido")).toBeVisible();
  await expect(page.getByText("Recordar: Sem questionario")).toHaveCount(0);

  // As alternativas voltam em outra ordem, sem gabarito.
  const opened = await (await page.request.get(`/api/texts/${text.id}/recordar`)).json();
  expect(opened.round).toBe(7);
  expect(opened.questions[0].answer).toBeUndefined();
  const reordered = opened.questions.some(
    (question: { choices: string[] }, index: number) =>
      question.choices.join() !== quiz.questions[index]!.choices.join()
  );
  expect(reordered).toBe(true);

  await page.getByRole("button", { name: "Começar" }).click();
  // Acerta as duas primeiras, erra a terceira.
  const correct = ["alfa", "tres"];
  for (const choice of correct) await page.getByRole("button", { name: choice, exact: true }).click();
  const third = opened.questions[2].choices.find((choice: string) => choice !== "rio");
  await page.getByRole("button", { name: third, exact: true }).click();
  await page.getByRole("button", { name: "Corrigir" }).click();
  await expect(page.getByTestId("nota-recordar")).toContainText("Agora: 67%");
  await expect(page.getByTestId("nota-recordar")).toContainText("na conclusão: 67%");
  await page.getByRole("button", { name: "Continuar" }).click();

  const recalls = await query<{ round: number; score: number }>(
    "select round, score from quiz_recalls where user_id = $1",
    [user]
  );
  expect(recalls).toEqual([{ round: 7, score: 67 }]);

  // Fora das sessoes: a compreensao do treino nao muda.
  expect(await (await page.request.get("/api/stats")).text()).toBe(before);

  // A nota aparece ao lado da original no historico do texto.
  await page.goto(`/textos/${text.id}/leituras`);
  const notes = page.getByTestId("notas-questionario");
  await expect(notes).toContainText("Na conclusão");
  await expect(notes).toContainText("7 dias depois");
  await expect(notes).toContainText("67%");

  // Feita a de 7, nada ate os 30 dias; aos 30 volta uma ultima vez.
  await page.goto("/revisar");
  await expect(page.getByRole("heading", { name: "Revisão em dia." })).toBeVisible();
  await runSql(
    "update reading_sessions set created_at = now() - interval '31 days' where text_id = $1",
    [text.id]
  );
  const last = await (await page.request.get(`/api/texts/${text.id}/recordar`)).json();
  expect(last.round).toBe(30);
  const done = await page.request.post(`/api/texts/${text.id}/recordar`, {
    data: { answers: [0, 0, 0] },
  });
  expect(done.ok()).toBe(true);
  expect((await page.request.get(`/api/texts/${text.id}/recordar`)).status()).toBe(404);
});

test("lembrete de revisao fica na conta", async ({ page }) => {
  await registerByApi(page.request);
  const user = await userId(page.request);

  // Sem chaves de push no ambiente de teste: o estado do lembrete diario e
  // simulado, e o PATCH real grava a preferencia.
  await page.route("**/api/lembretes", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await route.fulfill({
      json: { hour: 19, reviewReminder: false, devices: 1, publicKey: null, available: true },
    });
  });

  await page.goto("/ajustes");
  const toggle = page.getByTestId("lembrete-revisao");
  await toggle.scrollIntoViewIfNeeded();
  await toggle.getByRole("radio", { name: "Ligado", exact: true }).click();
  await expect(toggle.getByRole("radio", { name: "Ligado", exact: true })).toHaveAttribute("aria-checked", "true");

  await expect
    .poll(async () => {
      const [row] = await query<{ review_reminder: boolean }>(
        "select review_reminder from speed_settings where user_id = $1",
        [user]
      );
      return row?.review_reminder;
    }, { timeout: 20_000 })
    .toBe(true);

  await page.unroute("**/api/lembretes");
  const status = await (await page.request.get("/api/lembretes")).json();
  expect(status.reviewReminder).toBe(true);
  expect((await page.request.patch("/api/lembretes", { data: { reviewReminder: "sim" } })).status()).toBe(400);
});
