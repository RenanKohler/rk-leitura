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
  | "etiquetas"
  | "sugestoes"
  | "cartoes"
  | "secoes"
  | "semana"
  | "estudo"
  | "cartao"
  | "glossario"
  | "fichamento"
  | "guia"
  | "apontamentos"
  | "analogia";

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
  // Perguntas sugeridas (US-148): curtas e de alto volume.
  sugestoes: HAIKU,
  // Cartoes de revisao (US-150) e ideias da semana (US-154): texto curto, mas
  // com escolha do que importa.
  cartoes: SONNET,
  semana: SONNET,
  // Secoes de um documento longo (US-153): entrada longa, saida fechada.
  secoes: SONNET,
  // Aprendizado assistido (US-155 a US-170). O texto inteiro e a escolha do
  // que importa pedem o Sonnet; um cartao de um trecho, as perguntas-guia e a
  // analogia sao curtos e vao no Haiku.
  estudo: SONNET,
  glossario: SONNET,
  fichamento: SONNET,
  apontamentos: SONNET,
  cartao: HAIKU,
  guia: HAIKU,
  analogia: HAIKU,
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
  /** O modelo recusou: um texto parcial ja mostrado deve ser descartado (US-145). */
  readonly refusal: boolean;
  constructor(message: string, status = 503, refusal = false) {
    super(message);
    this.name = "AiUnavailable";
    this.status = status;
    this.refusal = refusal;
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

/** Como a chamada terminou (US-141). */
export type AiOutcome = "sucesso" | "recusa" | "tempo" | "falha";

const NO_USAGE: UsageLike = { input_tokens: 0, output_tokens: 0 };

/** O que a chamada levou do texto do leitor (US-144). */
export interface SentFrom {
  /** Texto de onde saiu o conteudo; ausente no dicionario e na importacao. */
  textId?: string | null;
  /** Palavras do texto enviadas. */
  wordsSent?: number;
}

export interface UsageExtra extends SentFrom {
  batch?: boolean;
  outcome?: AiOutcome;
  /** Tempo ate o primeiro trecho, nas chamadas com streaming (US-145). */
  firstTokenMs?: number | null;
}

/** Palavras de um trecho, para o registro do que foi enviado (US-144). */
export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

/** Grava o uso de uma chamada. Falhar aqui nunca derruba a resposta ao leitor. */
export async function recordUsage(
  userId: string,
  task: AiTask,
  model: string,
  usage: UsageLike,
  extra: UsageExtra = {}
): Promise<void> {
  const outcome = extra.outcome ?? "sucesso";
  console.info(`[ia] ${task} (${outcome}):`, model, JSON.stringify(usage));
  try {
    await db.insert(aiUsage).values({
      userId,
      feature: task,
      model,
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      cacheReadTokens: usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
      batch: extra.batch ?? false,
      outcome,
      textId: extra.textId ?? null,
      wordsSent: Math.max(0, Math.trunc(extra.wordsSent ?? 0)),
      firstTokenMs: extra.firstTokenMs ?? null,
    });
  } catch (error) {
    console.error("[ia] falha ao registrar uso:", error);
  }
}

// --- Chamadas --------------------------------------------------------------

type Effort = "low" | "medium" | "high";

export interface CallOptions extends SentFrom {
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

/** Classifica a falha de uma chamada para o registro (US-141). */
export function failureOutcome(error: unknown): AiOutcome {
  return error instanceof Anthropic.APIConnectionTimeoutError ? "tempo" : "falha";
}

/**
 * Registra uma chamada que nao chegou a responder. Sem chave nada saiu do
 * app, entao nao ha o que registrar.
 */
export async function recordFailure(options: CallOptions, error: unknown): Promise<void> {
  if (error instanceof AiUnavailable) return;
  await recordUsage(options.userId, options.task, AI_MODELS[options.task], NO_USAGE, {
    textId: options.textId,
    wordsSent: options.wordsSent,
    outcome: failureOutcome(error),
  });
}

/** Registro de uma chamada que respondeu, com recusa ou sucesso. */
export async function recordResponse(
  options: CallOptions,
  response: { model: string; usage: UsageLike; stop_reason: string | null },
  firstTokenMs?: number | null
): Promise<void> {
  await recordUsage(options.userId, options.task, response.model, response.usage, {
    textId: options.textId,
    wordsSent: options.wordsSent,
    outcome: response.stop_reason === "refusal" ? "recusa" : "sucesso",
    firstTokenMs,
  });
}

export function translate(error: unknown, messages: AiMessages, scope: string): AiUnavailable {
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
    await recordFailure(options, error);
    throw translate(error, options.messages, options.task);
  }

  await recordResponse(options, response);

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
    await recordFailure(options, error);
    throw translate(error, options.messages, options.task);
  }

  await recordResponse(options, response);

  if (response.stop_reason === "refusal") throw new AiUnavailable(options.messages.refusal);
  return response;
}

