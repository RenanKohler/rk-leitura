"use client";

import { useEffect, useState } from "react";
import { apiGet, apiSend } from "@/lib/client";
import { useToast } from "@/components/providers";
import { Alert, Button, Card, Field, SectionTitle } from "@/components/ui";
import { TrashIcon } from "@/components/icons";
import { MAX_FEEDS } from "@/lib/follow";
import type { FeedSummary } from "@/lib/types";

/**
 * Feeds assinados (US-71).
 *
 * Os artigos publicados depois da assinatura entram na biblioteca sozinhos,
 * com uma etiqueta com o nome do feed. A verificacao roda a cada poucas horas,
 * entao nada aparece no mesmo instante em que se assina.
 */
export function FeedsCard() {
  const notify = useToast();
  const [items, setItems] = useState<FeedSummary[] | null>(null);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void apiGet<{ feeds: FeedSummary[] }>("/api/feeds")
      .then((data) => {
        if (active) setItems(data.feeds);
      })
      .catch(() => {
        if (active) setItems([]);
      });
    return () => {
      active = false;
    };
  }, []);

  const subscribe = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!url.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const data = await apiSend<{ feeds: FeedSummary[] }>("/api/feeds", "POST", {
        url: url.trim(),
      });
      setItems(data.feeds);
      setUrl("");
      notify("Feed assinado. Os proximos artigos entram na biblioteca.", "success");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Nao consegui assinar.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setBusy(true);
    try {
      const data = await apiSend<{ feeds: FeedSummary[] }>(`/api/feeds?id=${id}`, "DELETE");
      setItems(data.feeds);
    } catch {
      notify("Nao consegui remover.", "error");
    } finally {
      setBusy(false);
    }
  };

  const full = (items?.length ?? 0) >= MAX_FEEDS;

  return (
    <Card className="space-y-4 p-5">
      <SectionTitle>Feeds</SectionTitle>
      <p className="text-sm text-muted">
        Assine o feed RSS ou Atom de um site: os artigos novos entram na biblioteca sozinhos, com
        uma etiqueta com o nome do feed. Ate {MAX_FEEDS} feeds.
      </p>

      {items && items.length > 0 ? (
        <ul className="space-y-2">
          {items.map((feed) => (
            <li key={feed.id} className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{feed.title}</p>
                <p className="break-anywhere line-clamp-1 text-xs text-faint">{feed.url}</p>
                {feed.status ? <p className="text-sm text-danger">{feed.status}</p> : null}
              </div>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                aria-label={`Cancelar a assinatura de ${feed.title}`}
                onClick={() => void remove(feed.id)}
              >
                <TrashIcon className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}

      {error ? <Alert>{error}</Alert> : null}

      <form onSubmit={subscribe} className="space-y-3">
        <Field
          label="Endereco do feed"
          name="feed"
          type="url"
          inputMode="url"
          placeholder="https://site.com/feed"
          value={url}
          disabled={full}
          hint={full ? `Limite de ${MAX_FEEDS} feeds atingido.` : undefined}
          onChange={(event) => setUrl(event.target.value)}
        />
        <Button type="submit" variant="secondary" full loading={busy} disabled={!url.trim() || full}>
          Assinar feed
        </Button>
      </form>
    </Card>
  );
}
