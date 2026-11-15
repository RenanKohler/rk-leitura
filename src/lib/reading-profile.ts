/**
 * Perfil de leitura do mes (US-234). Funcoes puras, com teste.
 *
 * Uma vez por mes, a partir dos dados do proprio leitor, o modelo diz em
 * linguagem simples que tipo de trecho trava a leitura e o que treinar. Aqui
 * fica tudo o que nao depende de banco nem de rede: o periodo analisado, os
 * agregados, os exemplos levados ao pedido, o que falta para gerar e a
 * validacao da resposta.
 *
 * Periodo: o mes anterior completo, no fuso do leitor. Se ele tiver menos de
 * `MIN_SESSIONS` sessoes (primeiro mes de uso, ferias), valem os ultimos 30
 * dias ate hoje. A chave do resultado guardado e sempre o mes anterior
 * ("AAAA-MM"), entao o perfil gerado vale ate a virada do mes e o seguinte so
 * sai no mes que vem, qualquer que tenha sido a janela usada.
 *
 * O que o banco guarda e o que nao guarda: o questionario de compreensao e o
 * recordar gravam so a nota de cada rodada, nao qual pergunta foi errada.
 * Por isso o pedido leva as notas e, dos questionarios com nota baixa, os
 * enunciados como amostra, avisando ao modelo que nao se sabe quais foram
 * errados. O exemplo de cada padrao e escolhido pelo modelo por referencia
 * (E1, F2...) e o texto mostrado e o nosso: o exemplo e sempre real.
 */

/** Minimo de sessoes no periodo para o perfil dizer algo. */
export const MIN_SESSIONS = 3;
/** Janela alternativa quando o mes anterior tem pouco dado. */
export const FALLBACK_DAYS = 30;
/** Teto de exemplos no pedido. */
export const MAX_EXAMPLES = 15;
/** Palavras de cada lado da palavra em que o leitor freou. */
export const BRAKE_RADIUS = 8;
/** Freios a menos disso um do outro, no mesmo texto, sao o mesmo trecho. */
export const BRAKE_MERGE_WORDS = 12;
/** Frase com mais palavras que isso conta como longa. */
export const LONG_SENTENCE_WORDS = 30;
/** Nota abaixo da qual o questionario entra como amostra. */
export const LOW_QUIZ_PERCENT = 70;
/** Padroes na resposta. */
export const MIN_PATTERNS = 2;
export const MAX_PATTERNS = 4;
/** Tetos dos textos de cada padrao. */
export const MAX_TITLE_WORDS = 16;
export const MAX_DETAIL_WORDS = 45;
export const MAX_SUGGESTION_WORDS = 35;
/** Tamanho de cada exemplo no pedido. */
export const MAX_EXAMPLE_CHARS = 220;

/** Quantos exemplos de cada tipo entram antes de sobrar vaga para os outros. */
const EXAMPLE_SHARE: Record<ExampleKind, number> = {
  freio: 6,
  cartao: 3,
  palavra: 4,
  pergunta: 2,
};

/* --- periodo ---------------------------------------------------------------- */

export type ProfileBasis = "mes" | "30dias";

export interface ProfileWindow {
  /** Mes analisado, chave do resultado guardado. */
  month: string;
  /** Primeiro dia incluido (AAAA-MM-DD), no fuso do leitor. */
  from: string;
  /** Primeiro dia fora da janela (exclusivo). */
  to: string;
  basis: ProfileBasis;
}

function shiftDay(day: string, days: number): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Mes anterior ao de `today` (AAAA-MM-DD), como "AAAA-MM". */
export function previousMonth(today: string): string {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const prevYear = month === 1 ? year - 1 : year;
  const prevMonth = month === 1 ? 12 : month - 1;
  return `${prevYear}-${String(prevMonth).padStart(2, "0")}`;
}

/** Primeiro dia do mes e primeiro dia do mes seguinte. */
export function monthBounds(month: string): { from: string; to: string } {
  const year = Number(month.slice(0, 4));
  const index = Number(month.slice(5, 7));
  const nextYear = index === 12 ? year + 1 : year;
  const next = index === 12 ? 1 : index + 1;
  return { from: `${month}-01`, to: `${nextYear}-${String(next).padStart(2, "0")}-01` };
}

