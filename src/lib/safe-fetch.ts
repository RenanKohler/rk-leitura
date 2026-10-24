import "server-only";

import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import type { LookupFunction } from "node:net";
import type { Readable } from "node:stream";
import zlib from "node:zlib";
import { decodeBody } from "@/lib/charset";

/**
 * Busca HTTP com protecao contra SSRF.
 *
 * A rota de importacao recebe uma URL arbitraria do usuario e a busca a partir
 * do servidor. Sem validacao isso permite alcancar a rede interna do provedor
 * (metadados em 169.254.169.254, bancos em 127.0.0.1, servicos privados).
 * Cada salto de redirecionamento e revalidado, porque so validar a URL inicial
 * deixa a porta aberta para um destino que redireciona para um IP interno.
 *
 * A conexao vai para o endereco que foi validado, e nao para uma nova
 * resolucao do nome (US-184): com `fetch(url)`, o DNS era consultado de novo
 * na conexao, e um dominio que respondesse um IP publico na validacao e
 * 169.254.169.254 logo depois passava. SNI e cabecalho `Host` seguem com o
 * nome original.
 */

const MAX_REDIRECTS = 3;
const MAX_BYTES = 3 * 1024 * 1024;
const TIMEOUT_MS = 15_000;

export class SafeFetchError extends Error {
  /** Status HTTP, quando a falha veio de uma resposta do servidor remoto. */
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "SafeFetchError";
    this.status = status;
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

export const BLOCKED_ADDRESS = "Endereço não permitido.";

/** Endereco ja validado: e para ele, e so para ele, que a conexao vai. */
export interface ResolvedTarget {
  address: string;
  family: 4 | 6;
}

/** Resposta crua: status, cabecalhos e o corpo ja descomprimido. */
export interface RawResponse {
  status: number;
  headers: Headers;
  body: AsyncIterable<Uint8Array>;
  cancel: () => void;
}

/** O que a busca usa de fora: trocado nos testes por um resolvedor simulado. */
export interface FetchDeps {
  resolve: (host: string) => Promise<{ address: string; family: number }[]>;
  request: (
    url: URL,
    target: ResolvedTarget,
    headers: Record<string, string>,
    signal: AbortSignal
  ) => Promise<RawResponse>;
}

/**
 * Valida a URL e devolve o endereco em que a conexao deve ser feita.
 *
 * O nome e resolvido uma vez so: todas as respostas precisam ser publicas, e
 * a conexao usa a primeira delas.
 */
async function resolvePublicTarget(url: URL, deps: FetchDeps): Promise<ResolvedTarget> {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SafeFetchError("Apenas endereços http e https são aceitos.");
  }

  const host = url.hostname.replace(/^\[|\]$/g, "");

  const literal = isIP(host);
  if (literal) {
    if (isPrivateAddress(host)) {
      throw new SafeFetchError("Esse endereço aponta para a rede interna.");
    }
    return { address: host, family: literal as 4 | 6 };
  }

  let addresses: { address: string; family: number }[];
  try {
    addresses = await deps.resolve(host);
  } catch {
    throw new SafeFetchError("Não foi possível resolver o endereço.");
  }

  if (addresses.length === 0 || addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw new SafeFetchError("Esse endereço aponta para a rede interna.");
  }
  const first = addresses[0]!;
  return { address: first.address, family: isIP(first.address) === 6 ? 6 : 4 };
}

/**
 * Busca com o endereco fixo: o `lookup` da conexao devolve o IP validado em
 * vez de consultar o DNS de novo. A URL continua com o nome, entao o `Host` e
 * o SNI do TLS saem com ele e o certificado e conferido contra ele.
 */
