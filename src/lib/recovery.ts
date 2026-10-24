import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { recoveryCodes } from "@/db/schema";
import { jwtSecret } from "@/lib/env";
import {
  generateRecoveryCode,
  normalizeRecoveryCode,
  RECOVERY_CODE_COUNT,
} from "@/lib/account-security";

/**
 * Tempero dos codigos (US-191): `RECOVERY_PEPPER` quando definido, senao o
 * `JWT_SECRET`, como antes. Separado do segredo das sessoes, trocar o
 * `JWT_SECRET` derruba as sessoes sem invalidar os codigos de recuperacao.
 */
export function recoveryPepper(): string {
  const pepper = process.env.RECOVERY_PEPPER?.trim();
  return pepper || new TextDecoder().decode(jwtSecret());
}

/**
 * Hash do codigo com o tempero.
 *
 * SHA-256 e nao bcrypt: o codigo tem ~49 bits de entropia, entao o custo
 * lento nao acrescenta protecao real, e o tempero impede que um vazamento so
 * do banco permita testar codigos fora do app.
 */
export function hashRecoveryCode(normalized: string, pepper = recoveryPepper()): string {
  return createHash("sha256").update(normalized).update(":").update(pepper).digest("hex");
}

/**
 * Hashes aceitos para um codigo: o do tempero atual e, na transicao para o
 * `RECOVERY_PEPPER`, o do `JWT_SECRET` com que os codigos antigos foram
 * gravados. Depois da proxima troca de codigos so o primeiro existe no banco.
 */
export function recoveryHashCandidates(normalized: string): string[] {
  const current = hashRecoveryCode(normalized);
  const secret = process.env.JWT_SECRET?.trim();
  const legacy = secret ? hashRecoveryCode(normalized, secret) : current;
  return legacy === current ? [current] : [current, legacy];
}

/** Gera um conjunto novo, apagando o anterior. Devolve os codigos em claro. */
export async function issueRecoveryCodes(userId: string): Promise<string[]> {
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, () =>
    generateRecoveryCode((size) => new Uint8Array(randomBytes(size)))
  );

  await db.transaction(async (tx) => {
    await tx.delete(recoveryCodes).where(eq(recoveryCodes.userId, userId));
    await tx.insert(recoveryCodes).values(
      codes.map((code) => ({ userId, codeHash: hashRecoveryCode(normalizeRecoveryCode(code)!) }))
    );
  });

  return codes;
}

/** Quantos codigos ainda nao usados a conta tem. */
export async function remainingRecoveryCodes(userId: string): Promise<number> {
  const rows = await db
    .select({ id: recoveryCodes.id })
    .from(recoveryCodes)
    .where(and(eq(recoveryCodes.userId, userId), isNull(recoveryCodes.usedAt)));
  return rows.length;
}
