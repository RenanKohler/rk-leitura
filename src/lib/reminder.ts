/**
 * Lembrete diario de leitura.
 *
 * A pergunta que a regra responde e: ja passou da hora escolhida, hoje, sem
 * que essa pessoa tenha lido? Funcoes puras para que a resposta nao dependa
 * de quando o agendador roda - que e justamente o que varia entre planos da
 * hospedagem.
 */

export const MIN_REMINDER_HOUR = 0;
export const MAX_REMINDER_HOUR = 23;

/** Hora valida, ou null quando o leitor nao quer lembrete. */
export function asReminderHour(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const hour = Math.trunc(Number(value));
  if (!Number.isInteger(hour) || hour < MIN_REMINDER_HOUR || hour > MAX_REMINDER_HOUR) {
    return null;
  }
  return hour;
}

/**
 * Hora local de quem le, a partir do fuso guardado.
 *
 * `Intl` faz a conta do horario de verao junto; somar um deslocamento fixo
 * erraria duas vezes por ano.
 */
export function hourIn(timezone: string, now = new Date()): number {
  try {
    const formatted = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      hour: "2-digit",
      hour12: false,
    }).format(now);
    const hour = Number(formatted);
    return Number.isInteger(hour) ? hour % 24 : now.getUTCHours();
  } catch {
    return now.getUTCHours();
  }
}

export interface ReminderCandidate {
  /** Hora escolhida pelo leitor. */
  reminderHour: number | null;
  /** Fuso IANA do leitor. */
  timezone: string;
  /** Ultimo dia em que o lembrete saiu, no fuso do leitor. */
  reminderSentOn: string | null;
  /** Ja cumpriu a meta de hoje? */
  metGoal: boolean;
  /** Leu alguma coisa hoje? */
  readToday: boolean;
}

/**
 * Deve sair lembrete agora?
 *
 * "A hora ja passou" em vez de "e exatamente esta hora": o agendador da
 * hospedagem pode rodar de hora em hora ou uma vez por dia, e com a
 * comparacao exata quem escolheu 19h nunca receberia nada no plano que roda
 * so uma vez. Com esta regra, o lembrete sai no primeiro disparo depois da
 * hora escolhida - e a marca do dia garante que saia uma vez so.
 */
export function shouldRemind(
  candidate: ReminderCandidate,
  today: string,
  now = new Date()
): boolean {
  if (candidate.reminderHour === null) return false;
  // Ja leu: o lembrete existe para quem esqueceu, nao para quem ja cumpriu.
  if (candidate.metGoal || candidate.readToday) return false;
  if (candidate.reminderSentOn === today) return false;

  return hourIn(candidate.timezone, now) >= candidate.reminderHour;
}

/** Texto do lembrete, com a sequencia quando ela existe. */
export function reminderBody(streak: number): string {
  if (streak >= 2) {
    return `Voce esta em ${streak} dias seguidos. Uma leitura curta mantem a sequencia.`;
  }
  return "Voce ainda nao leu hoje. Que tal alguns minutos agora?";
}
