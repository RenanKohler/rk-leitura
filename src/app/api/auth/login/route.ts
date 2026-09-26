import { NextResponse } from "next/server";
import { authenticateUser, openSession } from "@/lib/auth";
import { asString, jsonError, readJson, serverError } from "@/lib/api";
import { clientIp, rateLimit } from "@/lib/rate-limit";

interface Body {
  email?: unknown;
  password?: unknown;
}

export async function POST(request: Request) {
  const limit = await rateLimit(`login:${clientIp(request)}`, 10, 15 * 60 * 1000);
  if (!limit.allowed) {
    return jsonError("Muitas tentativas de login. Aguarde alguns minutos.", 429, {
      retryAfter: limit.retryAfterSeconds,
    });
  }

  try {
    const body = await readJson<Body>(request);
    const email = asString(body?.email);
    const password = typeof body?.password === "string" ? body.password : null;

    if (!email || !password) {
      return jsonError("Informe e-mail e senha.", 400);
    }

    const user = await authenticateUser(email, password);
    if (!user) {
      // Mesma mensagem para e-mail inexistente e senha errada.
      return jsonError("E-mail ou senha incorretos.", 401);
    }

    await openSession(
      { id: user.id, email: user.email, name: user.name, version: user.sessionVersion },
      request
    );

    return NextResponse.json({ user: { id: user.id, email: user.email, name: user.name } });
  } catch (error) {
    return serverError("auth/login", error);
  }
}
