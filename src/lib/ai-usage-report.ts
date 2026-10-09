import { estimateCost } from "@/lib/ai-cost";

/**
 * Contas do relatorio de uso da IA para o mantenedor (US-124, US-141).
 *
 * Funcoes puras: a consulta agrupa no banco por funcao, modelo, lote e
 * resultado, e aqui as linhas viram o total de cada funcao com a taxa de
 * sucesso e o custo estimado. Sem banco, a conta pode ser testada.
 */

/** Uma linha agrupada de `ai_usage`. */
export interface UsageGroup {
  feature: string;
  model: string;
  batch: boolean;
  /** sucesso, recusa, tempo ou falha. */
  outcome: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface FeatureReport {
  feature: string;
  calls: number;
  /** Chamadas por resultado; os quatro sempre presentes. */
  outcomes: { sucesso: number; recusa: number; tempo: number; falha: number };
  /** Porcentagem de sucesso, com uma casa decimal; 0 sem chamadas. */
  successRate: number;
  costUsd: number;
}

const OUTCOMES = ["sucesso", "recusa", "tempo", "falha"] as const;

/** Arredonda o custo a decimos de milesimo de dolar, como o resto do relatorio. */
export function roundCost(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

/** Porcentagem com uma casa decimal. */
export function successRate(successes: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((successes / total) * 1000) / 10;
}

/**
 * Total por funcao: chamadas, resultado de cada uma, taxa de sucesso e custo.
 * Resultado desconhecido (de uma versao futura) conta como falha, para a taxa
 * nunca parecer melhor do que e. Ordena da funcao mais chamada para a menos.
 */
export function summarizeByFeature(rows: UsageGroup[]): FeatureReport[] {
  const byFeature = new Map<string, FeatureReport & { rawCost: number }>();
  for (const row of rows) {
    const entry = byFeature.get(row.feature) ?? {
      feature: row.feature,
      calls: 0,
      outcomes: { sucesso: 0, recusa: 0, tempo: 0, falha: 0 },
      successRate: 0,
      costUsd: 0,
      rawCost: 0,
    };
    const outcome = (OUTCOMES as readonly string[]).includes(row.outcome)
      ? (row.outcome as (typeof OUTCOMES)[number])
      : "falha";
    entry.calls += row.calls;
    entry.outcomes[outcome] += row.calls;
    entry.rawCost += estimateCost({
      model: row.model,
      batch: row.batch,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      cacheReadTokens: row.cacheReadTokens,
      cacheWriteTokens: row.cacheWriteTokens,
    });
    byFeature.set(row.feature, entry);
  }

  return [...byFeature.values()]
    .map(({ rawCost, ...entry }) => ({
      ...entry,
      successRate: successRate(entry.outcomes.sucesso, entry.calls),
      costUsd: roundCost(rawCost),
    }))
    .sort((a, b) => b.calls - a.calls || a.feature.localeCompare(b.feature));
}
