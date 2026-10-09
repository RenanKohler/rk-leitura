/**
 * Avaliacao das funcoes de IA sobre um conjunto fixo de textos (US-142).
 *
 *   npm run eval:ia
 *
 * Roda questionario, pergunta, explicacao, resumo, descricao de nomes e
 * sinopse sobre os casos de `tests/eval/casos/`, com os geradores reais de
 * `src/lib`, e verifica cada resposta com `tests/eval/checks.ts`. Rodar antes
 * de qualquer mudanca em `AI_MODELS` ou nos prompts. Gasta tokens de verdade:
 * por isso fica fora do `npm test` (o vitest so pega `tests/**\/*.test.ts`).
 *
 * Como roda fora do Next:
 * - `tsx --conditions=react-server`: os geradores importam `server-only`, que
 *   lanca ao ser importado fora do bundler. Com a condicao `react-server` o
 *   pacote resolve para o modulo vazio, como no servidor do Next. O apelido
 *   `@/` vem do tsconfig, que o tsx le sozinho.
 * - Banco: `.env.local` (DATABASE_URL e ANTHROPIC_API_KEY). Os geradores
 *   gravam o uso em `ai_usage` e a sinopse em `ai_results`, com chave
 *   estrangeira para conta e texto. Em vez de mudar o registro de uso para
 *   aceitar conta inexistente, a avaliacao usa uma conta local dedicada
 *   (`avaliacao-ia@rk-leitura.local`, sem senha valida para entrar), recria os
 *   textos dela a cada rodada e soma o custo das linhas de `ai_usage` gravadas
 *   na rodada, pelo mesmo `estimateCost` do relatorio do mantenedor.
 *
 * Sai com codigo 1 sem a chave, ou quando algum caso reprova.
 */
import "@/lib/load-env";

import { and, eq, gte } from "drizzle-orm";
import { db, getPool } from "@/db";
import { aiUsage, texts, users } from "@/db/schema";
import { aiConfigured, aiCreate, AiUnavailable, countWords, type AiMessages } from "@/lib/ai";
import { estimateCost } from "@/lib/ai-cost";
import { ASK_FAILURE, askExcerpt, askMessages, NO_ANSWER, readAnswer } from "@/lib/ask";
import { explainRequest } from "@/lib/explain";
import { explainSentence } from "@/lib/explain-generator";
import { DEFAULT_LANGUAGE, languageName } from "@/lib/language";
import { generateQuiz } from "@/lib/quiz-generator";
import { parseParagraphs } from "@/lib/reading";
import { buildNamesRequest, buildReadSummaryRequest } from "@/lib/summaries";
import { generateNameDescriptions, generateReadSummary } from "@/lib/summary-generator";
import { generateSynopsis } from "@/lib/synopsis-ai";
import {
  caseProblems,
  citationProblems,
  explanationProblems,
  forbiddenProblems,
  loadCases,
  quizProblems,
  readPosition,
  wordIndexOf,
  type EvalCase,
} from "./checks";

const EVAL_EMAIL = "avaliacao-ia@rk-leitura.local";

/**
 * Sistema da pergunta: a rota (`api/texts/[id]/pergunta`) o monta e nao o
 * exporta. Manter igual ao de la; quando a pergunta ganhar um gerador em
 * `src/lib`, chamar o gerador aqui.
 */
const ASK_MESSAGES: AiMessages = {
  notConfigured: "Perguntar ao texto não está configurado nesta instalação.",
  refusal: "Não consigo responder a esta pergunta.",
  failure: ASK_FAILURE,
};

function askSystem(language: string): string {
  const lines = [
    "Você responde perguntas de quem está lendo um texto, usando só o documento enviado: o trecho que a pessoa já leu.",
    "O documento termina onde a leitura parou. Não suponha nem antecipe o que vem depois.",
    "Responda em português do Brasil, em poucas frases, e cite os trechos do documento que sustentam cada afirmação.",
    `Quando o documento não responde à pergunta, responda exatamente: "${NO_ANSWER}"`,
  ];
  if (language !== DEFAULT_LANGUAGE) {
    lines.push(
      `O documento está em ${languageName(language).toLowerCase()}: a resposta continua em português, e as citações ficam no idioma original.`
    );
  }
  return lines.join(" ");
}

interface Outcome {
  caseId: string;
  check: string;
  problems: string[];
}

async function evalUser(): Promise<string> {
  const [found] = await db.select({ id: users.id }).from(users).where(eq(users.email, EVAL_EMAIL));
  if (found) return found.id;
  // Hash invalido de proposito: ninguem entra nesta conta.
  const [created] = await db
    .insert(users)
    .values({ email: EVAL_EMAIL, passwordHash: "!", name: "Avaliação de IA" })
    .returning({ id: users.id });
  return created!.id;
}

/** Roda uma verificacao; erro do modelo vira reprovacao com a mensagem. */
async function attempt(caseId: string, check: string, run: () => Promise<string[]>): Promise<Outcome> {
  try {
    return { caseId, check, problems: await run() };
  } catch (error) {
    const message =
      error instanceof AiUnavailable ? error.message : error instanceof Error ? error.message : String(error);
    return { caseId, check, problems: [`erro: ${message}`] };
  }
}

