import "server-only";

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
import { highlights, readingSessions, reviewAnswers, texts } from "@/db/schema";
import { asTextFormat, parseParagraphs } from "@/lib/reading";
import { excerptOf } from "@/lib/highlights";
import { todayIn } from "@/lib/goals";
import { ACCENTED, escapeLike, UNACCENTED } from "@/lib/text-filter";
import { currentInterval, retention } from "@/lib/vocabulary";
import { heaviestWordIndex } from "@/lib/cloze";
import { suggestSlowdown, type SlowdownSuggestion } from "@/lib/difficulty";
import { contentMatchFrom, EXCERPT_AFTER } from "@/lib/content-search";
import { recapTail } from "@/lib/series";
import { DEFAULT_SETTINGS, loadSettings } from "@/lib/queries";
import type {
  CheckedSession,
  ContentMatch,
  HighlightReviewCard,
  HighlightReviewSession,
  LearningStats,
  PreviousChapter,
  RetentionSummary,
  TextDetail,
} from "@/lib/types";

/**
 * Consultas das funcionalidades de aprendizagem e biblioteca: revisao de
 * destaques, retencao, estatisticas por modo, busca no conteudo e
 * recapitulacao de serie.
 *
 * Separadas de `lib/queries.ts` so pelo tamanho - aquele arquivo ja passava de
 * mil linhas. A convencao e a mesma: datas saem como texto ISO e o que e
 * regra fica em funcoes puras de `lib/`.
 */

function isoDate(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function shiftDay(day: string, days: number): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/* --- revisao: retencao e destaques (PROD-4, PROD-7) ----------------------- */

/** Janela da retencao mostrada em Palavras. */
export const RETENTION_DAYS = 30;

/** Retencao das palavras: respostas dos ultimos 30 dias que nao foram "errei". */
export async function loadWordRetention(userId: string): Promise<RetentionSummary> {
  const since = new Date(Date.now() - RETENTION_DAYS * 86_400_000);
  const rows = await db
    .select({ grade: reviewAnswers.grade })
    .from(reviewAnswers)
    .where(
      and(
        eq(reviewAnswers.userId, userId),
        eq(reviewAnswers.kind, "palavra"),
        gt(reviewAnswers.createdAt, since)
      )
    );
  const grades = rows.map((row) => row.grade);
  return { percent: retention(grades), answers: grades.length };
}

/** Destaques por sessao de revisao: poucos, para caber num intervalo do dia. */
export const HIGHLIGHT_REVIEW_SIZE = 10;

/**
 * Destaque vencido hoje. Nunca revisado entra um dia depois de criado: rever
 * no mesmo minuto em que marcou seria so reler.
 */
export function highlightDue(today: string): SQL {
  return sql`((${highlights.reviewDueOn} is not null and ${highlights.reviewDueOn} <= ${today})
    or (${highlights.reviewDueOn} is null and ${highlights.createdAt} < now() - interval '1 day'))`;
}

/** Quantos destaques estao vencidos: o cartao do painel so aparece com algum. */
export async function countDueHighlights(userId: string, timezone: string): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(highlights)
    .where(and(eq(highlights.userId, userId), highlightDue(todayIn(timezone))));
  return row?.value ?? 0;
}

/**
 * Sessao de revisao de destaques (PROD-4): os com nota primeiro, depois os
 * mais antigos. A nota e sinal de que o trecho importou a ponto de merecer
 * comentario; e, entre iguais, o que foi marcado ha mais tempo e o que mais
 * corre o risco de ter sido esquecido.
 */
