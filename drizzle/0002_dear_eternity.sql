ALTER TABLE "speed_settings" ADD COLUMN "font_scale" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "speed_settings" ADD COLUMN "font_family" text DEFAULT 'sans' NOT NULL;--> statement-breakpoint
ALTER TABLE "speed_settings" ADD COLUMN "line_height_step" integer DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE "speed_settings" ADD COLUMN "warmup" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "texts" ADD COLUMN "archived_at" timestamp with time zone;