import "server-only";

import { z } from "zod";
import { aiParse, AiUnavailable, countWords, type AiMessages } from "@/lib/ai";
import { DISTRACTOR_COUNT, parseEntry, type WordEntry } from "@/lib/dictionary";
import { DEFAULT_LANGUAGE, languageName } from "@/lib/language";

/**
 * Definicao de uma palavra, no sentido em que ela foi usada.
 *
 * A decisao que faltava na US-38 era a fonte. Dicionario aberto em portugues
 * tem cobertura fraca, e nenhum resolve o sentido pelo contexto - "manga" em
 * um texto de botanica e outra coisa que em um de costura. O mesmo provedor ja
 * usado no questionario responde as duas coisas de uma vez, inclusive a forma
 * flexionada, sem uma tabela de conjugacoes.
 */

const MESSAGES: AiMessages = {
  notConfigured: "O dicionário não está configurado nesta instalação.",
  refusal: "Não consigo definir esta palavra.",
  failure: "Não consegui consultar agora.",
};

const EntrySchema = z.object({
  base: z.string().describe("Forma de dicionário: infinitivo, singular, masculino."),
  kind: z
    .string()
    .describe("Classe gramatical no uso desta frase: substantivo, verbo, adjetivo, etc."),
  definition: z
    .string()
    .describe("Definição curta, em uma ou duas frases, no sentido usado no trecho."),
  translation: z
    .string()
    .describe(
      "Tradução para o português no sentido do trecho; vazia quando a palavra já é portuguesa."
    ),
  // Revisao de multipla escolha (US-151): cerca de 40 tokens a mais de saida,
  // gerados uma vez, na consulta.
  distractors: z
    .array(z.string())
    .length(DISTRACTOR_COUNT)
    .describe(
      "Três definições incorretas mas plausíveis para esta palavra, no mesmo estilo e tamanho da definição correta, em português."
    ),
});

const SYSTEM = [
  "Você é um dicionário de português do Brasil.",
  "Recebe uma palavra e a frase em que ela aparece, e devolve o sentido usado ali.",
  "A definição é curta e direta, escrita para quem está lendo e não quer parar.",
  "Nunca repete a palavra consultada dentro da própria definição.",
  "Quando uma palavra de outro idioma aparecer em texto em português, define em português e diz o idioma em `kind`.",
  "Além da definição correta, escreve três definições erradas e plausíveis, que alguém em dúvida poderia confundir com a certa; nenhuma pode ser sinônima da correta.",
].join(" ");

/**
 * Pedido ao modelo. Em texto de outro idioma (US-69) a forma de dicionario e a
 * daquele idioma - "running" vira "run", nao "correr" - e a traducao vem a
 * parte, com a definicao em portugues.
 */
function prompt(word: string, context: string, language: string): string {
  const base = context
    ? `Palavra: ${word}\n\nTrecho em que ela aparece: ${context}`
    : `Palavra: ${word}`;
  if (language === DEFAULT_LANGUAGE) return base;

  const name = languageName(language).toLowerCase();
  return `${base}\n\nO texto está em ${name}. Devolva a forma de dicionário em ${name}, a tradução para o português e a definição em português.`;
}

export async function lookupWord(
  userId: string,
  word: string,
  context: string,
  language: string = DEFAULT_LANGUAGE,
  /** Texto em que a palavra apareceu (US-144); a frase e o que sai dele. */
  textId?: string | null
): Promise<WordEntry> {
  const parsed = await aiParse({
    task: "dicionario",
    userId,
    textId: textId ?? null,
    wordsSent: textId ? countWords(context || word) : 0,
    messages: MESSAGES,
    schema: EntrySchema,
    system: SYSTEM,
    // No Haiku o raciocinio conta no teto: folga para ele e a resposta curta.
    maxTokens: 2000,
    // Consulta no meio da leitura: pouco raciocinio, resposta rapida.
    effort: "low",
    content: [{ role: "user", content: prompt(word, context, language) }],
  });

  const entry = parseEntry(parsed, word);
  if (!entry) throw new AiUnavailable("Não encontrei esta palavra.");

  // Palavra portuguesa nao tem traducao a mostrar.
  return language === DEFAULT_LANGUAGE ? { ...entry, translation: null } : entry;
}

// O lote de definicoes pendentes (US-139) faz o mesmo pedido, pela Message
// Batches: mesmas instrucoes, mesmo esquema, mesma frase de contexto.
export {
  EntrySchema as LOOKUP_SCHEMA,
  MESSAGES as LOOKUP_MESSAGES,
  SYSTEM as LOOKUP_SYSTEM,
  prompt as lookupPrompt,
};
