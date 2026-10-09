import "server-only";

import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { highlights, readingSessions, texts } from "@/db/schema";
import { aiConfigured, aiConsent, aiParse, AiUnavailable, countWords, type AiMessages } from "@/lib/ai";
import { loadAiResult, saveAiResult } from "@/lib/ai-results";
import { readDailyUsage } from "@/lib/daily-quota";
import { mondayOf, todayIn } from "@/lib/goals";
import { excerptOf } from "@/lib/highlights";
import { loadSettings } from "@/lib/queries";
import { DAILY_QUOTAS } from "@/lib/quota";
import { asTextFormat, parseParagraphs } from "@/lib/reading";
import { synopsesFor } from "@/lib/synopsis-ai";
import {
  canOfferWeekIdeas,
  clampIdeas,
  MAX_IDEAS_WORDS,
  MAX_WEEK_TEXTS,
  shiftDay,
  weekIdeasKey,
  weekIdeasPrompt,
  type WeekText,
} from "@/lib/week-ideas";

/**
 * Ideias da semana no cartao do resumo semanal (US-154).
 *
 * A semana e a mesma do cartao: a anterior a corrente, no fuso da conta. O
 * paragrafo fica guardado com a segunda-feira na chave, entao reabrir o
 * cartao na mesma semana nao gera chamada.
 */

const MESSAGES: AiMessages = {
  notConfigured: "As ideias da semana não estão configuradas nesta instalação.",
  refusal: "Não consigo resumir as ideias desta semana.",
  failure: "Não consegui reunir as ideias da semana agora.",
};

interface StoredIdeas {
  paragraph: string;
}

const Schema = z.object({
  paragraph: z
    .string()
    .describe(`Um parágrafo de até ${MAX_IDEAS_WORDS} palavras, em português do Brasil.`),
});

const SYSTEM = [
  "Você ajuda uma pessoa a relembrar o que leu na semana.",
  "Recebe, de cada texto lido, o título e, quando houver, a sinopse e os trechos que ela destacou.",
  `Escreva um único parágrafo de até ${MAX_IDEAS_WORDS} palavras, em português do Brasil, com as ideias principais`,
  "e, quando houver, o que liga os textos entre si.",
  "Cite cada texto pelo título, entre aspas, exatamente como recebido.",
  "Use só o que está nas sinopses e nos destaques: não invente o conteúdo de um texto que veio só com o título,",
  "nesse caso apenas mencione que ele foi lido. Sem listas e sem títulos.",
].join(" ");

interface Week {
  monday: string;
  next: string;
  timezone: string;
}

async function lastWeek(userId: string): Promise<Week> {
  const timezone = (await loadSettings(userId))?.timezone ?? "UTC";
  const thisMonday = mondayOf(todayIn(timezone));
  return { monday: shiftDay(thisMonday, -7), next: thisMonday, timezone };
}

function inWeek(column: typeof readingSessions.createdAt | typeof highlights.createdAt, week: Week) {
  return and(
    sql`to_char(${column} at time zone ${week.timezone}, 'YYYY-MM-DD') >= ${week.monday}`,
    sql`to_char(${column} at time zone ${week.timezone}, 'YYYY-MM-DD') < ${week.next}`
  );
}

/** Textos lidos na semana, dos mais lidos aos menos. */
async function readTextIds(userId: string, week: Week): Promise<string[]> {
  const rows = await db
    .select({
      textId: readingSessions.textId,
      words: sql<number>`sum(${readingSessions.wordsRead})::int`,
    })
    .from(readingSessions)
    .where(
      and(
        eq(readingSessions.userId, userId),
        gt(readingSessions.wordsRead, 0),
        inWeek(readingSessions.createdAt, week)
      )
    )
    .groupBy(readingSessions.textId);
  return rows.sort((a, b) => b.words - a.words).map((row) => row.textId);
}

/**
 * Material do pedido: titulo, sinopse guardada e destaques da semana. O
 * conteudo e lido aqui so para recortar os destaques; ele nao vai ao modelo.
 */