/** Janela do perfil: o mes anterior, ou os ultimos 30 dias se ele tiver pouco dado. */
export function chooseWindow(today: string, sessionsInMonth: number): ProfileWindow {
  const month = previousMonth(today);
  if (sessionsInMonth >= MIN_SESSIONS) return { month, ...monthBounds(month), basis: "mes" };
  return {
    month,
    from: shiftDay(today, -(FALLBACK_DAYS - 1)),
    to: shiftDay(today, 1),
    basis: "30dias",
  };
}

const MONTHS = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

/** "outubro de 2026". */
export function monthLabel(month: string): string {
  const index = Number(month.slice(5, 7)) - 1;
  return `${MONTHS[index] ?? month} de ${month.slice(0, 4)}`;
}

/** Como a tela descreve o periodo analisado. */
export function windowLabel(window: ProfileWindow): string {
  return window.basis === "mes"
    ? `Leituras de ${monthLabel(window.month)}`
    : `Leituras dos últimos ${FALLBACK_DAYS} dias`;
}

/* --- dados de entrada -------------------------------------------------------- */

export interface ProfileSession {
  textId: string;
  wpm: number;
  wordsRead: number;
  durationMs: number;
  mode: string;
  comprehension: number | null;
  brakes: number[] | null;
  createdAt: Date;
}

export interface ProfileReview {
  /** "palavra", "destaque" ou "cartao". */
  kind: string;
  grade: string;
  /** Palavra ou frente do cartao, quando a linha ainda existe. */
  label: string | null;
}

export interface ProfileQuiz {
  title: string;
  score: number;
  prompts: string[];
}

export interface ProfileInput {
  sessions: ProfileSession[];
  /** Primeira sessao concluida de cada texto lido, em qualquer data. */
  firstCompleted: Record<string, Date>;
  /** Palavras dos textos com freio, para recortar o trecho em volta. */
  texts: Record<string, { title: string; words: string[] }>;
  /** Notas do recordar no periodo (rodadas dispensadas ficam de fora). */
  recalls: number[];
  savedWords: { word: string; context: string | null }[];
  reviews: ProfileReview[];
  /** Questionarios do periodo com nota baixa, com os enunciados. */
  lowQuizzes: ProfileQuiz[];
}

/* --- agregados --------------------------------------------------------------- */

export type ExampleKind = "freio" | "cartao" | "palavra" | "pergunta";

export interface ProfileExample {
  /** "E1", "E2"... */
  id: string;
  kind: ExampleKind;
  text: string;
  /** Titulo do texto de origem, quando ha. */
  source: string | null;
}

export interface ProfileFact {
  /** "F1", "F2"... */
  id: string;
  text: string;
}

interface ReviewCount {
  total: number;
  wrong: number;
}

export interface ProfileSummary {
  sessions: number;
  words: number;
  minutes: number;
  /** Ppm medio ponderado pelas palavras. */
  wpm: number;
  byMode: { mode: string; wpm: number; sessions: number }[];
  comprehension: {
    measured: number;
    average: number | null;
    /** Media nas sessoes acima e abaixo da mediana de ppm (com 4 ou mais medidas). */
    faster: { wpm: number; average: number } | null;
    slower: { wpm: number; average: number } | null;
  };
  recall: { answered: number; average: number | null };
  brakes: {
    total: number;
    /** Freios por mil palavras, nas sessoes que mediram. */
    perThousand: number | null;
    /** Porcentagem dos freios dentro de frases longas, quando ha trecho. */
    inLongSentences: number | null;
  };
  savedWords: number;
  reviews: Record<"palavra" | "cartao" | "destaque", ReviewCount>;
  rereads: number;
  examples: ProfileExample[];
  facts: ProfileFact[];
}

