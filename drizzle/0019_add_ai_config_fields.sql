ALTER TABLE "user_ai_configs" DROP CONSTRAINT "user_ai_configs_pkey";--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "ai_config_id" text;--> statement-breakpoint
ALTER TABLE "user_ai_configs" ADD COLUMN "id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "user_ai_configs" ADD COLUMN "is_default" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Configurations predate multi-key support: every stored row is its owner's only one, so it is the default.
UPDATE "user_ai_configs" SET "is_default" = true;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_ai_config_id_user_ai_configs_id_fk" FOREIGN KEY ("ai_config_id") REFERENCES "public"."user_ai_configs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_ai_configs_user_idx" ON "user_ai_configs" USING btree ("user_id");
