import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { createText, randomIp, registerByApi } from "./helpers";
import { querySql, runSql } from "./db";
import { quizKey } from "../src/lib/quiz";

/**
 * Pular e tirar itens da Revisao do dia (US-223).
 *
 * "Pular" passa adiante sem nota e o item continua vencido; "Tirar da
 * revisão" persiste, com confirmacao, e quer dizer uma coisa em cada tipo:
 * palavra aprendida, destaque fora da revisao, cartao excluido, questionario
 * dispensado. Os itens vencidos entram por SQL, como em `estudo-revisao`.
 */

// Sem o service worker no meio: o PATCH do destaque entra na fila offline dele,
// e aqui a resposta precisa ser a do servidor.
test.use({ serviceWorkers: "block" });

test.beforeEach(async ({ context, page }) => {
  await context.setExtraHTTPHeaders({ "x-forwarded-for": randomIp() });
  await page.emulateMedia({ reducedMotion: "reduce" });
});

async function userId(request: APIRequestContext): Promise<string> {
  const me = await (await request.get("/api/auth/me")).json();
  return me.user.id as string;
}

async function readUpTo(textId: string, index: number) {
  await runSql("update texts set progress_index = $2 where id = $1", [textId, index]);
}

/** Palavra salva e ja vencida ha `daysAgo` dias. */
async function dueWord(page: Page, user: string, textId: string, daysAgo: number) {
  const saved = await page.request.post("/api/palavras", {
    data: { word: "ritmo", context: "ao ritmo das frases", textId },
  });
  expect(saved.status()).toBe(201);
  await runSql(`update saved_words set next_review_on = current_date - ${daysAgo} where user_id = $1`, [user]);
}

/** Destaque ja vencido ha `daysAgo` dias; devolve o id. */
async function dueHighlight(page: Page, textId: string, daysAgo: number): Promise<string> {
  const highlight = await (
    await page.request.post(`/api/texts/${textId}/destaques`, { data: { start: 13, end: 26 } })
  ).json();
  await runSql(`update highlights set review_due_on = current_date - ${daysAgo} where id = $1`, [
    highlight.id,
  ]);
  return highlight.id as string;
}

/** Cartao de estudo vencido, de trecho ja lido; devolve o id. */
async function dueCard(user: string, textId: string, front: string, daysAgo: number): Promise<string> {
  const [row] = await querySql<{ id: string }>(
    `insert into study_cards (user_id, text_id, front, back, kind, source_start, source_end, next_review_on, review_interval)
     values ($1, $2, $3, 'Verso', 'conceito', 0, 5, current_date - ${daysAgo}, 0) returning id`,
    [user, textId, front]
  );
  return row!.id;
}

const item = (page: Page) => page.getByTestId("item-revisao");
const summary = (page: Page) => page.getByTestId("resumo-revisao");
const skip = (page: Page) => page.getByRole("button", { name: "Pular", exact: true });
const takeOut = (page: Page) => page.getByRole("button", { name: "Tirar da revisão", exact: true });

