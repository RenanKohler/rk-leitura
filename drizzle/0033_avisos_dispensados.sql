ALTER TABLE "texts" ADD COLUMN "session_check_offered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "slowdown_answered_at" timestamp with time zone;