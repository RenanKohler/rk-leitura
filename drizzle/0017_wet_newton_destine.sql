CREATE TABLE "feeds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"seen_until" timestamp with time zone,
	"last_checked_at" timestamp with time zone,
	"failures" integer DEFAULT 0 NOT NULL,
	"paused_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "series_follows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"series_key" text NOT NULL,
	"last_checked_at" timestamp with time zone,
	"failures" integer DEFAULT 0 NOT NULL,
	"paused_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "texts" ADD COLUMN "auto_imported_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "feeds" ADD CONSTRAINT "feeds_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "series_follows" ADD CONSTRAINT "series_follows_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "feeds_user_url_unique" ON "feeds" USING btree ("user_id","url");--> statement-breakpoint
CREATE UNIQUE INDEX "series_follows_user_series_unique" ON "series_follows" USING btree ("user_id","series_key");