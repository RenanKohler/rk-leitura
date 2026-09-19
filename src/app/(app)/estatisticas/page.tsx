import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { loadSettings, loadTrend } from "@/lib/queries";
import { todayIn } from "@/lib/goals";
import { TrendClient } from "./trend-client";

export const dynamic = "force-dynamic";

export default async function StatsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const settings = await loadSettings(session.id);
  if (!settings) redirect("/sair");

  const trend = await loadTrend(session.id, settings.timezone, todayIn(settings.timezone));

  return <TrendClient trend={trend} />;
}
