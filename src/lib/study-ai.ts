import "server-only";

import { z } from "zod";
import { aiParse, countWords, type AiMessages } from "@/lib/ai";
import { DEFAULT_LANGUAGE, languageName } from "@/lib/language";
import { MAX_DEFINITION_WORDS, MAX_TERMS } from "@/lib/glossary";
import { MAX_GUIDE_QUESTIONS } from "@/lib/guide-questions";
import { passageMessage, type PassageExcerpt } from "@/lib/passage-card";
import { MAX_NOTES_ITEMS } from "@/lib/study-notes";
import { MAX_POINTS } from "@/lib/teach-back";

/**
 * Chamadas ao modelo das ferramentas de estudo (US-158, US-164 a US-167).
 *
 * Cada funcao recebe o trecho ja recortado pela regra da sua story (a
 * montagem e as funcoes puras de cada uma, com teste): aqui so ficam o
 * pedido e o esquema. A validacao contra o texto vem depois, na rota.
 */

function languageLine(language: string, what: string): string[] {
  if (language === DEFAULT_LANGUAGE) return [];
  return [
    `O texto está em ${languageName(language).toLowerCase()}: ${what} em português, e as citações e termos ficam no idioma original, copiados do texto.`,
  ];
}

const QUOTE_RULE =
  "Cada citação é copiada do texto palavra por palavra, sem reticências e sem mudar nada, com 5 a 40 palavras.";

/* --- US-158: cartao de um trecho ----------------------------------------- */

export const CARD_MESSAGES: AiMessages = {
  notConfigured: "A criação de cartões não está configurada nesta instalação.",
  refusal: "Não consegui propor um cartão para este trecho.",
  failure: "Não consegui propor um cartão agora.",
};

const CardSchema = z.object({
  front: z.string().describe("Pergunta curta sobre o trecho, em português."),
  back: z.string().describe("Resposta tirada só do trecho, em até 3 frases."),
});

export async function proposeCard(
  userId: string,
  textId: string,
  title: string,
  excerpt: PassageExcerpt,
  language: string
): Promise<unknown> {
  const system = [
    "Você cria um cartão de memorização (frente e verso) a partir de um trecho que a pessoa selecionou durante a leitura.",
    "A frente é uma pergunta curta; o verso, a resposta, tirada só do trecho selecionado. O parágrafo anterior serve só de contexto.",
    "Cada lado tem no máximo 400 caracteres, em português do Brasil.",
    ...languageLine(language, "frente e verso são"),
  ].join(" ");
  return aiParse({
    task: "cartao",
    userId,
    textId,
    wordsSent: countWords(`${excerpt.previous} ${excerpt.passage}`),
    messages: CARD_MESSAGES,
    schema: CardSchema,
    system,
    maxTokens: 1500,
    effort: "low",
    timeoutMs: 20_000,
    content: [{ role: "user", content: passageMessage(title, excerpt) }],
  });
}

/* --- US-164: glossario ----------------------------------------------------- */

export const GLOSSARY_MESSAGES: AiMessages = {
  notConfigured: "O glossário não está configurado nesta instalação.",
  refusal: "Não consegui gerar o glossário deste texto.",
  failure: "Não consegui gerar o glossário agora.",
};

const GlossarySchema = z.object({
  terms: z
    .array(
      z.object({
        term: z.string().describe("O termo exatamente como aparece no texto."),
        definition: z
          .string()
          .describe(`Definição no sentido em que o texto usa o termo, com até ${MAX_DEFINITION_WORDS} palavras.`),
      })
    )
    .describe(`Até ${MAX_TERMS} termos.`),
});

export async function generateGlossary(
  userId: string,
  textId: string,
  title: string,
  excerpt: string,
  language: string
): Promise<unknown> {
  const system = [
    "Você monta o glossário dos termos e conceitos de um texto para quem o estuda.",
    "O trecho enviado termina onde a leitura parou: use só ele e não antecipe o que vem depois.",
    `Escolha até ${MAX_TERMS} termos técnicos, conceitos ou nomes importantes que aparecem no trecho, cada um escrito exatamente como está no texto.`,
    `Defina cada termo no sentido em que o texto o usa, com no máximo ${MAX_DEFINITION_WORDS} palavras, em português do Brasil.`,
    ...languageLine(language, "as definições são"),
  ].join(" ");
  return aiParse({
    task: "glossario",
    userId,
    textId,
    wordsSent: countWords(excerpt),
    messages: GLOSSARY_MESSAGES,
    schema: GlossarySchema,
    system,
    maxTokens: 8000,
    effort: "medium",
    timeoutMs: 90_000,
    content: [{ role: "user", content: `Título: ${title}\n\nTrecho lido:\n\n${excerpt}` }],
  });
}

/* --- US-165: fichamento ---------------------------------------------------- */

export const NOTES_MESSAGES: AiMessages = {
  notConfigured: "O fichamento não está configurado nesta instalação.",
  refusal: "Não consegui fazer o fichamento deste texto.",
  failure: "Não consegui fazer o fichamento agora.",
};

const NotesItemSchema = z.object({
  text: z.string().describe("O item, em uma ou duas frases."),
  quote: z.string().describe("Trecho do texto que sustenta o item, copiado literalmente."),
});

