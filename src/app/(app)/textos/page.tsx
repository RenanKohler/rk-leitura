import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { loadLibrary, loadTags } from "@/lib/queries";
import { TextsClient } from "./texts-client";

export const dynamic = "force-dynamic";

/**
 * A primeira pagina da biblioteca e carregada aqui e vai junto com o HTML.
 * A tela deixa de renderizar vazia para so entao pedir os dados pela rede.
 */
export default async function TextsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const [{ items, texts, ...page }, tags] = await Promise.all([
    loadLibrary(session.id, 1),
    loadTags(session.id),
  ]);

  return <TextsClient initial={{ items, texts, ...page }} tags={tags} />;
}
