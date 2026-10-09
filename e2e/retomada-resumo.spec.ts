import { expect, test, type APIRequestContext } from "@playwright/test";
import { randomIp, registerByApi, updateSettings } from "./helpers";
import { runSql } from "./db";

/**
 * Retomada com resumo (US-130 a US-132). Sem chave do modelo no ambiente de
 * teste: as rotas de IA sao simuladas com `page.route` onde o caminho com
 * resposta e o que se quer ver, e ficam de verdade onde o que importa e a
 * leitura seguir como antes, sem IA.
 */

// O service worker repassa os POST por conta propria, por fora do `page.route`.
test.use({ serviceWorkers: "block" });

test.beforeEach(async ({ context, page }) => {
  await context.setExtraHTTPHeaders({ "x-forwarded-for": randomIp() });
  await page.emulateMedia({ reducedMotion: "reduce" });
});

const PROSE = [
  "A pescadora Maria saiu cedo para o mar enquanto a cidade ainda dormia tranquila.",
  "Carregava uma rede remendada e uma garrafa de cafe quente embaixo do braco.",
  "No meio da travessia, Maria viu o barco de Joaquim balancar perigosamente.",
  "Ela segurou o leme com firmeza e esperou a tempestade passar sem desespero.",
  "Quando o sol voltou, Joaquim acenou para Maria da outra margem do canal.",
  "Maria voltou para casa contente, com historias novas para contar aos vizinhos curiosos.",
  "Os vizinhos escutaram tudo sentados na calcada, admirados com a coragem de Joaquim.",
  "Naquela noite, a vila inteira jantou peixe assado e conversou sobre o oceano generoso.",
].join(" ");

async function createText(request: APIRequestContext, title: string, content: string, extra = {}) {
  const response = await request.post("/api/texts", { data: { title, content, ...extra } });
  expect(response.ok()).toBeTruthy();
  return (await response.json()).text as { id: string; wordCount: number };
}

/** Texto lido ate `position`, com a ultima sessao ha tres dias. */
async function readDaysAgo(request: APIRequestContext, id: string, position: number) {
  await request.patch(`/api/texts/${id}`, {
    data: { progressIndex: position, at: new Date().toISOString() },
  });
  await request.post("/api/reading-sessions", {
    data: { textId: id, wordsRead: position, durationMs: 60_000, completed: false },
  });
  await runSql(
    "update reading_sessions set created_at = now() - interval '3 days' where text_id = $1",
    [id]
  );
}

test("US-130: sem IA, o cartao de retomada fica so com Recapitular e Pular", async ({ page }) => {
  await registerByApi(page.request);
  await updateSettings(page.request, { readerTipsSeen: true, aiEnabled: true });
  const text = await createText(page.request, "Travessia", PROSE);
  await readDaysAgo(page.request, text.id, 60);

  const status = page.waitForResponse((r) => r.url().includes(`/api/texts/${text.id}/resumo`));
  await page.goto(`/leitor/${text.id}`);
  await expect(page.getByText("Recapitular o contexto")).toBeVisible();
  // Rota de verdade, sem chave configurada: indisponivel.
  expect(await (await status).json()).toMatchObject({ available: false });
  await expect(page.getByRole("button", { name: "Recapitular" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Pular" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Resumo do que li" })).toHaveCount(0);
});

test("US-130: resumo do que li ate a posicao salva e continuar dali", async ({ page }) => {
  await registerByApi(page.request);
  await updateSettings(page.request, { readerTipsSeen: true, aiEnabled: true });
  const text = await createText(page.request, "Travessia", PROSE);
  await readDaysAgo(page.request, text.id, 60);

  let sentPosition: unknown = null;
  await page.route(`**/api/texts/${text.id}/resumo**`, async (route) => {
    if (route.request().method() === "GET") {
      expect(new URL(route.request().url()).searchParams.get("posicao")).toBe("60");
      return route.fulfill({ json: { available: true, summary: null } });
    }
    sentPosition = route.request().postDataJSON().posicao;
    return route.fulfill({
      json: {
        summary: {
          points: ["Maria sai cedo para pescar.", "Joaquim quase vira o barco.", "Maria volta para casa."],
          to: 60,
        },
      },
    });
  });

  await page.goto(`/leitor/${text.id}`);
  await page.getByRole("button", { name: "Resumo do que li" }).click();
  const summary = page.getByTestId("resumo-lido");
  await expect(summary.getByRole("listitem")).toHaveCount(3);
  await expect(summary).toContainText("Joaquim quase vira o barco.");
  expect(sentPosition).toBe(60);

  await summary.getByRole("button", { name: "Continuar a leitura" }).click();
  await expect(page.getByText("Recapitular o contexto")).toHaveCount(0);
});

