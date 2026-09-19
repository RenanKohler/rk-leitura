CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "text_tags" (
	"text_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	CONSTRAINT "text_tags_text_id_tag_id_pk" PRIMARY KEY("text_id","tag_id")
);
--> statement-breakpoint
ALTER TABLE "texts" ADD COLUMN "series_key" text;--> statement-breakpoint
ALTER TABLE "texts" ADD COLUMN "chapter" integer;--> statement-breakpoint
ALTER TABLE "texts" ADD COLUMN "queue_position" integer;--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "text_tags" ADD CONSTRAINT "text_tags_text_id_texts_id_fk" FOREIGN KEY ("text_id") REFERENCES "public"."texts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "text_tags" ADD CONSTRAINT "text_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tags_user_name_unique" ON "tags" USING btree ("user_id",translate(lower("name"), 'áàâãäåéèêëíìîïóòôõöøúùûüçñýÿ', 'aaaaaaeeeeiiiioooooouuuucnyy'));--> statement-breakpoint
CREATE INDEX "text_tags_tag_idx" ON "text_tags" USING btree ("tag_id");--> statement-breakpoint
CREATE INDEX "texts_user_series_idx" ON "texts" USING btree ("user_id","series_key","chapter");