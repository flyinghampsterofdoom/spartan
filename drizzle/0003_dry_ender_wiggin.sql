DROP INDEX "attachments_owner_idx";--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "checksum_sha256" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "attachments" ALTER COLUMN "checksum_sha256" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "related_event_id" uuid;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "deleted_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "deletion_reason" text;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "object_delete_pending" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "punch_items" ADD COLUMN "client_request_id" text;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_deleted_by_user_id_users_id_fk" FOREIGN KEY ("deleted_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "attachments_storage_key_uq" ON "attachments" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "attachments_event_idx" ON "attachments" USING btree ("related_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "punch_client_request_uq" ON "punch_items" USING btree ("project_id","client_request_id") WHERE "punch_items"."client_request_id" is not null;--> statement-breakpoint
CREATE INDEX "attachments_owner_idx" ON "attachments" USING btree ("organization_id","owner_type","owner_id");