const NotesSchema = z.object({
  ideia: z.array(NotesItemSchema).describe("Ideia central: 1 ou 2 itens."),
  argumentos: z.array(NotesItemSchema).describe(`Argumentos: até ${MAX_NOTES_ITEMS} itens.`),
  evidencias: z.array(NotesItemSchema).describe(`Evidências: até ${MAX_NOTES_ITEMS} itens.`),
  conclusoes: z.array(NotesItemSchema).describe(`Conclusões: até ${MAX_NOTES_ITEMS} itens.`),
});

export async function generateNotes(
  userId: string,
  textId: string,
  title: string,
  excerpt: string,
  language: string
): Promise<unknown> {
  const system = [
    "Você faz o fichamento de um texto para quem o estuda: ideia central, argumentos, evidências e conclusões.",
    `Cada seção tem no máximo ${MAX_NOTES_ITEMS} itens, escritos em português do Brasil, com até 300 caracteres cada.`,
    `Cada item traz a citação do texto que o sustenta. ${QUOTE_RULE}`,
    "Não inclua nada que o texto não diga.",
    ...languageLine(language, "os itens são"),
  ].join(" ");
  return aiParse({
    task: "fichamento",
    userId,
    textId,
    wordsSent: countWords(excerpt),
    messages: NOTES_MESSAGES,
    schema: NotesSchema,
    system,
    maxTokens: 10000,
    effort: "medium",
    timeoutMs: 120_000,
    content: [{ role: "user", content: `Título: ${title}\n\nTexto:\n\n${excerpt}` }],
  });
}

/* --- US-166: perguntas-guia ------------------------------------------------ */

export const GUIDE_MESSAGES: AiMessages = {
  notConfigured: "As perguntas-guia não estão configuradas nesta instalação.",
  refusal: "Sem perguntas-guia para esta seção.",
  failure: "Não consegui preparar as perguntas-guia agora.",
};

const GuideSchema = z.object({
  questions: z
    .array(
      z.object({
        question: z.string().describe("Pergunta curta que a seção responde, em português."),
        quote: z.string().describe("Trecho da seção que responde a pergunta, copiado literalmente."),
      })
    )
    .describe(`Até ${MAX_GUIDE_QUESTIONS} perguntas.`),
});

export async function generateGuide(
  userId: string,
  textId: string,
  title: string,
  sectionTitle: string,
  excerpt: string,
  language: string
): Promise<unknown> {
  const system = [
    "Você prepara perguntas-guia para quem vai ler uma seção de um texto: a pessoa lê procurando as respostas.",
    `Faça de 2 a ${MAX_GUIDE_QUESTIONS} perguntas curtas e diferentes entre si, que a própria seção responde, em português do Brasil, sem revelar a resposta na pergunta.`,
    `Para cada pergunta, cite o trecho da seção que a responde. ${QUOTE_RULE}`,
    ...languageLine(language, "as perguntas são"),
  ].join(" ");
  return aiParse({
    task: "guia",
    userId,
    textId,
    wordsSent: countWords(excerpt),
    messages: GUIDE_MESSAGES,
    schema: GuideSchema,
    system,
    maxTokens: 2000,
    effort: "low",
    timeoutMs: 30_000,
    content: [
      { role: "user", content: `Título: ${title}\n\nSeção: ${sectionTitle}\n\n${excerpt}` },
    ],
  });
}

/* --- US-167: apontamentos -------------------------------------------------- */

export const TEACH_BACK_MESSAGES: AiMessages = {
  notConfigured: "Os apontamentos não estão configurados nesta instalação.",
  refusal: "Não consegui conferir esta explicação.",
  failure: "Não consegui conferir agora.",
};

const PointsSchema = z.object({
  points: z
    .array(
      z.object({
        text: z.string().describe("O apontamento: o que ficou de fora ou divergiu do texto."),
        quote: z.string().describe("Trecho do texto que sustenta o apontamento, copiado literalmente."),
      })
    )
    .describe(`Até ${MAX_POINTS} apontamentos.`),
});

export async function generateTeachBack(
  userId: string,
  textId: string,
  title: string,
  excerpt: string,
  explanation: string,
  language: string
): Promise<unknown> {
  const system = [
    "Você confere a explicação que uma pessoa escreveu, com as próprias palavras, sobre um trecho que ela já leu.",
    `Aponte até ${MAX_POINTS} pontos importantes do trecho que ficaram de fora da explicação ou que ela entendeu diferente do texto, em português do Brasil, com até 300 caracteres cada.`,
    "Não dê nota, porcentagem nem avaliação geral; só os apontamentos. Se a explicação cobre bem o trecho, devolva poucos ou nenhum.",
    `Cada apontamento traz o trecho do texto que o sustenta. ${QUOTE_RULE}`,
    "O trecho termina onde a leitura parou: não antecipe o que vem depois.",
    ...languageLine(language, "os apontamentos são"),
  ].join(" ");
  return aiParse({
    task: "apontamentos",
    userId,
    textId,
    wordsSent: countWords(excerpt),
    messages: TEACH_BACK_MESSAGES,
    schema: PointsSchema,
    system,
    maxTokens: 4000,
    effort: "medium",
    timeoutMs: 60_000,
    content: [
      {
        role: "user",
        content: `Título: ${title}\n\nTrecho lido:\n\n${excerpt}\n\nExplicação da pessoa:\n\n${explanation}`,
      },
    ],
  });
}
