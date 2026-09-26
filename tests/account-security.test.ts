import { describe, expect, it } from "vitest";
import { describeDevice, generateRecoveryCode, normalizeRecoveryCode } from "@/lib/account-security";

describe("describeDevice (US-97)", () => {
  it("reconhece navegador e sistema", () => {
    expect(
      describeDevice(
        "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36"
      )
    ).toBe("Chrome no Android");
    expect(
      describeDevice(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"
      )
    ).toBe("Safari no iPhone");
    expect(
      describeDevice("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36 Edg/126.0")
    ).toBe("Edge no Windows");
  });

  it("sem User-Agent nao quebra", () => {
    expect(describeDevice(null)).toBe("Aparelho desconhecido");
  });
});

describe("codigos de recuperacao (US-96)", () => {
  const random = (size: number) => Uint8Array.from({ length: size }, (_, i) => i * 37);

  it("gera no formato XXXXX-XXXXX sem simbolos ambiguos", () => {
    const code = generateRecoveryCode(random);
    expect(code).toMatch(/^[2-9A-HJ-KMNP-Z]{5}-[2-9A-HJ-KMNP-Z]{5}$/);
    expect(code).not.toMatch(/[01ILO]/);
  });

  it("normaliza o que foi digitado", () => {
    const code = generateRecoveryCode(random);
    expect(normalizeRecoveryCode(` ${code.toLowerCase()} `)).toBe(code.replace("-", ""));
    expect(normalizeRecoveryCode("abc")).toBeNull();
    expect(normalizeRecoveryCode(42)).toBeNull();
  });
});
