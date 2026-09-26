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
 * Hash do codigo com o segredo do app como tempero.
 *
 * SHA-256 e nao bcrypt: o codigo tem ~49 bits de entropia, entao o custo
 * lento nao acrescenta protecao real, e o tempero impede que um vazamento so
 * do banco permita testar codigos fora do app.
 */
export function hashRecoveryCode(normalized: string): string {
  return createHash("sha256")
    .update(normalized)
    .update(":")
    .update(new TextDecoder().decode(jwtSecret()))
    .digest("hex");
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
