/**
 * Vibracao ao mudar de secao no Word Runner (US-216).
 *
 * A decisao e pura; quem chama `navigator.vibrate` e o leitor.
 */

import { paragraphAt, type Paragraph } from "@/lib/reading";

/** Uma vibracao curta ao entrar num titulo. */
export const SECTION_PULSE: number = 30;

/** Duas vibracoes curtas no fim de um capitulo de serie. */
export const CHAPTER_PULSE: number[] = [30, 60, 30];

export type HapticEvent = "secao" | "capitulo";

/** A palavra e a primeira de um titulo (h1, h2 ou h3). */
export function startsHeading(paragraphs: Paragraph[], index: number): boolean {
  if (paragraphs.length === 0 || index <= 0) return false;
  const paragraph = paragraphs[paragraphAt(paragraphs, index)];
  if (!paragraph || paragraph.start !== index) return false;
  return paragraph.kind === "h1" || paragraph.kind === "h2" || paragraph.kind === "h3";
}

/** Padrao de vibracao para o evento, ou null quando nao deve vibrar. */
export function hapticPattern(
  event: HapticEvent | null,
  options: { enabled: boolean; narrating: boolean }
): number | number[] | null {
  if (!event || !options.enabled || options.narrating) return null;
  return event === "secao" ? SECTION_PULSE : CHAPTER_PULSE;
}

/** O navegador tem a API de vibracao (o Safari do iOS nao tem). */
export function canVibrate(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.vibrate === "function";
}

/** Vibra, quando ha padrao e API. Erros do navegador sao ignorados. */
export function vibrate(pattern: number | number[] | null): void {
  if (pattern === null || !canVibrate()) return;
  try {
    navigator.vibrate(pattern);
  } catch {
    // Sem permissao (sem gesto do usuario ainda): so nao vibra.
  }
}
