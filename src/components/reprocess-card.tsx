"use client";

import { useState } from "react";
import { apiGet, apiSend } from "@/lib/client";
import { useToast } from "@/components/providers";
import { Alert, Button, Card, SectionTitle } from "@/components/ui";

interface Candidate {
  id: string;
  title: string;
  citations: number;
}

/**
 * Omitir as referencias dos artigos que ja estavam na biblioteca.
 *
 * A importacao nova ja faz isso sozinha; aqui e para o que entrou antes.
 * Cada texto e processado em uma chamada propria: se um falhar, os outros
 * seguem, e o resumo diz quantos nao deu.
 */
export function ReprocessCard() {
  const notify = useToast();
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");

  const search = async () => {
    setSearching(true);
    setError("");
    try {
      const found: Candidate[] = [];
      let from: number | null = 0;
      while (from !== null) {
        const page: { candidates: Candidate[]; next: number | null } = await apiGet(`/api/reprocessar?de=${from}`);
        found.push(...page.candidates);
        from = page.next;
      }
      setCandidates(found);
    } catch {
      setError("Nao consegui procurar na biblioteca.");
    } finally {
      setSearching(false);
    }
  };

  const run = async () => {
    if (!candidates) return;
    setRunning(true);
    let done = 0;
    const failed: string[] = [];
    for (const [position, candidate] of candidates.entries()) {
      setProgress(`${position + 1} de ${candidates.length}`);
      try {
        await apiSend(`/api/texts/${candidate.id}/referencias`, "POST", { acao: "omitir" });
        done += 1;
      } catch {
        failed.push(candidate.title);
      }
    }
    setRunning(false);
    setProgress("");
    setCandidates(null);
    notify(`Referencias omitidas em ${done} texto${done === 1 ? "" : "s"}.`, "success");
    if (failed.length > 0) {
      setError(`Nao deu para processar ${failed.length}: ${failed.slice(0, 3).join("; ")}${failed.length > 3 ? "..." : ""}`);
    }
  };

  return (
    <Card className="space-y-3 p-5">
      <SectionTitle>Referencias em artigos</SectionTitle>
      <p className="text-sm text-muted">
        Artigos importados daqui em diante ja entram sem as citacoes do corpo, como [12] e (Silva,
        2020). Para os que ja estao na biblioteca, procure e omita. A posicao de leitura, os
        destaques e os marcadores acompanham, e cada texto pode ser restaurado depois pelo leitor.
      </p>
      {error ? <Alert>{error}</Alert> : null}

      {candidates === null ? (
        <Button variant="secondary" full loading={searching} onClick={() => void search()}>
          Procurar artigos com referencias
        </Button>
      ) : candidates.length === 0 ? (
        <p className="text-sm text-faint" data-testid="reprocessar-vazio">
          Nenhum texto com referencias no corpo.
        </p>
      ) : (
        <div className="space-y-3" data-testid="reprocessar-lista">
          <ul className="max-h-48 space-y-1 overflow-y-auto text-sm">
            {candidates.map((candidate) => (
              <li key={candidate.id} className="flex justify-between gap-3">
                <span className="truncate">{candidate.title}</span>
                <span className="tabular shrink-0 text-muted">{candidate.citations} citacoes</span>
              </li>
            ))}
          </ul>
          <Button full loading={running} onClick={() => void run()}>
            {running ? `Processando ${progress}` : `Omitir em ${candidates.length} texto${candidates.length === 1 ? "" : "s"}`}
          </Button>
        </div>
      )}
    </Card>
  );
}
