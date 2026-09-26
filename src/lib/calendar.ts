/**
 * Calendario do ano (US-102) e resumo de leitura de um texto (US-101).
 * Funcoes puras, testaveis sem banco.
 */

export const CALENDAR_WEEKS = 53;

/** Nivel de 0 a 4 pelos minutos lidos no dia. */
export function calendarLevel(minutes: number): 0 | 1 | 2 | 3 | 4 {
  if (minutes <= 0) return 0;
  if (minutes <= 5) return 1;
  if (minutes <= 15) return 2;
  if (minutes <= 30) return 3;
  return 4;
}

export interface CalendarDay {
  day: string;
  minutes: number;
  level: 0 | 1 | 2 | 3 | 4;
  /** Dia depois de hoje, so para completar a ultima coluna. */
  future: boolean;
}

function shift(day: string, days: number): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Primeiro dia da grade: o domingo de 52 semanas antes da semana de hoje. */
export function calendarStart(today: string): string {
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  return shift(today, -weekday - (CALENDAR_WEEKS - 1) * 7);
}

/**
 * Grade de 53 colunas (semanas, domingo a sabado) terminando na semana de
 * hoje. `days` vem ja agrupado no fuso do leitor, entao cada dia da grade e
 * um dia local.
 */
export function yearGrid(days: { day: string; minutes: number }[], today: string): CalendarDay[][] {
  const minutes = new Map(days.map((item) => [item.day, item.minutes]));
  const weeks: CalendarDay[][] = [];
  let cursor = calendarStart(today);

  for (let week = 0; week < CALENDAR_WEEKS; week += 1) {
    const column: CalendarDay[] = [];
    for (let weekday = 0; weekday < 7; weekday += 1) {
      const value = minutes.get(cursor) ?? 0;
      column.push({ day: cursor, minutes: value, level: calendarLevel(value), future: cursor > today });
      cursor = shift(cursor, 1);
    }
    weeks.push(column);
  }
  return weeks;
}

export interface TextSessionRow {
  durationMs: number;
  wordsRead: number;
  wpm: number;
  createdAt: Date;
}

export interface TextHistory {
  sessions: number;
  totalMs: number;
  /** Ritmo medio ponderado pelas palavras de cada sessao. */
  wpm: number;
  firstAt: string | null;
  lastAt: string | null;
}

export function textHistory(rows: TextSessionRow[]): TextHistory {
  if (rows.length === 0) return { sessions: 0, totalMs: 0, wpm: 0, firstAt: null, lastAt: null };
  const sorted = [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const words = rows.reduce((sum, row) => sum + row.wordsRead, 0);
  const weighted = rows.reduce((sum, row) => sum + row.wpm * row.wordsRead, 0);
  return {
    sessions: rows.length,
    totalMs: rows.reduce((sum, row) => sum + row.durationMs, 0),
    wpm: words > 0 ? Math.round(weighted / words) : 0,
    firstAt: sorted[0]!.createdAt.toISOString(),
    lastAt: sorted.at(-1)!.createdAt.toISOString(),
  };
}
