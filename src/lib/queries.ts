import "server-only";

import { cache } from "react";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lt,
  sql,
  type SQL,
} from "drizzle-orm";
import { db } from "@/db";
import {
  highlights,
  readingGoals,
  readingSessions,
  savedWords,
  seriesFollows,
  speedSettings,
  tags,
  texts,
  textTags,
  trainingDays,
  trainingPrograms,
  users,
} from "@/db/schema";
import { DEFAULT_PAGE_SIZE } from "@/lib/api";
import { asFontFamily, parseParagraphs } from "@/lib/reading";
import { excerptOf } from "@/lib/highlights";
import { MAX_SAVED_WORDS } from "@/lib/dictionary";
import { tagKey } from "@/lib/tags";
import { cleanTitle, nextChapterUrl } from "@/lib/series";
import { REVIEW_SESSION_SIZE } from "@/lib/vocabulary";
import { asProgramLength, programStatus, type ProgramStatus } from "@/lib/training";
import {
  asGoalKind,
  asTimezone,
  computeStreak,
  goalOn,
  mondayOf,
  progressFor,
  todayIn,
  type DayTotals,
  type Goal,
} from "@/lib/goals";
import {
  ACCENTED,
  DEFAULT_SCOPE,
  DEFAULT_STATUS,
  escapeLike,
  UNACCENTED,
  type TextScope,
  type TextStatus,
} from "@/lib/text-filter";
import type {
  ContinueReading,
  DashboardStats,
  GoalStatus,
  HighlightItem,
  LibraryItem,
  NextUp,
  ReviewSession,
  SavedWordItem,
  SessionSummary,
  SettingsPayload,
  TagSummary,
  TextDetail,
  TextSummary,
  WeeklySummary,
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
  fontScale: 3,
  fontFamily: "sans",
  lineHeightStep: 2,
  warmup: true,
  wordEmphasis: false,
  timezone: "UTC",
  weeklySummarySeenOn: null,
  placementWpm: null,
  placementSeen: false,
  reminderHour: null,
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

/**
 * Preferencias do usuario, ou `null` quando a conta nao existe mais.
 *
 * Envolvida em `cache()` porque o layout raiz e o layout autenticado chamam a
 * mesma consulta na mesma requisicao: sem isso seriam duas idas ao banco para
 * responder a mesma pergunta.
 *
 * A consulta parte de `users` justamente para distinguir os dois casos: quem
 * nunca salvou preferencia recebe o padrao, e quem teve a conta apagada em
 * outro dispositivo recebe null - o token continua com assinatura valida, e
 * sem esta checagem a tela renderizaria normalmente ate a primeira escrita
 * falhar por chave estrangeira.
 */
export const loadSettings = cache(async function loadSettings(
  userId: string
): Promise<SettingsPayload | null> {
  return (await loadAccount(userId))?.settings ?? null;
});

/**
 * Preferencias e versao da sessao na mesma consulta.
 *
 * O layout autenticado precisa das duas: a versao diz se o token foi revogado
 * por troca de senha (US-62), e as preferencias ja seriam buscadas de todo
 * jeito pelo layout raiz.
 */
export const loadAccount = cache(async function loadAccount(
  userId: string
): Promise<{ sessionVersion: number; settings: SettingsPayload } | null> {
  const [row] = await db
    .select({ sessionVersion: users.sessionVersion, settings: speedSettings })
    .from(users)
    .leftJoin(speedSettings, eq(speedSettings.userId, users.id))
    .where(eq(users.id, userId))
    .limit(1);

  if (!row) return null;
  return { sessionVersion: row.sessionVersion, settings: settingsFrom(row.settings) };
});

function settingsFrom(row: typeof speedSettings.$inferSelect | null): SettingsPayload {
  if (!row) return DEFAULT_SETTINGS;

  return {
    baseWpm: row.baseWpm,
    wordsPerChunk: row.wordsPerChunk,
    highlightOpacity: row.highlightOpacity,
    readingMode: row.readingMode as SettingsPayload["readingMode"],
    theme: row.theme as SettingsPayload["theme"],
    fontScale: row.fontScale,
    fontFamily: asFontFamily(row.fontFamily),
    lineHeightStep: row.lineHeightStep,
    warmup: row.warmup,
    wordEmphasis: row.wordEmphasis,
    timezone: asTimezone(row.timezone),
    weeklySummarySeenOn: row.weeklySummarySeenOn,
    placementWpm: row.placementWpm,
    placementSeen: row.placementSeenAt !== null,
    reminderHour: row.reminderHour,
  };
}

export interface TextFilters {
  /** Termo ja dobrado por `foldForSearch`, ou null para nao filtrar. */
  query?: string | null;
  status?: TextStatus;
  scope?: TextScope;
  /** Id da etiqueta escolhida no filtro, ou null para nao filtrar. */
  tagId?: string | null;
}

/**
 * Titulo na mesma forma do termo buscado: minusculo e sem acento.
 *
 * `translate()` em vez da extensao `unaccent` porque a extensao exige um
 * `CREATE EXTENSION` no banco, e um deploy novo passaria a depender de um
 * passo manual fora das migrations.
 */
const foldedTitle = sql`translate(lower(${texts.title}), ${ACCENTED}, ${UNACCENTED})`;

/**
 * Um texto esta em andamento quando saiu do inicio e ainda nao chegou ao fim;
 * concluido quando a posicao alcancou a contagem de palavras. O texto vazio
 * nunca conta como concluido - nao ha o que ler nele.
 */
function statusCondition(status: TextStatus): SQL | undefined {
  if (status === "nao-iniciados") return eq(texts.progressIndex, 0);
  if (status === "em-andamento") {
    return and(gt(texts.progressIndex, 0), lt(texts.progressIndex, texts.wordCount));
  }
  if (status === "concluidos") {
    return and(gt(texts.wordCount, 0), sql`${texts.progressIndex} >= ${texts.wordCount}`);
  }
  return undefined;
}

function textsWhere(
  userId: string,
  filters: TextFilters,
  { withScope = true }: { withScope?: boolean } = {}
): SQL | undefined {
  const conditions: (SQL | undefined)[] = [eq(texts.userId, userId)];

  if (filters.query) {
    conditions.push(sql`${foldedTitle} like ${`%${escapeLike(filters.query)}%`} escape '\\'`);
  }
  conditions.push(statusCondition(filters.status ?? DEFAULT_STATUS));

  // Arquivar e uma aba, nao um filtro somado aos outros: um texto esta na
  // lista principal ou fora dela, nunca nas duas. A biblioteca agrupada
  // aplica a aba por grupo, nao por linha - dai o `withScope: false`.
  if (withScope) {
    conditions.push(
      (filters.scope ?? DEFAULT_SCOPE) === "arquivados"
        ? isNotNull(texts.archivedAt)
        : isNull(texts.archivedAt)
    );
  }

  if (filters.tagId) {
    conditions.push(
      sql`exists (select 1 from ${textTags} where ${textTags.textId} = ${texts.id} and ${textTags.tagId} = ${filters.tagId})`
    );
  }

  return and(...conditions.filter((condition): condition is SQL => condition !== undefined));
}

export async function loadTexts(
  userId: string,
  page = 1,
  perPage = DEFAULT_PAGE_SIZE,
  filters: TextFilters = {}
): Promise<Page<TextSummary>> {
  const offset = (page - 1) * perPage;
  const where = textsWhere(userId, filters);

  const [items, [totals]] = await Promise.all([
    // Lista sem o campo content: uma biblioteca com 50 artigos traria
    // megabytes de texto que a tela nao usa.
    db
      .select(summaryColumns)
      .from(texts)
      .where(where)
      .orderBy(desc(texts.createdAt))
      .limit(perPage)
      .offset(offset),
    db.select({ value: count() }).from(texts).where(where),
  ]);

  const rows = await decorate(items);
  return { items: rows, ...meta(totals?.value ?? 0, page, perPage) };
}

/** Colunas da listagem: tudo menos `content`, que a tela nao usa. */
const summaryColumns = {
  id: texts.id,
  title: texts.title,
  sourceUrl: texts.sourceUrl,
  wordCount: texts.wordCount,
  progressIndex: texts.progressIndex,
  seriesKey: texts.seriesKey,
  seriesTitle: texts.seriesTitle,
  chapter: texts.chapter,
  queuePosition: texts.queuePosition,
  archivedAt: texts.archivedAt,
  autoImportedAt: texts.autoImportedAt,
  createdAt: texts.createdAt,
  updatedAt: texts.updatedAt,
};

type SummaryRow = {
  [K in keyof typeof summaryColumns]: K extends "archivedAt" | "autoImportedAt"
    ? Date | null
    : K extends "createdAt" | "updatedAt"
      ? Date
      : K extends "sourceUrl" | "seriesKey" | "seriesTitle"
        ? string | null
        : K extends "chapter" | "queuePosition"
          ? number | null
          : K extends "id" | "title"
            ? string
            : number;
};

/** Acrescenta destaques e etiquetas em duas consultas para a pagina toda. */
async function decorate(items: SummaryRow[]): Promise<TextSummary[]> {
  const ids = items.map((item) => item.id);
  const [marks, labels] = await Promise.all([highlightCounts(ids), tagsByText(ids)]);

  return items.map(({ autoImportedAt, ...item }) => ({
    ...item,
    // "Novo" ate a leitura comecar: e a posicao que diz que ele foi lido.
    fresh: autoImportedAt !== null && item.progressIndex === 0,
    highlights: marks.get(item.id) ?? 0,
    tags: labels.get(item.id) ?? [],
    archivedAt: item.archivedAt ? isoDate(item.archivedAt) : null,
    createdAt: isoDate(item.createdAt),
    updatedAt: isoDate(item.updatedAt),
  }));
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
        narrated: readingSessions.narrated,
        comprehension: readingSessions.comprehension,
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

/**
 * Texto ja salvo cuja origem bate com alguma das URLs informadas.
 *
 * O compartilhamento do navegador e facil de disparar duas vezes na mesma
 * pagina. Sem esta consulta, o segundo toque criaria uma copia com o progresso
 * zerado em vez de abrir a leitura onde ela parou.
 */
export async function findTextBySourceUrl(
  userId: string,
  urls: string[]
): Promise<{ id: string; title: string } | null> {
  const candidates = [...new Set(urls.filter((url) => url.length > 0))];
  if (candidates.length === 0) return null;

  const [found] = await db
    .select({ id: texts.id, title: texts.title })
    .from(texts)
    .where(and(eq(texts.userId, userId), inArray(texts.sourceUrl, candidates)))
    .orderBy(desc(texts.createdAt))
    .limit(1);

  return found ?? null;
}

/** Todas as metas do usuario, em ordem de vigencia. */
export async function loadGoals(userId: string): Promise<Goal[]> {
  const rows = await db
    .select({ kind: readingGoals.kind, target: readingGoals.target, startsOn: readingGoals.startsOn })
    .from(readingGoals)
    .where(eq(readingGoals.userId, userId))
    .orderBy(asc(readingGoals.startsOn));

  return rows.map((row) => ({
    kind: asGoalKind(row.kind),
    target: row.target,
    startsOn: row.startsOn,
  }));
}

/**
 * Minutos, palavras e ritmo por dia, agrupados no fuso do usuario.
 *
 * O agrupamento e do banco e nao do cliente: baixar o historico inteiro para
 * somar na tela e justamente o que o painel evita desde o inicio. O ppm sai
 * ponderado pelas palavras, senao uma sessao de dez palavras a 900 ppm pesaria
 * o mesmo que uma de mil a 300.
 */
export async function loadDailyTotals(
  userId: string,
  timezone: string,
  sinceDay: string
): Promise<(DayTotals & { wpm: number })[]> {
  const rows = await db.execute<{
    day: string;
    ms: string;
    words: string;
    wpm: string | null;
  }>(sql`
    select
      to_char(${readingSessions.createdAt} at time zone ${timezone}, 'YYYY-MM-DD') as day,
      sum(${readingSessions.durationMs})::text as ms,
      sum(${readingSessions.wordsRead})::text as words,
      (sum(${readingSessions.wpm}::numeric * ${readingSessions.wordsRead})
        / nullif(sum(${readingSessions.wordsRead}), 0))::text as wpm
    from ${readingSessions}
    where ${readingSessions.userId} = ${userId}
      and to_char(${readingSessions.createdAt} at time zone ${timezone}, 'YYYY-MM-DD') >= ${sinceDay}
    group by 1
    order by 1
  `);

  return rows.rows.map((row) => ({
    day: row.day,
    // Minutos inteiros: a meta e em minutos, e meio minuto arredondado para
    // cima faria 4,5 contarem como 5.
    minutes: Math.floor(Number(row.ms) / 60_000),
    words: Number(row.words),
    wpm: Math.round(Number(row.wpm ?? 0)),
  }));
}

/**
 * Series para o grafico de evolucao.
 *
 * A serie semanal e agrupada em JS a partir da diaria em vez de uma segunda
 * consulta: sao no maximo 182 linhas, e uma unica ida ao banco mantem as duas
 * series consistentes entre si - com duas consultas, uma sessao gravada entre
 * elas apareceria em um grafico e nao no outro.
 */
export async function loadTrend(userId: string, timezone: string, today: string) {
  const start = shiftDay(today, -WEEKLY_DAYS);
  const rows = await loadDailyTotals(userId, timezone, start);

  const dailyStart = shiftDay(today, -DAILY_DAYS);
  const daily = rows.filter((row) => row.day >= dailyStart);

  const buckets = new Map<string, { minutes: number; words: number; wpmWeight: number }>();
  for (const row of rows) {
    const week = mondayOf(row.day);
    const bucket = buckets.get(week) ?? { minutes: 0, words: 0, wpmWeight: 0 };
    bucket.minutes += row.minutes;
    bucket.words += row.words;
    // Ritmo ponderado pelas palavras, como na serie diaria.
    bucket.wpmWeight += row.wpm * row.words;
    buckets.set(week, bucket);
  }

  const weekly = [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, bucket]) => ({
      day,
      minutes: bucket.minutes,
      words: bucket.words,
      wpm: bucket.words > 0 ? Math.round(bucket.wpmWeight / bucket.words) : 0,
    }));

  const [totals] = await db
    .select({ value: count() })
    .from(readingSessions)
    .where(eq(readingSessions.userId, userId));

  return { daily, weekly, sessions: totals?.value ?? 0 };
}