function weightedWpm(rows: ProfileSession[]): number {
  const words = rows.reduce((sum, row) => sum + row.wordsRead, 0);
  if (words <= 0) return 0;
  return Math.round(rows.reduce((sum, row) => sum + row.wpm * row.wordsRead, 0) / words);
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function clip(value: string, max: number = MAX_EXAMPLE_CHARS): string {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max).trimEnd()}...` : clean;
}

const SENTENCE_END = /[.!?…]["'”»)]*$/;

/** Palavras da frase que contem `index`: vai ate o ponto final de cada lado. */
export function sentenceLengthAt(words: string[], index: number): number {
  if (index < 0 || index >= words.length) return 0;
  let start = index;
  while (start > 0 && !SENTENCE_END.test(words[start - 1] ?? "")) start -= 1;
  let end = index;
  while (end < words.length - 1 && !SENTENCE_END.test(words[end] ?? "")) end += 1;
  return end - start + 1;
}

/** Trecho em volta da palavra em que o leitor freou, com ela entre colchetes. */
export function brakeExcerpt(words: string[], index: number, radius: number = BRAKE_RADIUS): string {
  if (index < 0 || index >= words.length) return "";
  const before = words.slice(Math.max(0, index - radius), index);
  const after = words.slice(index + 1, index + 1 + radius);
  const head = index - radius > 0 ? "... " : "";
  const tail = index + 1 + radius < words.length ? " ..." : "";
  return `${head}${[...before, `[${words[index]}]`, ...after].join(" ")}${tail}`;
}

/**
 * Freios agrupados por trecho: varios toques seguidos no mesmo lugar sao um
 * freio so para o exemplo. Devolve uma posicao por trecho, a primeira.
 */
export function mergeBrakes(positions: number[], gap: number = BRAKE_MERGE_WORDS): number[] {
  const sorted = [...new Set(positions)].sort((a, b) => a - b);
  const merged: number[] = [];
  for (const position of sorted) {
    const last = merged.at(-1);
    if (last === undefined || position - last > gap) merged.push(position);
  }
  return merged;
}

/** Releitura: sessao num texto ja concluido antes dela. */
export function isReread(session: ProfileSession, firstCompleted: Record<string, Date>): boolean {
  const first = firstCompleted[session.textId];
  return first !== undefined && session.createdAt.getTime() > first.getTime();
}

/**
 * Compreensao nas sessoes mais rapidas e mais lentas, separadas pela mediana
 * do ppm. Com menos de 4 medidas a divisao nao diz nada.
 */
export function comprehensionBySpeed(
  rows: { wpm: number; comprehension: number }[]
): { faster: { wpm: number; average: number }; slower: { wpm: number; average: number } } | null {
  if (rows.length < 4) return null;
  const sorted = [...rows].sort((a, b) => a.wpm - b.wpm);
  const half = Math.floor(sorted.length / 2);
  const slow = sorted.slice(0, half);
  const fast = sorted.slice(sorted.length - half);
  const summary = (group: typeof rows) => ({
    wpm: mean(group.map((row) => row.wpm)) ?? 0,
    average: mean(group.map((row) => row.comprehension)) ?? 0,
  });
  return { faster: summary(fast), slower: summary(slow) };
}

interface Candidate {
  kind: ExampleKind;
  text: string;
  source: string | null;
}

/**
 * Escolhe ate `MAX_EXAMPLES` exemplos: cada tipo tem uma cota, e a vaga que
 * um tipo nao usa passa aos outros, na ordem freio, cartao, palavra, pergunta.
 */
export function pickExamples(candidates: Candidate[], max: number = MAX_EXAMPLES): ProfileExample[] {
  const kinds: ExampleKind[] = ["freio", "cartao", "palavra", "pergunta"];
  const queues = new Map(kinds.map((kind) => [kind, candidates.filter((item) => item.kind === kind)]));
  const chosen: Candidate[] = [];
  for (const kind of kinds) {
    chosen.push(...(queues.get(kind) ?? []).splice(0, EXAMPLE_SHARE[kind]));
  }
  for (const kind of kinds) {
    const queue = queues.get(kind) ?? [];
    while (chosen.length < max && queue.length > 0) chosen.push(queue.shift() as Candidate);
  }
  return chosen.slice(0, max).map((item, index) => ({ id: `E${index + 1}`, ...item }));
}

const MODE_NAMES: Record<string, string> = {
  runner: "guiada",
  narracao: "narração",
  pagina: "página",
};

/** Agregados do periodo, com os exemplos e os fatos numerados para o pedido. */
export function summarizeProfile(input: ProfileInput): ProfileSummary {
  const sessions = input.sessions;
  const words = sessions.reduce((sum, row) => sum + row.wordsRead, 0);
  const minutes = Math.round(sessions.reduce((sum, row) => sum + row.durationMs, 0) / 60_000);

  const modes = [...new Set(sessions.map((row) => row.mode))].sort();
  const byMode = modes.map((mode) => {
    const rows = sessions.filter((row) => row.mode === mode);
    return { mode, wpm: weightedWpm(rows), sessions: rows.length };
  });

  const measured = sessions.flatMap((row) =>
    row.comprehension === null ? [] : [{ wpm: row.wpm, comprehension: row.comprehension }]
  );
  const split = comprehensionBySpeed(measured);

  // Freios: so as sessoes que mediram entram na taxa; os trechos saem dos
  // textos carregados.
  const metered = sessions.filter((row) => row.brakes !== null);
  const totalBrakes = metered.reduce((sum, row) => sum + (row.brakes?.length ?? 0), 0);
  const meteredWords = metered.reduce((sum, row) => sum + row.wordsRead, 0);
  const brakeCandidates: Candidate[] = [];
  let located = 0;
  let inLong = 0;
  const byText = new Map<string, number[]>();
  for (const row of metered) {
    byText.set(row.textId, [...(byText.get(row.textId) ?? []), ...(row.brakes ?? [])]);
  }
  for (const [textId, positions] of byText) {
    const text = input.texts[textId];
    if (!text) continue;
    for (const position of mergeBrakes(positions)) {
      const excerpt = brakeExcerpt(text.words, position);
      if (!excerpt) continue;
      located += 1;
      const long = sentenceLengthAt(text.words, position) > LONG_SENTENCE_WORDS;
      if (long) inLong += 1;
      brakeCandidates.push({ kind: "freio", text: clip(excerpt), source: text.title });
    }
  }

  const reviews: ProfileSummary["reviews"] = {
    palavra: { total: 0, wrong: 0 },
    cartao: { total: 0, wrong: 0 },
    destaque: { total: 0, wrong: 0 },
  };
  const wrongCards: Candidate[] = [];
  const wrongWords = new Set<string>();
  for (const review of input.reviews) {
    const count = reviews[review.kind as keyof typeof reviews];
    if (!count) continue;
    count.total += 1;
    if (review.grade !== "errei") continue;
    count.wrong += 1;
    if (review.kind === "cartao" && review.label) {
      wrongCards.push({ kind: "cartao", text: clip(`Cartão errado: ${review.label}`), source: null });
    }
    if (review.kind === "palavra" && review.label) wrongWords.add(review.label);
  }

  // Palavras: as erradas na revisao primeiro, depois as consultadas, com a frase.
  const wordCandidates: Candidate[] = [];
  const seen = new Set<string>();
  const ordered = [
    ...input.savedWords.filter((item) => wrongWords.has(item.word)),
    ...input.savedWords.filter((item) => !wrongWords.has(item.word)),
  ];
  for (const item of ordered) {
    const key = item.word.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const prefix = wrongWords.has(item.word) ? "Palavra consultada e errada na revisão" : "Palavra consultada";
    wordCandidates.push({
      kind: "palavra",
      text: clip(item.context ? `${prefix}: "${item.word}" em "${item.context}"` : `${prefix}: "${item.word}"`),
      source: null,
    });
  }

  const questionCandidates: Candidate[] = [...input.lowQuizzes]
    .sort((a, b) => a.score - b.score)
    .flatMap((quiz) =>
      quiz.prompts.map((prompt) => ({
        kind: "pergunta" as const,
        text: clip(`Pergunta de um questionário com ${quiz.score}% de acertos: ${prompt}`),
        source: quiz.title,
      }))
    );

  const examples = pickExamples([...brakeCandidates, ...wrongCards, ...wordCandidates, ...questionCandidates]);

  const summary: Omit<ProfileSummary, "facts"> = {
    sessions: sessions.length,
    words,
    minutes,
    wpm: weightedWpm(sessions),
    byMode,
    comprehension: {
      measured: measured.length,
      average: mean(measured.map((row) => row.comprehension)),
      faster: split?.faster ?? null,
      slower: split?.slower ?? null,
    },
    recall: { answered: input.recalls.length, average: mean(input.recalls) },
    brakes: {
      total: totalBrakes,
      perThousand: meteredWords > 0 ? Math.round((totalBrakes / meteredWords) * 10_000) / 10 : null,
      inLongSentences: located > 0 ? Math.round((inLong / located) * 100) : null,
    },
    savedWords: input.savedWords.length,
    reviews,
    rereads: sessions.filter((row) => isReread(row, input.firstCompleted)).length,
    examples,
  };
  return { ...summary, facts: profileFacts(summary) };
}

/** Fatos numericos em frases curtas, numerados para o modelo citar. */
export function profileFacts(summary: Omit<ProfileSummary, "facts">): ProfileFact[] {
  const lines: string[] = [];
  lines.push(
    `${summary.sessions} sessões, ${summary.words} palavras em ${summary.minutes} min, média de ${summary.wpm} ppm.`
  );
  for (const mode of summary.byMode) {
    lines.push(`Modo ${MODE_NAMES[mode.mode] ?? mode.mode}: ${mode.sessions} sessões a ${mode.wpm} ppm.`);
  }
  const { comprehension, recall, brakes, reviews } = summary;
  if (comprehension.average !== null) {
    lines.push(`Compreensão média de ${comprehension.average}% em ${comprehension.measured} questionários.`);
  }
  if (comprehension.faster && comprehension.slower) {
    lines.push(
      `Compreensão de ${comprehension.faster.average}% nas sessões mais rápidas (~${comprehension.faster.wpm} ppm) e de ${comprehension.slower.average}% nas mais lentas (~${comprehension.slower.wpm} ppm).`
    );
  }
  if (recall.average !== null) {
    lines.push(`Recordar (7 e 30 dias depois): média de ${recall.average}% em ${recall.answered} rodadas.`);
  }
  if (brakes.perThousand !== null) {
    lines.push(`${brakes.total} freios no leitor guiado, ${brakes.perThousand} por mil palavras.`);
  }
  if (brakes.inLongSentences !== null) {
    lines.push(
      `${brakes.inLongSentences}% dos trechos com freio estão em frases de mais de ${LONG_SENTENCE_WORDS} palavras.`
    );
  }
  if (summary.savedWords > 0) lines.push(`${summary.savedWords} palavras consultadas no dicionário.`);
  if (reviews.palavra.total > 0) {
    lines.push(`Revisão de palavras: ${reviews.palavra.wrong} erros em ${reviews.palavra.total} respostas.`);
  }
  if (reviews.cartao.total > 0) {
    lines.push(`Cartões de estudo: ${reviews.cartao.wrong} erros em ${reviews.cartao.total} respostas.`);
  }
  if (reviews.destaque.total > 0) {
    lines.push(`Revisão de destaques: ${reviews.destaque.wrong} erros em ${reviews.destaque.total} respostas.`);
  }
  if (summary.rereads > 0) lines.push(`${summary.rereads} sessões foram releituras de textos já concluídos.`);
  return lines.map((text, index) => ({ id: `F${index + 1}`, text }));
}

/* --- o que falta ------------------------------------------------------------- */

/**
 * O que falta para o perfil: sem isso o modelo nao e chamado. Lista vazia
 * quer dizer que da para gerar.
 */
export function missingData(summary: Pick<ProfileSummary, "sessions" | "comprehension" | "recall">): string[] {
  const missing: string[] = [];
  if (summary.sessions < MIN_SESSIONS) {
    const left = MIN_SESSIONS - summary.sessions;
    missing.push(
      `${left === 1 ? "Falta 1 sessão" : `Faltam ${left} sessões`} de leitura no período (mínimo de ${MIN_SESSIONS}).`
    );
  }
  if (summary.comprehension.measured === 0 && summary.recall.answered === 0) {
    missing.push("Responda pelo menos um questionário de compreensão ao fim de uma leitura.");
  }
  return missing;
}

/* --- pedido ------------------------------------------------------------------ */

/** Mensagem do pedido: fatos e exemplos numerados, nada alem disso. */
export function profilePrompt(summary: ProfileSummary, window: ProfileWindow): string {
  const lines = [`<periodo>${windowLabel(window)}</periodo>`, "<fatos>"];
  for (const fact of summary.facts) lines.push(`${fact.id}: ${fact.text}`);
  lines.push("</fatos>", "<exemplos>");
  if (summary.examples.length === 0) lines.push("(nenhum)");
  for (const example of summary.examples) {
    const source = example.source ? ` (de "${example.source.replace(/"/g, "'")}")` : "";
    lines.push(`${example.id} [${example.kind}]${source}: ${example.text}`);
  }
  lines.push("</exemplos>");
  return lines.join("\n");
}

