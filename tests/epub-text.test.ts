import { describe, expect, it } from "vitest";
import {
  baseDir,
  chapterText,
  chapterTitle,
  decodeEntities,
  EpubError,
  opfPath,
  parseOpf,
  parseToc,
  resolvePath,
} from "@/lib/epub-text";

const CONTAINER = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`;

const OPF = `<?xml version="1.0"?>
<package version="3.0">
  <metadata>
    <dc:title>A cabana no inverno</dc:title>
    <dc:creator>Marina Alves</dc:creator>
  </metadata>
  <manifest>
    <item id="capa" href="capa.xhtml" media-type="application/xhtml+xml"/>
    <item id="c1" href="texto/cap1.xhtml" media-type="application/xhtml+xml"/>
    <item id="c2" href="texto/cap2.xhtml" media-type="application/xhtml+xml"/>
    <item id="css" href="estilo.css" media-type="text/css"/>
  </manifest>
  <spine>
    <itemref idref="capa"/>
    <itemref idref="c1"/>
    <itemref idref="c2"/>
  </spine>
</package>`;

describe("opfPath", () => {
  it("le o caminho do indice no container", () => {
    expect(opfPath(CONTAINER)).toBe("OEBPS/content.opf");
  });

  it("recusa arquivo sem container valido", () => {
    expect(() => opfPath("<nada/>")).toThrow(EpubError);
  });
});

describe("caminhos", () => {
  it("baseDir devolve o diretorio do indice", () => {
    expect(baseDir("OEBPS/content.opf")).toBe("OEBPS/");
    expect(baseDir("content.opf")).toBe("");
  });

  it("resolve relativos e sobe com ..", () => {
    expect(resolvePath("OEBPS/", "texto/cap1.xhtml")).toBe("OEBPS/texto/cap1.xhtml");
    expect(resolvePath("OEBPS/texto/", "../imagens/a.xhtml")).toBe("OEBPS/imagens/a.xhtml");
  });

  it("descarta a ancora e decodifica o caminho", () => {
    expect(resolvePath("OEBPS/", "cap%201.xhtml#inicio")).toBe("OEBPS/cap 1.xhtml");
  });
});

describe("parseOpf", () => {
  it("le titulo, autor e a ordem do spine", () => {
    const index = parseOpf(OPF, "OEBPS/");
    expect(index.title).toBe("A cabana no inverno");
    expect(index.author).toBe("Marina Alves");
    expect(index.spine).toEqual([
      "OEBPS/capa.xhtml",
      "OEBPS/texto/cap1.xhtml",
      "OEBPS/texto/cap2.xhtml",
    ]);
  });

  it("ignora o que nao e capitulo", () => {
    expect(parseOpf(OPF, "OEBPS/").spine.some((p) => p.endsWith(".css"))).toBe(false);
  });

  it("recusa livro com protecao de copia", () => {
    expect(() => parseOpf(`<encryption/>${OPF}`, "")).toThrow(/protecao de copia/i);
  });

  it("recusa livro sem capitulos", () => {
    expect(() => parseOpf("<package><manifest/><spine/></package>", "")).toThrow(EpubError);
  });
});

describe("parseToc", () => {
  it("le o sumario do EPUB 2", () => {
    const ncx = `<navMap>
      <navPoint><navLabel><text>Capitulo um</text></navLabel><content src="texto/cap1.xhtml"/></navPoint>
      <navPoint><navLabel><text>Capitulo dois</text></navLabel><content src="texto/cap2.xhtml"/></navPoint>
    </navMap>`;
    const titles = parseToc(ncx, "OEBPS/");
    expect(titles.get("OEBPS/texto/cap1.xhtml")).toBe("Capitulo um");
  });

  it("le o sumario do EPUB 3", () => {
    const nav = `<nav><ol><li><a href="texto/cap1.xhtml">Primeiro <span>capitulo</span></a></li></ol></nav>`;
    expect(parseToc(nav, "OEBPS/").get("OEBPS/texto/cap1.xhtml")).toBe("Primeiro capitulo");
  });
});

describe("chapterText", () => {
  it("preserva os paragrafos", () => {
    const xhtml = `<html><body><h1>Um</h1><p>Primeiro.</p><p>Segundo.</p></body></html>`;
    expect(chapterText(xhtml)).toBe("Um\n\nPrimeiro.\n\nSegundo.");
  });

  it("transforma quebra de linha em quebra simples", () => {
    expect(chapterText("<body><p>uma<br/>duas</p></body>")).toBe("uma\nduas");
  });

  it("descarta script, estilo e navegacao", () => {
    const xhtml = `<body><style>p{color:red}</style><script>alert(1)</script><p>texto</p></body>`;
    expect(chapterText(xhtml)).toBe("texto");
  });

  it("decodifica entidades", () => {
    expect(chapterText("<body><p>caf&#233; &amp; p&#xE3;o</p></body>")).toBe("café & pão");
  });

  it("nao deixa linhas em branco sobrando", () => {
    expect(chapterText("<body><p></p><p>a</p><div></div><p>b</p></body>")).toBe("a\n\nb");
  });
});

describe("chapterTitle", () => {
  it("usa o primeiro cabecalho do arquivo", () => {
    expect(chapterTitle("<body><h2>A chegada</h2><p>x</p></body>", "Parte 1")).toBe("A chegada");
  });

  it("cai no titulo de reserva quando nao ha cabecalho", () => {
    expect(chapterTitle("<body><p>x</p></body>", "Parte 1")).toBe("Parte 1");
  });
});

describe("decodeEntities", () => {
  it("deixa intacto o que nao e entidade", () => {
    expect(decodeEntities("a & b")).toBe("a & b");
    expect(decodeEntities("&naoexiste;")).toBe("&naoexiste;");
  });
});
