import "server-only";

import type { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError } from "@/lib/api";
import {
  aiConfigured,
  aiConsent,
  aiGate,
  aiParse,
  AiUnavailable,
  type AiConsent,
  type AiMessages,
} from "@/lib/ai";
import { consumeDailyQuota, readDailyUsage } from "@/lib/daily-quota";
import { DAILY_QUOTAS, QUOTA_MESSAGES } from "@/lib/quota";
import {
  CHAPTER_MAX_POINTS,
  CHAPTER_MAX_WORDS,
  NAME_DESCRIPTION_WORDS,
  normalizeDescriptions,
  normalizePoints,
  SUMMARY_MAX_POINTS,
  SUMMARY_MAX_WORDS,
  SUMMARY_MIN_POINTS,
  type SummaryRequest,
} from "@/lib/summaries";

/**
 * Chamadas ao modelo da retomada com resumo (US-130 a US-132). Os recortes
 * vem montados de `lib/summaries.ts`; aqui so o esquema, o sistema e a
 * validacao da resposta.
 */

const MESSAGES: AiMessages = {
  notConfigured: "Os resumos não estão configurados nesta instalação.",
  refusal: "Não consigo resumir este texto.",
  failure: "Não consegui resumir agora.",
};

const NAME_MESSAGES: AiMessages = {
  notConfigured: "As descrições não estão configuradas nesta instalação.",
  refusal: "Não consigo descrever os nomes deste texto.",
  failure: "Não consegui descrever os nomes agora.",
};

/** Tempo maximo da chamada: o leitor esta esperando para retomar. */
const TIMEOUT_MS = 45_000;

const SYSTEM = [
  "Você resume, em português do Brasil, textos que a pessoa está lendo.",
  "Use só o que está no trecho enviado; não complete com o que você sabe da obra nem antecipe o que vem depois.",
  "Escreva tópicos curtos e concretos: quem, o quê, qual argumento. Sem introdução nem conclusão genérica.",
].join(" ");

const NAMES_SYSTEM = [
  "Você descreve, em português do Brasil, personagens, lugares e termos de um texto que a pessoa está lendo.",
  "Use só o que está no trecho enviado; não complete com o que você sabe da obra nem antecipe o que vem depois.",
  "Descreva apenas os nomes pedidos, exatamente como foram escritos na lista.",
].join(" ");

const PointsSchema = (min: number, max: number) =>
  z.object({
    points: z
      .array(z.string().describe("Um tópico, em uma frase curta."))
      .min(min)
      .max(max),
  });

const NamesSchema = z.object({
  names: z.array(
    z.object({
      name: z.string().describe("O nome exatamente como veio na lista."),
      known: z.boolean().describe("Falso quando o trecho não diz o bastante para descrever."),
      description: z
        .string()
        .describe(`Quem ou o que é, em até ${NAME_DESCRIPTION_WORDS} palavras; vazio quando falta contexto.`),
    })
  ),
});

/**
 * Pode oferecer um resumo novo agora? Chave configurada, conta sem IA
 * desligada e cota de resumos sobrando. Consentimento pendente conta como
 * disponivel: o pedido e que abre o aviso.
 */
export async function summaryAvailability(
  userId: string
): Promise<{ available: boolean; consent: AiConsent }> {
  if (!aiConfigured()) return { available: false, consent: "pending" };
  const consent = await aiConsent(userId);
  if (consent === "off") return { available: false, consent };
  const { used } = await readDailyUsage(userId);
  return { available: used.resumo < DAILY_QUOTAS.resumo, consent };
}

/**
 * Libera uma geracao nova: o consentimento antes (recusa ali nao gasta nada)
 * e depois a cota `resumo`, compartilhada pelas tres funcoes. Devolve a
 * resposta de recusa, ou null. Resultado guardado nunca passa por aqui.
 */
export async function admitSummary(userId: string): Promise<NextResponse | null> {
  const gate = await aiGate(userId);
  if (gate) return gate;
  // Sem chave a chamada falha logo adiante com a mensagem certa; a cota fica.
  if (!aiConfigured()) return null;
  const quota = await consumeDailyQuota("resumo", userId);
  if (!quota.allowed) {
    return jsonError(QUOTA_MESSAGES.resumo, 429, { retryAfter: quota.retryAfterSeconds });
  }
  return null;
}

/** Resumo do que ja li (US-130): de 3 a 5 topicos, ate 120 palavras. */
export async function generateReadSummary(userId: string, request: SummaryRequest): Promise<string[]> {
  const parsed = await aiParse({
    task: "resumo",
    userId,
    messages: MESSAGES,
    schema: PointsSchema(SUMMARY_MIN_POINTS, SUMMARY_MAX_POINTS),
    system: SYSTEM,
    maxTokens: 1500,
    effort: "low",
    timeoutMs: TIMEOUT_MS,
    content: [{ role: "user", content: request.prompt }],
  });
  const points = normalizePoints(parsed?.points, SUMMARY_MAX_POINTS, SUMMARY_MAX_WORDS);
  if (points.length < SUMMARY_MIN_POINTS) throw new AiUnavailable(MESSAGES.failure);
  return points;
}

/** Resumo do capitulo anterior (US-131): ate 5 topicos. */
export async function generateChapterSummary(
  userId: string,
  request: SummaryRequest
): Promise<string[]> {
  const parsed = await aiParse({
    task: "resumo",
    userId,
    messages: MESSAGES,
    schema: PointsSchema(1, CHAPTER_MAX_POINTS),
    system: SYSTEM,
    maxTokens: 1500,
    effort: "low",
    timeoutMs: TIMEOUT_MS,
    content: [{ role: "user", content: request.prompt }],
  });
  const points = normalizePoints(parsed?.points, CHAPTER_MAX_POINTS, CHAPTER_MAX_WORDS);
  if (points.length === 0) throw new AiUnavailable(MESSAGES.failure);
  return points;
}

/** Descricoes dos nomes (US-132), indexadas pelo nome da lista. */
export async function generateNameDescriptions(
  userId: string,
  request: SummaryRequest,
  listed: string[],
  sent: string[]
): Promise<Record<string, string | null>> {
  const parsed = await aiParse({
    task: "resumo",
    userId,
    messages: NAME_MESSAGES,
    schema: NamesSchema,
    system: NAMES_SYSTEM,
    maxTokens: 4000,
    effort: "low",
    timeoutMs: TIMEOUT_MS,
    content: [{ role: "user", content: request.prompt }],
  });
  if (!parsed) throw new AiUnavailable(NAME_MESSAGES.failure);
  return normalizeDescriptions(listed, sent, parsed.names);
}