/** Dias cobertos por cada serie do grafico. */
const DAILY_DAYS = 30;
const WEEKLY_DAYS = 182;

function shiftDay(day: string, days: number): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Janela olhada para tras ao montar a sequencia de dias. */
export const STREAK_DAYS = 400;

/**
 * Meta do dia com a sequencia ja calculada.
 *
 * Vive aqui porque duas entradas pedem a mesma coisa: o painel, que serve o
 * estado junto do HTML, e `GET /api/metas`, que atualiza depois de salvar.
 * Duas versoes sairiam do lugar na primeira mudanca de regra.
 */
export async function loadGoalStatus(userId: string): Promise<GoalStatus> {
  const settings = await loadSettings(userId);
  const timezone = settings?.timezone ?? "UTC";
  const today = todayIn(timezone);

  const [goals, days] = await Promise.all([
    loadGoals(userId),
    loadDailyTotals(userId, timezone, shiftDay(today, -STREAK_DAYS)),
  ]);

  const goal = goalOn(goals, today);
  if (!goal) return { defined: false, today, timezone };

  const streak = computeStreak(days, goals, today, STREAK_DAYS);

  return {
    defined: true,
    today,
    timezone,
    kind: goal.kind,
    target: goal.target,
    progress: progressFor(
      goal,
      days.find((entry) => entry.day === today)
    ),
    streak: streak.current,
    bestStreak: streak.best,
    pendingToday: streak.pendingToday,
  };
}

