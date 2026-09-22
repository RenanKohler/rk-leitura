import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { loadQueue, loadStaleQueue } from "@/lib/queries";
import { QueueClient } from "./queue-client";

export const dynamic = "force-dynamic";

export default async function QueuePage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const [queue, stale] = await Promise.all([loadQueue(session.id), loadStaleQueue(session.id)]);
  return <QueueClient initial={queue} stale={stale} />;
}
