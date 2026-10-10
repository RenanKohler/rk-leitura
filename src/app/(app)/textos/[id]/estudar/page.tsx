import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { loadText } from "@/lib/queries";
import { BackIcon } from "@/components/icons";
import { StudyCardsPanel } from "./study-cards-panel";
import { RetentionPanel } from "./retention-panel";
import { GlossaryPanel } from "./glossary-panel";
import { NotesPanel } from "./notes-panel";
import { TeachBackPanel } from "./teach-back-panel";

export const dynamic = "force-dynamic";

export const metadata = { title: "Estudar" };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Estudar um texto (US-155 a US-170): cartoes, retencao, glossario,
 * fichamento e explicar com as proprias palavras. Cada secao e um componente
 * proprio, que carrega o que precisa.
 */
export default async function StudyPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) redirect("/login");

  const { id } = await params;
  const text = UUID_PATTERN.test(id) ? await loadText(session.id, id) : null;

  if (!text) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center">
        <h1 className="text-xl font-semibold tracking-tight">Texto não encontrado</h1>
        <p className="mt-2 text-muted">Ele pode ter sido removido.</p>
        <Link href="/textos" className="mt-4 inline-block font-medium text-accent">
          Voltar para a biblioteca
        </Link>
      </div>
    );
  }

  const study = {
    textId: text.id,
    title: text.title,
    language: text.language,
    progressIndex: text.progressIndex,
    wordCount: text.wordCount,
  };

  return (
    <div className="space-y-6">
      <header className="flex items-center gap-2 pt-2">
        <Link
          href={`/leitor/${text.id}`}
          aria-label="Voltar ao texto"
          className="-ml-2 flex size-11 items-center justify-center rounded-full text-muted hover:bg-surface-2"
        >
          <BackIcon className="size-5" />
        </Link>
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">Estudar</h1>
          <p className="truncate text-sm text-muted">{text.title}</p>
        </div>
      </header>

      <StudyCardsPanel {...study} />
      <RetentionPanel {...study} />
      <GlossaryPanel {...study} />
      <NotesPanel {...study} />
      <TeachBackPanel {...study} />
    </div>
  );
}
