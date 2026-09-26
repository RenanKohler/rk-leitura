import { SignJWT, jwtVerify } from "jose";
import { jwtSecret } from "@/lib/env";

/**
 * Assinatura/verificacao do token de sessao, isolado do resto do modulo de
 * auth para poder ser importado pelo middleware (runtime Edge), onde bcrypt,
 * drizzle e pg nao rodam.
 */

export const SESSION_COOKIE = "session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  /**
   * Versao da sessao gravada no token. Comparada com `users.session_version`
   * fora do Edge; tokens emitidos antes da coluna existir valem como 0.
   */
  version: number;
  /**
   * Linha de `auth_sessions` deste aparelho (US-97). Nulo em tokens emitidos
   * antes da tabela: valem ate expirar e nao aparecem na lista de aparelhos.
   */
  sid: string | null;
}

/** O que se passa para emitir um token; o `sid` e opcional. */
export type TokenInput = Omit<SessionUser, "sid"> & { sid?: string | null };

export function createToken(user: TokenInput): Promise<string> {
  return new SignJWT({
    email: user.email,
    name: user.name,
    sv: user.version,
    ...(user.sid ? { sid: user.sid } : {}),
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE_SECONDS}s`)
    .sign(jwtSecret());
}

export async function verifyToken(token: string): Promise<SessionUser | null> {
  try {
    const { payload } = await jwtVerify(token, jwtSecret());
    if (!payload.sub || typeof payload.email !== "string" || typeof payload.name !== "string") {
      return null;
    }
    const version = typeof payload.sv === "number" && Number.isInteger(payload.sv) ? payload.sv : 0;
    const sid = typeof payload.sid === "string" ? payload.sid : null;
    return { id: payload.sub, email: payload.email, name: payload.name, version, sid };
  } catch {
    return null;
  }
}
