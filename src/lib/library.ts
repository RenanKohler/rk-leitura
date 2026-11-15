/**
 * Regras da lista da biblioteca (US-230), compartilhadas pela tela, pela rota
 * e pela consulta: a ordem da lista, a linha de dados de cada item e quais
 * etiquetas entram na faixa de filtro. Funcoes puras, com teste.
 */
import { estimatedMinutes, formatNumber } from "@/lib/reading";
import type { TextScope, TextStatus } from "@/lib/text-filter";
import type { TagSummary } from "@/lib/types";

/* --- ordem da lista ------------------------------------------------------- */

/**
 * "leitura": o lido mais recentemente primeiro, e o nunca lido pela data em
 * que entrou - o texto recem-importado continua aparecendo no topo.
 * "importacao": a ordem de antes, so pela data em que o texto entrou.
 */
export const LIBRARY_ORDERS = ["leitura", "importacao"] as const;
export type LibraryOrder = (typeof LIBRARY_ORDERS)[number];

export const DEFAULT_LIBRARY_ORDER: LibraryOrder = "leitura";

/** Rotulos do controle de ordem, na ordem em que aparecem. */
export const LIBRARY_ORDER_OPTIONS: { value: LibraryOrder; label: string }[] = [
  { value: "leitura", label: "Última leitura" },
  { value: "importacao", label: "Data de importação" },
];

/**
 * Ordem pedida em `?ordem=` ou guardada no aparelho. Qualquer valor fora da
 * lista (ausente, vazio, de uma versao antiga) cai no padrao em vez de virar
 * erro: a lista tem de abrir de qualquer jeito.
 */
export function asLibraryOrder(value: unknown): LibraryOrder {
  return LIBRARY_ORDERS.includes(value as LibraryOrder)
    ? (value as LibraryOrder)
    : DEFAULT_LIBRARY_ORDER;
}

/** Onde a escolha mora no aparelho (`localStorage`). */
export const LIBRARY_ORDER_KEY = "rk-leitura:ordem-biblioteca";

/**
 * Copia da escolha num cookie, so para o servidor montar a primeira tela ja
 * na ordem certa. Sem dois-pontos no nome: cookie nao aceita.
 */
export const LIBRARY_ORDER_COOKIE = "rk-leitura-ordem";

/* --- linha de dados do item ----------------------------------------------- */

/** Em que pe a leitura esta, como o item da lista a mostra. */
export type ReadingState =
  /** Importado sozinho (serie acompanhada ou feed) e ainda nao aberto. */
  | { kind: "novo" }
  | { kind: "nao-lido" }
  | { kind: "lendo"; percent: number }
  | { kind: "lido" };

/**
 * Mesmos cortes do filtro de leitura em `queries.ts`: em andamento e quem
 * saiu do inicio e nao chegou ao fim; lido, quem alcancou a contagem de
 * palavras. O texto vazio nunca conta como lido.
 *
 * A porcentagem fica entre 1 e 99: arredondar deixava um texto comecado em
 * "0% lido" e um a dez palavras do fim em "100% lido", ainda na lista.
 */
export function readingState({
  progressIndex,
  wordCount,
  fresh = false,
}: {
  progressIndex: number;
  wordCount: number;
  fresh?: boolean;
}): ReadingState {
  if (wordCount > 0 && progressIndex >= wordCount) return { kind: "lido" };
  if (wordCount > 0 && progressIndex > 0) {
    const percent = Math.round((progressIndex / wordCount) * 100);
    return { kind: "lendo", percent: Math.min(99, Math.max(1, percent)) };
  }
  return fresh ? { kind: "novo" } : { kind: "nao-lido" };
}

/** Texto do estado na linha de dados; nulo no texto parado no inicio. */
export function readingStateLabel(state: ReadingState): string | null {
  if (state.kind === "lendo") return `${state.percent}% lido`;
  if (state.kind === "lido") return "Lido";
  if (state.kind === "novo") return "Novo";
  return null;
}

/** Tamanho do texto: palavras e o tempo de leitura na velocidade do leitor. */
export function sizeLabel(wordCount: number, wpm: number): string {
  return `${formatNumber(wordCount)} palavras · ~${estimatedMinutes(wordCount, wpm)} min`;
}

/* --- faixa de etiquetas --------------------------------------------------- */

/**
 * A contagem de cada etiqueta vale para a lista que esta na tela?
 *
 * O servidor conta os textos da lista principal no filtro padrao (`loadTags`
 * em `queries.ts`): sem arquivados e sem largados. Os outros filtros de
 * leitura so recortam esse conjunto, entao zero continua sendo zero. Na aba
 * de arquivados e no filtro de largados o numero fala de outros textos.
 */
export function tagCountsApply(scope: TextScope, status: TextStatus): boolean {
  return scope === "ativos" && status !== "largados";
}

/**
 * Etiquetas que entram na faixa de filtro.
 *
 * Onde a contagem vale, saem as que nao marcam nenhum texto: "Atencao 0"
 * ocupava lugar e, tocada, so levava a uma lista vazia. A escolhida fica
 * sempre, mesmo zerada, para dar para desligar o filtro. Onde a contagem nao
 * vale entram todas: esconder por ela tiraria o filtro de uma etiqueta que so
 * tem textos arquivados ou largados.
 */
export function visibleTags(
  tags: TagSummary[],
  countsApply: boolean,
  selectedId: string | null
): TagSummary[] {
  if (!countsApply) return tags;
  return tags.filter((tag) => tag.texts > 0 || tag.id === selectedId);
}
