"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiSend } from "@/lib/client";
import { useToast } from "@/components/providers";
import { Button, Card } from "@/components/ui";
import { LinkIcon } from "@/components/icons";
import type { ImportedText, TextDetail } from "@/lib/types";

/**
 * Importacao rapida por URL. A logica estava duplicada em duas telas, cada uma
 * com um `document.querySelector("input[type=url]")` que pegava o campo errado
 * quando havia mais de um na pagina.
 */
export function ImportCard({ onImported }: { onImported?: () => void }) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const notify = useToast();
  const router = useRouter();

  const handleImport = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = url.trim();
    if (!trimmed || busy) return;

    setBusy(true);
    try {
      const imported = await apiSend<ImportedText>("/api/import-url", "POST", { url: trimmed });
      const { text } = await apiSend<{ text: TextDetail }>("/api/texts", "POST", {
        title: imported.title,
        sourceUrl: imported.sourceUrl,
        content: imported.content,
      });

      setUrl("");
      notify(`"${text.title}" adicionado a biblioteca.`, "success");
      onImported?.();
      router.refresh();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Falha ao importar.", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-4">
      <form onSubmit={handleImport} className="space-y-3">
        <label htmlFor="quick-import" className="flex items-center gap-2 text-sm font-medium">
          <LinkIcon className="size-4 text-accent" />
          Importar de um link
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            id="quick-import"
            type="url"
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="https://site.com/artigo"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            className="min-h-12 flex-1 rounded-2xl border border-border bg-bg px-4 text-base placeholder:text-faint focus:border-accent focus:outline-none"
          />
          <Button type="submit" size="lg" loading={busy} disabled={!url.trim()}>
            {busy ? "Importando" : "Importar"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
