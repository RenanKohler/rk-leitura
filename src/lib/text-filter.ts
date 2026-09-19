/**
 * Filtros da biblioteca, compartilhados pela tela e pela rota.
 *
 * Funcoes puras: a dobra de acento precisa dar o mesmo resultado no termo
 * digitado e na coluna consultada, senao "coracao" nao acha "coração".
 */

export const TEXT_STATUSES = ["todos", "nao-iniciados", "em-andamento", "concluidos"] as const;

export type TextStatus = (typeof TEXT_STATUSES)[number];

export const DEFAULT_STATUS: TextStatus = "todos";

/** Termo com mais que isso nao ajuda a filtrar e so pesa na consulta. */
export const MAX_QUERY_CHARS = 80;

/** Aba da biblioteca: a lista principal ou o que foi tirado dela. */
export const TEXT_SCOPES = ["ativos", "arquivados"] as const;
export type TextScope = (typeof TEXT_SCOPES)[number];
export const DEFAULT_SCOPE: TextScope = "ativos";

export function asTextScope(value: unknown): TextScope {
  return TEXT_SCOPES.includes(value as TextScope) ? (value as TextScope) : DEFAULT_SCOPE;
}

export function asTextStatus(value: unknown): TextStatus {
  return TEXT_STATUSES.includes(value as TextStatus) ? (value as TextStatus) : DEFAULT_STATUS;
}

/**
 * Letras acentuadas e a forma sem acento correspondente.
 *
 * Duas listas em vez de `normalize("NFD")` porque o mesmo mapeamento precisa
 * existir em SQL, onde `translate()` recebe exatamente estes dois textos. Uma
 * unica fonte evita que a busca passe a divergir do banco na primeira letra
 * que alguem esquecer de acrescentar de um lado so.
 */
export const ACCENTED = "áàâãäåéèêëíìîïóòôõöøúùûüçñýÿ";
export const UNACCENTED = "aaaaaaeeeeiiiioooooouuuucnyy";

/** Forma usada na comparacao: minuscula, sem acento e sem espaco sobrando. */
export function foldForSearch(value: string): string {
  let folded = "";
  for (const char of value.toLowerCase()) {
    const at = ACCENTED.indexOf(char);
    folded += at === -1 ? char : UNACCENTED[at];
  }
  return folded.replace(/\s+/g, " ").trim();
}

/** Termo pronto para a consulta, ou null quando nao ha o que filtrar. */
export function normalizeQuery(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const folded = foldForSearch(raw).slice(0, MAX_QUERY_CHARS);
  return folded.length > 0 ? folded : null;
}

/** Escapa os curingas do LIKE para que sejam buscados como texto comum. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}
