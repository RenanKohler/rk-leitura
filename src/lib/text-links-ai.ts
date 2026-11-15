import "server-only";

import { z } from "zod";
import { aiParse, countWords, type AiMessages } from "@/lib/ai";
import { DEFAULT_LANGUAGE, languageName } from "@/lib/language";
import { MAX_LINKS, MAX_RELATION_CHARS } from "@/lib/text-links";

/**
 * Chamada ao modelo das ligacoes entre textos (US-232). A mensagem chega
 * pronta (`linksMessage`); aqui ficam o pedido e o esquema. A conferencia das
 * citacoes vem depois, na rota (`validLinks`).
 */

export const LINKS_MESSAGES: AiMessages = {
  notConfigured: "As ligações entre textos não estão configuradas nesta instalação.",
  refusal: "Não consegui procurar ligações para este texto.",
  failure: "Não consegui procurar ligações agora.",
};

const LinksSchema = z.object({
  links: z
    .array(
      z.object({
        label: z.string().describe("Rótulo do outro texto, como aparece no pedido: T1, T2..."),
        relation: z
          .string()
          .describe(
            "A relação em uma frase curta, começando pelo verbo: complementa, contradiz, dá um exemplo de, aprofunda, retoma..."
          ),
        quoteHere: z.string().describe("Trecho de ESTE TEXTO, copiado literalmente."),
        quoteOther: z.string().describe("Trecho do outro texto, copiado literalmente."),
      })
    )
    .describe(`Até ${MAX_LINKS} ligações; nenhuma quando não houver relação clara.`),
});

export async function generateLinks(
  userId: string,
  textId: string,
  message: string,
  language: string
): Promise<unknown> {
  const system = [
    "Você liga um texto que a pessoa estuda a trechos de outros textos da biblioteca dela.",
    "Os trechos dos outros textos foram escolhidos por palavras em comum, então muitos podem não ter relação real: ligue só o que trata do mesmo assunto, complementa, contradiz, dá exemplo ou aprofunda o texto estudado.",
    `Devolva até ${MAX_LINKS} ligações, de preferência de textos diferentes. Se nada se relaciona de verdade, devolva a lista vazia.`,
    `Cada ligação diz o rótulo do outro texto (T1, T2...) e a relação em uma frase de até ${MAX_RELATION_CHARS} caracteres, em português do Brasil, do ponto de vista do outro texto (por exemplo: "Complementa com um caso prático da mesma técnica.", "Contradiz a ideia de que...").`,
    "Quando o outro texto é da mesma série, diga isso na relação (por exemplo: \"No capítulo seguinte, retoma...\").",
    "Cada ligação traz duas citações: uma de ESTE TEXTO e uma do outro texto, cada citação copiada do trecho enviado palavra por palavra, sem reticências e sem mudar nada, com 5 a 40 palavras.",
    ...(language === DEFAULT_LANGUAGE
      ? []
      : [
          `O texto estudado está em ${languageName(language).toLowerCase()}: a relação é em português, e as citações ficam no idioma original, copiadas do texto.`,
        ]),
  ].join(" ");
  return aiParse({
    task: "ligacoes",
    userId,
    textId,
    wordsSent: countWords(message),
    messages: LINKS_MESSAGES,
    schema: LinksSchema,
    system,
    maxTokens: 4000,
    effort: "medium",
    timeoutMs: 90_000,
    content: [{ role: "user", content: message }],
  });
}