async function weekMaterial(userId: string, ids: string[], week: Week): Promise<WeekText[]> {
  const chosen = ids.slice(0, MAX_WEEK_TEXTS);
  const [rows, synopses, marks] = await Promise.all([
    db
      .select({ id: texts.id, title: texts.title, content: texts.content, format: texts.format })
      .from(texts)
      .where(and(eq(texts.userId, userId), inArray(texts.id, chosen))),
    synopsesFor(chosen),
    db
      .select({ textId: highlights.textId, start: highlights.startIndex, end: highlights.endIndex })
      .from(highlights)
      .where(
        and(
          eq(highlights.userId, userId),
          inArray(highlights.textId, chosen),
          inWeek(highlights.createdAt, week)
        )
      )
      .orderBy(asc(highlights.startIndex)),
  ]);

  const byId = new Map(rows.map((row) => [row.id, row]));
  return chosen.flatMap((id) => {
    const row = byId.get(id);
    if (!row) return [];
    const own = marks.filter((mark) => mark.textId === id);
    const words =
      own.length > 0 ? parseParagraphs(row.content, asTextFormat(row.format)).words : [];
    return [
      {
        title: row.title,
        synopsis: synopses.get(id) ?? null,
        highlights: own.map((mark) => excerptOf(words, mark.start, mark.end)).filter(Boolean),
      },
    ];
  });
}

export interface WeekIdeasState {
  /** Mostrar "Ver as ideias da semana". */
  available: boolean;
  /** Paragrafo ja guardado para a semana, ou null. */
  ideas: string | null;
}

/** O que o cartao mostra: o botao e, se ja existe, o paragrafo guardado. */
export async function weekIdeasState(userId: string): Promise<WeekIdeasState> {
  const week = await lastWeek(userId);
  const [ids, stored] = await Promise.all([
    readTextIds(userId, week),
    loadAiResult<StoredIdeas>(userId, "semana", weekIdeasKey(week.monday)),
  ]);
  const configured = aiConfigured();
  const consent = configured ? await aiConsent(userId) : "pending";
  const quotaLeft =
    configured && consent === "on" && !stored
      ? (await readDailyUsage(userId)).used.resumo < DAILY_QUOTAS.resumo
      : false;
  const available = canOfferWeekIdeas({
    readTexts: ids.length,
    configured,
    consent,
    quotaLeft,
    cached: Boolean(stored),
  });
  return { available, ideas: available ? (stored?.paragraph ?? null) : null };
}

/** Paragrafo guardado da semana, ou null. */
export async function cachedWeekIdeas(userId: string): Promise<string | null> {
  const week = await lastWeek(userId);
  const stored = await loadAiResult<StoredIdeas>(userId, "semana", weekIdeasKey(week.monday));
  return stored?.paragraph ?? null;
}

/** Quantos textos foram lidos na semana do cartao. */
export async function weekReadCount(userId: string): Promise<number> {
  return (await readTextIds(userId, await lastWeek(userId))).length;
}

/** Gera e guarda o paragrafo da semana. */
export async function generateWeekIdeas(userId: string): Promise<string> {
  const week = await lastWeek(userId);
  const ids = await readTextIds(userId, week);
  const material = await weekMaterial(userId, ids, week);
  const prompt = weekIdeasPrompt(material);

  const parsed = await aiParse({
    task: "semana",
    userId,
    messages: MESSAGES,
    schema: Schema,
    system: SYSTEM,
    maxTokens: 1500,
    effort: "low",
    timeoutMs: 30_000,
    // Pelo menos dois textos: nenhum deles e "o" texto de origem.
    textId: null,
    wordsSent: countWords(prompt),
    content: [{ role: "user", content: prompt }],
  });

  const paragraph = clampIdeas(parsed?.paragraph);
  if (!paragraph) throw new AiUnavailable(MESSAGES.failure);

  await saveAiResult(userId, null, "semana", weekIdeasKey(week.monday), {
    paragraph,
  } satisfies StoredIdeas);
  return paragraph;
}
