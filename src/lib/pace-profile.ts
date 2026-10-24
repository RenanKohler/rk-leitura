/**
 * Perfil de ritmo do texto (US-209): o que o "tempo livre" precisa saber do
 * conteudo, resumido por paragrafo e gravado junto do texto.
 *
 * A sugestao por tempo livre lia e analisava o conteudo de ate 40 textos a
 * cada pedido. O perfil guarda, por paragrafo, onde ele termina, a soma dos
 * pesos das palavras e quantas pausas de cada tipo ele tem: com isso a
 * previsao do Word Runner (`predictRunnerMs`) se refaz em qualquer ritmo sem
 * o texto. O banco apaga o perfil quando o conteudo, o formato ou o idioma
 * mudam, e a proxima consulta o refaz.
 */
import {
  asTextFormat,
  parseParagraphs,
  warmupFactor,
  WARMUP_WORDS,
} from "@/lib/reading";
import { normalizedWeights, pauseKinds, pauseMs } from "@/lib/pacing";

/** Sobe quando a regra de pesos ou pausas muda: perfil antigo e refeito. */
export const PACE_PROFILE_VERSION = 1;

export interface PaceProfile {
  v: number;
  /** Indice (exclusivo) da ultima palavra de cada paragrafo nao vazio. */
  ends: number[];
  /** Soma dos pesos normalizados das palavras do paragrafo. */
  weights: number[];
  /** Pausas de virgula, de frase e de paragrafo depois das palavras dele. */
  clause: number[];
  sentence: number[];
  paragraph: number[];
}

const round = (value: number) => Math.round(value * 1000) / 1000;

export function buildPaceProfile(
  content: string,
  format: string | null | undefined,
  language?: string,
): PaceProfile {
  const { words, paragraphs } = parseParagraphs(content, asTextFormat(format));
  const weights = normalizedWeights(words, new Set(), paragraphs, language);
  const pauses = pauseKinds(words, paragraphs, language);
  const profile: PaceProfile = {
    v: PACE_PROFILE_VERSION,
    ends: [],
    weights: [],
    clause: [],
    sentence: [],
    paragraph: [],
  };
  for (const block of paragraphs) {
    if (block.words.length === 0) continue;
    const end = block.start + block.words.length;
    let weight = 0;
    const count = { clause: 0, sentence: 0, paragraph: 0 };
    for (let index = block.start; index < end; index += 1) {
      weight += weights[index] ?? 1;
      const pause = pauses[index];
      if (pause && pause !== "none") count[pause] += 1;
    }
    profile.ends.push(end);
    profile.weights.push(round(weight));
    profile.clause.push(count.clause);
    profile.sentence.push(count.sentence);
    profile.paragraph.push(count.paragraph);
  }
  return profile;
}

/** O perfil gravado, se ainda serve; null pede para refazer. */
export function asPaceProfile(value: unknown): PaceProfile | null {
  if (!value || typeof value !== "object") return null;
  const profile = value as Partial<PaceProfile>;
  if (profile.v !== PACE_PROFILE_VERSION) return null;
  const size = profile.ends?.length;
  if (size === undefined) return null;
  for (const key of ["weights", "clause", "sentence", "paragraph"] as const) {
    if (!Array.isArray(profile[key]) || profile[key].length !== size)
      return null;
  }
  return profile as PaceProfile;
}

/**
 * O mesmo que `fitParagraphEnd` com o texto (pesos, pausas e rampa), a partir
 * do perfil. Dentro de um paragrafo as palavras contam pela media dele: no
 * paragrafo em que a leitura parou e nas 25 palavras da rampa a previsao e
 * aproximada; nos paragrafos inteiros, igual.
 */
export function fitProfileEnd(
  profile: PaceProfile,
  from: number,
  budgetMs: number,
  wpm: number,
  warmup: boolean,
  adaptive: boolean,
): { end: number; predictedMs: number } | null {
  const perWord = 60_000 / Math.max(wpm, 1);
  const pause = {
    clause: pauseMs("clause", wpm),
    sentence: pauseMs("sentence", wpm),
    paragraph: pauseMs("paragraph", wpm),
  };
  const origin = Math.max(0, Math.trunc(from));

  let best: { end: number; predictedMs: number } | null = null;
  let predicted = 0;
  let start = 0;
  let read = 0;

  for (let position = 0; position < profile.ends.length; position += 1) {
    const end = profile.ends[position]!;
    const size = end - start;
    const blockStart = start;
    start = end;
    if (end <= from || size <= 0) continue;

    // Tempo medio de uma palavra do paragrafo, sem a rampa.
    const mean = adaptive
      ? (perWord * profile.weights[position]! +
          pause.clause * profile.clause[position]! +
          pause.sentence * profile.sentence[position]! +
          pause.paragraph * profile.paragraph[position]!) /
        size
      : perWord;
    const counted = end - Math.max(blockStart, origin);

    // A rampa desacelera palavra e pausa pelo mesmo fator (`runnerDelayMs`).
    let ramp = 0;
    if (warmup) {
      for (
        let offset = 0;
        offset < counted && read + offset < WARMUP_WORDS;
        offset += 1
      ) {
        ramp += 1 / warmupFactor(read + offset) - 1;
      }
    }
    predicted += mean * (counted + ramp);
    read += counted;

    if (predicted > budgetMs) break;
    best = { end, predictedMs: predicted };
  }

  return best;
}
