import { NextResponse } from "next/server";
import { jsonError, requireSession, serverError } from "@/lib/api";
import { revokeSessions } from "@/lib/auth";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Params = { params: Promise<{ deviceId: string }> };

/**
 * Desconecta um aparelho (US-97). A proxima requisicao dele recebe 401.
 * O aparelho atual sai por "Sair", que tambem apaga o cookie daqui.
 */
export async function DELETE(_request: Request, { params }: Params) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    const { deviceId } = await params;
    if (!UUID_PATTERN.test(deviceId)) return jsonError("Aparelho nao encontrado.", 404);
    if (deviceId === session.sid) {
      return jsonError("Para desconectar este aparelho, use Sair.", 400);
    }

    const revoked = await revokeSessions(session.id, deviceId);
    if (revoked.length === 0) return jsonError("Aparelho nao encontrado.", 404);
    return NextResponse.json({ success: true });
  } catch (error) {
    return serverError("aparelhos/delete", error);
  }
}
