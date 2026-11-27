CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"device_id" varchar(64) NOT NULL,
	"identity_source" varchar(20) NOT NULL,
	"hostname" text,
	"platform" varchar(20),
	"friendly_name" text,
	"default_cwd" text,
	"recent_cwds" text[] DEFAULT '{}' NOT NULL,
	"working_dirs" jsonb DEFAULT '[]'::jsonb,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "devices_user_id_device_id_unique" ON "devices" USING btree ("user_id","device_id");--> statement-breakpoint
CREATE INDEX "devices_user_id_idx" ON "devices" USING btree ("user_id");