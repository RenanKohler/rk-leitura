/**
 * Ligacoes entre textos (US-232). Funcoes puras, com teste.
 *
 * "Busca por significado" esta fora do escopo (Won't Have do backlog): nada de
 * embeddings nem indice vetorial. Os candidatos saem por meios lexicais:
 *
 * 1. os termos caracteristicos deste texto (palavras frequentes aqui, sem
 *    stopwords), cada um procurado como comeco de palavra no conteudo dos
 *    outros textos da conta;
 * 2. o peso de cada termo cai quanto mais textos da biblioteca o tem (termo
 *    que aparece em quase tudo nao separa nada);
 * 3. de cada candidato, so os paragrafos com mais termos em comum, dentro de
 *    um teto de caracteres.
 *
 * So entao o modelo ve o trecho deste texto e os dos candidatos, e cada
 * ligacao que ele devolve precisa trazer as duas citacoes literais, conferidas
 * aqui contra os paragrafos enviados. A que nao passa e descartada.
 */

import { findQuote, matchKey, matchKeys, spanText } from "@/lib/passage-match";
import type { Paragraph } from "@/lib/reading";
import { foldForSearch } from "@/lib/text-filter";

/** Termos deste texto procurados na biblioteca. */
export const MAX_TERMS = 20;
/** Termo curto demais casa com qualquer coisa como comeco de palavra. */
export const MIN_TERM_LENGTH = 5;
/** Aparicoes minimas no texto para virar termo caracteristico. */
export const MIN_TERM_COUNT = 2;
/** Textos candidatos enviados ao modelo. */
export const MAX_CANDIDATES = 6;
/** Termos em comum para um texto virar candidato. */
export const MIN_SHARED_TERMS = 2;
/** Teto de caracteres da amostra deste texto. */
export const SAMPLE_CHARS = 12_000;
/** Teto de caracteres somando os trechos de todos os candidatos. */
export const CANDIDATE_CHARS = 24_000;
/** Teto de caracteres por candidato, mesmo quando ha poucos. */
export const MAX_CHARS_PER_CANDIDATE = 6_000;
/** Ligacoes mostradas. */
export const MAX_LINKS = 5;
/** A relacao e uma frase. */
export const MAX_RELATION_CHARS = 240;

export const NO_CANDIDATES = "Nenhum outro texto da biblioteca trata deste assunto ainda.";
export const NO_LINKS = "Não encontrei ligações claras com os outros textos da biblioteca.";

/**
 * Palavras funcionais (portugues, e o basico do ingles e do espanhol) que
 * passam do tamanho minimo e nao dizem nada sobre o assunto. Ja sem acento.
 */
const STOPWORDS = new Set(
  [
    // portugues
    "abaixo acima agora ainda alem algum alguma algumas alguns antes apenas apesar apos aquela aquelas aquele aqueles aquilo assim atraves baixo bastante cada coisa coisas como contra contudo dela delas dele deles demais depois desde dessa dessas desse desses desta destas deste destes deve devem devia dizer disse durante ela elas embora enquanto entao entre essa essas esse esses esta estas estamos estao estar estava estavam este estes estou fazer feito fica ficar fique foram fosse fossem grande grandes havia hoje isso isto jamais mais mesma mesmas mesmo mesmos muita muitas muito muitos nada nenhum nenhuma nesse nessa neste nesta ninguem nossa nossas nosso nossos nunca onde outra outras outro outros para parece pela pelas pelo pelos perto pode podem poder podia porem porque porquanto pouca poucas pouco poucos primeiro primeira quais qual qualquer quando quanto quase quem sabe sempre sendo seria seriam serao seus sido sobre sozinho suas talvez tambem tampouco tanta tantas tanto tantos tendo tenho terao teria teve tinha tinham toda todas todo todos tudo vamos voce voces volta outrora aquilo deveria poderia queria quero",
    // ingles
    "about above after again against also among another because been before being below between both could does doing down during each every from further have having here into itself just more most much must never only other over same shall should since some such than that their theirs them then there these they this those through under until upon very were what when where which while whom whose will with within without would your yours",
    // espanhol
    "aunque cuando desde donde entonces hasta luego mientras nosotros otras otros porque pues puede sobre tambien tiene tienen todas todos usted ustedes",
  ]
    .join(" ")
    .split(/\s+/)
);

