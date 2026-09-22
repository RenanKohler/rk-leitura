ALTER TABLE "reading_sessions" ADD COLUMN "planned_ms" integer;--> statement-breakpoint
ALTER TABLE "speed_settings" ADD COLUMN "adaptive_rhythm" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "speed_settings" ADD COLUMN "ask_checkpoints" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "texts" ADD COLUMN "abandoned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "texts" ADD COLUMN "abandoned_words" integer;--> statement-breakpoint
ALTER TABLE "texts" ADD COLUMN "checkpoint_answered" integer DEFAULT 0 NOT NULL;