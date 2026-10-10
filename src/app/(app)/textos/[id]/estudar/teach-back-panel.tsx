"use client";

import { useEffect, useState } from "react";
import { Alert, Button, Card, SectionTitle, SelectField, TextArea } from "@/components/ui";
import { apiGet, apiSend } from "@/lib/client";
import { countWords } from "@/lib/reading";
import {
  checkExplanation,
  MAX_EXPLANATION_WORDS,
  NOTHING_READ,
  type ReadPart,
  type TeachBackPoint,
} from "@/lib/teach-back";
import type { StudyProps } from "./study-props";
import { QuoteLink, useStudyRequest } from "./study-request";

const FAILURE = "Não consegui conferir agora.";

function partLabel(part: ReadPart): string {
  if (part.title === null) return "Todo o trecho lido";
  return part.partial ? `${part.title} (até onde você leu)` : part.title;
}

/**
 * Explicar com as proprias palavras (US-167): o leitor escolhe uma parte ja
 * lida, escreve de 30 a 300 palavras e recebe ate 4 apontamentos, cada um com
 * o trecho que o sustenta. Sem nota nem porcentagem, e nada fica guardado.
 */
export function TeachBackPanel({ textId }: StudyProps) {
  const [parts, setParts] = useState<ReadPart[] | null>(null);
  const [chosen, setChosen] = useState<number | null>(null);
  const [explanation, setExplanation] = useState("");
  const [points, setPoints] = useState<TeachBackPoint[] | null>(null);
  const [warning, setWarning] = useState("");
  const { run, busy, error, notice } = useStudyRequest(FAILURE);

  useEffect(() => {
    let active = true;
    void apiGet<{ parts: ReadPart[] }>(`/api/texts/${textId}/apontamentos`)
      .then((data) => {
        if (!active) return;
        setParts(data.parts);
        // A parte mais recente, onde a leitura esta, vem escolhida.
        setChosen(data.parts[data.parts.length - 1]?.start ?? null);
      })
      .catch(() => {
        if (active) setParts([]);
      });
    return () => {
      active = false;
    };
  }, [textId]);

  const check = () => {
    const checked = checkExplanation(explanation);
    if ("error" in checked) {
      // Nada sai do app com menos de 30 (ou mais de 300) palavras.
      setWarning(checked.error);
      return;
    }
    setWarning("");
    void run(async () => {
      const data = await apiSend<{ points: TeachBackPoint[] }>(`/api/texts/${textId}/apontamentos`, "POST", {
        start: chosen,
        explanation: checked.text,
      });
      setPoints(data.points);
    });
  };

  const size = countWords(explanation);

  return (
    <Card as="section" className="space-y-4 p-5">
      <SectionTitle>Explicar com as próprias palavras</SectionTitle>
      <div data-testid="apontamentos" className="space-y-4">
        {parts === null ? null : parts.length === 0 ? (
          <p className="text-sm text-muted">{NOTHING_READ}</p>
        ) : (
          <>
            <p className="text-sm text-muted">
              Escreva o que entendeu e veja o que ficou de fora ou divergiu do texto. Não há nota.
            </p>
            {parts.length > 1 ? (
              <SelectField
                label="Parte já lida"
                value={chosen === null ? "" : String(chosen)}
                onChange={(event) => setChosen(Number(event.target.value))}
                options={parts.map((part) => ({ value: String(part.start), label: partLabel(part) }))}
              />
            ) : (
              <p className="text-sm font-medium">{partLabel(parts[0]!)}</p>
            )}
            <TextArea
              label="Sua explicação"
              rows={6}
              value={explanation}
              onChange={(event) => setExplanation(event.target.value)}
              hint={`${size} de ${MAX_EXPLANATION_WORDS} palavras`}
            />
            {warning ? <Alert>{warning}</Alert> : null}
            <Button onClick={check} loading={busy}>
              Conferir
            </Button>
          </>
        )}

        {points !== null ? (
          points.length === 0 ? (
            <p className="text-sm text-muted" data-testid="apontamentos-vazio">
              Nenhum apontamento: a explicação cobre os pontos principais desta parte.
            </p>
          ) : (
            <ul className="space-y-3" aria-label="Apontamentos">
              {points.map((point) => (
                <li key={`${point.start}-${point.text}`} className="space-y-1" data-testid="apontamento">
                  <p className="leading-relaxed">{point.text}</p>
                  <QuoteLink textId={textId} start={point.start} quote={point.quote} />
                </li>
              ))}
            </ul>
          )
        ) : null}
        {notice}
        {error ? <Alert>{error}</Alert> : null}
      </div>
    </Card>
  );
}
