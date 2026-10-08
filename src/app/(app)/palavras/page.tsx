import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { loadSavedWords } from "@/lib/queries";
import { loadWordRetention } from "@/lib/learning-queries";
import { refreshDefinitionBatch } from "@/lib/word-batch";
import { WordsClient } from "./words-client";

export const dynamic = "force-dynamic";

export default async function WordsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  // O lote de definicoes (US-139) e conferido antes da lista: se ele terminou,
  // as definicoes ja vem nela.
  const batch = await refreshDefinitionBatch(session.id);
  const [words, retention] = await Promise.all([
    loadSavedWords(session.id),
    loadWordRetention(session.id),
  ]);
  return <WordsClient initial={words} retention={retention} batch={batch} />;
}
