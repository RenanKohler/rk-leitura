/**
 * Regras de meta diaria e de sequencia de dias.
 *
 * Funcoes puras sobre agregados ja calculados no banco. A parte dificil aqui
 * nao e a aritmetica, e a definicao de "dia": sem o fuso do usuario, uma
 * leitura das 22h em Sao Paulo cai no dia seguinte e derruba uma sequencia
 * que nao foi quebrada.
 */

export const GOAL_KINDS = ["minutos", "palavras"] as const;
export type GoalKind = (typeof GOAL_KINDS)[number];

export const GOAL_LIMITS: Record<GoalKind, { min: number; max: number }> = {
  minutos: { min: 5, max: 180 },
  palavras: { min: 500, max: 50_000 },
};

export function asGoalKind(value: unknown): GoalKind {
  return GOAL_KINDS.includes(value as GoalKind) ? (value as GoalKind) : "minutos";
}

export interface Goal {
  kind: GoalKind;
  target: number;
  /** Primeiro dia de vigencia, em `AAAA-MM-DD` no fuso do usuario. */
  startsOn: string;
}

/** Quanto foi lido em um dia, ja agrupado no fuso do usuario. */
export interface DayTotals {
  /** `AAAA-MM-DD`. */
  day: string;
  minutes: number;
  words: number;
}

/** Fuso valido e conhecido pelo ambiente, ou "UTC". */
export function asTimezone(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) return "UTC";
  try {
    // A propria Intl e a lista de fusos: manter uma copia aqui significaria
    // recusar fusos criados depois deste codigo.
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return value;
  } catch {
    return "UTC";
  }
}

/** Dia corrente no fuso informado, em `AAAA-MM-DD`. */
export function todayIn(timezone: string, now = new Date()): string {
  // `en-CA` ja formata como AAAA-MM-DD, o que evita remontar a data a mao.
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(now);
}

/** Dia anterior a `day`, sem depender de fuso: a data ja esta resolvida. */
export function previousDay(day: string): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

/** Segunda-feira da semana de `day`. */
export function mondayOf(day: string): string {
  const date = new Date(`${day}T12:00:00Z`);
  // getUTCDay: 0 e domingo. A semana do resumo comeca na segunda.
  const offset = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - offset);
  return date.toISOString().slice(0, 10);
}

/** Meta vigente em `day`: a de inicio mais recente que nao seja futura. */
export function goalOn(goals: Goal[], day: string): Goal | null {
  let chosen: Goal | null = null;
  for (const goal of goals) {
    if (goal.startsOn <= day && (chosen === null || goal.startsOn > chosen.startsOn)) {
      chosen = goal;
    }
  }
  return chosen;
}

/** O que conta para a meta, conforme o tipo escolhido. */
export function progressFor(goal: Goal, totals: DayTotals | undefined): number {
  if (!totals) return 0;
  return goal.kind === "minutos" ? totals.minutes : totals.words;
}

export function goalMet(goal: Goal, totals: DayTotals | undefined): boolean {
  return progressFor(goal, totals) >= goal.target;
}

export interface Streak {
  /** Dias seguidos cumpridos ate hoje (ou ate ontem, se hoje esta pendente). */
  current: number;
  /** Maior sequencia ja alcancada. */
  best: number;
  /** Hoje ainda nao foi cumprido, mas a sequencia segue viva por ontem. */
  pendingToday: boolean;
}

/**
 * Sequencia de dias, avaliando cada dia pela meta que valia nele.
 *
 * Hoje nao quebra a sequencia enquanto o dia nao acabou - so sinaliza
 * pendencia. Ontem em aberto, sim: ali o dia ja passou.
 */
export function computeStreak(
  days: DayTotals[],
  goals: Goal[],
  today: string,
  /** Quantos dias para tras vale a pena olhar. */
  horizon = 400
): Streak {
  if (goals.length === 0) return { current: 0, best: 0, pendingToday: false };

  const byDay = new Map(days.map((entry) => [entry.day, entry]));

  const met = (day: string): boolean => {
    const goal = goalOn(goals, day);
    return goal !== null && goalMet(goal, byDay.get(day));
  };

  const pendingToday = !met(today);

  let current = 0;
  let cursor = pendingToday ? previousDay(today) : today;
  for (let step = 0; step < horizon && met(cursor); step += 1) {
    current += 1;
    cursor = previousDay(cursor);
  }

  // A melhor sequencia varre os dias com leitura registrada: um dia sem
  // registro nunca cumpriu meta, entao ele so pode encerrar uma sequencia.
  let best = current;
  let run = 0;
  let expected: string | null = null;
  for (const day of [...byDay.keys()].sort()) {
    run = expected === day ? run : 0;
    if (met(day)) {
      run += 1;
      best = Math.max(best, run);
    } else {
      run = 0;
    }
    expected = nextDay(day);
  }

  return { current, best, pendingToday };
}

function nextDay(day: string): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}
