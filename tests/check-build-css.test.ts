import { describe, expect, it } from "vitest";
import { colorRoles, missingRoles } from "../scripts/check-build-css.mjs";

const SOURCE = `
  :root {
    --md-sys-color-primary: #1e6a4f;
    --md-sys-color-on-primary: #ffffff;
  }
  :root[data-theme="dark"] {
    --md-sys-color-primary: #8cd5b3;
    --md-sys-color-on-primary: #003826;
  }
  --color-accent: var(--md-sys-color-primary);
`;

describe("conferencia do CSS gerado no build", () => {
  it("le os papeis de cor do codigo, um por valor", () => {
    expect(colorRoles(SOURCE)).toEqual([
      "--md-sys-color-primary:#1e6a4f",
      "--md-sys-color-on-primary:#ffffff",
      "--md-sys-color-primary:#8cd5b3",
      "--md-sys-color-on-primary:#003826",
    ]);
  });

  it("CSS minificado com os mesmos valores passa, inclusive com a cor abreviada", () => {
    const built =
      ":root{--md-sys-color-primary:#1e6a4f;--md-sys-color-on-primary:#fff}:root[data-theme=dark]{--md-sys-color-primary:#8cd5b3;--md-sys-color-on-primary:#003826}";
    expect(missingRoles(SOURCE, built)).toEqual([]);
  });

  it("CSS de um build antigo, sem os papeis, e apontado", () => {
    const stale = ":root{--color-bg:#f6f5f2;--color-accent:#bf3d1a}:root[data-theme=dark]{--color-bg:#0e0f11}";
    expect(missingRoles(SOURCE, stale)).toHaveLength(4);
  });

  it("um tema so desatualizado tambem e apontado", () => {
    const partial =
      ":root{--md-sys-color-primary:#1e6a4f;--md-sys-color-on-primary:#fff}:root[data-theme=dark]{--md-sys-color-primary:#ff6b3d;--md-sys-color-on-primary:#003826}";
    expect(missingRoles(SOURCE, partial)).toEqual(["--md-sys-color-primary:#8cd5b3"]);
  });
});
