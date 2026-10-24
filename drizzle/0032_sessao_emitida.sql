ALTER TABLE "auth_sessions" ADD COLUMN "issued_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
-- Linhas anteriores a coluna: o token foi emitido no maximo no ultimo acesso
-- registrado. Usar o ultimo acesso mostra um aparelho a mais por uns dias, em
-- vez de esconder um que ainda vale.
UPDATE "auth_sessions" SET "issued_at" = "last_seen_at";
