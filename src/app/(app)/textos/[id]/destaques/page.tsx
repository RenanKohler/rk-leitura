import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { loadHighlights } from "@/lib/queries";
import { HighlightsClient } from "./highlights-client";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function HighlightsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  const { id } = await params;
  const loaded = UUID_PATTERN.test(id) ? await loadHighlights(session.id, id) : null;

  if (!loaded) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center">
        <h1 className="text-xl font-semibold tracking-tight">Texto nao encontrado</h1>
        <p className="mt-2 text-muted">Ele pode ter sido removido.</p>
        <Link href="/textos" className="mt-4 inline-block font-medium text-accent">
          Voltar para a biblioteca
        </Link>
      </div>
    );
  }

  return (
    <HighlightsClient
      textId={loaded.text.id}
      title={loaded.text.title}
      sourceUrl={loaded.text.sourceUrl}
      content={loaded.text.content}
      format={loaded.text.format}
      initial={loaded.items}
    />
  );
}
