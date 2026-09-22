DROP INDEX "saved_words_user_word_unique";--> statement-breakpoint
ALTER TABLE "saved_words" ADD COLUMN "language" text DEFAULT 'pt-BR' NOT NULL;--> statement-breakpoint
ALTER TABLE "saved_words" ADD COLUMN "translation" text;--> statement-breakpoint
ALTER TABLE "texts" ADD COLUMN "language" text DEFAULT 'pt-BR' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "saved_words_user_language_word_unique" ON "saved_words" USING btree ("user_id","language",translate(lower("word"), 'áàâãäåéèêëíìîïóòôõöøúùûüçñýÿ', 'aaaaaaeeeeiiiioooooouuuucnyy'));