CREATE TABLE "ask_turns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"text_id" uuid NOT NULL,
	"question" text NOT NULL,
	"answer" jsonb NOT NULL,
	"position" integer NOT NULL,
	"fingerprint" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_usage" ADD COLUMN "outcome" text DEFAULT 'sucesso' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD COLUMN "text_id" uuid;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD COLUMN "words_sent" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD COLUMN "first_token_ms" integer;--> statement-breakpoint
ALTER TABLE "highlights" ADD COLUMN "card_prompt" text;--> statement-breakpoint
ALTER TABLE "highlights" ADD COLUMN "card_answer" text;--> statement-breakpoint
ALTER TABLE "saved_words" ADD COLUMN "distractors" jsonb;--> statement-breakpoint
ALTER TABLE "texts" ADD COLUMN "author" text;--> statement-breakpoint
ALTER TABLE "texts" ADD COLUMN "sections" jsonb;--> statement-breakpoint
ALTER TABLE "ask_turns" ADD CONSTRAINT "ask_turns_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ask_turns" ADD CONSTRAINT "ask_turns_text_id_texts_id_fk" FOREIGN KEY ("text_id") REFERENCES "public"."texts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ask_turns_text_created_idx" ON "ask_turns" USING btree ("user_id","text_id","created_at");--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_text_id_texts_id_fk" FOREIGN KEY ("text_id") REFERENCES "public"."texts"("id") ON DELETE set null ON UPDATE no action;