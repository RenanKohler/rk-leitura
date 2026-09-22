/**
 * Registro estruturado de erros (US-73).
 *
 * Cada erro vira uma linha JSON com um codigo curto que o leitor tambem ve na
 * mensagem. Quem relata um problema informa o codigo, e a busca nos logs da
 * hospedagem acha a linha exata.
 *
 * O que nunca entra na linha: conteudo de texto, e-mail e senha. Os erros do
 * Postgres e do Drizzle carregam os parametros da consulta e a linha que
 * falhou - exatamente onde esses dados aparecem - entao a mensagem passa por
 * `sanitizeMessage` e os campos de detalhe do driver sao descartados.
 */

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const REF_CODE_LENGTH = 8;

/** Codigo de 8 caracteres sem letras ambiguas (0/O, 1/I). */
export function newRefCode(random: () => number = Math.random): string {
  let code = "";
  for (let i = 0; i < REF_CODE_LENGTH; i += 1) {
    code += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
  }
  return code;
}

const REF_CODE_PATTERN = new RegExp(`^[${CODE_ALPHABET}]{${REF_CODE_LENGTH}}$`);

export function isRefCode(value: unknown): value is string {
  return typeof value === "string" && REF_CODE_PATTERN.test(value);
}

const MAX_MESSAGE = 500;
const MAX_STACK_LINES = 15;
const EMAIL = /[^\s@"'<>()]+@[^\s@"'<>()]+\.[^\s@"'<>()]+/g;

/**
 * Mensagem sem os dados que o driver anexa.
 *
 * - `params: ...` (Drizzle) traz os valores da consulta: texto, e-mail, hash.
 * - `Failing row contains (...)` (Postgres) traz a linha inteira.
 * - `Key (...)=(...)` (Postgres, violacao de indice) traz o valor duplicado.
 */
export function sanitizeMessage(message: string): string {
  return message
    .replace(/\n?params:[\s\S]*$/i, " params: [omitidos]")
    .replace(/Failing row contains[\s\S]*$/i, "Failing row contains [omitido]")
    .replace(/Key \(([^)]*)\)=\([\s\S]*?\)/g, "Key ($1)=[omitido]")
    .replace(EMAIL, "[e-mail]")
    .slice(0, MAX_MESSAGE);
}

/** So as linhas de chamada: a primeira linha do stack repete a mensagem crua. */
export function sanitizeStack(stack: string | undefined): string | undefined {
  if (!stack) return undefined;
  const frames = stack
    .split("\n")
    .filter((line) => /^\s+at\s/.test(line))
    .slice(0, MAX_STACK_LINES)
    .map((line) => line.trim());
  return frames.length > 0 ? frames.join("\n") : undefined;
}

export interface ErrorSummary {
  name: string;
  message: string;
  code?: string;
  stack?: string;
  cause?: ErrorSummary;
}

/** Resume o erro e a cadeia de causas, ja sem dados sensiveis. */
export function summarizeError(error: unknown, depth = 0): ErrorSummary {
  if (!(error instanceof Error)) {
    return { name: "NonError", message: sanitizeMessage(String(error)) };
  }

  const code = (error as { code?: unknown }).code;
  const cause = (error as { cause?: unknown }).cause;

  return {
    name: error.name,
    message: sanitizeMessage(error.message),
    ...(typeof code === "string" ? { code } : {}),
    ...(sanitizeStack(error.stack) ? { stack: sanitizeStack(error.stack) } : {}),
    ...(cause !== undefined && depth < 3 ? { cause: summarizeError(cause, depth + 1) } : {}),
  };
}

export interface ErrorEntry {
  level: "error";
  ref: string;
  scope: string;
  source: "servidor" | "navegador";
  userId: string | null;
  at: string;
  error: ErrorSummary;
  path?: string;
}

export function errorEntry(input: Omit<ErrorEntry, "level" | "at">, now = new Date()): ErrorEntry {
  return { level: "error", at: now.toISOString(), ...input };
}

/** Mensagem que o leitor ve, com o codigo para relatar o problema. */
export function userMessage(ref: string): string {
  return `Algo deu errado. Tente novamente. Codigo de referencia: ${ref}`;
}
