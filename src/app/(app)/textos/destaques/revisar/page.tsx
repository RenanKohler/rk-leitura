import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { loadHighlightReview } from "@/lib/learning-queries";
import { HighlightReviewClient } from "./highlight-review-client";

export const dynamic = "force-dynamic";

/** Revisao espacada dos destaques (PROD-4). */
export default async function HighlightReviewPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  return <HighlightReviewClient initial={await loadHighlightReview(session.id)} />;
}
