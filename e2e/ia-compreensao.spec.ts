import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { quizKey } from "../src/lib/quiz";
import { sessionQuizKey } from "../src/lib/session-check";
import { runSql } from "./db";
import { openReader, randomIp, registerByApi, updateSettings } from "./helpers";

// O service worker do modo offline atenderia o fetch antes de `page.route`.
test.use({ serviceWorkers: "block" });

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

async function createText(request: APIRequestContext, title: string, content: string) {
  const response = await request.post("/api/texts", { data: { title, content } });
  expect(response.ok()).toBeTruthy();
  return (await response.json()).text as { id: string; wordCount: number };
}

/**
 * Le no Word Runner por `steps` avancos do relogio e pausa. O relogio da
 * pagina e controlado: cada avanco dispara no maximo a palavra seguinte (o
 * React agenda a proxima depois de desenhar), sem esperar o tempo de verdade.
 */
async function readInRunner(page: Page, steps: number) {
  await page.getByRole("button", { name: "Iniciar leitura" }).click();
  await expect(page.getByTestId("word-runner")).toBeVisible();
  for (let step = 0; step < steps; step += 1) await page.clock.runFor(120);
  await page.getByRole("button", { name: "Pausar" }).click();
  await expect(page.getByTestId("word-runner")).toHaveCount(0);
}

test("checar compreensao da sessao do Word Runner grava a nota na sessao", async ({ page }) => {
  test.setTimeout(180_000);
  await registerByApi(page.request);
  await updateSettings(page.request, { baseWpm: 1200, warmup: false, askCheckpoints: false });
  const text = await createText(page.request, "Pescadora longa", Array(30).fill(PROSE).join("\n\n"));
  const detail = (await (await page.request.get(`/api/texts/${text.id}`)).json()).text as {
    content: string;
    language: string;
  };

  // Geracao simulada (sem chave neste ambiente): a rota de verdade nao e
  // chamada, mas o pedido da tela e conferido e o questionario vai para o
  // cache, onde a correcao de verdade o encontra.
  const requested: { from: number; to: number }[] = [];
  const choices = ["No mar", "Na cidade", "Na vila", "No barco"];
  const questions = [
    { prompt: "Onde a pescadora foi?", choices, answer: 0, evidence: "saiu cedo para o mar" },
    { prompt: "Quem escutou as histórias?", choices: ["Os vizinhos", "Maria", "O vento", "A vila"], answer: 0, evidence: "Os vizinhos escutaram tudo" },
  ];
  await page.route("**/api/texts/*/compreensao", async (route) => {
    const body = route.request().postDataJSON() as { from: number; to: number };
    requested.push(body);
    await runSql(
      "insert into comprehension_quizzes (text_id, content_key, questions) values ($1, $2, $3) on conflict do nothing",
      [
        text.id,
        sessionQuizKey(quizKey(detail.content, detail.language), body),
        JSON.stringify({ questions }),
      ]
    );
    await route.fulfill({
      json: {
        quiz: { questions: questions.map(({ prompt, choices }) => ({ prompt, choices })) },
        questions: 2,
        ...body,
      },
    });
  });

  await page.clock.install();
  await openReader(page, text.id);
  await readInRunner(page, 1100);

  const offer = page.getByTestId("checar-sessao");
  await expect(offer).toBeVisible();
  const posted = page.waitForRequest(
    (request) => request.url().endsWith("/api/reading-sessions") && request.method() === "POST"
  );
  await offer.getByRole("button", { name: "Checar compreensão" }).click();
  const session = (await posted).postDataJSON() as { wordsRead: number; mode: string };
  expect(session.mode).toBe("runner");
  expect(session.wordsRead).toBeGreaterThanOrEqual(800);

  await expect(page.getByTestId("checagem-intro")).toBeVisible();
  await page.getByRole("button", { name: "Começar", exact: true }).click();
  await expect(page.getByText("Onde a pescadora foi?")).toBeVisible();
  expect(requested).toHaveLength(1);
  // O trecho comeca no inicio da sessao e termina na posicao da pausa.
  expect(requested[0]!.from).toBe(0);
  expect(requested[0]!.to).toBeGreaterThanOrEqual(800);
  const progress = (await (await page.request.get(`/api/texts/${text.id}`)).json()).text
    .progressIndex as number;
  expect(requested[0]!.to).toBe(progress);

  await page.getByRole("button", { name: "No mar", exact: true }).click();
  await page.getByRole("button", { name: "Maria", exact: true }).click();
  await page.getByRole("button", { name: "Conferir respostas" }).click();
  await expect(page.getByText("50%")).toBeVisible();

  // A nota esta na sessao gravada ao abrir a checagem, e o treino mostra as duas.
  const sessions = await (await page.request.get("/api/reading-sessions")).json();
  const checked = sessions.sessions.find(
    (item: { comprehension: number | null }) => item.comprehension !== null
  );
  expect(checked.comprehension).toBe(50);
  expect(checked.wordsRead).toBe(session.wordsRead);

  await page.goto("/treino");
  const list = page.getByTestId("sessoes-compreensao");
  await expect(list).toContainText(`${checked.wpm} ppm`);
  await expect(list).toContainText("50%");
});

