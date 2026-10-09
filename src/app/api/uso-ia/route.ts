import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { serverError } from "@/lib/api";
import { estimateCost } from "@/lib/ai-cost";
import { roundCost, summarizeByFeature } from "@/lib/ai-usage-report";

export const dynamic = "force-dynamic";

/** Janela do relatorio, em dias. */
const DAYS = 30;

/** Janela do resumo por funcao, com a taxa de sucesso (US-141). */
const FEATURE_DAYS = 7;

interface DayTotal {
  day: string;
  feature: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
}

/**
 * Uso e custo estimado da IA por dia e por funcionalidade (US-124).
 *
 * Para o mantenedor, nao para o leitor: protegida por `AI_USAGE_SECRET`, no
 * mesmo padrao das rotas do cron. Sem o segredo configurado, responde 401.
 * A soma e feita no banco; o custo e calculado aqui por modelo, porque o
 * preco muda com o modelo que respondeu.
 *
 * `features` (US-141) resume os ultimos 7 dias por funcao: total de chamadas,
 * resultado de cada uma, taxa de sucesso em porcentagem e custo.
 */
export async function GET(request: Request) {
  const secret = process.env.AI_USAGE_SECRET;
  const authorization = request.headers.get("authorization");
  if (!secret || authorization !== `Bearer ${secret}`) {
    return new NextResponse(null, { status: 401 });
  }

  try {
    const result = await db.execute<{
      day: string;
      feature: string;
      model: string;
      batch: boolean;
      calls: string;
      input: string;
      output: string;
      cache_read: string;
      cache_write: string;
    }>(sql`
      select to_char(date_trunc('day', created_at at time zone 'UTC'), 'YYYY-MM-DD') as day,
             feature, model, batch,
             count(*) as calls,
             sum(input_tokens) as input, sum(output_tokens) as output,
             sum(cache_read_tokens) as cache_read, sum(cache_write_tokens) as cache_write
        from ai_usage
       where created_at >= now() - make_interval(days => ${DAYS})
       group by 1, 2, 3, 4
       order by 1 desc, 2`);

    const totals = new Map<string, DayTotal>();
    for (const row of result.rows) {
      const key = `${row.day}|${row.feature}`;
      const counts = {
        inputTokens: Number(row.input),
        outputTokens: Number(row.output),
        cacheReadTokens: Number(row.cache_read),
        cacheWriteTokens: Number(row.cache_write),
      };
      const entry = totals.get(key) ?? {
        day: row.day,
        feature: row.feature,
        calls: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd: 0,
      };
      entry.calls += Number(row.calls);
      entry.inputTokens += counts.inputTokens;
      entry.outputTokens += counts.outputTokens;
      entry.cacheReadTokens += counts.cacheReadTokens;
      entry.cacheWriteTokens += counts.cacheWriteTokens;
      entry.costUsd += estimateCost({ model: row.model, batch: row.batch, ...counts });
      totals.set(key, entry);
    }

    const days = [...totals.values()].map((entry) => ({
      ...entry,
      costUsd: roundCost(entry.costUsd),
    }));
    const costUsd = roundCost(days.reduce((sum, day) => sum + day.costUsd, 0));
    return NextResponse.json({
      days: DAYS,
      costUsd,
      entries: days,
      featureDays: FEATURE_DAYS,
      features: await featureReport(),
    });
  } catch (error) {
    return serverError("uso-ia", error);
  }
}

/** Ultimos 7 dias por funcao, com o resultado de cada chamada (US-141). */
async function featureReport() {
  const result = await db.execute<{
    feature: string;
    model: string;
    batch: boolean;
    outcome: string;
    calls: string;
    input: string;
    output: string;
    cache_read: string;
    cache_write: string;
  }>(sql`
    select feature, model, batch, outcome,
           count(*) as calls,
           sum(input_tokens) as input, sum(output_tokens) as output,
           sum(cache_read_tokens) as cache_read, sum(cache_write_tokens) as cache_write
      from ai_usage
     where created_at >= now() - make_interval(days => ${FEATURE_DAYS})
     group by 1, 2, 3, 4`);
  return summarizeByFeature(
    result.rows.map((row) => ({
      feature: row.feature,
      model: row.model,
      batch: row.batch,
      outcome: row.outcome,
      calls: Number(row.calls),
      inputTokens: Number(row.input),
      outputTokens: Number(row.output),
      cacheReadTokens: Number(row.cache_read),
      cacheWriteTokens: Number(row.cache_write),
    }))
  );
}
