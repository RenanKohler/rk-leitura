import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import type { z } from "zod";
import { db } from "@/db";
import { aiUsage, speedSettings } from "@/db/schema";

/**
 * Ponto unico de acesso ao modelo de linguagem (US-123).
 *
 * E o unico lugar da aplicacao que envia conteudo do usuario para fora. Chave,
 * modelo, fallback, traducao de erro, consentimento da conta (US-125) e
 * registro de uso (US-124) ficam aqui, para que cada funcionalidade so diga o
 * que pedir e como validar a resposta.
 */

/** Recusa dos classificadores de seguranca e refeita em outro modelo na mesma chamada. */
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

const OPUS = "claude-opus-5-5";
const SONNET = "claude-sonnet-5-5";
const HAIKU = "claude-haiku-5-5";

/**
 * Tarefa que chama o modelo. Mais fina que a cota: a sinopse conta como
 * resumo, mas e curta o bastante para um modelo menor.
 */
export type AiTask =
  | "questionario"
  | "dicionario"
  | "explicacao"
  | "pergunta"
  | "resumo"
  | "sinopse"
  | "limpeza"
  | "etiquetas";

/**
 * Modelo de cada tarefa (decidido sobre a recomendacao da familia 5.5):
 *
 * - Opus, onde a qualidade e a medida: as perguntas do questionario e as
 *   respostas com citacao. No Opus 5.5 a leitura de cache custa o mesmo que
 *   no Sonnet, entao a conversa com o texto so paga a diferenca na primeira
 *   pergunta.
 * - Sonnet, onde a entrada e longa ou a resposta precisa de nuance:
 *   explicacao de frase e resumos.
 * - Haiku, onde o volume e alto e a saida e curta ou fechada: dicionario,
 *   limpeza da importacao, etiquetas e sinopse.
 *
 * Trocar uma tarefa de modelo e mudar uma linha aqui; `ai_usage` registra o
 * modelo que respondeu, entao a comparacao de custo sai de la (US-124).
 */
export const AI_MODELS: Record<AiTask, string> = {
  questionario: OPUS,
  pergunta: OPUS,
  explicacao: SONNET,
  resumo: SONNET,
  dicionario: HAIKU,
  limpeza: HAIKU,
  etiquetas: HAIKU,
  sinopse: HAIKU,
};

/**
 * O Haiku nao tem fallback no servidor: com `fallbacks` a recusa continua
 * recusa, e uma lista de modelos e rejeitada. Para ele o parametro sai.
 */
function fallbackParams(model: string) {
  return model.startsWith("claude-haiku")
    ? {}
    : { betas: [FALLBACK_BETA], fallbacks: "default" as const };
}

export const AI_BUSY = "O serviço está ocupado. Tente daqui a pouco.";
export const AI_DISABLED = "Os recursos de IA estão desligados nesta conta.";
export const AI_PENDING = "Permita o envio do conteúdo ao serviço de IA para usar esta função.";

/** Mensagens que cada funcionalidade mostra quando o modelo nao responde. */
export interface AiMessages {
  /** Sem chave configurada. */
  notConfigured: string;
  /** O modelo recusou mesmo depois do fallback. */
  refusal: string;
  /** Qualquer outra falha. */
  failure: string;
}

export class AiUnavailable extends Error {
  readonly status: number;
  constructor(message: string, status = 503) {
    super(message);
    this.name = "AiUnavailable";
    this.status = status;
  }
}

export function aiConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

let cached: Anthropic | null = null;

/** Cliente preguicoso: sem chave configurada, a funcionalidade fica indisponivel. */
export function aiClient(messages: Pick<AiMessages, "notConfigured">): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) throw new AiUnavailable(messages.notConfigured);
  if (!cached || cached.apiKey !== apiKey) cached = new Anthropic({ apiKey });
  return cached;
}

// --- Consentimento (US-125) ------------------------------------------------

export type AiConsent = "on" | "off" | "pending";

export async function aiConsent(userId: string): Promise<AiConsent> {
  const [row] = await db
    .select({ aiEnabled: speedSettings.aiEnabled })
    .from(speedSettings)
    .where(eq(speedSettings.userId, userId))
    .limit(1);
  if (row?.aiEnabled === true) return "on";
  if (row?.aiEnabled === false) return "off";
  return "pending";
}

/**
 * Resposta 403 pronta quando a conta nao permitiu o envio, ou null.
 *
 * Roda antes da cota: uma chamada recusada aqui nao gasta nada. O campo
 * `consent` diz a tela se ela deve perguntar (`pending`) ou so informar
 * (`off`).
 */
