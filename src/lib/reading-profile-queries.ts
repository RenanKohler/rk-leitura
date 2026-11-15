import "server-only";

import { and, desc, eq, inArray, isNotNull, sql, type SQLWrapper } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  comprehensionQuizzes,
  quizRecalls,
  readingSessions,
  reviewAnswers,
  savedWords,
  studyCards,
  texts,
} from "@/db/schema";
import { aiConfigured, aiConsent, aiParse, AiUnavailable, countWords, type AiMessages } from "@/lib/ai";
import { loadAiResult, saveAiResult } from "@/lib/ai-results";
import { readDailyUsage } from "@/lib/daily-quota";
import { todayIn } from "@/lib/goals";
import { loadSettings } from "@/lib/queries";
import { DAILY_QUOTAS } from "@/lib/quota";
import { parseQuiz } from "@/lib/quiz";
import { asTextFormat, parseParagraphs } from "@/lib/reading";
import {
  chooseWindow,
  clampProfile,
  LOW_QUIZ_PERCENT,
  MAX_DETAIL_WORDS,
  MAX_PATTERNS,
  MAX_SUGGESTION_WORDS,
  MAX_TITLE_WORDS,
  MIN_PATTERNS,
  missingData,
  monthBounds,
  previousMonth,
  PROFILE_ACTIONS,
  profileBase,
  profilePrompt,
  summarizeProfile,
  windowLabel,
  type ProfileInput,
  type ProfileReview,
  type ProfileSummary,
  type ProfileWindow,
  type StoredProfile,
} from "@/lib/reading-profile";

/**
 * Consultas e geracao do perfil de leitura do mes (US-234).
 *
 * Tudo filtrado pela conta e pelo dia no fuso do leitor, como as outras
 * telas. O pedido leva so numeros e ate 15 exemplos curtos (trechos em volta
 * dos freios, palavras consultadas, cartoes errados, enunciados de
 * questionarios com nota baixa): nunca o texto inteiro.
 */

/** Textos com freio carregados para recortar o trecho em volta. */
const MAX_BRAKE_TEXTS = 6;
/** Palavras consultadas lidas do periodo. */
const MAX_SAVED_WORDS = 40;
/** Questionarios de nota baixa e enunciados de cada um. */
const MAX_LOW_QUIZZES = 2;
const MAX_PROMPTS_PER_QUIZ = 3;

const MESSAGES: AiMessages = {
  notConfigured: "O perfil de leitura não está configurado nesta instalação.",
  refusal: "Não consigo montar o perfil de leitura deste mês.",
  failure: "Não consegui montar o perfil de leitura agora.",
};

const Schema = z.object({
  patterns: z
    .array(
      z.object({
        title: z
          .string()
          .describe(`O padrão em uma frase de até ${MAX_TITLE_WORDS} palavras, na segunda pessoa ("Você...").`),
        detail: z
          .string()
          .describe(`O que os números mostram, em até ${MAX_DETAIL_WORDS} palavras.`),
        example: z
          .string()
          .describe("Id de um exemplo (E1, E2...) ou de um fato (F1, F2...) recebido que mostra o padrão."),
        suggestion: z
          .string()
          .describe(`O que fazer no app, concreto, em até ${MAX_SUGGESTION_WORDS} palavras.`),
        action: z
          .enum(PROFILE_ACTIONS)
          .describe(
            "Onde fazer: treino (programa de treino de velocidade), velocidade (baixar ou subir o ppm nos ajustes), palavras (revisar palavras salvas), revisao (revisão do dia: cartões e destaques) ou nenhuma."
          ),
      })
    )
    .min(MIN_PATTERNS)
    .max(MAX_PATTERNS),
});

