import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
} from "@playwright/test";
import { createText, randomIp, uniqueEmail } from "./helpers";
import { querySql, runSql } from "./db";

/**
 * Conta e sessoes (US-208): um token antigo nunca volta a valer depois de
 * trocar a senha, sair de todos os aparelhos ou apagar a conta.
 */

const PASSWORD = "senha-e2e-123";

test.beforeEach(async ({ context }) => {
  await context.setExtraHTTPHeaders({ "x-forwarded-for": randomIp() });
});

function baseUrl(): string {
  return test.info().project.use.baseURL!;
}

/** Outro navegador, com a propria sessao, entrando na mesma conta. */
async function secondDevice(browser: Browser, email: string) {
  const context = await browser.newContext({
    baseURL: baseUrl(),
    extraHTTPHeaders: { "x-forwarded-for": randomIp() },
  });
  const login = await context.request.post(`${baseUrl()}/api/auth/login`, {
    data: { email, password: PASSWORD },
  });
  expect(login.ok()).toBeTruthy();
  return context;
}

async function register(
  request: APIRequestContext,
): Promise<{ email: string; id: string }> {
  const email = uniqueEmail();
  const response = await request.post("/api/auth/register", {
    data: { name: "Conta", email, password: PASSWORD },
  });
  expect(response.ok()).toBeTruthy();
  const me = await (await request.get("/api/auth/me")).json();
  return { email, id: me.user.id as string };
}

test("trocar a senha derruba a sessão do outro aparelho", async ({
  page,
  browser,
}) => {
  const { email } = await register(page.request);
  const other = await secondDevice(browser, email);
  expect((await other.request.get(`${baseUrl()}/api/texts`)).ok()).toBeTruthy();

  const changed = await page.request.patch("/api/auth/me", {
    data: { currentPassword: PASSWORD, newPassword: "senha-nova-456" },
  });
  expect(changed.ok()).toBeTruthy();

  expect((await other.request.get(`${baseUrl()}/api/texts`)).status()).toBe(
    401,
  );
  // Este aparelho recebeu o token novo e segue dentro.
  expect((await page.request.get("/api/texts")).ok()).toBeTruthy();
  await other.close();
});

test("sair de todos os aparelhos encerra todas as sessões", async ({
  page,
  browser,
}) => {
  const { email } = await register(page.request);
  const other = await secondDevice(browser, email);
  const third = await secondDevice(browser, email);

  const out = await page.request.post("/api/auth/logout/todos");
  expect(out.ok()).toBeTruthy();

  for (const request of [page.request, other.request, third.request]) {
    expect((await request.get(`${baseUrl()}/api/texts`)).status()).toBe(401);
  }
  await other.close();
  await third.close();
});

test("apagar a conta remove textos, sessões e inscrições", async ({ page }) => {
  const { id } = await register(page.request);
  const { id: textId } = await createText(
    page.request,
    "Texto da conta apagada",
    300,
  );
  await runSql(
    "insert into reading_sessions (user_id, text_id, words_read) values ($1, $2, 120)",
    [id, textId],
  );
  await runSql(
    "insert into push_subscriptions (user_id, endpoint, p256dh, auth) values ($1, $2, 'chave', 'segredo')",
    [id, `https://push.exemplo.com/${id}`],
  );

  const denied = await page.request.delete("/api/auth/me", {
    data: { password: "errada-123" },
  });
  expect(denied.status()).toBe(403);

  const deleted = await page.request.delete("/api/auth/me", {
    data: { password: PASSWORD },
  });
  expect(deleted.ok()).toBeTruthy();

  const [left] = await querySql<{
    users: string;
    texts: string;
    sessions: string;
    devices: string;
    subs: string;
  }>(
    `select (select count(*) from users where id = $1) as users,
            (select count(*) from texts where user_id = $1) as texts,
            (select count(*) from reading_sessions where user_id = $1) as sessions,
            (select count(*) from auth_sessions where user_id = $1) as devices,
            (select count(*) from push_subscriptions where user_id = $1) as subs`,
    [id],
  );
  expect(left).toEqual({
    users: "0",
    texts: "0",
    sessions: "0",
    devices: "0",
    subs: "0",
  });
  expect((await page.request.get("/api/texts")).status()).toBe(401);
});

test("rotas de cron e de uso da IA recusam pedido sem segredo", async ({
  request,
}) => {
  for (const path of [
    "/api/cron/lembretes",
    "/api/cron/acompanhamento",
    "/api/uso-ia",
  ]) {
    const anonymous = await request.get(path);
    expect(anonymous.status(), path).toBe(401);
    const wrong = await request.get(path, {
      headers: { authorization: "Bearer segredo-errado" },
    });
    expect(wrong.status(), path).toBe(401);
  }
});

/** US-190: senha que o bcrypt cortaria e recusada, com o motivo. */
test("senha acima de 72 bytes é recusada no cadastro", async ({ request }) => {
  const response = await request.post("/api/auth/register", {
    data: { name: "Longa", email: uniqueEmail(), password: "frase longa ".repeat(7) },
  });
  expect(response.status()).toBe(400);
  expect((await response.json()).error).toBe(
    "A senha pode ter até 72 caracteres (menos se tiver acentos)."
  );
});

/** US-188: aparelho com token vencido sai da lista; o atual fica. */
test("aparelhos conectados mostram só sessões válidas", async ({ page, browser }) => {
  const { email, id } = await register(page.request);
  const other = await secondDevice(browser, email);
  const stale = await secondDevice(browser, email);
  await stale.close();
  // O terceiro login venceu: o token dele foi emitido ha 8 dias. O aparelho
  // atual tambem e antigo, mas segue marcado como "Este aparelho".
  await runSql(
    `update auth_sessions set issued_at = now() - interval '8 days'
      where user_id = $1 and id = (select id from auth_sessions where user_id = $1 order by created_at desc limit 1)`,
    [id]
  );
  await runSql(
    `update auth_sessions set issued_at = now() - interval '9 days'
      where user_id = $1 and id = (select id from auth_sessions where user_id = $1 order by created_at asc limit 1)`,
    [id]
  );

  const { devices } = (await (await page.request.get("/api/auth/aparelhos")).json()) as {
    devices: { current: boolean }[];
  };
  expect(devices).toHaveLength(2);
  expect(devices.filter((device) => device.current)).toHaveLength(1);
  await other.close();
});
