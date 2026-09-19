CREATE TABLE "training_days" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"program_id" uuid NOT NULL,
	"day" integer NOT NULL,
	"target_wpm" integer NOT NULL,
	"session_id" uuid,
	"wpm" integer NOT NULL,
	"on_day" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "training_programs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"length" integer NOT NULL,
	"start_wpm" integer NOT NULL,
	"previous_wpm" integer NOT NULL,
	"started_on" date NOT NULL,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "speed_settings" ADD COLUMN "placement_wpm" integer;--> statement-breakpoint
ALTER TABLE "speed_settings" ADD COLUMN "placement_seen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "training_days" ADD CONSTRAINT "training_days_program_id_training_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."training_programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_days" ADD CONSTRAINT "training_days_session_id_reading_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."reading_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_programs" ADD CONSTRAINT "training_programs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "training_days_program_day_unique" ON "training_days" USING btree ("program_id","day");--> statement-breakpoint
CREATE INDEX "training_programs_user_idx" ON "training_programs" USING btree ("user_id","created_at" DESC NULLS LAST);