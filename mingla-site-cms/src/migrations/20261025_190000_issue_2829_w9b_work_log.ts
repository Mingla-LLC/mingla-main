import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "sites_cms"."enum_destinations_drafted_by" AS ENUM('ari');
  CREATE TYPE "sites_cms"."enum__destinations_v_version_drafted_by" AS ENUM('ari');
  CREATE TYPE "sites_cms"."enum_stories_drafted_by" AS ENUM('ari');
  CREATE TYPE "sites_cms"."enum__stories_v_version_drafted_by" AS ENUM('ari');
  CREATE TYPE "sites_cms"."enum_testimonials_drafted_by" AS ENUM('ari');
  CREATE TYPE "sites_cms"."enum__testimonials_v_version_drafted_by" AS ENUM('ari');
  CREATE TYPE "sites_cms"."enum_work_log_part" AS ENUM('plan', 'draft', 'composition', 'variant', 'tokens', 'copy', 'imagery', 'collection', 'trip_guide');
  CREATE TYPE "sites_cms"."enum_work_log_actor" AS ENUM('ari', 'user');
  CREATE TYPE "sites_cms"."enum_design_check_runs_run_by" AS ENUM('ari', 'user');
  CREATE TABLE "sites_cms"."work_log" (
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"tenant_id" uuid,
  	"part" "sites_cms"."enum_work_log_part" NOT NULL,
  	"decision" varchar NOT NULL,
  	"cites" jsonb NOT NULL,
  	"actor" "sites_cms"."enum_work_log_actor" NOT NULL,
  	"actor_user_id" varchar,
  	"tool" varchar,
  	"target" varchar,
  	"revision" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "sites_cms"."design_check_runs" (
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"tenant_id" uuid,
  	"draft_digest" varchar NOT NULL,
  	"results" jsonb NOT NULL,
  	"warning_count" numeric NOT NULL,
  	"run_by" "sites_cms"."enum_design_check_runs_run_by" NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "sites_cms"."destinations" ADD COLUMN "drafted_by" "sites_cms"."enum_destinations_drafted_by";
  ALTER TABLE "sites_cms"."_destinations_v" ADD COLUMN "version_drafted_by" "sites_cms"."enum__destinations_v_version_drafted_by";
  ALTER TABLE "sites_cms"."stories" ADD COLUMN "drafted_by" "sites_cms"."enum_stories_drafted_by";
  ALTER TABLE "sites_cms"."_stories_v" ADD COLUMN "version_drafted_by" "sites_cms"."enum__stories_v_version_drafted_by";
  ALTER TABLE "sites_cms"."testimonials" ADD COLUMN "drafted_by" "sites_cms"."enum_testimonials_drafted_by";
  ALTER TABLE "sites_cms"."_testimonials_v" ADD COLUMN "version_drafted_by" "sites_cms"."enum__testimonials_v_version_drafted_by";
  ALTER TABLE "sites_cms"."payload_locked_documents_rels" ADD COLUMN "work_log_id" uuid;
  ALTER TABLE "sites_cms"."payload_locked_documents_rels" ADD COLUMN "design_check_runs_id" uuid;
  ALTER TABLE "sites_cms"."work_log" ADD CONSTRAINT "work_log_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "sites_cms"."tenants"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "sites_cms"."design_check_runs" ADD CONSTRAINT "design_check_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "sites_cms"."tenants"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "work_log_tenant_idx" ON "sites_cms"."work_log" USING btree ("tenant_id");
  CREATE INDEX "work_log_updated_at_idx" ON "sites_cms"."work_log" USING btree ("updated_at");
  CREATE INDEX "work_log_created_at_idx" ON "sites_cms"."work_log" USING btree ("created_at");
  CREATE INDEX "design_check_runs_tenant_idx" ON "sites_cms"."design_check_runs" USING btree ("tenant_id");
  CREATE INDEX "design_check_runs_draft_digest_idx" ON "sites_cms"."design_check_runs" USING btree ("draft_digest");
  CREATE INDEX "design_check_runs_updated_at_idx" ON "sites_cms"."design_check_runs" USING btree ("updated_at");
  CREATE INDEX "design_check_runs_created_at_idx" ON "sites_cms"."design_check_runs" USING btree ("created_at");
  ALTER TABLE "sites_cms"."payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_work_log_fk" FOREIGN KEY ("work_log_id") REFERENCES "sites_cms"."work_log"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_design_check_runs_fk" FOREIGN KEY ("design_check_runs_id") REFERENCES "sites_cms"."design_check_runs"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_work_log_id_idx" ON "sites_cms"."payload_locked_documents_rels" USING btree ("work_log_id");
  CREATE INDEX "payload_locked_documents_rels_design_check_runs_id_idx" ON "sites_cms"."payload_locked_documents_rels" USING btree ("design_check_runs_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "sites_cms"."work_log" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "sites_cms"."design_check_runs" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "sites_cms"."work_log" CASCADE;
  DROP TABLE "sites_cms"."design_check_runs" CASCADE;
  ALTER TABLE "sites_cms"."payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_work_log_fk";
  
  ALTER TABLE "sites_cms"."payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_design_check_runs_fk";
  
  DROP INDEX "sites_cms"."payload_locked_documents_rels_work_log_id_idx";
  DROP INDEX "sites_cms"."payload_locked_documents_rels_design_check_runs_id_idx";
  ALTER TABLE "sites_cms"."destinations" DROP COLUMN "drafted_by";
  ALTER TABLE "sites_cms"."_destinations_v" DROP COLUMN "version_drafted_by";
  ALTER TABLE "sites_cms"."stories" DROP COLUMN "drafted_by";
  ALTER TABLE "sites_cms"."_stories_v" DROP COLUMN "version_drafted_by";
  ALTER TABLE "sites_cms"."testimonials" DROP COLUMN "drafted_by";
  ALTER TABLE "sites_cms"."_testimonials_v" DROP COLUMN "version_drafted_by";
  ALTER TABLE "sites_cms"."payload_locked_documents_rels" DROP COLUMN "work_log_id";
  ALTER TABLE "sites_cms"."payload_locked_documents_rels" DROP COLUMN "design_check_runs_id";
  DROP TYPE "sites_cms"."enum_destinations_drafted_by";
  DROP TYPE "sites_cms"."enum__destinations_v_version_drafted_by";
  DROP TYPE "sites_cms"."enum_stories_drafted_by";
  DROP TYPE "sites_cms"."enum__stories_v_version_drafted_by";
  DROP TYPE "sites_cms"."enum_testimonials_drafted_by";
  DROP TYPE "sites_cms"."enum__testimonials_v_version_drafted_by";
  DROP TYPE "sites_cms"."enum_work_log_part";
  DROP TYPE "sites_cms"."enum_work_log_actor";
  DROP TYPE "sites_cms"."enum_design_check_runs_run_by";`)
}
