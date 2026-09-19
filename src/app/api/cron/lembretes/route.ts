import { NextResponse } from "next/server";
import { eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { pushSubscriptions, speedSettings } from "@/db/schema";
import { serverError } from "@/lib/api";
import { loadGoalStatus } from "@/lib/queries";
import { asTimezone, todayIn } from "@/lib/goals";
import { reminderBody, shouldRemind } from "@/lib/reminder";
import { pushConfigured, sendPush } from "@/lib/push";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Disparo do lembrete diario.
 *
 * Chamada pelo agendador da hospedagem. A regra e "ja passou da hora
 * escolhida, hoje, sem leitura": com ela, o lembrete sai no primeiro disparo
 * depois da hora, e a marca do dia garante que saia uma vez so. Isso mantem a
 * funcionalidade correta tanto num agendador que roda de hora em hora quanto
 * num que roda uma vez por dia.
 */
export async function GET(request: Request) {
  // O segredo separa o agendador de qualquer um que descubra a rota. Sem ele
  // configurado a rota nao responde, em vez de responder a todos.
  const secret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization");
  if (!secret || authorization !== `Bearer ${secret}`) {
    return new NextResponse(null, { status: 401 });
  }

  if (!pushConfigured()) {
    return NextResponse.json({ enviados: 0, motivo: "push nao configurado" });
  }

  try {
    const candidates = await db
      .select({
        userId: speedSettings.userId,
        reminderHour: speedSettings.reminderHour,
        timezone: speedSettings.timezone,
        reminderSentOn: speedSettings.reminderSentOn,
      })
      .from(speedSettings)
      .where(isNotNull(speedSettings.reminderHour));

    const now = new Date();
    let enviados = 0;
    let expiradas = 0;

    for (const candidate of candidates) {
      const timezone = asTimezone(candidate.timezone);
      const today = todayIn(timezone, now);

      // A meta traz junto a leitura do dia e a sequencia: uma consulta em vez
      // de tres, e ja no fuso certo.
      const goal = await loadGoalStatus(candidate.userId);
      const metGoal = goal.defined && !goal.pendingToday;
      const readToday = goal.defined && goal.progress > 0;

      const send = shouldRemind(
        {
          reminderHour: candidate.reminderHour,
          timezone,
          reminderSentOn: candidate.reminderSentOn,
          metGoal,
          readToday,
        },
        today,
        now
      );

      if (!send) continue;

      const targets = await db
        .select()
        .from(pushSubscriptions)
        .where(eq(pushSubscriptions.userId, candidate.userId));

      if (targets.length === 0) continue;

      const dead: string[] = [];
      let delivered = false;

      for (const target of targets) {
        const result = await sendPush(target, {
          title: "Leitura",
          body: reminderBody(goal.defined ? goal.streak : 0),
          url: "/dashboard",
        });

        if (result === "enviada") delivered = true;
        if (result === "expirada") dead.push(target.endpoint);
      }

      // Inscricao que o navegador descartou nao volta: apagar evita repetir a
      // mesma falha todo dia.
      if (dead.length > 0) {
        await db.delete(pushSubscriptions).where(inArray(pushSubscriptions.endpoint, dead));
        expiradas += dead.length;
      }

      if (delivered) {
        await db
          .update(speedSettings)
          .set({ reminderSentOn: today })
          .where(eq(speedSettings.userId, candidate.userId));
        enviados += 1;
      }
    }

    return NextResponse.json({ enviados, expiradas, candidatos: candidates.length });
  } catch (error) {
    return serverError("cron/lembretes", error);
  }
}
