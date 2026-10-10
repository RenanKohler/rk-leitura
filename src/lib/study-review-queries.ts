import "server-only";

import { and, asc, count, eq, gt, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  comprehensionQuizzes,
  highlights,
  quizRecalls,
  reviewAnswers,
  savedWords,
  studyCards,
  texts,
} from "@/db/schema";
import { todayIn } from "@/lib/goals";
import { loadSettings } from "@/lib/queries";
import { highlightDue } from "@/lib/learning-queries";
import { asTextFormat, parseParagraphs } from "@/lib/reading";
import { heaviestWordIndex } from "@/lib/cloze";
import { parseDistractors } from "@/lib/dictionary";
import { parseQuiz, quizKey, type Quiz } from "@/lib/quiz";
import { isCardDue, isCardRead, type ReadingProgress } from "@/lib/study-cards";
import { addDays, currentInterval } from "@/lib/vocabulary";
import {
  CARD_RETENTION_DAYS,
  cardRetention,
  pretestPercent,
  rereadList,
  type CardRetention,
} from "@/lib/study-retention";
import {
  DAILY_REVIEW_LIMIT,
  dailySession,
  emptyCounts,
  totalOf,
  type DailyCounts,
} from "@/lib/daily-review";
import {
  dueRecallRound,
  isRecallRound,
  nextRecallDueOn,
  recallDueOn,
  type RecallRound,
} from "@/lib/quiz-recall";
import type { HighlightReviewCard, ReviewCard } from "@/lib/types";

/**
 * Consultas da revisao de cartoes (US-156), da revisao do dia (US-161), da
 * retencao (US-162), do lembrete de revisao (US-163) e do questionario
 * refeito (US-169).
 *
 * Toda decisao de "vencido" e "visivel" de um cartao passa por
 * `lib/study-cards.ts`: a consulta traz os candidatos pela data e a regra de
 * leitura filtra.
 */

/* --- cartoes ---------------------------------------------------------------- */

export interface StudyReviewCard {
  id: string;
  textId: string;
  textTitle: string;
  kind: string;
  front: string;
  back: string;
  analogy: string | null;
  /** Primeira palavra do trecho de origem: "Ver no texto" abre o leitor ali. */
  sourceStart: number;
  /** Trecho de origem, para mostrar junto do verso. */
  source: string;
  interval: number;
}

export interface CardReviewSession {
  textId: string;
  title: string;
  cards: StudyReviewCard[];
  /** Proxima revisao entre os cartoes ja lidos, quando nada vence hoje. */
  nextReviewOn: string | null;
  /** Cartoes de trechos ja lidos. */
  readCards: number;
}

interface CardRow {
  id: string;
  textId: string;
  kind: string;
  front: string;
  back: string;
  analogy: string | null;
  sourceStart: number;
  sourceEnd: number;
  nextReviewOn: string | null;
  interval: number;
  progressIndex: number;
  wordCount: number;
}

const cardColumns = {
  id: studyCards.id,
  textId: studyCards.textId,
  kind: studyCards.kind,
  front: studyCards.front,
  back: studyCards.back,
  analogy: studyCards.analogy,
  sourceStart: studyCards.sourceStart,
  sourceEnd: studyCards.sourceEnd,
  nextReviewOn: studyCards.nextReviewOn,
  interval: studyCards.reviewInterval,
  progressIndex: texts.progressIndex,
  wordCount: texts.wordCount,
};

function progressOf(row: { progressIndex: number; wordCount: number }): ReadingProgress {
  return { progressIndex: row.progressIndex, wordCount: row.wordCount };
}

/** Os mais atrasados primeiro; os que acabaram de ser lidos (sem data) por ultimo. */
function byCardDue(a: CardRow, b: CardRow): number {
  if (a.nextReviewOn === b.nextReviewOn) return a.sourceStart - b.sourceStart;
  if (a.nextReviewOn === null) return 1;
  if (b.nextReviewOn === null) return -1;
  return a.nextReviewOn.localeCompare(b.nextReviewOn);
}

