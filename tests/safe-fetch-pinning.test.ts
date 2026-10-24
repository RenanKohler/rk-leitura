import { describe, expect, it, vi } from "vitest";
import {
  BLOCKED_ADDRESS,
  fetchPublic,
  pinnedRequest,
  type FetchDeps,
  type RawResponse,
} from "@/lib/safe-fetch";

const HTML = { accept: "text/html", types: /text\/html/i };

function page(status: number, headers: Record<string, string> = {}, body = ""): RawResponse {
  return {
    status,
    headers: new Headers({ "content-type": "text/html", ...headers }),
    body: (async function* () {
      if (body) yield new TextEncoder().encode(body);
    })(),
    cancel: () => undefined,
  };
}

/** Resolvedor que responde publico na primeira consulta e interno depois. */
function rebinding(): FetchDeps["resolve"] {
  let calls = 0;
  return vi.fn(async () => {
    calls += 1;
    return calls === 1
      ? [{ address: "93.184.216.34", family: 4 }]
      : [{ address: "169.254.169.254", family: 4 }];
  });
}

describe("conexao no endereco validado (US-184)", () => {
  it("conecta no IP validado, sem resolver o nome de novo", async () => {
    const resolve = rebinding();
    const request = vi.fn<FetchDeps["request"]>(async () => page(200, {}, "<p>ok</p>"));

    const result = await fetchPublic("https://rebind.test/artigo", HTML, { resolve, request });

    expect(result.html).toBe("<p>ok</p>");
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledTimes(1);
    const [url, target] = request.mock.calls[0]!;
    expect(url.hostname).toBe("rebind.test");
    expect(target).toEqual({ address: "93.184.216.34", family: 4 });
  });

  it("revalida cada salto: o redirecionamento para nome que resolve interno e recusado", async () => {
    const resolve = vi.fn<FetchDeps["resolve"]>(async (host) =>
      host === "interno.test"
        ? [{ address: "10.0.0.5", family: 4 }]
        : [{ address: "93.184.216.34", family: 4 }]
    );
    const request = vi.fn<FetchDeps["request"]>(async () =>
      page(302, { location: "http://interno.test/admin" })
    );

    await expect(fetchPublic("https://publico.test/", HTML, { resolve, request })).rejects.toThrow(
      "Esse endereço aponta para a rede interna."
    );
    expect(request).toHaveBeenCalledTimes(1);
    for (const [, target] of request.mock.calls) {
      expect(target.address).not.toBe("10.0.0.5");
    }
  });

  it("com o resolvedor trocando a resposta, nenhuma conexao vai a endereco privado", async () => {
    const resolve = rebinding();
    const targets: string[] = [];
    let hops = 0;
    const request = vi.fn<FetchDeps["request"]>(async (_url, target) => {
      targets.push(target.address);
      hops += 1;
      // Dois saltos para o mesmo nome: o segundo ja consultaria o DNS de novo.
      return hops === 1 ? page(301, { location: "/de-novo" }) : page(200, {}, "fim");
    });

    await expect(fetchPublic("https://rebind.test/", HTML, { resolve, request })).rejects.toThrow(
      "Esse endereço aponta para a rede interna."
    );
    expect(targets).toEqual(["93.184.216.34"]);
  });

  it("a conexao fixa recusa endereco interno antes de abrir o socket", async () => {
    await expect(
      pinnedRequest(
        new URL("http://rebind.test/"),
        { address: "169.254.169.254", family: 4 },
        {},
        AbortSignal.timeout(2_000)
      )
    ).rejects.toThrow(BLOCKED_ADDRESS);
  });
});