test("pular avanca sem nota e o item continua na fila depois de recarregar", async ({ page }) => {
  await registerByApi(page.request);
  const user = await userId(page.request);
  const text = await createText(page.request, "Revisao com pulos", 300);
  await readUpTo(text.id, 299);
  await dueWord(page, user, text.id, 3);
  const highlight = await dueHighlight(page, text.id, 2);

  await page.goto("/revisar");
  await expect(page.getByRole("heading", { name: "Revisão do dia" })).toBeVisible();
  // A revisao e uma aba da barra: o cabecalho nao tem mais a seta de voltar.
  await expect(page.getByRole("main").getByRole("link", { name: "Voltar", exact: true })).toHaveCount(0);
  await expect(page.getByTestId("contagem-revisao")).toHaveText("1 palavra · 1 destaque");

  // Pula os dois: nada e gravado e o resumo nao diz "concluída".
  await expect(page.getByText("1 de 2")).toBeVisible();
  await expect(item(page)).toHaveAttribute("data-kind", "palavra");
  await skip(page).click();
  await expect(page.getByText("2 de 2")).toBeVisible();
  await expect(item(page)).toHaveAttribute("data-kind", "destaque");
  await skip(page).click();

  await expect(page.getByRole("heading", { name: "Nada respondido" })).toBeVisible();
  await expect(summary(page)).toContainText("2 itens pulados continuam na fila.");
  await expect(page.getByRole("heading", { name: "Revisão concluída" })).toHaveCount(0);
  expect(
    await querySql("select id from review_answers where user_id = $1", [user])
  ).toHaveLength(0);

  // Os pulados continuam vencidos: voltam ao reabrir a tela, na mesma ordem.
  await page.reload();
  await expect(page.getByText("1 de 2")).toBeVisible();
  await expect(item(page)).toHaveAttribute("data-kind", "palavra");

  // Responde a palavra e pula o destaque: o resumo separa um do outro.
  await page.getByRole("button", { name: "Mostrar resposta" }).click();
  await page.getByRole("button", { name: /^Bom/ }).click();
  await expect(item(page)).toHaveAttribute("data-kind", "destaque");
  // Pular vale tambem com a resposta ja aberta.
  await page.getByRole("button", { name: "Mostrar resposta" }).click();
  await skip(page).click();

  await expect(page.getByRole("heading", { name: "Revisão concluída" })).toBeVisible();
  await expect(summary(page)).toContainText("Você lembrou 1 de 1. 1 pulado continua na fila.");
  // Sem erro, o resumo nao promete que algo volta amanha.
  await expect(summary(page)).not.toContainText("errou");

  const kinds = await querySql<{ kind: string }>(
    "select kind from review_answers where user_id = $1",
    [user]
  );
  expect(kinds.map((row) => row.kind)).toEqual(["palavra"]);
  const [mark] = await querySql<{ interval: number; reviewed: Date | null }>(
    "select review_interval as interval, last_reviewed_at as reviewed from highlights where id = $1",
    [highlight]
  );
  expect(mark).toEqual({ interval: 0, reviewed: null });

  await page.reload();
  await expect(page.getByTestId("contagem-revisao")).toHaveText("1 destaque");
  await expect(page.getByText("1 de 1")).toBeVisible();
});

test("Não revisar tira o destaque da fila; a tela de destaques devolve", async ({ page }) => {
  await registerByApi(page.request);
  const text = await createText(page.request, "Destaque fora da revisao", 300);
  const highlight = await dueHighlight(page, text.id, 2);

  await page.goto("/revisar");
  await expect(item(page)).toHaveAttribute("data-kind", "destaque");
  await takeOut(page).click();

  // A confirmacao diz o efeito antes de gravar.
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Não revisar este destaque" })).toBeVisible();
  await expect(dialog.getByTestId("efeito-tirar")).toContainText("sai da revisão e continua no texto");
  await dialog.getByRole("button", { name: "Não revisar", exact: true }).click();

  await expect(page.getByRole("heading", { name: "Nada ficou na fila" })).toBeVisible();
  await expect(summary(page)).toContainText("1 item saiu da revisão.");
  const [off] = await querySql<{ off: boolean }>(
    "select review_off_at is not null as off from highlights where id = $1",
    [highlight]
  );
  expect(off!.off).toBe(true);

  // Fora de todas as contas de vencido: revisao do dia e revisao de destaques.
  await page.reload();
  await expect(page.getByRole("heading", { name: "Revisão em dia." })).toBeVisible();
  await expect(page.getByText("Nada vence amanhã.")).toBeVisible();
  const separate = await (await page.request.get("/api/destaques/revisao")).json();
  expect(separate.due).toBe(0);
  expect(separate.cards).toHaveLength(0);
  // Nota vinda de uma tela aberta antes de ele sair nao o agenda de novo.
  const late = await (
    await page.request.post("/api/destaques/revisao", { data: { id: highlight, grade: "bom" } })
  ).json();
  expect(late.repeated).toBe(true);

  // Na tela de destaques do texto: o rotulo e o caminho de volta.
  await page.goto(`/textos/${text.id}/destaques`);
  const review = page.getByTestId("destaque-revisao");
  await expect(review).toHaveAttribute("data-fora", "sim");
  await expect(review).toContainText("Fora da revisão");
  await review.getByRole("button", { name: "Voltar a revisar" }).click();
  await expect(review).toHaveAttribute("data-fora", "nao");
  await expect(review.getByRole("button", { name: "Não revisar" })).toBeVisible();

  // A data dele ja tinha passado: de volta, vence amanha, e nao na hora.
  await page.goto("/revisar");
  await expect(page.getByRole("heading", { name: "Revisão em dia." })).toBeVisible();
  await expect(page.getByText("Amanhã vencem 1 item.")).toBeVisible();

  // Os destaques que estao na revisao oferecem "Não revisar" ali mesmo.
  await page.goto(`/textos/${text.id}/destaques`);
  await page.getByTestId("destaque-revisao").getByRole("button", { name: "Não revisar" }).click();
  await expect(page.getByTestId("destaque-revisao")).toHaveAttribute("data-fora", "sim");
  await page.reload();
  await expect(page.getByTestId("destaque-revisao")).toContainText("Fora da revisão");
  // O destaque continua no texto.
  await expect(page.getByText("1 destaque", { exact: true })).toBeVisible();
});

