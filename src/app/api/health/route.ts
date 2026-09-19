import { sql } from "drizzle-orm";
import { db, resolveConnectionString } from "@/db";

export const dynamic = "force-dynamic";

/**
 * Diagnostico de ambiente.
 *
 * Reporta apenas a PRESENCA de cada configuracao, nunca o valor: e o
 * suficiente para descobrir o que falta em um deploy sem expor a connection
 * string ou a chave de sessao.
 */
export async function GET() {
  const config = {
    databaseUrl: hasValue(process.env.DATABASE_URL),
    jwtSecret: hasValue(process.env.JWT_SECRET),
  };

  try {
    await db.execute(sql`select 1`);
    return Response.json({ ok: true, database: "up", config });
  } catch (error) {
    console.error("[health]", error);
    return Response.json(
      {
        ok: false,
        database: "down",
        config,
        // Pistas sem valor sensivel: o codigo do erro e se a conexao aponta
        // para localhost (sintoma classico de .env de desenvolvimento em
        // producao).
        errorCode: errorCodeOf(error),
        pointsToLocalhost: pointsToLocalhost(),
      },
      { status: 503 }
    );
  }
}

function hasValue(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function errorCodeOf(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) return String(error.code);
  return error instanceof Error ? error.name : "desconhecido";
}

function pointsToLocalhost(): boolean | null {
  try {
    const host = new URL(resolveConnectionString()).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return null;
  }
}
