/**
 * Perguntar ao texto (US-128) e guardar a resposta como nota (US-129).
 * Funcoes puras, com teste, compartilhadas entre servidor e cliente.
 *
 * O documento enviado termina na posicao de leitura: quem esta na palavra N
 * manda as palavras ate N, inclusive, e nenhuma depois. A regra vale na
 * montagem (`askExcerpt`), nao no pedido ao modelo.
 */

import { excerptOf, wordAtChar, type Excerpt } from "@/lib/ai-text";
import { MAX_NOTE_CHARS, type Span } from "@/lib/highlights";
import type { Paragraph } from "@/lib/reading";

export const MAX_QUESTION_CHARS = 500;
/**
 * Perguntas por sessao da folha. As respostas ficam guardadas (US-147), mas o
 * limite conta so o que foi perguntado desde que a folha abriu.
 */
export const MAX_QUESTIONS = 10;

export const NO_ANSWER = "O trecho lido até aqui não responde a isso.";
export const RECENT_ONLY = "Considerando só o trecho mais recente.";
export const ASK_FAILURE = "Não consegui responder agora.";

/** Pergunta normalizada, ou null quando vazia ou longa demais. */
export function normalizeQuestion(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (trimmed.length === 0 || trimmed.length > MAX_QUESTION_CHARS) return null;
  return trimmed;
}

/** Trecho lido ate a palavra `position`, inclusive. */
export function askExcerpt(paragraphs: Paragraph[], position: number, maxChars?: number): Excerpt {
  const last = paragraphs[paragraphs.length - 1];
  const total = last ? last.start + last.words.length : 0;
  const to = Math.max(0, Math.min(total, Math.trunc(position) + 1));
  return excerptOf(paragraphs, 0, to, maxChars);
}

export interface Turn {
  question: string;
  answer: string;
}

/** Historico vindo do cliente, sem nada que nao seja pergunta e resposta. */
export function normalizeHistory(value: unknown): Turn[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return null;
  const turns: Turn[] = [];
  for (const item of value) {
    const question = normalizeQuestion((item as Turn | null)?.question);
    const answer = (item as Turn | null)?.answer;
    if (!question || typeof answer !== "string" || answer.trim().length === 0) return null;
    turns.push({ question, answer: answer.trim().slice(0, 8_000) });
  }
  return turns;
}

type DocumentBlock = {
  type: "document";
  source: { type: "text"; media_type: "text/plain"; data: string };
  title: string;
  citations: { enabled: true };
  cache_control: { type: "ephemeral" };
};

type TextBlock = { type: "text"; text: string };

export type AskMessage =
  | { role: "user"; content: (DocumentBlock | TextBlock)[] | string }
  | { role: "assistant"; content: string };

/**
 * Mensagens do pedido. O documento vai sempre igual na primeira mensagem,
 * com `cache_control`: as perguntas seguintes da conversa leem o texto do
 * cache em vez de paga-lo de novo.
 */
export function askMessages(
  excerpt: Pick<Excerpt, "text">,
  title: string,
  history: Turn[],
  question: string
): AskMessage[] {
  const turns = [...history, { question, answer: "" }];
  const messages: AskMessage[] = [];
  turns.forEach((turn, index) => {
    if (index === 0) {
      messages.push({
        role: "user",
        content: [
          {
            type: "document",
            source: { type: "text", media_type: "text/plain", data: excerpt.text },
            title,
            citations: { enabled: true },
            cache_control: { type: "ephemeral" },
          },
          { type: "text", text: turn.question },
        ],
      });
    } else {
      messages.push({ role: "user", content: turn.question });
    }
    if (index < turns.length - 1) messages.push({ role: "assistant", content: turn.answer });
  });
  return messages;
}

/** Trecho citado na resposta, ja no indice de palavras do texto inteiro. */
export interface AnswerCitation extends Span {
  quote: string;
}

export interface Answer {
  text: string;
  citations: AnswerCitation[];
}

/** O que a rota le da resposta: blocos de texto com citacoes de caractere. */
interface ResponseBlock {
  type: string;
  text?: string;
  citations?:
    | { type: string; cited_text?: string; start_char_index?: number; end_char_index?: number }[]
    | null;
}

/**
 * Le a resposta e converte cada citacao em intervalo de palavras.
 *
 * Sem citacao valida, a resposta vira a frase fixa de "nao responde": uma
 * resposta sem trecho que a sustente seria opiniao do modelo, nao do texto.
 */