const SYSTEM = [
  "Você ajuda uma pessoa a entender o próprio jeito de ler, a partir dos dados de um mês no app de leitura dela.",
  `Recebe fatos numerados (F1, F2...) e exemplos numerados (E1, E2...). Aponte de ${MIN_PATTERNS} a ${MAX_PATTERNS} padrões`,
  "sobre que tipo de trecho trava a leitura e onde a compreensão cai, cada um com o id de um exemplo ou fato que o mostra",
  "e uma sugestão concreta do que fazer no app.",
  "Nos exemplos de freio, a palavra entre colchetes é onde a pessoa parou ou voltou; olhe o trecho em volta",
  "(frase longa, muitas vírgulas, termo técnico, número, nome próprio, negação, palavra rara).",
  "As notas de questionário são por questionário: não se sabe quais perguntas foram erradas, então não afirme isso;",
  "os enunciados são só amostra do tipo de pergunta.",
  "Use só o que está nos dados; com pouco sinal, diga menos. Português do Brasil, linguagem simples, tom neutro.",
  "Sem nota, sem elogio nem crítica, sem diagnóstico médico ou psicológico, sem falar em transtornos.",
].join(" ");

function inWindow(column: SQLWrapper, window: { from: string; to: string }, timezone: string) {
  const day = sql`to_char(${column} at time zone ${timezone}, 'YYYY-MM-DD')`;
  return and(sql`${day} >= ${window.from}`, sql`${day} < ${window.to}`);
}

interface Context {
  timezone: string;
  today: string;
}

async function context(userId: string): Promise<Context> {
  const timezone = (await loadSettings(userId))?.timezone ?? "UTC";
  return { timezone, today: todayIn(timezone) };
}

/** Janela do perfil: conta as sessoes do mes anterior para decidir. */
async function profileWindow(userId: string, ctx: Context): Promise<ProfileWindow> {
  const bounds = monthBounds(previousMonth(ctx.today));
  const [row] = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(readingSessions)
    .where(and(eq(readingSessions.userId, userId), inWindow(readingSessions.createdAt, bounds, ctx.timezone)));
  return chooseWindow(ctx.today, row?.value ?? 0);
}

