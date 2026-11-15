/**
 * Revisao do dia num so lugar (US-161). Funcoes puras, com teste.
 *
 * Palavras, destaques, cartoes de estudo e questionarios a recordar (US-169)
 * vencidos hoje entram numa unica sessao: no maximo 50 itens, os mais
 * atrasados primeiro, intercalando os tipos para a sessao nao virar tres
 * revisoes seguidas. Nao ha estado de sessao guardado: item respondido deixa
 * de estar vencido, entao reabrir a tela no mesmo dia continua do proximo.
 * Pelo mesmo motivo o item pulado (US-223) volta ao reabrir a tela: pular nao
 * grava nada, ele so continua vencido.
 */

export const DAILY_REVIEW_KINDS = ["palavra", "destaque", "cartao", "recordar"] as const;
export type DailyReviewKind = (typeof DAILY_REVIEW_KINDS)[number];

export const DAILY_REVIEW_KIND_LABELS: Record<DailyReviewKind, { one: string; many: string }> = {
  palavra: { one: "palavra", many: "palavras" },
  destaque: { one: "destaque", many: "destaques" },
  cartao: { one: "cartão", many: "cartões" },
  recordar: { one: "questionário", many: "questionários" },
};

/** Itens por sessao. */
export const DAILY_REVIEW_LIMIT = 50;

/**
 * Dia que conta como "nunca revisado" na ordenacao: o item entrou na revisao
 * sem data e e tratado como o mais atrasado de todos.
 */
const NEVER = "0000-01-01";

/** O minimo que a ordenacao precisa de um item. */
export interface Orderable {
  kind: DailyReviewKind;
  /** Dia em que venceu (AAAA-MM-DD), ou null quando venceu sem data. */
  dueOn: string | null;
}

function dueKey(item: Orderable): string {
  return item.dueOn ?? NEVER;
}

/** Os mais atrasados primeiro; empate fica na ordem dos tipos e depois na de chegada. */
export function byOverdue<T extends Orderable>(items: T[]): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const due = dueKey(a.item).localeCompare(dueKey(b.item));
      if (due !== 0) return due;
      const kind = DAILY_REVIEW_KINDS.indexOf(a.item.kind) - DAILY_REVIEW_KINDS.indexOf(b.item.kind);
      return kind !== 0 ? kind : a.index - b.index;
    })
    .map(({ item }) => item);
}

/**
 * Intercala os tipos mantendo os mais atrasados na frente.
 *
 * A cada passo sai o item mais atrasado entre as cabecas de cada tipo, mas
 * evitando repetir o tipo do item anterior enquanto houver outro tipo com
 * itens. Dentro de um tipo a ordem e sempre a de atraso.
 */
export function interleave<T extends Orderable>(items: T[]): T[] {
  const queues = new Map<DailyReviewKind, T[]>();
  for (const item of byOverdue(items)) {
    const queue = queues.get(item.kind) ?? [];
    queue.push(item);
    queues.set(item.kind, queue);
  }

  const result: T[] = [];
  let last: DailyReviewKind | null = null;
  while (result.length < items.length) {
    const heads = DAILY_REVIEW_KINDS.filter((kind) => (queues.get(kind)?.length ?? 0) > 0);
    const others = heads.filter((kind) => kind !== last);
    const pool = others.length > 0 ? others : heads;
    let chosen = pool[0]!;
    for (const kind of pool) {
      if (dueKey(queues.get(kind)![0]!) < dueKey(queues.get(chosen)![0]!)) chosen = kind;
    }
    result.push(queues.get(chosen)!.shift()!);
    last = chosen;
  }
  return result;
}

/**
 * A sessao do dia: os `limit` mais atrasados de todos os tipos, intercalados.
 * O corte vem antes da intercalacao, para nao trocar um item muito atrasado
 * por um recente so porque o tipo dele ainda nao apareceu.
 */
export function dailySession<T extends Orderable>(items: T[], limit = DAILY_REVIEW_LIMIT): T[] {
  return interleave(byOverdue(items).slice(0, Math.max(0, limit)));
}

export type DailyCounts = Record<DailyReviewKind, number>;

export function emptyCounts(): DailyCounts {
  return { palavra: 0, destaque: 0, cartao: 0, recordar: 0 };
}

export function totalOf(counts: DailyCounts): number {
  return DAILY_REVIEW_KINDS.reduce((sum, kind) => sum + counts[kind], 0);
}

/** "3 palavras · 1 cartão": so os tipos com algum item. */
export function countsLabel(counts: DailyCounts): string {
  return DAILY_REVIEW_KINDS.filter((kind) => counts[kind] > 0)
    .map((kind) => {
      const label = DAILY_REVIEW_KIND_LABELS[kind];
      return `${counts[kind]} ${counts[kind] === 1 ? label.one : label.many}`;
    })
    .join(" · ");
}

/** "1 item", "12 itens". */
export function itemsLabel(count: number): string {
  return `${count} ${count === 1 ? "item" : "itens"}`;
}

