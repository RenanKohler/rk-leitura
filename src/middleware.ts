import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifyToken } from "@/lib/session-token";

/**
 * Protecao de rotas no servidor.
 *
 * Antes a verificacao existia so no cliente (useEffect + router.push), o que
 * renderizava a tela protegida por um instante antes de redirecionar e nao
 * impedia nada de fato. O middleware decide antes de qualquer HTML sair.
 */

const PROTECTED_PREFIXES = [
  "/dashboard",
  "/textos",
  "/leitor",
  "/historico",
  "/ajustes",
  "/compartilhar",
  "/estatisticas",
];
const GUEST_ONLY = ["/login", "/cadastro"];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await verifyToken(token) : null;

  const isProtected = PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );

  if (isProtected && !session) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    // Preserva o destino para voltar depois do login, com a query junto: no
    // compartilhamento do sistema ela nao e detalhe, e o proprio conteudo -
    // perde-la significaria cair na biblioteca vazia em vez de importar.
    const target = `${pathname}${request.nextUrl.search}`;
    url.search = "";
    url.searchParams.set("next", target);
    return NextResponse.redirect(url);
  }

  if (session && (GUEST_ONLY.includes(pathname) || pathname === "/")) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }

  if (!session && pathname === "/") {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/",
    "/login",
    "/cadastro",
    "/dashboard/:path*",
    "/textos/:path*",
    "/leitor/:path*",
    "/historico/:path*",
    "/ajustes/:path*",
    "/compartilhar/:path*",
    "/estatisticas/:path*",
  ],
};