/** Forma comparavel de uma palavra para a busca na biblioteca: sem acento. */
export function termKey(word: string): string {
  return foldForSearch(matchKey(word));
}

/** Termo valido: so letras (o SQL o usa num padrao de comeco de palavra). */
function isTermShape(key: string): boolean {
  return key.length >= MIN_TERM_LENGTH && /^\p{L}+$/u.test(key) && !STOPWORDS.has(key);
}

export interface Term {
  term: string;
  /** Aparicoes neste texto. */
  count: number;
}

/**
 * Termos caracteristicos deste texto: as palavras mais frequentes, sem
 * stopwords, sem numeros e com pelo menos 5 letras. Empate: ordem alfabetica,
 * para a escolha ser estavel.
 */
export function characteristicTerms(words: string[], max = MAX_TERMS): Term[] {
  const counts = new Map<string, number>();
  for (const word of words) {
    const key = termKey(word);
    if (!isTermShape(key)) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts]
    .filter(([, count]) => count >= MIN_TERM_COUNT)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, max)
    .map(([term, count]) => ({ term, count }));
}

export interface LibraryRow {
  id: string;
  title: string;
  updatedAt: Date | string;
  seriesKey: string | null;
  chapter: number | null;
  /** Um por termo, na ordem de `characteristicTerms`: o texto tem o termo. */
  hits: boolean[];
}

export interface Candidate {
  id: string;
  title: string;
  updatedAt: string;
  seriesKey: string | null;
  chapter: number | null;
  score: number;
  /** Termos em comum com este texto. */
  shared: string[];
}

/**
 * Ate 6 candidatos: os textos com mais termos em comum, cada termo pesado
 * pela raridade na biblioteca (idf) e pela frequencia aqui. Texto com menos de
 * 2 termos em comum nao entra.
 */
export function rankCandidates(
  rows: LibraryRow[],
  terms: Term[],
  max = MAX_CANDIDATES
): Candidate[] {
  if (rows.length === 0 || terms.length === 0) return [];
  const total = rows.length;
  const df = terms.map((_, index) => rows.filter((row) => row.hits[index]).length);
  const weight = terms.map((term, index) => {
    const idf = Math.log((total + 1) / (df[index]! + 0.5));
    return Math.max(0, idf) * Math.log(1 + term.count);
  });

  const ranked: Candidate[] = [];
  for (const row of rows) {
    const shared: string[] = [];
    let score = 0;
    terms.forEach((term, index) => {
      if (!row.hits[index]) return;
      shared.push(term.term);
      score += weight[index]!;
    });
    if (shared.length < MIN_SHARED_TERMS || score <= 0) continue;
    ranked.push({
      id: row.id,
      title: row.title,
      updatedAt: new Date(row.updatedAt).toISOString(),
      seriesKey: row.seriesKey,
      chapter: row.chapter,
      score,
      shared,
    });
  }
  ranked.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));
  return ranked.slice(0, max);
}

/** Hash curto e estavel (FNV-1a), para chaves de cache. */
function shortHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

/**
 * Chave do resultado guardado: muda quando este texto muda (impressao do
 * conteudo) ou quando a biblioteca muda (outros candidatos, ou um deles
 * editado).
 */
export function linksKey(
  textId: string,
  fingerprint: string,
  candidates: Pick<Candidate, "id" | "updatedAt">[]
): string {
  const library = candidates
    .map((candidate) => `${candidate.id}@${candidate.updatedAt}`)
    .sort()
    .join("|");
  return `${textId}:${fingerprint}:${candidates.length}-${shortHash(library)}`;
}

