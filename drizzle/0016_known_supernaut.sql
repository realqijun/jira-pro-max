CREATE TYPE "public"."render_state" AS ENUM('pending', 'ready', 'failed');--> statement-breakpoint
ALTER TYPE "public"."entity_type" ADD VALUE 'render';--> statement-breakpoint
CREATE TABLE "renders" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" text NOT NULL,
	"prompt" text NOT NULL,
	"model" text NOT NULL,
	"seed" integer NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"state" "render_state" DEFAULT 'pending' NOT NULL,
	"storage_key" text,
	"mime_type" text,
	"size_bytes" integer,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "renders" ADD CONSTRAINT "renders_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "renders_project_idx" ON "renders" USING btree ("project_id");