/**
 * Resumo da semana anterior, ou `null` quando nao ha o que mostrar.
 *
 * Devolve null em tres casos, e cada um tem um motivo diferente: ja foi
 * dispensado nesta semana, nao houve leitura na semana passada, ou o usuario
 * nunca leu. Os tres levam a mesma tela - a ausencia do cartao.
 */
export async function loadWeeklySummary(
  userId: string,
  timezone: string,
  today: string,
  seenOn: string | null
): Promise<WeeklySummary | null> {
  const thisMonday = mondayOf(today);
  if (seenOn === thisMonday) return null;

  const lastMonday = shiftDay(thisMonday, -7);
  const priorMonday = shiftDay(thisMonday, -14);

  const days = await loadDailyTotals(userId, timezone, priorMonday);

  const week = (from: string, to: string) => {
    const slice = days.filter((day) => day.day >= from && day.day < to);
    const words = slice.reduce((total, day) => total + day.words, 0);
    return {
      minutes: slice.reduce((total, day) => total + day.minutes, 0),
      words,
      wpm:
        words > 0
          ? Math.round(slice.reduce((total, day) => total + day.wpm * day.words, 0) / words)
          : 0,
    };
  };

  const last = week(lastMonday, thisMonday);
  if (last.minutes === 0 && last.words === 0) return null;

  const prior = week(priorMonday, lastMonday);

  const [finished] = await db
    .select({ value: count() })
    .from(readingSessions)
    .where(
      and(
        eq(readingSessions.userId, userId),
        eq(readingSessions.completed, true),
        sql`to_char(${readingSessions.createdAt} at time zone ${timezone}, 'YYYY-MM-DD') >= ${lastMonday}`,
        sql`to_char(${readingSessions.createdAt} at time zone ${timezone}, 'YYYY-MM-DD') < ${thisMonday}`
      )
    );

  return {
    monday: lastMonday,
    minutes: last.minutes,
    words: last.words,
    wpm: last.wpm,
    texts: finished?.value ?? 0,
    minutesChange: percentChange(prior.minutes, last.minutes),
    wpmChange: percentChange(prior.wpm, last.wpm),
  };
}