/** Candidatos a vencidos (pela data); a regra de leitura filtra depois. */
async function dueCardRows(userId: string, today: string, textId?: string): Promise<CardRow[]> {
  const rows = await db
    .select(cardColumns)
    .from(studyCards)
    .innerJoin(texts, eq(texts.id, studyCards.textId))
    .where(
      and(
        eq(studyCards.userId, userId),
        textId ? eq(studyCards.textId, textId) : undefined,
        or(isNull(studyCards.nextReviewOn), lte(studyCards.nextReviewOn, today))
      )
    );
  return rows.filter((row) => isCardDue(row, progressOf(row), today)).sort(byCardDue);
}

/** Monta os cartoes com o trecho de origem: uma leitura de conteudo por texto. */
async function withSources(userId: string, rows: CardRow[]): Promise<StudyReviewCard[]> {
  const ids = [...new Set(rows.map((row) => row.textId))];
  if (ids.length === 0) return [];
  const sources = await db
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

  return rows.flatMap((row) => {
    const source = parsed.get(row.textId);
    if (!source) return [];
    return [
      {
        id: row.id,
        textId: row.textId,
        textTitle: source.title,
        kind: row.kind,
        front: row.front,
        back: row.back,
        analogy: row.analogy,
        sourceStart: row.sourceStart,
        source: source.words.slice(row.sourceStart, row.sourceEnd).join(" "),
        interval: currentInterval(row.interval),
      },
    ];
  });
}

/** Revisao dos cartoes de um texto (US-156). */
export async function loadCardReview(
  userId: string,
  text: { id: string; title: string; progressIndex: number; wordCount: number }
): Promise<CardReviewSession> {
  const timezone = (await loadSettings(userId))?.timezone ?? "UTC";
  const today = todayIn(timezone);
  const progress = progressOf(text);

  const [due, all] = await Promise.all([
    dueCardRows(userId, today, text.id),
    db
      .select({ sourceEnd: studyCards.sourceEnd, nextReviewOn: studyCards.nextReviewOn })
      .from(studyCards)
      .where(and(eq(studyCards.userId, userId), eq(studyCards.textId, text.id))),
  ]);

  const read = all.filter((card) => isCardRead(card, progress));
  const upcoming = read
    .map((card) => card.nextReviewOn)
    .filter((day): day is string => day !== null && day > today)
    .sort();

  return {
    textId: text.id,
    title: text.title,
    cards: await withSources(userId, due.slice(0, DAILY_REVIEW_LIMIT)),
    nextReviewOn: upcoming[0] ?? null,
    readCards: read.length,
  };
}

/** Cartao com o progresso do texto, para a nota e para a analogia. */
export async function loadOwnedCard(userId: string, cardId: string) {
  const [row] = await db
    .select({
      ...cardColumns,
      content: texts.content,
      format: texts.format,
    })
    .from(studyCards)
    .innerJoin(texts, eq(texts.id, studyCards.textId))
    .where(and(eq(studyCards.id, cardId), eq(studyCards.userId, userId)))
    .limit(1);
  if (!row) return null;
  return { ...row, read: isCardRead(row, progressOf(row)) };
}

/* --- retencao (US-162) ------------------------------------------------------ */

function retentionSince(): Date {
  return new Date(Date.now() - CARD_RETENTION_DAYS * 86_400_000);
}

export interface TextRetention {
  retention: CardRetention;
  /** Conhecimento previo (US-170), nulo sem teste respondido. */
  pretest: number | null;
  /** Cartoes vencidos hoje neste texto. */
  due: number;
}

export async function loadTextRetention(
  userId: string,
  text: { id: string; progressIndex: number; wordCount: number }
): Promise<TextRetention> {
  const timezone = (await loadSettings(userId))?.timezone ?? "UTC";
  const today = todayIn(timezone);
  const progress = progressOf(text);

  const [cards, answers] = await Promise.all([
    db
      .select({
        sourceEnd: studyCards.sourceEnd,
        nextReviewOn: studyCards.nextReviewOn,
        interval: studyCards.reviewInterval,
        pretest: studyCards.pretest,
      })
      .from(studyCards)
      .where(and(eq(studyCards.userId, userId), eq(studyCards.textId, text.id))),
    db
      .select({ grade: reviewAnswers.grade })
      .from(reviewAnswers)
      .innerJoin(studyCards, eq(studyCards.id, reviewAnswers.itemId))
      .where(
        and(
          eq(reviewAnswers.userId, userId),
          eq(reviewAnswers.kind, "cartao"),
          gt(reviewAnswers.createdAt, retentionSince()),
          eq(studyCards.textId, text.id)
        )
      ),
  ]);

  return {
    retention: cardRetention(
      answers.map((answer) => answer.grade),
      cards.map((card) => card.interval)
    ),
    pretest: pretestPercent(cards.map((card) => card.pretest)),
    due: cards.filter((card) => isCardDue(card, progress, today)).length,
  };
}

