import type { ReactNode } from "react";

/** A pagina e de cliente e nao pode exportar metadata; o titulo vem daqui. */
export const metadata = { title: "Novo texto" };

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
