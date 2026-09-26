/**
 * Formato do arquivo da biblioteca: exportar (US-50) e restaurar (US-98).
 *
 * A validacao e a mesma no navegador e no servidor. No navegador ela recusa
 * o arquivo inteiro antes de mandar qualquer coisa - "arquivo nao
 * reconhecido" nao pode deixar metade da biblioteca gravada. No servidor ela
 * volta a valer, porque o cliente nao e confiavel.
 */

import { z } from "zod";

export const BACKUP_KIND = "leitura-biblioteca";
export const BACKUP_VERSION = 2;

/** Limites do arquivo aceito. */
export const MAX_BACKUP_BYTES = 20 * 1024 * 1024;
export const MAX_BACKUP_TEXTS = 2000;
export const MAX_BACKUP_CONTENT_CHARS = 400_000;

/**
 * Tamanho de cada lote enviado ao servidor. A funcao da Vercel recebe no
 * maximo 4,5 MB por requisicao; 3 MB deixa folga para o JSON em volta.
 */
export const BATCH_BYTES = 3 * 1024 * 1024;
export const BATCH_TEXTS = 100;

const isoDate = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), "data invalida");

const HighlightSchema = z.object({
  inicio: z.number().int().min(0),
  fim: z.number().int().min(0),
  nota: z.string().max(2000).nullable().optional(),
});

const BookmarkSchema = z.object({
  posicao: z.number().int().min(0),
  nome: z.string().min(1).max(200),
});

export const BackupTextSchema = z.object({
  titulo: z.string().trim().min(1).max(500),
  origem: z.string().max(2000).nullable().optional(),
  parteDaOrigem: z.number().int().min(1).max(10_000).optional(),
  progresso: z.number().int().min(0).optional(),
  arquivadoEm: isoDate.nullable().optional(),
  criadoEm: isoDate.optional(),
  conteudo: z.string().min(1).max(MAX_BACKUP_CONTENT_CHARS),
  formato: z.enum(["plain", "markdown"]).optional(),
  idioma: z.string().max(20).optional(),
  etiquetas: z.array(z.string().max(100)).max(50).optional(),
  destaques: z.array(HighlightSchema).max(5000).optional(),
  marcadores: z.array(BookmarkSchema).max(500).optional(),
});

export type BackupText = z.infer<typeof BackupTextSchema>;

const V2Schema = z.object({
  formato: z.literal(BACKUP_KIND),
  versao: z.number().int().min(1).max(BACKUP_VERSION),
  textos: z.array(BackupTextSchema).max(MAX_BACKUP_TEXTS),
});

/** Versao 1: a lista de textos solta, como a exportacao antiga gerava. */
const V1Schema = z.array(BackupTextSchema).max(MAX_BACKUP_TEXTS);

export type BackupResult =
  | { ok: true; texts: BackupText[] }
  | { ok: false; error: string };

export const UNRECOGNIZED = "Arquivo nao reconhecido. Use o arquivo baixado em Ajustes > Biblioteca (JSON).";

/** Valida o conteudo ja lido do arquivo. */
export function parseBackup(raw: unknown): BackupResult {
  if (Array.isArray(raw) && raw.length > MAX_BACKUP_TEXTS) {
    return { ok: false, error: `O arquivo passa de ${MAX_BACKUP_TEXTS} textos.` };
  }
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const list = (raw as { textos?: unknown }).textos;
    if (Array.isArray(list) && list.length > MAX_BACKUP_TEXTS) {
      return { ok: false, error: `O arquivo passa de ${MAX_BACKUP_TEXTS} textos.` };
    }
  }

  const v2 = V2Schema.safeParse(raw);
  if (v2.success) return { ok: true, texts: v2.data.textos };
  const v1 = V1Schema.safeParse(raw);
  if (v1.success) return { ok: true, texts: v1.data };
  return { ok: false, error: UNRECOGNIZED };
}

/** Lista de textos de um lote enviado ao servidor. */
export const BatchSchema = z.object({ textos: z.array(BackupTextSchema).min(1).max(BATCH_TEXTS) });

/**
 * Divide os textos em lotes que cabem numa requisicao. Um texto maior que o
 * lote vai sozinho: o limite de conteudo por texto ja o mantem abaixo do teto.
 */
export function batchesOf(texts: BackupText[]): BackupText[][] {
  const batches: BackupText[][] = [];
  let current: BackupText[] = [];
  let bytes = 0;

  for (const text of texts) {
    const size = JSON.stringify(text).length * 2;
    if (current.length > 0 && (bytes + size > BATCH_BYTES || current.length >= BATCH_TEXTS)) {
      batches.push(current);
      current = [];
      bytes = 0;
    }
    current.push(text);
    bytes += size;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}
