import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import {
  loadGoalStatus,
  loadOverview,
  loadPace,
  loadSettings,
  loadTexts,
  loadWeeklySummary,
} from "@/lib/queries";
import { todayIn } from "@/lib/goals";
import { countDailyReview } from "@/lib/study-review-queries";
import { DashboardClient } from "./dashboard-client";

export const dynamic = "force-dynamic";

export const metadata = { title: "Início" };

const RECENT_LIMIT = 5;

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const settings = await loadSettings(session.id);
  if (!settings) redirect("/sair");

  const today = todayIn(settings.timezone);

  // Uma conta de revisao so (US-228): os destaques vencidos, que tinham
  // consulta e cartao proprios, ja estao dentro da revisao do dia.
  const [overview, { items, ...page }, goal, weekly, pace, daily] = await Promise.all([
    loadOverview(session.id),
    loadTexts(session.id, 1, RECENT_LIMIT),
    loadGoalStatus(session.id),
    loadWeeklySummary(session.id, settings.timezone, today, settings.weeklySummarySeenOn),
    loadPace(session.id),
    countDailyReview(session.id, settings.timezone, today),
  ]);

  return (
    <DashboardClient
      initialOverview={overview}
      initialTexts={{ texts: items, ...page }}
      goal={goal}
      weekly={weekly}
      offerPlacement={!settings.placementSeen}
      pace={pace}
      dailyReview={daily.total}
    />
  );
}
