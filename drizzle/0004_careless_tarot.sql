CREATE TABLE "comprehension_quizzes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"text_id" uuid NOT NULL,
	"content_key" text NOT NULL,
	"questions" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reading_sessions" ADD COLUMN "comprehension" integer;--> statement-breakpoint
ALTER TABLE "comprehension_quizzes" ADD CONSTRAINT "comprehension_quizzes_text_id_texts_id_fk" FOREIGN KEY ("text_id") REFERENCES "public"."texts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "comprehension_quizzes_text_key_unique" ON "comprehension_quizzes" USING btree ("text_id","content_key");