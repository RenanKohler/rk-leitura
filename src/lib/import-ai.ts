import "server-only";

import { z } from "zod";
import { aiParse, type AiMessages } from "@/lib/ai";
import {
  LEFTOVER_REASONS,
  numberedParagraphs,
  tagExcerpt,
  validLeftovers,
  validSuggestions,
  type Leftover,
} from "@/lib/import-analysis";

/**
 * Chamadas ao modelo na previa da importacao (US-136 e US-137).
 *
 * Nenhuma das duas e essencial: a previa funciona sem elas. Por isso o tempo
 * e curto e quem chama trata qualquer falha como "sem marcacoes".
 */

/** Tempo maximo de cada analise: passou disso, a previa segue como hoje. */
export const ANALYSIS_TIMEOUT_MS = 15_000;

const CLEANUP_MESSAGES: AiMessages = {
  notConfigured: "A análise da importação não está configurada nesta instalação.",
  refusal: "Não consegui analisar esta página.",
  failure: "Não consegui analisar esta página agora.",
};

const TAG_MESSAGES: AiMessages = {
  notConfigured: "A sugestão de etiquetas não está configurada nesta instalação.",
  refusal: "Não consegui sugerir etiquetas para este texto.",
  failure: "Não consegui sugerir etiquetas agora.",
};

const LeftoverSchema = z.object({
  leftovers: z
    .array(
      z.object({
        index: z.number().describe("Número do parágrafo, como aparece entre colchetes."),
        // `catch`: o SDK leva o enum para a descricao do esquema, sem trava na
        // geracao. Um motivo fora da lista vira "outro" em vez de derrubar a
        // resposta inteira na validacao.
        reason: z.enum(LEFTOVER_REASONS).catch("outro"),
      })
    )
    .describe("Só os parágrafos que não fazem parte do artigo. Vazia quando todos fazem."),
});

const CLEANUP_SYSTEM = [
  "Você confere a extração de um artigo da web.",
  "Recebe os parágrafos extraídos, numerados entre colchetes, e aponta os que não fazem parte do texto:",
  "menus e links de navegação, anúncios, chamadas de \"leia também\" ou \"veja mais\",",
  "avisos de cookies, assinatura, newsletter ou compartilhamento, créditos de rodapé.",
  "Na dúvida, não aponte: tirar um parágrafo do artigo é pior que deixar um resto.",
  "Nunca reescreve nem resume nada; devolve só os números e o motivo.",
].join(" ");

/** Paragrafos que parecem resto de pagina, ja validados contra o texto. */
export async function findLeftovers(userId: string, content: string): Promise<Leftover[]> {
  const { prompt, count } = numberedParagraphs(content);
  if (count < 2) return [];

  const parsed = await aiParse({
    task: "limpeza",
    userId,
    messages: CLEANUP_MESSAGES,
    schema: LeftoverSchema,
    system: CLEANUP_SYSTEM,
    // No Haiku o raciocinio conta no teto: folga para ele e a lista curta.
    maxTokens: 3000,
    effort: "low",
    timeoutMs: ANALYSIS_TIMEOUT_MS,
    content: [{ role: "user", content: prompt }],
  });
  return validLeftovers(parsed?.leftovers, count);
}

const TAG_SYSTEM = [
  "Você organiza a biblioteca de leitura de uma pessoa.",
  "Recebe o título e o começo de um texto e escolhe, entre as etiquetas que ela já usa,",
  "no máximo três que combinam com o assunto ou o tipo do texto.",
  "Escolha só as que combinam de fato; a lista pode ficar vazia.",
].join(" ");

/** Ate tres etiquetas da conta que combinam com o texto. */
export async function suggestTags(
  userId: string,
  title: string,
  content: string,
  known: string[]
): Promise<string[]> {
  if (known.length === 0) return [];

  // Esquema fechado nas etiquetas da conta: o modelo nao inventa nome novo.
  // Com o enum indo para a descricao (SDK), um nome fora da lista vira vazio
  // e cai em `validSuggestions`, em vez de perder as outras sugestoes.
  const schema = z.object({
    tags: z
      .array(z.enum(known as [string, ...string[]]).catch(""))
      .describe("No máximo três etiquetas."),
  });

  const parsed = await aiParse({
    task: "etiquetas",
    userId,
    messages: TAG_MESSAGES,
    schema,
    system: TAG_SYSTEM,
    maxTokens: 2000,
    effort: "low",
    timeoutMs: ANALYSIS_TIMEOUT_MS,
    content: [{ role: "user", content: tagExcerpt(title, content) }],
  });
  return validSuggestions(parsed?.tags, known);
}
