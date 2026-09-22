import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { loadReview } from "@/lib/queries";
import { ReviewClient } from "./review-client";

export const dynamic = "force-dynamic";

export default async function ReviewPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  return <ReviewClient initial={await loadReview(session.id)} />;
}
