CREATE TABLE "market_kb_chunks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"market_knowledge_base_id" text NOT NULL,
	"source_chunk_id" uuid NOT NULL,
	"text" text,
	"abstract" text,
	"metadata" jsonb,
	"index" integer,
	"type" varchar,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_kb_document_chunks" (
	"document_id" text NOT NULL,
	"chunk_id" uuid NOT NULL,
	"page_index" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "market_kb_document_chunks_document_id_chunk_id_pk" PRIMARY KEY("document_id","chunk_id")
);
--> statement-breakpoint
CREATE TABLE "market_kb_documents" (
	"id" text PRIMARY KEY NOT NULL,
	"market_knowledge_base_id" text NOT NULL,
	"source_document_id" text NOT NULL,
	"title" text,
	"description" text,
	"content" text,
	"file_type" varchar(255) NOT NULL,
	"filename" text,
	"total_char_count" integer DEFAULT 0 NOT NULL,
	"total_line_count" integer DEFAULT 0 NOT NULL,
	"metadata" jsonb,
	"pages" jsonb,
	"source_type" text NOT NULL,
	"source" text NOT NULL,
	"source_file_id" text,
	"parent_id" text,
	"slug" varchar(255),
	"editor_data" jsonb,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_kb_embeddings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"market_knowledge_base_id" text NOT NULL,
	"chunk_id" uuid NOT NULL,
	"embeddings" vector(1024),
	"model" text,
	CONSTRAINT "market_kb_embeddings_chunk_id_unique" UNIQUE("chunk_id")
);
--> statement-breakpoint
CREATE TABLE "market_kb_file_chunks" (
	"file_id" text NOT NULL,
	"chunk_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "market_kb_file_chunks_file_id_chunk_id_pk" PRIMARY KEY("file_id","chunk_id")
);
--> statement-breakpoint
CREATE TABLE "market_kb_file_links" (
	"market_knowledge_base_id" text NOT NULL,
	"file_id" text NOT NULL,
	CONSTRAINT "market_kb_file_links_market_knowledge_base_id_file_id_pk" PRIMARY KEY("market_knowledge_base_id","file_id")
);
--> statement-breakpoint
CREATE TABLE "market_kb_files" (
	"id" text PRIMARY KEY NOT NULL,
	"market_knowledge_base_id" text NOT NULL,
	"source_file_id" text NOT NULL,
	"name" text NOT NULL,
	"file_type" varchar(255) NOT NULL,
	"size" integer NOT NULL,
	"s3_key" text NOT NULL,
	"file_hash" varchar(64),
	"parent_id" text,
	"metadata" jsonb,
	"source" text,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_knowledge_bases" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"avatar" text,
	"type" text,
	"settings" jsonb,
	"file_count" integer DEFAULT 0,
	"document_count" integer DEFAULT 0,
	"chunk_count" integer DEFAULT 0,
	"install_count" integer DEFAULT 0,
	"version" integer DEFAULT 1 NOT NULL,
	"visibility" varchar(10) DEFAULT 'public' NOT NULL,
	"status" varchar(20) DEFAULT 'published' NOT NULL,
	"publisher_id" text NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "knowledge_bases" ADD COLUMN "market_identifier" text;--> statement-breakpoint
ALTER TABLE "knowledge_bases" ADD COLUMN "installed_from_market_identifier" text;--> statement-breakpoint
ALTER TABLE "knowledge_bases" ADD COLUMN "installed_from_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "knowledge_bases" ADD COLUMN "installed_market_version" integer;--> statement-breakpoint
ALTER TABLE "market_agents" ADD COLUMN "knowledge_bases" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "market_kb_chunks" ADD CONSTRAINT "market_kb_chunks_market_knowledge_base_id_market_knowledge_bases_id_fk" FOREIGN KEY ("market_knowledge_base_id") REFERENCES "public"."market_knowledge_bases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_kb_document_chunks" ADD CONSTRAINT "market_kb_document_chunks_document_id_market_kb_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."market_kb_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_kb_document_chunks" ADD CONSTRAINT "market_kb_document_chunks_chunk_id_market_kb_chunks_id_fk" FOREIGN KEY ("chunk_id") REFERENCES "public"."market_kb_chunks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_kb_documents" ADD CONSTRAINT "market_kb_documents_market_knowledge_base_id_market_knowledge_bases_id_fk" FOREIGN KEY ("market_knowledge_base_id") REFERENCES "public"."market_knowledge_bases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_kb_embeddings" ADD CONSTRAINT "market_kb_embeddings_market_knowledge_base_id_market_knowledge_bases_id_fk" FOREIGN KEY ("market_knowledge_base_id") REFERENCES "public"."market_knowledge_bases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_kb_embeddings" ADD CONSTRAINT "market_kb_embeddings_chunk_id_market_kb_chunks_id_fk" FOREIGN KEY ("chunk_id") REFERENCES "public"."market_kb_chunks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_kb_file_chunks" ADD CONSTRAINT "market_kb_file_chunks_file_id_market_kb_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."market_kb_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_kb_file_chunks" ADD CONSTRAINT "market_kb_file_chunks_chunk_id_market_kb_chunks_id_fk" FOREIGN KEY ("chunk_id") REFERENCES "public"."market_kb_chunks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_kb_file_links" ADD CONSTRAINT "market_kb_file_links_market_knowledge_base_id_market_knowledge_bases_id_fk" FOREIGN KEY ("market_knowledge_base_id") REFERENCES "public"."market_knowledge_bases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_kb_file_links" ADD CONSTRAINT "market_kb_file_links_file_id_market_kb_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."market_kb_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_kb_files" ADD CONSTRAINT "market_kb_files_market_knowledge_base_id_market_knowledge_bases_id_fk" FOREIGN KEY ("market_knowledge_base_id") REFERENCES "public"."market_knowledge_bases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_knowledge_bases" ADD CONSTRAINT "market_knowledge_bases_publisher_id_users_id_fk" FOREIGN KEY ("publisher_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "market_kb_chunks_market_kb_id_idx" ON "market_kb_chunks" USING btree ("market_knowledge_base_id");--> statement-breakpoint
CREATE INDEX "market_kb_documents_market_kb_id_idx" ON "market_kb_documents" USING btree ("market_knowledge_base_id");--> statement-breakpoint
CREATE INDEX "market_kb_documents_parent_id_idx" ON "market_kb_documents" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "market_kb_embeddings_market_kb_id_idx" ON "market_kb_embeddings" USING btree ("market_knowledge_base_id");--> statement-breakpoint
CREATE INDEX "market_kb_embeddings_chunk_id_idx" ON "market_kb_embeddings" USING btree ("chunk_id");--> statement-breakpoint
CREATE INDEX "market_kb_files_market_kb_id_idx" ON "market_kb_files" USING btree ("market_knowledge_base_id");--> statement-breakpoint
CREATE INDEX "market_kb_files_parent_id_idx" ON "market_kb_files" USING btree ("parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "market_knowledge_bases_identifier_unique" ON "market_knowledge_bases" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "market_knowledge_bases_publisher_id_idx" ON "market_knowledge_bases" USING btree ("publisher_id");--> statement-breakpoint
CREATE INDEX "market_knowledge_bases_status_idx" ON "market_knowledge_bases" USING btree ("status");--> statement-breakpoint
CREATE INDEX "market_knowledge_bases_visibility_idx" ON "market_knowledge_bases" USING btree ("visibility");--> statement-breakpoint
CREATE INDEX "market_knowledge_bases_install_count_idx" ON "market_knowledge_bases" USING btree ("install_count");--> statement-breakpoint
CREATE INDEX "market_knowledge_bases_updated_at_idx" ON "market_knowledge_bases" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "market_knowledge_bases_name_idx" ON "market_knowledge_bases" USING btree ("name");--> statement-breakpoint
CREATE INDEX "knowledge_bases_market_identifier_idx" ON "knowledge_bases" USING btree ("market_identifier");--> statement-breakpoint
CREATE INDEX "knowledge_bases_installed_from_market_identifier_idx" ON "knowledge_bases" USING btree ("installed_from_market_identifier");