/**
 * Regras de senha, as mesmas no formulario e na rota.
 *
 * O bcrypt so considera os primeiros 72 bytes: uma frase-senha maior teria o
 * resto ignorado sem aviso (US-190). A conta e em bytes UTF-8, entao letras
 * acentuadas contam dois. Senhas antigas acima do limite seguem entrando: o
 * login nao confere o tamanho.
 */
export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_BYTES = 72;

export const PASSWORD_TOO_SHORT = `A senha precisa ter ao menos ${MIN_PASSWORD_LENGTH} caracteres.`;
export const PASSWORD_TOO_LONG = "A senha pode ter até 72 caracteres (menos se tiver acentos).";

/** O problema da senha nova, ou null quando ela serve. */
export function passwordProblem(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return PASSWORD_TOO_SHORT;
  if (new TextEncoder().encode(password).length > MAX_PASSWORD_BYTES) return PASSWORD_TOO_LONG;
  return null;
}
