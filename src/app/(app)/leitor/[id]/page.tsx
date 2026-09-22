import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { loadHighlights, loadKnownWords, loadNextUp } from "@/lib/queries";
import { ReaderClient } from "./reader-client";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * O texto vai no HTML. Era a tela mais penalizada pela busca no cliente: o
 * leitor so podia medir as paginas depois que o conteudo chegasse, entao a
 * espera da rede aparecia como tela vazia.
 */
export default async function ReaderPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ de?: string; ate?: string; previsto?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  const [{ id }, query] = await Promise.all([params, searchParams]);
  const loaded = UUID_PATTERN.test(id) ? await loadHighlights(session.id, id) : null;

  if (!loaded) {
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

  // `?de=` vem da lista de destaques: abrir um destaque posiciona a leitura
  // nele. Um valor invalido simplesmente nao muda nada.
  const from = Number(query.de);
  const startAt = Number.isInteger(from) && from >= 0 ? from : undefined;

  // `?ate=` e `?previsto=` vem da sugestao por tempo livre (US-85): onde a
  // leitura para e quanto ela deveria levar.
  const until = Number(query.ate);
  const stopAt =
    Number.isInteger(until) && until > loaded.text.progressIndex ? until : undefined;
  const planned = Number(query.previsto);
  const plannedMs = stopAt && Number.isFinite(planned) && planned > 0 ? planned : undefined;

  // O que vem depois deste texto ja vai no HTML: a tela de conclusao nao
  // precisa esperar uma consulta para oferecer o proximo capitulo ou a fila.
  const [nextUp, knownWords] = await Promise.all([
    loadNextUp(session.id, id),
    loadKnownWords(session.id, loaded.text.language),
  ]);

  return (
    <ReaderClient
      text={loaded.text}
      highlights={loaded.items}
      startAt={startAt}
      nextUp={nextUp}
      stopAt={stopAt}
      plannedMs={plannedMs}
      knownWords={knownWords}
    />
  );
}
