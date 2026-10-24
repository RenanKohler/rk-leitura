import { describe, expect, it } from "vitest";
import { PDF_CORRUPT, PDF_FAILURE, PDF_PASSWORD, pdfErrorMessage } from "@/lib/pdf-errors";

/** Mensagens do pdf.js em portugues (US-181). */
const named = (name: string, message = "anything") => Object.assign(new Error(message), { name });

describe("falhas ao abrir PDF", () => {
  it("senha", () => {
    expect(pdfErrorMessage(named("PasswordException", "No password given"))).toBe(PDF_PASSWORD);
  });

  it("arquivo danificado", () => {
    expect(pdfErrorMessage(named("InvalidPDFException", "Invalid PDF structure."))).toBe(PDF_CORRUPT);
    expect(pdfErrorMessage(named("FormatError"))).toBe(PDF_CORRUPT);
  });

  it("qualquer outra falha sai em portugues, sem o texto original", () => {
    const message = pdfErrorMessage(named("UnknownErrorException", "Worker was destroyed"));
    expect(message).toBe(PDF_FAILURE);
    expect(pdfErrorMessage("texto solto")).toBe(PDF_FAILURE);
    expect(pdfErrorMessage(null)).toBe(PDF_FAILURE);
  });
});
