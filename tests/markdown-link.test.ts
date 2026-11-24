import { describe, expect, it } from "vitest";
import {
  frontMatterField,
  isMarkdownResponse,
  markdownFromBrowserView,
  titleFromMarkdownPath,
} from "@/lib/markdown-link";
import { documentFromHtml, documentFromMarkdown, importReceivedPages, ImportError } from "@/lib/import-text";
import { parseParagraphs } from "@/lib/reading";

/**
 * Link direto para um arquivo .md: o texto e salvo como Markdown e o leitor
 * interpreta as marcas, em vez de mostrar `#` e `**` crus.
 */

const RAW = "https://raw.githubusercontent.com/exemplo/projeto/main/docs/guia-de-estilo.md";

const SOURCE = [
  "# Guia de estilo",
  "",
  "Este guia reúne as **regras principais** de escrita do projeto, com _exemplos_ curtos.",
  "",
  "## Listas",
  "",
  "- Use frases curtas e diretas em cada item.",
  "- Veja a [documentação completa](https://exemplo.com/docs) antes de começar.",
].join("\n");

describe("isMarkdownResponse", () => {
  it("reconhece o tipo declarado", () => {
    expect(isMarkdownResponse("text/markdown; charset=utf-8", "https://x.example/nota")).toBe(true);
    expect(isMarkdownResponse("text/x-markdown", "https://x.example/nota")).toBe(true);
  });

  it("aceita texto simples ou sem tipo quando o caminho e .md", () => {
    expect(isMarkdownResponse("text/plain; charset=utf-8", RAW)).toBe(true);
    expect(isMarkdownResponse("", `${RAW}?token=abc`)).toBe(true);
    expect(isMarkdownResponse("text/plain", "https://x.example/README.markdown")).toBe(true);
  });

  it("pagina HTML continua sendo pagina, mesmo com .md no caminho", () => {
    expect(isMarkdownResponse("text/html", "https://github.com/exemplo/projeto/blob/main/README.md")).toBe(
      false
    );
    expect(isMarkdownResponse("text/plain", "https://x.example/notas.txt")).toBe(false);
  });
});

describe("titleFromMarkdownPath e frontMatterField", () => {
  it("usa o nome do arquivo sem extensao", () => {
    expect(titleFromMarkdownPath(RAW)).toBe("guia de estilo");
    expect(titleFromMarkdownPath("https://x.example/notas%20de%20aula.md")).toBe("notas de aula");
  });

  it("le titulo e autor do front matter", () => {
    const source = '---\ntitle: "Notas da semana"\nauthor: Ana Souza\n---\n\n# Outro título';
    expect(frontMatterField(source, "title")).toBe("Notas da semana");
    expect(frontMatterField(source, "author")).toBe("Ana Souza");
    expect(frontMatterField("# Sem front matter", "title")).toBeNull();
  });
});

describe("documentFromMarkdown", () => {
  it("guarda o texto com as marcas e marca o formato", () => {
    const document = documentFromMarkdown(`﻿${SOURCE.replace(/\n/g, "\r\n")}`, RAW);
    expect(document.format).toBe("markdown");
    expect(document.title).toBe("Guia de estilo");
    expect(document.content).toContain("**regras principais**");
    expect(document.content).not.toContain("\r");
    expect(document.extraction).toBe("exata");
  });

  it("conta so as palavras, sem os simbolos de formatacao", () => {
    const document = documentFromMarkdown(SOURCE, RAW);
    const { words } = parseParagraphs(document.content, "markdown");
    expect(document.wordCount).toBe(words.length);
    expect(words).not.toContain("#");
    expect(words).not.toContain("-");
    expect(words.join(" ")).toContain("documentação completa antes");
  });

  it("titulo pelo front matter vence o primeiro titulo", () => {
    const document = documentFromMarkdown(`---\ntitle: Capa\nauthor: Ana\n---\n\n${SOURCE}`, RAW);
    expect(document.title).toBe("Capa");
    expect(document.author).toBe("Ana");
  });

  it("sem titulo no texto, usa o nome do arquivo", () => {
    const document = documentFromMarkdown(SOURCE.replace(/^#+ .*$/gm, ""), RAW);
    expect(document.title).toBe("guia de estilo");
  });

  it("arquivo quase vazio e recusado", () => {
    expect(() => documentFromMarkdown("# Oi", RAW)).toThrow(ImportError);
  });
});

describe("arquivo .md aberto no navegador", () => {
  const view = (text: string) =>
    `<html><head><meta name="color-scheme" content="light dark"></head><body><pre style="word-wrap: break-word; white-space: pre-wrap;">${text}</pre></body></html>`;

  it("o <pre> unico vira o texto do arquivo", () => {
    expect(markdownFromBrowserView(view("# Título\n\nTexto"), RAW)).toBe("# Título\n\nTexto");
    expect(markdownFromBrowserView(view("# Título"), "https://x.example/artigo")).toBeNull();
    expect(
      markdownFromBrowserView("<html><body><nav>menu</nav><pre>x</pre></body></html>", RAW)
    ).toBeNull();
  });

  it("documentFromHtml e o favorito salvam como Markdown", async () => {
    const escaped = SOURCE.replace(/</g, "&lt;");
    expect(documentFromHtml(view(escaped), RAW).format).toBe("markdown");

    const received = await importReceivedPages(RAW, [view(escaped)]);
    expect(received.format).toBe("markdown");
    expect(received.title).toBe("Guia de estilo");
    expect("pages" in received).toBe(false);
  });

  it("pagina comum continua texto simples", () => {
    const html =
      "<html><head><title>Artigo</title></head><body><article><p>" +
      "Um parágrafo comum de artigo, com palavras suficientes para a importação aceitar o texto." +
      "</p></article></body></html>";
    expect(documentFromHtml(html, "https://x.example/artigo").format).toBe("plain");
  });
});
