/**
 * Regras da navegacao principal (APP-6, US-229). Funcoes puras, com teste.
 *
 * A barra de baixo do celular e a coluna lateral do desktop mostram os mesmos
 * destinos, menos um: "Ajustes" so tem item proprio na lateral, onde ha
 * espaco. No celular ele mora dentro de "Voce", e a aba dele foi para
 * "Revisar", que e usada todo dia. Os icones ficam no componente
 * (`app-shell.tsx`); aqui esta o que da para testar sem navegador: que
 * destino acende em cada rota, o texto do selo e o nome acessivel da aba.
 */

import { itemsLabel } from "@/lib/daily-review";

export type NavId = "inicio" | "textos" | "revisar" | "voce" | "ajustes";

export interface NavDestination {
  id: NavId;
  href: string;
  label: string;
  /** Rotas que acendem o destino mesmo fora do caminho dele. */
  also: readonly string[];
}

const HOME: NavDestination = { id: "inicio", href: "/dashboard", label: "Início", also: [] };

const TEXTS: NavDestination = { id: "textos", href: "/textos", label: "Textos", also: [] };

/**
 * Revisao do dia (US-229). So `/revisar` acende a aba: as revisoes dedicadas
 * (`/palavras/revisar`, `/textos/destaques/revisar`,
 * `/textos/[id]/estudar/revisar`) continuam acendendo o destino de onde se
 * chega a elas e para onde a seta de voltar de cada uma leva. Acender
 * "Revisar" nelas faria a aba acesa mudar ao tocar em voltar, e tocar na aba
 * acesa levaria a uma tela diferente da que esta aberta.
 *
 * A revisao so de destaques mora sob `/textos`, mas chega-se a ela pela tela
 * "Destaques e notas" (US-224), que e de "Voce": por isso `/textos/destaques`
 * esta na lista emprestada de "Voce", e o caminho mais longo vence "Textos".
 */
const REVIEW: NavDestination = { id: "revisar", href: "/revisar", label: "Revisar", also: [] };

/**
 * Hub pessoal (APP-6): junta as telas de progresso, que so eram alcancaveis
 * por Ajustes. `/destaques` e a tela "Destaques e notas"; `/ajustes` acende
 * "Voce" onde Ajustes nao tem item proprio (o celular).
 */
const YOU: NavDestination = {
  id: "voce",
  href: "/voce",
  label: "Você",
  also: [
    "/historico",
    "/estatisticas",
    "/palavras",
    "/treino",
    "/destaques",
    "/textos/destaques",
    "/ajustes",
  ],
};

const SETTINGS: NavDestination = { id: "ajustes", href: "/ajustes", label: "Ajustes", also: [] };

/** Barra de baixo do celular; o botao de importar fica no meio, entre os pares. */
export const MOBILE_NAV = [HOME, TEXTS, REVIEW, YOU] as const;

/** Coluna lateral do desktop: ha espaco para Ajustes ter item proprio. */
export const DESKTOP_NAV = [HOME, TEXTS, REVIEW, YOU, SETTINGS] as const;

/** A rota e o proprio caminho ou esta abaixo dele. */
export function matchesRoute(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Quanto um destino "casa" com a rota; zero quando nao casa.
 *
 * O caminho mais longo vence, e no empate o caminho proprio vence o
 * emprestado (`also`): na lateral, `/ajustes` casa com "Ajustes" pelo caminho
 * proprio e com "Voce" pelo emprestado, e quem acende e "Ajustes".
 */
function matchScore(pathname: string, item: NavDestination): number {
  let score = matchesRoute(pathname, item.href) ? item.href.length * 2 + 1 : 0;
  for (const route of item.also) {
    if (matchesRoute(pathname, route)) score = Math.max(score, route.length * 2);
  }
  return score;
}

/**
 * Destino aceso na rota, entre os que a barra mostra: um so, ou nenhum
 * (o leitor, o compartilhamento). Depende da lista porque a mesma rota
 * acende destinos diferentes no celular e no desktop (`/ajustes`).
 */
export function activeDestination(
  pathname: string,
  items: readonly NavDestination[]
): NavId | null {
  let active: NavId | null = null;
  let best = 0;
  for (const item of items) {
    const score = matchScore(pathname, item);
    if (score > best) {
      best = score;
      active = item.id;
    }
  }
  return active;
}

/* --- selo da aba "Revisar" (US-229) ----------------------------------------- */

/**
 * Evento de janela que a Revisao do dia dispara quando um item sai da conta
 * de vencidos (respondido ou tirado da revisao): a barra busca o numero de
 * novo sem esperar a troca de rota, e o selo cai junto com a fila.
 */
export const REVIEW_CHANGED_EVENT = "rk-leitura:revisao-mudou";

/** Maior numero que cabe no selo; acima dele o selo mostra "99+". */
export const BADGE_MAX = 99;

/**
 * Contagem que veio da rota, pronta para o selo: inteiro de 1 para cima, ou
 * zero para qualquer outra coisa (resposta sem o campo, negativo, texto).
 * Zero e "sem selo", entao uma resposta estranha nunca vira numero na tela.
 */
export function dueCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 1 ? Math.floor(value) : 0;
}

/** Texto do selo: o numero, "99+" acima de 99, e null (sem selo) com zero. */
export function badgeText(total: number): string | null {
  const count = dueCount(total);
  if (count === 0) return null;
  return count > BADGE_MAX ? `${BADGE_MAX}+` : `${count}`;
}

/**
 * Nome acessivel da aba com selo: "Revisar, 12 itens vencidos".
 *
 * O selo e so visual e o "99+" esconde o numero; o leitor de tela ouve a
 * contagem inteira. Sem itens, o nome e o proprio rotulo. O rotulo vem
 * primeiro para o nome continuar comecando pelo texto que esta na tela.
 */
export function destinationName(label: string, total: number): string {
  const count = dueCount(total);
  if (count === 0) return label;
  return `${label}, ${itemsLabel(count)} ${count === 1 ? "vencido" : "vencidos"}`;
}
