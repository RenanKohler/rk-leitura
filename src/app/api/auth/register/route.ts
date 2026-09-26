import { NextResponse } from "next/server";
import { createUser, findUserByEmail, openSession } from "@/lib/auth";
import { asString, jsonError, readJson, serverError } from "@/lib/api";
import { clientIp, rateLimit } from "@/lib/rate-limit";

interface Body {
  email?: unknown;
  password?: unknown;
  name?: unknown;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

export async function POST(request: Request) {
  const limit = await rateLimit(`register:${clientIp(request)}`, 5, 60 * 60 * 1000);
  if (!limit.allowed) {
    return jsonError("Muitas tentativas. Tente novamente mais tarde.", 429, {
      retryAfter: limit.retryAfterSeconds,
    });
  }

  try {
    const body = await readJson<Body>(request);
    const email = asString(body?.email);
    const password = typeof body?.password === "string" ? body.password : null;
    const name = asString(body?.name);

    if (!email || !password || !name) {
      return jsonError("Preencha nome, e-mail e senha.", 400);
    }
    if (!EMAIL_PATTERN.test(email)) {
      return jsonError("E-mail invalido.", 400);
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      return jsonError(`A senha precisa ter ao menos ${MIN_PASSWORD_LENGTH} caracteres.`, 400);
    }
    if (name.length > 80) {
      return jsonError("Nome muito longo.", 400);
    }

    // Consulta direta ao banco. A versao anterior fazia um fetch HTTP para a
    // propria API usando NEXT_PUBLIC_BASE_URL, o que dependia dessa variavel
    // estar correta em producao e adicionava uma ida e volta de rede.
    if (await findUserByEmail(email)) {
      return jsonError("Esse e-mail ja esta cadastrado.", 409);
    }

    const user = await createUser(email, password, name);
    await openSession(
      { id: user.id, email: user.email, name: user.name, version: user.sessionVersion },
      request
    );

    return NextResponse.json({ user: { id: user.id, email: user.email, name: user.name } });
  } catch (error) {
    // Corrida entre duas requisicoes com o mesmo e-mail: o indice unico decide.
    if (error instanceof Error && error.message.includes("users_email_unique")) {
      return jsonError("Esse e-mail ja esta cadastrado.", 409);
    }
    return serverError("auth/register", error);
  }
}
