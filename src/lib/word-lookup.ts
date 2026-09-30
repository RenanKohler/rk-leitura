import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { parseEntry, type WordEntry } from "@/lib/dictionary";
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

const MODEL = "claude-opus-5-5";

export class LookupUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LookupUnavailable";
  }
}

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
});

const SYSTEM = [
  "Você é um dicionário de português do Brasil.",
  "Recebe uma palavra e a frase em que ela aparece, e devolve o sentido usado ali.",
  "A definição é curta e direta, escrita para quem está lendo e não quer parar.",
  "Nunca repete a palavra consultada dentro da própria definição.",
  "Quando uma palavra de outro idioma aparecer em texto em português, define em português e diz o idioma em `kind`.",
].join(" ");

function client(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    throw new LookupUnavailable("O dicionário não está configurado nesta instalação.");
  }
  return new Anthropic({ apiKey });
}

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
  word: string,
  context: string,
  language: string = DEFAULT_LANGUAGE
): Promise<WordEntry> {
  let response;
  try {
    response = await client().beta.messages.parse({
      model: MODEL,
      max_tokens: 1000,
      system: SYSTEM,
      // Consulta no meio da leitura: pouco raciocinio, resposta rapida.
      output_config: { effort: "low", format: betaZodOutputFormat(EntrySchema) },
      // Recusa dos classificadores de seguranca e refeita em outro modelo na mesma chamada.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      messages: [{ role: "user", content: prompt(word, context, language) }],
    });
  } catch (error) {
    if (error instanceof LookupUnavailable) throw error;
    if (error instanceof Anthropic.RateLimitError) {
      throw new LookupUnavailable("O serviço está ocupado. Tente daqui a pouco.");
    }
    if (error instanceof Anthropic.AuthenticationError) {
      throw new LookupUnavailable("O dicionário não está configurado nesta instalação.");
    }
    console.error("[dicionario] falha:", error);
    throw new LookupUnavailable("Não consegui consultar agora.");
  }

  // Custo por consulta: modelo que respondeu (muda quando o fallback atua) e tokens.
  console.info("[dicionario] uso:", response.model, JSON.stringify(response.usage));

  if (response.stop_reason === "refusal") {
    throw new LookupUnavailable("Não consigo definir esta palavra.");
  }

  const entry = parseEntry(response.parsed_output, word);
  if (!entry) throw new LookupUnavailable("Não encontrei esta palavra.");

  // Palavra portuguesa nao tem traducao a mostrar.
  return language === DEFAULT_LANGUAGE ? { ...entry, translation: null } : entry;
}
