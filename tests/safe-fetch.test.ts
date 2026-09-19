import { describe, expect, it } from "vitest";
import { isPrivateAddress } from "@/lib/safe-fetch";

/**
 * A importacao faz o servidor buscar um endereco escolhido por quem usa. Estes
 * testes fixam a fronteira entre publico e interno, que e o que impede a
 * aplicacao de virar uma janela para a rede de dentro.
 */

describe("isPrivateAddress: IPv4", () => {
  it("recusa as faixas internas", () => {
    for (const ip of [
      "0.0.0.0",
      "10.0.0.1",
      "100.64.0.1", // CGNAT
      "127.0.0.1",
      "169.254.169.254", // metadados de nuvem
      "172.16.0.1",
      "172.31.255.255",
      "192.0.0.1",
      "192.168.1.1",
      "198.18.0.1",
      "224.0.0.1", // multicast
      "255.255.255.255",
    ]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
  });

  it("aceita enderecos publicos", () => {
    for (const ip of ["1.1.1.1", "8.8.8.8", "172.15.0.1", "172.32.0.1", "199.232.1.1"]) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
  });
});

describe("isPrivateAddress: IPv6", () => {
  it("recusa loopback, nao especificado e faixas reservadas", () => {
    for (const ip of [
      "::",
      "::1",
      "fc00::1", // unique local
      "fd12:3456::1",
      "fe80::1", // link local
      "ff02::1", // multicast
      "2001:db8::1", // documentacao
    ]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
  });

  it("enxerga o IPv4 embutido nas formas mapeada e compativel", () => {
    // `new URL()` normaliza "::ffff:127.0.0.1" para "::ffff:7f00:1"; comparar
    // prefixos em texto deixaria passar exatamente a forma que um atacante
    // usaria para alcancar a rede interna.
    expect(isPrivateAddress("::ffff:7f00:1")).toBe(true);
    expect(isPrivateAddress("::ffff:127.0.0.1")).toBe(true);
    expect(isPrivateAddress("::ffff:a9fe:a9fe")).toBe(true); // 169.254.169.254
    expect(isPrivateAddress("::ffff:c0a8:1")).toBe(true); // 192.168.0.1
    expect(isPrivateAddress("::127.0.0.1")).toBe(true);
    expect(isPrivateAddress("64:ff9b::7f00:1")).toBe(true); // NAT64
  });

  it("aceita IPv6 publico, inclusive com IPv4 publico embutido", () => {
    expect(isPrivateAddress("2606:4700:4700::1111")).toBe(false);
    expect(isPrivateAddress("::ffff:8.8.8.8")).toBe(false);
  });
});

describe("isPrivateAddress: entradas invalidas", () => {
  it("trata o que nao consegue interpretar como interno", () => {
    for (const value of ["", "nao e ip", "999.999.999.999", "::ffff::1", "127.0.0.1.1"]) {
      expect(isPrivateAddress(value), value).toBe(true);
    }
  });
});
