/**
 * Leitura em voz alta.
 *
 * Usa a sintese do proprio aparelho: nao custa nada, nao precisa de chave e
 * funciona sem rede. Em troca, o que existe depende do sistema - a voz, o
 * idioma e ate se o evento de fronteira de palavra chega.
 *
 * Funcoes puras, testaveis sem navegador.
 */

import { clamp } from "@/lib/reading";

/** Ritmo aproximado de uma voz sintetica em velocidade 1. */
export const BASE_SPEECH_WPM = 180;

/**
 * Faixa de velocidade aceita.
 *
 * Acima de 2,5 as vozes do sistema viram ruido: os fonemas se sobrepoem e a
 * fala deixa de ser compreensivel, que e o oposto do que a narracao serve.
 */
export const MIN_RATE = 0.5;
export const MAX_RATE = 2.5;

/** Velocidade da voz para um ritmo pedido em ppm. */
export function rateFor(wpm: number): number {
  return clamp(Number((wpm / BASE_SPEECH_WPM).toFixed(2)), MIN_RATE, MAX_RATE);
}

/** Ritmo que a voz de fato entrega naquela velocidade. */
export function wpmFor(rate: number): number {
  return Math.round(rate * BASE_SPEECH_WPM);
}

/** O ritmo pedido cabe na faixa da voz? */
export function withinVoiceRange(wpm: number): boolean {
  return wpm <= wpmFor(MAX_RATE) && wpm >= wpmFor(MIN_RATE);
}

/** Aviso do ritmo aplicado, quando ele difere do pedido. */
export function rateNotice(wpm: number): string | null {
  if (withinVoiceRange(wpm)) return null;
  const applied = wpmFor(rateFor(wpm));
  return `A voz do aparelho vai ate ${applied} ppm. A narracao usa esse ritmo; a leitura na tela continua em ${wpm}.`;
}

export interface VoiceLike {
  name: string;
  lang: string;
  localService?: boolean;
  default?: boolean;
}

/**
 * Melhor voz para um idioma.
 *
 * Prefere a variante exata ("pt-BR"), depois qualquer voz do idioma
 * ("pt-PT" serve para ler portugues), e dentro disso a local: a voz de rede
 * costuma engasgar no meio do paragrafo quando a conexao oscila.
 */
export function pickVoice(voices: VoiceLike[], lang = "pt-BR"): VoiceLike | null {
  const wanted = lang.toLowerCase();
  const base = wanted.split("-")[0]!;

  const exact = voices.filter((voice) => voice.lang.toLowerCase().replace("_", "-") === wanted);
  const sameLanguage = voices.filter((voice) => voice.lang.toLowerCase().startsWith(base));

  const ordered = [...(exact.length > 0 ? exact : sameLanguage)].sort(
    (a, b) =>
      Number(Boolean(b.localService)) - Number(Boolean(a.localService)) ||
      Number(Boolean(b.default)) - Number(Boolean(a.default))
  );

  return ordered[0] ?? null;
}

/**
 * Quebra o texto em falas curtas.
 *
 * Um paragrafo inteiro em uma fala atrasa a parada: cancelar no meio de uma
 * fala longa corta a frase, e em alguns sistemas demora a responder. Frases
 * tambem dao o ponto de sincronia quando o evento de palavra nao chega.
 */
export function speechChunks(
  words: string[],
  start: number,
  maxWords = 40
): { start: number; words: string[] }[] {
  const chunks: { start: number; words: string[] }[] = [];
  let current: string[] = [];
  let from = start;

  const flush = () => {
    if (current.length > 0) {
      chunks.push({ start: from, words: current });
      from += current.length;
      current = [];
    }
  };

  for (let index = start; index < words.length; index += 1) {
    current.push(words[index]!);
    const ends = /[.!?…][")'\]»”’]*$/.test(words[index]!);
    if (ends || current.length >= maxWords) flush();
  }

  flush();
  return chunks;
}

/**
 * Indice da palavra que comeca no caractere `charIndex` de uma fala.
 *
 * E assim que o evento de fronteira do navegador vira posicao de leitura: ele
 * informa o deslocamento em caracteres dentro do texto falado, nao a palavra.
 */
export function wordAtCharIndex(words: string[], charIndex: number): number {
  let consumed = 0;
  for (let index = 0; index < words.length; index += 1) {
    consumed += words[index]!.length + 1;
    if (charIndex < consumed) return index;
  }
  return Math.max(0, words.length - 1);
}
