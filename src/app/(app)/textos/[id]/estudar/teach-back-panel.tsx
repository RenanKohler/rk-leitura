"use client";

import { Card, SectionTitle } from "@/components/ui";
import { TeachBackForm } from "@/components/teach-back-form";
import type { StudyProps } from "./study-props";
import { QuoteLink } from "./study-request";

/**
 * Explicar com as proprias palavras (US-167): o leitor escolhe uma parte ja
 * lida, escreve de 30 a 300 palavras e recebe ate 4 apontamentos, cada um com
 * o trecho que o sustenta. Sem nota nem porcentagem, e nada fica guardado.
 * O formulario e o mesmo da folha do leitor (US-231).
 */
export function TeachBackPanel({ textId }: StudyProps) {
  return (
    <Card as="section" id="explicar" className="scroll-mt-4 space-y-4 p-5">
      <SectionTitle>Explicar com as próprias palavras</SectionTitle>
      <TeachBackForm
        textId={textId}
        renderQuote={(point) => <QuoteLink textId={textId} start={point.start} quote={point.quote} />}
      />
    </Card>
  );
}
