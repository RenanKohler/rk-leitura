"use client";

import {
  bodySizeOf,
  layoutPage,
  pagesToMarkdown,
  stripRunningLines,
  type PdfItem,
} from "@/lib/pdf-layout";

/**
 * Leitura do PDF no navegador, com pdf.js.
 *
 * Fica separada das funcoes puras porque e aqui que mora a dependencia
 * pesada: o import dinamico mantem o pdf.js fora do pacote de quem nunca
 * importa um PDF.
 *
 * O conteudo sai em Markdown: a ordem de leitura respeita as colunas e os
 * titulos do documento chegam ao leitor como titulos.
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
  const pages: PdfItem[][] = [];

  for (let number = 1; number <= document.numPages; number += 1) {
    onPage?.(number, document.numPages);
    const page = await document.getPage(number);
    const content = await page.getTextContent();

    const items: PdfItem[] = content.items
      .filter((item): item is typeof item & { str: string; transform: number[] } => "str" in item)
      // Texto girado e a tarja da margem ("Downloaded from...", numero de
      // linha vertical): nao faz parte da leitura e baguncaria as colunas.
      .filter((item) => {
        const [a = 1, b = 0] = item.transform;
        return Math.abs(b) <= Math.abs(a) * 0.05 && a > 0;
      })
      .map((item) => ({
        text: item.str,
        x: item.transform[4] ?? 0,
        y: item.transform[5] ?? 0,
        width: "width" in item && typeof item.width === "number" ? item.width : 0,
        size: Math.abs(item.transform[3] ?? 0) || ("height" in item ? Number(item.height) : 0) || 10,
      }));

    pages.push(items);
    page.cleanup();
  }

  const pageCount = document.numPages;
  // Libera o worker: sem isto, importar varios PDFs seguidos deixa uma thread
  // viva por arquivo.
  await task.destroy();

  // O corpo do texto e medido no documento inteiro: uma pagina so de titulo
  // teria o titulo como "corpo" e nao o reconheceria.
  const clean = stripRunningLines(pages);
  const bodySize = bodySizeOf(clean);

  return {
    title: (metadata?.info as { Title?: unknown } | undefined)?.Title,
    content: pagesToMarkdown(
      clean.map((items) => layoutPage(items, bodySize)),
      bodySize
    ),
    pages: pageCount,
  };
}
