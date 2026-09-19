import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { parseEntry, type WordEntry } from "@/lib/dictionary";

/**
 * Definicao de uma palavra, no sentido em que ela foi usada.
 *
 * A decisao que faltava na US-38 era a fonte. Dicionario aberto em portugues
 * tem cobertura fraca, e nenhum resolve o sentido pelo contexto - "manga" em
 * um texto de botanica e outra coisa que em um de costura. O mesmo provedor ja
 * usado no questionario responde as duas coisas de uma vez, inclusive a forma
 * flexionada, sem uma tabela de conjugacoes.
 */

const MODEL = "claude-opus-5";

export class LookupUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LookupUnavailable";
  }
}

const EntrySchema = z.object({
  base: z.string().describe("Forma de dicionario: infinitivo, singular, masculino."),
  kind: z
    .string()
    .describe("Classe gramatical no uso desta frase: substantivo, verbo, adjetivo, etc."),
  definition: z
    .string()
    .describe("Definicao curta, em uma ou duas frases, no sentido usado no trecho."),
});

const SYSTEM = [
  "Voce e um dicionario de portugues do Brasil.",
  "Recebe uma palavra e a frase em que ela aparece, e devolve o sentido usado ali.",
  "A definicao e curta e direta, escrita para quem esta lendo e nao quer parar.",
  "Nunca repete a palavra consultada dentro da propria definicao.",
  "Quando a palavra estiver em outro idioma, define em portugues e diz o idioma em `kind`.",
].join(" ");

function client(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    throw new LookupUnavailable("O dicionario nao esta configurado nesta instalacao.");
  }
  return new Anthropic({ apiKey });
}

export async function lookupWord(word: string, context: string): Promise<WordEntry> {
  let response;
  try {
    response = await client().messages.parse({
      model: MODEL,
      max_tokens: 1000,
      system: SYSTEM,
      output_config: { format: zodOutputFormat(EntrySchema) },
      messages: [
        {
          role: "user",
          content: context
            ? `Palavra: ${word}\n\nTrecho em que ela aparece: ${context}`
            : `Palavra: ${word}`,
        },
      ],
    });
  } catch (error) {
    if (error instanceof LookupUnavailable) throw error;
    if (error instanceof Anthropic.RateLimitError) {
      throw new LookupUnavailable("O servico esta ocupado. Tente daqui a pouco.");
    }
    if (error instanceof Anthropic.AuthenticationError) {
      throw new LookupUnavailable("O dicionario nao esta configurado nesta instalacao.");
    }
    console.error("[dicionario] falha:", error);
    throw new LookupUnavailable("Nao consegui consultar agora.");
  }

  if (response.stop_reason === "refusal") {
    throw new LookupUnavailable("Nao consigo definir esta palavra.");
  }

  const entry = parseEntry(response.parsed_output, word);
  if (!entry) throw new LookupUnavailable("Nao encontrei esta palavra.");

  return entry;
}
