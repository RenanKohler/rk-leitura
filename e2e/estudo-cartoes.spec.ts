import { expect, test, type Page } from "@playwright/test";
import { runSql } from "./db";
import { createText, openReader, randomIp, registerByApi, updateSettings } from "./helpers";

// O service worker do modo offline atenderia o fetch antes de `page.route`.
test.use({ serviceWorkers: "block" });

test.beforeEach(async ({ context, page }) => {
  await context.setExtraHTTPHeaders({ "x-forwarded-for": randomIp() });
  await page.emulateMedia({ reducedMotion: "reduce" });
});

async function setProgress(textId: string, progress: number) {
  await runSql("update texts set progress_index = $2 where id = $1", [textId, progress]);
}

/** Cartao gravado direto no banco, com o trecho de origem `[start, end)`. */
async function insertCard(textId: string, front: string, back: string, start: number, end: number) {
  await runSql(
    `insert into study_cards (user_id, text_id, front, back, kind, source_start, source_end)
     select user_id, id, $2, $3, 'ponto', $4, $5 from texts where id = $1`,
    [textId, front, back, start, end]
  );
}

async function mockGeneration(page: Page, cards: unknown[], bodies: unknown[] = []) {
  await page.route("**/api/texts/*/cartoes-estudo/gerar", async (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({ json: { available: true, reason: null } });
    }
    bodies.push(route.request().postDataJSON());
    return route.fulfill({ json: { cards } });
  });
}

const draft = (front: string, start: number, end: number, kind = "ponto") => ({
  front,
  back: `Verso de ${front}`,
  kind,
  sourceStart: start,
  sourceEnd: end,
  passage: `Trecho de ${front}`,
});

/** US-155 e US-157: gerar, revisar so os de trechos lidos e salvar todos. */
test("cartoes gerados do texto inteiro so aparecem quando o trecho ja foi lido", async ({ page }) => {
  await registerByApi(page.request);
  await updateSettings(page.request, { aiEnabled: true });
  const text = await createText(page.request, "Ensaio de estudo", 400);
  await setProgress(text.id, 99);

  const bodies: unknown[] = [];
  await mockGeneration(
    page,
    [
      draft("Primeira pergunta?", 0, 10),
      draft("Segunda pergunta?", 20, 30, "conceito"),
      draft("Terceira pergunta?", 90, 100),
      draft("Pergunta do fim?", 300, 320),
      draft("Pergunta do meio?", 150, 160),
    ],
    bodies
  );

  await page.goto(`/textos/${text.id}/estudar`);
  await expect(page.getByTestId("cartoes-estudo-contagem")).toHaveText("Nenhum cartão de trecho já lido.");
  await page.getByRole("radio", { name: "Lacuna" }).click();
  await page.getByRole("button", { name: "Criar cartões de estudo" }).click();

  await expect(page.getByTestId("cartao-estudo-rascunho")).toHaveCount(3);
  expect(bodies).toEqual([{ tipo: "lacuna" }]);
  await expect(page.getByTestId("rascunhos-nao-lidos")).toContainText(
    "2 cartões de trechos ainda não lidos"
  );
  await expect(page.getByText("Pergunta do fim?")).toHaveCount(0);

  await page.getByLabel("Frente 1").fill("Primeira pergunta, editada?");
  await page
    .getByTestId("cartao-estudo-rascunho")
    .nth(1)
    .getByRole("button", { name: "Descartar" })
    .click();
  await expect(page.getByTestId("cartao-estudo-rascunho")).toHaveCount(2);
  await page.getByRole("button", { name: "Salvar cartões" }).click();
  await expect(page.getByText("4 cartões salvos.")).toBeVisible();

  await expect(page.getByTestId("cartao-estudo")).toHaveCount(2);
  await expect(page.getByTestId("cartao-estudo").first()).toContainText("Primeira pergunta, editada?");
  await expect(page.getByTestId("cartoes-estudo-contagem")).toHaveText(
    "2 cartões de trechos já lidos · 2 cartões de trechos ainda não lidos"
  );
  await expect(page.getByText("Pergunta do meio?")).toHaveCount(0);

  // Gravados sem data de revisao; os nao lidos so saem pelo teste previo.
  const list = await (await page.request.get(`/api/texts/${text.id}/cartoes-estudo`)).json();
  expect(list.cards.map((card: { nextReviewOn: string | null }) => card.nextReviewOn)).toEqual([null, null]);
  const pretest = await (await page.request.get(`/api/texts/${text.id}/cartoes-estudo?previo=1`)).json();
  expect(pretest.cards.map((card: { front: string }) => card.front)).toEqual([
    "Pergunta do meio?",
    "Pergunta do fim?",
  ]);

  // A leitura avancou: o cartao do meio passa a aparecer, sem nova geracao.
  await setProgress(text.id, 170);
  await page.reload();
  await expect(page.getByTestId("cartao-estudo")).toHaveCount(3);

  // Descartar todos nao salva nada.
  await page.getByRole("button", { name: "Criar cartões de estudo" }).click();
  await page.getByRole("button", { name: "Descartar todos" }).click();
  await expect(page.getByRole("button", { name: "Salvar cartões" })).toBeDisabled();
  await page.getByRole("button", { name: "Cancelar" }).click();
  await expect(page.getByTestId("cartao-estudo")).toHaveCount(3);
});