/** Variacao percentual, ou null quando nao ha base de comparacao. */
function percentChange(before: number, after: number): number | null {
  if (before <= 0) return null;
  return Math.round(((after - before) / before) * 100);
}

export async function loadText(userId: string, id: string): Promise<TextDetail | null> {
  const [[text], [marks], labels] = await Promise.all([
    db
      .select()
      .from(texts)
      .where(and(eq(texts.id, id), eq(texts.userId, userId)))
      .limit(1),
    db
      .select({ value: count() })
      .from(highlights)
      .where(and(eq(highlights.userId, userId), eq(highlights.textId, id))),
    tagsByText([id]),
  ]);

  if (!text) return null;

  return {
    id: text.id,
    title: text.title,
    sourceUrl: text.sourceUrl,
    content: text.content,
    language: text.language,
    wordCount: text.wordCount,
    progressIndex: text.progressIndex,
    sourcePage: text.sourcePage,
    highlights: marks?.value ?? 0,
    tags: labels.get(id) ?? [],
    seriesKey: text.seriesKey,
    seriesTitle: text.seriesTitle,
    chapter: text.chapter,
    queuePosition: text.queuePosition,
    archivedAt: text.archivedAt ? isoDate(text.archivedAt) : null,
    fresh: text.autoImportedAt !== null && text.progressIndex === 0,
    createdAt: isoDate(text.createdAt),
    updatedAt: isoDate(text.updatedAt),
  };
}

