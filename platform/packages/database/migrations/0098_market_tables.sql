CREATE TABLE IF NOT EXISTS "market_agents" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"title" varchar(255),
	"description" varchar(1000),
	"avatar" text,
	"background_color" text,
	"category" varchar(50),
	"tags" jsonb DEFAULT '[]'::jsonb,
	"system_role" text,
	"model" text,
	"provider" text,
	"plugins" jsonb,
	"skills" jsonb DEFAULT '[]'::jsonb,
	"chat_config" jsonb,
	"few_shots" jsonb,
	"opening_message" text,
	"opening_questions" text[] DEFAULT '{}',
	"editor_data" jsonb,
	"token_usage" integer DEFAULT 0,
	"plugin_count" integer DEFAULT 0,
	"knowledge_count" integer DEFAULT 0,
	"install_count" integer DEFAULT 0,
	"version" integer DEFAULT 1 NOT NULL,
	"status" varchar(20) DEFAULT 'published' NOT NULL,
	"publisher_id" text NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "market_mcps" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"name" text,
	"description" text,
	"icon" text,
	"category" varchar(50),
	"tags" jsonb DEFAULT '[]'::jsonb,
	"overview" text,
	"connection_type" varchar(10) DEFAULT 'http' NOT NULL,
	"manifest" jsonb,
	"custom_params" jsonb,
	"capabilities" jsonb,
	"tools_count" integer DEFAULT 0,
	"prompts_count" integer DEFAULT 0,
	"resources_count" integer DEFAULT 0,
	"install_count" integer DEFAULT 0,
	"version" varchar(20) DEFAULT '1.0.0' NOT NULL,
	"visibility" varchar(10) DEFAULT 'public' NOT NULL,
	"status" varchar(20) DEFAULT 'published' NOT NULL,
	"publisher_id" text NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "market_skills" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"icon" text,
	"category" varchar(50),
	"tags" jsonb DEFAULT '[]'::jsonb,
	"content" text,
	"manifest" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"resources" jsonb DEFAULT '{}'::jsonb,
	"editor_data" jsonb,
	"install_count" integer DEFAULT 0,
	"resources_count" integer DEFAULT 0,
	"version" varchar(20) DEFAULT '1.0.0' NOT NULL,
	"visibility" varchar(10) DEFAULT 'public' NOT NULL,
	"status" varchar(20) DEFAULT 'published' NOT NULL,
	"publisher_id" text NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "skills" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "installed_from_market_identifier" text;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "installed_from_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "installed_market_version" integer;--> statement-breakpoint
ALTER TABLE "agent_skills" ADD COLUMN IF NOT EXISTS "market_identifier" text;--> statement-breakpoint
ALTER TABLE "agent_skills" ADD COLUMN IF NOT EXISTS "installed_from_market_identifier" text;--> statement-breakpoint
ALTER TABLE "agent_skills" ADD COLUMN IF NOT EXISTS "installed_from_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "agent_skills" ADD COLUMN IF NOT EXISTS "installed_market_version" varchar(20);--> statement-breakpoint
ALTER TABLE "user_installed_plugins" ADD COLUMN IF NOT EXISTS "market_identifier" text;--> statement-breakpoint
ALTER TABLE "user_installed_plugins" ADD COLUMN IF NOT EXISTS "installed_from_market_identifier" text;--> statement-breakpoint
ALTER TABLE "user_installed_plugins" ADD COLUMN IF NOT EXISTS "installed_from_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "user_installed_plugins" ADD COLUMN IF NOT EXISTS "installed_market_version" varchar(20);--> statement-breakpoint
ALTER TABLE "market_agents" DROP CONSTRAINT IF EXISTS "market_agents_publisher_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "market_agents" ADD CONSTRAINT "market_agents_publisher_id_users_id_fk" FOREIGN KEY ("publisher_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_mcps" DROP CONSTRAINT IF EXISTS "market_mcps_publisher_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "market_mcps" ADD CONSTRAINT "market_mcps_publisher_id_users_id_fk" FOREIGN KEY ("publisher_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_skills" DROP CONSTRAINT IF EXISTS "market_skills_publisher_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "market_skills" ADD CONSTRAINT "market_skills_publisher_id_users_id_fk" FOREIGN KEY ("publisher_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "market_agents_identifier_unique" ON "market_agents" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "market_agents_publisher_id_idx" ON "market_agents" USING btree ("publisher_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "market_agents_category_idx" ON "market_agents" USING btree ("category");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "market_agents_status_idx" ON "market_agents" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "market_agents_install_count_idx" ON "market_agents" USING btree ("install_count");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "market_agents_updated_at_idx" ON "market_agents" USING btree ("updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "market_mcps_identifier_unique" ON "market_mcps" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "market_mcps_publisher_id_idx" ON "market_mcps" USING btree ("publisher_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "market_mcps_category_idx" ON "market_mcps" USING btree ("category");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "market_mcps_connection_type_idx" ON "market_mcps" USING btree ("connection_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "market_mcps_status_idx" ON "market_mcps" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "market_mcps_visibility_idx" ON "market_mcps" USING btree ("visibility");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "market_mcps_install_count_idx" ON "market_mcps" USING btree ("install_count");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "market_mcps_updated_at_idx" ON "market_mcps" USING btree ("updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "market_skills_identifier_unique" ON "market_skills" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "market_skills_publisher_id_idx" ON "market_skills" USING btree ("publisher_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "market_skills_category_idx" ON "market_skills" USING btree ("category");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "market_skills_status_idx" ON "market_skills" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "market_skills_visibility_idx" ON "market_skills" USING btree ("visibility");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "market_skills_install_count_idx" ON "market_skills" USING btree ("install_count");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "market_skills_updated_at_idx" ON "market_skills" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "market_skills_name_idx" ON "market_skills" USING btree ("name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agents_installed_from_market_identifier_idx" ON "agents" USING btree ("installed_from_market_identifier");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_skills_market_identifier_idx" ON "agent_skills" USING btree ("market_identifier");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_skills_installed_from_market_identifier_idx" ON "agent_skills" USING btree ("installed_from_market_identifier");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_installed_plugins_market_identifier_idx" ON "user_installed_plugins" USING btree ("market_identifier");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_installed_plugins_installed_from_market_identifier_idx" ON "user_installed_plugins" USING btree ("installed_from_market_identifier");
