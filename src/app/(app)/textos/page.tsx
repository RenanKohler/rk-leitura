import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { loadTexts } from "@/lib/queries";
import { TextsClient } from "./texts-client";

export const dynamic = "force-dynamic";

/**
 * A primeira pagina da biblioteca e carregada aqui e vai junto com o HTML.
 * A tela deixa de renderizar vazia para so entao pedir os dados pela rede.
 */
export default async function TextsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const { items, ...page } = await loadTexts(session.id, 1);

  return <TextsClient initial={{ texts: items, ...page }} />;
}
