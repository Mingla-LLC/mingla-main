import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "sites_cms"."enum_pages_blocks_offering_grid_mode" AS ENUM('upcoming', 'past', 'all');
  CREATE TYPE "sites_cms"."enum_pages_blocks_offering_grid_kind" AS ENUM('all', 'trip', 'event', 'experience');
  CREATE TYPE "sites_cms"."enum__pages_v_blocks_offering_grid_mode" AS ENUM('upcoming', 'past', 'all');
  CREATE TYPE "sites_cms"."enum__pages_v_blocks_offering_grid_kind" AS ENUM('all', 'trip', 'event', 'experience');
  ALTER TABLE "sites_cms"."pages_blocks_offering_grid" ADD COLUMN "mode" "sites_cms"."enum_pages_blocks_offering_grid_mode";
  ALTER TABLE "sites_cms"."pages_blocks_offering_grid" ADD COLUMN "kind" "sites_cms"."enum_pages_blocks_offering_grid_kind" DEFAULT 'all';
  ALTER TABLE "sites_cms"."pages_blocks_offering_grid" ADD COLUMN "limit" numeric;
  ALTER TABLE "sites_cms"."pages_blocks_offering_grid" ADD COLUMN "show_filters" boolean DEFAULT false;
  ALTER TABLE "sites_cms"."pages_blocks_offering_grid" ADD COLUMN "empty_text" varchar;
  ALTER TABLE "sites_cms"."_pages_v_blocks_offering_grid" ADD COLUMN "mode" "sites_cms"."enum__pages_v_blocks_offering_grid_mode";
  ALTER TABLE "sites_cms"."_pages_v_blocks_offering_grid" ADD COLUMN "kind" "sites_cms"."enum__pages_v_blocks_offering_grid_kind" DEFAULT 'all';
  ALTER TABLE "sites_cms"."_pages_v_blocks_offering_grid" ADD COLUMN "limit" numeric;
  ALTER TABLE "sites_cms"."_pages_v_blocks_offering_grid" ADD COLUMN "show_filters" boolean DEFAULT false;
  ALTER TABLE "sites_cms"."_pages_v_blocks_offering_grid" ADD COLUMN "empty_text" varchar;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "sites_cms"."pages_blocks_offering_grid" DROP COLUMN "mode";
  ALTER TABLE "sites_cms"."pages_blocks_offering_grid" DROP COLUMN "kind";
  ALTER TABLE "sites_cms"."pages_blocks_offering_grid" DROP COLUMN "limit";
  ALTER TABLE "sites_cms"."pages_blocks_offering_grid" DROP COLUMN "show_filters";
  ALTER TABLE "sites_cms"."pages_blocks_offering_grid" DROP COLUMN "empty_text";
  ALTER TABLE "sites_cms"."_pages_v_blocks_offering_grid" DROP COLUMN "mode";
  ALTER TABLE "sites_cms"."_pages_v_blocks_offering_grid" DROP COLUMN "kind";
  ALTER TABLE "sites_cms"."_pages_v_blocks_offering_grid" DROP COLUMN "limit";
  ALTER TABLE "sites_cms"."_pages_v_blocks_offering_grid" DROP COLUMN "show_filters";
  ALTER TABLE "sites_cms"."_pages_v_blocks_offering_grid" DROP COLUMN "empty_text";
  DROP TYPE "sites_cms"."enum_pages_blocks_offering_grid_mode";
  DROP TYPE "sites_cms"."enum_pages_blocks_offering_grid_kind";
  DROP TYPE "sites_cms"."enum__pages_v_blocks_offering_grid_mode";
  DROP TYPE "sites_cms"."enum__pages_v_blocks_offering_grid_kind";`)
}
