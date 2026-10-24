import "server-only";

import { cookies } from "next/headers";
import { compare, hash } from "bcryptjs";
import { and, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { authSessions, pushSubscriptions, speedSettings, texts, users } from "@/db/schema";
import { countWords } from "@/lib/reading";
import { DEFAULT_LANGUAGE } from "@/lib/language";
import { NEW_ROW_DEFAULTS, upsertSettings } from "@/lib/settings-row";
import { WELCOME_CONTENT, WELCOME_TITLE } from "@/lib/welcome";
import { isProduction } from "@/lib/env";
import { sessionPruneCutoffs } from "@/lib/account-security";
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
  if (id) {
    // Token novo para o mesmo aparelho: mais 7 dias na lista (US-188).
    const now = new Date();
    await db.update(authSessions).set({ issuedAt: now, lastSeenAt: now }).where(eq(authSessions.id, id));
  } else {
    const userAgent = request?.headers.get("user-agent")?.slice(0, 300) ?? null;
    const [row] = await db
      .insert(authSessions)
      .values({ userId: user.id, userAgent })
      .returning({ id: authSessions.id });
    id = row?.id ?? null;
  }
  await setSessionCookie(await createToken({ ...user, sid: id }));
}

/**
 * Desconecta aparelhos da conta; sem `sid`, todos.
 *
 * As inscricoes de notificacao feitas por esses aparelhos saem junto
 * (US-183): um navegador desconectado nao pode continuar recebendo titulos
 * dos textos da conta.
 */
export async function revokeSessions(userId: string, sid?: string, except?: string | null) {
  const conditions = [eq(authSessions.userId, userId), isNull(authSessions.revokedAt)];
  if (sid) conditions.push(eq(authSessions.id, sid));
  if (except) conditions.push(sql`${authSessions.id} <> ${except}`);
  const revoked = await db
    .update(authSessions)
    .set({ revokedAt: new Date() })
    .where(and(...conditions))
    .returning({ id: authSessions.id });
  if (revoked.length > 0) {
    await db.delete(pushSubscriptions).where(
      and(
        eq(pushSubscriptions.userId, userId),
        inArray(
          pushSubscriptions.sessionId,
          revoked.map((row) => row.id)
        )
      )
    );
  }
  return revoked;
}

/**
 * Apaga todas as inscricoes de notificacao da conta e desliga o horario
 * (US-183). Usado por "Sair de todos os aparelhos" e pela troca de senha:
 * inscricoes antigas, sem aparelho gravado, tambem saem. O aparelho atual
 * volta a escolher o horario em Ajustes.
 */
export async function forgetAllPushSubscriptions(userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
    await upsertSettings(tx, userId, { reminderHour: null });
  });
}

/**
 * Apaga as linhas de aparelho revogadas ou com token vencido ha mais de 30
 * dias (US-188), pelo cron de acompanhamento. Devolve quantas saiu.
 */
export async function pruneAuthSessions(now: Date): Promise<number> {
  const { revokedBefore, issuedBefore } = sessionPruneCutoffs(now, SESSION_MAX_AGE_SECONDS);
  const result = await db
    .delete(authSessions)
    .where(or(lt(authSessions.revokedAt, revokedBefore), lt(authSessions.issuedAt, issuedBefore)));
  return result.rowCount ?? 0;
}

/** Os dados da sessao que podem ir para o cliente. */
export function publicUser(user: { id: string; email: string; name: string }) {
  return { id: user.id, email: user.email, name: user.name };
}

export async function getUserById(id: string) {
  const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return user ?? null;
}

/**
 * Cria a conta ja com a linha de preferencias e o texto de boas-vindas.
 *
 * Tudo na mesma transacao: uma conta sem a linha de `speed_settings` lia o
 * padrao, mas qualquer escrita parcial nela (o teste de nivelamento, o
 * treino) atualizava zero linhas sem erro. E a biblioteca vazia deixava a
 * pessoa sem ter o que abrir para conhecer o leitor.
 */
export async function createUser(email: string, password: string, name: string) {
  const passwordHash = await hashPassword(password);

  return db.transaction(async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({ email: normalizeEmail(email), passwordHash, name: name.trim() })
      .returning();

    await tx.insert(speedSettings).values({ userId: user!.id, ...NEW_ROW_DEFAULTS });
    await tx.insert(texts).values({
      userId: user!.id,
      title: WELCOME_TITLE,
      content: WELCOME_CONTENT,
      format: "plain",
      // A mesma contagem da rota de criacao: e ela que decide o fim do texto.
      wordCount: countWords(WELCOME_CONTENT, "plain"),
      language: DEFAULT_LANGUAGE,
    });

    return user!;
  });
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
