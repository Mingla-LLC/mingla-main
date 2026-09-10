import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/*
 * #3149 wave 4 — storage for everything this wave lets a brand say, plus one
 * new block.
 *
 * Runs AFTER `20260910_090000_issue_3149_reservations_role_enum`, which is a
 * separate file for the reason stated in it: Postgres refuses to USE a new
 * enum value in the transaction that added it. Nothing here touches
 * `enum_pages_role` at all — the split is about ordering, and this file is the
 * "later" half.
 *
 * WITHOUT THESE COLUMNS PAYLOAD DROPS THE FIELDS SILENTLY ON SAVE: the seed
 * reports success and the published page prints nothing. That is exactly what
 * happened to the eyebrow before the migration ahead of it, twice on this
 * issue, so every field added this wave is listed here.
 *
 * Three shapes:
 *   - ADD COLUMN on eight existing block tables (doubled for the parallel
 *     `_pages_v_blocks_*` draft set). Every one is a nullable column with no
 *     default, so no table is rewritten and no row is read: this cannot fail
 *     on the shape of production data, and re-running is a no-op.
 *   - Four new ENUM TYPES for the two `select` fields. Creating a type and
 *     using it in the same transaction is fine — the restriction is only on
 *     ADDING A VALUE to a type that already existed.
 *   - Four new TABLES for the `menu_preview` block and its photographs,
 *     following `20260909_180000_issue_3149_wave3_blocks`.
 *
 * `numeric` for the three numbers and `boolean` for the two checkboxes, which
 * is what the adapter gives a Payload `number` and `checkbox` — `nav_order` in
 * the foundation migration and `enabled` on `pages` are the precedents.
 *
 * NOT APPLIED BY THE AUTHOR.
 */

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  CREATE TYPE "sites_cms"."enum_pages_blocks_media_feature_media_shape" AS ENUM('rectangle', 'circle');
  CREATE TYPE "sites_cms"."enum__pages_v_blocks_media_feature_media_shape" AS ENUM('rectangle', 'circle');
  CREATE TYPE "sites_cms"."enum_pages_blocks_stats_items_icon" AS ENUM('clock', 'bowl', 'music', 'card', 'pin', 'phone');
  CREATE TYPE "sites_cms"."enum__pages_v_blocks_stats_items_icon" AS ENUM('clock', 'bowl', 'music', 'card', 'pin', 'phone');

  ALTER TABLE "sites_cms"."pages_blocks_media_feature" ADD COLUMN IF NOT EXISTS "media_shape" "sites_cms"."enum_pages_blocks_media_feature_media_shape";
  ALTER TABLE "sites_cms"."pages_blocks_media_feature" ADD COLUMN IF NOT EXISTS "badge_figure" varchar;
  ALTER TABLE "sites_cms"."pages_blocks_media_feature" ADD COLUMN IF NOT EXISTS "badge_label" varchar;
  ALTER TABLE "sites_cms"."pages_blocks_media_feature" ADD COLUMN IF NOT EXISTS "quote" varchar;
  ALTER TABLE "sites_cms"."pages_blocks_media_feature" ADD COLUMN IF NOT EXISTS "quote_attribution" varchar;
  ALTER TABLE "sites_cms"."pages_blocks_media_feature" ADD COLUMN IF NOT EXISTS "cta_label" varchar;
  ALTER TABLE "sites_cms"."pages_blocks_media_feature" ADD COLUMN IF NOT EXISTS "cta_href" varchar;
  ALTER TABLE "sites_cms"."_pages_v_blocks_media_feature" ADD COLUMN IF NOT EXISTS "media_shape" "sites_cms"."enum__pages_v_blocks_media_feature_media_shape";
  ALTER TABLE "sites_cms"."_pages_v_blocks_media_feature" ADD COLUMN IF NOT EXISTS "badge_figure" varchar;
  ALTER TABLE "sites_cms"."_pages_v_blocks_media_feature" ADD COLUMN IF NOT EXISTS "badge_label" varchar;
  ALTER TABLE "sites_cms"."_pages_v_blocks_media_feature" ADD COLUMN IF NOT EXISTS "quote" varchar;
  ALTER TABLE "sites_cms"."_pages_v_blocks_media_feature" ADD COLUMN IF NOT EXISTS "quote_attribution" varchar;
  ALTER TABLE "sites_cms"."_pages_v_blocks_media_feature" ADD COLUMN IF NOT EXISTS "cta_label" varchar;
  ALTER TABLE "sites_cms"."_pages_v_blocks_media_feature" ADD COLUMN IF NOT EXISTS "cta_href" varchar;

  ALTER TABLE "sites_cms"."pages_blocks_video_feature" ADD COLUMN IF NOT EXISTS "group_cta_label" varchar;
  ALTER TABLE "sites_cms"."pages_blocks_video_feature" ADD COLUMN IF NOT EXISTS "group_cta_href" varchar;
  ALTER TABLE "sites_cms"."_pages_v_blocks_video_feature" ADD COLUMN IF NOT EXISTS "group_cta_label" varchar;
  ALTER TABLE "sites_cms"."_pages_v_blocks_video_feature" ADD COLUMN IF NOT EXISTS "group_cta_href" varchar;

  ALTER TABLE "sites_cms"."pages_blocks_team" ADD COLUMN IF NOT EXISTS "preview_count" numeric;
  ALTER TABLE "sites_cms"."pages_blocks_team" ADD COLUMN IF NOT EXISTS "cta_label" varchar;
  ALTER TABLE "sites_cms"."pages_blocks_team" ADD COLUMN IF NOT EXISTS "cta_href" varchar;
  ALTER TABLE "sites_cms"."_pages_v_blocks_team" ADD COLUMN IF NOT EXISTS "preview_count" numeric;
  ALTER TABLE "sites_cms"."_pages_v_blocks_team" ADD COLUMN IF NOT EXISTS "cta_label" varchar;
  ALTER TABLE "sites_cms"."_pages_v_blocks_team" ADD COLUMN IF NOT EXISTS "cta_href" varchar;

  ALTER TABLE "sites_cms"."pages_blocks_hours_location" ADD COLUMN IF NOT EXISTS "always_open" boolean;
  ALTER TABLE "sites_cms"."pages_blocks_hours_location" ADD COLUMN IF NOT EXISTS "timezone" varchar;
  ALTER TABLE "sites_cms"."_pages_v_blocks_hours_location" ADD COLUMN IF NOT EXISTS "always_open" boolean;
  ALTER TABLE "sites_cms"."_pages_v_blocks_hours_location" ADD COLUMN IF NOT EXISTS "timezone" varchar;

  ALTER TABLE "sites_cms"."pages_blocks_stats_items" ADD COLUMN IF NOT EXISTS "body" varchar;
  ALTER TABLE "sites_cms"."pages_blocks_stats_items" ADD COLUMN IF NOT EXISTS "icon" "sites_cms"."enum_pages_blocks_stats_items_icon";
  ALTER TABLE "sites_cms"."pages_blocks_stats_items" ADD COLUMN IF NOT EXISTS "highlight" boolean;
  ALTER TABLE "sites_cms"."_pages_v_blocks_stats_items" ADD COLUMN IF NOT EXISTS "body" varchar;
  ALTER TABLE "sites_cms"."_pages_v_blocks_stats_items" ADD COLUMN IF NOT EXISTS "icon" "sites_cms"."enum__pages_v_blocks_stats_items_icon";
  ALTER TABLE "sites_cms"."_pages_v_blocks_stats_items" ADD COLUMN IF NOT EXISTS "highlight" boolean;

  CREATE TABLE "sites_cms"."pages_blocks_menu_preview_images" (
  	"_order" integer NOT NULL,
  	"_parent_id" varchar NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"media_id" uuid,
  	"alt" varchar
  );

  CREATE TABLE "sites_cms"."pages_blocks_menu_preview" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"_path" text NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"eyebrow" varchar,
  	"heading" varchar,
  	"note" varchar,
  	"section_limit" numeric,
  	"item_limit" numeric,
  	"cta_label" varchar,
  	"cta_href" varchar,
  	"block_name" varchar
  );

  CREATE TABLE "sites_cms"."_pages_v_blocks_menu_preview_images" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"media_id" uuid,
  	"alt" varchar,
  	"_uuid" varchar
  );

  CREATE TABLE "sites_cms"."_pages_v_blocks_menu_preview" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"_path" text NOT NULL,
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"eyebrow" varchar,
  	"heading" varchar,
  	"note" varchar,
  	"section_limit" numeric,
  	"item_limit" numeric,
  	"cta_label" varchar,
  	"cta_href" varchar,
  	"_uuid" varchar,
  	"block_name" varchar
  );

  ALTER TABLE "sites_cms"."pages_blocks_menu_preview_images" ADD CONSTRAINT "pages_blocks_menu_preview_images_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "sites_cms"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "sites_cms"."pages_blocks_menu_preview_images" ADD CONSTRAINT "pages_blocks_menu_preview_images_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."pages_blocks_menu_preview"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."pages_blocks_menu_preview" ADD CONSTRAINT "pages_blocks_menu_preview_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."pages"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."_pages_v_blocks_menu_preview_images" ADD CONSTRAINT "_pages_v_blocks_menu_preview_images_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "sites_cms"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "sites_cms"."_pages_v_blocks_menu_preview_images" ADD CONSTRAINT "_pages_v_blocks_menu_preview_images_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."_pages_v_blocks_menu_preview"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."_pages_v_blocks_menu_preview" ADD CONSTRAINT "_pages_v_blocks_menu_preview_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."_pages_v"("id") ON DELETE cascade ON UPDATE no action;

  CREATE INDEX "pages_blocks_menu_preview_images_order_idx" ON "sites_cms"."pages_blocks_menu_preview_images" USING btree ("_order");
  CREATE INDEX "pages_blocks_menu_preview_images_parent_id_idx" ON "sites_cms"."pages_blocks_menu_preview_images" USING btree ("_parent_id");
  CREATE INDEX "pages_blocks_menu_preview_images_media_idx" ON "sites_cms"."pages_blocks_menu_preview_images" USING btree ("media_id");
  CREATE INDEX "pages_blocks_menu_preview_order_idx" ON "sites_cms"."pages_blocks_menu_preview" USING btree ("_order");
  CREATE INDEX "pages_blocks_menu_preview_parent_id_idx" ON "sites_cms"."pages_blocks_menu_preview" USING btree ("_parent_id");
  CREATE INDEX "pages_blocks_menu_preview_path_idx" ON "sites_cms"."pages_blocks_menu_preview" USING btree ("_path");
  CREATE INDEX "_pages_v_blocks_menu_preview_images_order_idx" ON "sites_cms"."_pages_v_blocks_menu_preview_images" USING btree ("_order");
  CREATE INDEX "_pages_v_blocks_menu_preview_images_parent_id_idx" ON "sites_cms"."_pages_v_blocks_menu_preview_images" USING btree ("_parent_id");
  CREATE INDEX "_pages_v_blocks_menu_preview_images_media_idx" ON "sites_cms"."_pages_v_blocks_menu_preview_images" USING btree ("media_id");
  CREATE INDEX "_pages_v_blocks_menu_preview_order_idx" ON "sites_cms"."_pages_v_blocks_menu_preview" USING btree ("_order");
  CREATE INDEX "_pages_v_blocks_menu_preview_parent_id_idx" ON "sites_cms"."_pages_v_blocks_menu_preview" USING btree ("_parent_id");
  CREATE INDEX "_pages_v_blocks_menu_preview_path_idx" ON "sites_cms"."_pages_v_blocks_menu_preview" USING btree ("_path");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
  DROP TABLE "sites_cms"."pages_blocks_menu_preview_images" CASCADE;
  DROP TABLE "sites_cms"."pages_blocks_menu_preview" CASCADE;
  DROP TABLE "sites_cms"."_pages_v_blocks_menu_preview_images" CASCADE;
  DROP TABLE "sites_cms"."_pages_v_blocks_menu_preview" CASCADE;

  ALTER TABLE "sites_cms"."pages_blocks_media_feature" DROP COLUMN IF EXISTS "media_shape";
  ALTER TABLE "sites_cms"."pages_blocks_media_feature" DROP COLUMN IF EXISTS "badge_figure";
  ALTER TABLE "sites_cms"."pages_blocks_media_feature" DROP COLUMN IF EXISTS "badge_label";
  ALTER TABLE "sites_cms"."pages_blocks_media_feature" DROP COLUMN IF EXISTS "quote";
  ALTER TABLE "sites_cms"."pages_blocks_media_feature" DROP COLUMN IF EXISTS "quote_attribution";
  ALTER TABLE "sites_cms"."pages_blocks_media_feature" DROP COLUMN IF EXISTS "cta_label";
  ALTER TABLE "sites_cms"."pages_blocks_media_feature" DROP COLUMN IF EXISTS "cta_href";
  ALTER TABLE "sites_cms"."_pages_v_blocks_media_feature" DROP COLUMN IF EXISTS "media_shape";
  ALTER TABLE "sites_cms"."_pages_v_blocks_media_feature" DROP COLUMN IF EXISTS "badge_figure";
  ALTER TABLE "sites_cms"."_pages_v_blocks_media_feature" DROP COLUMN IF EXISTS "badge_label";
  ALTER TABLE "sites_cms"."_pages_v_blocks_media_feature" DROP COLUMN IF EXISTS "quote";
  ALTER TABLE "sites_cms"."_pages_v_blocks_media_feature" DROP COLUMN IF EXISTS "quote_attribution";
  ALTER TABLE "sites_cms"."_pages_v_blocks_media_feature" DROP COLUMN IF EXISTS "cta_label";
  ALTER TABLE "sites_cms"."_pages_v_blocks_media_feature" DROP COLUMN IF EXISTS "cta_href";

  ALTER TABLE "sites_cms"."pages_blocks_video_feature" DROP COLUMN IF EXISTS "group_cta_label";
  ALTER TABLE "sites_cms"."pages_blocks_video_feature" DROP COLUMN IF EXISTS "group_cta_href";
  ALTER TABLE "sites_cms"."_pages_v_blocks_video_feature" DROP COLUMN IF EXISTS "group_cta_label";
  ALTER TABLE "sites_cms"."_pages_v_blocks_video_feature" DROP COLUMN IF EXISTS "group_cta_href";

  ALTER TABLE "sites_cms"."pages_blocks_team" DROP COLUMN IF EXISTS "preview_count";
  ALTER TABLE "sites_cms"."pages_blocks_team" DROP COLUMN IF EXISTS "cta_label";
  ALTER TABLE "sites_cms"."pages_blocks_team" DROP COLUMN IF EXISTS "cta_href";
  ALTER TABLE "sites_cms"."_pages_v_blocks_team" DROP COLUMN IF EXISTS "preview_count";
  ALTER TABLE "sites_cms"."_pages_v_blocks_team" DROP COLUMN IF EXISTS "cta_label";
  ALTER TABLE "sites_cms"."_pages_v_blocks_team" DROP COLUMN IF EXISTS "cta_href";

  ALTER TABLE "sites_cms"."pages_blocks_hours_location" DROP COLUMN IF EXISTS "always_open";
  ALTER TABLE "sites_cms"."pages_blocks_hours_location" DROP COLUMN IF EXISTS "timezone";
  ALTER TABLE "sites_cms"."_pages_v_blocks_hours_location" DROP COLUMN IF EXISTS "always_open";
  ALTER TABLE "sites_cms"."_pages_v_blocks_hours_location" DROP COLUMN IF EXISTS "timezone";

  ALTER TABLE "sites_cms"."pages_blocks_stats_items" DROP COLUMN IF EXISTS "body";
  ALTER TABLE "sites_cms"."pages_blocks_stats_items" DROP COLUMN IF EXISTS "icon";
  ALTER TABLE "sites_cms"."pages_blocks_stats_items" DROP COLUMN IF EXISTS "highlight";
  ALTER TABLE "sites_cms"."_pages_v_blocks_stats_items" DROP COLUMN IF EXISTS "body";
  ALTER TABLE "sites_cms"."_pages_v_blocks_stats_items" DROP COLUMN IF EXISTS "icon";
  ALTER TABLE "sites_cms"."_pages_v_blocks_stats_items" DROP COLUMN IF EXISTS "highlight";

  DROP TYPE IF EXISTS "sites_cms"."enum_pages_blocks_media_feature_media_shape";
  DROP TYPE IF EXISTS "sites_cms"."enum__pages_v_blocks_media_feature_media_shape";
  DROP TYPE IF EXISTS "sites_cms"."enum_pages_blocks_stats_items_icon";
  DROP TYPE IF EXISTS "sites_cms"."enum__pages_v_blocks_stats_items_icon";`)
}
