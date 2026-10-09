import { expect, test } from "@playwright/test";
import { quizKey } from "../src/lib/quiz";
import { runSql } from "./db";
import { createText, openReader, randomIp, registerByApi } from "./helpers";

// O service worker do modo offline atenderia o fetch antes de `page.route`.
test.use({ serviceWorkers: "block" });

test.beforeEach(async ({ context }) => {
  await context.setExtraHTTPHeaders({ "x-forwarded-for": randomIp() });
});

/**
 * US-134 e US-135: o resultado explica a resposta e leva ao trecho da
 * evidencia. Sem chave de IA neste ambiente, as duas rotas do questionario sao
 * simuladas; a tela e o leitor sao os de verdade.
 */
test("pergunta errada explica a resposta e reabre o trecho da evidencia", async ({ page }) => {
  await registerByApi(page.request);
  const text = await createText(page.request, "Releitura", 300);

  const choices = ["Uma", "Duas", "Tres", "Quatro"];
  await page.route("**/questionario", (route) =>
    route.fulfill({
      json: {
        quiz: { questions: [0, 1, 2].map((n) => ({ prompt: `Pergunta ${n + 1}`, choices })) },
        questions: 3,
      },
    })
  );
  await page.route("**/questionario/respostas", (route) =>
    route.fulfill({
      json: {
        score: 67,
        results: [
          {
            prompt: "Pergunta 1",
            choices,
            answer: 1,
            given: 0,
            evidence: "ao ritmo das frases",
            rationale: "O texto diz que o ritmo das frases pede atenção.",
            position: { start: 19, end: 23 },
          },
          {
            prompt: "Pergunta 2",
            choices,
            answer: 0,
            given: 0,
            evidence: "leitura rapida",
            rationale: "Está no começo do texto.",
            position: { start: 0, end: 2 },
          },
          // Questionario antigo: sem justificativa nem posicao.
          { prompt: "Pergunta 3", choices, answer: 2, given: 1, evidence: "trecho perdido" },
        ],
      },
    })
  );

  await page.clock.install();
  await openReader(page, text.id);
  const counter = page.getByText(/^Página \d+ de \d+$/);
  await expect(counter).toBeVisible();
  const pages = Number((await counter.innerText()).match(/de (\d+)/)![1]);
  for (let turn = 0; turn < pages; turn += 1) {
    await page.clock.fastForward(40_000);
    await page.getByRole("button", { name: "Próxima página" }).click();
  }
  await expect(page.getByRole("heading", { name: "Leitura concluída" })).toBeVisible();

  await page.getByRole("button", { name: "Testar compreensão" }).click();
  await page.getByRole("button", { name: "Começar", exact: true }).click();
  for (let n = 0; n < 3; n += 1) {
    await page.getByRole("button", { name: "Uma", exact: true }).nth(n).click();
  }
  await page.getByRole("button", { name: "Conferir respostas" }).click();

  // Errada: explicacao aberta. Certa: recolhida. Antiga: sem campo vazio nem botao.
  await expect(page.getByTestId("explicacao")).toHaveText(
    "O texto diz que o ritmo das frases pede atenção."
  );
  await expect(page.getByText("Por que está certa")).toBeVisible();
  await expect(page.getByText("Está no começo do texto.")).toBeHidden();
  await expect(page.getByTestId("explicacao")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Reler o trecho" })).toHaveCount(1);

  await page.getByRole("button", { name: "Reler o trecho" }).click();
  const marked = page.locator('.mark[data-start="19"]');
  await expect(marked).toBeVisible();
  await expect(marked).toHaveText(/^ao ritmo das frases/);

  await page.getByRole("button", { name: "Voltar para onde parou" }).click();
  await expect(page.getByRole("heading", { name: "Leitura concluída" })).toBeVisible();
  // O resultado continua la, sem nova correcao.
  await expect(page.getByTestId("explicacao")).toBeVisible();
});

/** US-134, criterio 3: questionario antigo e localizado na correcao, sem o modelo. */
test("questionario gravado antes da entrega ganha a posicao na correcao", async ({ page }) => {
  await registerByApi(page.request);
  const text = await createText(page.request, "Antigo", 300);
  const detail = (await (await page.request.get(`/api/texts/${text.id}`)).json()).text as {
    content: string;
    language: string;
  };

  // Formato de antes: sem `rationale` nem `position`.
  const old = {
    questions: [
      { prompt: "P1", choices: ["a", "b", "c", "d"], answer: 1, evidence: "Ao ritmo das frases" },
      { prompt: "P2", choices: ["a", "b", "c", "d"], answer: 0, evidence: "nao existe no texto" },
      { prompt: "P3", choices: ["a", "b", "c", "d"], answer: 2, evidence: "" },
    ],
  };
  await runSql(
    "insert into comprehension_quizzes (text_id, content_key, questions) values ($1, $2, $3)",
    [text.id, quizKey(detail.content, detail.language), JSON.stringify(old)]
  );

  // A abertura nao entrega gabarito, justificativa nem posicao.
  const opened = await (await page.request.post(`/api/texts/${text.id}/questionario`)).json();
  expect(opened.quiz.questions[0]).toEqual({ prompt: "P1", choices: ["a", "b", "c", "d"] });

  const checked = await (
    await page.request.post(`/api/texts/${text.id}/questionario/respostas`, {
      data: { answers: [0, 0, 0] },
    })
  ).json();
  expect(checked.results[0].position).toEqual({ start: 5, end: 9 });
  expect(checked.results[0].rationale).toBeUndefined();
  expect(checked.results[1].position).toBeUndefined();
  expect(checked.results[2].position).toBeUndefined();
});
