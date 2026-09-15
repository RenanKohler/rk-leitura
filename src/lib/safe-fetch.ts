import "server-only";

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Busca HTTP com protecao contra SSRF.
 *
 * A rota de importacao recebe uma URL arbitraria do usuario e a busca a partir
 * do servidor. Sem validacao isso permite alcancar a rede interna do provedor
 * (metadados em 169.254.169.254, bancos em 127.0.0.1, servicos privados).
 * Cada salto de redirecionamento e revalidado, porque so validar a URL inicial
 * deixa a porta aberta para um destino que redireciona para um IP interno.
 */

const MAX_REDIRECTS = 3;
const MAX_BYTES = 3 * 1024 * 1024;
const TIMEOUT_MS = 15_000;

export class SafeFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SafeFetchError";
  }
}

function ipv4ToLong(ip: string): number {
  return ip.split(".").reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

function isPrivateIpv4(ip: string): boolean {
  const value = ipv4ToLong(ip);
  const inRange = (cidr: string, bits: number) => {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (value & mask) === (ipv4ToLong(cidr) & mask);
  };

  return (
    inRange("0.0.0.0", 8) ||
    inRange("10.0.0.0", 8) ||
    inRange("100.64.0.0", 10) ||
    inRange("127.0.0.0", 8) ||
    inRange("169.254.0.0", 16) ||
    inRange("172.16.0.0", 12) ||
    inRange("192.0.0.0", 24) ||
    inRange("192.168.0.0", 16) ||
    inRange("198.18.0.0", 15) ||
    inRange("224.0.0.0", 4) ||
    inRange("240.0.0.0", 4)
  );
}

/**
 * Expande um IPv6 em seus 8 grupos de 16 bits.
 *
 * Necessario porque `new URL()` normaliza o endereco: "::ffff:127.0.0.1" chega
 * aqui como "::ffff:7f00:1". Comparar prefixos em texto deixa passar exatamente
 * a forma que um atacante usaria para alcancar 127.0.0.1 ou 169.254.169.254.
 */
function expandIpv6(ip: string): number[] | null {
  const address = ip.toLowerCase().replace(/^\[|\]$/g, "").split("%")[0]!;
  const [head, tail, ...rest] = address.split("::");
  if (rest.length > 0) return null;

  const parseGroups = (part: string | undefined): number[] | null => {
    if (!part) return [];
    const groups: number[] = [];

    for (const piece of part.split(":")) {
      if (piece.length === 0) return null;

      // Ultimo grupo pode vir em notacao decimal: ::ffff:127.0.0.1
      if (piece.includes(".")) {
        const octets = piece.split(".").map(Number);
        if (octets.length !== 4 || octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) {
          return null;
        }
        groups.push((octets[0]! << 8) | octets[1]!, (octets[2]! << 8) | octets[3]!);
        continue;
      }

      const value = Number.parseInt(piece, 16);
      if (Number.isNaN(value) || value < 0 || value > 0xffff) return null;
      groups.push(value);
    }

    return groups;
  };

  const left = parseGroups(head);
  const right = tail === undefined ? [] : parseGroups(tail);
  if (left === null || right === null) return null;

  if (tail === undefined) return left.length === 8 ? left : null;

  const missing = 8 - left.length - right.length;
  if (missing < 0) return null;

  return [...left, ...new Array<number>(missing).fill(0), ...right];
}

function isPrivateIpv6(ip: string): boolean {
  const groups = expandIpv6(ip);
  // Formato que nao conseguimos interpretar: tratar como interno.
  if (!groups) return true;

  const [g0, g1, g2, g3, g4, g5, g6, g7] = groups as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const embeddedIpv4 = () =>
    `${g6 >> 8}.${g6 & 0xff}.${g7 >> 8}.${g7 & 0xff}`;

  const leadingZeros = g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0;

  // ::ffff:a.b.c.d (mapeado) e ::a.b.c.d (compativel) herdam a regra do IPv4.
  if (leadingZeros && g5 === 0xffff) return isPrivateIpv4(embeddedIpv4());
  if (leadingZeros && g5 === 0) {
    if (g6 === 0 && g7 <= 1) return true; // :: e ::1
    return isPrivateIpv4(embeddedIpv4());
  }

  // NAT64 (64:ff9b::/96) tambem carrega um IPv4 dentro.
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) {
    return isPrivateIpv4(embeddedIpv4());
  }

  if ((g0 & 0xfe00) === 0xfc00) return true; // unique local fc00::/7
  if ((g0 & 0xffc0) === 0xfe80) return true; // link local fe80::/10
  if ((g0 & 0xff00) === 0xff00) return true; // multicast ff00::/8
  if (g0 === 0x2001 && g1 === 0x0db8) return true; // documentacao 2001:db8::/32

  return false;
}

export function isPrivateAddress(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return isPrivateIpv4(ip);
  if (version === 6) return isPrivateIpv6(ip);
  return true;
}

async function assertPublicUrl(url: URL): Promise<void> {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SafeFetchError("Apenas enderecos http e https sao aceitos.");
  }

  const host = url.hostname.replace(/^\[|\]$/g, "");

  if (isIP(host)) {
    if (isPrivateAddress(host)) {
      throw new SafeFetchError("Esse endereco aponta para a rede interna.");
    }
    return;
  }

  let addresses: { address: string }[];
  try {
    addresses = await lookup(host, { all: true });
  } catch {
    throw new SafeFetchError("Nao foi possivel resolver o endereco.");
  }

  if (addresses.length === 0 || addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw new SafeFetchError("Esse endereco aponta para a rede interna.");
  }
}

/**
 * Le no maximo MAX_BYTES do corpo. Sem isso, uma URL apontando para um arquivo
 * gigante consome toda a memoria do processo.
 */
async function readCapped(response: Response): Promise<string> {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > MAX_BYTES) {
    throw new SafeFetchError("A pagina e grande demais para importar.");
  }

  const reader = response.body?.getReader();
  if (!reader) return "";

  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_BYTES) {
      await reader.cancel();
      throw new SafeFetchError("A pagina e grande demais para importar.");
    }
    chunks.push(value);
  }

  return new TextDecoder("utf-8").decode(Buffer.concat(chunks));
}

export async function fetchPublicHtml(rawUrl: string): Promise<{ html: string; finalUrl: string }> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SafeFetchError("URL invalida.");
  }

  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    await assertPublicUrl(url);

    const response = await fetch(url, {
      redirect: "manual",
      headers: {
        "User-Agent": "rk-leitura/1.0 (+leitor de artigos)",
        Accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new SafeFetchError("Redirecionamento sem destino.");
      await response.body?.cancel();
      url = new URL(location, url);
      continue;
    }

    if (!response.ok) {
      throw new SafeFetchError(`A pagina respondeu com status ${response.status}.`);
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (contentType && !/text\/html|application\/xhtml|text\/plain/i.test(contentType)) {
      throw new SafeFetchError("O endereco nao devolveu uma pagina de texto.");
    }

    return { html: await readCapped(response), finalUrl: url.toString() };
  }

  throw new SafeFetchError("Redirecionamentos demais.");
}
