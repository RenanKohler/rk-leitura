import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * O middleware ja trata "/", mas manter a decisao aqui cobre o caso em que o
 * matcher mudar e evita servir uma pagina em branco.
 */
export default async function HomePage() {
  redirect((await getSession()) ? "/dashboard" : "/login");
}
