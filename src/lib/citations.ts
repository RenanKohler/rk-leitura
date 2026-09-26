/**
 * Referencias no corpo de artigos cientificos.
 *
 * "[12]", "(Silva et al., 2020)" e "(2019)" interrompem a leitura dinamica:
 * no modo Foco cada uma vira uma palavra na tela, sem nada a dizer ao leitor.
 * A limpeza roda na importacao, nunca na leitura - mudar a lista de palavras
 * de um texto ja salvo deslocaria a posicao e os destaques dele.
 *
 * Funcoes puras, usadas no navegador (pre-visualizacao) e no servidor.
 */

/** A partir de quantas citacoes o texto e tratado como artigo cientifico. */
export const MIN_CITATIONS = 3;

// Numericas: [1], [1, 2], [3-5], [2–4, 7], tambem como link Markdown [1](#r1)
// e nota de rodape [^1].
const NUMERIC = /[ \t]?\[(?:\^?\d{1,4}(?:\s*[-–,]\s*\d{1,4})*)\](?:\([^)\s]*\))?/g;

// Algarismos sobrescritos colados a palavra: "resultado¹²".
const SUPERSCRIPT = /(?<=[\p{L}.,;:)])[¹²³⁰-⁹]+(?:[,⁻–-][¹²³⁰-⁹]+)*/gu;

const YEAR = String.raw`(?:19|20)\d{2}[a-z]?`;
const PAGES = String.raw`(?:\s*[,:]\s*(?:p{1,2}\.?|pag\.?|cap\.?)\s*\d+(?:\s*[-–]\s*\d+)?)?`;

// "(2020)" ou "(2019, 2021a)" logo depois do nome do autor, na narrativa.
const YEAR_ONLY = new RegExp(String.raw`[ \t]?\(\s*${YEAR}(?:\s*[,;]\s*${YEAR})*${PAGES}\s*\)`, "g");

// Parenteses em geral: cada trecho separado por ";" e conferido abaixo.
const PARENTHESES = /[ \t]?\(([^()\n]{4,400})\)/g;

// Um trecho de citacao autor-data: comeca com nome proprio (ou "ver",
// "cf."), tem no maximo 12 palavras e termina no ano.
const AUTHOR_YEAR = new RegExp(
  String.raw`^(?:(?:ver|veja|cf\.|see|e\.g\.,?|i\.e\.,?|apud)\s+)?` +
    String.raw`\p{Lu}[\p{L}'’.\-]*(?:[\s,]+(?:et\s+al\.?|e|and|&|de|da|do|dos|das|van|von|der|\p{Lu}[\p{L}'’.\-]*))*` +
    String.raw`,?\s+${YEAR}(?:\s*,\s*${YEAR})*${PAGES}$`,
  "u"
);

function isAuthorYear(inside: string): boolean {
  const parts = inside.split(";").map((part) => part.trim());
  return parts.every((part) => part.split(/\s+/).length <= 12 && AUTHOR_YEAR.test(part));
}

// Titulo da lista de referencias no fim do artigo.
const REFERENCES_HEADING =
  /^(?:#{1,6}\s*)?(?:\d+\.?\s*)?(?:refer[eê]ncias(?:\s+bibliogr[aá]ficas)?|references|bibliografia|bibliography|works cited|literature cited|literatura citada)\s*:?\s*$/im;

export interface CitationResult {
  text: string;
  /** Quantas citacoes sairam do corpo. */
  removed: number;
  /** Se a lista de referencias do fim foi cortada. */
  referencesCut: boolean;
}

/** Conta e remove as citacoes, sem decidir se o texto e cientifico. */
function strip(text: string): { text: string; removed: number } {
  let removed = 0;
  const drop = () => {
    removed += 1;
    return "";
  };

  let out = text.replace(NUMERIC, drop);
  out = out.replace(SUPERSCRIPT, drop);
  out = out.replace(YEAR_ONLY, drop);
  out = out.replace(PARENTHESES, (match, inside: string) => (isAuthorYear(inside) ? drop() : match));

  // O que a remocao deixa para tras: espaco antes de pontuacao e espaco duplo.
  out = out.replace(/[ \t]+([.,;:!?])/g, "$1").replace(/[ \t]{2,}/g, " ");
  return { text: out, removed };
}

/** Quantas citacoes o texto tem no corpo. */
export function countCitations(text: string): number {
  return strip(text).removed;
}

export function looksScientific(text: string): boolean {
  return countCitations(text) >= MIN_CITATIONS;
}

/**
 * Remove as citacoes do corpo e, se houver, a lista de referencias do fim.
 *
 * A lista so e cortada quando o titulo aparece na segunda metade do texto:
 * uma secao "Referencias" no comeco seria outra coisa (um indice, um aviso).
 */
export function stripCitations(text: string): CitationResult {
  const body = strip(text);
  let result = body.text;
  let referencesCut = false;

  const heading = REFERENCES_HEADING.exec(result);
  if (heading && heading.index > result.length / 2) {
    result = result.slice(0, heading.index).trimEnd();
    referencesCut = true;
  }

  return { text: result, removed: body.removed, referencesCut };
}

/**
 * O que a importacao grava: sem citacoes quando o texto parece artigo
 * cientifico e o leitor nao pediu para mante-las.
 */
export function importContent(text: string, keepCitations: boolean): string {
  if (keepCitations || !looksScientific(text)) return text;
  return stripCitations(text).text;
}