test("checagem some abaixo de 800 palavras e cai nas lacunas do mesmo trecho sem IA", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await registerByApi(page.request);
  await updateSettings(page.request, { baseWpm: 1200, warmup: false, askCheckpoints: false });
  const text = await createText(page.request, "Pescadora sem IA", Array(30).fill(PROSE).join("\n\n"));

  await page.clock.install();
  await openReader(page, text.id);
  await readInRunner(page, 200);
  // Poucas palavras na sessao: a opcao nao aparece.
  await expect(page.getByRole("button", { name: "Iniciar leitura" })).toBeVisible();
  await expect(page.getByTestId("checar-sessao")).toHaveCount(0);

  // Continuar a leitura e a mesma sessao: passando das 800, ela aparece.
  await readInRunner(page, 900);
  const offer = page.getByTestId("checar-sessao");
  await expect(offer).toBeVisible();

  const cloze = page.waitForRequest((request) => request.url().endsWith("/lacunas"));
  await offer.getByRole("button", { name: "Checar compreensão" }).click();
  await page.getByRole("button", { name: "Começar", exact: true }).click();

  // Sem chave neste ambiente: a geracao falha e as lacunas usam o mesmo trecho.
  const range = (await cloze).postDataJSON() as { from: number; to: number };
  expect(range.from).toBe(0);
  const progress = (await (await page.request.get(`/api/texts/${text.id}`)).json()).text
    .progressIndex as number;
  expect(range.to).toBe(progress);
  await expect(page.getByTestId("lacunas-aviso")).toBeVisible();

  const items = page.getByRole("dialog").locator("ol > li");
  const count = await items.count();
  expect(count).toBeGreaterThanOrEqual(2);
  for (let index = 0; index < count; index += 1) {
    await items.nth(index).getByRole("button").first().click();
  }
  await page.getByRole("button", { name: "Conferir respostas" }).click();
  await expect(page.getByText(/^\d+ de \d+ corretas$/)).toBeVisible();

  const sessions = await (await page.request.get("/api/reading-sessions")).json();
  expect(sessions.sessions).toHaveLength(1);
  expect(sessions.sessions[0].comprehension).not.toBeNull();
  expect(sessions.sessions[0].wordsRead).toBeGreaterThanOrEqual(800);
});

/** US-150: cartoes dos destaques, revisados antes de salvar e perguntados na revisao. */
test("cartoes criados dos destaques sao revisados e perguntam antes do trecho", async ({ page }) => {
  await registerByApi(page.request);
  const text = await createText(page.request, "Pescadora curta", PROSE);
  const mark = async (start: number, end: number) =>
    (
      await (
        await page.request.post(`/api/texts/${text.id}/destaques`, { data: { start, end } })
      ).json()
    ).id as string;
  const first = await mark(0, 10);
  const second = await mark(14, 24);

  // Menos de 3 destaques: o botao fica desativado, com o aviso.
  await page.goto(`/textos/${text.id}/destaques`);
  await expect(page.getByRole("button", { name: "Criar cartões" })).toBeDisabled();
  await expect(page.getByTestId("cartoes-minimo")).toHaveText("Destaque pelo menos 3 trechos.");

  const third = await mark(40, 52);
  let generated = 0;
  await page.route("**/api/texts/*/destaques/cartoes", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    generated += 1;
    await route.fulfill({
      json: {
        cards: [
          { highlightId: first, prompt: "Quando a pescadora saiu?", answer: "Cedo, com a cidade dormindo." },
          { highlightId: second, prompt: "O que ela carregava?", answer: "Uma rede remendada." },
          { highlightId: third, prompt: "O que mudou na travessia?", answer: "O vento." },
        ],
      },
    });
  });

  await page.reload();
  await page.getByRole("button", { name: "Criar cartões" }).click();
  await expect(page.getByTestId("cartao-rascunho")).toHaveCount(3);
  expect(generated).toBe(1);

  await page.getByLabel("Pergunta 1").fill("A que horas a pescadora saiu para o mar?");
  await page.getByTestId("cartao-rascunho").nth(1).getByRole("button", { name: "Descartar" }).click();
  await expect(page.getByTestId("cartao-rascunho")).toHaveCount(2);
  await page.getByRole("button", { name: "Salvar 2 cartões" }).click();
  await expect(page.getByText("2 cartões salvos.")).toBeVisible();
  await expect(page.getByTestId("destaque-cartao")).toHaveCount(2);
  await expect(page.getByTestId("destaque-cartao").first()).toContainText(
    "A que horas a pescadora saiu para o mar?"
  );

  // Vencidos hoje, o com cartao primeiro.
  await runSql("update highlights set created_at = now() - interval '3 days' where id = $1", [first]);
  await runSql(
    "update highlights set created_at = now() - interval '2 days' where id = any($1::uuid[])",
    [[second, third]]
  );

  await page.goto("/textos/destaques/revisar");
  const card = page.getByTestId("cartao-pergunta");
  await expect(card).toContainText("A que horas a pescadora saiu para o mar?");
  await expect(page.getByTestId("destaque-trecho")).toHaveCount(0);
  await page.getByRole("button", { name: "Mostrar a resposta" }).click();
  await expect(page.getByTestId("cartao-resposta")).toHaveText("Cedo, com a cidade dormindo.");
  await expect(page.getByTestId("destaque-trecho")).toContainText("A pescadora saiu cedo");
  await page.getByRole("button", { name: /^Bom/ }).click();

  // O descartado continua com a revisao de sempre, em lacuna.
  await expect(page.getByTestId("lacuna")).toHaveCount(1);
});
