import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { loadDailyTotals, loadSettings, loadTrend } from "@/lib/queries";
import { calendarStart } from "@/lib/calendar";
import { YearCalendar } from "@/components/year-calendar";
import { todayIn } from "@/lib/goals";
import { loadLearningStats } from "@/lib/learning-queries";
import { TrendClient } from "./trend-client";
import { LearningClient } from "./learning-client";

export const dynamic = "force-dynamic";

export default async function StatsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const settings = await loadSettings(session.id);
  if (!settings) redirect("/sair");

  const today = todayIn(settings.timezone);
  const [trend, year, learning] = await Promise.all([
    loadTrend(session.id, settings.timezone, today),
    loadDailyTotals(session.id, settings.timezone, calendarStart(today)),
    loadLearningStats(session.id, settings.timezone, today),
  ]);

  return (
    <div className="space-y-6">
      <TrendClient trend={trend} />
      <LearningClient stats={learning} />
      <YearCalendar days={year.map(({ day, minutes }) => ({ day, minutes }))} today={today} />
    </div>
  );
}
