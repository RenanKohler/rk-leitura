import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import {
  loadGoalStatus,
  loadOverview,
  loadSettings,
  loadTexts,
  loadWeeklySummary,
} from "@/lib/queries";
import { todayIn } from "@/lib/goals";
import { DashboardClient } from "./dashboard-client";

export const dynamic = "force-dynamic";

const RECENT_LIMIT = 5;

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const settings = await loadSettings(session.id);
  if (!settings) redirect("/sair");

  const today = todayIn(settings.timezone);

  const [overview, { items, ...page }, goal, weekly] = await Promise.all([
    loadOverview(session.id),
    loadTexts(session.id, 1, RECENT_LIMIT),
    loadGoalStatus(session.id),
    loadWeeklySummary(session.id, settings.timezone, today, settings.weeklySummarySeenOn),
  ]);

  return (
    <DashboardClient
      initialOverview={overview}
      initialTexts={{ texts: items, ...page }}
      goal={goal}
      weekly={weekly}
      offerPlacement={!settings.placementSeen}
    />
  );
}
