import "server-only";

import { lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { rateLimits } from "@/db/schema";

/**
 * Limitador de taxa compartilhado entre instancias.
 *
 * Em funcoes serverless cada instancia mantinha a propria contagem em
 * memoria: dez tentativas espalhadas por dez instancias passavam como uma
 * cada, e o limite efetivo virava o limite vezes o numero de instancias. A
 * contagem agora vive no Postgres que a aplicacao ja usa, na mesma regiao.
 *
 * A funcao manteve nome, argumentos e formato do resultado; passou a ser
 * assincrona porque uma ida ao banco nao tem como ser sincrona.
 */

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

/** Decide a partir da contagem ja gravada. Pura, para poder ser testada. */
export function decide(
  count: number,
  limit: number,
  resetAt: Date,
  now = new Date()
): RateLimitResult {
  if (count <= limit) return { allowed: true, retryAfterSeconds: 0 };

  const remaining = Math.ceil((resetAt.getTime() - now.getTime()) / 1000);
  return { allowed: false, retryAfterSeconds: Math.max(1, remaining) };
}

/**
 * Uma em cada tantas chamadas aproveita para varrer o que expirou.
 *
 * Sem isso a tabela cresce com uma linha por chave usada desde sempre. Com
 * uma varredura ocasional ela fica do tamanho do trafego recente, e nenhuma
 * requisicao paga o custo da limpeza sozinha.
 */
const SWEEP_CHANCE = 0.01;

export async function rateLimit(
  key: string,
  limit: number,
  windowMs: number
): Promise<RateLimitResult> {
  try {
    // Um comando so, atomico: duas instancias contando ao mesmo tempo somam
    // em vez de sobrescrever uma a outra. A janela reinicia quando ja venceu.
    const [row] = await db
      .insert(rateLimits)
      .values({
        key,
        count: 1,
        resetAt: new Date(Date.now() + windowMs),
      })
      .onConflictDoUpdate({
        target: rateLimits.key,
        set: {
          count: sql`case when ${rateLimits.resetAt} <= now() then 1 else ${rateLimits.count} + 1 end`,
          resetAt: sql`case when ${rateLimits.resetAt} <= now() then excluded.reset_at else ${rateLimits.resetAt} end`,
        },
      })
      .returning({ count: rateLimits.count, resetAt: rateLimits.resetAt });

    if (Math.random() < SWEEP_CHANCE) void sweep();

    if (!row) return { allowed: true, retryAfterSeconds: 0 };
    return decide(row.count, limit, row.resetAt);
  } catch (error) {
    // Politica na indisponibilidade: liberar, com a falha registrada. Bloquear
    // deixaria ninguem entrar quando o banco oscilasse - e sem banco a
    // aplicacao ja nao responde de qualquer forma.
    console.error("[rate-limit] armazenamento indisponivel, liberando:", error);
    return { allowed: true, retryAfterSeconds: 0 };
  }
}

/** Apaga as janelas ja vencidas. */
async function sweep(): Promise<void> {
  try {
    await db.delete(rateLimits).where(lt(rateLimits.resetAt, new Date()));
  } catch {
    // Limpeza e higiene, nao requisito: falhar aqui nao muda nenhuma decisao.
  }
}

/**
 * IP do cliente. Em producao atras de proxy (Vercel) vem no x-forwarded-for.
 */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return request.headers.get("x-real-ip") ?? "desconhecido";
}
