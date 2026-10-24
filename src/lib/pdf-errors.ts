/**
 * Mensagem em portugues para cada falha do pdf.js (US-181). O pdf.js lanca
 * excecoes com nome (`PasswordException`, `InvalidPDFException`...) e texto em
 * ingles; a tela mostra so o que a pessoa pode fazer.
 */
export const PDF_PASSWORD = "Este PDF é protegido por senha. Remova a senha e tente de novo.";
export const PDF_CORRUPT = "Não foi possível ler este PDF. O arquivo pode estar corrompido.";
export const PDF_FAILURE = "Não foi possível ler este PDF.";

const CORRUPT_NAMES = new Set([
  "InvalidPDFException",
  "MissingPDFException",
  "FormatError",
  "UnexpectedResponseException",
]);

export function pdfErrorMessage(error: unknown): string {
  const name = error && typeof error === "object" && "name" in error ? String(error.name) : "";
  if (name === "PasswordException") return PDF_PASSWORD;
  if (CORRUPT_NAMES.has(name)) return PDF_CORRUPT;
  return PDF_FAILURE;
}

/** Erro ja traduzido: a tela pode mostrar a mensagem como esta. */
export class PdfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PdfError";
  }
}
