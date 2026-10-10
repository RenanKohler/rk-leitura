import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { loadDailyReview } from "@/lib/study-review-queries";
import { DailyReviewClient } from "./daily-review-client";

export const dynamic = "force-dynamic";

export const metadata = { title: "Revisar" };

/**
 * Revisao do dia num so lugar (US-161): palavras, destaques, cartoes de
 * estudo e questionarios a recordar (US-169). As revisoes separadas de
 * palavras e destaques continuam existindo.
 */
export default async function DailyReviewPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  return <DailyReviewClient initial={await loadDailyReview(session.id)} />;
}
