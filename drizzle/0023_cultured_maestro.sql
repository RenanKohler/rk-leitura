CREATE TABLE "review_answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"item_id" uuid NOT NULL,
	"grade" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "highlights" ADD COLUMN "review_due_on" date;--> statement-breakpoint
ALTER TABLE "highlights" ADD COLUMN "review_interval" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "highlights" ADD COLUMN "last_reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reading_sessions" ADD COLUMN "mode" text DEFAULT 'runner' NOT NULL;--> statement-breakpoint
ALTER TABLE "reading_sessions" ADD COLUMN "brakes" jsonb;--> statement-breakpoint
ALTER TABLE "saved_words" ADD COLUMN "review_interval" integer;--> statement-breakpoint
ALTER TABLE "speed_settings" ADD COLUMN "reader_tips_seen" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "review_answers" ADD CONSTRAINT "review_answers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "review_answers_user_created_idx" ON "review_answers" USING btree ("user_id","kind","created_at");--> statement-breakpoint
CREATE INDEX "highlights_user_review_idx" ON "highlights" USING btree ("user_id","review_due_on");--> statement-breakpoint
-- Sessoes narradas anteriores ao modo: a narracao ja era registrada em "narrated".
UPDATE "reading_sessions" SET "mode" = 'narracao' WHERE "narrated" = true;