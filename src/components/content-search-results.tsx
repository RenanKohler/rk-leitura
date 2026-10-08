"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiGet } from "@/lib/client";
import { Card, SectionTitle, Skeleton } from "@/components/ui";
import { foldForSearch } from "@/lib/text-filter";
import type { ContentMatch } from "@/lib/types";

/** Abaixo disso a rota nem busca: acharia quase todo texto. */
const MIN_QUERY = 3;

/**
 * Resultados da busca no conteudo da biblioteca (APP-16).
 *
 * Fica fora da lista paginada de proposito: a lista filtra por titulo e
 * responde na hora; o conteudo e varrido a parte, e cada resultado leva
 * direto a palavra onde o termo aparece. Recebe o termo ja com a espera da
 * digitacao aplicada.
 */
export function ContentSearchResults({ query }: { query: string }) {
  const term = query.trim();
  const enabled = foldForSearch(term).length >= MIN_QUERY;
  // Resultado guardado com o termo que o produziu: "carregando" e o termo
  // atual ainda sem resposta, sem setState sincrono dentro do efeito.
  const [result, setResult] = useState<{ term: string; matches: ContentMatch[] } | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    apiGet<{ matches: ContentMatch[] }>(
      `/api/texts/busca?q=${encodeURIComponent(term)}`,
      controller.signal
    )
      .then((data) => setResult({ term, matches: data.matches }))
      .catch(() => {
        // Falha ou cancelamento: a busca por titulo continua valendo sozinha.
        if (!controller.signal.aborted) setResult({ term, matches: [] });
      });
    return () => controller.abort();
  }, [enabled, term]);

  if (!enabled) return null;
  const loading = result?.term !== term;
  const matches = loading ? [] : (result?.matches ?? []);
  if (!loading && matches.length === 0) return null;

  return (
    <section className="space-y-2" aria-labelledby="busca-conteudo" data-testid="busca-conteudo">
      <SectionTitle>
        <span id="busca-conteudo">Encontrado no conteúdo</span>
      </SectionTitle>
      {loading ? (
        <Skeleton className="h-20 w-full rounded-card" />
      ) : (
        <ul className="space-y-2">
          {matches.map((match) => (
            <li key={match.id}>
              <Link href={`/leitor/${match.id}?de=${match.wordIndex}`} className="block">
                <Card className="space-y-1 p-4 transition-colors hover:border-border-strong">
                  <p className="font-medium leading-snug">{match.title}</p>
                  <p className="text-sm leading-relaxed text-muted">
                    <Marked text={match.excerpt} term={term} />
                  </p>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Trecho com o termo em destaque. A comparacao e na forma dobrada (sem acento,
 * minuscula), a mesma da busca; como a dobra troca letra por letra, a posicao
 * achada vale no texto original.
 */
function Marked({ text, term }: { text: string; term: string }) {
  const folded = Array.from(text.toLowerCase())
    .map((char) => foldForSearch(char) || char)
    .join("");
  const needle = foldForSearch(term);
  const at = folded.indexOf(needle);
  if (at < 0 || folded.length !== text.length) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark className="rounded bg-accent-soft px-0.5 text-ink">{text.slice(at, at + needle.length)}</mark>
      {text.slice(at + needle.length)}
    </>
  );
}