/** Dados do periodo, ja no formato das funcoes puras. */
async function loadProfileInput(userId: string, window: ProfileWindow, timezone: string): Promise<ProfileInput> {
  const sessionRows = await db
    .select({
      textId: readingSessions.textId,
      wpm: readingSessions.wpm,
      wordsRead: readingSessions.wordsRead,
      durationMs: readingSessions.durationMs,
      mode: readingSessions.mode,
      comprehension: readingSessions.comprehension,
      brakes: readingSessions.brakes,
      createdAt: readingSessions.createdAt,
    })
    .from(readingSessions)
    .where(and(eq(readingSessions.userId, userId), inWindow(readingSessions.createdAt, window, timezone)))
    .orderBy(desc(readingSessions.createdAt));

  const textIds = [...new Set(sessionRows.map((row) => row.textId))];

  // Textos com mais freios primeiro: sao os que rendem exemplo.
  const brakeCount = new Map<string, number>();
  for (const row of sessionRows) {
    if (row.brakes && row.brakes.length > 0) {
      brakeCount.set(row.textId, (brakeCount.get(row.textId) ?? 0) + row.brakes.length);
    }
  }
  const brakeTextIds = [...brakeCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_BRAKE_TEXTS)
    .map(([id]) => id);

  // Questionarios de nota baixa: a menor nota de cada texto, os piores primeiro.
  const lowest = new Map<string, number>();
  for (const row of sessionRows) {
    if (row.comprehension === null || row.comprehension >= LOW_QUIZ_PERCENT) continue;
    lowest.set(row.textId, Math.min(lowest.get(row.textId) ?? 100, row.comprehension));
  }
  const lowTextIds = [...lowest.entries()]
    .sort((a, b) => a[1] - b[1])
    .slice(0, MAX_LOW_QUIZZES)
    .map(([id]) => id);

  const [completedRows, textRows, recallRows, wordRows, reviewRows, quizRows] = await Promise.all([
    textIds.length === 0
      ? []
      : db
          .select({
            textId: readingSessions.textId,
            first: sql<Date | string>`min(${readingSessions.createdAt})`,
          })
          .from(readingSessions)
          .where(
            and(
              eq(readingSessions.userId, userId),
              eq(readingSessions.completed, true),
              inArray(readingSessions.textId, textIds)
            )
          )
          .groupBy(readingSessions.textId),
    brakeTextIds.length + lowTextIds.length === 0
      ? []
      : db
          .select({ id: texts.id, title: texts.title, content: texts.content, format: texts.format })
          .from(texts)
          .where(and(eq(texts.userId, userId), inArray(texts.id, [...new Set([...brakeTextIds, ...lowTextIds])]))),
    db
      .select({ score: quizRecalls.score })
      .from(quizRecalls)
      .where(
        and(
          eq(quizRecalls.userId, userId),
          isNotNull(quizRecalls.score),
          inWindow(quizRecalls.createdAt, window, timezone)
        )
      ),
    db
      .select({ word: savedWords.word, context: savedWords.context })
      .from(savedWords)
      .where(and(eq(savedWords.userId, userId), inWindow(savedWords.createdAt, window, timezone)))
      .orderBy(desc(savedWords.createdAt))
      .limit(MAX_SAVED_WORDS),
    db
      .select({
        kind: reviewAnswers.kind,
        grade: reviewAnswers.grade,
        word: savedWords.word,
        front: studyCards.front,
      })
      .from(reviewAnswers)
      .leftJoin(
        savedWords,
        and(
          eq(reviewAnswers.kind, "palavra"),
          eq(savedWords.id, reviewAnswers.itemId),
          eq(savedWords.userId, userId)
        )
      )
      .leftJoin(
        studyCards,
        and(
          eq(reviewAnswers.kind, "cartao"),
          eq(studyCards.id, reviewAnswers.itemId),
          eq(studyCards.userId, userId)
        )
      )
      .where(and(eq(reviewAnswers.userId, userId), inWindow(reviewAnswers.createdAt, window, timezone)))
      .orderBy(desc(reviewAnswers.createdAt)),
    lowTextIds.length === 0
      ? []
      : db
          .select({
            textId: comprehensionQuizzes.textId,
            questions: comprehensionQuizzes.questions,
            createdAt: comprehensionQuizzes.createdAt,
          })
          .from(comprehensionQuizzes)
          // O questionario nao tem dono proprio: o texto diz de quem e.
          .innerJoin(texts, eq(texts.id, comprehensionQuizzes.textId))
          .where(and(eq(texts.userId, userId), inArray(comprehensionQuizzes.textId, lowTextIds)))
          .orderBy(desc(comprehensionQuizzes.createdAt)),
  ]);

  const titles = new Map(textRows.map((row) => [row.id, row.title]));
  const brakeSet = new Set(brakeTextIds);
  const parsedTexts: ProfileInput["texts"] = {};
  for (const row of textRows) {
    if (!brakeSet.has(row.id)) continue;
    parsedTexts[row.id] = {
      title: row.title,
      words: parseParagraphs(row.content, asTextFormat(row.format)).words,
    };
  }

  const firstCompleted: ProfileInput["firstCompleted"] = {};
  for (const row of completedRows) firstCompleted[row.textId] = new Date(row.first);

  // O questionario mais recente de cada texto: o que a pessoa respondeu.
  const lowQuizzes: ProfileInput["lowQuizzes"] = [];
  for (const textId of lowTextIds) {
    const row = quizRows.find((item) => item.textId === textId);
    const quiz = row ? parseQuiz(row.questions) : null;
    if (!quiz) continue;
    lowQuizzes.push({
      title: titles.get(textId) ?? "",
      score: lowest.get(textId) ?? 0,
      prompts: quiz.questions.slice(0, MAX_PROMPTS_PER_QUIZ).map((question) => question.prompt),
    });
  }

  return {
    sessions: sessionRows.map((row) => ({ ...row, createdAt: new Date(row.createdAt) })),
    firstCompleted,
    texts: parsedTexts,
    recalls: recallRows.flatMap((row) => (row.score === null ? [] : [row.score])),
    savedWords: wordRows,
    reviews: reviewRows.map(
      (row): ProfileReview => ({ kind: row.kind, grade: row.grade, label: row.word ?? row.front ?? null })
    ),
    lowQuizzes,
  };
}

