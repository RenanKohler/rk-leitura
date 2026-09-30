/**
 * Segmentador de frases unico.
 *
 * Antes cada modulo tinha a propria regex de fim de frase: o ritmo sabia que
 * "Sr. Silva" nao encerra a frase, mas "Voltar a frase", o destaque da frase,
 * a recapitulacao e a narracao partiam ali. Agora todos perguntam aqui, entao
 * a frase e a mesma em qualquer lugar do app.
 *
 * Modulo folha de proposito: so depende de `language.ts`, para o ritmo
 * (pacing), a navegacao, os destaques e a voz poderem importa-lo sem ciclo.
 */
import { normalizeLanguage } from "@/lib/language";

/** Pontuacao terminal, com aspas, parenteses e colchetes de fecho depois. */
export const SENTENCE_MARK = /[.!?…]["'”’»)\]]*$/u;
/** "?", "!" e reticencias sempre encerram; so o ponto depende do contexto. */
const STRONG_MARK = /(?:[!?…]|\.\.\.)[^\p{L}\p{N}]*$/u;
/** Fecho que pode vir depois da pontuacao: `fim."`, `(sic).` */
const CLOSERS = /["'”’»)\]]+$/u;
/** Abertura antes da palavra: aspas, parenteses, travessao de dialogo. */
const OPENERS = /^["'“‘«(\[–—-]+/u;

/**
 * Tratamentos: vem antes de um nome e nunca encerram a frase ("Sr. Silva").
 * Valem em qualquer idioma: "Dr." e "Prof." aparecem em textos pt e en.
 */
const TITLES = new Set([
  "sr", "sra", "srta", "srs", "sras", "dr", "dra", "drs", "dras", "prof", "profa", "profs",
  "sto", "sta", "mr", "mrs", "ms", "mme", "mlle", "exmo", "exma", "revmo", "rev", "gen",
  "cel", "sgt",
]);

/**
 * Abreviaturas que terminam em ponto sem terminar a frase. Comparacao sem
 * acento e em minusculas, com os pontos internos preservados ("a.c", "s.a").
 *
 * Nao entram aqui as que tambem sao palavras comuns e so viram abreviatura em
 * contexto: ver `WEAK_ABBREVIATIONS` e `DIGIT_ABBREVIATIONS`.
 */
const ABBREVIATIONS: Record<"pt" | "en", Set<string>> = {
  pt: new Set([
    "av", "pag", "pags", "pg", "pp", "cap", "caps", "ex", "fig", "figs", "vol", "vols", "ed",
    "eds", "obs", "cf", "vs", "cit", "ibid", "op", "loc", "et", "al", "aprox", "tel", "dept",
    "depto", "ltda", "cia", "e.g", "i.e", "art", "arts", "inc", "num", "sec", "secs", "seg",
    "tab", "tabs", "nº", "n°", "a.c", "d.c", "s.a", "p.ex", "eq", "eqs", "cols", "col",
    "org", "orgs", "trad", "reimpr", "coord", "adapt", "apud", "id",
  ]),
  en: new Set([
    "u.s", "u.k", "e.g", "i.e", "vs", "fig", "figs", "pp", "et", "al", "vol", "vols", "ch",
    "ed", "eds", "eq", "eqs", "approx", "dept", "inc", "ltd", "co", "corp", "jr", "st", "cf",
    "ibid", "op", "cit", "est", "ave", "a.d", "b.c",
  ]),
};

/**
 * Abreviaturas curtas demais ou que sao tambem palavras ("mar", "set",
 * "out"): so contam como abreviatura antes de numero, algarismo romano,
 * parentese ou minuscula. Antes de maiuscula o ponto encerra a frase ("o
 * mar. Depois").
 */
const WEAK_ABBREVIATIONS: Record<"pt" | "en", Set<string>> = {
  pt: new Set([
    "p", "n", "v", "c", "s", "fl", "fls", "jan", "fev", "mar", "abr", "mai", "jun", "jul",
    "ago", "set", "out", "nov", "dez",
  ]),
  en: new Set([
    "p", "n", "v", "c", "s", "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept",
    "oct", "nov", "dec",
  ]),
};

/** So sao abreviatura antes de digito: "no. 5" e "No. 5" (numero). */
const DIGIT_ABBREVIATIONS = new Set(["no", "nos"]);

/**
 * Palavras que costumam vir antes de um nome com inicial ("de J. Silva",
 * "por A. Souza", "by J. Smith"). Depois delas a inicial emenda no nome; depois
 * de um substantivo comum ("vitamina D. Depois") o ponto encerra a frase.
 */
const NAME_PRECEDERS = new Set([
  "de", "da", "do", "das", "dos", "por", "com", "e", "a", "o", "as", "os", "para", "segundo",
  "conforme", "em", "entre", "sobre", "and", "by", "of", "with", "to", "from", "for", "the",
  "et", "y", "und", "von", "van",
]);

const ROMAN = /^[IVXLCDM]+\b/u;
const DIGIT_START = /^\p{N}/u;
const UPPER_START = /^\p{Lu}/u;
const LOWER_START = /^\p{Ll}/u;
/** Marcador de lista escrito no texto: "1." "2)" "10.". */
const LIST_MARKER = /^\d{1,3}[.)]$/;
/** Inicial de nome: uma letra maiuscula e ponto ("J.", "(J."). */
const INITIAL = /^[^\p{L}]*\p{Lu}\.$/u;

type AbbrevLanguage = "pt" | "en";

function abbrevLanguage(language: string | undefined): AbbrevLanguage {
  return normalizeLanguage(language) === "en" ? "en" : "pt";
}

/** Palavra sem aspas/parenteses de abertura: o que o leitor ve como inicio. */
function lead(word: string | undefined): string {
  return (word ?? "").replace(OPENERS, "");
}

/**
 * Forma de comparacao: sem acento, minuscula, sem abertura e sem o ponto e o
 * fecho finais ("(Sr." -> "sr", "S.A." -> "s.a", "nº." -> "nº").
 */
export function abbreviationKey(word: string): string {
  return word
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .normalize("NFC")
    .toLowerCase()
    .replace(/^[^\p{L}\p{N}]+/u, "")
    .replace(CLOSERS, "")
    .replace(/\.+$/u, "");
}

/**
 * Token que e so um marcador de lista escrito no texto ("1.", "2)").
 *
 * `paragraphStart`, quando informado, decide sozinho: so e marcador no inicio
 * do paragrafo (`pauseKinds`, `normalizedWeights`). Sem ele, conta como
 * marcador quando abre o texto ou vem depois de fim de frase, dois-pontos ou
 * ponto e virgula: "Cheguei em 12. Depois" e "do cap. 3. Depois" sao fim de
 * frase, "Passos: 1. Abrir" e marcador.
 */
export function isListMarker(
  words: string[],
  index: number,
  paragraphStart?: boolean,
  language?: string
): boolean {
  const word = words[index];
  if (word === undefined || !LIST_MARKER.test(word)) return false;
  if (paragraphStart !== undefined) return paragraphStart;
  const previous = words[index - 1];
  if (previous === undefined || /[:;]["'”’»)\]]*$/u.test(previous)) return true;
  // Depois de fim de frase de verdade; "do cap. 3." nao e marcador.
  return sentenceMark(words, index - 1, language) === "end";
}

/**
 * Como termina a palavra `index`:
 *
 * - "end"    - fecha a frase;
 * - "joined" - ponto de tratamento, abreviatura, inicial ou marcador de lista:
 *              emenda no que vem, sem pausa nenhuma;
 * - "soft"   - ponto seguido de minuscula ("3 p.m. ela"): nao fecha a frase,
 *              mas pede uma pausa curta;
 * - null     - nao termina em pontuacao de frase.
 */
export type SentenceMark = "end" | "joined" | "soft" | null;

export function sentenceMark(words: string[], index: number, language?: string): SentenceMark {
  const word = words[index];
  if (word === undefined || !SENTENCE_MARK.test(word)) return null;
  if (STRONG_MARK.test(word)) return "end";

  const next = words[index + 1];
  // Fim do texto: nao ha o que emendar.
  if (next === undefined) return "end";

  if (isListMarker(words, index, undefined, language)) return "joined";

  const key = abbreviationKey(word);
  const nextLead = lead(next);
  const nextLower = LOWER_START.test(nextLead);
  const nextUpper = UPPER_START.test(nextLead);
  // Numero, algarismo romano ou parentese: "p. 12", "vol. II", "et al. (2020)".
  const nextReference =
    DIGIT_START.test(nextLead) || ROMAN.test(nextLead) || /^[(\[]/u.test(next);

  if (TITLES.has(key)) return "joined";

  // Inicial de nome. Emenda quando a seguinte tambem e inicial ("J. R. R.
  // Tolkien") ou quando vem um nome e a anterior nao e um substantivo comum
  // em minuscula. "vitamina D. Depois" e "plano B. Ninguem" fecham a frase.
  if (INITIAL.test(word)) {
    if (INITIAL.test(next)) return "joined";
    if (nextLower) return "soft";
    if (!nextUpper) return "joined";
    const previous = lead(words[index - 1]);
    const previousCommon =
      LOWER_START.test(previous) && !NAME_PRECEDERS.has(abbreviationKey(previous));
    return previousCommon ? "end" : "joined";
  }

  const lang = abbrevLanguage(language);

  // "etc." fecha a frase antes de maiuscula ("legumes etc. Depois"); antes de
  // minuscula a enumeracao continua.
  if (key === "etc") return nextUpper ? "end" : "joined";

  if (DIGIT_ABBREVIATIONS.has(key) && DIGIT_START.test(nextLead)) return "joined";

  if (ABBREVIATIONS[lang].has(key)) {
    // Abreviatura de verdade: antes de numero, romano, parentese, nome ou
    // minuscula, emenda. So pontuacao solta depois (travessao) ainda emenda.
    return "joined";
  }

  if (WEAK_ABBREVIATIONS[lang].has(key)) {
    if (nextReference || nextLower) return "joined";
    return "end";
  }

  // Ponto seguido de minuscula nao fecha frase ("3 p.m. ela", "U.S. law").
  return nextLower ? "soft" : "end";
}

/**
 * A palavra `index` fecha uma frase?
 *
 * E a mesma regra da pausa de fim de frase do Word Runner, sem o caso de fim
 * de paragrafo. A ultima palavra do texto fecha a frase quando tem pontuacao
 * terminal.
 */
export function isSentenceEnd(words: string[], index: number, language?: string): boolean {
  return sentenceMark(words, index, language) === "end";
}

/** Primeira palavra da frase que contem `index`. */
export function sentenceStartOf(words: string[], index: number, language?: string): number {
  if (words.length === 0) return 0;
  let position = Math.max(0, Math.min(words.length - 1, Math.trunc(index) || 0));
  while (position > 0 && !isSentenceEnd(words, position - 1, language)) position -= 1;
  return position;
}

/**
 * Intervalo `[start, end)` da frase que contem `index`. Sem teto de tamanho:
 * quem precisa de um (destaque, contexto) recorta depois.
 */
export function sentenceBounds(
  words: string[],
  index: number,
  language?: string
): { start: number; end: number } {
  if (words.length === 0) return { start: 0, end: 0 };
  const position = Math.max(0, Math.min(words.length - 1, Math.trunc(index) || 0));
  const start = sentenceStartOf(words, position, language);
  let end = position;
  while (end < words.length - 1 && !isSentenceEnd(words, end, language)) end += 1;
  return { start, end: end + 1 };
}
