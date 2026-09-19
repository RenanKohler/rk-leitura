import type { FontFamily, ReadingMode } from "@/lib/reading";
import type { GoalKind } from "@/lib/goals";

/** Formatos devolvidos pelas rotas internas, consumidos no cliente. */

export interface TextSummary {
  id: string;
  title: string;
  sourceUrl: string | null;
  wordCount: number;
  progressIndex: number;
  /** Quantos trechos destacados o texto tem. */
  highlights: number;
  /** Nulo enquanto o texto esta na lista principal. */
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TextDetail extends TextSummary {
  content: string;
  /** Ultima pagina ja trazida da origem; a importacao inicial e a 1. */
  sourcePage: number;
}

/** Resposta de POST /api/texts/[id]/continuar. */
export interface ContinuationResult {
  status: "appended" | "end" | "unavailable" | "no-source" | "limit" | "full";
  page?: number;
  addedWords?: number;
  message?: string;
  text?: TextDetail;
}

export interface SessionSummary {
  id: string;
  textId: string;
  textTitle: string;
  wpm: number;
  wordsRead: number;
  durationMs: number;
  completed: boolean;
  /** Acertos do questionario, quando houve. */
  comprehension: number | null;
  createdAt: string;
}

export interface ImportedText {
  title: string;
  content: string;
  wordCount: number;
  sourceUrl: string;
}

/** Resposta de POST /api/share: o texto ja existia ou acabou de ser criado. */
export interface ShareResult {
  status: "created" | "existing";
  id: string;
  title: string;
}

/** Um destaque como a tela o consome: intervalo, trecho e nota. */
export interface HighlightItem {
  id: string;
  /** Primeira palavra do trecho, no indice do texto inteiro. */
  start: number;
  /** Primeira palavra depois do trecho. */
  end: number;
  note: string | null;
  /** Trecho citado, derivado do conteudo pelos indices. */
  excerpt: string;
  createdAt: string;
}

export interface SettingsPayload {
  baseWpm: number;
  wordsPerChunk: number;
  highlightOpacity: number;
  readingMode: ReadingMode;
  theme: "system" | "light" | "dark";
  fontScale: number;
  fontFamily: FontFamily;
  lineHeightStep: number;
  warmup: boolean;
  /** Fuso IANA usado para decidir o que e "hoje". */
  timezone: string;
  /** Segunda-feira da ultima semana em que o resumo foi dispensado. */
  weeklySummarySeenOn: string | null;
}

/** Resposta de GET/PUT /api/metas. */
export type GoalStatus =
  | { defined: false; today: string; timezone: string }
  | {
      defined: true;
      today: string;
      timezone: string;
      kind: GoalKind;
      target: number;
      progress: number;
      streak: number;
      bestStreak: number;
      pendingToday: boolean;
    };

/** Um ponto do grafico de evolucao. */
export interface TrendPoint {
  /** `AAAA-MM-DD` do dia, ou da segunda-feira quando a serie e semanal. */
  day: string;
  minutes: number;
  words: number;
  wpm: number;
}

export interface TrendData {
  daily: TrendPoint[];
  weekly: TrendPoint[];
  sessions: number;
}

/** Cartao de resumo da semana anterior, no painel. */
export interface WeeklySummary {
  /** Segunda-feira da semana resumida. */
  monday: string;
  minutes: number;
  words: number;
  wpm: number;
  texts: number;
  /** Variacao percentual contra a semana anterior; null quando nao ha base. */
  minutesChange: number | null;
  wpmChange: number | null;
}

export interface DashboardStats {
  texts: number;
  sessions: number;
  wordsRead: number;
  avgWpm: number;
  bestWpm: number;
}

export interface ContinueReading {
  id: string;
  title: string;
  wordCount: number;
  progressIndex: number;
}

/** Envelope comum das listas paginadas. */
export interface Paginated {
  total: number;
  page: number;
  perPage: number;
  pageCount: number;
}