/* --- resposta ---------------------------------------------------------------- */

export const PROFILE_ACTIONS = ["treino", "velocidade", "palavras", "revisao", "nenhuma"] as const;
export type ProfileAction = (typeof PROFILE_ACTIONS)[number];

/** Onde cada sugestao leva no app. */
export const ACTION_LINKS: Record<Exclude<ProfileAction, "nenhuma">, { href: string; label: string }> = {
  treino: { href: "/treino", label: "Abrir o treino" },
  velocidade: { href: "/ajustes#leitura", label: "Ajustar a velocidade" },
  palavras: { href: "/palavras/revisar", label: "Revisar palavras" },
  revisao: { href: "/revisar", label: "Abrir a revisão" },
};

export interface ProfilePattern {
  title: string;
  detail: string;
  /** Exemplo real, tirado dos dados: o texto e o nosso, nao o do modelo. */
  example: { text: string; source: string | null };
  suggestion: string;
  action: ProfileAction;
}

/** O que fica guardado em ai_results (kind "perfil", chave = mes). */
export interface StoredProfile {
  month: string;
  basis: ProfileBasis;
  from: string;
  to: string;
  /** "12 sessões, 3 questionários" para a tela dizer de onde veio. */
  base: string;
  patterns: ProfilePattern[];
  generatedAt: string;
}

