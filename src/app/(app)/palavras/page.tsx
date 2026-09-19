import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { loadSavedWords } from "@/lib/queries";
import { WordsClient } from "./words-client";

export const dynamic = "force-dynamic";

export default async function WordsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  return <WordsClient initial={await loadSavedWords(session.id)} />;
}
