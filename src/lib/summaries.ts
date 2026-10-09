/**
 * Retomada com resumo (US-130 a US-132): recortes, chaves de cache e
 * validacao do que o modelo devolve. Funcoes puras, com teste.
 *
 * A regra de ouro vem de `ai-text.ts`: o que vai ao modelo termina na
 * posicao de leitura. Aqui ela e aplicada na montagem de cada pedido - o
 * modelo nunca e instruido a "nao contar o resto", porque o resto nem chega.
 */

import { excerptOf, type Excerpt } from "@/lib/ai-text";
import { DEFAULT_LANGUAGE, languageName } from "@/lib/language";
import { contentKey } from "@/lib/quiz";
import type { Paragraph } from "@/lib/reading";
import type { NameEntry } from "@/lib/xray";

/** Topicos do resumo do que ja li (US-130). */
export const SUMMARY_MIN_POINTS = 3;
export const SUMMARY_MAX_POINTS = 5;
/** Teto de palavras somando todos os topicos. */
export const SUMMARY_MAX_WORDS = 120;

/** Topicos do resumo do capitulo anterior (US-131). */
export const CHAPTER_MAX_POINTS = 5;
export const CHAPTER_MAX_WORDS = 150;

/** Nomes descritos de uma vez e o teto de cada descricao (US-132). */
export const MAX_DESCRIBED_NAMES = 30;
export const NAME_DESCRIPTION_WORDS = 25;
/** O que aparece no lugar da descricao quando o trecho lido nao basta. */
export const LITTLE_CONTEXT = "Pouco contexto até aqui.";
/** Avanco, em fracao do texto, a partir do qual as descricoes sao refeitas. */
export const NAMES_REFRESH_SHARE = 0.1;

/** Resumo guardado do que ja li: os topicos e onde o trecho terminou. */
export interface ReadSummary {
  points: string[];
  /** Palavra seguinte a ultima enviada: o resumo cobre [0, to). */
  to: number;
}

/** Descricoes guardadas: nome -> descricao, ou null sem contexto suficiente. */
export interface NameDescriptions {
  contentKey: string;
  /** Posicao de leitura em que as descricoes foram geradas. */
  position: number;
  descriptions: Record<string, string | null>;
}

/** Posicao valida dentro do texto. */
export function clampPosition(position: unknown, wordCount: number): number {
  const value = typeof position === "number" ? position : Number(position);
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(wordCount, Math.floor(value)));
}

/** Inicio do paragrafo em que esta a palavra `position`. */
export function paragraphStartAt(paragraphs: Paragraph[], position: number): number {
  let start = 0;
  for (const paragraph of paragraphs) {
    if (paragraph.start > position) break;
    start = paragraph.start;
  }
  return start;
}

/**
 * Chave do resumo do que ja li: (texto, impressao do conteudo, inicio do
 * paragrafo da posicao). Editar ou continuar o texto muda a impressao e o resumo antigo
 * deixa de ser encontrado.
 */
export function readSummaryKey(
  textId: string,
  content: string,
  paragraphs: Paragraph[],
  position: number
): string {
  return `${textId}:${contentKey(content)}:${paragraphStartAt(paragraphs, position)}`;
}

/**
 * O resumo guardado serve para esta posicao? So quando ele nao passa dela: a
 * chave e por paragrafo, e quem voltou algumas palavras dentro do mesmo
 * paragrafo nao pode receber um resumo que cobre o que ainda nao leu.
 */
export function canReuseReadSummary(stored: ReadSummary | null, position: number): boolean {
  return Boolean(stored && Array.isArray(stored.points) && stored.to <= position);
}

/** Chave do resumo de um capitulo: (texto, impressao do conteudo). */
export function chapterSummaryKey(textId: string, content: string): string {
  return `${textId}:${contentKey(content)}`;
}

/** Faixa de 10% de progresso, para a chave das descricoes de nomes. */
export function progressBand(position: number, wordCount: number): number {
  if (wordCount <= 0) return 0;
  return Math.min(9, Math.floor((position / wordCount) * 10));
}

export function namesKey(
  textId: string,
  content: string,
  position: number,
  wordCount: number
): string {
  return `${textId}:${contentKey(content)}:${progressBand(position, wordCount)}`;
}

/**
 * As descricoes guardadas servem? Mesmo conteudo, geradas antes ou na
 * posicao atual (nunca depois: seria spoiler) e com menos de 10% do texto
 * lido desde entao.
 */
export function canReuseNames(
  stored: NameDescriptions | null,
  key: string,
  position: number,
  wordCount: number
): boolean {
  if (!stored || stored.contentKey !== key || typeof stored.descriptions !== "object") return false;
  if (stored.position > position) return false;
  return position - stored.position < Math.max(1, wordCount * NAMES_REFRESH_SHARE);
}

/**
 * Os nomes da lista que ganham descricao (ate 30) e, deles, os que o modelo
 * recebe: so os que ja apareceram antes da posicao. Um nome que so surge
 * adiante fica com "Pouco contexto" sem nem ser enviado - mandar o nome ja
 * diria que ele vai aparecer.
 */
