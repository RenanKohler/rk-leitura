/**
 * Codificacao de paginas e arquivos importados (US-178).
 *
 * Tudo era lido como UTF-8, e uma pagina em ISO-8859-1 ou Windows-1252 chegava
 * com "aten��o" no lugar de "atenção" - o dicionario, a narracao e os
 * destaques passavam a trabalhar sobre palavras quebradas. Funcoes puras,
 * usadas no servidor (importacao por URL, feed, serie) e na tela (arquivos).
 */

/** Bytes lidos do inicio do documento para achar a declaracao. */
const SNIFF_BYTES = 4096;

/** Rotulo que o `TextDecoder` conhece, ou null. */
function knownLabel(label: string | null | undefined): string | null {
  const clean = label?.trim().replace(/^["']|["']$/g, "").toLowerCase();
  if (!clean) return null;
  try {
    return new TextDecoder(clean).encoding;
  } catch {
    return null;
  }
}

/** `charset` do cabecalho Content-Type. */
export function charsetFromContentType(contentType: string | null | undefined): string | null {
  const match = /charset\s*=\s*("?)([^";\s]+)\1/i.exec(contentType ?? "");
  return match ? knownLabel(match[2]) : null;
}

/**
 * Declaracao dentro do documento: `<meta charset>`, `<meta http-equiv
 * content="...; charset=">` ou `<?xml encoding="...">`. Os primeiros bytes
 * sao lidos como Windows-1252: as declaracoes sao ASCII em qualquer
 * codificacao que importa aqui.
 */
export function charsetFromDocument(bytes: Uint8Array): string | null {
  const head = decodeWindows1252(bytes.subarray(0, SNIFF_BYTES));
  const xml = /^\s*<\?xml[^>]*\bencoding\s*=\s*["']([^"']+)["']/i.exec(head);
  if (xml) return knownLabel(xml[1]);
  const meta = /<meta[^>]+charset\s*=\s*["']?([^"'\s/>;]+)/i.exec(head);
  return meta ? knownLabel(meta[1]) : null;
}

/**
 * Caracteres de 0x80 a 0x9F no Windows-1252 (aspas tipograficas, travessao,
 * reticencias, euro). O `TextDecoder` do Node trata "windows-1252" como
 * latin1 e devolve controles C1 nessa faixa; o do navegador nao. Decodificar
 * a mao deixa os dois iguais.
 */
const WINDOWS_1252_HIGH =
  "\u20ac\ufffd\u201a\u0192\u201e\u2026\u2020\u2021\u02c6\u2030\u0160\u2039\u0152\ufffd\u017d\ufffd" +
  "\ufffd\u2018\u2019\u201c\u201d\u2022\u2013\u2014\u02dc\u2122\u0161\u203a\u0153\ufffd\u017e\u0178";

function decodeWindows1252(bytes: Uint8Array): string {
  let text = "";
  for (let i = 0; i < bytes.length; i += 8192) {
    const chunk = bytes.subarray(i, i + 8192);
    text += String.fromCharCode(...chunk);
  }
  return text.replace(/[\u0080-\u009f]/g, (char) => WINDOWS_1252_HIGH[char.charCodeAt(0) - 0x80]!);
}

/** `TextDecoder`, com o Windows-1252 (e o ISO-8859-1, que o WHATWG trata igual) feito a mao. */
function decodeAs(encoding: string, bytes: Uint8Array): string {
  if (encoding === "windows-1252") return decodeWindows1252(bytes);
  return new TextDecoder(encoding).decode(bytes);
}

function bomEncoding(bytes: Uint8Array): string | null {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return "utf-8";
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return "utf-16be";
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return "utf-16le";
  return null;
}

/**
 * Decodifica o corpo de uma resposta. Ordem: marca BOM, `charset` do
 * cabecalho, declaracao do documento, UTF-8. Codificacao nao reconhecida
 * vale UTF-8, como antes.
 */
export function decodeBody(bytes: Uint8Array, contentType?: string | null): string {
  const encoding =
    bomEncoding(bytes) ?? charsetFromContentType(contentType) ?? charsetFromDocument(bytes) ?? "utf-8";
  return decodeAs(encoding, bytes);
}

/**
 * Arquivo de texto sem declaracao (.txt, .md): UTF-8 se for UTF-8 valido,
 * senao Windows-1252 - a codificacao de quase todo .txt salvo no Windows em
 * portugues. ISO-8859-1 e um subconjunto dela para letras acentuadas.
 */
export function decodeTextFile(bytes: Uint8Array): string {
  const bom = bomEncoding(bytes);
  if (bom) return new TextDecoder(bom).decode(bytes);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return decodeWindows1252(bytes);
  }
}
