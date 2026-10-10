/**
 * Cartoes de estudo gerados pela IA e criados a mao (US-155, US-157, US-159,
 * US-170). Funcoes puras, usadas na rota, na tela e nos testes.
 *
 * O modelo recebe o texto completo (US-155, exceto acima do teto, que vai em
 * trechos como no questionario) e devolve, para cada cartao, o trecho de
 * origem copiado do texto. E esse trecho que da a posicao do cartao: so com
 * ela a regra de exibicao (`splitByReading`) sabe se o cartao ja pode
 * aparecer. Cartao cujo trecho nao esta no texto e descartado aqui, antes de
 * chegar a tela.
 */

import { searchKey } from "@/lib/navigation";
import { cardSide, MAX_CARD_SIDE_CHARS, type StudyCardKind } from "@/lib/study-cards";

/** Minimo de palavras do texto para gerar cartoes (US-155). */
export const MIN_WORDS_FOR_STUDY_CARDS = 300;
/** Faixa de cartoes pedida ao modelo. */
export const MIN_GENERATED_CARDS = 5;
export const MAX_GENERATED_CARDS = 30;
/** Acima disso o texto vai em trechos distribuidos (`quizSample`). */
export const STUDY_CARDS_MAX_CHARS = 200_000;
/**
 * Trecho de origem curto demais casaria em qualquer lugar ("o texto"): abaixo
 * deste numero de palavras o cartao e descartado.
 */
export const MIN_PASSAGE_WORDS = 3;
/** Frentes ja salvas enviadas ao modelo para nao repetir cartoes. */
export const MAX_EXISTING_FRONTS = 80;

/** Tipo de cartao escolhido na geracao (US-157). */
export const STUDY_CARD_MODES = ["pergunta", "lacuna"] as const;
export type StudyCardMode = (typeof STUDY_CARD_MODES)[number];
export const STUDY_CARD_MODE_LABELS: Record<StudyCardMode, string> = {
  pergunta: "Pergunta e resposta",
  lacuna: "Lacuna",
};

export function asStudyCardMode(value: unknown): StudyCardMode {
  return value === "lacuna" ? "lacuna" : "pergunta";
}

/** Marca da lacuna na frente do cartao (US-157). */
export const CLOZE_GAP = "____";
const GAP_PATTERN = /_{3,}/g;

/** Tipos que a geracao produz. */
export type GeneratedKind = Extract<StudyCardKind, "conceito" | "ponto" | "lacuna">;
const GENERATED_KINDS: readonly GeneratedKind[] = ["conceito", "ponto", "lacuna"];

/** Cartao gerado, ainda nao salvo: a tela mostra para editar ou descartar. */
export interface StudyCardDraft {
  front: string;
  back: string;
  kind: GeneratedKind;
  /** Trecho de origem `[sourceStart, sourceEnd)`, em indices de palavra. */
  sourceStart: number;
  sourceEnd: number;
  /** O trecho como esta no texto, para a tela mostrar de onde o cartao saiu. */
  passage: string;
}

/* --- trecho de origem -------------------------------------------------------- */

/** Palavras do texto ja normalizadas, com o indice original de cada uma. */
export interface PassageIndex {
  words: string[];
  keys: string[];
  /** Indice, em `words`, de cada chave. */
  at: number[];
}

/**
 * Prepara a busca de trechos. Palavras so de pontuacao ("-", "**") nao contam,
 * dos dois lados, como na evidencia do questionario.
 */
export function passageIndex(words: string[]): PassageIndex {
  const keys: string[] = [];
  const at: number[] = [];
  words.forEach((word, index) => {
    const key = searchKey(word);
    if (key) {
      keys.push(key);
      at.push(index);
    }
  });
  return { words, keys, at };
}

/**
 * Onde o trecho aparece no texto, em indices de palavra `[start, end)`, ou
 * null. "Literalmente" quer dizer a mesma sequencia de palavras, inteira e
 * sem cortes; so caixa, acento e pontuacao nao contam (o modelo troca aspas e
 * apara virgulas). Nao aceita reticencias: um trecho com pedacos nao e o
 * texto. Com mais de uma ocorrencia vale a primeira, a mais cedo na leitura.
 */
