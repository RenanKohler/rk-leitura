/**
 * Confere, depois do `next build`, que o CSS gerado e o do codigo.
 *
 * Motivo: no deploy do design system M3 a Vercel restaurou o cache de build
 * do deploy anterior e o Turbopack entregou o CSS antigo. O HTML saiu novo
 * (classes novas) com o tema velho: barra de navegacao sem fundo, opcao
 * escolhida sem preenchimento. O build "passou" e a pagina quebrada foi ao ar.
 *
 * A conferencia: cada papel de cor `--md-sys-color-*` declarado em
 * `src/app/globals.css` tem de aparecer, com o mesmo valor, em algum CSS de
 * `.next/static`. Se nao aparecer, o build falha e o deploy nao acontece.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** Declaracoes `--md-sys-color-nome: #valor` do CSS de origem, sem repeticao. */
export function colorRoles(source) {
  const found = new Set();
  for (const match of source.matchAll(/(--md-sys-color-[a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\s*;/g)) {
    found.add(`${match[1]}:${match[2].toLowerCase()}`);
  }
  return [...found];
}

/**
 * Papeis do codigo que nao estao no CSS gerado. O CSS minificado tira os
 * espacos e pode abreviar a cor (#ffffff vira #fff): a comparacao aceita as
 * duas formas.
 */
export function missingRoles(source, built) {
  const compact = built.replace(/\s+/g, "").toLowerCase();
  return colorRoles(source).filter((declaration) => {
    const [name, value] = declaration.split(":");
    return ![value, shortHex(value)].some((form) => compact.includes(`${name}:${form}`));
  });
}

/** #aabbcc como #abc, quando da; senao a propria cor. */
function shortHex(value) {
  const hex = value.slice(1);
  if (hex.length !== 6) return value;
  const [a, b, c, d, e, f] = hex;
  return a === b && c === d && e === f ? `#${a}${c}${e}` : value;
}

function cssFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) files.push(...cssFiles(path));
    else if (entry.endsWith(".css")) files.push(path);
  }
  return files;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const source = readFileSync("src/app/globals.css", "utf8");
  const files = cssFiles(".next/static");
  const built = files.map((file) => readFileSync(file, "utf8")).join("\n");
  const missing = missingRoles(source, built);
  if (colorRoles(source).length === 0) {
    console.error("check-build-css: nenhum papel de cor em src/app/globals.css; a conferencia nao tem o que comparar.");
    process.exit(1);
  }
  if (missing.length > 0) {
    console.error(
      `check-build-css: o CSS gerado nao e o do codigo. ${missing.length} papel(is) de cor de src/app/globals.css nao estao em .next/static (${files.length} arquivo(s) .css):`
    );
    for (const declaration of missing.slice(0, 8)) console.error(`  ${declaration}`);
    console.error("Provavel cache de build antigo. Refaca o build sem cache.");
    process.exit(1);
  }
  console.log(`check-build-css: ${colorRoles(source).length} papeis de cor conferidos em ${files.length} arquivo(s) .css.`);
}