/** "Para reler" em "Voce": textos com retencao medida abaixo de 60%. */
export async function loadRereadList(userId: string) {
  const rows = await db
    .select({ textId: texts.id, title: texts.title, grade: reviewAnswers.grade })
    .from(reviewAnswers)
    .innerJoin(studyCards, eq(studyCards.id, reviewAnswers.itemId))
    .innerJoin(texts, eq(texts.id, studyCards.textId))
    .where(
      and(
        eq(reviewAnswers.userId, userId),
        eq(reviewAnswers.kind, "cartao"),
        gt(reviewAnswers.createdAt, retentionSince())
      )
    );

  const byText = new Map<string, { textId: string; title: string; grades: string[] }>();
  for (const row of rows) {
    const entry = byText.get(row.textId) ?? { textId: row.textId, title: row.title, grades: [] };
    entry.grades.push(row.grade);
    byText.set(row.textId, entry);
  }
  return rereadList([...byText.values()]);
}

/* --- questionario refeito (US-169) ------------------------------------------ */

interface Concluded {
  textId: string;
  /** Dia da conclusao, no fuso do leitor. */
  concludedOn: string;
  /** Nota do questionario na conclusao. */
  original: number;
}

/**
 * Textos concluidos com questionario respondido: a primeira sessao concluida
 * com nota de cada texto (ver `lib/quiz-recall.ts`).
 */
async function concludedTexts(userId: string, timezone: string, textId?: string): Promise<Concluded[]> {
  const result = await db.execute<{ text_id: string; day: string; comprehension: number }>(sql`
    select distinct on (s.text_id)
      s.text_id,
      to_char(s.created_at at time zone ${timezone}, 'YYYY-MM-DD') as day,
      s.comprehension
    from reading_sessions s
    where s.user_id = ${userId}
      and s.completed
      and s.comprehension is not null
      ${textId ? sql`and s.text_id = ${textId}` : sql``}
    order by s.text_id, s.created_at asc
  `);
  return result.rows.map((row) => ({
    textId: row.text_id,
    concludedOn: row.day,
    original: Number(row.comprehension),
  }));
}

async function doneRounds(userId: string, textIds: string[]): Promise<Map<string, number[]>> {
  const done = new Map<string, number[]>();
  if (textIds.length === 0) return done;
  const rows = await db
    .select({ textId: quizRecalls.textId, round: quizRecalls.round })
    .from(quizRecalls)
    .where(and(eq(quizRecalls.userId, userId), inArray(quizRecalls.textId, textIds)));
  for (const row of rows) done.set(row.textId, [...(done.get(row.textId) ?? []), row.round]);
  return done;
}

/**
 * Questionario guardado da versao atual de cada texto. Texto sem questionario
 * guardado nunca volta: nada e gerado para isso.
 */
async function storedQuizzes(
  userId: string,
  textIds: string[]
): Promise<Map<string, { title: string; quiz: Quiz }>> {
  const found = new Map<string, { title: string; quiz: Quiz }>();
  if (textIds.length === 0) return found;
  const [owned, quizzes] = await Promise.all([
    db
      .select({ id: texts.id, title: texts.title, content: texts.content, language: texts.language })
      .from(texts)
      .where(and(eq(texts.userId, userId), inArray(texts.id, textIds))),
    db
      .select({
        textId: comprehensionQuizzes.textId,
        key: comprehensionQuizzes.contentKey,
        questions: comprehensionQuizzes.questions,
      })
      .from(comprehensionQuizzes)
      .where(inArray(comprehensionQuizzes.textId, textIds)),
  ]);
  for (const text of owned) {
    const key = quizKey(text.content, text.language);
    const row = quizzes.find((quiz) => quiz.textId === text.id && quiz.key === key);
    const quiz = row ? parseQuiz(row.questions) : null;
    if (quiz) found.set(text.id, { title: text.title, quiz });
  }
  return found;
}

export interface DueRecall {
  textId: string;
  title: string;
  round: RecallRound;
  dueOn: string;
  original: number;
}

