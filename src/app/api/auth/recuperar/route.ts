import { NextResponse } from "next/server";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { recoveryCodes, users } from "@/db/schema";
import { asString, jsonError, readJson, serverError } from "@/lib/api";
import { findUserByEmail, hashPassword, normalizeEmail, openSession, revokeSessions } from "@/lib/auth";
import { normalizeRecoveryCode } from "@/lib/account-security";
import { hashRecoveryCode } from "@/lib/recovery";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const MIN_PASSWORD_LENGTH = 8;
const INVALID = "Codigo invalido.";

/**
 * Redefine a senha com um codigo de recuperacao (US-96).
 *
 * A resposta de erro e a mesma para e-mail inexistente, codigo errado e
 * codigo ja usado: nada aqui pode confirmar que uma conta existe. Dois
 * limites: por IP, contra varredura, e por e-mail, contra a adivinhacao dos
 * codigos de uma conta a partir de varios IPs.
 */
export async function POST(request: Request) {
  const byIp = await rateLimit(`recuperar:${clientIp(request)}`, 10, 15 * 60 * 1000);
  if (!byIp.allowed) {
    return jsonError("Muitas tentativas. Aguarde alguns minutos.", 429, {
      retryAfter: byIp.retryAfterSeconds,
    });
  }

  try {
    const body = await readJson<{ email?: unknown; code?: unknown; newPassword?: unknown }>(request);
    const email = asString(body?.email);
    const code = normalizeRecoveryCode(body?.code);
    const newPassword = typeof body?.newPassword === "string" ? body.newPassword : "";

    if (!email) return jsonError("Informe o e-mail.", 400);
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      return jsonError(`A senha precisa ter ao menos ${MIN_PASSWORD_LENGTH} caracteres.`, 400);
    }

    const byEmail = await rateLimit(`recuperar:${normalizeEmail(email)}`, 5, 15 * 60 * 1000);
    if (!byEmail.allowed) {
      return jsonError("Muitas tentativas. Aguarde alguns minutos.", 429, {
        retryAfter: byEmail.retryAfterSeconds,
      });
    }

    const user = await findUserByEmail(email);
    if (!user || !code) return jsonError(INVALID, 400);

    const passwordHash = await hashPassword(newPassword);
    const updated = await db.transaction(async (tx) => {
      // Consumir e condicional: duas tentativas simultaneas com o mesmo
      // codigo, so uma encontra `used_at` nulo.
      const [used] = await tx
        .update(recoveryCodes)
        .set({ usedAt: new Date() })
        .where(
          and(
            eq(recoveryCodes.userId, user.id),
            eq(recoveryCodes.codeHash, hashRecoveryCode(code)),
            isNull(recoveryCodes.usedAt)
          )
        )
        .returning({ id: recoveryCodes.id });
      if (!used) return null;

      const [row] = await tx
        .update(users)
        .set({
          passwordHash,
          sessionVersion: sql`${users.sessionVersion} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(users.id, user.id))
        .returning({
          id: users.id,
          email: users.email,
          name: users.name,
          version: users.sessionVersion,
        });
      return row ?? null;
    });

    if (!updated) return jsonError(INVALID, 400);

    // Senha nova derruba todos os aparelhos (US-62) e este entra de novo.
    await revokeSessions(updated.id);
    await openSession(updated, request);

    return NextResponse.json({
      user: { id: updated.id, email: updated.email, name: updated.name },
    });
  } catch (error) {
    return serverError("auth/recuperar", error);
  }
}