/* --- pular e tirar da revisao (US-223) -------------------------------------- */

/**
 * Como um item saiu da tela. So "lembrado" e "errado" sao respostas: o pulado
 * continua vencido e volta quando a tela for aberta de novo, e o tirado saiu
 * da revisao de vez (palavra aprendida, destaque fora da revisao, cartao
 * excluido, questionario dispensado). Nenhum dos dois conta como acerto nem
 * como erro.
 */
export type ReviewOutcome = "lembrado" | "errado" | "pulado" | "tirado";

/** Placar da sessao, para o resumo do fim. */
export interface SessionTally {
  /** Respondidos, lembrados ou nao. */
  answered: number;
  /** Respondidos com nota diferente de "errei". */
  remembered: number;
  /** Pulados: continuam na fila. */
  skipped: number;
  /** Tirados da revisao nesta sessao. */
  removed: number;
}

export function emptyTally(): SessionTally {
  return { answered: 0, remembered: 0, skipped: 0, removed: 0 };
}

export function tallyWith(tally: SessionTally, outcome: ReviewOutcome): SessionTally {
  if (outcome === "pulado") return { ...tally, skipped: tally.skipped + 1 };
  if (outcome === "tirado") return { ...tally, removed: tally.removed + 1 };
  return {
    ...tally,
    answered: tally.answered + 1,
    remembered: tally.remembered + (outcome === "lembrado" ? 1 : 0),
  };
}

export interface SessionSummary {
  title: string;
  description: string;
}

/**
 * O resumo do fim da sessao. A conta de "lembrou X de Y" so olha os
 * respondidos; pulados e tirados vem em frases proprias. Sem nenhuma
 * resposta a sessao nao foi "concluida": o titulo diz isso, e o texto diz
 * quantos itens continuam na fila.
 */
export function sessionSummary(tally: SessionTally): SessionSummary {
  const removed =
    tally.removed > 0
      ? `${tally.removed} ${tally.removed === 1 ? "saiu" : "saíram"} da revisão.`
      : "";
  const join = (...parts: string[]) => parts.filter(Boolean).join(" ");

  if (tally.answered === 0) {
    if (tally.skipped === 0) {
      // Tudo foi tirado: nada respondido, mas tambem nada pendente.
      return {
        title: "Nada ficou na fila",
        description:
          tally.removed === 0
            ? "Nenhum item nesta sessão."
            : tally.removed === 1
              ? "1 item saiu da revisão."
              : `${tally.removed} itens saíram da revisão.`,
      };
    }
    return {
      title: "Nada respondido",
      description: join(
        tally.skipped === 1
          ? "1 item pulado continua na fila."
          : `${tally.skipped} itens pulados continuam na fila.`,
        removed
      ),
    };
  }

  return {
    title: "Revisão concluída",
    description: join(
      `Você lembrou ${tally.remembered} de ${tally.answered}.`,
      tally.remembered < tally.answered ? "O que você errou volta amanhã." : "",
      tally.skipped > 0
        ? `${tally.skipped} ${tally.skipped === 1 ? "pulado continua" : "pulados continuam"} na fila.`
        : "",
      removed
    ),
  };
}

export interface RemovalCopy {
  /** Nome da acao: titulo da confirmacao. */
  title: string;
  /** O efeito, em uma frase. */
  effect: string;
  /** Rotulo do botao que confirma. */
  confirm: string;
  /** Apagar de verdade: o botao de confirmar vai no papel de erro. */
  destructive: boolean;
}

/**
 * "Tirar da revisao" quer dizer uma coisa diferente em cada tipo, e a
 * confirmacao precisa dizer qual. No questionario, o texto depende da
 * rodada: dispensar a de 7 dias nao dispensa a de 30.
 */
export function removalCopy(kind: DailyReviewKind, recallRound?: number): RemovalCopy {
  if (kind === "palavra") {
    return {
      title: "Já sei esta palavra",
      effect: "A palavra sai da revisão e continua na sua lista de palavras, como aprendida.",
      confirm: "Já sei esta palavra",
      destructive: false,
    };
  }
  if (kind === "destaque") {
    return {
      title: "Não revisar este destaque",
      effect:
        "O destaque sai da revisão e continua no texto; dá para voltar a revisar pela tela de destaques.",
      confirm: "Não revisar",
      destructive: false,
    };
  }
  if (kind === "cartao") {
    return {
      title: "Excluir cartão",
      effect: "O cartão é apagado e não dá para desfazer.",
      confirm: "Excluir cartão",
      destructive: true,
    };
  }
  return {
    title: "Dispensar este questionário",
    effect:
      recallRound === 7
        ? "Esta rodada sai da revisão sem nota; a de 30 dias continua valendo."
        : "Esta rodada sai da revisão sem nota, e o questionário deste texto não volta mais.",
    confirm: "Dispensar este questionário",
    destructive: false,
  };
}
