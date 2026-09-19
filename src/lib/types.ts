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
  /** Etiquetas do texto, em ordem alfabetica. */
  tags: string[];
  /** Identidade da serie, quando o capitulo foi reconhecido. */
  seriesKey: string | null;
  /** Nome da serie como ela aparece na tela. */
  seriesTitle: string | null;
  /** Numero do capitulo dentro da serie. */
  chapter: number | null;
  /** Posicao na fila de leitura; nulo quando o texto nao esta na fila. */
  queuePosition: number | null;
  /** Nulo enquanto o texto esta na lista principal. */
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Uma palavra consultada, como a lista a mostra. */
export interface SavedWordItem {
  id: string;
  word: string;
  base: string;
  kind: string;
  definition: string;
  /** Texto em que ela foi encontrada; nulo quando o texto foi apagado. */
  textId: string | null;
  textTitle: string | null;
  createdAt: string;
}

/** Etiqueta com quantos textos ela marca. */
export interface TagSummary {
  id: string;
  name: string;
  texts: number;
}

/** Um grupo de capitulos da mesma historia, como o cartao da biblioteca o ve. */
export interface SeriesSummary {
  kind: "serie";
  key: string;
  /** Titulo sem a marca de capitulo. */
  title: string;
  /** Capitulos em ordem. */
  chapters: TextSummary[];
  /** Numero do capitulo em que a leitura esta. */
  current: number;
  total: number;
  /** Soma das palavras de todos os capitulos. */
  wordCount: number;
  updatedAt: string;
}

/** Item da biblioteca: um texto solto ou uma serie inteira. */
export type LibraryItem = { kind: "texto"; text: TextSummary } | SeriesSummary;

/** O que a tela de conclusao oferece como proxima leitura. */
export interface NextUp {
  /** "capitulo" segue a serie; "fila" segue a ordem montada a mao. */
  source: "capitulo" | "fila";
  /** Texto ja na biblioteca. */
  textId?: string;
  title?: string;
  /** Endereco a importar, quando o capitulo seguinte ainda nao foi baixado. */
  importUrl?: string;
  chapter?: number;
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
  /** Sessao ouvida em voz alta. */
  narrated: boolean;
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
  /** Enfase nas primeiras letras de cada palavra. */
  wordEmphasis: boolean;
  /** Fuso IANA usado para decidir o que e "hoje". */
  timezone: string;
  /** Segunda-feira da ultima semana em que o resumo foi dispensado. */
  weeklySummarySeenOn: string | null;
  /** Velocidade medida no teste inicial; nulo enquanto ele nao foi feito. */
  placementWpm: number | null;
  /** Se o teste ja foi oferecido - feito ou pulado. */
  placementSeen: boolean;
  /** Hora local do lembrete diario; nulo quando nao ha lembrete. */
  reminderHour: number | null;
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