/* --- destaques ---------------------------------------------------------- */

/** Quantos destaques cada texto tem, em uma consulta so para a pagina toda. */
async function highlightCounts(textIds: string[]): Promise<Map<string, number>> {
  if (textIds.length === 0) return new Map();

  const rows = await db
    .select({ textId: highlights.textId, value: count() })
    .from(highlights)
    .where(inArray(highlights.textId, textIds))
    .groupBy(highlights.textId);

  return new Map(rows.map((row) => [row.textId, row.value]));
}

/**
 * Destaques de um texto, na ordem da leitura, com o trecho ja reconstruido.
 *
 * O trecho nao e guardado no banco: ele e derivado do conteudo pelos indices.
 * Duplicar o texto criaria duas versoes do mesmo trecho, e a que a tela
 * mostrasse poderia nao ser a que esta no texto.
 */
export async function loadHighlights(
  userId: string,
  textId: string
): Promise<{ text: TextDetail; items: HighlightItem[] } | null> {
  const text = await loadText(userId, textId);
  if (!text) return null;

  const rows = await db
    .select()
    .from(highlights)
    .where(and(eq(highlights.userId, userId), eq(highlights.textId, textId)))
    .orderBy(asc(highlights.startIndex));

  const { words } = parseParagraphs(text.content);

  return {
    text,
    items: rows.map((row) => ({
      id: row.id,
      start: row.startIndex,
      end: row.endIndex,
      note: row.note,
      excerpt: excerptOf(words, row.startIndex, row.endIndex),
      createdAt: isoDate(row.createdAt),
    })),
  };
}

/* --- etiquetas ---------------------------------------------------------- */

/** Nomes das etiquetas de cada texto, em uma consulta para a pagina toda. */
async function tagsByText(textIds: string[]): Promise<Map<string, string[]>> {
  if (textIds.length === 0) return new Map();

  const rows = await db
    .select({ textId: textTags.textId, name: tags.name })
    .from(textTags)
    .innerJoin(tags, eq(tags.id, textTags.tagId))
    .where(inArray(textTags.textId, textIds));

  const byText = new Map<string, string[]>();
  for (const row of rows) {
    const list = byText.get(row.textId) ?? [];
    list.push(row.name);
    byText.set(row.textId, list);
  }

  for (const [id, list] of byText) {
    byText.set(
      id,
      list.sort((a, b) => tagKey(a).localeCompare(tagKey(b)))
    );
  }

  return byText;
}