function clampWords(raw: unknown, max: number): string {
  if (typeof raw !== "string") return "";
  const words = raw.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (words.length <= max) return words.join(" ");
  return `${words.slice(0, max).join(" ").replace(/[.,;:!?…]+$/, "")}…`;
}

/** Resolve a referencia (E3, F1) para o exemplo real; null quando nao existe. */
export function resolveExample(
  ref: unknown,
  summary: Pick<ProfileSummary, "examples" | "facts">
): { text: string; source: string | null } | null {
  if (typeof ref !== "string") return null;
  const id = ref.trim().toUpperCase();
  const example = summary.examples.find((item) => item.id === id);
  if (example) return { text: example.text, source: example.source };
  const fact = summary.facts.find((item) => item.id === id);
  return fact ? { text: fact.text, source: null } : null;
}

/**
 * Valida a resposta do modelo: padrao sem titulo, sem sugestao ou com
 * exemplo que nao existe nos dados sai. Devolve null quando nao sobra nenhum.
 */
export function clampProfile(
  raw: unknown,
  summary: Pick<ProfileSummary, "examples" | "facts">
): ProfilePattern[] | null {
  const list = (raw as { patterns?: unknown } | null)?.patterns;
  if (!Array.isArray(list)) return null;
  const patterns: ProfilePattern[] = [];
  for (const item of list) {
    if (patterns.length >= MAX_PATTERNS) break;
    const entry = (item ?? {}) as Record<string, unknown>;
    const title = clampWords(entry.title, MAX_TITLE_WORDS);
    const suggestion = clampWords(entry.suggestion, MAX_SUGGESTION_WORDS);
    const example = resolveExample(entry.example, summary);
    if (!title || !suggestion || !example) continue;
    const action = PROFILE_ACTIONS.includes(entry.action as ProfileAction)
      ? (entry.action as ProfileAction)
      : "nenhuma";
    patterns.push({ title, detail: clampWords(entry.detail, MAX_DETAIL_WORDS), example, suggestion, action });
  }
  return patterns.length > 0 ? patterns : null;
}

/** Linha "de onde veio" mostrada com o perfil. */
export function profileBase(summary: Pick<ProfileSummary, "sessions" | "comprehension" | "recall">): string {
  const quizzes = summary.comprehension.measured + summary.recall.answered;
  return `${summary.sessions} ${summary.sessions === 1 ? "sessão" : "sessões"}, ${quizzes} ${quizzes === 1 ? "questionário" : "questionários"}`;
}
