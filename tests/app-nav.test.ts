import { describe, expect, it } from "vitest";
import {
  activeDestination,
  BADGE_MAX,
  badgeText,
  DESKTOP_NAV,
  destinationName,
  dueCount,
  matchesRoute,
  MOBILE_NAV,
} from "@/lib/app-nav";

const mobile = (pathname: string) => activeDestination(pathname, MOBILE_NAV);
const desktop = (pathname: string) => activeDestination(pathname, DESKTOP_NAV);

describe("destinos da navegacao principal (US-229)", () => {
  it("celular tem Inicio, Textos, Revisar e Voce; Ajustes so na lateral", () => {
    expect(MOBILE_NAV.map((item) => item.label)).toEqual(["Início", "Textos", "Revisar", "Você"]);
    expect(DESKTOP_NAV.map((item) => item.label)).toEqual([
      "Início",
      "Textos",
      "Revisar",
      "Você",
      "Ajustes",
    ]);
    expect(MOBILE_NAV.find((item) => item.id === "revisar")?.href).toBe("/revisar");
  });

  it("a rota casa com o proprio caminho e com o que esta abaixo dele", () => {
    expect(matchesRoute("/textos", "/textos")).toBe(true);
    expect(matchesRoute("/textos/novo", "/textos")).toBe(true);
    // Prefixo de nome nao e caminho: "/textosx" nao esta dentro de "/textos".
    expect(matchesRoute("/textosx", "/textos")).toBe(false);
    expect(matchesRoute("/", "/textos")).toBe(false);
  });
});

describe("destino aceso (US-229)", () => {
  it("cada destino acende no proprio caminho e abaixo dele", () => {
    expect(mobile("/dashboard")).toBe("inicio");
    expect(mobile("/textos")).toBe("textos");
    expect(mobile("/textos/novo")).toBe("textos");
    expect(mobile("/revisar")).toBe("revisar");
    expect(mobile("/voce")).toBe("voce");
  });

  it("Voce acende nas telas do hub, em Destaques e notas e em Ajustes", () => {
    for (const path of [
      "/historico",
      "/estatisticas",
      "/palavras",
      "/treino",
      "/destaques",
      "/ajustes",
    ]) {
      expect(mobile(path), path).toBe("voce");
    }
  });

  it("a Revisao do dia deixou de acender Voce", () => {
    expect(mobile("/revisar")).not.toBe("voce");
    expect(desktop("/revisar")).toBe("revisar");
  });

  it("revisoes dedicadas ficam no destino para onde a seta de voltar leva", () => {
    expect(mobile("/palavras/revisar")).toBe("voce");
    // A seta volta para "Destaques e notas" (US-224), que e de Voce.
    expect(mobile("/textos/destaques/revisar")).toBe("voce");
    expect(mobile("/textos/abc/estudar/revisar")).toBe("textos");
    expect(desktop("/palavras/revisar")).toBe("voce");
    expect(desktop("/textos/destaques/revisar")).toBe("voce");
  });

  it("destaques de um texto sao de Textos; a tela geral e de Voce", () => {
    expect(mobile("/textos/abc/destaques")).toBe("textos");
    expect(mobile("/destaques")).toBe("voce");
  });

  it("na lateral Ajustes tem item proprio e e ele que acende", () => {
    expect(desktop("/ajustes")).toBe("ajustes");
    expect(mobile("/ajustes")).toBe("voce");
    // O resto do hub continua em Voce nas duas.
    expect(desktop("/estatisticas")).toBe("voce");
    expect(desktop("/destaques")).toBe("voce");
  });

  it("um destino aceso por vez, em qualquer rota", () => {
    const routes = [
      "/dashboard",
      "/textos",
      "/textos/destaques/revisar",
      "/revisar",
      "/voce",
      "/palavras/revisar",
      "/destaques",
      "/ajustes",
    ];
    for (const list of [MOBILE_NAV, DESKTOP_NAV]) {
      for (const route of routes) {
        const active = activeDestination(route, list);
        expect(list.filter((item) => item.id === active), route).toHaveLength(1);
      }
    }
  });

  it("fora dos destinos nada acende", () => {
    expect(mobile("/leitor/abc")).toBeNull();
    expect(mobile("/compartilhar")).toBeNull();
    expect(mobile("/")).toBeNull();
    // Nome parecido nao e a rota.
    expect(mobile("/revisar-depois")).toBeNull();
  });
});

describe("selo da aba Revisar (US-229)", () => {
  it("mostra o numero de itens vencidos", () => {
    expect(badgeText(1)).toBe("1");
    expect(badgeText(12)).toBe("12");
    expect(badgeText(BADGE_MAX)).toBe("99");
  });

  it('acima de 99 mostra "99+"', () => {
    expect(badgeText(100)).toBe("99+");
    expect(badgeText(1234)).toBe("99+");
  });

  it("com zero nao ha selo", () => {
    expect(badgeText(0)).toBeNull();
    expect(badgeText(-3)).toBeNull();
    expect(badgeText(Number.NaN)).toBeNull();
  });

  it("resposta estranha da rota conta como zero", () => {
    expect(dueCount(7)).toBe(7);
    expect(dueCount(7.9)).toBe(7);
    expect(dueCount(0)).toBe(0);
    expect(dueCount(-1)).toBe(0);
    expect(dueCount("7")).toBe(0);
    expect(dueCount(undefined)).toBe(0);
    expect(dueCount(null)).toBe(0);
    expect(dueCount(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it("nome acessivel traz a contagem inteira, no singular e no plural", () => {
    expect(destinationName("Revisar", 12)).toBe("Revisar, 12 itens vencidos");
    expect(destinationName("Revisar", 1)).toBe("Revisar, 1 item vencido");
    // O selo corta em "99+"; quem ouve recebe o numero.
    expect(destinationName("Revisar", 150)).toBe("Revisar, 150 itens vencidos");
  });

  it("sem itens o nome e so o rotulo", () => {
    expect(destinationName("Revisar", 0)).toBe("Revisar");
  });
});
