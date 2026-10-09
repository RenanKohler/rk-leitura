/**
 * Checagem de compreensao do trecho lido numa sessao do Word Runner (US-149).
 *
 * Ao pausar uma sessao longa, o leitor pode responder duas perguntas sobre o
 * que acabou de ler, mesmo sem terminar o texto. O recorte enviado e so o da
 * sessao: do ponto em que ela comecou ate a posicao atual. Nenhuma palavra
 * depois da posicao sai do app - a montagem abaixo e a unica que monta o
 * pedido, e o teste dela garante isso.
 *
 * Funcoes puras, usadas no leitor (oferecer ou nao) e nas rotas (validar e
 * recortar).
 */

import type { SessionMode } from "@/lib/reader-session";

/** Palavras lidas na sessao a partir das quais a checagem aparece. */
export const MIN_SESSION_CHECK_WORDS = 800;

/** Perguntas da checagem: duas, para nao virar um questionario no meio do texto. */
export const SESSION_CHECK_QUESTIONS = 2;

/**
 * Piso do recorte aceito pelas rotas. Mais baixo que o da tela: "voltar a
 * frase" conta palavras relidas, entao 800 lidas podem cobrir um pouco menos
 * de 800 posicoes. Abaixo disso nao ha o que perguntar.
 */
export const MIN_SESSION_RANGE_WORDS = 200;

/** Intervalo de palavras [from, to) do trecho lido na sessao. */
export interface SessionRange {
  from: number;
  to: number;
}

/**
 * O trecho da sessao, quando a checagem deve ser oferecida; senao null.
 *
 * So o Word Runner conta: narracao e pagina virada nao medem o mesmo ritmo,
 * e o treino e sobre ele. A sessao precisa ter lido pelo menos
 * `MIN_SESSION_CHECK_WORDS` e a posicao precisa estar depois do inicio dela
 * (quem voltou para antes do comeco nao tem um trecho "lido" a perguntar).
 */
export function sessionCheckRange(session: {
  mode: SessionMode | null;
  /** Palavras lidas na sessao. */
  words: number;
  /** Posicao em que a sessao comecou; null sem sessao aberta. */
  from: number | null;
  /** Posicao atual da leitura. */
  position: number;
  /** Palavras do texto. */
  total: number;
}): SessionRange | null {
  if (session.mode !== "runner" || session.from === null) return null;
  if (session.words < MIN_SESSION_CHECK_WORDS) return null;
  const from = Math.max(0, Math.trunc(session.from));
  const to = Math.min(Math.trunc(session.position), session.total);
  if (to <= from) return null;
  return { from, to };
}

/** O intervalo pedido a rota e um trecho valido deste texto? */
export function validSessionRange(range: unknown, total: number): range is SessionRange {
  if (!range || typeof range !== "object") return false;
  const { from, to } = range as Record<string, unknown>;
  if (!Number.isInteger(from) || !Number.isInteger(to)) return false;
  const start = from as number;
  const end = to as number;
  return start >= 0 && end <= total && end - start >= MIN_SESSION_RANGE_WORDS;
}

/**
 * Texto enviado ao modelo: so as palavras do trecho, na ordem. O fim e
 * exclusivo - a palavra na posicao atual ainda nao foi lida - e nunca passa
 * do fim do texto.
 */
export function sessionExcerpt(words: string[], range: SessionRange): string {
  const end = Math.min(range.to, words.length);
  const start = Math.max(0, Math.min(range.from, end));
  return words.slice(start, end).join(" ");
}

/**
 * Chave do questionario da sessao no mesmo cache do questionario do texto:
 * a do conteudo, com o trecho. A mesma sessao pedida de novo nao gera de
 * novo; outro trecho gera outro.
 */
export function sessionQuizKey(textKey: string, range: SessionRange): string {
  return `${textKey}:sessao:${range.from}-${range.to}`;
}
