import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/*
 * #4453 milestone 7b (spec v2.1 §1.1-§1.3, v2 §5.6) — Studio's half of the
 * page-set blocks:
 * - `page_links` ("Keep exploring": eyebrow, heading, mode; the pages are
 *   computed at publish, never stored) and `facts_table` (the owner's facts,
 *   with its `items` array table), live AND versioned (`_pages_v`), each with
 *   its layout enum and the Draft `review`;
 * - the hero's `fact_badges` array (the owner's Quick facts), live and
 *   versioned;
 * - the rooms base `routes_stays` on site settings, live and versioned.
 * Additive only: no existing table, column or enum value changes.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  CREATE TYPE "sites_cms"."enum_pages_blocks_page_links_mode" AS ENUM('teaser', 'next');
  CREATE TYPE "sites_cms"."enum_pages_blocks_page_links_variant" AS ENUM('neutral', 'cards', 'list');
  CREATE TYPE "sites_cms"."enum_pages_blocks_facts_table_variant" AS ENUM('neutral', 'split');
  CREATE TYPE "sites_cms"."enum__pages_v_blocks_page_links_mode" AS ENUM('teaser', 'next');
  CREATE TYPE "sites_cms"."enum__pages_v_blocks_page_links_variant" AS ENUM('neutral', 'cards', 'list');
  CREATE TYPE "sites_cms"."enum__pages_v_blocks_facts_table_variant" AS ENUM('neutral', 'split');
  CREATE TABLE "sites_cms"."pages_blocks_page_links" (
	"_order" integer NOT NULL,
	"_parent_id" uuid NOT NULL,
	"_path" text NOT NULL,
	"id" varchar PRIMARY KEY NOT NULL,
	"eyebrow" varchar,
	"heading" varchar,
	"mode" "sites_cms"."enum_pages_blocks_page_links_mode" DEFAULT 'next',
	"variant" "sites_cms"."enum_pages_blocks_page_links_variant" DEFAULT 'neutral',
	"review" jsonb,
	"block_name" varchar
  );
  CREATE TABLE "sites_cms"."_pages_v_blocks_page_links" (
	"_order" integer NOT NULL,
	"_parent_id" uuid NOT NULL,
	"_path" text NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"eyebrow" varchar,
	"heading" varchar,
	"mode" "sites_cms"."enum__pages_v_blocks_page_links_mode" DEFAULT 'next',
	"variant" "sites_cms"."enum__pages_v_blocks_page_links_variant" DEFAULT 'neutral',
	"review" jsonb,
	"_uuid" varchar,
	"block_name" varchar
  );
  CREATE TABLE "sites_cms"."pages_blocks_facts_table" (
	"_order" integer NOT NULL,
	"_parent_id" uuid NOT NULL,
	"_path" text NOT NULL,
	"id" varchar PRIMARY KEY NOT NULL,
	"eyebrow" varchar,
	"heading" varchar,
	"variant" "sites_cms"."enum_pages_blocks_facts_table_variant" DEFAULT 'neutral',
	"review" jsonb,
	"block_name" varchar
  );
  CREATE TABLE "sites_cms"."_pages_v_blocks_facts_table" (
	"_order" integer NOT NULL,
	"_parent_id" uuid NOT NULL,
	"_path" text NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"eyebrow" varchar,
	"heading" varchar,
	"variant" "sites_cms"."enum__pages_v_blocks_facts_table_variant" DEFAULT 'neutral',
	"review" jsonb,
	"_uuid" varchar,
	"block_name" varchar
  );
  CREATE TABLE "sites_cms"."pages_blocks_facts_table_items" (
	"_order" integer NOT NULL,
	"_parent_id" varchar NOT NULL,
	"id" varchar PRIMARY KEY NOT NULL,
	"label" varchar,
	"value" varchar
  );
  CREATE TABLE "sites_cms"."_pages_v_blocks_facts_table_items" (
	"_order" integer NOT NULL,
	"_parent_id" uuid NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"label" varchar,
	"value" varchar,
	"_uuid" varchar
  );
  CREATE TABLE "sites_cms"."pages_blocks_hero_fact_badges" (
	"_order" integer NOT NULL,
	"_parent_id" varchar NOT NULL,
	"id" varchar PRIMARY KEY NOT NULL,
	"big" varchar,
	"small" varchar
  );
  CREATE TABLE "sites_cms"."_pages_v_blocks_hero_fact_badges" (
	"_order" integer NOT NULL,
	"_parent_id" uuid NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"big" varchar,
	"small" varchar,
	"_uuid" varchar
  );
  ALTER TABLE "sites_cms"."site_settings" ADD COLUMN IF NOT EXISTS "routes_stays" varchar;
  ALTER TABLE "sites_cms"."_site_settings_v" ADD COLUMN IF NOT EXISTS "version_routes_stays" varchar;
  ALTER TABLE "sites_cms"."pages_blocks_page_links" ADD CONSTRAINT "pages_blocks_page_links_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."pages"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "pages_blocks_page_links_order_idx" ON "sites_cms"."pages_blocks_page_links" USING btree ("_order");
  CREATE INDEX "pages_blocks_page_links_parent_id_idx" ON "sites_cms"."pages_blocks_page_links" USING btree ("_parent_id");
  CREATE INDEX "pages_blocks_page_links_path_idx" ON "sites_cms"."pages_blocks_page_links" USING btree ("_path");
  ALTER TABLE "sites_cms"."_pages_v_blocks_page_links" ADD CONSTRAINT "_pages_v_blocks_page_links_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."_pages_v"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "_pages_v_blocks_page_links_order_idx" ON "sites_cms"."_pages_v_blocks_page_links" USING btree ("_order");
  CREATE INDEX "_pages_v_blocks_page_links_parent_id_idx" ON "sites_cms"."_pages_v_blocks_page_links" USING btree ("_parent_id");
  CREATE INDEX "_pages_v_blocks_page_links_path_idx" ON "sites_cms"."_pages_v_blocks_page_links" USING btree ("_path");
  ALTER TABLE "sites_cms"."pages_blocks_facts_table" ADD CONSTRAINT "pages_blocks_facts_table_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."pages"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "pages_blocks_facts_table_order_idx" ON "sites_cms"."pages_blocks_facts_table" USING btree ("_order");
  CREATE INDEX "pages_blocks_facts_table_parent_id_idx" ON "sites_cms"."pages_blocks_facts_table" USING btree ("_parent_id");
  CREATE INDEX "pages_blocks_facts_table_path_idx" ON "sites_cms"."pages_blocks_facts_table" USING btree ("_path");
  ALTER TABLE "sites_cms"."_pages_v_blocks_facts_table" ADD CONSTRAINT "_pages_v_blocks_facts_table_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."_pages_v"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "_pages_v_blocks_facts_table_order_idx" ON "sites_cms"."_pages_v_blocks_facts_table" USING btree ("_order");
  CREATE INDEX "_pages_v_blocks_facts_table_parent_id_idx" ON "sites_cms"."_pages_v_blocks_facts_table" USING btree ("_parent_id");
  CREATE INDEX "_pages_v_blocks_facts_table_path_idx" ON "sites_cms"."_pages_v_blocks_facts_table" USING btree ("_path");
  ALTER TABLE "sites_cms"."pages_blocks_facts_table_items" ADD CONSTRAINT "pages_blocks_facts_table_items_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."pages_blocks_facts_table"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "pages_blocks_facts_table_items_order_idx" ON "sites_cms"."pages_blocks_facts_table_items" USING btree ("_order");
  CREATE INDEX "pages_blocks_facts_table_items_parent_id_idx" ON "sites_cms"."pages_blocks_facts_table_items" USING btree ("_parent_id");
  ALTER TABLE "sites_cms"."_pages_v_blocks_facts_table_items" ADD CONSTRAINT "_pages_v_blocks_facts_table_items_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."_pages_v_blocks_facts_table"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "_pages_v_blocks_facts_table_items_order_idx" ON "sites_cms"."_pages_v_blocks_facts_table_items" USING btree ("_order");
  CREATE INDEX "_pages_v_blocks_facts_table_items_parent_id_idx" ON "sites_cms"."_pages_v_blocks_facts_table_items" USING btree ("_parent_id");
  ALTER TABLE "sites_cms"."pages_blocks_hero_fact_badges" ADD CONSTRAINT "pages_blocks_hero_fact_badges_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."pages_blocks_hero"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "pages_blocks_hero_fact_badges_order_idx" ON "sites_cms"."pages_blocks_hero_fact_badges" USING btree ("_order");
  CREATE INDEX "pages_blocks_hero_fact_badges_parent_id_idx" ON "sites_cms"."pages_blocks_hero_fact_badges" USING btree ("_parent_id");
  ALTER TABLE "sites_cms"."_pages_v_blocks_hero_fact_badges" ADD CONSTRAINT "_pages_v_blocks_hero_fact_badges_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."_pages_v_blocks_hero"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "_pages_v_blocks_hero_fact_badges_order_idx" ON "sites_cms"."_pages_v_blocks_hero_fact_badges" USING btree ("_order");
  CREATE INDEX "_pages_v_blocks_hero_fact_badges_parent_id_idx" ON "sites_cms"."_pages_v_blocks_hero_fact_badges" USING btree ("_parent_id");
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
  DROP TABLE IF EXISTS "sites_cms"."_pages_v_blocks_hero_fact_badges" CASCADE;
  DROP TABLE IF EXISTS "sites_cms"."pages_blocks_hero_fact_badges" CASCADE;
  DROP TABLE IF EXISTS "sites_cms"."_pages_v_blocks_facts_table_items" CASCADE;
  DROP TABLE IF EXISTS "sites_cms"."pages_blocks_facts_table_items" CASCADE;
  DROP TABLE IF EXISTS "sites_cms"."_pages_v_blocks_facts_table" CASCADE;
  DROP TABLE IF EXISTS "sites_cms"."pages_blocks_facts_table" CASCADE;
  DROP TABLE IF EXISTS "sites_cms"."_pages_v_blocks_page_links" CASCADE;
  DROP TABLE IF EXISTS "sites_cms"."pages_blocks_page_links" CASCADE;
  ALTER TABLE "sites_cms"."site_settings" DROP COLUMN IF EXISTS "routes_stays";
  ALTER TABLE "sites_cms"."_site_settings_v" DROP COLUMN IF EXISTS "version_routes_stays";
  DROP TYPE IF EXISTS "sites_cms"."enum_pages_blocks_page_links_mode";
  DROP TYPE IF EXISTS "sites_cms"."enum_pages_blocks_page_links_variant";
  DROP TYPE IF EXISTS "sites_cms"."enum_pages_blocks_facts_table_variant";
  DROP TYPE IF EXISTS "sites_cms"."enum__pages_v_blocks_page_links_mode";
  DROP TYPE IF EXISTS "sites_cms"."enum__pages_v_blocks_page_links_variant";
  DROP TYPE IF EXISTS "sites_cms"."enum__pages_v_blocks_facts_table_variant";
  `)
}
