"use client";

import Link from "next/link";
import { useState } from "react";
import { Alert, Button, Card, SectionTitle } from "@/components/ui";
import { apiSend } from "@/lib/client";
import { wordNumber } from "@/lib/ask";
import { GLOSSARY_TOO_SOON, glossaryCut, type GlossaryEntry } from "@/lib/glossary";
import type { StudyProps } from "./study-props";
import { readerAt, useStudyRequest } from "./study-request";

const FAILURE = "Não consegui gerar o glossário agora.";

/**
 * Glossario de conceitos (US-164): ate 30 termos do trecho lido, em ordem
 * alfabetica, com a definicao no sentido do texto e a primeira ocorrencia.
 * Tocar no termo abre o leitor ali; "Virar cartao" grava um cartao de estudo
 * com o que ja esta na tela, sem nova chamada.
 */
export function GlossaryPanel({ textId, progressIndex, wordCount }: StudyProps) {
  const ready = glossaryCut({ progressIndex, wordCount }) !== null;
  const [terms, setTerms] = useState<GlossaryEntry[] | null>(null);
  const [made, setMade] = useState<Set<string>>(new Set());
  const [making, setMaking] = useState<string | null>(null);
  const [cardError, setCardError] = useState("");
  const { run, busy, error, notice } = useStudyRequest(FAILURE);

  const open = () =>
    run(async () => {
      const data = await apiSend<{ terms: GlossaryEntry[] }>(`/api/texts/${textId}/glossario`, "POST");
      setTerms(data.terms);
    });

  const toCard = async (entry: GlossaryEntry) => {
    setMaking(entry.term);
    setCardError("");
    try {
      await apiSend(`/api/texts/${textId}/glossario/cartao`, "POST", entry);
      setMade((current) => new Set(current).add(entry.term));
    } catch (cause) {
      setCardError(cause instanceof Error ? cause.message : "Não consegui criar o cartão.");
    } finally {
      setMaking(null);
    }
  };

  return (
    <Card as="section" className="space-y-4 p-5">
      <SectionTitle>Termos e conceitos</SectionTitle>
      <div data-testid="glossario" className="space-y-4">
        {!ready ? (
          <p className="text-sm text-muted">{GLOSSARY_TOO_SOON}</p>
        ) : terms === null ? (
          <p className="text-sm text-muted">
            Os termos do trecho já lido, com a definição no sentido em que o texto os usa.
          </p>
        ) : null}

        {terms === null ? (
          <Button variant="secondary" onClick={() => void open()} loading={busy} disabled={!ready}>
            Glossário
          </Button>
        ) : terms.length === 0 ? (
          <p className="text-sm text-muted">Nenhum termo encontrado no trecho lido.</p>
        ) : (
          <ul className="divide-y divide-border">
            {terms.map((entry) => (
              <li key={entry.term} className="flex items-start gap-3 py-3" data-testid="glossario-termo">
                <Link href={readerAt(textId, entry.start)} className="min-w-0 flex-1 rounded-lg hover:bg-surface-2">
                  <span className="font-medium">{entry.term}</span>
                  <span className="block text-sm leading-relaxed text-muted">{entry.definition}</span>
                  <span className="block text-xs text-faint">{`Aparece na palavra ${wordNumber(entry.start)}`}</span>
                </Link>
                <Button
                  variant="ghost"
                  size="sm"
                  loading={making === entry.term}
                  disabled={made.has(entry.term) || making !== null}
                  onClick={() => void toCard(entry)}
                >
                  {made.has(entry.term) ? "Cartão criado" : "Virar cartão"}
                </Button>
              </li>
            ))}
          </ul>
        )}

        {notice}
        {error ? <Alert>{error}</Alert> : null}
        {cardError ? <Alert>{cardError}</Alert> : null}
      </div>
    </Card>
  );
}
