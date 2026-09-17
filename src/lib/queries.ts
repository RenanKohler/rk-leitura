import "server-only";

import { and, count, desc, eq, gt, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { readingSessions, speedSettings, texts } from "@/db/schema";
import { DEFAULT_PAGE_SIZE } from "@/lib/api";
import type {
  ContinueReading,
  DashboardStats,
  SessionSummary,
  SettingsPayload,
  TextDetail,
  TextSummary,
} from "@/lib/types";

/**
 * Consultas de leitura usadas tanto pelas rotas de API quanto pelos
 * componentes de servidor.
 *
 * As telas passaram a receber os dados ja renderizados no HTML. Sem uma fonte
 * comum, a mesma consulta existiria duas vezes e sairia do lugar na primeira
 * mudanca de schema.
 */

export const DEFAULT_SETTINGS: SettingsPayload = {
  baseWpm: 300,
  wordsPerChunk: 1,
  highlightOpacity: 0.35,
  readingMode: "rsvp",
  theme: "system",
};

export interface Page<T> {
  total: number;
  page: number;
  perPage: number;
  pageCount: number;
  items: T[];
}

function meta(total: number, page: number, perPage: number) {
  return { total, page, perPage, pageCount: Math.max(1, Math.ceil(total / perPage)) };
}

/**
 * Datas viram texto ISO aqui.
 *
 * O banco devolve Date; uma rota de API entregaria esse valor ja convertido
 * pelo JSON, mas um componente de servidor o passaria como Date. Normalizar
 * na consulta garante que a tela receba sempre a mesma forma, venha o dado
 * por qual caminho vier.
 */
function isoDate(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

export async function loadSettings(userId: string): Promise<SettingsPayload> {
  const [row] = await db
    .select()
    .from(speedSettings)
    .where(eq(speedSettings.userId, userId))
    .limit(1);

  if (!row) return DEFAULT_SETTINGS;

  return {
    baseWpm: row.baseWpm,
    wordsPerChunk: row.wordsPerChunk,
    highlightOpacity: row.highlightOpacity,
    readingMode: row.readingMode as SettingsPayload["readingMode"],
    theme: row.theme as SettingsPayload["theme"],
  };
}

export async function loadTexts(
  userId: string,
  page = 1,
  perPage = DEFAULT_PAGE_SIZE
): Promise<Page<TextSummary>> {
  const offset = (page - 1) * perPage;

  const [items, [totals]] = await Promise.all([
    // Lista sem o campo content: uma biblioteca com 50 artigos traria
    // megabytes de texto que a tela nao usa.
    db
      .select({
        id: texts.id,
        title: texts.title,
        sourceUrl: texts.sourceUrl,
        wordCount: texts.wordCount,
        progressIndex: texts.progressIndex,
        createdAt: texts.createdAt,
        updatedAt: texts.updatedAt,
      })
      .from(texts)
      .where(eq(texts.userId, userId))
      .orderBy(desc(texts.createdAt))
      .limit(perPage)
      .offset(offset),
    db.select({ value: count() }).from(texts).where(eq(texts.userId, userId)),
  ]);

  const rows: TextSummary[] = items.map((item) => ({
    ...item,
    createdAt: isoDate(item.createdAt),
    updatedAt: isoDate(item.updatedAt),
  }));

  return { items: rows, ...meta(totals?.value ?? 0, page, perPage) };
}

export async function loadSessions(
  userId: string,
  page = 1,
  perPage = DEFAULT_PAGE_SIZE
): Promise<Page<SessionSummary>> {
  const offset = (page - 1) * perPage;

  const [items, [totals]] = await Promise.all([
    // Junta o titulo aqui: a tela de historico buscava todos os textos so para
    // resolver o nome de cada sessao no cliente.
    db
      .select({
        id: readingSessions.id,
        textId: readingSessions.textId,
        textTitle: texts.title,
        wpm: readingSessions.wpm,
        wordsRead: readingSessions.wordsRead,
        durationMs: readingSessions.durationMs,
        completed: readingSessions.completed,
        createdAt: readingSessions.createdAt,
      })
      .from(readingSessions)
      .innerJoin(texts, eq(texts.id, readingSessions.textId))
      .where(eq(readingSessions.userId, userId))
      .orderBy(desc(readingSessions.createdAt))
      .limit(perPage)
      .offset(offset),
    db
      .select({ value: count() })
      .from(readingSessions)
      .where(eq(readingSessions.userId, userId)),
  ]);

  const rows: SessionSummary[] = items.map((item) => ({
    ...item,
    createdAt: isoDate(item.createdAt),
  }));

  return { items: rows, ...meta(totals?.value ?? 0, page, perPage) };
}

export async function loadOverview(
  userId: string
): Promise<{ stats: DashboardStats; continueReading: ContinueReading | null }> {
  const [[totals], [textTotals], [continueReading]] = await Promise.all([
    db
      .select({
        sessions: count(),
        wordsRead: sql<number>`coalesce(sum(${readingSessions.wordsRead}), 0)`.mapWith(Number),
        avgWpm: sql<number>`coalesce(round(avg(${readingSessions.wpm})), 0)`.mapWith(Number),
        bestWpm: sql<number>`coalesce(max(${readingSessions.wpm}), 0)`.mapWith(Number),
      })
      .from(readingSessions)
      .where(eq(readingSessions.userId, userId)),

    db.select({ texts: count() }).from(texts).where(eq(texts.userId, userId)),

    // Leitura em andamento mais recente: comecada e ainda nao terminada.
    db
      .select({
        id: texts.id,
        title: texts.title,
        wordCount: texts.wordCount,
        progressIndex: texts.progressIndex,
      })
      .from(texts)
      .where(
        and(
          eq(texts.userId, userId),
          gt(texts.progressIndex, 0),
          lt(texts.progressIndex, texts.wordCount)
        )
      )
      .orderBy(desc(texts.updatedAt))
      .limit(1),
  ]);

  return {
    stats: {
      texts: textTotals?.texts ?? 0,
      sessions: totals?.sessions ?? 0,
      wordsRead: totals?.wordsRead ?? 0,
      avgWpm: totals?.avgWpm ?? 0,
      bestWpm: totals?.bestWpm ?? 0,
    },
    continueReading: continueReading ?? null,
  };
}

export async function loadText(userId: string, id: string): Promise<TextDetail | null> {
  const [text] = await db
    .select()
    .from(texts)
    .where(and(eq(texts.id, id), eq(texts.userId, userId)))
    .limit(1);

  if (!text) return null;

  return {
    id: text.id,
    title: text.title,
    sourceUrl: text.sourceUrl,
    content: text.content,
    wordCount: text.wordCount,
    progressIndex: text.progressIndex,
    sourcePage: text.sourcePage,
    createdAt: isoDate(text.createdAt),
    updatedAt: isoDate(text.updatedAt),
  };
}
