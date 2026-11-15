ALTER TABLE "quiz_recalls" ALTER COLUMN "score" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "highlights" ADD COLUMN "review_off_at" timestamp with time zone;