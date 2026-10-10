import { NextResponse } from "next/server";
import { eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { pushSubscriptions, speedSettings } from "@/db/schema";
import { serverError } from "@/lib/api";
import { upsertSettings } from "@/lib/settings-row";
import { loadGoalStatus } from "@/lib/queries";
import { asTimezone, todayIn } from "@/lib/goals";
import {
  hourIn,
  reminderBody,
  REVIEW_REMINDER_MIN_DUE,
  reviewReminderBody,
  shouldRemind,
  shouldRemindReview,
} from "@/lib/reminder";
import { countDailyReview, reviewedToday } from "@/lib/study-review-queries";
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
 *
 * O lembrete de revisao (US-163) sai no mesmo disparo, pela mesma inscricao,
 * com a propria marca do dia: so com 5 ou mais itens vencidos e sem revisao
 * feita hoje.
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
    return NextResponse.json({ enviados: 0, motivo: "push não configurado" });
  }

  try {
    const candidates = await db
      .select({
        userId: speedSettings.userId,
        reminderHour: speedSettings.reminderHour,
        timezone: speedSettings.timezone,
        reminderSentOn: speedSettings.reminderSentOn,
        reviewReminder: speedSettings.reviewReminder,
        reviewReminderSentOn: speedSettings.reviewReminderSentOn,
      })
      .from(speedSettings)
      .where(isNotNull(speedSettings.reminderHour));

    const now = new Date();
    let enviados = 0;
    let expiradas = 0;
    let revisoes = 0;

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

      // As filas da revisao so sao contadas quando o resto da regra ja
      // permite: a contagem le palavras, destaques, cartoes e questionarios.
      let reviewDue = 0;
      let sendReview = false;
      if (
        candidate.reviewReminder &&
        candidate.reviewReminderSentOn !== today &&
        candidate.reminderHour !== null &&
        hourIn(timezone, now) >= candidate.reminderHour
      ) {
        reviewDue = (await countDailyReview(candidate.userId, timezone, today)).total;
        sendReview =
          reviewDue >= REVIEW_REMINDER_MIN_DUE &&
          shouldRemindReview(
            {
              reviewReminder: candidate.reviewReminder,
              reminderHour: candidate.reminderHour,
              timezone,
              reviewReminderSentOn: candidate.reviewReminderSentOn,
              due: reviewDue,
              reviewedToday: await reviewedToday(candidate.userId, timezone, today),
            },
            today,
            now
          );
      }

      if (!send && !sendReview) continue;

      const targets = await db
        .select()
        .from(pushSubscriptions)
        .where(eq(pushSubscriptions.userId, candidate.userId));

      if (targets.length === 0) continue;

      const dead = new Set<string>();
      let delivered = false;
      let deliveredReview = false;

      for (const target of targets) {
        if (send) {
          const result = await sendPush(target, {
            title: "Leitura",
            body: reminderBody(goal.defined ? goal.streak : 0),
            url: "/dashboard",
          });
          if (result === "enviada") delivered = true;
          if (result === "expirada") dead.add(target.endpoint);
        }
        if (sendReview && !dead.has(target.endpoint)) {
          const result = await sendPush(target, {
            title: "Revisão",
            body: reviewReminderBody(reviewDue),
            url: "/revisar",
          });
          if (result === "enviada") deliveredReview = true;
          if (result === "expirada") dead.add(target.endpoint);
        }
      }

      // Inscricao que o navegador descartou nao volta: apagar evita repetir a
      // mesma falha todo dia.
      if (dead.size > 0) {
        await db.delete(pushSubscriptions).where(inArray(pushSubscriptions.endpoint, [...dead]));
        expiradas += dead.size;
      }

      // Cada lembrete tem a propria marca do dia: um nao impede o outro.
      if (delivered || deliveredReview) {
        await upsertSettings(db, candidate.userId, {
          ...(delivered ? { reminderSentOn: today } : {}),
          ...(deliveredReview ? { reviewReminderSentOn: today } : {}),
        });
      }
      if (delivered) enviados += 1;
      if (deliveredReview) revisoes += 1;
    }

    return NextResponse.json({ enviados, revisoes, expiradas, candidatos: candidates.length });
  } catch (error) {
    return serverError("cron/lembretes", error);
  }
}
