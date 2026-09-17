import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { loadText } from "@/lib/queries";
import { ReaderClient } from "./reader-client";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * O texto vai no HTML. Era a tela mais penalizada pela busca no cliente: o
 * leitor so podia medir as paginas depois que o conteudo chegasse, entao a
 * espera da rede aparecia como tela vazia.
 */
export default async function ReaderPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) redirect("/login");

  const { id } = await params;
  const text = UUID_PATTERN.test(id) ? await loadText(session.id, id) : null;

  if (!text) {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center gap-4 px-6 text-center">
        <h1 className="text-xl font-semibold tracking-tight">Texto nao encontrado</h1>
        <p className="text-muted">Ele pode ter sido removido.</p>
        <Link
          href="/textos"
          className="inline-flex min-h-12 items-center rounded-full bg-accent px-6 font-medium text-accent-ink"
        >
          Voltar para a biblioteca
        </Link>
      </div>
    );
  }

  return <ReaderClient text={text} />;
}