export async function loadHighlightReview(userId: string): Promise<HighlightReviewSession> {
  const timezone = (await loadSettings(userId))?.timezone ?? "UTC";
  const due = and(eq(highlights.userId, userId), highlightDue(todayIn(timezone)));

  const [rows, [dueCount], [all]] = await Promise.all([
    db
      .select({
        id: highlights.id,
        textId: highlights.textId,
        start: highlights.startIndex,
        end: highlights.endIndex,
        note: highlights.note,
        cardPrompt: highlights.cardPrompt,
        cardAnswer: highlights.cardAnswer,
        interval: highlights.reviewInterval,
        createdAt: highlights.createdAt,
      })
      .from(highlights)
      .where(due)
      .orderBy(sql`${highlights.note} is null`, asc(highlights.createdAt))
      .limit(HIGHLIGHT_REVIEW_SIZE),
    db.select({ value: count() }).from(highlights).where(due),
    db.select({ value: count() }).from(highlights).where(eq(highlights.userId, userId)),
  ]);

  // O trecho e derivado do conteudo, como na lista de destaques: uma consulta
  // para os textos envolvidos, nao uma por destaque.
  const ids = [...new Set(rows.map((row) => row.textId))];
  const sources =
    ids.length === 0
      ? []
      : await db
          .select({ id: texts.id, title: texts.title, content: texts.content, format: texts.format })
          .from(texts)
          .where(and(eq(texts.userId, userId), inArray(texts.id, ids)));
  const parsed = new Map(
    sources.map((source) => [
      source.id,
      {
        title: source.title,
        words: parseParagraphs(source.content, asTextFormat(source.format)).words,
      },
    ])
  );

  const cards: HighlightReviewCard[] = rows.flatMap((row) => {
    const source = parsed.get(row.textId);
    if (!source) return [];
    const words = source.words.slice(row.start, row.end);
    if (words.length === 0) return [];
    return [
      {
        id: row.id,
        textId: row.textId,
        textTitle: source.title,
        start: row.start,
        words,
        blank: heaviestWordIndex(words),
        note: row.note,
        card:
          row.cardPrompt && row.cardAnswer
            ? { prompt: row.cardPrompt, answer: row.cardAnswer }
            : null,
        interval: currentInterval(row.interval),
        createdAt: isoDate(row.createdAt),
      },
    ];
  });

  return { cards, due: dueCount?.value ?? 0, totalHighlights: all?.value ?? 0 };
}

/* --- estatisticas de aprendizagem (PROD-10, PROD-13) ---------------------- */

/** Janela do ritmo por modo. */
export const MODE_WINDOW_DAYS = 30;
/** Janela da serie de compreensao: mais longa, porque questionario e raro. */
export const COMPREHENSION_WINDOW_DAYS = 182;

/**
 * Ppm medio por modo nos ultimos 30 dias e a serie diaria de compreensao.
 *
 * Os dois ponderados pelas palavras, como o resto das estatisticas. O ritmo
 * eficaz e ppm x acertos: 500 ppm entendendo 60% rendem 300 palavras
 * entendidas por minuto, menos que 400 ppm entendendo 90%.
 */
export async function loadLearningStats(
  userId: string,
  timezone: string,
  today: string
): Promise<LearningStats> {
  const day = sql`to_char(${readingSessions.createdAt} at time zone ${timezone}, 'YYYY-MM-DD')`;

  const [modes, days] = await Promise.all([
    db.execute<{ mode: string; wpm: string | null; sessions: string }>(sql`
      select
        ${readingSessions.mode} as mode,
        (sum(${readingSessions.wpm}::numeric * ${readingSessions.wordsRead})
          / nullif(sum(${readingSessions.wordsRead}), 0))::text as wpm,
        count(*)::text as sessions
      from ${readingSessions}
      where ${readingSessions.userId} = ${userId}
        and ${day} >= ${shiftDay(today, -MODE_WINDOW_DAYS)}
      group by 1
      order by 1
    `),
    db.execute<{ day: string; percent: string; wpm: string | null; effective: string | null }>(sql`
      select
        ${day} as day,
        avg(${readingSessions.comprehension})::text as percent,
        (sum(${readingSessions.wpm}::numeric * ${readingSessions.wordsRead})
          / nullif(sum(${readingSessions.wordsRead}), 0))::text as wpm,
        (sum(${readingSessions.wpm}::numeric * ${readingSessions.comprehension} / 100 * ${readingSessions.wordsRead})
          / nullif(sum(${readingSessions.wordsRead}), 0))::text as effective
      from ${readingSessions}
      where ${readingSessions.userId} = ${userId}
        and ${readingSessions.comprehension} is not null
        and ${day} >= ${shiftDay(today, -COMPREHENSION_WINDOW_DAYS)}
      group by 1
      order by 1
    `),
  ]);

  return {
    byMode: modes.rows.map((row) => ({
      mode: row.mode,
      wpm: Math.round(Number(row.wpm ?? 0)),
      sessions: Number(row.sessions),
    })),
    comprehension: days.rows.map((row) => ({
      day: row.day,
      percent: Math.round(Number(row.percent)),
      wpm: Math.round(Number(row.wpm ?? 0)),
      effectiveWpm: Math.round(Number(row.effective ?? 0)),
    })),
  };
}