export function readAnswer(
  blocks: ResponseBlock[],
  excerpt: Pick<Excerpt, "offsets" | "startWord" | "endWord" | "text">
): Answer {
  let text = "";
  const citations: AnswerCitation[] = [];
  const seen = new Set<string>();

  for (const block of blocks) {
    if (block.type !== "text" || typeof block.text !== "string") continue;
    text += block.text;
    for (const citation of block.citations ?? []) {
      if (citation.type !== "char_location") continue;
      const from = Number(citation.start_char_index);
      const to = Number(citation.end_char_index);
      if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) continue;
      if (from < 0 || from >= excerpt.text.length) continue;
      const start = wordAtChar(excerpt, from);
      const end = Math.min(excerpt.endWord, wordAtChar(excerpt, Math.max(from, to - 1)) + 1);
      if (end <= start) continue;
      const key = `${start}-${end}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const quote = (citation.cited_text ?? excerpt.text.slice(from, to)).replace(/\s+/g, " ").trim();
      citations.push({ start, end, quote });
    }
  }

  const answer = text.replace(/[ \t]+\n/g, "\n").trim();
  if (citations.length === 0 || answer.length === 0) return { text: NO_ANSWER, citations: [] };
  return { text: answer, citations };
}

/* --- guardar como nota (US-129) ------------------------------------------ */

/**
 * Nota resultante: a resposta depois da nota existente, separada por uma
 * linha em branco. Passou do teto, corta no limite e termina em reticencias.
 */
export function appendNote(existing: string | null | undefined, answer: string): string {
  const parts = [existing?.trim(), answer.trim()].filter((part): part is string => Boolean(part));
  const note = parts.join("\n\n");
  if (note.length <= MAX_NOTE_CHARS) return note;
  return `${note.slice(0, MAX_NOTE_CHARS - 1).trimEnd()}…`;
}

/**
 * Destaque que ja cobre o trecho citado. Usa a mesma regra da fusao de
 * destaques (encostar conta): criar um novo ali fundiria os dois e a nota
 * guardada sobrescreveria a antiga.
 */
export function noteTarget<T extends Span & { id: string }>(marks: T[], span: Span): T | null {
  const touching = marks
    .filter((mark) => mark.start <= span.end && mark.end >= span.start)
    .sort((a, b) => a.start - b.start);
  return touching[0] ?? null;
}

/* --- conversa guardada (US-147) ------------------------------------------ */

/** Perguntas guardadas por texto; a mais antiga sai quando passa disso. */
export const MAX_STORED_TURNS = 50;

export const TEXT_CHANGED = "O texto mudou desde esta resposta.";

/** Pergunta guardada, como a folha recebe. */
export interface StoredTurn {
  id: string;
  question: string;
  answer: Answer;
  /** Palavra onde a leitura estava quando a pergunta foi feita. */
  position: number;
  /** O conteudo do texto mudou desde a resposta. */
  stale: boolean;
  createdAt: string;
}

/**
 * Ids que passam do teto, do mais antigo ao mais novo. Recebe as perguntas
 * em qualquer ordem; ficam as `cap` mais recentes.
 */
export function turnsToDrop<T extends { id: string; createdAt: Date | string }>(
  turns: T[],
  cap: number = MAX_STORED_TURNS
): string[] {
  const time = (turn: T) => new Date(turn.createdAt).getTime();
  const ordered = [...turns].sort((a, b) => time(b) - time(a));
  return ordered
    .slice(Math.max(0, cap))
    .reverse()
    .map((turn) => turn.id);
}

/** Resposta lida do banco, ou null quando o formato nao confere. */
export function parseStoredAnswer(raw: unknown): Answer | null {
  if (!raw || typeof raw !== "object") return null;
  const source = raw as { text?: unknown; citations?: unknown };
  if (typeof source.text !== "string" || !Array.isArray(source.citations)) return null;
  const citations: AnswerCitation[] = [];
  for (const item of source.citations) {
    const citation = item as Partial<AnswerCitation> | null;
    if (
      !citation ||
      !Number.isInteger(citation.start) ||
      !Number.isInteger(citation.end) ||
      typeof citation.quote !== "string"
    ) {
      continue;
    }
    citations.push({ start: citation.start!, end: citation.end!, quote: citation.quote });
  }
  return { text: source.text, citations };
}

/** Numero da palavra como o leitor mostra: a contagem comeca em 1. */
export function wordNumber(position: number): string {
  return (Math.max(0, Math.trunc(position)) + 1).toLocaleString("pt-BR");
}

export function answeredUntil(position: number): string {
  return `Respondida até a palavra ${wordNumber(position)}`;
}

/* --- perguntas sugeridas (US-148) ---------------------------------------- */

/** Palavras lidas para haver sugestoes. */
export const SUGGESTION_MIN_WORDS = 300;
/** Faixa de posicao que compartilha as mesmas sugestoes. */
export const SUGGESTION_BUCKET = 1_000;
export const MAX_SUGGESTIONS = 3;
export const MAX_SUGGESTION_WORDS = 15;

/**
 * Ate onde vai o trecho das sugestoes para quem esta na palavra `position`,
 * ou null quando leu pouco. O corte e o comeco da faixa de 1.000 palavras (no
 * minimo as 300 primeiras), entao todos na mesma faixa recebem as mesmas
 * sugestoes, e nenhuma delas usa palavra depois da posicao de quem le.
 */
export function suggestionCut(position: number): number | null {
  if (!Number.isFinite(position)) return null;
  const read = Math.trunc(position) + 1;
  if (read < SUGGESTION_MIN_WORDS) return null;
  return Math.max(SUGGESTION_MIN_WORDS, Math.floor(read / SUGGESTION_BUCKET) * SUGGESTION_BUCKET);
}

/**
 * Chave das sugestoes em cache: texto, impressao do conteudo e corte. O
 * conteudo mudado nao encontra as antigas.
 */
export function suggestionsKey(textId: string, fingerprint: string, cut: number): string {
  return `${textId}:${fingerprint}:${cut}`;
}

/** Ate tres perguntas validas, sem repeticao e com no maximo 15 palavras. */
export function parseSuggestions(raw: unknown): string[] {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as { questions?: unknown }).questions)
      ? (raw as { questions: unknown[] }).questions
      : [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of list) {
    const question = normalizeQuestion(item);
    if (!question) continue;
    if (question.split(" ").length > MAX_SUGGESTION_WORDS) continue;
    const key = question.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(question);
    if (result.length === MAX_SUGGESTIONS) break;
  }
  return result;
}
