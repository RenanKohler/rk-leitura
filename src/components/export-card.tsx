"use client";

import { Card, LinkButton, SectionTitle } from "@/components/ui";

/**
 * Download dos dados da conta.
 *
 * Links comuns em vez de `fetch` + blob: o navegador ja sabe baixar um arquivo
 * quando a resposta traz `content-disposition`, e assim o download funciona
 * igual no celular e no computador, sem memoria intermediaria.
 */
export function ExportCard() {
  return (
    <Card className="space-y-3 p-5">
      <SectionTitle>Seus dados</SectionTitle>
      <p className="text-sm text-muted">
        Baixe o que e seu quando quiser. O historico sai em CSV, pronto para planilha; a
        biblioteca sai em JSON, porque o conteudo dos textos tem quebras de linha.
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <LinkButton href="/api/exportar?tipo=sessoes" variant="secondary" full>
          Historico (CSV)
        </LinkButton>
        <LinkButton href="/api/exportar?tipo=biblioteca" variant="secondary" full>
          Biblioteca (JSON)
        </LinkButton>
      </div>
    </Card>
  );
}
