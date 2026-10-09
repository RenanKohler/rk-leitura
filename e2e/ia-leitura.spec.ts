import { expect, test, type Page, type Route } from "@playwright/test";
import { contentKey } from "../src/lib/quiz";
import { runSql } from "./db";
import { createText, openReader, randomIp, registerByApi, updateSettings } from "./helpers";

/**
 * Explicar a frase (US-127), perguntar ao texto (US-128) e guardar a resposta
 * como nota (US-129). O modelo nao roda aqui: as rotas de IA sao simuladas no
 * navegador, e o resto (leitor, destaques, notas) e o de verdade.
 *
 * As respostas novas chegam em streaming (US-145): o simulado responde NDJSON,
 * um evento por linha, como a rota.
 */

// O service worker do app atende os fetch por conta propria, e o que passa
// por ele nao chega ao `page.route`.
test.use({ serviceWorkers: "block" });

test.beforeEach(async ({ context, page }) => {
  await context.setExtraHTTPHeaders({ "x-forwarded-for": randomIp() });
  await page.emulateMedia({ reducedMotion: "reduce" });
});

/** Atalho de teclado, repetido ate o leitor hidratado atender. */
async function shortcut(page: Page, key: string, title: string) {
  const sheet = page.getByRole("dialog", { name: title });
  await expect(async () => {
    await page.keyboard.press(key);
    await expect(sheet).toBeVisible({ timeout: 1_000 });
  }).toPass();
  return sheet;
}

/** Corpo NDJSON com os eventos dados. */
const ndjson = (...events: object[]) => events.map((event) => `${JSON.stringify(event)}\n`).join("");

/** Responde o stream; sem `done`, a conexao "cai" no meio da resposta. */
const fulfillStream = (route: Route, ...events: object[]) =>
  route.fulfill({ contentType: "application/x-ndjson", body: ndjson(...events) });

/**
 * Simula so o POST da rota: a conversa guardada (GET) e a limpeza (DELETE)
 * vao ao servidor de verdade.
 */
async function mockPost(page: Page, path: string, handler: (route: Route) => Promise<void> | void) {
  await page.route(`**/api/texts/*/${path}`, (route) =>
    route.request().method() === "POST" ? handler(route) : route.fallback()
  );
}

const position = (page: Page) =>
  page.locator("header .tabular").first().innerText().then((text) => Number(text.split("/")[0]!.replace(/\D/g, "")));

async function setup(page: Page, words: number) {
  await registerByApi(page.request);
  await updateSettings(page.request, { readerTipsSeen: true, aiEnabled: true });
  return createText(page.request, "Texto com IA", words);
}

