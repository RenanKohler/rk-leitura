/**
 * Teto diario por conta das funcoes que chamam o modelo de linguagem (US-72).
 *
 * O limite por IP continua valendo e protege contra laco acidental; este
 * protege a conta de modelo contra uma unica conta que troque de rede. So
 * conta o que gera chamada nova: questionario ja gerado e palavra ja
 * consultada voltam do banco e nao gastam cota.
 */

export const DAILY_QUOTAS = {
  questionario: 20,
  dicionario: 200,
} as const;

export type QuotaKind = keyof typeof DAILY_QUOTAS;

export const QUOTA_MESSAGES: Record<QuotaKind, string> = {
  questionario: "Limite diario de questionarios atingido. Volta a valer amanha.",
  dicionario: "Limite diario de consultas ao dicionario atingido. Volta a valer amanha.",
};

/**
 * Chave do contador. O dia entra na chave, entao a virada do dia no fuso do
 * usuario comeca um contador novo sem depender de a janela anterior vencer.
 */
export function quotaKey(kind: QuotaKind, userId: string, day: string): string {
  return `${kind}-dia:${userId}:${day}`;
}

/** Segundos ate a proxima meia-noite no fuso informado. */
export function secondsUntilNextDay(timezone: string, now = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const read = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  const elapsed = read("hour") * 3600 + read("minute") * 60 + read("second");
  return Math.max(1, 24 * 3600 - elapsed);
}
