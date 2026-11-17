import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/*
 * #4453 milestone 5 (live booking blocks) — Studio's half:
 * - three new block tables, live AND versioned (`_pages_v`): `availability`
 *   (which venue, room or offering, party size and days; the slots are read
 *   from Mingla at render), `ticket_tiers` (which event; the tiers are read
 *   from Mingla) and `process_steps` (the owner's 3-5 steps, with its
 *   `items` array table); each with its layout enum and the Draft `review`;
 * - the hero's booking bar (`booking_bar` enum, `booking_target_id`) and
 *   `show_rating`; the testimonials' `show_rating`;
 * - the navigation's sticky phone booking bar (`sticky_booking`,
 *   `sticky_title`, `sticky_note`), live and versioned.
 * Hand-written to Payload 3.92's own naming (a test pins every block field
 * and layout to these tables and enums).
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  CREATE TYPE "sites_cms"."enum_pages_blocks_availability_source" AS ENUM('venue_slots', 'stay_nights', 'experience_slots', 'event_dates', 'trip_departures');
  CREATE TYPE "sites_cms"."enum_pages_blocks_availability_variant" AS ENUM('strip');
  CREATE TYPE "sites_cms"."enum_pages_blocks_ticket_tiers_variant" AS ENUM('split');
  CREATE TYPE "sites_cms"."enum_pages_blocks_process_steps_variant" AS ENUM('band');
  CREATE TYPE "sites_cms"."enum_pages_blocks_hero_booking_bar" AS ENUM('none', 'venue_table', 'stay', 'experience', 'trip_search');
  CREATE TYPE "sites_cms"."enum__pages_v_blocks_availability_source" AS ENUM('venue_slots', 'stay_nights', 'experience_slots', 'event_dates', 'trip_departures');
  CREATE TYPE "sites_cms"."enum__pages_v_blocks_availability_variant" AS ENUM('strip');
  CREATE TYPE "sites_cms"."enum__pages_v_blocks_ticket_tiers_variant" AS ENUM('split');
  CREATE TYPE "sites_cms"."enum__pages_v_blocks_process_steps_variant" AS ENUM('band');
  CREATE TYPE "sites_cms"."enum__pages_v_blocks_hero_booking_bar" AS ENUM('none', 'venue_table', 'stay', 'experience', 'trip_search');
  CREATE TABLE "sites_cms"."pages_blocks_availability" (
	"_order" integer NOT NULL,
	"_parent_id" uuid NOT NULL,
	"_path" text NOT NULL,
	"id" varchar PRIMARY KEY NOT NULL,
	"eyebrow" varchar,
	"heading" varchar,
	"intro" varchar,
	"source" "sites_cms"."enum_pages_blocks_availability_source" DEFAULT 'venue_slots',
	"offering_id" varchar,
	"stay_offering_id" varchar,
	"party_size" numeric,
	"days" numeric,
	"variant" "sites_cms"."enum_pages_blocks_availability_variant" DEFAULT 'strip',
	"review" jsonb,
	"block_name" varchar
  );
  CREATE TABLE "sites_cms"."_pages_v_blocks_availability" (
	"_order" integer NOT NULL,
	"_parent_id" uuid NOT NULL,
	"_path" text NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"eyebrow" varchar,
	"heading" varchar,
	"intro" varchar,
	"source" "sites_cms"."enum__pages_v_blocks_availability_source" DEFAULT 'venue_slots',
	"offering_id" varchar,
	"stay_offering_id" varchar,
	"party_size" numeric,
	"days" numeric,
	"variant" "sites_cms"."enum__pages_v_blocks_availability_variant" DEFAULT 'strip',
	"review" jsonb,
	"_uuid" varchar,
	"block_name" varchar
  );
  CREATE TABLE "sites_cms"."pages_blocks_ticket_tiers" (
	"_order" integer NOT NULL,
	"_parent_id" uuid NOT NULL,
	"_path" text NOT NULL,
	"id" varchar PRIMARY KEY NOT NULL,
	"eyebrow" varchar,
	"heading" varchar,
	"intro" varchar,
	"offering_id" varchar,
	"media_id" uuid,
	"variant" "sites_cms"."enum_pages_blocks_ticket_tiers_variant" DEFAULT 'split',
	"review" jsonb,
	"block_name" varchar
  );
  CREATE TABLE "sites_cms"."_pages_v_blocks_ticket_tiers" (
	"_order" integer NOT NULL,
	"_parent_id" uuid NOT NULL,
	"_path" text NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"eyebrow" varchar,
	"heading" varchar,
	"intro" varchar,
	"offering_id" varchar,
	"media_id" uuid,
	"variant" "sites_cms"."enum__pages_v_blocks_ticket_tiers_variant" DEFAULT 'split',
	"review" jsonb,
	"_uuid" varchar,
	"block_name" varchar
  );
  CREATE TABLE "sites_cms"."pages_blocks_process_steps" (
	"_order" integer NOT NULL,
	"_parent_id" uuid NOT NULL,
	"_path" text NOT NULL,
	"id" varchar PRIMARY KEY NOT NULL,
	"eyebrow" varchar,
	"heading" varchar,
	"intro" varchar,
	"variant" "sites_cms"."enum_pages_blocks_process_steps_variant" DEFAULT 'band',
	"review" jsonb,
	"block_name" varchar
  );
  CREATE TABLE "sites_cms"."_pages_v_blocks_process_steps" (
	"_order" integer NOT NULL,
	"_parent_id" uuid NOT NULL,
	"_path" text NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"eyebrow" varchar,
	"heading" varchar,
	"intro" varchar,
	"variant" "sites_cms"."enum__pages_v_blocks_process_steps_variant" DEFAULT 'band',
	"review" jsonb,
	"_uuid" varchar,
	"block_name" varchar
  );
  CREATE TABLE "sites_cms"."pages_blocks_process_steps_items" (
	"_order" integer NOT NULL,
	"_parent_id" varchar NOT NULL,
	"id" varchar PRIMARY KEY NOT NULL,
	"title" varchar,
	"text" varchar,
	"time" varchar
  );
  CREATE TABLE "sites_cms"."_pages_v_blocks_process_steps_items" (
	"_order" integer NOT NULL,
	"_parent_id" uuid NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" varchar,
	"text" varchar,
	"time" varchar,
	"_uuid" varchar
  );

  ALTER TABLE "sites_cms"."pages_blocks_hero" ADD COLUMN IF NOT EXISTS "booking_bar" "sites_cms"."enum_pages_blocks_hero_booking_bar";
  ALTER TABLE "sites_cms"."pages_blocks_hero" ADD COLUMN IF NOT EXISTS "booking_target_id" varchar;
  ALTER TABLE "sites_cms"."pages_blocks_hero" ADD COLUMN IF NOT EXISTS "show_rating" boolean DEFAULT false;
  ALTER TABLE "sites_cms"."pages_blocks_testimonials" ADD COLUMN IF NOT EXISTS "show_rating" boolean DEFAULT false;
  ALTER TABLE "sites_cms"."_pages_v_blocks_hero" ADD COLUMN IF NOT EXISTS "booking_bar" "sites_cms"."enum__pages_v_blocks_hero_booking_bar";
  ALTER TABLE "sites_cms"."_pages_v_blocks_hero" ADD COLUMN IF NOT EXISTS "booking_target_id" varchar;
  ALTER TABLE "sites_cms"."_pages_v_blocks_hero" ADD COLUMN IF NOT EXISTS "show_rating" boolean DEFAULT false;
  ALTER TABLE "sites_cms"."_pages_v_blocks_testimonials" ADD COLUMN IF NOT EXISTS "show_rating" boolean DEFAULT false;
  ALTER TABLE "sites_cms"."navigation" ADD COLUMN IF NOT EXISTS "sticky_booking" boolean DEFAULT false;
  ALTER TABLE "sites_cms"."navigation" ADD COLUMN IF NOT EXISTS "sticky_title" varchar;
  ALTER TABLE "sites_cms"."navigation" ADD COLUMN IF NOT EXISTS "sticky_note" varchar;
  ALTER TABLE "sites_cms"."_navigation_v" ADD COLUMN IF NOT EXISTS "version_sticky_booking" boolean DEFAULT false;
  ALTER TABLE "sites_cms"."_navigation_v" ADD COLUMN IF NOT EXISTS "version_sticky_title" varchar;
  ALTER TABLE "sites_cms"."_navigation_v" ADD COLUMN IF NOT EXISTS "version_sticky_note" varchar;

  ALTER TABLE "sites_cms"."pages_blocks_availability" ADD CONSTRAINT "pages_blocks_availability_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."pages"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "pages_blocks_availability_order_idx" ON "sites_cms"."pages_blocks_availability" USING btree ("_order");
  CREATE INDEX "pages_blocks_availability_parent_id_idx" ON "sites_cms"."pages_blocks_availability" USING btree ("_parent_id");
  CREATE INDEX "pages_blocks_availability_path_idx" ON "sites_cms"."pages_blocks_availability" USING btree ("_path");
  ALTER TABLE "sites_cms"."_pages_v_blocks_availability" ADD CONSTRAINT "_pages_v_blocks_availability_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."_pages_v"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "_pages_v_blocks_availability_order_idx" ON "sites_cms"."_pages_v_blocks_availability" USING btree ("_order");
  CREATE INDEX "_pages_v_blocks_availability_parent_id_idx" ON "sites_cms"."_pages_v_blocks_availability" USING btree ("_parent_id");
  CREATE INDEX "_pages_v_blocks_availability_path_idx" ON "sites_cms"."_pages_v_blocks_availability" USING btree ("_path");
  ALTER TABLE "sites_cms"."pages_blocks_ticket_tiers" ADD CONSTRAINT "pages_blocks_ticket_tiers_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."pages"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."pages_blocks_ticket_tiers" ADD CONSTRAINT "pages_blocks_ticket_tiers_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "sites_cms"."media"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "pages_blocks_ticket_tiers_media_idx" ON "sites_cms"."pages_blocks_ticket_tiers" USING btree ("media_id");
  CREATE INDEX "pages_blocks_ticket_tiers_order_idx" ON "sites_cms"."pages_blocks_ticket_tiers" USING btree ("_order");
  CREATE INDEX "pages_blocks_ticket_tiers_parent_id_idx" ON "sites_cms"."pages_blocks_ticket_tiers" USING btree ("_parent_id");
  CREATE INDEX "pages_blocks_ticket_tiers_path_idx" ON "sites_cms"."pages_blocks_ticket_tiers" USING btree ("_path");
  ALTER TABLE "sites_cms"."_pages_v_blocks_ticket_tiers" ADD CONSTRAINT "_pages_v_blocks_ticket_tiers_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."_pages_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."_pages_v_blocks_ticket_tiers" ADD CONSTRAINT "_pages_v_blocks_ticket_tiers_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "sites_cms"."media"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "_pages_v_blocks_ticket_tiers_media_idx" ON "sites_cms"."_pages_v_blocks_ticket_tiers" USING btree ("media_id");
  CREATE INDEX "_pages_v_blocks_ticket_tiers_order_idx" ON "sites_cms"."_pages_v_blocks_ticket_tiers" USING btree ("_order");
  CREATE INDEX "_pages_v_blocks_ticket_tiers_parent_id_idx" ON "sites_cms"."_pages_v_blocks_ticket_tiers" USING btree ("_parent_id");
  CREATE INDEX "_pages_v_blocks_ticket_tiers_path_idx" ON "sites_cms"."_pages_v_blocks_ticket_tiers" USING btree ("_path");
  ALTER TABLE "sites_cms"."pages_blocks_process_steps" ADD CONSTRAINT "pages_blocks_process_steps_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."pages"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "pages_blocks_process_steps_order_idx" ON "sites_cms"."pages_blocks_process_steps" USING btree ("_order");
  CREATE INDEX "pages_blocks_process_steps_parent_id_idx" ON "sites_cms"."pages_blocks_process_steps" USING btree ("_parent_id");
  CREATE INDEX "pages_blocks_process_steps_path_idx" ON "sites_cms"."pages_blocks_process_steps" USING btree ("_path");
  ALTER TABLE "sites_cms"."_pages_v_blocks_process_steps" ADD CONSTRAINT "_pages_v_blocks_process_steps_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."_pages_v"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "_pages_v_blocks_process_steps_order_idx" ON "sites_cms"."_pages_v_blocks_process_steps" USING btree ("_order");
  CREATE INDEX "_pages_v_blocks_process_steps_parent_id_idx" ON "sites_cms"."_pages_v_blocks_process_steps" USING btree ("_parent_id");
  CREATE INDEX "_pages_v_blocks_process_steps_path_idx" ON "sites_cms"."_pages_v_blocks_process_steps" USING btree ("_path");
  ALTER TABLE "sites_cms"."pages_blocks_process_steps_items" ADD CONSTRAINT "pages_blocks_process_steps_items_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."pages_blocks_process_steps"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "pages_blocks_process_steps_items_order_idx" ON "sites_cms"."pages_blocks_process_steps_items" USING btree ("_order");
  CREATE INDEX "pages_blocks_process_steps_items_parent_id_idx" ON "sites_cms"."pages_blocks_process_steps_items" USING btree ("_parent_id");
  ALTER TABLE "sites_cms"."_pages_v_blocks_process_steps_items" ADD CONSTRAINT "_pages_v_blocks_process_steps_items_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."_pages_v_blocks_process_steps"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "_pages_v_blocks_process_steps_items_order_idx" ON "sites_cms"."_pages_v_blocks_process_steps_items" USING btree ("_order");
  CREATE INDEX "_pages_v_blocks_process_steps_items_parent_id_idx" ON "sites_cms"."_pages_v_blocks_process_steps_items" USING btree ("_parent_id");
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
  DROP TABLE IF EXISTS "sites_cms"."_pages_v_blocks_process_steps_items" CASCADE;
  DROP TABLE IF EXISTS "sites_cms"."pages_blocks_process_steps_items" CASCADE;
  DROP TABLE IF EXISTS "sites_cms"."_pages_v_blocks_process_steps" CASCADE;
  DROP TABLE IF EXISTS "sites_cms"."pages_blocks_process_steps" CASCADE;
  DROP TABLE IF EXISTS "sites_cms"."_pages_v_blocks_ticket_tiers" CASCADE;
  DROP TABLE IF EXISTS "sites_cms"."pages_blocks_ticket_tiers" CASCADE;
  DROP TABLE IF EXISTS "sites_cms"."_pages_v_blocks_availability" CASCADE;
  DROP TABLE IF EXISTS "sites_cms"."pages_blocks_availability" CASCADE;
  ALTER TABLE "sites_cms"."pages_blocks_hero" DROP COLUMN IF EXISTS "booking_bar";
  ALTER TABLE "sites_cms"."pages_blocks_hero" DROP COLUMN IF EXISTS "booking_target_id";
  ALTER TABLE "sites_cms"."pages_blocks_hero" DROP COLUMN IF EXISTS "show_rating";
  ALTER TABLE "sites_cms"."pages_blocks_testimonials" DROP COLUMN IF EXISTS "show_rating";
  ALTER TABLE "sites_cms"."_pages_v_blocks_hero" DROP COLUMN IF EXISTS "booking_bar";
  ALTER TABLE "sites_cms"."_pages_v_blocks_hero" DROP COLUMN IF EXISTS "booking_target_id";
  ALTER TABLE "sites_cms"."_pages_v_blocks_hero" DROP COLUMN IF EXISTS "show_rating";
  ALTER TABLE "sites_cms"."_pages_v_blocks_testimonials" DROP COLUMN IF EXISTS "show_rating";
  ALTER TABLE "sites_cms"."navigation" DROP COLUMN IF EXISTS "sticky_booking";
  ALTER TABLE "sites_cms"."_navigation_v" DROP COLUMN IF EXISTS "version_sticky_booking";
  ALTER TABLE "sites_cms"."navigation" DROP COLUMN IF EXISTS "sticky_title";
  ALTER TABLE "sites_cms"."_navigation_v" DROP COLUMN IF EXISTS "version_sticky_title";
  ALTER TABLE "sites_cms"."navigation" DROP COLUMN IF EXISTS "sticky_note";
  ALTER TABLE "sites_cms"."_navigation_v" DROP COLUMN IF EXISTS "version_sticky_note";
  DROP TYPE IF EXISTS "sites_cms"."enum_pages_blocks_availability_source";
  DROP TYPE IF EXISTS "sites_cms"."enum_pages_blocks_availability_variant";
  DROP TYPE IF EXISTS "sites_cms"."enum_pages_blocks_ticket_tiers_variant";
  DROP TYPE IF EXISTS "sites_cms"."enum_pages_blocks_process_steps_variant";
  DROP TYPE IF EXISTS "sites_cms"."enum_pages_blocks_hero_booking_bar";
  DROP TYPE IF EXISTS "sites_cms"."enum__pages_v_blocks_availability_source";
  DROP TYPE IF EXISTS "sites_cms"."enum__pages_v_blocks_availability_variant";
  DROP TYPE IF EXISTS "sites_cms"."enum__pages_v_blocks_ticket_tiers_variant";
  DROP TYPE IF EXISTS "sites_cms"."enum__pages_v_blocks_process_steps_variant";
  DROP TYPE IF EXISTS "sites_cms"."enum__pages_v_blocks_hero_booking_bar";
  `)
}