/** Etiquetas da conta com quantos textos cada uma tem. */
export async function loadTags(userId: string): Promise<TagSummary[]> {
  const rows = await db
    .select({
      id: tags.id,
      name: tags.name,
      texts: sql<number>`count(${textTags.textId})::int`,
    })
    .from(tags)
    .leftJoin(textTags, eq(textTags.tagId, tags.id))
    .where(eq(tags.userId, userId))
    .groupBy(tags.id, tags.name);

  return rows.sort((a, b) => tagKey(a.name).localeCompare(tagKey(b.name)));
}

/* --- biblioteca agrupada por serie --------------------------------------- */

/**
 * A biblioteca como ela e mostrada: um item por texto solto e um por serie.
 *
 * A pagina conta grupos, nao linhas. Paginar por texto e agrupar depois faria
 * uma pagina de dez virar quatro cartoes quando uma serie de sete capitulos
 * caisse dentro dela.
 */
export async function loadLibrary(
  userId: string,
  page = 1,
  perPage = DEFAULT_PAGE_SIZE,
  filters: TextFilters = {}
): Promise<Page<LibraryItem> & { texts: number }> {
  const where = textsWhere(userId, filters, { withScope: false });
  // Texto solto forma um grupo de um: o id serve de chave.
  const groupKey = sql`coalesce(${texts.seriesKey}, ${texts.id}::text)`;

  // A aba decide por grupo: uma serie so esta arquivada quando todos os
  // capitulos estao. Sem isto, concluir o capitulo 1 faria a mesma serie
  // aparecer nas duas abas ao mesmo tempo.
  const scopeHaving =
    (filters.scope ?? DEFAULT_SCOPE) === "arquivados"
      ? sql`bool_and(${texts.archivedAt} is not null)`
      : sql`bool_or(${texts.archivedAt} is null)`;

  const [groups, [totals]] = await Promise.all([
    db
      .select({ key: sql<string>`${groupKey}`, recent: sql<Date>`max(${texts.createdAt})` })
      .from(texts)
      .where(where)
      .groupBy(groupKey)
      .having(scopeHaving)
      .orderBy(desc(sql`max(${texts.createdAt})`))
      .limit(perPage)
      .offset((page - 1) * perPage),
    // Dois numeros: grupos para a paginacao, textos para o rotulo. Um cartao
    // de serie e um item da lista e varios textos da biblioteca.
    db
      .select({
        value: sql<number>`count(*)::int`,
        texts: sql<number>`coalesce(sum(n), 0)::int`,
      })
      .from(
        sql`(select ${groupKey} as k, count(*) as n from ${texts} where ${where} group by 1 having ${scopeHaving}) as grupos`
      ),
  ]);

  if (groups.length === 0) {
    return { items: [], texts: 0, ...meta(totals?.value ?? 0, page, perPage) };
  }

  const keys = groups.map((group) => group.key);
  // Os capitulos vem sem os filtros que escolheram o grupo, so com o dono.
  // Concluir um capitulo o arquiva, e filtrar aqui de novo faria a serie
  // perder justamente os capitulos ja lidos: "cap. 2 de 2" quando sao tres.
  const rows = await db
    .select(summaryColumns)
    .from(texts)
    .where(and(eq(texts.userId, userId), sql`${groupKey} in ${keys}`))
    .orderBy(asc(texts.chapter), desc(texts.createdAt));

  const [decorated, followed] = await Promise.all([
    decorate(rows),
    db
      .select({ seriesKey: seriesFollows.seriesKey, pausedAt: seriesFollows.pausedAt })
      .from(seriesFollows)
      .where(and(eq(seriesFollows.userId, userId), inArray(seriesFollows.seriesKey, keys))),
  ]);
  const follows = new Map(followed.map((row) => [row.seriesKey, row.pausedAt !== null]));
  const byKey = new Map<string, TextSummary[]>();
  for (const item of decorated) {
    const key = item.seriesKey ?? item.id;
    byKey.set(key, [...(byKey.get(key) ?? []), item]);
  }

  // A ordem dos grupos vem da consulta paginada, nao do Map.
  const items = keys
    .map((key) => toLibraryItem(byKey.get(key) ?? [], follows))
    .filter((item): item is LibraryItem => item !== null);

  return { items, texts: totals?.texts ?? 0, ...meta(totals?.value ?? 0, page, perPage) };
}

/**
 * Monta o item da biblioteca a partir dos textos de um grupo.
 *
 * Um capitulo sozinho ainda e um texto solto no cartao: "cap. 1 de 1" nao
 * conta nada que o titulo ja nao diga.
 */