export function pinnedRequest(
  url: URL,
  target: ResolvedTarget,
  headers: Record<string, string>,
  signal: AbortSignal
): Promise<RawResponse> {
  const pinned: LookupFunction = (_host, options, callback) => {
    // Recusa de ultima linha: nunca conecta em endereco interno.
    if (isPrivateAddress(target.address)) {
      callback(new SafeFetchError(BLOCKED_ADDRESS), "", 4);
      return;
    }
    if (options.all) {
      (callback as unknown as (error: null, addresses: ResolvedTarget[]) => void)(null, [target]);
    } else {
      callback(null, target.address, target.family);
    }
  };

  const client = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const request = client.request(
      url,
      {
        method: "GET",
        headers: { ...headers, "Accept-Encoding": "gzip, deflate, br" },
        lookup: pinned,
        signal,
      },
      (response) => {
        const headerList = new Headers();
        for (const [name, value] of Object.entries(response.headers)) {
          if (value === undefined) continue;
          headerList.set(name, Array.isArray(value) ? value.join(", ") : value);
        }
        const body = decompress(response, headerList.get("content-encoding"));
        resolve({
          status: response.statusCode ?? 0,
          headers: headerList,
          body,
          cancel: () => response.destroy(),
        });
      }
    );
    request.on("error", (error) => reject(signal.aborted ? signal.reason : error));
    request.end();
  });
}

/** `fetch` descomprimia sozinho; aqui e preciso fazer a mao. */
function decompress(stream: Readable, encoding: string | null): Readable {
  switch (encoding?.trim().toLowerCase()) {
    case "gzip":
    case "x-gzip":
      return stream.pipe(zlib.createGunzip());
    case "deflate":
      return stream.pipe(zlib.createInflate());
    case "br":
      return stream.pipe(zlib.createBrotliDecompress());
    default:
      return stream;
  }
}

const NODE_DEPS: FetchDeps = {
  resolve: (host) => lookup(host, { all: true }),
  request: pinnedRequest,
};

/**
 * Le no maximo MAX_BYTES do corpo. Sem isso, uma URL apontando para um arquivo
 * gigante consome toda a memoria do processo.
 */
async function readCapped(response: RawResponse, signal: AbortSignal): Promise<Buffer> {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > MAX_BYTES) {
    response.cancel();
    throw new SafeFetchError("A página é grande demais para importar.");
  }

  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    for await (const value of response.body) {
      total += value.length;
      if (total > MAX_BYTES) {
        response.cancel();
        throw new SafeFetchError("A página é grande demais para importar.");
      }
      chunks.push(value);
    }
  } catch (error) {
    if (signal.aborted && !(error instanceof SafeFetchError)) throw signal.reason;
    throw error;
  }

  return Buffer.concat(chunks);
}

export async function fetchPublicHtml(rawUrl: string): Promise<{ html: string; finalUrl: string }> {
  return fetchPublic(rawUrl, {
    accept: "text/html,application/xhtml+xml",
    types: /text\/html|application\/xhtml|text\/plain/i,
  });
}

/**
 * Feed RSS ou Atom (US-71), com as mesmas protecoes da pagina: rede interna
 * recusada a cada redirecionamento, tamanho e tempo limitados.
 */
export async function fetchPublicFeed(rawUrl: string): Promise<{ html: string; finalUrl: string }> {
  return fetchPublic(rawUrl, {
    accept: "application/rss+xml,application/atom+xml,application/xml,text/xml",
    types: /xml|rss|atom|text\/plain|text\/html/i,
  });
}

/** Exportada para os testes, com `deps` simulados. */
export async function fetchPublic(
  rawUrl: string,
  { accept, types }: { accept: string; types: RegExp },
  deps: FetchDeps = NODE_DEPS
): Promise<{ html: string; finalUrl: string }> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SafeFetchError("URL inválida.");
  }

  // Um prazo so para a busca inteira, redirecionamentos incluidos.
  const signal = AbortSignal.timeout(TIMEOUT_MS);

  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    const target = await resolvePublicTarget(url, deps);

    const response = await deps.request(
      url,
      target,
      {
        "User-Agent": "rk-leitura/1.0 (+leitor de artigos)",
        Accept: accept,
      },
      signal
    );

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      response.cancel();
      if (!location) throw new SafeFetchError("Redirecionamento sem destino.");
      url = new URL(location, url);
      continue;
    }

    if (response.status < 200 || response.status >= 300) {
      response.cancel();
      throw new SafeFetchError(`A página respondeu com status ${response.status}.`, response.status);
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (contentType && !types.test(contentType)) {
      response.cancel();
      throw new SafeFetchError("O endereço não devolveu uma página de texto.");
    }

    const bytes = await readCapped(response, signal);
    // Codificacao do cabecalho ou do documento, nao sempre UTF-8 (US-178).
    return { html: decodeBody(bytes, contentType), finalUrl: url.toString() };
  }

  throw new SafeFetchError("Redirecionamentos demais.");
}
