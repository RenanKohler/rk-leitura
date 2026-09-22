import "server-only";

import { cookies } from "next/headers";
import { compare, hash } from "bcryptjs";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { isProduction } from "@/lib/env";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  verifyToken,
  type SessionUser,
} from "@/lib/session-token";

export { createToken, SESSION_COOKIE, type SessionUser } from "@/lib/session-token";

const BCRYPT_ROUNDS = 12;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function hashPassword(password: string): Promise<string> {
  // Versao assincrona: hashSync bloqueia o event loop por ~250ms por chamada.
  return hash(password, BCRYPT_ROUNDS);
}

export function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  return compare(password, passwordHash);
}

export async function getSession(): Promise<SessionUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifyToken(token);
}

export async function setSessionCookie(token: string): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isProduction(),
    sameSite: "lax",
    maxAge: SESSION_MAX_AGE_SECONDS,
    path: "/",
  });
}

export async function clearSession(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}

export async function findUserByEmail(email: string) {
  const [user] = await db
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = ${normalizeEmail(email)}`)
    .limit(1);
  return user ?? null;
}

/**
 * Versao atual das sessoes da conta, ou null quando a conta nao existe mais.
 * So uma coluna: e a consulta que toda rota autenticada faz.
 */
export async function currentSessionVersion(id: string): Promise<number | null> {
  const [row] = await db
    .select({ version: users.sessionVersion })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);
  return row?.version ?? null;
}

/** O token ainda vale: a conta existe e nenhuma troca de senha o revogou. */
export function sessionIsCurrent(session: SessionUser, version: number | null): boolean {
  return version !== null && version === session.version;
}

/** Os dados da sessao que podem ir para o cliente. */
export function publicUser(user: { id: string; email: string; name: string }) {
  return { id: user.id, email: user.email, name: user.name };
}

export async function getUserById(id: string) {
  const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return user ?? null;
}

export async function createUser(email: string, password: string, name: string) {
  const [user] = await db
    .insert(users)
    .values({
      email: normalizeEmail(email),
      passwordHash: await hashPassword(password),
      name: name.trim(),
    })
    .returning();
  return user;
}

export async function authenticateUser(email: string, password: string) {
  const user = await findUserByEmail(email);
  if (!user) {
    // Compara mesmo sem usuario para que o tempo de resposta nao revele se o
    // e-mail existe (enumeracao de contas por timing).
    await compare(password, "$2b$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinva");
    return null;
  }
  return (await verifyPassword(password, user.passwordHash)) ? user : null;
}
