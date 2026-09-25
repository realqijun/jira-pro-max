CREATE TYPE "public"."ai_provider" AS ENUM('openai', 'anthropic', 'openai_compatible');--> statement-breakpoint
CREATE TABLE "user_ai_configs" (
	"user_id" text PRIMARY KEY NOT NULL,
	"provider" "ai_provider" NOT NULL,
	"model" text NOT NULL,
	"base_url" text,
	"encrypted_api_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_ai_configs" ADD CONSTRAINT "user_ai_configs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;