import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { loadText } from "@/lib/queries";
import { loadCardReview } from "@/lib/study-review-queries";
import { CardReviewClient } from "./card-review-client";

export const dynamic = "force-dynamic";

export const metadata = { title: "Revisar cartões" };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Revisao dos cartoes de estudo de um texto (US-156). */
export default async function CardReviewPage({ params }: { params: Promise<{ id: string }> }) {
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

  return <CardReviewClient initial={await loadCardReview(session.id, text)} />;
}
