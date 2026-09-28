CREATE TABLE "evidence_labels" (
	"evidence_id" text NOT NULL,
	"label_id" text NOT NULL,
	CONSTRAINT "evidence_labels_evidence_id_label_id_pk" PRIMARY KEY("evidence_id","label_id")
);
--> statement-breakpoint
ALTER TABLE "evidence" ADD COLUMN "pruned_text" text;--> statement-breakpoint
ALTER TABLE "evidence_labels" ADD CONSTRAINT "evidence_labels_evidence_id_evidence_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."evidence"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_labels" ADD CONSTRAINT "evidence_labels_label_id_labels_id_fk" FOREIGN KEY ("label_id") REFERENCES "public"."labels"("id") ON DELETE cascade ON UPDATE no action;