export function locatePassage(index: PassageIndex, passage: string): { start: number; end: number } | null {
  if (/\.{3}|…/u.test(passage)) return null;
  const terms = passage.split(/\s+/).map(searchKey).filter(Boolean);
  if (terms.length < MIN_PASSAGE_WORDS) return null;
  const { keys, at } = index;
  for (let start = 0; start + terms.length <= keys.length; start += 1) {
    let match = true;
    for (let offset = 0; offset < terms.length; offset += 1) {
      if (keys[start + offset] !== terms[offset]) {
        match = false;
        break;
      }
    }
    if (match) return { start: at[start]!, end: at[start + terms.length - 1]! + 1 };
  }
  return null;
}

/* --- lacuna (US-157) --------------------------------------------------------- */

/**
 * Frase completa de um cartao de lacuna: a frente com exatamente uma lacuna,
 * preenchida pelo verso. Null quando nao ha lacuna, ha mais de uma ou o termo
 * esta vazio.
 */
export function clozeSentence(front: string, back: string): string | null {
  const gaps = front.match(GAP_PATTERN);
  const term = back.replace(/\s+/g, " ").trim();
  if (!gaps || gaps.length !== 1 || !term) return null;
  return front.replace(GAP_PATTERN, term);
}

/** Frente com a lacuna sempre no mesmo formato. */
export function normalizeGap(front: string): string {
  return front.replace(GAP_PATTERN, CLOZE_GAP);
}

/* --- resposta do modelo ------------------------------------------------------ */

/** Chave para comparar frentes: caixa, acento e pontuacao nao contam. */
export function frontKey(front: string): string {
  return front.split(/\s+/).map(searchKey).filter(Boolean).join(" ");
}

function asRecordList(raw: unknown): Record<string, unknown>[] {
  const list =
    raw && typeof raw === "object" && Array.isArray((raw as { cards?: unknown }).cards)
      ? ((raw as { cards: unknown[] }).cards as unknown[])
      : [];
  return list.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object");
}

/**
 * Cartoes validos da resposta do modelo.
 *
 * - pergunta e resposta: frente e verso validos (`cardSide`), tipo "conceito"
 *   ou "ponto" e trecho de origem encontrado no texto;
 * - lacuna: uma so lacuna na frente, e a frase com o termo no lugar aparece no
 *   texto; o trecho de origem e a propria frase.
 *
 * Frente repetida - na mesma resposta ou entre os cartoes ja salvos
 * (`existingFronts`) - fica de fora: gerar de novo nunca duplica cartao. No
 * maximo `MAX_GENERATED_CARDS`, na ordem do texto.
 */
export function cleanGeneratedCards(
  raw: unknown,
  index: PassageIndex,
  mode: StudyCardMode,
  existingFronts: string[] = []
): StudyCardDraft[] {
  const seen = new Set(existingFronts.map(frontKey).filter(Boolean));
  const cards: StudyCardDraft[] = [];
  for (const record of asRecordList(raw)) {
    const draft = mode === "lacuna" ? clozeDraft(record, index) : questionDraft(record, index);
    if (!draft) continue;
    const key = frontKey(draft.front);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    cards.push(draft);
  }
  return cards
    .sort((a, b) => a.sourceStart - b.sourceStart || a.sourceEnd - b.sourceEnd)
    .slice(0, MAX_GENERATED_CARDS);
}

function questionDraft(record: Record<string, unknown>, index: PassageIndex): StudyCardDraft | null {
  const front = cardSide(record.front);
  const back = cardSide(record.back);
  const kind = record.kind === "conceito" || record.kind === "ponto" ? record.kind : null;
  if (!front || !back || !kind || typeof record.passage !== "string") return null;
  const span = locatePassage(index, record.passage);
  if (!span) return null;
  return { front, back, kind, sourceStart: span.start, sourceEnd: span.end, passage: passageText(index, span) };
}

function clozeDraft(record: Record<string, unknown>, index: PassageIndex): StudyCardDraft | null {
  const rawFront = cardSide(record.front);
  const back = cardSide(record.back);
  if (!rawFront || !back) return null;
  const front = normalizeGap(rawFront);
  if (front.length > MAX_CARD_SIDE_CHARS) return null;
  const sentence = clozeSentence(front, back);
  if (!sentence) return null;
  const span = locatePassage(index, sentence);
  if (!span) return null;
  return {
    front,
    back,
    kind: "lacuna",
    sourceStart: span.start,
    sourceEnd: span.end,
    passage: passageText(index, span),
  };
}

function passageText(index: PassageIndex, span: { start: number; end: number }): string {
  return index.words.slice(span.start, span.end).join(" ");
}

/* --- salvar ------------------------------------------------------------------ */

