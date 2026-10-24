ALTER TABLE "study_cards" ADD COLUMN "front_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX "study_cards_front_key_idx" ON "study_cards" USING btree ("text_id","front_key");