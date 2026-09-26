ALTER TABLE "speed_settings" ADD COLUMN "paragraph_pause" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "speed_settings" ADD COLUMN "resume_rewind" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "speed_settings" ADD COLUMN "dim_lines" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "speed_settings" ADD COLUMN "eye_rest" boolean DEFAULT false NOT NULL;