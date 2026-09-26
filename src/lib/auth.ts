import "server-only";

import { cookies } from "next/headers";
import { compare, hash } from "bcryptjs";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { authSessions, users } from "@/db/schema";
import { isProduction } from "@/lib/env";
import {
  createToken,
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

/** Intervalo minimo entre duas gravacoes do ultimo acesso de um aparelho. */
const LAST_SEEN_STEP_MS = 60 * 60 * 1000;

/**
 * Versao atual das sessoes da conta, ou null quando a conta nao existe mais
 * ou quando este aparelho foi desconectado (US-97).
 *
 * Uma consulta so, com a linha do aparelho junto: e a que toda rota
 * autenticada faz. O ultimo acesso e gravado de carona, no maximo uma vez
 * por hora, sem esperar a escrita.
 */
export async function currentSessionVersion(id: string, sid: string | null = null): Promise<number | null> {
  const [row] = await db
    .select({
      version: users.sessionVersion,
      deviceId: authSessions.id,
      revokedAt: authSessions.revokedAt,
      lastSeenAt: authSessions.lastSeenAt,
    })
    .from(users)
    .leftJoin(
      authSessions,
      and(eq(authSessions.id, sid ?? "00000000-0000-0000-0000-000000000000"), eq(authSessions.userId, users.id))
    )
    .where(eq(users.id, id))
    .limit(1);

  if (!row) return null;
  if (sid) {
    if (!row.deviceId || row.revokedAt) return null;
    if (row.lastSeenAt && Date.now() - row.lastSeenAt.getTime() > LAST_SEEN_STEP_MS) {
      void db
        .update(authSessions)
        .set({ lastSeenAt: new Date() })
        .where(eq(authSessions.id, sid))
        .catch(() => undefined);
    }
  }
  return row.version;
}

/** O token ainda vale: a conta existe e nenhuma troca de senha o revogou. */
export function sessionIsCurrent(session: SessionUser, version: number | null): boolean {
  return version !== null && version === session.version;
}

/**
 * Abre a sessao deste aparelho: grava a linha dele e o cookie com o id.
 *
 * `sid` reaproveita a linha existente - e o caso de reemitir o token depois
 * de trocar nome ou senha, em que o aparelho continua o mesmo.
 */
export async function openSession(
  user: { id: string; email: string; name: string; version: number },
  request: Request | null,
  sid: string | null = null
): Promise<void> {
  let id = sid;
  if (!id) {
    const userAgent = request?.headers.get("user-agent")?.slice(0, 300) ?? null;
    const [row] = await db
      .insert(authSessions)
      .values({ userId: user.id, userAgent })
      .returning({ id: authSessions.id });
    id = row?.id ?? null;
  }
  await setSessionCookie(await createToken({ ...user, sid: id }));
}

/** Desconecta aparelhos da conta; sem `sid`, todos. */
export async function revokeSessions(userId: string, sid?: string, except?: string | null) {
  const conditions = [eq(authSessions.userId, userId), isNull(authSessions.revokedAt)];
  if (sid) conditions.push(eq(authSessions.id, sid));
  if (except) conditions.push(sql`${authSessions.id} <> ${except}`);
  return db
    .update(authSessions)
    .set({ revokedAt: new Date() })
    .where(and(...conditions))
    .returning({ id: authSessions.id });
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
