import "server-only";

import { z } from "zod";
import { aiParse, AiUnavailable, type AiMessages } from "@/lib/ai";
import {
  EXPLAIN_FAILURE,
  EXPLAIN_TIMEOUT_MS,
  MAX_EXPLANATION_WORDS,
  parseExplanation,
  type ExplainRequest,
  type Explanation,
} from "@/lib/explain";
import { DEFAULT_LANGUAGE, languageName } from "@/lib/language";

/**
 * Explicacao de uma frase dificil (US-127). O envio, a chave e o tratamento
 * de erro ficam em `lib/ai.ts` (US-123); aqui so o pedido e a validacao.
 */

const MESSAGES: AiMessages = {
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

export async function explainSentence(
  userId: string,
  request: ExplainRequest,
  language: string = DEFAULT_LANGUAGE
): Promise<Explanation> {
  const parsed = await aiParse({
    task: "explicacao",
    userId,
    messages: MESSAGES,
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
