"use client";

import { joinParagraphs, dropRepeated, linesFromItems, type TextItem } from "@/lib/pdf-text";

/**
 * Leitura do PDF no navegador, com pdf.js.
 *
 * Fica separada das funcoes puras porque e aqui que mora a dependencia
 * pesada: o import dinamico mantem o pdf.js fora do pacote de quem nunca
 * importa um PDF.
 */
export async function extractPdf(
  file: File,
  onPage?: (page: number, total: number) => void
): Promise<{ title: unknown; content: string; pages: number }> {
  const pdfjs = await import("pdfjs-dist");

  // O worker vem do proprio pacote: sem CDN, a importacao funciona offline e
  // nao depende de um dominio de terceiro carregar.
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url
  ).toString();

  const data = new Uint8Array(await file.arrayBuffer());
  const task = pdfjs.getDocument({ data });
  const document = await task.promise;

  const metadata = await document.getMetadata().catch(() => null);
  const pages: string[][] = [];

  for (let number = 1; number <= document.numPages; number += 1) {
    onPage?.(number, document.numPages);
    const page = await document.getPage(number);
    const content = await page.getTextContent();

    const items: TextItem[] = content.items
      .filter((item): item is typeof item & { str: string; transform: number[] } => "str" in item)
      .map((item) => ({
        text: item.str,
        x: item.transform[4] ?? 0,
        y: item.transform[5] ?? 0,
      }));

    pages.push(linesFromItems(items));
    page.cleanup();
  }

  const pages_count = document.numPages;
  // Libera o worker: sem isto, importar varios PDFs seguidos deixa uma thread
  // viva por arquivo.
  await task.destroy();

  return {
    title: (metadata?.info as { Title?: unknown } | undefined)?.Title,
    content: joinParagraphs(dropRepeated(pages)),
    pages: pages_count,
  };
}
