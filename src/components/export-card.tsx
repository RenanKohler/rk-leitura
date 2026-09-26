"use client";

import { useRef, useState } from "react";
import { apiSend } from "@/lib/client";
import { useToast } from "@/components/providers";
import { Alert, Button, Card, LinkButton, SectionTitle } from "@/components/ui";
import { batchesOf, MAX_BACKUP_BYTES, parseBackup, UNRECOGNIZED } from "@/lib/backup";

/**
 * Download dos dados da conta e restauracao da biblioteca (US-50, US-98).
 *
 * Links comuns em vez de `fetch` + blob: o navegador ja sabe baixar um arquivo
 * quando a resposta traz `content-disposition`, e assim o download funciona
 * igual no celular e no computador, sem memoria intermediaria.
 */
export function ExportCard() {
  const notify = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [restoring, setRestoring] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");

  const restore = async (file: File) => {
    setError("");
    if (file.size > MAX_BACKUP_BYTES) {
      setError(`O arquivo passa de ${Math.round(MAX_BACKUP_BYTES / 1024 / 1024)} MB.`);
      return;
    }

    let parsed;
    try {
      parsed = parseBackup(JSON.parse(await file.text()));
    } catch {
      setError(UNRECOGNIZED);
      return;
    }
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }

    setRestoring(true);
    const created: string[] = [];
    let skipped = 0;
    const batches = batchesOf(parsed.texts);

    try {
      for (const [position, batch] of batches.entries()) {
        setProgress(`Restaurando ${position + 1} de ${batches.length}`);
        const result = await apiSend<{ created: string[]; skipped: number }>("/api/importar", "POST", {
          textos: batch,
        });
        created.push(...result.created);
        skipped += result.skipped;
      }
      notify(
        `${created.length} texto${created.length === 1 ? "" : "s"} restaurado${created.length === 1 ? "" : "s"}` +
          (skipped > 0 ? `. ${skipped} ja existia${skipped === 1 ? "" : "m"}.` : "."),
        "success"
      );
    } catch (cause) {
      // Tudo ou nada: o que os lotes anteriores gravaram e desfeito.
      if (created.length > 0) {
        await apiSend("/api/importar", "DELETE", { ids: created }).catch(() => undefined);
      }
      setError(
        `${cause instanceof Error ? cause.message : "A restauracao falhou."} Nada foi gravado.`
      );
    } finally {
      setRestoring(false);
      setProgress("");
    }
  };

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

      <p className="pt-2 text-sm text-muted">
        Para trazer a biblioteca de volta, nesta ou em outra conta, escolha o arquivo JSON baixado
        aqui. Textos que ja estao na biblioteca sao pulados.
      </p>
      {error ? <Alert>{error}</Alert> : null}
      <input
        ref={inputRef}
        type="file"
        accept=".json,application/json"
        className="sr-only"
        aria-label="Arquivo da biblioteca"
        data-testid="restaurar-arquivo"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void restore(file);
        }}
      />
      <Button variant="secondary" full loading={restoring} onClick={() => inputRef.current?.click()}>
        {restoring ? progress || "Restaurando" : "Restaurar biblioteca"}
      </Button>
    </Card>
  );
}