interface RecallScan {
  due: DueRecall[];
  /** Rodadas que vencem amanha. */
  tomorrow: number;
}

async function scanRecalls(userId: string, timezone: string, today: string, textId?: string): Promise<RecallScan> {
  const concluded = await concludedTexts(userId, timezone, textId);
  const done = await doneRounds(
    userId,
    concluded.map((item) => item.textId)
  );
  const tomorrowDay = addDays(today, 1);

  const pending: (Concluded & { round: RecallRound })[] = [];
  const upcoming: string[] = [];
  for (const item of concluded) {
    const rounds = done.get(item.textId) ?? [];
    const round = dueRecallRound(item.concludedOn, today, rounds);
    if (round) pending.push({ ...item, round });
    else if (nextRecallDueOn(item.concludedOn, today, rounds) === tomorrowDay) upcoming.push(item.textId);
  }

  const quizzes = await storedQuizzes(userId, [
    ...pending.map((item) => item.textId),
    ...upcoming,
  ]);

  return {
    due: pending.flatMap((item) => {
      const stored = quizzes.get(item.textId);
      if (!stored) return [];
      return [
        {
          textId: item.textId,
          title: stored.title,
          round: item.round,
          dueOn: recallDueOn(item.concludedOn, item.round),
          original: item.original,
        },
      ];
    }),
    tomorrow: upcoming.filter((id) => quizzes.has(id)).length,
  };
}

/** Rodada vencida de um texto, com o questionario guardado, para a rota. */
export async function loadDueRecall(
  userId: string,
  textId: string
): Promise<(DueRecall & { quiz: Quiz }) | null> {
  const timezone = (await loadSettings(userId))?.timezone ?? "UTC";
  const { due } = await scanRecalls(userId, timezone, todayIn(timezone), textId);
  const recall = due[0];
  if (!recall) return null;
  const stored = (await storedQuizzes(userId, [textId])).get(textId);
  return stored ? { ...recall, quiz: stored.quiz } : null;
}

/** Nota original e notas refeitas, para o historico do texto. */
export async function loadRecallHistory(userId: string, textId: string) {
  const timezone = (await loadSettings(userId))?.timezone ?? "UTC";
  const [concluded] = await concludedTexts(userId, timezone, textId);
  if (!concluded) return null;
  const rows = await db
    .select({ round: quizRecalls.round, score: quizRecalls.score, createdAt: quizRecalls.createdAt })
    .from(quizRecalls)
    .where(and(eq(quizRecalls.userId, userId), eq(quizRecalls.textId, textId)))
    .orderBy(asc(quizRecalls.round));
  return {
    original: concluded.original,
    concludedOn: concluded.concludedOn,
    recalls: rows.flatMap((row) =>
      isRecallRound(row.round) ? [{ round: row.round, score: row.score }] : []
    ),
  };
}

/* --- revisao do dia (US-161) ------------------------------------------------ */

export type DailyItem =
  | { kind: "palavra"; id: string; dueOn: string | null; word: ReviewCard }
  | { kind: "destaque"; id: string; dueOn: string | null; highlight: HighlightReviewCard }
  | { kind: "cartao"; id: string; dueOn: string | null; card: StudyReviewCard }
  | { kind: "recordar"; id: string; dueOn: string | null; recall: DueRecall };

export interface DailyReview {
  items: DailyItem[];
  counts: DailyCounts;
  total: number;
  /** Itens que vencem amanha, para o "Revisao em dia." */
  tomorrow: number;
}

const wordDue = (userId: string, today: string) =>
  and(
    eq(savedWords.userId, userId),
    isNull(savedWords.learnedAt),
    or(isNull(savedWords.nextReviewOn), lte(savedWords.nextReviewOn, today))
  );

const highlightDueFor = (userId: string, today: string) =>
  and(eq(highlights.userId, userId), highlightDue(today));

/** Contagem por tipo, sem montar os itens: painel inicial e lembrete. */
export async function countDailyReview(
  userId: string,
  timezone: string,
  today = todayIn(timezone)
): Promise<{ counts: DailyCounts; total: number }> {
  const [[words], [marks], cards, recalls] = await Promise.all([
    db.select({ value: count() }).from(savedWords).where(wordDue(userId, today)),
    db.select({ value: count() }).from(highlights).where(highlightDueFor(userId, today)),
    dueCardRows(userId, today),
    scanRecalls(userId, timezone, today),
  ]);
  const counts = emptyCounts();
  counts.palavra = words?.value ?? 0;
  counts.destaque = marks?.value ?? 0;
  counts.cartao = cards.length;
  counts.recordar = recalls.due.length;
  return { counts, total: totalOf(counts) };
}

