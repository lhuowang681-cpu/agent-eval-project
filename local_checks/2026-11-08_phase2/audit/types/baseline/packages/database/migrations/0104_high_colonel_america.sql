CREATE TABLE "shares" (
	"id" text PRIMARY KEY NOT NULL,
	"token" varchar(32) NOT NULL,
	"owner_id" text NOT NULL,
	"item_type" varchar(16) NOT NULL,
	"market_identifier" varchar(64) NOT NULL,
	"name" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"view_count" integer DEFAULT 0,
	"install_count" integer DEFAULT 0
);
--> statement-breakpoint
ALTER TABLE "shares" ADD CONSTRAINT "shares_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "shares_token_unique" ON "shares" USING btree ("token");--> statement-breakpoint
CREATE INDEX "shares_owner_id_idx" ON "shares" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "shares_market_identifier_idx" ON "shares" USING btree ("market_identifier");