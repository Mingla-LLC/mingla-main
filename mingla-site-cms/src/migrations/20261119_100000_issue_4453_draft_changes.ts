import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/*
 * #4453 website workspace (build contract C) — the draft's undo / redo
 * history: one new table, `draft_changes` (a page, the look or the menu before
 * and after one change; rows of one change share `group_id`), its three enums,
 * and the column Payload's document locks need for every collection.
 *
 * Additive only: no existing table, column or enum value changes. The table
 * holds drafts only and is never read by the publish builder.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  CREATE TYPE "sites_cms"."enum_draft_changes_actor" AS ENUM('user', 'ari', 'team');
  CREATE TYPE "sites_cms"."enum_draft_changes_target" AS ENUM('page', 'look', 'menu');
  CREATE TYPE "sites_cms"."enum_draft_changes_state" AS ENUM('applied', 'undone', 'superseded');
  CREATE TABLE "sites_cms"."draft_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"group_id" varchar NOT NULL,
	"seq" numeric NOT NULL,
	"label" varchar NOT NULL,
	"group_label" varchar,
	"actor" "sites_cms"."enum_draft_changes_actor" NOT NULL,
	"actor_user_id" varchar,
	"target" "sites_cms"."enum_draft_changes_target" NOT NULL,
	"target_id" varchar,
	"before" jsonb,
	"after" jsonb,
	"state" "sites_cms"."enum_draft_changes_state" DEFAULT 'applied' NOT NULL,
	"merge_key" varchar,
	"tool" varchar,
	"operation_id" varchar,
	"result" jsonb,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );

  ALTER TABLE "sites_cms"."payload_locked_documents_rels" ADD COLUMN "draft_changes_id" uuid;
  ALTER TABLE "sites_cms"."draft_changes" ADD CONSTRAINT "draft_changes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "sites_cms"."tenants"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "draft_changes_tenant_idx" ON "sites_cms"."draft_changes" USING btree ("tenant_id");
  CREATE INDEX "draft_changes_group_id_idx" ON "sites_cms"."draft_changes" USING btree ("group_id");
  CREATE INDEX "draft_changes_seq_idx" ON "sites_cms"."draft_changes" USING btree ("seq");
  CREATE INDEX "draft_changes_operation_id_idx" ON "sites_cms"."draft_changes" USING btree ("operation_id");
  CREATE INDEX "draft_changes_state_idx" ON "sites_cms"."draft_changes" USING btree ("state");
  CREATE INDEX "draft_changes_updated_at_idx" ON "sites_cms"."draft_changes" USING btree ("updated_at");
  CREATE INDEX "draft_changes_created_at_idx" ON "sites_cms"."draft_changes" USING btree ("created_at");
  ALTER TABLE "sites_cms"."payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_draft_changes_fk" FOREIGN KEY ("draft_changes_id") REFERENCES "sites_cms"."draft_changes"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_draft_changes_id_idx" ON "sites_cms"."payload_locked_documents_rels" USING btree ("draft_changes_id");`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "sites_cms"."payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_draft_changes_fk";
  DROP INDEX IF EXISTS "sites_cms"."payload_locked_documents_rels_draft_changes_id_idx";
  ALTER TABLE "sites_cms"."payload_locked_documents_rels" DROP COLUMN IF EXISTS "draft_changes_id";
  DROP TABLE IF EXISTS "sites_cms"."draft_changes" CASCADE;
  DROP TYPE IF EXISTS "sites_cms"."enum_draft_changes_actor";
  DROP TYPE IF EXISTS "sites_cms"."enum_draft_changes_target";
  DROP TYPE IF EXISTS "sites_cms"."enum_draft_changes_state";`)
}
