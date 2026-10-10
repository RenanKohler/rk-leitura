/**
 * Exportacao dos cartoes de estudo para o Anki (US-160).
 *
 * Texto separado por tabulacao, que o Anki importa direto ("Arquivo >
 * Importar"): frente, verso e uma etiqueta com o titulo do texto. O `.apkg`
 * exigiria SQLite empacotado e uma dependencia nova. As linhas de cabecalho
 * com `#` dizem ao Anki o separador, que o conteudo e texto puro e qual
 * coluna traz as etiquetas, sem o leitor precisar escolher na importacao.
 */

export interface AnkiCard {
  front: string;
  back: string;
  /** Titulo do texto de origem; vira a etiqueta. */
  title: string;
}

export const NO_CARDS_TO_EXPORT = "Nenhum cartão para exportar.";

/** Campo sem tabulacao nem quebra de linha: elas quebrariam as colunas. */
export function ankiField(value: string): string {
  return value.replace(/[\t\r\n\u2028\u2029]+/g, " ").replace(/ {2,}/g, " ").trim();
}

/**
 * Etiqueta do Anki a partir do titulo. Etiqueta nao tem espaco (o espaco
 * separa etiquetas): as palavras ficam ligadas por "_", sem pontuacao.
 */
export function ankiTag(title: string): string {
  const tag = title
    .normalize("NFC")
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/^_+|_+$/g, "");
  return tag || "rk-leitura";
}

export function ankiExport(cards: AnkiCard[]): string {
  const lines = ["#separator:tab", "#html:false", "#tags column:3"];
  for (const card of cards) {
    lines.push([ankiField(card.front), ankiField(card.back), ankiTag(card.title)].join("\t"));
  }
  return `${lines.join("\n")}\n`;
}

/** Nome do arquivo baixado: o titulo do texto, ou "todos" para a conta inteira. */
export function ankiFileName(title: string | null): string {
  // So ASCII: o nome vai num cabecalho HTTP, que nao aceita acento.
  const slug = (title ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return `cartoes-${title === null ? "todos" : slug || "texto"}.txt`;
}