export function namesToDescribe(
  names: NameEntry[],
  position: number
): { listed: string[]; sent: string[] } {
  const listed = names.slice(0, MAX_DESCRIBED_NAMES);
  return {
    listed: listed.map((entry) => entry.name),
    sent: listed.filter((entry) => (entry.positions[0] ?? Infinity) < position).map((entry) => entry.name),
  };
}

function languageNote(language: string): string {
  return language === DEFAULT_LANGUAGE
    ? ""
    : `\n\nO texto está em ${languageName(language).toLowerCase()}. Escreva em português do Brasil; mantenha nomes e citações no idioma original.`;
}

export interface SummaryRequest {
  excerpt: Excerpt;
  /** Mensagem do usuario enviada ao modelo. */
  prompt: string;
}

/**
 * Pedido do resumo do que ja li (US-130): o trecho [0, posicao), com o teto
 * de 200 mil caracteres guardando o fim.
 */
export function buildReadSummaryRequest(input: {
  title: string;
  paragraphs: Paragraph[];
  position: number;
  language: string;
}): SummaryRequest {
  const excerpt = excerptOf(input.paragraphs, 0, input.position);
  const cut = excerpt.truncated ? "\n\n(O começo do texto ficou de fora por ser longo demais.)" : "";
  return {
    excerpt,
    prompt: `Título: ${input.title}\n\nTrecho já lido, até o ponto exato em que a leitura parou:\n${excerpt.text}${cut}\n\nResuma este trecho em ${SUMMARY_MIN_POINTS} a ${SUMMARY_MAX_POINTS} tópicos, com no máximo ${SUMMARY_MAX_WORDS} palavras somando todos. O último tópico diz onde a leitura parou.${languageNote(input.language)}`,
  };
}

/**
 * Pedido do resumo de um capitulo concluido (US-131). O capitulo ja foi lido
 * ate o fim, entao vai inteiro (com o mesmo teto).
 */
export function buildChapterSummaryRequest(input: {
  title: string;
  paragraphs: Paragraph[];
  wordCount: number;
  language: string;
}): SummaryRequest {
  const excerpt = excerptOf(input.paragraphs, 0, input.wordCount);
  return {
    excerpt,
    prompt: `Título do capítulo: ${input.title}\n\nCapítulo:\n${excerpt.text}\n\nResuma o capítulo inteiro em até ${CHAPTER_MAX_POINTS} tópicos curtos, na ordem dos acontecimentos ou do argumento.${languageNote(input.language)}`,
  };
}

/** Pedido das descricoes de nomes (US-132): o trecho [0, posicao) e os nomes enviados. */
export function buildNamesRequest(input: {
  title: string;
  paragraphs: Paragraph[];
  position: number;
  names: string[];
  language: string;
}): SummaryRequest {
  const excerpt = excerptOf(input.paragraphs, 0, input.position);
  const list = input.names.map((name) => `- ${name}`).join("\n");
  return {
    excerpt,
    prompt: `Título: ${input.title}\n\nTrecho já lido, até o ponto exato em que a leitura parou:\n${excerpt.text}\n\nNomes:\n${list}\n\nPara cada nome da lista, diga em até ${NAME_DESCRIPTION_WORDS} palavras quem ou o que ele é, usando só o trecho acima. Quando o trecho não basta para dizer, marque que falta contexto.${languageNote(input.language)}`,
  };
}

/** Corta um texto em `limit` palavras. */
function capWords(text: string, limit: number): { text: string; used: number } {
  const words = text.trim().split(/\s+/).filter(Boolean);
  return { text: words.slice(0, limit).join(" "), used: Math.min(words.length, limit) };
}

/**
 * Topicos prontos para a tela: sem vazios, no maximo `maxPoints`, e o total
 * de palavras cortado em `maxWords` (o corte cai nos ultimos topicos).
 */
export function normalizePoints(raw: unknown, maxPoints: number, maxWords: number): string[] {
  if (!Array.isArray(raw)) return [];
  const points: string[] = [];
  let budget = maxWords;
  for (const item of raw) {
    if (points.length >= maxPoints || budget <= 0) break;
    if (typeof item !== "string") continue;
    const cleaned = item.replace(/^\s*[-•*]\s*/, "");
    const { text, used } = capWords(cleaned, budget);
    if (!text) continue;
    points.push(text);
    budget -= used;
  }
  return points;
}

/**
 * Descricoes indexadas pelo nome, so para os nomes da lista. O que o modelo
 * nao devolveu, marcou como sem contexto ou devolveu vazio fica null; nome
 * inventado por ele e ignorado.
 */
export function normalizeDescriptions(
  listed: string[],
  sent: string[],
  raw: unknown
): Record<string, string | null> {
  const byName = new Map<string, string>();
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!item || typeof item !== "object") continue;
      const { name, description, known } = item as Record<string, unknown>;
      if (typeof name !== "string" || typeof description !== "string" || known === false) continue;
      const { text } = capWords(description, NAME_DESCRIPTION_WORDS);
      if (text) byName.set(name.trim().toLocaleLowerCase("pt-BR"), text);
    }
  }
  const allowed = new Set(sent);
  return Object.fromEntries(
    listed.map((name) => [
      name,
      allowed.has(name) ? (byName.get(name.toLocaleLowerCase("pt-BR")) ?? null) : null,
    ])
  );
}