function toLibraryItem(
  chapters: TextSummary[],
  follows: Map<string, boolean> = new Map()
): LibraryItem | null {
  if (chapters.length === 0) return null;
  if (chapters.length === 1 || !chapters[0]!.seriesKey) {
    return { kind: "texto", text: chapters[0]! };
  }

  const ordered = [...chapters].sort((a, b) => (a.chapter ?? 0) - (b.chapter ?? 0));
  // O capitulo atual e o primeiro que ainda nao acabou; terminada a serie,
  // e o ultimo - e onde a leitura parou de fato.
  const pending = ordered.find(
    (item) => item.wordCount === 0 || item.progressIndex < item.wordCount
  );
  const current = pending ?? ordered.at(-1)!;

  return {
    kind: "serie",
    key: current.seriesKey!,
    // O nome guardado quando ele existe; o titulo do primeiro capitulo e
    // reserva para as series criadas antes desta coluna.
    title: ordered.find((item) => item.seriesTitle)?.seriesTitle ?? cleanTitle(ordered[0]!.title),
    chapters: ordered,
    current: current.chapter ?? 1,
    total: ordered.length,
    wordCount: ordered.reduce((sum, item) => sum + item.wordCount, 0),
    updatedAt: ordered.reduce(
      (latest, item) => (item.updatedAt > latest ? item.updatedAt : latest),
      ordered[0]!.updatedAt
    ),
    follow: follows.has(current.seriesKey!) ? { paused: follows.get(current.seriesKey!)! } : null,
  };
}

/* --- proxima leitura ----------------------------------------------------- */

/**
 * O que oferecer ao terminar um texto.
 *
 * A serie tem prioridade sobre a fila: quem acabou o capitulo 3 de uma
 * historia quer o 4, nao o proximo item de uma lista montada semana passada.
 */
export async function loadNextUp(userId: string, textId: string): Promise<NextUp | null> {
  const [text] = await db
    .select({
      id: texts.id,
      sourceUrl: texts.sourceUrl,
      seriesKey: texts.seriesKey,
      chapter: texts.chapter,
      queuePosition: texts.queuePosition,
    })
    .from(texts)
    .where(and(eq(texts.id, textId), eq(texts.userId, userId)))
    .limit(1);

  if (!text) return null;

  if (text.seriesKey && text.chapter !== null) {
    const [next] = await db
      .select({ id: texts.id, title: texts.title, chapter: texts.chapter })
      .from(texts)
      .where(
        and(
          eq(texts.userId, userId),
          eq(texts.seriesKey, text.seriesKey),
          gt(texts.chapter, text.chapter)
        )
      )
      .orderBy(asc(texts.chapter))
      .limit(1);

    if (next) {
      return {
        source: "capitulo",
        textId: next.id,
        title: next.title,
        chapter: next.chapter ?? undefined,
      };
    }

    const url = nextChapterUrl(text.sourceUrl, text.chapter);
    if (url) return { source: "capitulo", importUrl: url, chapter: text.chapter + 1 };
  }

  return await nextInQueue(userId, textId);
}

/** Primeiro da fila que nao seja o texto recem-concluido. */
async function nextInQueue(userId: string, exceptId: string): Promise<NextUp | null> {
  const [next] = await db
    .select({ id: texts.id, title: texts.title })
    .from(texts)
    .where(
      and(
        eq(texts.userId, userId),
        isNotNull(texts.queuePosition),
        isNull(texts.archivedAt),
        sql`${texts.id} <> ${exceptId}`
      )
    )
    .orderBy(asc(texts.queuePosition))
    .limit(1);

  return next ? { source: "fila", textId: next.id, title: next.title } : null;
}

/** A fila de leitura, na ordem em que foi montada. */
export async function loadQueue(userId: string): Promise<TextSummary[]> {
  const rows = await db
    .select(summaryColumns)
    .from(texts)
    .where(
      and(eq(texts.userId, userId), isNotNull(texts.queuePosition), isNull(texts.archivedAt))
    )
    .orderBy(asc(texts.queuePosition));

  return await decorate(rows);
}

/* --- treino -------------------------------------------------------------- */

/**
 * Programa de treino em curso, com os dias ja cumpridos.
 *
 * A compreensao vem da sessao que cumpriu cada dia, por juncao: responder o
 * questionario depois muda o alvo de amanha sem precisar reescrever nada.
 */
