CREATE TABLE "evidence_chunks" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"evidence_id" text NOT NULL,
	"project_id" text NOT NULL,
	"ordinal" integer NOT NULL,
	"text" text NOT NULL,
	"embedding" double precision[],
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evidence_chunks_ordinal_uq" UNIQUE("evidence_id","ordinal")
);
--> statement-breakpoint
ALTER TABLE "evidence_chunks" ADD CONSTRAINT "evidence_chunks_evidence_id_evidence_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."evidence"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_chunks" ADD CONSTRAINT "evidence_chunks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "evidence_chunks_project_idx" ON "evidence_chunks" USING btree ("project_id");