test("US-131: resumo do capitulo anterior antes dos destaques; sem IA, direto aos destaques", async ({
  page,
}) => {
  await registerByApi(page.request);
  await updateSettings(page.request, { readerTipsSeen: true, aiEnabled: true });
  const series = { title: "A travessia" };
  const first = await createText(page.request, "Capitulo 1", PROSE, {
    series: { ...series, chapter: 1 },
  });
  const second = await createText(page.request, "Capitulo 2", "Outro dia comecou no porto.", {
    series: { ...series, chapter: 2 },
  });
  await page.request.patch(`/api/texts/${first.id}`, {
    data: { progressIndex: first.wordCount, at: new Date().toISOString() },
  });
  await page.request.post(`/api/texts/${first.id}/destaques`, { data: { start: 0, end: 4 } });
  await page.request.post("/api/reading-sessions", {
    data: { textId: first.id, wordsRead: first.wordCount, durationMs: 60_000, completed: true },
  });
  await runSql(
    "update reading_sessions set created_at = now() - interval '3 days' where text_id = $1",
    [first.id]
  );

  // Sem chave: a rota de verdade falha e a recapitulacao segue como antes.
  await page.goto(`/leitor/${second.id}`);
  await page.getByRole("button", { name: "Recapitular" }).click();
  await expect(page.getByText("Seus destaques até aqui")).toBeVisible();
  await expect(page.getByTestId("resumo-capitulo")).toHaveCount(0);

  // Com resposta: primeiro o resumo, depois os destaques.
  await page.route(`**/api/texts/${first.id}/resumo-capitulo`, (route) =>
    route.fulfill({ json: { summary: { points: ["Maria enfrenta a tempestade.", "Joaquim acena."] } } })
  );
  await page.goto(`/leitor/${second.id}`);
  await page.getByRole("button", { name: "Recapitular" }).click();
  const summary = page.getByTestId("resumo-capitulo");
  await expect(summary.getByRole("listitem")).toHaveCount(2);
  await expect(summary).toContainText("Maria enfrenta a tempestade.");
  await summary.getByRole("button", { name: "Ver destaques e o final" }).click();
  await expect(page.getByText("Seus destaques até aqui")).toBeVisible();
});

test("US-132: descrever os nomes ate onde li", async ({ page }) => {
  await registerByApi(page.request);
  await updateSettings(page.request, { readerTipsSeen: true, aiEnabled: true });
  const text = await createText(page.request, "Travessia", PROSE);

  // Sem IA: nomes e contagens como hoje, sem o botao.
  await page.goto(`/leitor/${text.id}`);
  await page.getByRole("button", { name: "Navegar no texto" }).click();
  await page.getByRole("button", { name: "Nomes no texto" }).click();
  await expect(page.getByTestId("xray-lista")).toContainText("Maria");
  await expect(page.getByRole("button", { name: "Descrever com IA" })).toHaveCount(0);

  await page.route(`**/api/texts/${text.id}/nomes**`, (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ json: { available: true, descriptions: null } })
      : route.fulfill({
          json: { descriptions: { Maria: "Pescadora que sai cedo para o mar.", Joaquim: null } },
        })
  );
  await page.goto(`/leitor/${text.id}`);
  await page.getByRole("button", { name: "Navegar no texto" }).click();
  await page.getByRole("button", { name: "Nomes no texto" }).click();
  await page.getByRole("button", { name: "Descrever com IA" }).click();
  const list = page.getByTestId("xray-lista");
  await expect(list).toContainText("Pescadora que sai cedo para o mar.");
  await expect(list).toContainText("Pouco contexto até aqui.");
});