/** Sessoes com nota mostradas no treino. */
export const CHECKED_SESSIONS_SHOWN = 8;

/**
 * Ultimas sessoes com compreensao medida - pelo questionario, pelas lacunas
 * ou pela checagem da sessao (US-149) -, cada uma com o proprio ppm. A nota
 * fica na linha da sessao, entao a ligacao e direta.
 */
export async function loadCheckedSessions(userId: string): Promise<CheckedSession[]> {
  const rows = await db
    .select({
      id: readingSessions.id,
      textTitle: texts.title,
      wpm: readingSessions.wpm,
      wordsRead: readingSessions.wordsRead,
      mode: readingSessions.mode,
      comprehension: readingSessions.comprehension,
      createdAt: readingSessions.createdAt,
    })
    .from(readingSessions)
    .innerJoin(texts, eq(texts.id, readingSessions.textId))
    .where(and(eq(readingSessions.userId, userId), isNotNull(readingSessions.comprehension)))
    .orderBy(desc(readingSessions.createdAt))
    .limit(CHECKED_SESSIONS_SHOWN);

  return rows.map((row) => ({
    ...row,
    comprehension: row.comprehension ?? 0,
    createdAt: isoDate(row.createdAt),
  }));
}

/** Sessoes lidas para a sugestao de desacelerar: folga para achar 3 do runner. */
const SLOWDOWN_SAMPLE = 20;

/** Sugestao de desacelerar (PROD-10), a partir das sessoes mais recentes. */
export async function loadSlowdownSuggestion(
  userId: string
): Promise<{ suggestion: SlowdownSuggestion | null; baseWpm: number }> {
  const [settings, rows] = await Promise.all([
    loadSettings(userId),
    db
      .select({
        mode: readingSessions.mode,
        wordsRead: readingSessions.wordsRead,
        brakes: readingSessions.brakes,
      })
      .from(readingSessions)
      .where(eq(readingSessions.userId, userId))
      .orderBy(desc(readingSessions.createdAt))
      .limit(SLOWDOWN_SAMPLE),
  ]);
  return {
    suggestion: suggestSlowdown(rows),
    baseWpm: settings?.baseWpm ?? DEFAULT_SETTINGS.baseWpm,
  };
}

/* --- busca no conteudo (APP-16) -------------------------------------------- */

/**
 * Teto de textos na busca por conteudo. A busca varre o conteudo inteiro de
 * cada texto da conta; o limite corta o custo de montar trechos e a
 * transferencia, e acima de uns poucos resultados o termo e generico demais
 * para a lista ajudar.
 */
export const CONTENT_SEARCH_LIMIT = 8;

/**
 * Textos cujo conteudo contem o termo, com o trecho e a palavra da primeira
 * ocorrencia.
 *
 * Mesma dobra do titulo (`translate` + `lower`) em vez de `unaccent` ou
 * `to_tsvector`: a extensao exige passo manual fora das migrations, e a busca
 * por radical acharia "leitura" ao procurar "leitor" - aqui o leitor procura
 * uma frase de que se lembra. `translate` troca letra por letra, entao a
 * posicao no conteudo dobrado e a mesma do original, e so o comeco do texto
 * ate um pouco depois da ocorrencia sai do banco.
 *
 * `query` ja vem dobrado por `normalizeQuery`.
 */
