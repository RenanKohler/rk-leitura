/**
 * Defesa contra injecao de formula em planilhas (US-186).
 *
 * Excel, LibreOffice e Google Sheets interpretam uma celula que comeca com `=`,
 * `+`, `-` ou `@` como formula - e tab ou CR no inicio tambem disparam em
 * algumas versoes. Um titulo de pagina importada como `=HYPERLINK(...)` viraria
 * um link clicavel ou coisa pior. O apostrofo no inicio faz a planilha tratar a
 * celula como texto e nao aparece no valor exibido.
 */
const FORMULA_START = /^[=+\-@\t\r]/;

export function neutralizeFormula(value: string): string {
  return FORMULA_START.test(value) ? `'${value}` : value;
}

/** Celula sempre entre aspas, com aspas internas duplicadas. */
export function quotedCell(value: string): string {
  return `"${neutralizeFormula(value).replace(/"/g, '""')}"`;
}