/** Respondeu algum item da revisao hoje, no fuso do leitor (US-163). */
export async function reviewedToday(userId: string, timezone: string, today: string): Promise<boolean> {
  const [answers, recalls] = await Promise.all([
    db
      .select({ value: count() })
      .from(reviewAnswers)
      .where(
        and(
          eq(reviewAnswers.userId, userId),
          sql`to_char(${reviewAnswers.createdAt} at time zone ${timezone}, 'YYYY-MM-DD') = ${today}`
        )
      ),
    db
      .select({ value: count() })
      .from(quizRecalls)
      .where(
        and(
          eq(quizRecalls.userId, userId),
          sql`to_char(${quizRecalls.createdAt} at time zone ${timezone}, 'YYYY-MM-DD') = ${today}`
        )
      ),
  ]);
  return (answers[0]?.value ?? 0) + (recalls[0]?.value ?? 0) > 0;
}

/** Itens que vencem amanha, por tipo somados. */
async function countTomorrow(userId: string, today: string, recallsTomorrow: number): Promise<number> {
  const tomorrow = addDays(today, 1);
  const [[words], [marks], cards] = await Promise.all([
    db
      .select({ value: count() })
      .from(savedWords)
      .where(
        and(
          eq(savedWords.userId, userId),
          isNull(savedWords.learnedAt),
          eq(savedWords.nextReviewOn, tomorrow)
        )
      ),
    db
      .select({ value: count() })
      .from(highlights)
      .where(
        and(
          eq(highlights.userId, userId),
          or(
            eq(highlights.reviewDueOn, tomorrow),
            // Nunca revisado vence um dia depois de criado.
            and(isNull(highlights.reviewDueOn), gte(highlights.createdAt, sql`now() - interval '1 day'`))
          )
        )
      ),
    db
      .select(cardColumns)
      .from(studyCards)
      .innerJoin(texts, eq(texts.id, studyCards.textId))
      .where(and(eq(studyCards.userId, userId), eq(studyCards.nextReviewOn, tomorrow))),
  ]);
  const readCards = cards.filter((card) => isCardRead(card, progressOf(card))).length;
  return (words?.value ?? 0) + (marks?.value ?? 0) + readCards + recallsTomorrow;
}

