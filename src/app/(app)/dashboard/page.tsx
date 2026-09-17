import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { loadOverview, loadTexts } from "@/lib/queries";
import { DashboardClient } from "./dashboard-client";

export const dynamic = "force-dynamic";

const RECENT_LIMIT = 5;

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const [overview, { items, ...page }] = await Promise.all([
    loadOverview(session.id),
    loadTexts(session.id, 1, RECENT_LIMIT),
  ]);

  return <DashboardClient initialOverview={overview} initialTexts={{ texts: items, ...page }} />;
}
