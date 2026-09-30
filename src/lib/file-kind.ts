/**
 * Que leitor usar para um arquivo escolhido (APP-11).
 *
 * A importacao mandava tudo que nao fosse EPUB, Word ou Markdown para o
 * leitor de PDF: um .txt ou uma foto terminavam em "Invalid PDF structure.",
 * a mensagem crua do pdf.js. A decisao agora olha extensao e tipo MIME antes,
 * e o que nao for reconhecido recebe uma mensagem que diz o que fazer.
 */

export type FileKind = "pdf" | "epub" | "docx" | "markdown" | "text";

export const UNSUPPORTED_FILE = "Formato nao suportado. Use PDF, EPUB, DOCX, MD ou TXT";

/** Valor do `accept` do campo de arquivo, na mesma lista que `fileKind` aceita. */
export const FILE_ACCEPT = [
  ".pdf",
  ".epub",
  ".docx",
  ".md",
  ".markdown",
  ".txt",
  "application/pdf",
  "application/epub+zip",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/markdown",
  "text/plain",
].join(",");

const BY_EXTENSION: Record<string, FileKind> = {
  pdf: "pdf",
  epub: "epub",
  docx: "docx",
  md: "markdown",
  markdown: "markdown",
  txt: "text",
  text: "text",
};

const BY_MIME: Record<string, FileKind> = {
  "application/pdf": "pdf",
  "application/epub+zip": "epub",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "text/markdown": "markdown",
  "text/x-markdown": "markdown",
  "text/plain": "text",
};

/**
 * A extensao vence o MIME: o sistema costuma chamar um .md de "text/plain", e
 * alguns celulares entregam tudo como "application/octet-stream". O MIME so
 * decide quando o nome nao tem extensao conhecida - arquivos compartilhados
 * por outro app as vezes chegam sem ela.
 */
export function fileKind(name: string, mime = ""): FileKind | null {
  const extension = /\.([a-z0-9]+)$/i.exec(name.trim())?.[1]?.toLowerCase();
  if (extension && extension in BY_EXTENSION) return BY_EXTENSION[extension]!;
  if (extension && extension !== "bin") return null;
  return BY_MIME[mime.split(";")[0]!.trim().toLowerCase()] ?? null;
}
