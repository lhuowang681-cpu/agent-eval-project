CREATE TABLE IF NOT EXISTS "agent_operations" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"agent_id" text,
	"topic_id" text,
	"thread_id" text,
	"parent_operation_id" text,
	"status" text DEFAULT 'idle' NOT NULL,
	"step_count" integer DEFAULT 0 NOT NULL,
	"last_heartbeat_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_operations" ADD CONSTRAINT "agent_operations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_operations" ADD CONSTRAINT "agent_operations_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_operations" ADD CONSTRAINT "agent_operations_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_operations_parent_operation_id_idx" ON "agent_operations" USING btree ("parent_operation_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_operations_user_id_status_idx" ON "agent_operations" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_operations_status_heartbeat_idx" ON "agent_operations" USING btree ("status","last_heartbeat_at");
