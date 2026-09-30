CREATE TYPE "public"."item_proposal_kind" AS ENUM('task', 'milestone');--> statement-breakpoint
CREATE TYPE "public"."proposal_pass" AS ENUM('decision', 'item');--> statement-breakpoint
CREATE TABLE "item_proposals" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" text NOT NULL,
	"kind" "item_proposal_kind" NOT NULL,
	"fingerprint" text NOT NULL,
	"status" "proposal_status" DEFAULT 'pending' NOT NULL,
	"fields" jsonb NOT NULL,
	"sources" jsonb NOT NULL,
	"extractor" "proposal_extractor" NOT NULL,
	"item_id" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "item_proposals_fingerprint_uq" UNIQUE("project_id","fingerprint")
);
--> statement-breakpoint
ALTER TABLE "proposal_pass_sources" DROP CONSTRAINT "proposal_pass_sources_project_id_kind_entity_id_pk";--> statement-breakpoint
ALTER TABLE "proposal_pass_sources" ADD COLUMN "pass" "proposal_pass" DEFAULT 'decision' NOT NULL;--> statement-breakpoint
ALTER TABLE "proposal_pass_sources" ADD CONSTRAINT "proposal_pass_sources_project_id_pass_kind_entity_id_pk" PRIMARY KEY("project_id","pass","kind","entity_id");--> statement-breakpoint
ALTER TABLE "item_proposals" ADD CONSTRAINT "item_proposals_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "item_proposals_project_idx" ON "item_proposals" USING btree ("project_id","status");