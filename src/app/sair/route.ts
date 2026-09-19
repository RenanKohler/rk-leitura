import { NextResponse } from "next/server";
import { clearSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Encerra a sessao e volta ao login.
 *
 * Existe por um motivo estreito: um componente de servidor nao pode apagar
 * cookie durante a renderizacao, entao o layout autenticado, ao descobrir que
 * a conta nao existe mais, precisa de um lugar para onde redirecionar. Sem
 * isso o redirecionamento entraria em laco - o middleware manda quem tem token
 * valido de volta para o painel.
 *
 * Metodo GET porque o destino e uma navegacao. O unico efeito possivel de
 * alguem disparar isto de fora e encerrar a propria sessao de quem clicou, o
 * que e o que a rota faz de qualquer forma.
 */
export async function GET() {
  await clearSession();

  // Destino relativo em vez de `NextResponse.redirect`, que exige endereco
  // absoluto e obrigaria a remontar o host a partir da requisicao - atras de
  // um proxy isso manda o usuario para o host errado.
  return new NextResponse(null, { status: 307, headers: { Location: "/login" } });
}
