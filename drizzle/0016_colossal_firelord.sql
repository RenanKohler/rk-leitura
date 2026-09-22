ALTER TABLE "saved_words" ADD COLUMN "context" text;--> statement-breakpoint
ALTER TABLE "saved_words" ADD COLUMN "next_review_on" date;--> statement-breakpoint
ALTER TABLE "saved_words" ADD COLUMN "review_step" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "saved_words" ADD COLUMN "learned_at" timestamp with time zone;