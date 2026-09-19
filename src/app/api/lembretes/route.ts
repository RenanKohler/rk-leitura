import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { pushSubscriptions, speedSettings } from "@/db/schema";
import { jsonError, readJson, requireSession, serverError } from "@/lib/api";
import { loadSettings } from "@/lib/queries";
import { asReminderHour } from "@/lib/reminder";
import { pushConfigured } from "@/lib/push";

export const dynamic = "force-dynamic";

/** Estado do lembrete e a chave publica que o navegador precisa para inscrever. */
export async function GET() {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    const [settings, subscriptions] = await Promise.all([
      loadSettings(session.id),
      db
        .select({ endpoint: pushSubscriptions.endpoint })
        .from(pushSubscriptions)
        .where(eq(pushSubscriptions.userId, session.id)),
    ]);

    if (!settings) return jsonError("Sessao expirada. Entre novamente.", 401);

    return NextResponse.json({
      hour: settings.reminderHour,
      devices: subscriptions.length,
      publicKey: process.env.NEXT_PUBLIC_VAPID_KEY ?? null,
      available: pushConfigured(),
    });
  } catch (error) {
    return serverError("lembretes/get", error);
  }
}

/**
 * Guarda a inscricao deste navegador e a hora escolhida.
 *
 * A inscricao e por navegador e a hora e da conta: a mesma pessoa pode querer
 * o lembrete no celular e nao no computador, mas nao em dois horarios.
 */
export async function POST(request: Request) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    if (!pushConfigured()) {
      return jsonError("O lembrete nao esta configurado nesta instalacao.", 503);
    }

    const body = await readJson<{ hour?: unknown; subscription?: unknown }>(request);
    const hour = asReminderHour(body?.hour);
    if (hour === null) return jsonError("Escolha uma hora entre 0 e 23.", 400);

    const subscription = body?.subscription as
      | { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } }
      | undefined;

    const endpoint = typeof subscription?.endpoint === "string" ? subscription.endpoint : null;
    const p256dh = typeof subscription?.keys?.p256dh === "string" ? subscription.keys.p256dh : null;
    const auth = typeof subscription?.keys?.auth === "string" ? subscription.keys.auth : null;

    if (!endpoint || !p256dh || !auth) {
      return jsonError("A inscricao do navegador veio incompleta.", 400);
    }

    await db.transaction(async (tx) => {
      await tx
        .insert(pushSubscriptions)
        .values({ userId: session.id, endpoint, p256dh, auth })
        // O mesmo navegador pode renovar a inscricao; o endpoint e a identidade.
        .onConflictDoUpdate({
          target: pushSubscriptions.endpoint,
          set: { userId: session.id, p256dh, auth },
        });

      await tx
        .update(speedSettings)
        .set({ reminderHour: hour, updatedAt: new Date() })
        .where(eq(speedSettings.userId, session.id));
    });

    return NextResponse.json({ hour, ok: true }, { status: 201 });
  } catch (error) {
    return serverError("lembretes/post", error);
  }
}

/** Desliga o lembrete e esquece a inscricao deste navegador. */
export async function DELETE(request: Request) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    const endpoint = new URL(request.url).searchParams.get("endpoint");

    await db.transaction(async (tx) => {
      if (endpoint) {
        await tx
          .delete(pushSubscriptions)
          .where(
            and(
              eq(pushSubscriptions.userId, session.id),
              eq(pushSubscriptions.endpoint, endpoint)
            )
          );
      } else {
        await tx.delete(pushSubscriptions).where(eq(pushSubscriptions.userId, session.id));
      }

      await tx
        .update(speedSettings)
        .set({ reminderHour: null, updatedAt: new Date() })
        .where(eq(speedSettings.userId, session.id));
    });

    return NextResponse.json({ hour: null });
  } catch (error) {
    return serverError("lembretes/delete", error);
  }
}
