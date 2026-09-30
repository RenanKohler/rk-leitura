import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { loadSavedWords } from "@/lib/queries";
import { loadWordRetention } from "@/lib/learning-queries";
import { WordsClient } from "./words-client";

export const dynamic = "force-dynamic";

export default async function WordsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const [words, retention] = await Promise.all([
    loadSavedWords(session.id),
    loadWordRetention(session.id),
  ]);
  return <WordsClient initial={words} retention={retention} />;
}