export interface Block {
  /** Primeira palavra do paragrafo, no texto inteiro. */
  start: number;
  /** Palavra seguinte a ultima. */
  end: number;
  text: string;
}

/**
 * Paragrafos com mais termos (distintos) em comum, ate o teto de caracteres,
 * devolvidos na ordem do texto. O termo casa como comeco de palavra, como na
 * consulta ("leitura" acha "leituras"). Paragrafo sem nenhum termo nao entra;
 * paragrafo maior que o teto inteiro e cortado no teto.
 */
export function pickParagraphs(paragraphs: Paragraph[], terms: string[], maxChars: number): Block[] {
  if (terms.length === 0 || maxChars <= 0) return [];
  const scored: { paragraph: Paragraph; score: number; size: number }[] = [];
  for (const paragraph of paragraphs) {
    if (paragraph.words.length === 0) continue;
    const keys = paragraph.words.map(termKey);
    let score = 0;
    for (const term of terms) if (keys.some((key) => key.startsWith(term))) score += 1;
    if (score === 0) continue;
    scored.push({ paragraph, score, size: paragraph.words.join(" ").length });
  }
  scored.sort((a, b) => b.score - a.score || a.paragraph.start - b.paragraph.start);

  const chosen: Block[] = [];
  let used = 0;
  for (const { paragraph, size } of scored) {
    const room = maxChars - used;
    if (room <= 0) break;
    if (size <= room) {
      chosen.push({
        start: paragraph.start,
        end: paragraph.start + paragraph.words.length,
        text: paragraph.words.join(" "),
      });
      used += size + 2;
      continue;
    }
    // So o primeiro escolhido pode ser cortado: os outros esperam caber.
    if (chosen.length > 0) continue;
    const words: string[] = [];
    let length = 0;
    for (const word of paragraph.words) {
      const next = length + (words.length > 0 ? 1 : 0) + word.length;
      if (next > room) break;
      words.push(word);
      length = next;
    }
    if (words.length === 0) continue;
    chosen.push({ start: paragraph.start, end: paragraph.start + words.length, text: words.join(" ") });
    used += length + 2;
  }
  return chosen.sort((a, b) => a.start - b.start);
}

/** Teto de caracteres de cada candidato, repartindo o total. */
export function charsPerCandidate(count: number): number {
  if (count <= 0) return 0;
  return Math.min(MAX_CHARS_PER_CANDIDATE, Math.floor(CANDIDATE_CHARS / count));
}

/** Rotulo de um candidato no pedido ao modelo. */
export function candidateLabel(index: number): string {
  return `T${index + 1}`;
}

export interface SourceText {
  id: string;
  title: string;
  words: string[];
  blocks: Block[];
  /** Capitulo da mesma serie deste texto. */
  sameSeries?: boolean;
  chapter?: number | null;
}

/** Mensagem do pedido: este texto e os trechos dos candidatos, rotulados. */
export function linksMessage(here: SourceText, others: SourceText[]): string {
  const parts = [`ESTE TEXTO — Título: ${here.title}`, "", ...here.blocks.map((block) => block.text)];
  others.forEach((other, index) => {
    const series = other.sameSeries
      ? ` (mesma série deste texto${other.chapter !== null && other.chapter !== undefined ? `, capítulo ${other.chapter}` : ""})`
      : "";
    parts.push("", `--- ${candidateLabel(index)} — Título: ${other.title}${series}`, "");
    for (const block of other.blocks) parts.push(block.text);
  });
  return parts.join("\n\n").replace(/\n{3,}/g, "\n\n");
}

export interface QuoteSpan {
  quote: string;
  start: number;
  end: number;
}

