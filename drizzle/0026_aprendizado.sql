CREATE TABLE "quiz_recalls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"text_id" uuid NOT NULL,
	"round" integer NOT NULL,
	"score" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "study_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"text_id" uuid NOT NULL,
	"front" text NOT NULL,
	"back" text NOT NULL,
	"kind" text NOT NULL,
	"source_start" integer DEFAULT 0 NOT NULL,
	"source_end" integer DEFAULT 0 NOT NULL,
	"analogy" text,
	"next_review_on" date,
	"review_interval" integer DEFAULT 0 NOT NULL,
	"last_reviewed_at" timestamp with time zone,
	"pretest" text,
	"pretested_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "speed_settings" ADD COLUMN "review_reminder" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "speed_settings" ADD COLUMN "review_reminder_sent_on" date;--> statement-breakpoint
ALTER TABLE "quiz_recalls" ADD CONSTRAINT "quiz_recalls_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_recalls" ADD CONSTRAINT "quiz_recalls_text_id_texts_id_fk" FOREIGN KEY ("text_id") REFERENCES "public"."texts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_cards" ADD CONSTRAINT "study_cards_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_cards" ADD CONSTRAINT "study_cards_text_id_texts_id_fk" FOREIGN KEY ("text_id") REFERENCES "public"."texts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "quiz_recalls_text_round_unique" ON "quiz_recalls" USING btree ("user_id","text_id","round");--> statement-breakpoint
CREATE INDEX "study_cards_text_idx" ON "study_cards" USING btree ("user_id","text_id");--> statement-breakpoint
CREATE INDEX "study_cards_review_idx" ON "study_cards" USING btree ("user_id","next_review_on");