export interface ReadingProfileState {
  /** Mes analisado ("AAAA-MM"). */
  month: string;
  /** "Leituras de outubro de 2026" ou "Leituras dos últimos 30 dias". */
  period: string;
  /** Perfil guardado do mes, ou null. */
  profile: StoredProfile | null;
  /** O que falta para gerar; vazio quando ha dado bastante. */
  missing: string[];
  /** Mostrar "Gerar perfil do mês". */
  canGenerate: boolean;
  /** Por que nao da para gerar, quando ha dado mas a IA nao esta disponivel. */
  unavailable: string | null;
}

async function storedFor(userId: string, month: string): Promise<StoredProfile | null> {
  const stored = await loadAiResult<StoredProfile>(userId, "perfil", month);
  return stored && Array.isArray(stored.patterns) ? stored : null;
}

/** O que o cartao mostra: o perfil guardado, o que falta, ou o botao. */
export async function readingProfileState(userId: string): Promise<ReadingProfileState> {
  const ctx = await context(userId);
  const month = previousMonth(ctx.today);
  const stored = await storedFor(userId, month);
  if (stored) {
    return {
      month,
      period: windowLabel(stored),
      profile: stored,
      missing: [],
      canGenerate: false,
      unavailable: null,
    };
  }

  const window = await profileWindow(userId, ctx);
  const summary = summarizeProfile(await loadProfileInput(userId, window, ctx.timezone));
  const missing = missingData(summary);
  let unavailable: string | null = null;
  if (missing.length === 0) {
    if (!aiConfigured()) unavailable = MESSAGES.notConfigured;
    else if ((await aiConsent(userId)) === "off") unavailable = "Os recursos de IA estão desligados nesta conta.";
    else if ((await readDailyUsage(userId)).used.resumo >= DAILY_QUOTAS.resumo) {
      unavailable = "Limite diário de resumos atingido. Volta a valer amanhã.";
    }
  }
  return {
    month,
    period: windowLabel(window),
    profile: null,
    missing,
    canGenerate: missing.length === 0 && unavailable === null,
    unavailable,
  };
}

/** Perfil guardado do mes analisado, ou null. */
export async function cachedReadingProfile(userId: string): Promise<StoredProfile | null> {
  const ctx = await context(userId);
  return storedFor(userId, previousMonth(ctx.today));
}

/** Dados do periodo e o que falta, sem chamar o modelo. */
export async function readingProfileSummary(
  userId: string
): Promise<{ window: ProfileWindow; summary: ProfileSummary; missing: string[] }> {
  const ctx = await context(userId);
  const window = await profileWindow(userId, ctx);
  const summary = summarizeProfile(await loadProfileInput(userId, window, ctx.timezone));
  return { window, summary, missing: missingData(summary) };
}

/** Gera e guarda o perfil do mes. Quem chama ja conferiu `missing`. */
export async function generateReadingProfile(
  userId: string,
  window: ProfileWindow,
  summary: ProfileSummary
): Promise<StoredProfile> {
  const prompt = profilePrompt(summary, window);
  const parsed = await aiParse({
    task: "perfil",
    userId,
    messages: MESSAGES,
    schema: Schema,
    system: SYSTEM,
    maxTokens: 2000,
    effort: "medium",
    timeoutMs: 40_000,
    // Dados de varios textos, nenhum deles "o" texto de origem.
    textId: null,
    wordsSent: countWords(prompt),
    content: [{ role: "user", content: prompt }],
  });

  const patterns = clampProfile(parsed, summary);
  if (!patterns) throw AiUnavailable.invalid(MESSAGES.failure);

  const profile: StoredProfile = {
    month: window.month,
    basis: window.basis,
    from: window.from,
    to: window.to,
    base: profileBase(summary),
    patterns,
    generatedAt: new Date().toISOString(),
  };
  await saveAiResult(userId, null, "perfil", window.month, profile);
  return profile;
}

