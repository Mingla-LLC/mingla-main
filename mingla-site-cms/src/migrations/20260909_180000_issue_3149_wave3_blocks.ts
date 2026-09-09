import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/*
 * #3149 wave 3 — storage for the four shapes the reference site has and a page
 * here could not hold: a scrolling strip of phrases, a row of figures, a
 * pulled quotation, and a map of one place.
 *
 * Twelve tables, six per block that has an array inside it and one each for
 * the two that do not, doubled because Payload keeps drafts in a parallel
 * `_pages_v_blocks_*` set. WITHOUT THESE, PAYLOAD DROPS THE WHOLE BLOCK
 * SILENTLY on save: a seed would report success and publish nothing, which is
 * exactly what happened to the eyebrow before the migration ahead of this one.
 *
 * Hand-written, following `20260908_152637_issue_2830_video_team_menu_blocks`.
 * Nothing existing is touched: every statement CREATEs a new object, no table
 * is rewritten and no row is read, so this cannot fail on the shape of
 * production data. `latitude` and `longitude` are `numeric`, which is what the
 * adapter gives a Payload `number` field — `nav_order` in the foundation
 * migration is the precedent.
 *
 * NOT APPLIED BY THE AUTHOR. Applying it needs a temporary privilege grant on
 * `sites_cms_migrator` and explicit approval at the time.
 */

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`

  CREATE TABLE "sites_cms"."pages_blocks_marquee_phrases" (
  	"_order" integer NOT NULL,
  	"_parent_id" varchar NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"text" varchar
  );

  CREATE TABLE "sites_cms"."pages_blocks_marquee" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"_path" text NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"block_name" varchar
  );

  CREATE TABLE "sites_cms"."pages_blocks_stats_items" (
  	"_order" integer NOT NULL,
  	"_parent_id" varchar NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"figure" varchar,
  	"label" varchar
  );

  CREATE TABLE "sites_cms"."pages_blocks_stats" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"_path" text NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"eyebrow" varchar,
  	"heading" varchar,
  	"body" varchar,
  	"block_name" varchar
  );

  CREATE TABLE "sites_cms"."pages_blocks_pull_quote" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"_path" text NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"quote" varchar,
  	"attribution" varchar,
  	"block_name" varchar
  );

  CREATE TABLE "sites_cms"."pages_blocks_map_embed" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"_path" text NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"eyebrow" varchar,
  	"heading" varchar,
  	"body" varchar,
  	"latitude" numeric,
  	"longitude" numeric,
  	"place_label" varchar,
  	"directions_url" varchar,
  	"block_name" varchar
  );

  CREATE TABLE "sites_cms"."_pages_v_blocks_marquee_phrases" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"text" varchar,
  	"_uuid" varchar
  );

  CREATE TABLE "sites_cms"."_pages_v_blocks_marquee" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"_path" text NOT NULL,
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"_uuid" varchar,
  	"block_name" varchar
  );

  CREATE TABLE "sites_cms"."_pages_v_blocks_stats_items" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"figure" varchar,
  	"label" varchar,
  	"_uuid" varchar
  );

  CREATE TABLE "sites_cms"."_pages_v_blocks_stats" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"_path" text NOT NULL,
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"eyebrow" varchar,
  	"heading" varchar,
  	"body" varchar,
  	"_uuid" varchar,
  	"block_name" varchar
  );

  CREATE TABLE "sites_cms"."_pages_v_blocks_pull_quote" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"_path" text NOT NULL,
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"quote" varchar,
  	"attribution" varchar,
  	"_uuid" varchar,
  	"block_name" varchar
  );

  CREATE TABLE "sites_cms"."_pages_v_blocks_map_embed" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"_path" text NOT NULL,
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"eyebrow" varchar,
  	"heading" varchar,
  	"body" varchar,
  	"latitude" numeric,
  	"longitude" numeric,
  	"place_label" varchar,
  	"directions_url" varchar,
  	"_uuid" varchar,
  	"block_name" varchar
  );

  ALTER TABLE "sites_cms"."pages_blocks_marquee_phrases" ADD CONSTRAINT "pages_blocks_marquee_phrases_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."pages_blocks_marquee"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."pages_blocks_marquee" ADD CONSTRAINT "pages_blocks_marquee_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."pages"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."pages_blocks_stats_items" ADD CONSTRAINT "pages_blocks_stats_items_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."pages_blocks_stats"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."pages_blocks_stats" ADD CONSTRAINT "pages_blocks_stats_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."pages"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."pages_blocks_pull_quote" ADD CONSTRAINT "pages_blocks_pull_quote_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."pages"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."pages_blocks_map_embed" ADD CONSTRAINT "pages_blocks_map_embed_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."pages"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."_pages_v_blocks_marquee_phrases" ADD CONSTRAINT "_pages_v_blocks_marquee_phrases_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."_pages_v_blocks_marquee"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."_pages_v_blocks_marquee" ADD CONSTRAINT "_pages_v_blocks_marquee_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."_pages_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."_pages_v_blocks_stats_items" ADD CONSTRAINT "_pages_v_blocks_stats_items_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."_pages_v_blocks_stats"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."_pages_v_blocks_stats" ADD CONSTRAINT "_pages_v_blocks_stats_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."_pages_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."_pages_v_blocks_pull_quote" ADD CONSTRAINT "_pages_v_blocks_pull_quote_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."_pages_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."_pages_v_blocks_map_embed" ADD CONSTRAINT "_pages_v_blocks_map_embed_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."_pages_v"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "pages_blocks_marquee_phrases_order_idx" ON "sites_cms"."pages_blocks_marquee_phrases" USING btree ("_order");
  CREATE INDEX "pages_blocks_marquee_phrases_parent_id_idx" ON "sites_cms"."pages_blocks_marquee_phrases" USING btree ("_parent_id");
  CREATE INDEX "pages_blocks_marquee_order_idx" ON "sites_cms"."pages_blocks_marquee" USING btree ("_order");
  CREATE INDEX "pages_blocks_marquee_parent_id_idx" ON "sites_cms"."pages_blocks_marquee" USING btree ("_parent_id");
  CREATE INDEX "pages_blocks_marquee_path_idx" ON "sites_cms"."pages_blocks_marquee" USING btree ("_path");
  CREATE INDEX "pages_blocks_stats_items_order_idx" ON "sites_cms"."pages_blocks_stats_items" USING btree ("_order");
  CREATE INDEX "pages_blocks_stats_items_parent_id_idx" ON "sites_cms"."pages_blocks_stats_items" USING btree ("_parent_id");
  CREATE INDEX "pages_blocks_stats_order_idx" ON "sites_cms"."pages_blocks_stats" USING btree ("_order");
  CREATE INDEX "pages_blocks_stats_parent_id_idx" ON "sites_cms"."pages_blocks_stats" USING btree ("_parent_id");
  CREATE INDEX "pages_blocks_stats_path_idx" ON "sites_cms"."pages_blocks_stats" USING btree ("_path");
  CREATE INDEX "pages_blocks_pull_quote_order_idx" ON "sites_cms"."pages_blocks_pull_quote" USING btree ("_order");
  CREATE INDEX "pages_blocks_pull_quote_parent_id_idx" ON "sites_cms"."pages_blocks_pull_quote" USING btree ("_parent_id");
  CREATE INDEX "pages_blocks_pull_quote_path_idx" ON "sites_cms"."pages_blocks_pull_quote" USING btree ("_path");
  CREATE INDEX "pages_blocks_map_embed_order_idx" ON "sites_cms"."pages_blocks_map_embed" USING btree ("_order");
  CREATE INDEX "pages_blocks_map_embed_parent_id_idx" ON "sites_cms"."pages_blocks_map_embed" USING btree ("_parent_id");
  CREATE INDEX "pages_blocks_map_embed_path_idx" ON "sites_cms"."pages_blocks_map_embed" USING btree ("_path");
  CREATE INDEX "_pages_v_blocks_marquee_phrases_order_idx" ON "sites_cms"."_pages_v_blocks_marquee_phrases" USING btree ("_order");
  CREATE INDEX "_pages_v_blocks_marquee_phrases_parent_id_idx" ON "sites_cms"."_pages_v_blocks_marquee_phrases" USING btree ("_parent_id");
  CREATE INDEX "_pages_v_blocks_marquee_order_idx" ON "sites_cms"."_pages_v_blocks_marquee" USING btree ("_order");
  CREATE INDEX "_pages_v_blocks_marquee_parent_id_idx" ON "sites_cms"."_pages_v_blocks_marquee" USING btree ("_parent_id");
  CREATE INDEX "_pages_v_blocks_marquee_path_idx" ON "sites_cms"."_pages_v_blocks_marquee" USING btree ("_path");
  CREATE INDEX "_pages_v_blocks_stats_items_order_idx" ON "sites_cms"."_pages_v_blocks_stats_items" USING btree ("_order");
  CREATE INDEX "_pages_v_blocks_stats_items_parent_id_idx" ON "sites_cms"."_pages_v_blocks_stats_items" USING btree ("_parent_id");
  CREATE INDEX "_pages_v_blocks_stats_order_idx" ON "sites_cms"."_pages_v_blocks_stats" USING btree ("_order");
  CREATE INDEX "_pages_v_blocks_stats_parent_id_idx" ON "sites_cms"."_pages_v_blocks_stats" USING btree ("_parent_id");
  CREATE INDEX "_pages_v_blocks_stats_path_idx" ON "sites_cms"."_pages_v_blocks_stats" USING btree ("_path");
  CREATE INDEX "_pages_v_blocks_pull_quote_order_idx" ON "sites_cms"."_pages_v_blocks_pull_quote" USING btree ("_order");
  CREATE INDEX "_pages_v_blocks_pull_quote_parent_id_idx" ON "sites_cms"."_pages_v_blocks_pull_quote" USING btree ("_parent_id");
  CREATE INDEX "_pages_v_blocks_pull_quote_path_idx" ON "sites_cms"."_pages_v_blocks_pull_quote" USING btree ("_path");
  CREATE INDEX "_pages_v_blocks_map_embed_order_idx" ON "sites_cms"."_pages_v_blocks_map_embed" USING btree ("_order");
  CREATE INDEX "_pages_v_blocks_map_embed_parent_id_idx" ON "sites_cms"."_pages_v_blocks_map_embed" USING btree ("_parent_id");
  CREATE INDEX "_pages_v_blocks_map_embed_path_idx" ON "sites_cms"."_pages_v_blocks_map_embed" USING btree ("_path");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`

  ALTER TABLE "sites_cms"."pages_blocks_marquee_phrases" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "sites_cms"."pages_blocks_marquee" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "sites_cms"."pages_blocks_stats_items" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "sites_cms"."pages_blocks_stats" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "sites_cms"."pages_blocks_pull_quote" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "sites_cms"."pages_blocks_map_embed" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "sites_cms"."_pages_v_blocks_marquee_phrases" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "sites_cms"."_pages_v_blocks_marquee" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "sites_cms"."_pages_v_blocks_stats_items" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "sites_cms"."_pages_v_blocks_stats" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "sites_cms"."_pages_v_blocks_pull_quote" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "sites_cms"."_pages_v_blocks_map_embed" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "sites_cms"."pages_blocks_marquee_phrases" CASCADE;
  DROP TABLE "sites_cms"."pages_blocks_marquee" CASCADE;
  DROP TABLE "sites_cms"."pages_blocks_stats_items" CASCADE;
  DROP TABLE "sites_cms"."pages_blocks_stats" CASCADE;
  DROP TABLE "sites_cms"."pages_blocks_pull_quote" CASCADE;
  DROP TABLE "sites_cms"."pages_blocks_map_embed" CASCADE;
  DROP TABLE "sites_cms"."_pages_v_blocks_marquee_phrases" CASCADE;
  DROP TABLE "sites_cms"."_pages_v_blocks_marquee" CASCADE;
  DROP TABLE "sites_cms"."_pages_v_blocks_stats_items" CASCADE;
  DROP TABLE "sites_cms"."_pages_v_blocks_stats" CASCADE;
  DROP TABLE "sites_cms"."_pages_v_blocks_pull_quote" CASCADE;
  DROP TABLE "sites_cms"."_pages_v_blocks_map_embed" CASCADE;`)
}
