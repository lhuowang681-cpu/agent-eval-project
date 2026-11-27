CREATE TABLE IF NOT EXISTS "market_agent_usage_records" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_identifier" text NOT NULL,
	"user_id" text NOT NULL,
	"used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "market_skill_usage_records" (
	"id" text PRIMARY KEY NOT NULL,
	"skill_identifier" text NOT NULL,
	"user_id" text NOT NULL,
	"agent_id" text,
	"used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "market_mcp_usage_records" (
	"id" text PRIMARY KEY NOT NULL,
	"mcp_identifier" text NOT NULL,
	"user_id" text NOT NULL,
	"agent_id" text,
	"used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "market_agents" ADD COLUMN IF NOT EXISTS "usage_count" integer DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "market_skills" ADD COLUMN IF NOT EXISTS "usage_count" integer DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "market_mcps" ADD COLUMN IF NOT EXISTS "usage_count" integer DEFAULT 0;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "market_agent_usage_records" ADD CONSTRAINT "market_agent_usage_records_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "market_skill_usage_records" ADD CONSTRAINT "market_skill_usage_records_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "market_mcp_usage_records" ADD CONSTRAINT "market_mcp_usage_records_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "market_agent_usage_records_identifier_used_at_idx" ON "market_agent_usage_records" USING btree ("agent_identifier","used_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "market_agent_usage_records_user_id_idx" ON "market_agent_usage_records" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "market_skill_usage_records_identifier_used_at_idx" ON "market_skill_usage_records" USING btree ("skill_identifier","used_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "market_skill_usage_records_user_id_idx" ON "market_skill_usage_records" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "market_mcp_usage_records_identifier_used_at_idx" ON "market_mcp_usage_records" USING btree ("mcp_identifier","used_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "market_mcp_usage_records_user_id_idx" ON "market_mcp_usage_records" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "market_agents_usage_count_idx" ON "market_agents" USING btree ("usage_count");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "market_skills_usage_count_idx" ON "market_skills" USING btree ("usage_count");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "market_mcps_usage_count_idx" ON "market_mcps" USING btree ("usage_count");
