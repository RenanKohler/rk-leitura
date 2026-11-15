import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { asLibraryOrder, LIBRARY_ORDER_COOKIE } from "@/lib/library";
import { loadLibrary, loadTags } from "@/lib/queries";
import { TextsClient } from "./texts-client";

export const dynamic = "force-dynamic";

export const metadata = { title: "Textos" };

/**
 * A primeira pagina da biblioteca e carregada aqui e vai junto com o HTML.
 * A tela deixa de renderizar vazia para so entao pedir os dados pela rede.
 *
 * A ordem da lista e uma escolha do aparelho (US-230) e mora em
 * `localStorage`, que o servidor nao le. O cookie e a copia dela para esta
 * primeira tela: sem ele a lista chegaria na ordem padrao e trocaria de lugar
 * na frente do leitor assim que a tela hidratasse. A ordem usada segue para o
 * cliente, que pede a lista de novo so quando o guardado no aparelho for
 * outro (cookie vencido ou apagado).
 */
export default async function TextsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const order = asLibraryOrder((await cookies()).get(LIBRARY_ORDER_COOKIE)?.value);

  const [{ items, texts, ...page }, tags] = await Promise.all([
    loadLibrary(session.id, 1, undefined, { order }),
    loadTags(session.id),
  ]);

  return <TextsClient initial={{ items, texts, ...page }} tags={tags} order={order} />;
}
