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
  /** Explicar uma frase (US-127). */
  explicacao: 100,
  /** Perguntar ao texto (US-128). */
  pergunta: 50,
  /** Resumos, descricoes de nomes, sinopses e sinteses (US-130 a US-132, US-138, US-140). */
  resumo: 30,
  /** Limpeza e etiquetas na importacao (US-136, US-137). */
  importacao: 50,
  /** Cartoes, glossario, fichamento, perguntas-guia e apontamentos (US-155 a US-170). */
  estudo: 30,
} as const;

export type QuotaKind = keyof typeof DAILY_QUOTAS;

/** Cada funcionalidade de IA e contada pela cota de mesmo nome. */
export type AiFeature = QuotaKind;

export const QUOTA_MESSAGES: Record<QuotaKind, string> = {
  questionario: "Limite diário de questionários atingido. Volta a valer amanhã.",
  dicionario: "Limite diário de consultas ao dicionário atingido. Volta a valer amanhã.",
  explicacao: "Limite diário de explicações atingido. Volta a valer amanhã.",
  pergunta: "Limite diário de perguntas atingido. Volta a valer amanhã.",
  resumo: "Limite diário de resumos atingido. Volta a valer amanhã.",
  importacao: "Limite diário de análises de importação atingido. Volta a valer amanhã.",
  estudo: "Limite diário de recursos de estudo atingido. Volta a valer amanhã.",
};

/** Nome de cada cota no cartao de uso (US-126). */
export const QUOTA_LABELS: Record<QuotaKind, string> = {
  questionario: "Questionários",
  dicionario: "Dicionário",
  explicacao: "Explicações",
  pergunta: "Perguntas ao texto",
  resumo: "Resumos",
  importacao: "Análises de importação",
  estudo: "Recursos de estudo",
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
