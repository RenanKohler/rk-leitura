import { expect, test, type APIRequestContext } from "@playwright/test";
import { Client } from "pg";
import { createText, randomIp, registerByApi } from "./helpers";
import { runSql } from "./db";

/**
 * Backlog de sustentacao (US-171 a US-209): regras que dependem de banco e
 * por isso ficam fora dos testes unitarios.
 */

test.use({ serviceWorkers: "block" });

test.beforeEach(async ({ context }) => {
  await context.setExtraHTTPHeaders({ "x-forwarded-for": randomIp() });
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

async function answers(user: string, kind: string): Promise<number> {
  const [row] = await query<{ n: string }>(
    "select count(*) as n from review_answers where user_id = $1 and kind = $2",
    [user, kind]
  );
  return Number(row!.n);
}

test("US-198: a mesma nota enviada duas vezes conta uma vez", async ({ page }) => {
  const request = page.request;
  await registerByApi(request);
  const user = await userId(request);
  const text = await createText(request, "Revisao repetida", 120);
  await request.patch(`/api/texts/${text.id}`, { data: { progressIndex: 119 } });

  // Palavra com intervalo de 4 dias, vencida hoje.
  const word = await request.post("/api/palavras", {
    data: { word: "ritmo", context: "ao ritmo das frases", textId: text.id },
  });
  expect(word.status()).toBe(201);
  await runSql(
    "update saved_words set next_review_on = current_date, review_interval = 4 where user_id = $1",
    [user]
  );
  const [saved] = await query<{ id: string }>("select id from saved_words where user_id = $1", [user]);

  const highlight = await (
    await request.post(`/api/texts/${text.id}/destaques`, { data: { start: 0, end: 5 } })
  ).json();
  await runSql("update highlights set review_due_on = current_date, review_interval = 4 where id = $1", [
    highlight.id,
  ]);

  const [card] = await query<{ id: string }>(
    `insert into study_cards (user_id, text_id, front, back, kind, source_start, source_end, next_review_on, review_interval)
     values ($1, $2, 'Frente', 'Verso', 'conceito', 0, 5, current_date, 4) returning id`,
    [user, text.id]
  );

  const routes = [
    { kind: "palavra", send: () => request.post("/api/palavras/revisao", { data: { id: saved!.id, grade: "bom" } }) },
    { kind: "destaque", send: () => request.post("/api/destaques/revisao", { data: { id: highlight.id, grade: "bom" } }) },
    { kind: "cartao", send: () => request.post(`/api/cartoes/${card!.id}/revisao`, { data: { grade: "bom" } }) },
  ];

  for (const route of routes) {
    const first = await route.send();
    expect(first.status()).toBe(200);
    const firstBody = await first.json();
    expect(firstBody.interval).toBe(10);

    // A repeticao responde o estado atual, sem gravar.
    const second = await route.send();
    expect(second.status()).toBe(200);
    const secondBody = await second.json();
    expect(secondBody.interval).toBe(10);
    expect(secondBody.repeated).toBe(true);
    expect(await answers(user, route.kind)).toBe(1);
  }
});

test("US-198: duas notas simultaneas gravam uma so", async ({ page }) => {
  const request = page.request;
  await registerByApi(request);
  const user = await userId(request);
  const text = await createText(request, "Revisao simultanea", 60);
  await request.post("/api/palavras", {
    data: { word: "frases", context: "o sentido das frases", textId: text.id },
  });
  await runSql("update saved_words set next_review_on = current_date, review_interval = 4 where user_id = $1", [
    user,
  ]);
  const [saved] = await query<{ id: string }>("select id from saved_words where user_id = $1", [user]);

  await Promise.all(
    Array.from({ length: 3 }, () =>
      request.post("/api/palavras/revisao", { data: { id: saved!.id, grade: "bom" } })
    )
  );
  expect(await answers(user, "palavra")).toBe(1);
});

async function subscriptions(user: string): Promise<{ endpoint: string; session_id: string | null }[]> {
  return query("select endpoint, session_id from push_subscriptions where user_id = $1 order by endpoint", [user]);
}

async function subscribe(user: string, endpoint: string, session: string | null) {
  await runSql(
    "insert into push_subscriptions (user_id, endpoint, p256dh, auth, session_id) values ($1, $2, 'k', 'a', $3)",
    [user, endpoint, session]
  );
}

async function sessionsOf(user: string): Promise<string[]> {
  const rows = await query<{ id: string }>(
    "select id from auth_sessions where user_id = $1 and revoked_at is null order by created_at",
    [user]
  );
  return rows.map((row) => row.id);
}

test("US-183: sair e desconectar um aparelho apagam as inscricoes dele", async ({ playwright, page }) => {
  const request = page.request;
  const email = await registerByApi(request);
  const user = await userId(request);
  const [first] = await sessionsOf(user);

  const other = await playwright.request.newContext({
    baseURL: test.info().project.use.baseURL,
    extraHTTPHeaders: { "x-forwarded-for": randomIp() },
  });
  expect((await other.post("/api/auth/login", { data: { email, password: "senha-e2e-123" } })).ok()).toBeTruthy();
  const second = (await sessionsOf(user)).find((id) => id !== first)!;

  await subscribe(user, "https://push.test/a", first!);
  await subscribe(user, "https://push.test/b", second);
  await subscribe(user, "https://push.test/antiga", null);

  // Desconectar o segundo aparelho apaga so a inscricao dele.
  expect((await request.delete(`/api/auth/aparelhos/${second}`)).ok()).toBeTruthy();
  expect((await subscriptions(user)).map((row) => row.endpoint)).toEqual([
    "https://push.test/a",
    "https://push.test/antiga",
  ]);

  // Sair apaga a deste aparelho e a antiga cujo endpoint a tela informa.
  const out = await request.post("/api/auth/logout", { data: { endpoint: "https://push.test/antiga" } });
  expect(out.ok()).toBeTruthy();
  expect(await subscriptions(user)).toEqual([]);
  await other.dispose();
});

test("US-183: sair de todos os aparelhos apaga todas as inscricoes", async ({ page }) => {
  const request = page.request;
  await registerByApi(request);
  const user = await userId(request);
  const [current] = await sessionsOf(user);
  await subscribe(user, "https://push.test/c", current!);
  await subscribe(user, "https://push.test/sem-aparelho", null);
  await runSql("update speed_settings set reminder_hour = 20 where user_id = $1", [user]);

  expect((await request.post("/api/auth/logout/todos")).ok()).toBeTruthy();
  expect(await subscriptions(user)).toEqual([]);
  const [settings] = await query<{ reminder_hour: number | null }>(
    "select reminder_hour from speed_settings where user_id = $1",
    [user]
  );
  expect(settings!.reminder_hour).toBeNull();
});

test("US-192: reescrever o texto apaga os cartoes da IA e marca os do leitor", async ({ page }) => {
  const request = page.request;
  await registerByApi(request);
  const user = await userId(request);
  const text = await createText(request, "Cartoes e conteudo", 120);
  await request.patch(`/api/texts/${text.id}`, { data: { progressIndex: 119 } });

  const insert = (front: string, kind: string, edited: boolean) =>
    query<{ id: string }>(
      `insert into study_cards (user_id, text_id, front, back, kind, source_start, source_end, edited_at)
       values ($1, $2, $3, 'Verso', $4, ${kind === "manual" ? "0, 0" : "10, 15"}, ${edited ? "now()" : "null"}) returning id`,
      [user, text.id, front, kind]
    );
  await insert("Gerado", "conceito", false);
  await insert("Gerado e editado", "ponto", true);
  await insert("Feito a mao", "manual", false);

  const saved = await request.put(`/api/texts/${text.id}`, {
    data: { title: "Cartoes e conteudo", content: "Um conteudo inteiramente novo para ler agora." },
  });
  expect(saved.ok()).toBeTruthy();

  const rows = await query<{ front: string; source_changed: boolean; source_end: number }>(
    "select front, source_changed, source_end from study_cards where text_id = $1 order by front",
    [text.id]
  );
  expect(rows).toEqual([
    { front: "Feito a mao", source_changed: true, source_end: 0 },
    { front: "Gerado e editado", source_changed: true, source_end: 0 },
  ]);
});

test("US-192: salvar cartoes relocaliza o trecho no conteudo atual", async ({ page }) => {
  const request = page.request;
  await registerByApi(request);
  const created = await request.post("/api/texts", {
    data: {
      title: "Relocalizar",
      content: "O rio nasce na serra alta e desce devagar ate o mar aberto do sul.",
    },
  });
  const text = (await created.json()).text as { id: string };

  // O conteudo muda depois de gerar: uma frase entra no comeco.
  await request.put(`/api/texts/${text.id}`, {
    data: {
      title: "Relocalizar",
      content: "Abertura nova. O rio nasce na serra alta e desce devagar ate o mar aberto do sul.",
    },
  });

  const response = await request.put(`/api/texts/${text.id}/cartoes-estudo`, {
    data: {
      cards: [
        { front: "Onde nasce o rio?", back: "Na serra", kind: "conceito", sourceStart: 0, sourceEnd: 6, passage: "O rio nasce na serra alta" },
        { front: "Sumiu", back: "x", kind: "conceito", sourceStart: 0, sourceEnd: 4, passage: "trecho que nao existe mais aqui" },
      ],
    },
  });
  expect(response.ok()).toBeTruthy();
  expect(await response.json()).toEqual({ saved: 1, dropped: 1, repeated: 0 });
  const [row] = await query<{ source_start: number; source_end: number }>(
    "select source_start, source_end from study_cards where text_id = $1",
    [text.id]
  );
  expect(row).toEqual({ source_start: 2, source_end: 8 });
});

test("US-193: apagar o que a IA gerou leva tambem o que foi gerado no estudo", async ({ page }) => {
  const request = page.request;
  await registerByApi(request);
  const user = await userId(request);
  const text = await createText(request, "Estudo com IA", 120);

  const card = (front: string, kind: string, edited: boolean, analogy: string | null) =>
    runSql(
      `insert into study_cards (user_id, text_id, front, back, kind, source_start, source_end, edited_at, analogy)
       values ($1, $2, $3, 'Verso', $4, 0, 5, ${edited ? "now()" : "null"}, $5)`,
      [user, text.id, front, kind, analogy]
    );
  await card("Gerado", "conceito", false, null);
  await card("Gerado com analogia", "lacuna", false, "Como um rio");
  await card("Editado", "ponto", true, "Como uma serra");
  await card("Meu", "manual", false, null);

  const highlight = await (
    await request.post(`/api/texts/${text.id}/destaques`, { data: { start: 0, end: 5 } })
  ).json();
  await runSql("update highlights set card_prompt = 'P', card_answer = 'R' where id = $1", [highlight.id]);
  await runSql(
    "insert into comprehension_quizzes (text_id, content_key, questions) values ($1, 'k', '[]')",
    [text.id]
  );

  const before = await (await request.get("/api/ia/resultados")).json();
  expect(before.counts).toMatchObject({
    cartoes: 2,
    analogias: 2,
    cartoesDestaque: 1,
    questionarios: 1,
    cartoesEditados: 1,
  });

  const deleted = await (await request.delete("/api/ia/resultados")).json();
  expect(deleted.kept).toBe(1);

  const cards = await query<{ front: string; analogy: string | null }>(
    "select front, analogy from study_cards where user_id = $1 order by front",
    [user]
  );
  expect(cards).toEqual([
    { front: "Editado", analogy: null },
    { front: "Meu", analogy: null },
  ]);
  const [mark] = await query<{ card_prompt: string | null }>("select card_prompt from highlights where id = $1", [
    highlight.id,
  ]);
  expect(mark!.card_prompt).toBeNull();
  expect(await query("select id from comprehension_quizzes where text_id = $1", [text.id])).toEqual([]);
  expect((await (await request.get("/api/ia/resultados")).json()).count).toBe(0);
});

test("US-189: a conta completa sai inteira e volta numa conta nova", async ({ page, playwright }) => {
  const request = page.request;
  await registerByApi(request);
  const user = await userId(request);
  const text = await createText(request, "Capitulo 4 - Serie exportada", 120);
  await runSql(
    `update texts set author = 'Autora Exemplo', series_key = 'serie-e2e', series_title = 'Serie E2E', chapter = 4,
       abandoned_at = now(), abandoned_words = 80, sections = '[{"index":0,"title":"Abertura"}]'::jsonb
     where id = $1`,
    [text.id]
  );
  await request.post("/api/palavras", { data: { word: "ritmo", context: "ao ritmo", textId: text.id } });

  const response = await request.get("/api/exportar?tipo=conta");
  expect(response.ok()).toBeTruthy();
  const file = await response.json();
  expect(file.versao).toBe(3);
  expect(Object.keys(file.conta.tabelas).sort()).toEqual(
    [
      "ai_results",
      "ask_turns",
      "feeds",
      "quiz_recalls",
      "reading_goals",
      "reading_sessions",
      "review_answers",
      "saved_words",
      "series_follows",
      "speed_settings",
      "study_cards",
      "training_days",
      "training_programs",
    ].sort()
  );
  expect(file.conta.tabelas.saved_words).toHaveLength(1);
  expect(JSON.stringify(file)).not.toContain("passwordHash");
  expect(JSON.stringify(file.conta.tabelas)).not.toContain(user);
  const exported = file.textos.find((item: { titulo: string }) => item.titulo === "Capitulo 4 - Serie exportada");
  expect(exported).toMatchObject({
    autor: "Autora Exemplo",
    serie: { chave: "serie-e2e", titulo: "Serie E2E", capitulo: 4 },
    palavrasRestantes: 80,
  });

  // Conta nova, outra sessao: restaura so esse texto.
  const other = await playwright.request.newContext({
    baseURL: test.info().project.use.baseURL,
    extraHTTPHeaders: { "x-forwarded-for": randomIp() },
  });
  await registerByApi(other);
  const restored = await other.post("/api/importar", { data: { textos: [exported] } });
  expect(restored.status()).toBe(201);
  const [id] = (await restored.json()).created as string[];
  const [row] = await query<{
    author: string;
    series_key: string;
    series_title: string;
    chapter: number;
    abandoned: boolean;
    abandoned_words: number;
  }>(
    `select author, series_key, series_title, chapter, abandoned_at is not null as abandoned, abandoned_words
     from texts where id = $1`,
    [id]
  );
  expect(row).toEqual({
    author: "Autora Exemplo",
    series_key: "serie-e2e",
    series_title: "Serie E2E",
    chapter: 4,
    abandoned: true,
    abandoned_words: 80,
  });
  await other.dispose();
});

test("US-197: a mesma frente nao e salva duas vezes no texto", async ({ page }) => {
  const request = page.request;
  await registerByApi(request);
  const text = await createText(request, "Sem repetir", 120);
  const card = { front: "Qual é o ritmo?", back: "Constante", kind: "conceito", sourceStart: 0, sourceEnd: 3 };

  const first = await request.put(`/api/texts/${text.id}/cartoes-estudo`, {
    data: { cards: [card, { ...card, front: "qual e o RITMO" }] },
  });
  expect(await first.json()).toEqual({ saved: 1, dropped: 0, repeated: 1 });

  // Outra aba manda de novo o mesmo cartao.
  const again = await request.put(`/api/texts/${text.id}/cartoes-estudo`, { data: { cards: [card] } });
  expect(await again.json()).toEqual({ saved: 0, dropped: 0, repeated: 1 });

  const manual = await request.post(`/api/texts/${text.id}/cartoes-estudo`, {
    data: { front: "Qual e o ritmo", back: "Outro verso" },
  });
  expect(manual.status()).toBe(409);
  expect((await manual.json()).error).toBe("Já existe um cartão com essa frente.");

  // Duas gravacoes ao mesmo tempo: o indice unico deixa passar uma.
  const fresh = { ...card, front: "Pergunta nova?" };
  const results = await Promise.all([
    request.put(`/api/texts/${text.id}/cartoes-estudo`, { data: { cards: [fresh] } }),
    request.put(`/api/texts/${text.id}/cartoes-estudo`, { data: { cards: [fresh] } }),
  ]);
  const saved = await Promise.all(results.map(async (result) => (await result.json()).saved as number));
  expect(saved.reduce((sum, value) => sum + value, 0)).toBe(1);
  const [row] = await query<{ n: string }>("select count(*) as n from study_cards where text_id = $1", [text.id]);
  expect(Number(row!.n)).toBe(2);
});