export async function loadTraining(userId: string): Promise<ProgramStatus | null> {
  const [program] = await db
    .select()
    .from(trainingPrograms)
    .where(and(eq(trainingPrograms.userId, userId), isNull(trainingPrograms.endedAt)))
    .orderBy(desc(trainingPrograms.createdAt))
    .limit(1);

  if (!program) return null;

  const [rows, settings] = await Promise.all([
    db
      .select({
        day: trainingDays.day,
        targetWpm: trainingDays.targetWpm,
        wpm: trainingDays.wpm,
        onDay: trainingDays.onDay,
        comprehension: readingSessions.comprehension,
      })
      .from(trainingDays)
      .leftJoin(readingSessions, eq(readingSessions.id, trainingDays.sessionId))
      .where(eq(trainingDays.programId, program.id))
      .orderBy(asc(trainingDays.day)),
    loadSettings(userId),
  ]);

  const length = asProgramLength(program.length);
  if (!length) return null;

  return programStatus(
    {
      length,
      startWpm: program.startWpm,
      previousWpm: program.previousWpm,
      startedOn: program.startedOn,
    },
    rows,
    todayIn(settings?.timezone ?? "UTC")
  );
}

/** O programa em curso com o id, para as rotas que precisam escrever nele. */
export async function activeProgram(userId: string) {
  const [program] = await db
    .select()
    .from(trainingPrograms)
    .where(and(eq(trainingPrograms.userId, userId), isNull(trainingPrograms.endedAt)))
    .orderBy(desc(trainingPrograms.createdAt))
    .limit(1);

  return program ?? null;
}

/* --- palavras salvas ----------------------------------------------------- */

/** Palavras consultadas, da mais recente para a mais antiga. */
export async function loadSavedWords(userId: string): Promise<SavedWordItem[]> {
  const rows = await db
    .select({
      id: savedWords.id,
      word: savedWords.word,
      base: savedWords.base,
      kind: savedWords.kind,
      definition: savedWords.definition,
      translation: savedWords.translation,
      language: savedWords.language,
      context: savedWords.context,
      learnedAt: savedWords.learnedAt,
      textId: savedWords.textId,
      textTitle: texts.title,
      createdAt: savedWords.createdAt,
    })
    .from(savedWords)
    .leftJoin(texts, eq(texts.id, savedWords.textId))
    .where(eq(savedWords.userId, userId))
    .orderBy(desc(savedWords.updatedAt))
    .limit(MAX_SAVED_WORDS);

  return rows.map(({ learnedAt, ...row }) => ({
    ...row,
    learned: learnedAt !== null,
    createdAt: isoDate(row.createdAt),
  }));
}

/**
 * Sessao de revisao do dia (US-64): as vencidas, as mais atrasadas primeiro.
 *
 * Sem data de revisao conta como vencida - sao as palavras salvas antes da
 * revisao existir - e vem antes das demais, por serem as mais antigas.
 */
export async function loadReview(userId: string): Promise<ReviewSession> {
  const timezone = (await loadSettings(userId))?.timezone ?? "UTC";
  const today = todayIn(timezone);
  const pending = and(eq(savedWords.userId, userId), isNull(savedWords.learnedAt));
  const due = and(
    pending,
    sql`(${savedWords.nextReviewOn} is null or ${savedWords.nextReviewOn} <= ${today})`
  );

  const [cards, [dueCount], [upcoming], [all]] = await Promise.all([
    db
      .select({
        id: savedWords.id,
        word: savedWords.word,
        base: savedWords.base,
        kind: savedWords.kind,
        definition: savedWords.definition,
        translation: savedWords.translation,
        context: savedWords.context,
        textTitle: texts.title,
      })
      .from(savedWords)
      .leftJoin(texts, eq(texts.id, savedWords.textId))
      .where(due)
      .orderBy(sql`${savedWords.nextReviewOn} asc nulls first`, asc(savedWords.createdAt))
      .limit(REVIEW_SESSION_SIZE),
    db.select({ value: count() }).from(savedWords).where(due),
    db
      .select({ day: sql<string | null>`min(${savedWords.nextReviewOn})` })
      .from(savedWords)
      .where(and(pending, gt(savedWords.nextReviewOn, today))),
    db.select({ value: count() }).from(savedWords).where(eq(savedWords.userId, userId)),
  ]);

  return {
    cards,
    due: dueCount?.value ?? 0,
    nextReviewOn: upcoming?.day ?? null,
    totalWords: all?.value ?? 0,
  };
}