async function evaluate(userId: string, item: EvalCase): Promise<Outcome[]> {
  const [text] = await db
    .insert(texts)
    .values({
      userId,
      title: item.title,
      content: item.content,
      language: item.language,
      wordCount: countWords(item.content),
    })
    .returning({ id: texts.id });
  const textId = text!.id;
  const { words, paragraphs } = parseParagraphs(item.content);
  const position = readPosition(item);
  const foreign = item.language !== DEFAULT_LANGUAGE;

  return Promise.all([
    attempt(item.id, "questionario", async () => {
      const quiz = await generateQuiz(userId, item.title, item.content, item.language);
      return quizProblems(quiz, item.content);
    }),

    attempt(item.id, "pergunta", async () => {
      // Mesmo recorte da rota: ate a palavra da posicao, inclusive.
      const excerpt = askExcerpt(paragraphs, position - 1);
      const response = await aiCreate({
        task: "pergunta",
        userId,
        textId,
        wordsSent: countWords(excerpt.text),
        messages: ASK_MESSAGES,
        system: askSystem(item.language),
        maxTokens: 4000,
        effort: "medium",
        timeoutMs: 75_000,
        content: askMessages(excerpt, item.title, [], item.question),
      });
      return citationProblems(readAnswer(response.content, excerpt), excerpt);
    }),

    attempt(item.id, "explicacao", async () => {
      const request = explainRequest(
        words,
        paragraphs,
        wordIndexOf(item.content, item.explain),
        item.language
      );
      if (!request) return ["frase não encontrada"];
      return explanationProblems(await explainSentence(userId, request, item.language), foreign);
    }),

    attempt(item.id, "resumo", async () => {
      const request = buildReadSummaryRequest({
        title: item.title,
        paragraphs,
        position,
        language: item.language,
      });
      const points = await generateReadSummary(userId, textId, request);
      return forbiddenProblems(points.join("\n"), item.afterPosition);
    }),

    attempt(item.id, "nomes", async () => {
      // Como `namesToDescribe`: so vai o nome que ja apareceu antes da posicao.
      const sent = item.names.filter((name) => {
        const at = wordIndexOf(item.content, name);
        return at !== -1 && at < position;
      });
      const request = buildNamesRequest({
        title: item.title,
        paragraphs,
        position,
        names: sent,
        language: item.language,
      });
      const descriptions = await generateNameDescriptions(userId, textId, request, item.names, sent);
      const leaked = item.names.filter((name) => !sent.includes(name) && descriptions[name]);
      return [
        ...forbiddenProblems(Object.values(descriptions).filter(Boolean).join("\n"), item.afterPosition),
        ...leaked.map((name) => `descreveu "${name}", que não foi enviado`),
      ];
    }),

    attempt(item.id, "sinopse", async () => {
      const synopsis = await generateSynopsis(userId, textId, item.title, item.content);
      return forbiddenProblems(synopsis, item.afterPosition);
    }),
  ]);
}

async function main(): Promise<number> {
  if (!aiConfigured()) {
    console.error("Defina ANTHROPIC_API_KEY para rodar a avaliação.");
    return 1;
  }

  const cases = loadCases();
  const invalid = cases.flatMap((item) => caseProblems(item).map((problem) => `${item.id}: ${problem}`));
  if (invalid.length > 0) {
    console.error(`Casos inválidos:\n${invalid.join("\n")}`);
    return 1;
  }

  const userId = await evalUser();
  // Textos da rodada anterior saem; o uso fica, para comparar rodadas.
  await db.delete(texts).where(eq(texts.userId, userId));
  const startedAt = new Date();

  const outcomes: Outcome[] = [];
  for (const item of cases) {
    console.log(`\n${item.id} (${item.language})`);
    for (const outcome of await evaluate(userId, item)) {
      outcomes.push(outcome);
      const status = outcome.problems.length === 0 ? "ok" : "FALHOU";
      console.log(`  ${status.padEnd(6)} ${outcome.check}`);
      for (const problem of outcome.problems) console.log(`         - ${problem}`);
    }
  }

  const rows = await db
    .select()
    .from(aiUsage)
    .where(and(eq(aiUsage.userId, userId), gte(aiUsage.createdAt, startedAt)));
  const cost = rows.reduce((sum, row) => sum + estimateCost(row), 0);

  const failed = outcomes.filter((outcome) => outcome.problems.length > 0).length;
  console.log(
    `\n${outcomes.length - failed} aprovados, ${failed} reprovados, de ${outcomes.length} verificações em ${cases.length} textos.`
  );
  console.log(`Custo estimado da rodada: US$ ${cost.toFixed(4)} em ${rows.length} chamadas.`);
  return failed > 0 ? 1 : 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    // O pool so existe se alguma consulta abriu conexao.
    if ((globalThis as { __rkLeituraPool?: unknown }).__rkLeituraPool) void getPool().end();
  });
