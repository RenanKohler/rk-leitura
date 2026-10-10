"use client";

import { useState } from "react";
import { Alert, Button, Card, SectionTitle } from "@/components/ui";
import { apiSend } from "@/lib/client";
import { isConcluded } from "@/lib/study-cards";
import {
  notesFileName,
  notesMarkdown,
  NOTES_NOT_CONCLUDED,
  NOTES_SECTIONS,
  type StudyNotes,
} from "@/lib/study-notes";
import type { StudyProps } from "./study-props";
import { QuoteLink, useStudyRequest } from "./study-request";

const FAILURE = "Não consegui fazer o fichamento agora.";

/**
 * Fichamento (US-165): ideia central, argumentos, evidencias e conclusoes de
 * um texto concluido, cada item com a citacao que abre o leitor no trecho.
 * Texto nao concluido nao envia nada. "Exportar" baixa o Markdown no formato
 * da exportacao de destaques.
 */
export function NotesPanel({ textId, title, progressIndex, wordCount }: StudyProps) {
  const concluded = isConcluded({ progressIndex, wordCount });
  const [notes, setNotes] = useState<StudyNotes | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const { run, busy, error, notice } = useStudyRequest(FAILURE);

  const open = () =>
    run(async () => {
      const data = await apiSend<{ notes: StudyNotes; sourceUrl: string | null }>(
        `/api/texts/${textId}/fichamento`,
        "POST"
      );
      setNotes(data.notes);
      setSource(data.sourceUrl ?? null);
    });

  const download = () => {
    if (!notes) return;
    const blob = new Blob([notesMarkdown({ title, sourceUrl: source }, notes)], {
      type: "text/markdown;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = notesFileName(title);
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card as="section" className="space-y-4 p-5">
      <SectionTitle
        action={
          notes ? (
            <Button variant="secondary" size="sm" onClick={download}>
              Exportar
            </Button>
          ) : null
        }
      >
        Fichamento
      </SectionTitle>
      <div data-testid="fichamento" className="space-y-4">
        {!concluded ? (
          <>
            <p className="text-sm text-muted">{NOTES_NOT_CONCLUDED}</p>
            <Button variant="secondary" disabled>
              Fichamento
            </Button>
          </>
        ) : notes === null ? (
          <>
            <p className="text-sm text-muted">
              Ideia central, argumentos, evidências e conclusões, cada item com o trecho de origem.
            </p>
            <Button variant="secondary" onClick={() => void open()} loading={busy}>
              Fichamento
            </Button>
          </>
        ) : (
          NOTES_SECTIONS.map(({ key, label }) => (
            <section key={key} className="space-y-2" aria-label={label}>
              <h3 className="text-sm font-semibold">{label}</h3>
              {notes[key].length === 0 ? (
                <p className="text-sm text-faint">Nada nesta seção.</p>
              ) : (
                <ul className="space-y-3">
                  {notes[key].map((item) => (
                    <li key={`${item.start}-${item.text}`} className="space-y-1">
                      <p className="leading-relaxed">{item.text}</p>
                      <QuoteLink textId={textId} start={item.start} quote={item.quote} />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))
        )}
        {notice}
        {error ? <Alert>{error}</Alert> : null}
      </div>
    </Card>
  );
}