/** US-155 (indisponivel), US-159 e US-160. */
test("sem IA, o cartao a mao continua e a exportacao leva so os lidos", async ({ page }) => {
  await registerByApi(page.request);
  const short = await createText(page.request, "Curto", 120);
  await page.goto(`/textos/${short.id}/estudar`);
  await expect(page.getByRole("button", { name: "Criar cartões de estudo" })).toBeDisabled();
  await expect(page.getByTestId("cartoes-estudo-motivo")).toHaveText(
    "O texto precisa ter pelo menos 300 palavras."
  );

  const text = await createText(page.request, "Memórias do estudo", 400);
  await page.route("**/api/texts/*/cartoes-estudo/gerar", (route) =>
    route.fulfill({
      json: { available: false, reason: "Limite diário de recursos de estudo atingido. Volta a valer amanhã." },
    })
  );
  await page.goto(`/textos/${text.id}/estudar`);
  await expect(page.getByRole("button", { name: "Criar cartões de estudo" })).toBeDisabled();
  await expect(page.getByTestId("cartoes-estudo-motivo")).toHaveText(
    "Limite diário de recursos de estudo atingido. Volta a valer amanhã."
  );
  await expect(page.getByRole("button", { name: "Exportar para o Anki" })).toBeDisabled();
  await expect(page.getByTestId("exportar-aviso")).toHaveText("Nenhum cartão para exportar.");
  await expect(page.getByRole("button", { name: "Testar conhecimento prévio" })).toBeDisabled();
  await expect(page.getByTestId("previo-aviso")).toHaveText("Nenhum cartão de trecho não lido.");

  // Cartao a mao: validacao e vencimento no dia seguinte.
  await page.getByRole("button", { name: "Novo cartão" }).click();
  const form = page.getByTestId("cartao-novo");
  await form.getByLabel("Frente").fill("O que é memória de trabalho?");
  await form.getByRole("button", { name: "Salvar cartão" }).click();
  await expect(form.getByRole("alert")).toHaveText("Preencha a frente e o verso.");
  await form.getByLabel("Verso").fill("x".repeat(501));
  await form.getByRole("button", { name: "Salvar cartão" }).click();
  await expect(form.getByRole("alert")).toHaveText("Use até 500 caracteres em cada lado.");
  await form.getByLabel("Verso").fill("A memória\tde curto\nprazo usada para pensar.");
  await form.getByRole("button", { name: "Salvar cartão" }).click();
  await expect(page.getByText("Cartão salvo.")).toBeVisible();
  await expect(page.getByTestId("cartao-estudo")).toHaveCount(1);

  const list = await (await page.request.get(`/api/texts/${text.id}/cartoes-estudo`)).json();
  // Amanha no fuso da conta (o app grava o do navegador), nao no do servidor.
  const tomorrow = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(
    new Date(Date.now() + 86_400_000)
  );
  expect(list.cards[0].nextReviewOn).toBe(tomorrow);
  expect(list.cards[0].kind).toBe("manual");

  // Um cartao de trecho nao lido fica fora da exportacao.
  await insertCard(text.id, "Do fim?", "Resposta do fim.", 380, 390);
  await page.reload();
  const link = page.getByRole("link", { name: "Exportar para o Anki" });
  await expect(link).toHaveAttribute("href", `/api/cartoes/exportar?texto=${text.id}`);
  const response = await page.request.get(`/api/cartoes/exportar?texto=${text.id}`);
  expect(response.headers()["content-disposition"]).toContain("cartoes-memorias-do-estudo.txt");
  const body = await response.text();
  expect(body.split("\n")).toEqual([
    "#separator:tab",
    "#html:false",
    "#tags column:3",
    "O que é memória de trabalho?\tA memória de curto prazo usada para pensar.\tMemórias_do_estudo",
    "",
  ]);
  const all = await (await page.request.get("/api/cartoes/exportar")).text();
  expect(all).not.toContain("Do fim?");
});