test("explicar a frase atual pausa e mostra a explicacao", async ({ page }) => {
  const text = await setup(page, 200);
  let calls = 0;
  let body: unknown = null;
  await mockPost(page, "explicacao", async (route) => {
    calls += 1;
    body = route.request().postDataJSON();
    await fulfillStream(
      route,
      { type: "start", sentence: "leitura rapida exige atencao", start: 0, end: 12 },
      { type: "delta", field: "simple", text: "Ler rápido " },
      { type: "delta", field: "simple", text: "pede atenção ao ritmo." },
      { type: "delta", field: "explanation", text: "A frase diz que a velocidade" },
      {
        type: "done",
        explanation: {
          simple: "Ler rápido pede atenção ao ritmo.",
          translation: null,
          explanation: "A frase diz que a velocidade depende de acompanhar o sentido.",
        },
        sentence: "leitura rapida exige atencao",
        start: 0,
        end: 12,
        cached: false,
      }
    );
  });

  await openReader(page, text.id);
  const sheet = await shortcut(page, "e", "Explicar frase");
  await expect(sheet.getByText("Ler rápido pede atenção ao ritmo.")).toBeVisible();
  await expect(sheet.getByText("Explicação")).toBeVisible();
  await expect(sheet.getByText("Tradução")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  // Em desenvolvimento o efeito roda duas vezes e o primeiro pedido e abortado.
  expect(calls).toBeGreaterThanOrEqual(1);
  expect(body).toEqual({ index: 0 });
  expect(await position(page)).toBe(1);
});

test("limite de explicacoes mostra o aviso e nao muda a posicao", async ({ page }) => {
  const text = await setup(page, 200);
  await page.route("**/api/texts/*/explicacao", (route) =>
    route.fulfill({
      status: 429,
      json: { error: "Limite diário de explicações atingido. Volta a valer amanhã." },
    })
  );

  await openReader(page, text.id);
  const sheet = await shortcut(page, "e", "Explicar frase");
  await expect(
    sheet.getByText("Limite diário de explicações atingido. Volta a valer amanhã.")
  ).toBeVisible();
  await page.keyboard.press("Escape");
  expect(await position(page)).toBe(1);
});

test("perguntar ao texto, guardar como nota e ir ate a citacao", async ({ page }) => {
  const text = await setup(page, 1500);
  const answer = "A leitura rápida depende do ritmo das frases.";
  let sent: Record<string, unknown> | null = null;
  await mockPost(page, "pergunta", async (route) => {
    sent = route.request().postDataJSON();
    await fulfillStream(
      route,
      { type: "delta", text: "A leitura rápida depende " },
      { type: "delta", text: "do ritmo das frases." },
      {
        type: "done",
        answer: {
          text: answer,
          citations: [{ start: 1200, end: 1206, quote: "ao ritmo das frases e ao" }],
        },
        recentOnly: true,
        turn: null,
      }
    );
  });

  await openReader(page, text.id);
  await page.getByRole("button", { name: "Perguntar ao texto" }).click();
  const sheet = page.getByRole("dialog", { name: "Perguntar ao texto" });
  await sheet.getByLabel("Sua pergunta").fill("Do que depende a leitura?");
  await sheet.getByRole("button", { name: "Perguntar", exact: true }).click();

  await expect(sheet.getByText(answer)).toBeVisible();
  await expect(sheet.getByText("Considerando só o trecho mais recente.")).toBeVisible();
  expect(sent).toMatchObject({ question: "Do que depende a leitura?", position: 0, history: [] });
  await expect(sheet.getByLabel("Sua pergunta")).toHaveValue("");

  // US-129: a resposta vira nota do primeiro trecho citado.
  await sheet.getByRole("button", { name: "Guardar como nota" }).click();
  // A primeira ida as rotas de destaque compila no servidor de desenvolvimento.
  await expect(sheet.getByText("Guardada como nota no trecho citado.")).toBeVisible({
    timeout: 30_000,
  });
  const saved = await (await page.request.get(`/api/texts/${text.id}/destaques`)).json();
  expect(saved.highlights).toHaveLength(1);
  expect(saved.highlights[0]).toMatchObject({ start: 1200, end: 1206, note: answer });

  // US-128: a citacao leva ao trecho, e o leitor oferece a volta.
  await sheet.getByRole("button", { name: /Ir para o trecho citado/ }).click();
  await expect(sheet).toHaveCount(0);
  expect(await position(page)).toBe(1201);
  const back = page.getByRole("button", { name: /Voltar para onde parou/ });
  await expect(back).toBeVisible();
  await back.click();
  expect(await position(page)).toBe(1);

  // A conversa continua na folha ao reabrir; a segunda pergunta leva o historico.
  await page.getByRole("button", { name: "Perguntar ao texto" }).click();
  await expect(sheet.getByText(answer)).toBeVisible();
  await sheet.getByLabel("Sua pergunta").fill("E depois?");
  await sheet.getByRole("button", { name: "Perguntar", exact: true }).click();
  await expect(sheet.getByTestId("pergunta-resposta")).toHaveCount(2);
  expect(sent).toMatchObject({ history: [{ question: "Do que depende a leitura?", answer }] });

  // Guardar a segunda no mesmo trecho acrescenta a nota, sem outro destaque.
  await sheet.getByRole("button", { name: "Guardar como nota" }).click();
  await expect(sheet.getByText("Guardada como nota no trecho citado.")).toHaveCount(2, {
    timeout: 15_000,
  });
  const after = await (await page.request.get(`/api/texts/${text.id}/destaques`)).json();
  expect(after.highlights).toHaveLength(1);
  expect(after.highlights[0].note).toBe(`${answer}\n\n${answer}`);
});

test("resposta sem citacao nao oferece guardar e o limite mantem a pergunta", async ({ page }) => {
  const text = await setup(page, 200);
  let quota = false;
  await mockPost(page, "pergunta", (route) =>
    quota
      ? route.fulfill({
          status: 429,
          json: { error: "Limite diário de perguntas atingido. Volta a valer amanhã." },
        })
      : fulfillStream(route, {
          type: "done",
          answer: { text: "O trecho lido até aqui não responde a isso.", citations: [] },
          recentOnly: false,
          turn: null,
        })
  );

  await openReader(page, text.id);
  const sheet = await shortcut(page, "p", "Perguntar ao texto");
  await sheet.getByLabel("Sua pergunta").fill("Quem e o autor?");
  await sheet.getByRole("button", { name: "Perguntar", exact: true }).click();
  await expect(sheet.getByText("O trecho lido até aqui não responde a isso.")).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Guardar como nota" })).toHaveCount(0);

  quota = true;
  await sheet.getByLabel("Sua pergunta").fill("Outra pergunta?");
  await sheet.getByRole("button", { name: "Perguntar", exact: true }).click();
  await expect(
    sheet.getByText("Limite diário de perguntas atingido. Volta a valer amanhã.")
  ).toBeVisible();
  await expect(sheet.getByLabel("Sua pergunta")).toHaveValue("Outra pergunta?");
});

test("a rota de pergunta recusa pergunta longa demais", async ({ page }) => {
  const text = await setup(page, 50);
  const response = await page.request.post(`/api/texts/${text.id}/pergunta`, {
    data: { question: "a".repeat(501), position: 10 },
  });
  expect(response.status()).toBe(400);
});

/* --- US-145 a US-148 ------------------------------------------------------ */

const EXPLANATION = {
  simple: "Ler rápido pede atenção ao ritmo.",
  translation: null,
  explanation: "A frase diz que a velocidade depende de acompanhar o sentido.",
};

const SENTENCE = { sentence: "leitura rapida exige atencao", start: 0, end: 12 };

test("explicacao interrompida guarda o trecho e tenta de novo", async ({ page }) => {
  const text = await setup(page, 200);
  let fail = true;
  await mockPost(page, "explicacao", (route) =>
    fail
      ? fulfillStream(
          route,
          { type: "start", ...SENTENCE },
          { type: "delta", field: "simple", text: "Ler rápido pede" }
        )
      : fulfillStream(
          route,
          { type: "start", ...SENTENCE },
          { type: "done", explanation: EXPLANATION, ...SENTENCE, cached: false }
        )
  );

  await openReader(page, text.id);
  const sheet = await shortcut(page, "e", "Explicar frase");
  await expect(sheet.getByText("Ler rápido pede", { exact: true })).toBeVisible();
  await expect(sheet.getByText("A resposta foi interrompida.")).toBeVisible();
  // Sem a resposta completa, ainda nao ha continuacao a pedir.
  await expect(sheet.getByRole("button", { name: "Mais simples" })).toHaveCount(0);

  fail = false;
  await sheet.getByRole("button", { name: "Tentar de novo" }).click();
  await expect(sheet.getByText(EXPLANATION.simple)).toBeVisible();
  await expect(sheet.getByText("A resposta foi interrompida.")).toHaveCount(0);
});

test("mais simples e exemplo: uma vez cada, e o limite mantem a explicacao", async ({ page }) => {
  const text = await setup(page, 200);
  const bodies: Record<string, unknown>[] = [];
  let quota = true;
  await mockPost(page, "explicacao", (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    bodies.push(body);
    if (body.followUp === "simples") {
      return fulfillStream(
        route,
        { type: "delta", text: "Quem lê rápido " },
        { type: "delta", text: "precisa seguir o sentido." },
        {
          type: "done",
          followUp: "simples",
          text: "Quem lê rápido precisa seguir o sentido.",
          cached: false,
        }
      );
    }
    if (body.followUp === "exemplo") {
      if (quota) {
        return route.fulfill({
          status: 429,
          json: { error: "Limite diário de explicações atingido. Volta a valer amanhã." },
        });
      }
      return route.fulfill({
        json: { followUp: "exemplo", text: "Como dirigir olhando a estrada.", cached: true },
      });
    }
    // A explicacao ja guardada volta como JSON comum, sem stream.
    return route.fulfill({ json: { explanation: EXPLANATION, ...SENTENCE, cached: true } });
  });

  await openReader(page, text.id);
  const sheet = await shortcut(page, "e", "Explicar frase");
  await expect(sheet.getByText(EXPLANATION.simple)).toBeVisible();

  const simpler = sheet.getByRole("button", { name: "Mais simples" });
  const example = sheet.getByRole("button", { name: "Dar um exemplo" });
  await simpler.click();
  await expect(sheet.getByText("Quem lê rápido precisa seguir o sentido.")).toBeVisible();
  await expect(simpler).toBeDisabled();
  expect(bodies.at(-1)).toEqual({ index: 0, followUp: "simples" });

  // Limite do dia: aviso na tela, explicacao original intacta, botao ativo.
  await example.click();
  await expect(
    sheet.getByText("Limite diário de explicações atingido. Volta a valer amanhã.")
  ).toBeVisible();
  await expect(sheet.getByText(EXPLANATION.simple)).toBeVisible();
  await expect(sheet.getByText(EXPLANATION.explanation)).toBeVisible();
  await expect(example).toBeEnabled();

  quota = false;
  await example.click();
  await expect(sheet.getByText("Como dirigir olhando a estrada.")).toBeVisible();
  // Duas continuacoes por frase: as duas opcoes ficam desativadas.
  await expect(simpler).toBeDisabled();
  await expect(example).toBeDisabled();
});

test("pergunta interrompida guarda o trecho e tenta de novo", async ({ page }) => {
  const text = await setup(page, 200);
  let fail = true;
  await mockPost(page, "pergunta", (route) =>
    fail
      ? fulfillStream(route, { type: "delta", text: "A leitura depende" })
      : fulfillStream(route, {
          type: "done",
          answer: {
            text: "A leitura depende do ritmo.",
            citations: [{ start: 5, end: 8, quote: "ao ritmo das" }],
          },
          recentOnly: false,
          turn: null,
        })
  );

  await openReader(page, text.id);
  const sheet = await shortcut(page, "p", "Perguntar ao texto");
  await sheet.getByLabel("Sua pergunta").fill("Do que depende?");
  await sheet.getByRole("button", { name: "Perguntar", exact: true }).click();
  await expect(sheet.getByText("A leitura depende", { exact: true })).toBeVisible();
  await expect(sheet.getByText("A resposta foi interrompida.")).toBeVisible();

  fail = false;
  await sheet.getByRole("button", { name: "Tentar de novo" }).click();
  await expect(sheet.getByText("A leitura depende do ritmo.")).toBeVisible();
  await expect(sheet.getByText("A resposta foi interrompida.")).toHaveCount(0);
  await expect(sheet.getByTestId("pergunta-resposta")).toHaveCount(1);
});

test("conversa guardada volta com a posicao, o aviso de texto mudado e a limpeza", async ({
  page,
}) => {
  const text = await setup(page, 1500);
  const detail = await (await page.request.get(`/api/texts/${text.id}`)).json();
  const fingerprint = contentKey(detail.text.content as string);
  const insert = (question: string, answer: string, at: number, print: string, minutes: number) =>
    runSql(
      `insert into ask_turns (user_id, text_id, question, answer, position, fingerprint, created_at)
       select user_id, id, $2, $3::jsonb, $4, $5, now() - make_interval(mins => $6)
         from texts where id = $1`,
      [
        text.id,
        question,
        JSON.stringify({ text: answer, citations: [{ start: 10, end: 13, quote: "ao ritmo das" }] }),
        at,
        print,
        minutes,
      ]
    );
  await insert("Pergunta antiga?", "Resposta de outro conteúdo.", 300, "conteudo-velho", 20);
  await insert("Do que depende a leitura?", "Depende do ritmo.", 999, fingerprint, 10);
  await page.request.patch(`/api/texts/${text.id}`, {
    data: { progressIndex: 1400, at: new Date().toISOString() },
  });

  let sent: Record<string, unknown> | null = null;
  await mockPost(page, "pergunta", (route) => {
    sent = route.request().postDataJSON();
    return fulfillStream(route, {
      type: "done",
      answer: {
        text: "Depende do ritmo e do sentido.",
        citations: [{ start: 1300, end: 1303, quote: "ao ritmo das" }],
      },
      recentOnly: false,
      turn: null,
    });
  });

  await openReader(page, text.id);
  await page.getByRole("button", { name: "Perguntar ao texto" }).click();
  const sheet = page.getByRole("dialog", { name: "Perguntar ao texto" });
  const turns = sheet.getByTestId("pergunta-resposta");
  await expect(turns).toHaveCount(2);
  await expect(turns.nth(0).getByText("O texto mudou desde esta resposta.")).toBeVisible();
  await expect(turns.nth(0).getByText("Respondida até a palavra 301")).toBeVisible();
  await expect(turns.nth(1).getByText("O texto mudou desde esta resposta.")).toHaveCount(0);
  await expect(turns.nth(1).getByText("Respondida até a palavra 1.000")).toBeVisible();

  // A resposta guardada nao gasta cota; perguntar de novo usa o trecho atual.
  await turns
    .nth(1)
    .getByRole("button", { name: "Perguntar de novo com o trecho atual" })
    .click();
  await expect(sheet.getByText("Depende do ritmo e do sentido.")).toBeVisible();
  expect(sent).toMatchObject({ question: "Do que depende a leitura?", position: 1400, history: [] });

  await sheet.getByRole("button", { name: "Limpar conversa" }).click();
  await sheet.getByRole("button", { name: "Confirmar limpeza" }).click();
  await expect(turns).toHaveCount(0);
  const after = await (await page.request.get(`/api/texts/${text.id}/pergunta`)).json();
  expect(after.turns).toEqual([]);
});

test("sugestoes de perguntas aparecem e contam como pergunta digitada", async ({ page }) => {
  const text = await setup(page, 1500);
  await page.request.patch(`/api/texts/${text.id}`, {
    data: { progressIndex: 1200, at: new Date().toISOString() },
  });
  let asked: Record<string, unknown> | null = null;
  await mockPost(page, "sugestoes", (route) => {
    asked = route.request().postDataJSON();
    return route.fulfill({
      json: { suggestions: ["Do que depende a leitura rápida?", "Por que o ritmo importa?"] },
    });
  });
  let sent: Record<string, unknown> | null = null;
  await mockPost(page, "pergunta", (route) => {
    sent = route.request().postDataJSON();
    return fulfillStream(route, {
      type: "done",
      answer: {
        text: "Do ritmo das frases.",
        citations: [{ start: 10, end: 13, quote: "ao ritmo das" }],
      },
      recentOnly: false,
      turn: null,
    });
  });

  await openReader(page, text.id);
  await page.getByRole("button", { name: "Perguntar ao texto" }).click();
  const sheet = page.getByRole("dialog", { name: "Perguntar ao texto" });
  const list = sheet.getByTestId("pergunta-sugestoes");
  await expect(list.getByRole("button")).toHaveCount(2);
  expect(asked).toEqual({ position: 1200 });

  await list.getByRole("button", { name: "Por que o ritmo importa?" }).click();
  await expect(sheet.getByText("Do ritmo das frases.")).toBeVisible();
  expect(sent).toMatchObject({ question: "Por que o ritmo importa?", position: 1200 });
  await expect(list).toHaveCount(0);
});

test("a rota de sugestoes nao sugere antes de 300 palavras e falha sem erro", async ({ page }) => {
  const text = await setup(page, 1500);
  const early = await page.request.post(`/api/texts/${text.id}/sugestoes`, {
    data: { position: 100 },
  });
  expect(early.status()).toBe(200);
  expect((await early.json()).suggestions).toEqual([]);
  // Sem o modelo disponivel aqui, a geracao falha: lista vazia, sem erro.
  const later = await page.request.post(`/api/texts/${text.id}/sugestoes`, {
    data: { position: 1200 },
  });
  expect(later.status()).toBe(200);
  expect((await later.json()).suggestions).toEqual([]);
});