export async function aiGate(
  userId: string,
  extra?: Record<string, unknown>
): Promise<NextResponse | null> {
  // Sem chave nada sairia do app de qualquer jeito: a funcao responde que nao
  // esta configurada, em vez de pedir uma permissao que nao serviria.
  if (!aiConfigured()) return null;
  const consent = await aiConsent(userId);
  if (consent === "on") return null;
  return NextResponse.json(
    { error: consent === "off" ? AI_DISABLED : AI_PENDING, consent, ...extra },
    { status: 403 }
  );
}

// --- Uso (US-124) ----------------------------------------------------------

interface UsageLike {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

/** Grava o uso de uma chamada. Falhar aqui nunca derruba a resposta ao leitor. */
export async function recordUsage(
  userId: string,
  task: AiTask,
  model: string,
  usage: UsageLike,
  batch = false
): Promise<void> {
  console.info(`[ia] ${task}:`, model, JSON.stringify(usage));
  try {
    await db.insert(aiUsage).values({
      userId,
      feature: task,
      model,
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      cacheReadTokens: usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
      batch,
    });
  } catch (error) {
    console.error("[ia] falha ao registrar uso:", error);
  }
}

// --- Chamadas --------------------------------------------------------------

type Effort = "low" | "medium" | "high";

interface CallOptions {
  /** Decide o modelo e o nome gravado no uso. */
  task: AiTask;
  userId: string;
  messages: AiMessages;
  system: string;
  content: Anthropic.Beta.BetaMessageParam[];
  effort: Effort;
  maxTokens: number;
  /** Tempo maximo da chamada, em milissegundos. */
  timeoutMs?: number;
}

function translate(error: unknown, messages: AiMessages, scope: string): AiUnavailable {
  if (error instanceof AiUnavailable) return error;
  if (error instanceof Anthropic.RateLimitError) return new AiUnavailable(AI_BUSY);
  if (error instanceof Anthropic.AuthenticationError) {
    return new AiUnavailable(messages.notConfigured);
  }
  console.error(`[ia] ${scope} falhou:`, error);
  return new AiUnavailable(messages.failure);
}

/**
 * Pedido com saida estruturada. Devolve o objeto ja analisado pelo esquema,
 * ou null quando a resposta nao casou com ele - a validacao propria de cada
 * funcionalidade decide o que fazer com isso.
 */
export async function aiParse<S extends z.ZodType>(
  options: CallOptions & { schema: S }
): Promise<z.infer<S> | null> {
  let response;
  try {
    response = await aiClient(options.messages).beta.messages.parse(
      {
        model: AI_MODELS[options.task],
        max_tokens: options.maxTokens,
        system: options.system,
        output_config: { effort: options.effort, format: betaZodOutputFormat(options.schema) },
        ...fallbackParams(AI_MODELS[options.task]),
        messages: options.content,
      },
      options.timeoutMs ? { timeout: options.timeoutMs, maxRetries: 0 } : undefined
    );
  } catch (error) {
    throw translate(error, options.messages, options.task);
  }

  await recordUsage(options.userId, options.task, response.model, response.usage);

  // O modelo pode recusar por seguranca, e o fallback nem sempre resolve.
  if (response.stop_reason === "refusal") throw new AiUnavailable(options.messages.refusal);
  return (response.parsed_output ?? null) as z.infer<S> | null;
}

/**
 * Pedido de texto livre - usado onde a saida estruturada nao cabe, como nas
 * respostas com citacoes (US-128), que a API nao combina com `format`.
 */
export async function aiCreate(
  options: CallOptions
): Promise<Anthropic.Beta.BetaMessage> {
  let response;
  try {
    response = await aiClient(options.messages).beta.messages.create(
      {
        model: AI_MODELS[options.task],
        max_tokens: options.maxTokens,
        system: options.system,
        output_config: { effort: options.effort },
        ...fallbackParams(AI_MODELS[options.task]),
        messages: options.content,
      },
      options.timeoutMs ? { timeout: options.timeoutMs, maxRetries: 0 } : undefined
    );
  } catch (error) {
    throw translate(error, options.messages, options.task);
  }

  await recordUsage(options.userId, options.task, response.model, response.usage);

  if (response.stop_reason === "refusal") throw new AiUnavailable(options.messages.refusal);
  return response;
}

/** Resposta de erro de uma funcionalidade de IA, com o status certo. */
export function aiErrorResponse(error: AiUnavailable, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: error.message, ...extra }, { status: error.status });
}
