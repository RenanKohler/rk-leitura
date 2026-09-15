import type { ReadingMode } from "@/lib/reading";

/** Formatos devolvidos pelas rotas internas, consumidos no cliente. */

export interface TextSummary {
  id: string;
  title: string;
  sourceUrl: string | null;
  wordCount: number;
  progressIndex: number;
  createdAt: string;
  updatedAt: string;
}

export interface TextDetail extends TextSummary {
  content: string;
}

export interface SessionSummary {
  id: string;
  textId: string;
  textTitle: string;
  wpm: number;
  wordsRead: number;
  durationMs: number;
  completed: boolean;
  createdAt: string;
}

export interface ImportedText {
  title: string;
  content: string;
  wordCount: number;
  sourceUrl: string;
}

export interface SettingsPayload {
  baseWpm: number;
  wordsPerChunk: number;
  highlightOpacity: number;
  readingMode: ReadingMode;
  theme: "system" | "light" | "dark";
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