/** A sessao do dia: ate 50 itens, os mais atrasados primeiro, intercalados. */
export async function loadDailyReview(userId: string): Promise<DailyReview> {
  const timezone = (await loadSettings(userId))?.timezone ?? "UTC";
  const today = todayIn(timezone);

  const [wordRows, highlightRows, cardRows, recalls, [wordCount], [highlightCount]] =
    await Promise.all([
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
          distractors: savedWords.distractors,
          step: savedWords.reviewStep,
          storedInterval: savedWords.reviewInterval,
          nextReviewOn: savedWords.nextReviewOn,
        })
        .from(savedWords)
        .leftJoin(texts, eq(texts.id, savedWords.textId))
        .where(wordDue(userId, today))
        .orderBy(sql`${savedWords.nextReviewOn} asc nulls first`, asc(savedWords.createdAt))
        .limit(DAILY_REVIEW_LIMIT),
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
          dueOn: highlights.reviewDueOn,
          createdAt: highlights.createdAt,
        })
        .from(highlights)
        .where(highlightDueFor(userId, today))
        .orderBy(
          sql`coalesce(${highlights.reviewDueOn}, (${highlights.createdAt} + interval '1 day')::date) asc`
        )
        .limit(DAILY_REVIEW_LIMIT),
      dueCardRows(userId, today),
      scanRecalls(userId, timezone, today),
      db.select({ value: count() }).from(savedWords).where(wordDue(userId, today)),
      db.select({ value: count() }).from(highlights).where(highlightDueFor(userId, today)),
    ]);

  const counts = emptyCounts();
  counts.palavra = wordCount?.value ?? 0;
  counts.destaque = highlightCount?.value ?? 0;
  counts.cartao = cardRows.length;
  counts.recordar = recalls.due.length;
  const total = totalOf(counts);

  // Candidatos leves primeiro; o conteudo dos textos so e lido para os
  // destaques e cartoes que entram na sessao.
  type Candidate = { kind: DailyItem["kind"]; id: string; dueOn: string | null };
  const candidates: Candidate[] = [
    ...wordRows.map((row) => ({ kind: "palavra" as const, id: row.id, dueOn: row.nextReviewOn })),
    ...highlightRows.map((row) => ({
      kind: "destaque" as const,
      id: row.id,
      dueOn: row.dueOn ?? addDays(new Date(row.createdAt).toISOString().slice(0, 10), 1),
    })),
    // Cartao que acabou de ser lido vence hoje: e o menos atrasado.
    ...cardRows.map((row) => ({ kind: "cartao" as const, id: row.id, dueOn: row.nextReviewOn ?? today })),
    ...recalls.due.map((recall) => ({
      kind: "recordar" as const,
      id: `${recall.textId}:${recall.round}`,
      dueOn: recall.dueOn,
    })),
  ];
  const chosen = dailySession(candidates);
  const picked = (kind: Candidate["kind"]) =>
    new Set(chosen.filter((item) => item.kind === kind).map((item) => item.id));

  const pickedHighlights = picked("destaque");
  const pickedCards = picked("cartao");
  const highlightCards = await highlightCardsFor(
    userId,
    highlightRows.filter((row) => pickedHighlights.has(row.id))
  );
  const studyCardsById = new Map(
    (await withSources(userId, cardRows.filter((row) => pickedCards.has(row.id)))).map((card) => [
      card.id,
      card,
    ])
  );
  const wordsById = new Map(
    wordRows.map(({ step, storedInterval, distractors, nextReviewOn: _due, ...word }) => [
      word.id,
      {
        ...word,
        distractors: word.definition.trim() ? parseDistractors(distractors, word.definition) : null,
        interval: currentInterval(storedInterval, step),
      } satisfies ReviewCard,
    ])
  );
  const recallsById = new Map(recalls.due.map((recall) => [`${recall.textId}:${recall.round}`, recall]));

  const items: DailyItem[] = chosen.flatMap((item): DailyItem[] => {
    if (item.kind === "palavra") {
      const word = wordsById.get(item.id);
      return word ? [{ kind: "palavra", id: item.id, dueOn: item.dueOn, word }] : [];
    }
    if (item.kind === "destaque") {
      const highlight = highlightCards.get(item.id);
      return highlight ? [{ kind: "destaque", id: item.id, dueOn: item.dueOn, highlight }] : [];
    }
    if (item.kind === "cartao") {
      const card = studyCardsById.get(item.id);
      return card ? [{ kind: "cartao", id: item.id, dueOn: item.dueOn, card }] : [];
    }
    const recall = recallsById.get(item.id);
    return recall ? [{ kind: "recordar", id: item.id, dueOn: item.dueOn, recall }] : [];
  });

  return {
    items,
    counts,
    total,
    tomorrow: total > 0 ? 0 : await countTomorrow(userId, today, recalls.tomorrow),
  };
}

/** Destaques prontos para a tela, como na revisao de destaques. */
async function highlightCardsFor(
  userId: string,
  rows: {
    id: string;
    textId: string;
    start: number;
    end: number;
    note: string | null;
    cardPrompt: string | null;
    cardAnswer: string | null;
    interval: number;
    createdAt: Date;
  }[]
): Promise<Map<string, HighlightReviewCard>> {
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
      { title: source.title, words: parseParagraphs(source.content, asTextFormat(source.format)).words },
    ])
  );

  const cards = new Map<string, HighlightReviewCard>();
  for (const row of rows) {
    const source = parsed.get(row.textId);
    const words = source?.words.slice(row.start, row.end) ?? [];
    if (!source || words.length === 0) continue;
    cards.set(row.id, {
      id: row.id,
      textId: row.textId,
      textTitle: source.title,
      start: row.start,
      words,
      blank: heaviestWordIndex(words),
      note: row.note,
      card: row.cardPrompt && row.cardAnswer ? { prompt: row.cardPrompt, answer: row.cardAnswer } : null,
      interval: currentInterval(row.interval),
      createdAt: new Date(row.createdAt).toISOString(),
    });
  }
  return cards;
}