export async function searchContent(userId: string, query: string): Promise<ContentMatch[]> {
  const folded = sql`translate(lower(${texts.content}), ${ACCENTED}, ${UNACCENTED})`;
  const position = sql`strpos(${folded}, ${query})`;

  const rows = await db
    .select({
      id: texts.id,
      title: texts.title,
      format: texts.format,
      position: sql<number>`${position}`.mapWith(Number),
      head: sql<string>`left(${texts.content}, ${position} + ${query.length + EXCERPT_AFTER})`,
    })
    .from(texts)
    .where(
      and(
        eq(texts.userId, userId),
        isNull(texts.abandonedAt),
        sql`${folded} like ${`%${escapeLike(query)}%`} escape '\\'`
      )
    )
    .orderBy(desc(texts.updatedAt))
    .limit(CONTENT_SEARCH_LIMIT);

  return rows.map((row) => contentMatchFrom(row, query.length));
}

/* --- recapitulacao entre capitulos (PROD-12) ------------------------------ */

/** Pausa a partir da qual vale lembrar o capitulo anterior. */
export const RECAP_AFTER_MS = 48 * 3_600_000;

/**
 * Recapitulacao do capitulo anterior, ou `undefined` quando nao se aplica.
 *
 * So faz sentido ao abrir um capitulo do comeco, com o anterior concluido e
 * uma pausa longa no meio: quem acabou o capitulo 3 ontem a noite lembra
 * dele, quem acabou ha uma semana nao. A conclusao e a ultima sessao gravada
 * no capitulo anterior - a leitura termina com uma sessao; sem sessao, vale a
 * ultima alteracao do texto.
 */
export async function loadPreviousChapter(
  userId: string,
  text: Pick<TextDetail, "seriesKey" | "chapter" | "progressIndex">,
  now: number = Date.now()
): Promise<PreviousChapter | undefined> {
  if (!text.seriesKey || text.chapter === null || text.progressIndex !== 0) return undefined;

  const [previous] = await db
    .select({
      id: texts.id,
      title: texts.title,
      content: texts.content,
      format: texts.format,
      wordCount: texts.wordCount,
      progressIndex: texts.progressIndex,
      updatedAt: texts.updatedAt,
    })
    .from(texts)
    .where(
      and(
        eq(texts.userId, userId),
        eq(texts.seriesKey, text.seriesKey),
        lt(texts.chapter, text.chapter)
      )
    )
    .orderBy(desc(texts.chapter))
    .limit(1);

  if (!previous || previous.wordCount === 0 || previous.progressIndex < previous.wordCount) {
    return undefined;
  }

  const [[last], marks] = await Promise.all([
    db
      .select({ at: sql<Date | string | null>`max(${readingSessions.createdAt})` })
      .from(readingSessions)
      .where(and(eq(readingSessions.userId, userId), eq(readingSessions.textId, previous.id))),
    db
      .select({ start: highlights.startIndex, end: highlights.endIndex, note: highlights.note })
      .from(highlights)
      .where(and(eq(highlights.userId, userId), eq(highlights.textId, previous.id)))
      .orderBy(asc(highlights.startIndex)),
  ]);

  const finishedAt = new Date(last?.at ?? previous.updatedAt).getTime();
  if (!Number.isFinite(finishedAt) || now - finishedAt <= RECAP_AFTER_MS) return undefined;

  const { words, paragraphs } = parseParagraphs(previous.content, asTextFormat(previous.format));
  return {
    id: previous.id,
    title: previous.title,
    tail: recapTail(paragraphs.map((paragraph) => paragraph.words)),
    highlights: marks.map((mark) => ({
      text: excerptOf(words, mark.start, mark.end),
      note: mark.note,
    })),
  };
}