test("Já sei esta palavra marca a palavra como aprendida", async ({ page }) => {
  await registerByApi(page.request);
  const user = await userId(page.request);
  const text = await createText(page.request, "Palavra sabida", 300);
  await dueWord(page, user, text.id, 3);

  await page.goto("/revisar");
  await expect(item(page)).toHaveAttribute("data-kind", "palavra");
  await takeOut(page).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Já sei esta palavra" })).toBeVisible();
  await expect(dialog.getByTestId("efeito-tirar")).toContainText("como aprendida");

  // Fechar a confirmacao nao grava nada.
  await dialog.getByRole("button", { name: "Fechar" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(item(page)).toHaveAttribute("data-kind", "palavra");
  const [before] = await querySql<{ learned: boolean }>(
    "select learned_at is not null as learned from saved_words where user_id = $1",
    [user]
  );
  expect(before!.learned).toBe(false);

  await takeOut(page).click();
  await page.getByRole("dialog").getByRole("button", { name: "Já sei esta palavra" }).click();
  await expect(page.getByRole("heading", { name: "Nada ficou na fila" })).toBeVisible();

  const [after] = await querySql<{ learned: boolean }>(
    "select learned_at is not null as learned from saved_words where user_id = $1",
    [user]
  );
  expect(after!.learned).toBe(true);
  // Aprender nao e responder: nenhuma nota foi registrada.
  expect(await querySql("select id from review_answers where user_id = $1", [user])).toHaveLength(0);

  await page.reload();
  await expect(page.getByRole("heading", { name: "Revisão em dia." })).toBeVisible();

  // Continua na lista de palavras, como aprendida.
  await page.goto("/palavras");
  await expect(page.getByRole("button", { name: /^Devolver .+ a revisão$/ })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
});

test("excluir o cartao pela revisao do dia; depois de Errei nao ha o que pular", async ({ page }) => {
  await registerByApi(page.request);
  const user = await userId(page.request);
  const text = await createText(page.request, "Cartoes da revisao", 300);
  await readUpTo(text.id, 299);
  await dueCard(user, text.id, "Cartao errado", 3);
  const removed = await dueCard(user, text.id, "Cartao apagado", 1);

  await page.goto("/revisar");
  await expect(page.getByTestId("cartao-frente")).toHaveText("Cartao errado");
  await expect(page.getByTestId("acoes-revisao")).toBeVisible();
  await page.getByRole("button", { name: "Mostrar resposta" }).click();
  await page.getByRole("button", { name: /^Errei/ }).click();
  // A nota ja foi gravada e o cartao continua na tela: so resta continuar.
  await expect(page.getByText("O cartão volta amanhã.")).toBeVisible();
  await expect(page.getByTestId("acoes-revisao")).toHaveCount(0);
  await page.getByRole("button", { name: "Continuar" }).click();

  await expect(page.getByTestId("cartao-frente")).toHaveText("Cartao apagado");
  await takeOut(page).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Excluir cartão" })).toBeVisible();
  await expect(dialog.getByTestId("efeito-tirar")).toHaveText("O cartão é apagado e não dá para desfazer.");
  await dialog.getByRole("button", { name: "Excluir cartão" }).click();

  await expect(page.getByRole("heading", { name: "Revisão concluída" })).toBeVisible();
  await expect(summary(page)).toContainText(
    "Você lembrou 0 de 1. O que você errou volta amanhã. 1 saiu da revisão."
  );
  expect(await querySql("select id from study_cards where id = $1", [removed])).toHaveLength(0);
  expect(await querySql("select id from study_cards where user_id = $1", [user])).toHaveLength(1);
});

test("dispensar o questionario tira so a rodada, e a rodada expira sozinha", async ({ page }) => {
  await registerByApi(page.request);
  const user = await userId(page.request);
  const text = await createText(page.request, "Texto a recordar", 300);
  const detail = (await (await page.request.get(`/api/texts/${text.id}`)).json()).text as {
    content: string;
    language: string;
  };
  const quiz = {
    questions: [
      { prompt: "Pergunta um", choices: ["alfa", "beta", "gama", "delta"], answer: 0, evidence: "" },
      { prompt: "Pergunta dois", choices: ["um", "dois", "tres", "quatro"], answer: 2, evidence: "" },
    ],
  };
  await runSql(
    "insert into comprehension_quizzes (text_id, content_key, questions) values ($1, $2, $3)",
    [text.id, quizKey(detail.content, detail.language), JSON.stringify(quiz)]
  );
  await runSql(
    `insert into reading_sessions (user_id, text_id, wpm, words_read, duration_ms, completed, comprehension, created_at)
     values ($1, $2, 300, 300, 60000, true, 50, now() - interval '8 days')`,
    [user, text.id]
  );
  const concludedDaysAgo = (days: number) =>
    runSql(`update reading_sessions set created_at = now() - interval '${days} days' where text_id = $1`, [
      text.id,
    ]);
  const recalls = () =>
    querySql<{ round: number; score: number | null }>(
      "select round, score from quiz_recalls where user_id = $1 order by round",
      [user]
    );

  await page.goto("/revisar");
  await expect(page.getByTestId("contagem-revisao")).toHaveText("1 questionário");
  await expect(page.getByText("Recordar: Texto a recordar")).toBeVisible();

  // Pular vale no meio do questionario: as respostas marcadas se perdem.
  await page.getByRole("button", { name: "Começar" }).click();
  await page.getByRole("button", { name: "alfa", exact: true }).click();
  await skip(page).click();
  await expect(page.getByRole("heading", { name: "Nada respondido" })).toBeVisible();
  await expect(summary(page)).toContainText("1 item pulado continua na fila.");
  expect(await recalls()).toEqual([]);

  // Pulado, volta ao reabrir; dispensado, nao.
  await page.reload();
  await expect(page.getByText("Recordar: Texto a recordar")).toBeVisible();
  await page.getByRole("button", { name: "Começar" }).click();
  await takeOut(page).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Dispensar este questionário" })).toBeVisible();
  await expect(dialog.getByTestId("efeito-tirar")).toContainText("a de 30 dias continua valendo");
  await dialog.getByRole("button", { name: "Dispensar este questionário" }).click();
  await expect(page.getByRole("heading", { name: "Nada ficou na fila" })).toBeVisible();

  // A rodada fica gravada sem nota.
  expect(await recalls()).toEqual([{ round: 7, score: null }]);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Revisão em dia." })).toBeVisible();
  expect((await page.request.get(`/api/texts/${text.id}/recordar`)).status()).toBe(404);
  // Nada vencido: dispensar de novo nao tem o que dispensar.
  expect((await page.request.delete(`/api/texts/${text.id}/recordar`)).status()).toBe(404);

  // No historico do texto a rodada aparece como dispensada, sem porcentagem.
  await page.goto(`/textos/${text.id}/leituras`);
  const notes = page.getByTestId("notas-questionario");
  await expect(notes.getByRole("listitem").filter({ hasText: "7 dias depois" })).toContainText("dispensado");
  await expect(notes.getByRole("listitem").filter({ hasText: "30 dias depois" })).toContainText("--");

  // Dispensar a de 7 dias nao dispensa a de 30.
  await concludedDaysAgo(31);
  const last = await (await page.request.get(`/api/texts/${text.id}/recordar`)).json();
  expect(last.round).toBe(30);
  await page.goto("/revisar");
  await expect(page.getByText("Recordar: Texto a recordar")).toBeVisible();

  // A de 30 e oferecida ate o dia 59 da conclusao e some sozinha no dia 60.
  await concludedDaysAgo(59);
  expect((await page.request.get(`/api/texts/${text.id}/recordar`)).status()).toBe(200);
  await concludedDaysAgo(61);
  expect((await page.request.get(`/api/texts/${text.id}/recordar`)).status()).toBe(404);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Revisão em dia." })).toBeVisible();
  // Expirar nao grava nada: so a rodada dispensada esta no banco.
  expect(await recalls()).toEqual([{ round: 7, score: null }]);
});