/** Saida estruturada pedida em streaming: so o esquema JSON, sem analise automatica. */
export function jsonFormat(schema: z.ZodType): Anthropic.Beta.BetaJSONOutputFormat {
  return { type: "json_schema", schema: betaZodOutputFormat(schema).schema };
}

/** O leitor fechou a folha ou a conexao caiu: nao ha a quem responder. */
export class AiAborted extends Error {
  constructor() {
    super("Pedido cancelado.");
    this.name = "AiAborted";
  }
}

export interface StreamOptions extends CallOptions {
  /** Saida estruturada: os trechos que chegam sao o JSON da resposta. */
  format?: Anthropic.Beta.BetaJSONOutputFormat;
  /** Cancela a chamada, por exemplo quando o cliente desconecta. */
  signal?: AbortSignal;
  /** Cada trecho de texto, na ordem em que chega. */
  onText: (delta: string) => void;
}

/**
 * Uso de uma chamada interrompida. O total de saida so chega no fim; antes
 * disso ele e estimado pelo texto ja recebido (cerca de 4 caracteres por
 * token), para o registro corresponder ao que foi gerado (US-145).
 */
function partialUsage(message: Anthropic.Beta.BetaMessage | undefined, chars: number): UsageLike {
  const usage = message?.usage;
  return {
    input_tokens: usage?.input_tokens ?? 0,
    output_tokens: Math.max(usage?.output_tokens ?? 0, Math.ceil(chars / 4)),
    cache_read_input_tokens: usage?.cache_read_input_tokens ?? 0,
    cache_creation_input_tokens: usage?.cache_creation_input_tokens ?? 0,
  };
}

/**
 * Pedido com streaming (US-145). Repassa cada trecho de texto a `onText` e
 * devolve a mensagem final, com as citacoes e o uso completos.
 *
 * Consentimento e cota continuam com a rota, antes da chamada. Aqui ficam o
 * registro de uso com o tempo ate o primeiro trecho, a recusa e o
 * cancelamento: fechar a folha aborta a chamada, e o uso registrado e o que ja
 * tinha sido gerado.
 */
export async function aiStream(options: StreamOptions): Promise<Anthropic.Beta.BetaMessage> {
  const client = aiClient(options.messages);
  const model = AI_MODELS[options.task];
  const controller = new AbortController();
  let timedOut = false;
  const cancel = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  options.signal?.addEventListener("abort", cancel);
  const timer = options.timeoutMs
    ? setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, options.timeoutMs)
    : null;

  const started = Date.now();
  let firstTokenMs: number | null = null;
  let chars = 0;
  let stream: ReturnType<typeof client.beta.messages.stream> | null = null;

  try {
    stream = client.beta.messages.stream(
      {
        model,
        max_tokens: options.maxTokens,
        system: options.system,
        output_config: options.format
          ? { effort: options.effort, format: options.format }
          : { effort: options.effort },
        ...fallbackParams(model),
        messages: options.content,
      },
      { signal: controller.signal, ...(options.timeoutMs ? { maxRetries: 0 } : {}) }
    );

    for await (const event of stream) {
      if (event.type !== "content_block_delta" || event.delta.type !== "text_delta") continue;
      if (firstTokenMs === null) firstTokenMs = Date.now() - started;
      chars += event.delta.text.length;
      options.onText(event.delta.text);
    }
    const response = await stream.finalMessage();
    await recordResponse(options, response, firstTokenMs);

    // Recusa no meio do texto: o que ja foi enviado deve ser descartado.
    if (response.stop_reason === "refusal") {
      throw new AiUnavailable(options.messages.refusal, 503, true);
    }
    return response;
  } catch (error) {
    if (error instanceof AiUnavailable) throw error;
    const cancelled = controller.signal.aborted && !timedOut;
    const outcome: AiOutcome = timedOut ? "tempo" : failureOutcome(error);
    await recordUsage(
      options.userId,
      options.task,
      stream?.currentMessage?.model ?? model,
      partialUsage(stream?.currentMessage, chars),
      { textId: options.textId, wordsSent: options.wordsSent, outcome, firstTokenMs }
    );
    if (cancelled) throw new AiAborted();
    if (timedOut) throw new AiUnavailable(options.messages.failure);
    throw translate(error, options.messages, options.task);
  } finally {
    if (timer) clearTimeout(timer);
    options.signal?.removeEventListener("abort", cancel);
  }
}

/** Resposta de erro de uma funcionalidade de IA, com o status certo. */
export function aiErrorResponse(error: AiUnavailable, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: error.message, ...extra }, { status: error.status });
}