export interface SavedDraft {
  front: string;
  back: string;
  kind: GeneratedKind;
  sourceStart: number;
  sourceEnd: number;
}

/**
 * Cartoes revisados que a tela manda salvar. Qualquer item invalido recusa o
 * lote (null) em vez de salvar um cartao pela metade; um lacuna editado
 * precisa continuar com uma lacuna.
 */
export function parseDraftEdits(raw: unknown, wordCount: number): SavedDraft[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_GENERATED_CARDS) return null;
  const cards: SavedDraft[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") return null;
    const record = item as Record<string, unknown>;
    const front = cardSide(record.front);
    const back = cardSide(record.back);
    const kind = GENERATED_KINDS.includes(record.kind as GeneratedKind) ? (record.kind as GeneratedKind) : null;
    const start = record.sourceStart;
    const end = record.sourceEnd;
    if (!front || !back || !kind) return null;
    if (!Number.isInteger(start) || !Number.isInteger(end)) return null;
    if ((start as number) < 0 || (end as number) <= (start as number) || (end as number) > wordCount) return null;
    if (kind === "lacuna" && !clozeSentence(front, back)) return null;
    cards.push({ front: kind === "lacuna" ? normalizeGap(front) : front, back, kind, sourceStart: start as number, sourceEnd: end as number });
  }
  return cards;
}

/* --- cartao a mao (US-159) --------------------------------------------------- */

export const CARD_EMPTY_MESSAGE = "Preencha a frente e o verso.";
export const CARD_TOO_LONG_MESSAGE = `Use até ${MAX_CARD_SIDE_CHARS} caracteres em cada lado.`;

/** Frente e verso validos, ou a mensagem que a tela mostra. */
export function manualCard(
  front: unknown,
  back: unknown
): { front: string; back: string } | { error: string } {
  const sides = [front, back].map((side) => (typeof side === "string" ? side.replace(/\s+/g, " ").trim() : ""));
  if (sides.some((side) => !side)) return { error: CARD_EMPTY_MESSAGE };
  if (sides.some((side) => side.length > MAX_CARD_SIDE_CHARS)) return { error: CARD_TOO_LONG_MESSAGE };
  return { front: sides[0]!, back: sides[1]! };
}

/* --- conhecimento previo (US-170) -------------------------------------------- */

/** Quantos o leitor ja sabia, em numero e porcentagem. */
export function pretestSummary(answers: ("sabia" | "nao_sabia")[]): {
  known: number;
  total: number;
  percent: number;
} {
  const total = answers.length;
  const known = answers.filter((answer) => answer === "sabia").length;
  return { known, total, percent: total === 0 ? 0 : Math.round((known / total) * 100) };
}

/* --- pedido ao modelo -------------------------------------------------------- */

/**
 * Pedido de cartoes: titulo, texto (ou trechos), tipo e as frentes ja
 * salvas, para o modelo trazer cartoes novos em vez de repetir.
 */
export function studyCardsPrompt({
  title,
  text,
  sampled,
  mode,
  existingFronts,
  languageNote = "",
}: {
  title: string;
  text: string;
  sampled: number;
  mode: StudyCardMode;
  existingFronts: string[];
  languageNote?: string;
}): string {
  const sampleNote =
    sampled > 0
      ? `\n\nO texto é longo: seguem ${sampled} trechos, na ordem, distribuídos do começo ao fim. Distribua os cartões pelo texto inteiro.`
      : "";
  const fronts = existingFronts.slice(0, MAX_EXISTING_FRONTS);
  const existingNote =
    fronts.length > 0
      ? `\n\nO leitor já tem estes cartões; não repita nenhum deles nem pergunte a mesma coisa com outras palavras:\n${fronts.map((front) => `- ${front}`).join("\n")}`
      : "";
  const task =
    mode === "lacuna"
      ? `Escreva de ${MIN_GENERATED_CARDS} a ${MAX_GENERATED_CARDS} cartões de lacuna: a frente é uma frase copiada do texto, sem nenhuma alteração, com um único termo-chave trocado por ${CLOZE_GAP}; o verso é exatamente o termo escondido.`
      : `Escreva de ${MIN_GENERATED_CARDS} a ${MAX_GENERATED_CARDS} cartões de pergunta e resposta com os conceitos e os pontos principais do texto. Para cada um, copie do texto, sem alterar nenhuma palavra, o trecho de origem (uma frase ou parte dela).`;
  return `Título: ${title}${sampleNote}\n\nTexto:\n${text}${existingNote}\n\n${task}${languageNote}`;
}
