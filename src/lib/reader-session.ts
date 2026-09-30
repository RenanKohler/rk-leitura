/**
 * Contabilidade da sessao de leitura do leitor.
 *
 * Uma tela, tres jeitos de ler: o Word Runner, a narracao em voz alta e a
 * pagina virada a mao. Cada um vira uma sessao propria (o ritmo de cada um e
 * de natureza diferente), e trocar de um para outro fecha a sessao anterior.
 *
 * Funcoes puras sobre um objeto mutavel guardado numa ref do leitor: o
 * relogio nao precisa re-renderizar nada, e os testes controlam o tempo
 * passando `now`.
 */
import { MAX_WPM } from "@/lib/reading";

export type SessionMode = "runner" | "narracao" | "pagina";

/** Abaixo disso a sessao nao e gravada: foi um toque, nao uma leitura. */
export const MIN_WORDS_TO_RECORD = 10;
export const MIN_SESSION_MS = 1000;

/**
 * Teto de tempo contado por pagina. Um aparelho largado na mesma pagina nao
 * pode virar meia hora de leitura de 200 palavras.
 */
export const PAGE_MAX_MS = 120_000;

/**
 * Tempo minimo por palavra para a pagina contar como lida: o do ppm maximo.
 * Folhear mais rapido que isso e procurar, nao ler.
 */
export const PAGE_MIN_MS_PER_WORD = 60_000 / MAX_WPM;

/** Freios e recuos guardados por sessao, no maximo (sinal de dificuldade). */
export const MAX_BRAKES = 200;

export interface SessionMeter {
  mode: SessionMode | null;
  /** Inicio do trecho corrente do relogio; null com o relogio parado. */
  startedAt: number | null;
  /** Tempo de relogio ja acumulado, sem o trecho corrente. */
  elapsed: number;
  /**
   * Tempo descontado da sessao: as pausas de pontuacao e o atraso da rampa do
   * Word Runner. Sem o desconto o ritmo medido ficava 20% abaixo do escolhido,
   * o treino nunca cumpria o dia e as estimativas erravam (US-83, US-94).
   */
  credit: number;
  words: number;
  /** Posicoes de freio e de "voltar a frase" (PROD-10). */
  brakes: number[];
}

export interface SessionRecord {
  mode: SessionMode;
  wordsRead: number;
  /** Tempo de leitura: relogio menos o desconto. E o que vai para a API. */
  durationMs: number;
  /** Tempo de relogio, com as pausas: o que a pessoa viveu. */
  wallMs: number;
  brakes: number[];
}

export function createMeter(): SessionMeter {
  return { mode: null, startedAt: null, elapsed: 0, credit: 0, words: 0, brakes: [] };
}

export function running(meter: SessionMeter): boolean {
  return meter.startedAt !== null;
}

/** Relogio da sessao corrente, com o trecho em andamento. */
export function wallMs(meter: SessionMeter, now: number): number {
  return meter.elapsed + (meter.startedAt !== null ? Math.max(0, now - meter.startedAt) : 0);
}

/**
 * Liga o relogio num modo. Se a sessao aberta era de outro modo e tem
 * palavras, ela e fechada e devolvida para ser gravada.
 */
export function startClock(
  meter: SessionMeter,
  mode: SessionMode,
  now: number
): SessionRecord | null {
  let closed: SessionRecord | null = null;
  if (meter.mode !== null && meter.mode !== mode) {
    // O relogio da sessao anterior para antes de fechar: senao ela seguiria
    // "correndo" como se o modo novo fosse continuacao dela.
    stopClock(meter, now);
    closed = takeRecord(meter, now);
  }
  meter.mode = mode;
  if (meter.startedAt === null) meter.startedAt = now;
  return closed;
}

export function stopClock(meter: SessionMeter, now: number): void {
  if (meter.startedAt === null) return;
  meter.elapsed += Math.max(0, now - meter.startedAt);
  meter.startedAt = null;
}

/** Palavras lidas no Word Runner ou na narracao, com o desconto do tempo. */
export function addWords(meter: SessionMeter, count: number, creditMs = 0): void {
  meter.words += Math.max(0, count);
  meter.credit += Math.max(0, creditMs);
}

/**
 * Pagina virada para a frente. Conta as palavras dela quando o tempo na
 * pagina e plausivel para uma leitura; o tempo contado tem teto. Devolve se
 * a pagina contou.
 */
export function addPage(
  meter: SessionMeter,
  words: number,
  dwellMs: number,
  now: number
): { counted: boolean; closed: SessionRecord | null } {
  if (words <= 0 || dwellMs < words * PAGE_MIN_MS_PER_WORD) return { counted: false, closed: null };
  // Uma sessao aberta de outro modo e fechada antes: cada modo tem o seu ritmo.
  const closed = meter.mode !== null && meter.mode !== "pagina" ? takeRecord(meter, now) : null;
  meter.mode = "pagina";
  meter.words += words;
  meter.elapsed += Math.min(dwellMs, PAGE_MAX_MS);
  return { counted: true, closed };
}

/** Freio ou recuo na posicao dada. */
export function addBrake(meter: SessionMeter, position: number): void {
  if (meter.brakes.length < MAX_BRAKES) meter.brakes.push(Math.max(0, Math.trunc(position)));
}

/**
 * Fecha a sessao corrente e zera os acumuladores. O relogio que estava
 * correndo continua correndo, agora para a sessao seguinte do mesmo modo -
 * fechar a sessao (aba escondida, por exemplo) nao pode parar a leitura nem
 * congelar o relogio dela.
 *
 * Devolve null quando nao ha o que gravar (poucas palavras ou tempo curto).
 */
export function takeRecord(meter: SessionMeter, now: number): SessionRecord | null {
  const wall = wallMs(meter, now);
  const record: SessionRecord | null =
    meter.mode !== null
      ? {
          mode: meter.mode,
          wordsRead: meter.words,
          durationMs: Math.max(0, Math.round(wall - meter.credit)),
          wallMs: Math.round(wall),
          brakes: meter.brakes,
        }
      : null;

  const wasRunning = meter.startedAt !== null;
  meter.elapsed = 0;
  meter.credit = 0;
  meter.words = 0;
  meter.brakes = [];
  meter.startedAt = wasRunning ? now : null;
  if (!wasRunning) meter.mode = null;

  if (!record || record.wordsRead < MIN_WORDS_TO_RECORD || record.durationMs < MIN_SESSION_MS) {
    return null;
  }
  return record;
}
