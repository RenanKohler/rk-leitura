/**
 * Tema: preferencia, chave do cache local e o script que aplica o tema antes
 * da primeira pintura.
 *
 * Fora de `providers.tsx` porque o layout raiz, que e componente de servidor,
 * precisa montar o script: o que sai de um modulo "use client" chega ao
 * servidor como referencia de cliente, nao como funcao que ele possa chamar.
 */

export type ThemePreference = "system" | "light" | "dark" | "contrast";
export type ResolvedTheme = "light" | "dark" | "contrast";

export const THEME_STORAGE_KEY = "rk-leitura:theme";

const THEME_PREFERENCES: readonly ThemePreference[] = ["system", "light", "dark", "contrast"];

function asThemePreference(value: unknown): ThemePreference | null {
  return THEME_PREFERENCES.includes(value as ThemePreference) ? (value as ThemePreference) : null;
}

/**
 * Script inline executado antes da primeira pintura. Sem ele a pagina aparece
 * clara por um quadro antes do tema escuro ser aplicado. Repete a regra de
 * `resolveTheme` (providers.tsx), que nao pode ser importada por um script em
 * texto.
 *
 * Com sessao, o tema salvo na conta vem do servidor e vence (A11Y-14): antes a
 * preferencia so vivia no localStorage, e quem escolhia Escuro no celular
 * abria o computador no tema claro. O localStorage passa a ser cache - o
 * script o semeia com o valor da conta, e o ThemeProvider segue lendo dele.
 * "Sistema" so se resolve aqui, no navegador, que e quem sabe o que o sistema
 * pede.
 */
export function themeBootstrapScript(account: unknown = null): string {
  const chosen = asThemePreference(account);
  const key = JSON.stringify(THEME_STORAGE_KEY);
  return `(function(){var a=${JSON.stringify(chosen)},p=a||"system";try{if(a)localStorage.setItem(${key},a);else p=localStorage.getItem(${key})||"system"}catch(e){}try{var m=function(q){return window.matchMedia(q).matches};var t=p==="contrast"||(p==="system"&&m("(prefers-contrast: more)"))?"contrast":p==="dark"||(p==="system"&&m("(prefers-color-scheme: dark)"))?"dark":"light";document.documentElement.dataset.theme=t;}catch(e){}})();`;
}

/**
 * Tema que o servidor ja sabe aplicar no HTML: so as escolhas explicitas.
 * "Sistema" fica para o script, que consulta a media query.
 */
export function serverTheme(account: unknown): ResolvedTheme | undefined {
  const chosen = asThemePreference(account);
  return chosen && chosen !== "system" ? chosen : undefined;
}
