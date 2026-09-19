import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { findTextBySourceUrl } from "@/lib/queries";
import { countWords } from "@/lib/reading";
import { normalizeSourceUrl, pickSharedUrl } from "@/lib/source-url";
import { PasteForm } from "@/components/paste-form";
import { EmptyState, LinkButton } from "@/components/ui";
import { LinkIcon } from "@/components/icons";
import { ShareImport } from "./share-import";

export const dynamic = "force-dynamic";

const MIN_WORDS = 10;

/** Campos que o `share_target` do manifest entrega na query. */
interface SharedFields {
  title?: string;
  text?: string;
  url?: string;
}

/**
 * Destino do compartilhamento do sistema.
 *
 * O manifest aponta para ca com metodo GET, entao esta tela nao grava nada: ela
 * so decide o que fazer com o que chegou. A importacao em si sai de uma chamada
 * separada (`POST /api/share`), o que mantem a navegacao sem efeito colateral.
 */
export default async function SharePage({
  searchParams,
}: {
  searchParams: Promise<SharedFields>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  const { title, text, url } = await searchParams;
  const shared = pickSharedUrl({ url, text, title });

  if (shared) {
    const normalized = normalizeSourceUrl(shared);
    const known = await findTextBySourceUrl(session.id, [normalized]);

    // Ja esta na biblioteca: abre onde a leitura parou, sem buscar de novo.
    if (known) redirect(`/leitor/${known.id}`);

    return (
      <ShareImport url={normalized} title={title?.trim() || null} autoStart={await isTrusted()} />
    );
  }

  // Sem endereco: veio uma selecao de texto, que ainda da um texto para ler.
  if (text && countWords(text) >= MIN_WORDS) {
    return (
      <div className="space-y-6">
        <header className="pt-2">
          <h1 className="text-2xl font-semibold tracking-tight">Texto compartilhado</h1>
          <p className="mt-1 text-sm text-muted">
            A origem mandou o texto, nao um link. Confira o titulo e salve.
          </p>
        </header>
        <PasteForm initialTitle={title?.trim() ?? ""} initialContent={text} />
      </div>
    );
  }

  // Veio um endereco, mas nao um que de para buscar. Dizer isso e diferente
  // de dizer que nao veio nada: o favorito e o Atalho do iOS (US-59) mandam
  // o endereco da pagina atual, que as vezes e um `file:` ou um `ftp:`.
  const rejected = [url, text].some(
    (value) => typeof value === "string" && value.trim().length > 0
  );

  return (
    <EmptyState
      icon={<LinkIcon className="size-6" />}
      title={rejected ? "Endereco invalido" : "Nada para importar"}
      description={
        rejected
          ? "O endereco precisa comecar com http:// ou https://"
          : "O compartilhamento chegou sem link e sem texto suficiente para ler."
      }
      action={
        <LinkButton href="/textos/novo" size="lg">
          Adicionar texto
        </LinkButton>
      }
    />
  );
}

/**
 * A folha de compartilhamento do Android abre o app como navegacao propria do
 * navegador (`none`); um link vindo de outro site chega como `cross-site`.
 *
 * Distinguir os dois importa porque a importacao faz o servidor buscar um
 * endereco escolhido por quem compartilhou. Sem essa checagem, qualquer pagina
 * poderia apontar para ca e disparar a busca usando a sessao de quem visita.
 * Nesse caso a tela espera um toque; no compartilhamento de verdade, nao.
 */
async function isTrusted(): Promise<boolean> {
  return (await headers()).get("sec-fetch-site") !== "cross-site";
}
