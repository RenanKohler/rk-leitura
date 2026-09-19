import { describe, expect, it } from "vitest";
import { extractTextFromHtml } from "@/lib/parser";

/**
 * A extracao e a parte mais fragil da importacao: ela adivinha, em HTML
 * arbitrario, onde termina o entorno da pagina e comeca o texto. Cada teste
 * daqui corresponde a um caminho da funcao ou a um defeito ja corrigido.
 */

/** Paragrafos longos o bastante para o container ser aceito (>400 caracteres). */
const CORPO = [
  "Ela chegou a cabana no fim da tarde, quando a luz ja atravessava as arvores de lado e o ar cheirava a terra molhada.",
  "A estrada de chao tinha marcas de pneu recentes, e isso a deixou desconfiada o suficiente para parar o carro antes do portao.",
  "Do lado de dentro, a casa estava do jeito que ela havia deixado no verao anterior, com a mesma cadeira virada para a janela.",
  "Ela guardou as chaves no bolso, respirou fundo e empurrou a porta, que cedeu sem fazer barulho nenhum.",
];

const pagina = (corpo: string) => `<!doctype html><html><head><title>Teste</title></head><body>${corpo}</body></html>`;
const paragrafos = (linhas: string[]) => linhas.map((linha) => `<p>${linha}</p>`).join("");

describe("extractTextFromHtml: escolha do container", () => {
  it("usa o corpo declarado em JSON-LD antes de qualquer container do HTML", () => {
    // Ordem real da funcao: JSON-LD vence o microdado, nao o contrario.
    const html = pagina(`
      <script type="application/ld+json">${JSON.stringify({
        "@type": "Article",
        headline: "Vindo do JSON-LD",
        articleBody: CORPO.join("\n\n"),
      })}</script>
      <div itemprop="articleBody">${paragrafos(["Este corpo do HTML nao deveria ser escolhido, e ele e longo o bastante para concorrer com o outro caminho da funcao de extracao."])}</div>
    `);

    const resultado = extractTextFromHtml(html);
    expect(resultado.title).toBe("Vindo do JSON-LD");
    expect(resultado.content).toContain("Ela chegou a cabana");
    expect(resultado.content).not.toContain("nao deveria ser escolhido");
  });

  it("le o @graph e ignora JSON-LD malformado na mesma pagina", () => {
    const html = pagina(`
      <script type="application/ld+json">{ isto nao e json }</script>
      <script type="application/ld+json">${JSON.stringify({
        "@graph": [
          { "@type": "WebPage", name: "Titulo da pagina | Nome do Site" },
          { "@type": "Article", headline: "Titulo do conto", articleBody: CORPO.join("\n\n") },
        ],
      })}</script>
    `);

    const resultado = extractTextFromHtml(html);
    // `headline` do Article vence `name` do WebPage, que carrega o sufixo do site.
    expect(resultado.title).toBe("Titulo do conto");
    expect(resultado.content).toContain("Ela guardou as chaves");
  });

  it("usa o microdado articleBody quando nao ha JSON-LD", () => {
    const html = pagina(`
      <div class="ads">${paragrafos(["Anuncio que aparecia antes do conto e entrava no texto importado, atrapalhando a leitura desde a primeira palavra."])}</div>
      <div itemprop="articleBody">${paragrafos(CORPO)}</div>
    `);

    const resultado = extractTextFromHtml(html);
    expect(resultado.content).toContain("Ela chegou a cabana");
    expect(resultado.content).not.toContain("Anuncio");
  });

  it("cai para <article> quando nao ha microdado", () => {
    const html = pagina(`<article>${paragrafos(CORPO)}</article>`);
    expect(extractTextFromHtml(html).content).toContain("Ela chegou a cabana");
  });

  it("cai para o palpite pelo maior container quando nao ha marcador nenhum", () => {
    const html = pagina(`<div class="post-content">${paragrafos(CORPO)}</div>`);
    expect(extractTextFromHtml(html).content).toContain("Ela chegou a cabana");
  });
});

describe("extractTextFromHtml: conteudo", () => {
  it("preserva as falas curtas de dialogo no container exato", () => {
    // Regressao: um filtro por tamanho minimo apagava boa parte da ficcao.
    const html = pagina(`
      <div itemprop="articleBody">${paragrafos([...CORPO, "&mdash; Oi.", "&mdash; Voce veio.", "&mdash; Vim."])}</div>
    `);

    const conteudo = extractTextFromHtml(html).content;
    expect(conteudo).toContain("Oi.");
    expect(conteudo).toContain("Voce veio.");
    expect(conteudo).toContain("Vim.");
  });

  it("separa os paragrafos por linha em branco", () => {
    const html = pagina(`<div itemprop="articleBody">${paragrafos(CORPO)}</div>`);
    const blocos = extractTextFromHtml(html).content.split("\n\n");
    expect(blocos).toHaveLength(CORPO.length);
    expect(blocos[0]).toBe(CORPO[0]);
  });

  it("remove menus, rodape e scripts", () => {
    const html = pagina(`
      <nav><p>Inicio Sobre Contato</p></nav>
      <div itemprop="articleBody">${paragrafos(CORPO)}</div>
      <footer><p>Todos os direitos reservados a quem publica este site aqui.</p></footer>
      <script>var x = "isto nao e texto";</script>
    `);

    const conteudo = extractTextFromHtml(html).content;
    expect(conteudo).not.toContain("Inicio Sobre Contato");
    expect(conteudo).not.toContain("direitos reservados");
    expect(conteudo).not.toContain("isto nao e texto");
  });

  it("descarta paragrafo feito so de links", () => {
    const html = pagina(`
      <div itemprop="articleBody">
        ${paragrafos(CORPO)}
        <p><a href="/1">Capitulo anterior</a> <a href="/3">Proximo capitulo</a></p>
      </div>
    `);

    expect(extractTextFromHtml(html).content).not.toContain("Proximo capitulo");
  });

  it("conta as palavras do que foi extraido", () => {
    const html = pagina(`<div itemprop="articleBody">${paragrafos(CORPO)}</div>`);
    const resultado = extractTextFromHtml(html);
    expect(resultado.wordCount).toBe(resultado.content.split(/\s+/).filter(Boolean).length);
  });
});

describe("extractTextFromHtml: titulo", () => {
  it("prefere og:title ao <title>", () => {
    const html = `<!doctype html><html><head>
      <title>Titulo da aba | Nome do Site</title>
      <meta property="og:title" content="Titulo de verdade">
    </head><body><div itemprop="articleBody">${paragrafos(CORPO)}</div></body></html>`;

    expect(extractTextFromHtml(html).title).toBe("Titulo de verdade");
  });

  it("remove o sufixo do site", () => {
    const html = `<!doctype html><html><head>
      <title>Uma historia na cabana | Nome do Jornal</title>
    </head><body><div itemprop="articleBody">${paragrafos(CORPO)}</div></body></html>`;

    expect(extractTextFromHtml(html).title).toBe("Uma historia na cabana");
  });

  it("mantem o titulo inteiro quando tirar o sufixo deixaria quase nada", () => {
    const html = `<!doctype html><html><head><title>Fim - Nome do Site</title></head>
      <body><div itemprop="articleBody">${paragrafos(CORPO)}</div></body></html>`;

    expect(extractTextFromHtml(html).title).toBe("Fim - Nome do Site");
  });

  it("usa um rotulo proprio quando nao ha titulo algum", () => {
    expect(extractTextFromHtml("<html><body><p>oi</p></body></html>").title).toBe("Sem titulo");
  });
});
