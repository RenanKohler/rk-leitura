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

test("US-198: a mesma nota enviada duas vezes conta uma vez", async ({ request }) => {
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

test("US-198: duas notas simultaneas gravam uma so", async ({ request }) => {
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