/** US-170: teste de conhecimento previo, fora da revisao. */
test("teste de conhecimento previo mostra so os nao lidos e resume no fim", async ({ page }) => {
  await registerByApi(page.request);
  const text = await createText(page.request, "Previo", 400);
  await setProgress(text.id, 50);
  await insertCard(text.id, "Já lido?", "Sim.", 10, 20);
  await insertCard(text.id, "O que vem depois?", "Uma virada.", 200, 210);
  await insertCard(text.id, "Como termina?", "Em paz.", 380, 395);

  // Entrada pelo leitor: "Navegar no texto" > "Estudar este texto".
  await openReader(page, text.id);
  await page.getByRole("button", { name: "Navegar no texto" }).click();
  await page.getByRole("link", { name: "Estudar este texto" }).click();
  await expect(page).toHaveURL(`/textos/${text.id}/estudar`);
  await expect(page.getByTestId("cartoes-estudo-contagem")).toHaveText(
    "1 cartão de trecho já lido · 2 cartões de trechos ainda não lidos"
  );
  await page.getByRole("button", { name: "Testar conhecimento prévio" }).click();
  await expect(page.getByText("Estes cartões são de partes que você ainda não leu.")).toBeVisible();
  await expect(page.getByTestId("previo-frente")).toHaveText("O que vem depois?");
  await page.getByRole("button", { name: "Mostrar resposta" }).click();
  await expect(page.getByTestId("previo-verso")).toHaveText("Uma virada.");
  await page.getByRole("button", { name: "Já sabia" }).click();
  await expect(page.getByTestId("previo-frente")).toHaveText("Como termina?");
  await page.getByRole("button", { name: "Mostrar resposta" }).click();
  await page.getByRole("button", { name: "Não sabia" }).click();
  await expect(page.getByTestId("previo-resumo")).toContainText("Você já sabia 1 de 2 (50%).");

  const pretest = await (await page.request.get(`/api/texts/${text.id}/cartoes-estudo?previo=1`)).json();
  expect(
    pretest.cards.map((card: { pretest: string; nextReviewOn: string | null }) => [card.pretest, card.nextReviewOn])
  ).toEqual([
    ["sabia", null],
    ["nao_sabia", null],
  ]);
  await page.getByRole("button", { name: "Concluir" }).click();
  await expect(page.getByTestId("cartao-estudo")).toHaveCount(1);
});
