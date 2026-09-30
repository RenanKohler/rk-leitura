import { describe, expect, it } from "vitest";
import { speedBand, speedBandWarning } from "@/lib/speed-bands";

describe("speedBand", () => {
  it("ate 400 ppm e leitura", () => {
    expect(speedBand(120)).toBe("leitura");
    expect(speedBand(400)).toBe("leitura");
  });

  it("de 401 a 600 ppm e leitura rapida", () => {
    expect(speedBand(410)).toBe("rapida");
    expect(speedBand(600)).toBe("rapida");
  });

  it("acima de 600 ppm e varredura, com aviso", () => {
    expect(speedBand(610)).toBe("varredura");
    expect(speedBandWarning(610)).toMatch(/compreensão costuma cair/);
    expect(speedBandWarning(600)).toBeNull();
  });
});
