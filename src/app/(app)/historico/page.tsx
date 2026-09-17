import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { loadOverview, loadSessions } from "@/lib/queries";
import { HistoryClient } from "./history-client";

export const dynamic = "force-dynamic";

export default async function HistoryPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  // As duas consultas vao juntas: uma nao depende da outra.
  const [{ items, ...page }, overview] = await Promise.all([
    loadSessions(session.id, 1),
    loadOverview(session.id),
  ]);

  return (
    <HistoryClient
      initialSessions={{ sessions: items, ...page }}
      initialOverview={{ stats: overview.stats }}
    />
  );
}
