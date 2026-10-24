/**
 * Aparelhos conectados (US-97) e codigos de recuperacao (US-96).
 *
 * Funcoes puras, testaveis sem banco.
 */

/** "Chrome no Android", a partir do User-Agent. */
export function describeDevice(userAgent: string | null | undefined): string {
  const ua = userAgent ?? "";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\/|Opera/.test(ua)
      ? "Opera"
      : /Firefox\/|FxiOS/.test(ua)
        ? "Firefox"
        : /SamsungBrowser/.test(ua)
          ? "Samsung Internet"
          : /Chrome\/|CriOS/.test(ua)
            ? "Chrome"
            : /Safari\//.test(ua)
              ? "Safari"
              : null;
  const system = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Mac OS X|Macintosh/.test(ua)
          ? "Mac"
          : /Windows/.test(ua)
            ? "Windows"
            : /Linux/.test(ua)
              ? "Linux"
              : null;

  if (browser && system) return `${browser} no ${system}`;
  return browser ?? system ?? "Aparelho desconhecido";
}

/** Quantos codigos cada conjunto tem. */
export const RECOVERY_CODE_COUNT = 8;

// Sem 0/O, 1/I/L: o codigo e copiado a mao de um papel.
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

/**
 * Codigo no formato "XXXXX-XXXXX": 10 simbolos de 31, ~49 bits. Com o
 * limite de tentativas por e-mail, adivinhar e inviavel.
 */
export function generateRecoveryCode(random: (size: number) => Uint8Array): string {
  const bytes = random(10);
  let code = "";
  for (let position = 0; position < 10; position += 1) {
    // O descarte de modulo nao importa aqui: 256 % 31 da um vies de menos de
    // 1% por simbolo, sem efeito pratico na entropia.
    code += ALPHABET[bytes[position]! % ALPHABET.length];
    if (position === 4) code += "-";
  }
  return code;
}

/** Forma comparavel do que foi digitado: maiusculas, sem espaco nem hifen. */
export function normalizeRecoveryCode(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const clean = input.toUpperCase().replace(/[\s-]/g, "");
  return /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{10}$/.test(clean) ? clean : null;
}

/** Revogadas ou vencidas ha mais que isso saem da tabela (US-188). */
export const SESSION_RETENTION_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Tokens emitidos antes deste instante ja venceram: o aparelho nao aparece
 * mais em "Aparelhos conectados" (US-188).
 */
export function sessionValidSince(now: Date, maxAgeSeconds: number): Date {
  return new Date(now.getTime() - maxAgeSeconds * 1000);
}

/**
 * Corte da limpeza: revogadas antes de `revokedBefore`, ou com token vencido
 * ha mais de 30 dias (emitido antes de `issuedBefore`).
 */
export function sessionPruneCutoffs(
  now: Date,
  maxAgeSeconds: number
): { revokedBefore: Date; issuedBefore: Date } {
  const revokedBefore = new Date(now.getTime() - SESSION_RETENTION_DAYS * DAY_MS);
  return {
    revokedBefore,
    issuedBefore: new Date(revokedBefore.getTime() - maxAgeSeconds * 1000),
  };
}
