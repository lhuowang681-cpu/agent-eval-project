CREATE TABLE "internal_scheduler_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"handler_key" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"not_before" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"retries" integer DEFAULT 0 NOT NULL,
	"max_retries" integer DEFAULT 3 NOT NULL,
	"locked_at" timestamp with time zone,
	"locked_by" text,
	"last_error" text,
	"delivered_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "internal_scheduler_messages_due_idx" ON "internal_scheduler_messages" USING btree ("status","not_before");--> statement-breakpoint
CREATE INDEX "internal_scheduler_messages_handler_key_idx" ON "internal_scheduler_messages" USING btree ("handler_key");