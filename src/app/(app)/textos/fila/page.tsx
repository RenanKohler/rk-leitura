import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { loadQueue } from "@/lib/queries";
import { QueueClient } from "./queue-client";

export const dynamic = "force-dynamic";

export default async function QueuePage() {
  const session = await getSession();
  if (!session) redirect("/login");

  return <QueueClient initial={await loadQueue(session.id)} />;
}
