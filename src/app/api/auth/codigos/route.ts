import { NextResponse } from "next/server";
import { jsonError, readJson, requireSession, serverError } from "@/lib/api";
import { getUserById, verifyPassword } from "@/lib/auth";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { issueRecoveryCodes, remainingRecoveryCodes } from "@/lib/recovery";

export const dynamic = "force-dynamic";

/** Quantos codigos de recuperacao ainda valem (US-96). */
export async function GET() {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    return NextResponse.json({ remaining: await remainingRecoveryCodes(session.id) });
  } catch (error) {
    return serverError("codigos/get", error);
  }
}

/**
 * Gera um conjunto novo de codigos e invalida o anterior.
 *
 * Pede a senha atual: com um cookie roubado, gerar codigos daria acesso
 * permanente a conta, mesmo depois de a pessoa trocar a senha.
 */
export async function POST(request: Request) {
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
    const password = typeof body?.password === "string" ? body.password : "";
    const user = await getUserById(session.id);
    if (!user) return jsonError("Sessao expirada. Entre novamente.", 401);
    if (!password || !(await verifyPassword(password, user.passwordHash))) {
      return jsonError("Senha incorreta.", 403);
    }

    const codes = await issueRecoveryCodes(session.id);
    return NextResponse.json({ codes }, { status: 201 });
  } catch (error) {
    return serverError("codigos/create", error);
  }
}
