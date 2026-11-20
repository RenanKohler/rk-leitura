"use client";

import Link from "next/link";
import { useState } from "react";
import { Alert, Button, Card, SectionTitle } from "@/components/ui";
import { apiSend } from "@/lib/client";
import type { TextLink } from "@/lib/text-links";
import type { StudyProps } from "./study-props";
import { QuoteLink, readerAt, useStudyRequest } from "./study-request";

const FAILURE = "Não consegui procurar ligações agora.";

/**
 * Ligacoes com outros textos (US-232): trechos de outros textos da
 * biblioteca que tratam do mesmo assunto, complementam ou contradizem este.
 * Gerado sob demanda; cada ligacao mostra a relacao em uma frase, o trecho
 * deste texto (abre o leitor aqui) e o do outro, com "Ler a partir daqui".
 */
export function LinksPanel({ textId }: StudyProps) {
  const [links, setLinks] = useState<TextLink[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const { run, busy, error, notice } = useStudyRequest(FAILURE);

  const open = () =>
    run(async () => {
      const data = await apiSend<{ links: TextLink[]; message: string | null }>(
        `/api/texts/${textId}/ligacoes`,
        "POST"
      );
      setLinks(data.links);
      setMessage(data.message ?? null);
    });

  return (
    <Card as="section" id="ligacoes" className="scroll-mt-4 space-y-4 p-5">
      <SectionTitle>Ligações com outros textos</SectionTitle>
      <div data-testid="ligacoes" className="space-y-4">
        {links === null ? (
          <>
            <p className="text-sm text-muted">
              Trechos de outros textos da sua biblioteca que tratam do mesmo assunto, complementam ou
              contradizem este.
            </p>
            <Button variant="secondary" size="lg" onClick={() => void open()} loading={busy}>
              Procurar ligações
            </Button>
          </>
        ) : links.length === 0 ? (
          <p className="text-sm text-muted">{message ?? "Nenhuma ligação encontrada."}</p>
        ) : (
          <ul className="divide-y divide-border">
            {links.map((link) => (
              <li
                key={`${link.textId}-${link.other.start}`}
                className="space-y-2 py-4 first:pt-0 last:pb-0"
                data-testid="ligacao"
              >
                <h3 className="font-medium">{link.title}</h3>
                <p className="leading-relaxed">{link.relation}</p>
                <div className="space-y-1">
                  <p className="text-xs text-faint">Neste texto</p>
                  <QuoteLink textId={textId} start={link.here.start} quote={link.here.quote} />
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-faint">{link.sameSeries ? "Na mesma série" : "No outro texto"}</p>
                  <blockquote className="border-l-2 border-primary pl-3 text-sm text-ink">
                    “{link.other.quote}”
                  </blockquote>
                </div>
                <Link
                  href={readerAt(link.textId, link.other.start)}
                  className="state-layer -ml-3 inline-flex min-h-12 items-center rounded-full px-3 text-sm font-medium text-primary"
                  aria-label={`Ler ${link.title} a partir deste trecho`}
                >
                  Ler a partir daqui
                </Link>
              </li>
            ))}
          </ul>
        )}
        {notice}
        {error ? <Alert>{error}</Alert> : null}
      </div>
    </Card>
  );
}