export interface TextLink {
  /** O outro texto. */
  textId: string;
  title: string;
  /** A relacao, em uma frase. */
  relation: string;
  here: QuoteSpan;
  other: QuoteSpan;
  sameSeries: boolean;
}

/** Citacao dentro de um dos paragrafos enviados, ou null. */
export function quoteInBlocks(
  words: string[],
  keys: string[],
  blocks: Block[],
  raw: unknown
): QuoteSpan | null {
  for (const block of blocks) {
    const span = findQuote(keys, raw, block.start, block.end);
    if (span) return { quote: spanText(words, span), start: span.start, end: span.end };
  }
  return null;
}

/** Relacao limpa: uma frase, sem espacos sobrando, dentro do teto. */
export function cleanRelation(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const text = raw.replace(/\s+/g, " ").trim();
  return text.length > MAX_RELATION_CHARS ? "" : text;
}

/**
 * Ate 5 ligacoes, cada uma com as duas citacoes conferidas literalmente nos
 * paragrafos enviados: a deste texto e a do outro. Rotulo desconhecido,
 * relacao vazia ou longa, citacao que nao aparece: descartada. Duas ligacoes
 * com a mesma citacao do outro texto contam uma vez.
 */
export function validLinks(raw: unknown, here: SourceText, others: SourceText[]): TextLink[] {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as { links?: unknown }).links)
      ? (raw as { links: unknown[] }).links
      : [];
  const hereKeys = matchKeys(here.words);
  const otherKeys = new Map<number, string[]>();
  const result: TextLink[] = [];
  const seen = new Set<string>();

  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const entry = item as { label?: unknown; relation?: unknown; quoteHere?: unknown; quoteOther?: unknown };
    const label = typeof entry.label === "string" ? entry.label.trim().toUpperCase() : "";
    const index = others.findIndex((_, position) => candidateLabel(position) === label);
    if (index === -1) continue;
    const other = others[index]!;
    const relation = cleanRelation(entry.relation);
    if (!relation) continue;

    const hereSpan = quoteInBlocks(here.words, hereKeys, here.blocks, entry.quoteHere);
    if (!hereSpan) continue;
    if (!otherKeys.has(index)) otherKeys.set(index, matchKeys(other.words));
    const otherSpan = quoteInBlocks(other.words, otherKeys.get(index)!, other.blocks, entry.quoteOther);
    if (!otherSpan) continue;

    const id = `${other.id}:${otherSpan.start}`;
    if (seen.has(id)) continue;
    seen.add(id);
    result.push({
      textId: other.id,
      title: other.title,
      relation,
      here: hereSpan,
      other: otherSpan,
      sameSeries: other.sameSeries ?? false,
    });
    if (result.length === MAX_LINKS) break;
  }
  return result;
}

export interface StoredLinks {
  links: TextLink[];
}

function isSpan(value: unknown): value is QuoteSpan {
  if (!value || typeof value !== "object") return false;
  const span = value as Record<string, unknown>;
  return (
    typeof span.quote === "string" &&
    Number.isInteger(span.start) &&
    Number.isInteger(span.end) &&
    (span.end as number) > (span.start as number)
  );
}

/** Resultado guardado, conferido na leitura; null quando nao serve. */
export function parseStoredLinks(value: unknown): StoredLinks | null {
  if (!value || typeof value !== "object") return null;
  const links = (value as { links?: unknown }).links;
  if (!Array.isArray(links)) return null;
  const valid = links.filter((link): link is TextLink => {
    if (!link || typeof link !== "object") return false;
    const item = link as Record<string, unknown>;
    return (
      typeof item.textId === "string" &&
      typeof item.title === "string" &&
      typeof item.relation === "string" &&
      isSpan(item.here) &&
      isSpan(item.other)
    );
  });
  if (valid.length !== links.length) return null;
  return { links: valid.map((link) => ({ ...link, sameSeries: Boolean(link.sameSeries) })) };
}
