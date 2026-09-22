import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { asString, jsonError, readJson, requireSession, serverError } from "@/lib/api";
import {
  clearSession,
  createToken,
  getSession,
  getUserById,
  hashPassword,
  publicUser,
  sessionIsCurrent,
  setSessionCookie,
  verifyPassword,
} from "@/lib/auth";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const MIN_PASSWORD_LENGTH = 8;
const MAX_NAME_LENGTH = 80;

export async function GET() {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ user: null });

    // Revalida contra o banco: a conta pode ter sido apagada, ou a sessao
    // revogada por troca de senha, depois do token.
    const user = await getUserById(session.id);
    if (!user || !sessionIsCurrent(session, user.sessionVersion)) {
      return NextResponse.json({ user: null });
    }

    return NextResponse.json({ user: publicUser(user) });
  } catch (error) {
    console.error("[auth/me]", error);
    return NextResponse.json({ user: null });
  }
}

interface UpdateBody {
  name?: unknown;
  currentPassword?: unknown;
  newPassword?: unknown;
}

/**
 * Altera nome e senha.
 *
 * Os dois campos sao opcionais e independentes: da para mudar so o nome, so a
 * senha, ou os dois na mesma chamada. Trocar a senha exige a atual - sem isso
 * um cookie roubado bastaria para tomar a conta em definitivo.
 */
export async function PATCH(request: Request) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  // Mesmo balde do login: confirmar a senha atual aqui e um oraculo de senha
  // tao util a forca bruta quanto a tela de entrada.
  const limit = await rateLimit(`account:${clientIp(request)}`, 10, 15 * 60 * 1000);
  if (!limit.allowed) {
    return jsonError("Muitas tentativas. Aguarde alguns minutos.", 429, {
      retryAfter: limit.retryAfterSeconds,
    });
  }

  try {
    const body = await readJson<UpdateBody>(request);
    const name = asString(body?.name);
    const newPassword = typeof body?.newPassword === "string" ? body.newPassword : null;
    const currentPassword =
      typeof body?.currentPassword === "string" ? body.currentPassword : null;

    if (name === null && newPassword === null) {
      return jsonError("Informe um nome novo ou uma senha nova.", 400);
    }
    if (name !== null && name.length > MAX_NAME_LENGTH) {
      return jsonError("Nome muito longo.", 400);
    }
    if (newPassword !== null && newPassword.length < MIN_PASSWORD_LENGTH) {
      return jsonError(`A senha precisa ter ao menos ${MIN_PASSWORD_LENGTH} caracteres.`, 400);
    }

    const user = await getUserById(session.id);
    if (!user) return jsonError("Sessao expirada. Entre novamente.", 401);

    if (newPassword !== null) {
      if (!currentPassword || !(await verifyPassword(currentPassword, user.passwordHash))) {
        return jsonError("Senha atual incorreta.", 403);
      }
    }

    const [updated] = await db
      .update(users)
      .set({
        ...(name !== null ? { name } : {}),
        // Senha nova derruba as sessoes dos outros aparelhos: quem conhecia a
        // senha antiga perde o acesso agora, e nao quando o token expirar.
        ...(newPassword !== null
          ? {
              passwordHash: await hashPassword(newPassword),
              sessionVersion: sql`${users.sessionVersion} + 1`,
            }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(users.id, session.id))
      .returning({
        id: users.id,
        email: users.email,
        name: users.name,
        version: users.sessionVersion,
      });

    if (!updated) return jsonError("Sessao expirada. Entre novamente.", 401);

    // Reemitido sempre: o nome vive dentro do token, e a troca de senha muda a
    // versao - sem o token novo, este aparelho cairia junto com os outros.
    await setSessionCookie(await createToken(updated));

    return NextResponse.json({ user: publicUser(updated) });
  } catch (error) {
    return serverError("auth/update", error);
  }
}

/**
 * Apaga a conta e tudo que pende dela.
 *
 * Textos, sessoes de leitura e preferencias somem junto pela cascata do
 * schema, entao uma unica instrucao basta e nao ha estado parcial possivel.
 */
export async function DELETE(request: Request) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  const limit = await rateLimit(`account:${clientIp(request)}`, 10, 15 * 60 * 1000);
  if (!limit.allowed) {
    return jsonError("Muitas tentativas. Aguarde alguns minutos.", 429, {
      retryAfter: limit.retryAfterSeconds,
    });
  }

  try {
    const body = await readJson<{ password?: unknown }>(request);
    const password = typeof body?.password === "string" ? body.password : null;

    const user = await getUserById(session.id);
    if (!user) return jsonError("Sessao expirada. Entre novamente.", 401);

    // Acao irreversivel: a senha e a confirmacao de que quem pediu e o dono da
    // conta, e nao alguem com o aparelho destravado na mao.
    if (!password || !(await verifyPassword(password, user.passwordHash))) {
      return jsonError("Senha incorreta.", 403);
    }

    await db.delete(users).where(eq(users.id, session.id));
    await clearSession();

    return NextResponse.json({ deleted: true });
  } catch (error) {
    return serverError("auth/delete", error);
  }
}
