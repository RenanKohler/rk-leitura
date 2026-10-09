import "server-only";

import { z } from "zod";
import {
  aiParse,
  aiStream,
  AiUnavailable,
  countWords,
  jsonFormat,
  type AiMessages,
} from "@/lib/ai";
import { fieldDeltas } from "@/lib/ai-stream";
import {
  EXPLAIN_FAILURE,
  EXPLAIN_TIMEOUT_MS,
  explanationFields,
  FOLLOW_UP_WORDS,
  followUpPrompt,
  MAX_EXPLANATION_WORDS,
  parseExplanation,
  parseFollowUp,
  type ExplainRequest,
  type Explanation,
  type FollowUp,
} from "@/lib/explain";
import { DEFAULT_LANGUAGE, languageName } from "@/lib/language";

/**
 * Explicacao de uma frase dificil (US-127). O envio, a chave e o tratamento
 * de erro ficam em `lib/ai.ts` (US-123); aqui so o pedido e a validacao.
 */

export const EXPLAIN_MESSAGES: AiMessages = {
  notConfigured: "A explicação não está configurada nesta instalação.",
  refusal: "Não consigo explicar esta frase.",
  failure: EXPLAIN_FAILURE,
};

const ExplanationSchema = z.object({
  simple: z
    .string()
    .describe("A frase reescrita em português do Brasil, em linguagem simples e direta."),
  translation: z
    .string()
    .describe("Tradução fiel da frase para o português; vazia quando a frase já é portuguesa."),
  explanation: z
    .string()
    .describe(
      `Explicação em português do que a frase quer dizer no trecho, em no máximo ${MAX_EXPLANATION_WORDS} palavras.`
    ),
});

const SYSTEM = [
  "Você ajuda quem está lendo a entender uma frase difícil, sem que precise parar a leitura.",
  "Recebe a frase e o que veio antes dela no texto; nunca suponha o que vem depois.",
  "Reescreva a frase em linguagem simples e explique o sentido dela no trecho: referências, termos técnicos, ironia, a ideia principal.",
  `A explicação tem no máximo ${MAX_EXPLANATION_WORDS} palavras e não repete a reescrita.`,
  "Escreva sempre em português do Brasil.",
].join(" ");

function prompt(request: ExplainRequest, language: string): string {
  const parts = [];
  if (request.before) parts.push(`Trecho anterior:\n${request.before}`);
  parts.push(`Frase a explicar:\n${request.sentence}`);
  if (language !== DEFAULT_LANGUAGE) {
    const name = languageName(language).toLowerCase();
    parts.push(
      `O texto está em ${name}. Traduza a frase para o português em \`translation\`; a reescrita simples e a explicação são em português.`
    );
  }
  return parts.join("\n\n");
}

/** Palavras do texto que a explicacao envia: a frase e o que veio antes (US-144). */
function sentWords(request: Pick<ExplainRequest, "sentence" | "before">): number {
  return countWords(request.sentence) + countWords(request.before);
}

export async function explainSentence(
  userId: string,
  request: ExplainRequest,
  language: string = DEFAULT_LANGUAGE,
  textId?: string
): Promise<Explanation> {
  const parsed = await aiParse({
    task: "explicacao",
    userId,
    textId,
    wordsSent: sentWords(request),
    messages: EXPLAIN_MESSAGES,
    schema: ExplanationSchema,
    system: SYSTEM,
    maxTokens: 2000,
    // No meio da leitura: pouco raciocinio, resposta rapida.
    effort: "low",
    timeoutMs: EXPLAIN_TIMEOUT_MS,
    content: [{ role: "user", content: prompt(request, language) }],
  });

  const explanation = parseExplanation(parsed, language !== DEFAULT_LANGUAGE);
  if (!explanation) throw new AiUnavailable(EXPLAIN_FAILURE);
  return explanation;
}

interface StreamTarget {
  textId: string;
  /** Aborta quando a folha fecha. */
  signal: AbortSignal;
}

/**
 * Explicacao em streaming (US-145). A saida continua estruturada; cada trecho
 * do JSON e lido ate onde chegou, e `onDelta` recebe o texto novo de cada
 * campo. No fim, a mesma validacao da explicacao inteira.
 */
export async function streamExplanation(
  userId: string,
  request: ExplainRequest,
  language: string,
  target: StreamTarget & { onDelta: (field: string, text: string) => void }
): Promise<Explanation> {
  const foreign = language !== DEFAULT_LANGUAGE;
  const fields = explanationFields(foreign);
  const sent: Record<string, number> = {};
  let json = "";

  const response = await aiStream({
    task: "explicacao",
    userId,
    textId: target.textId,
    wordsSent: sentWords(request),
    messages: EXPLAIN_MESSAGES,
    format: jsonFormat(ExplanationSchema),
    system: SYSTEM,
    maxTokens: 2000,
    effort: "low",
    timeoutMs: EXPLAIN_TIMEOUT_MS,
    signal: target.signal,
    content: [{ role: "user", content: prompt(request, language) }],
    onText: (delta) => {
      json += delta;
      for (const { field, text } of fieldDeltas(json, sent, fields)) target.onDelta(field, text);
    },
  });

  const text = response.content
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("");
  let raw: unknown = null;
  try {
    raw = JSON.parse(text);
  } catch {
    raw = null;
  }
  const explanation = parseExplanation(raw, foreign);
  if (!explanation) throw new AiUnavailable(EXPLAIN_FAILURE);
  return explanation;
}

const FOLLOW_UP_SYSTEM = [
  "Você ajuda quem está lendo a entender uma frase difícil, sem que precise parar a leitura.",
  "Recebe a frase, o que veio antes dela no texto e a explicação que a pessoa já viu; nunca suponha o que vem depois.",
  "Responda só com o texto pedido, sem título nem introdução, em português do Brasil.",
].join(" ");

/**
 * Continuacao da explicacao (US-146): mais simples ou um exemplo, em texto
 * livre, validado no fim pelo teto de palavras do tipo.
 */
export async function streamFollowUp(
  userId: string,
  request: ExplainRequest,
  kind: FollowUp,
  previous: Explanation | null,
  target: StreamTarget & { onDelta: (text: string) => void }
): Promise<string> {
  const response = await aiStream({
    task: "explicacao",
    userId,
    textId: target.textId,
    wordsSent: sentWords(request),
    messages: EXPLAIN_MESSAGES,
    system: FOLLOW_UP_SYSTEM,
    // Folga para o raciocinio; a resposta e curta.
    maxTokens: 1000 + FOLLOW_UP_WORDS[kind] * 4,
    effort: "low",
    timeoutMs: EXPLAIN_TIMEOUT_MS,
    signal: target.signal,
    content: [{ role: "user", content: followUpPrompt(request, kind, previous) }],
    onText: target.onDelta,
  });

  const text = response.content
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("");
  const result = parseFollowUp(text, kind);
  if (!result) throw new AiUnavailable(EXPLAIN_FAILURE);
  return result;
}
