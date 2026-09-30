/**
 * Modo de leitura de uma sessao e a sugestao de desacelerar (PROD-10).
 *
 * Funcoes puras: a rota de sessoes valida com elas, e a sugestao e calculada
 * sobre linhas ja lidas do banco. Nada aqui muda a velocidade sozinho - o
 * backlog proibe ajuste automatico, entao o resultado e so uma sugestao que o
 * leitor aceita ou ignora.
 */

export const SESSION_MODES = ["runner", "narracao", "pagina"] as const;
export type SessionMode = (typeof SESSION_MODES)[number];
export const DEFAULT_SESSION_MODE: SessionMode = "runner";

/** Nome do modo como a tela o mostra. */
export const SESSION_MODE_LABELS: Record<SessionMode, string> = {
  runner: "Guiada",
  narracao: "Narração",
  pagina: "Página",
};

/** Teto de posicoes de freio aceitas por sessao. */
export const MAX_BRAKES = 200;

export function isSessionMode(value: unknown): value is SessionMode {
  return SESSION_MODES.includes(value as SessionMode);
}

/**
 * Modo final da sessao a partir do corpo recebido.
 *
 * `narrated` e o campo antigo e continua valendo: `narrated: true` implica
 * narracao, mesmo que o modo venha diferente - a voz dita o ritmo, e contar a
 * sessao como runner poria o ppm da voz na media do olho. Devolve `null`
 * quando o modo veio preenchido com um valor desconhecido.
 */
export function resolveSessionMode(mode: unknown, narrated: unknown): SessionMode | null {
  if (narrated === true) return "narracao";
  if (mode === undefined || mode === null) return DEFAULT_SESSION_MODE;
  return isSessionMode(mode) ? mode : null;
}

/**
 * Posicoes de freio/recuo validadas.
 *
 * Ausente vira `null` (a tela nao mediu). Presente, precisa ser uma lista de
 * ate 200 inteiros nao negativos; qualquer coisa fora disso devolve
 * `undefined`, que a rota traduz em 400 em vez de gravar dado torto.
 */
export function parseBrakes(value: unknown): number[] | null | undefined {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value) || value.length > MAX_BRAKES) return undefined;
  const list: number[] = [];
  for (const item of value) {
    if (typeof item !== "number" || !Number.isInteger(item) || item < 0) return undefined;
    list.push(item);
  }
  return list;
}

/* --- sugestao de desacelerar ------------------------------------------------ */

/** Sessoes olhadas para tras. */
export const SLOWDOWN_WINDOW = 3;
/** Janela de palavras em que mais de um freio indica dificuldade. */
export const SLOWDOWN_WORDS = 150;
/** Freios tolerados por janela: acima disso, a sugestao aparece. */
export const SLOWDOWN_BRAKES_PER_WINDOW = 1;
/** Quanto a sugestao tira da velocidade. */
export const SLOWDOWN_STEP = 25;

export interface BrakeSample {
  mode: string;
  wordsRead: number;
  /** Nulo quando a sessao nao mediu os freios. */
  brakes: number[] | null;
}

export interface SlowdownSuggestion {
  /** Variacao sugerida, em ppm (sempre negativa). */
  deltaWpm: number;
  /** Freios por 150 palavras nas sessoes olhadas, com uma casa. */
  brakesPer150: number;
  /** Quantas sessoes entraram na conta. */
  sessions: number;
  message: string;
}

/**
 * Sugere "-25 ppm" quando o leitor freia demais no runner.
 *
 * A regra: pegar as 3 sessoes mais recentes do runner que mediram freios
 * (`brakes` nao nulo) e somar freios e palavras. Se houver mais de 1 freio ou
 * recuo a cada 150 palavras, sugerir 25 ppm a menos. Com menos de 3 sessoes
 * medidas nao ha sugestao: uma leitura dificil isolada e ruido, tres seguidas
 * sao padrao.
 *
 * Narracao e pagina ficam de fora: na narracao o ritmo e da voz, e na pagina
 * o proprio leitor ja controla o tempo - freio ali nao quer dizer que a
 * velocidade escolhida esta alta.
 *
 * `sessions` deve vir da mais recente para a mais antiga.
 */
export function suggestSlowdown(sessions: BrakeSample[]): SlowdownSuggestion | null {
  const measured = sessions
    .filter((session) => session.mode === "runner" && Array.isArray(session.brakes))
    .slice(0, SLOWDOWN_WINDOW);
  if (measured.length < SLOWDOWN_WINDOW) return null;

  const words = measured.reduce((sum, session) => sum + Math.max(0, session.wordsRead), 0);
  if (words <= 0) return null;
  const brakes = measured.reduce((sum, session) => sum + (session.brakes?.length ?? 0), 0);

  const rate = (brakes / words) * SLOWDOWN_WORDS;
  if (rate <= SLOWDOWN_BRAKES_PER_WINDOW) return null;

  return {
    deltaWpm: -SLOWDOWN_STEP,
    brakesPer150: Math.round(rate * 10) / 10,
    sessions: measured.length,
    message: `Nas últimas ${measured.length} leituras você freou ou voltou ${String(
      Math.round(rate * 10) / 10
    ).replace(".", ",")} vezes a cada ${SLOWDOWN_WORDS} palavras. Que tal ${SLOWDOWN_STEP} ppm a menos?`,
  };
}
