ALTER TABLE "study_cards" ADD COLUMN "edited_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "study_cards" ADD COLUMN "source_changed" boolean DEFAULT false NOT NULL;