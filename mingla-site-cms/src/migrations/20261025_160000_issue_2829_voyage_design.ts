import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "sites_cms"."enum_pages_blocks_rich_text_width" AS ENUM('narrow', 'full');
  CREATE TYPE "sites_cms"."enum_pages_blocks_page_header_variant" AS ENUM('neutral', 'cover-center');
  CREATE TYPE "sites_cms"."enum_pages_blocks_feature_cards_cards_icon" AS ENUM('travel_explore', 'festival', 'diversity_1', 'event_available');
  CREATE TYPE "sites_cms"."enum_pages_blocks_feature_cards_variant" AS ENUM('neutral', 'tile-bar', 'statement');
  CREATE TYPE "sites_cms"."enum_pages_blocks_contact_details_variant" AS ENUM('neutral', 'tiles');
  CREATE TYPE "sites_cms"."enum__pages_v_blocks_rich_text_width" AS ENUM('narrow', 'full');
  CREATE TYPE "sites_cms"."enum__pages_v_blocks_page_header_variant" AS ENUM('neutral', 'cover-center');
  CREATE TYPE "sites_cms"."enum__pages_v_blocks_feature_cards_cards_icon" AS ENUM('travel_explore', 'festival', 'diversity_1', 'event_available');
  CREATE TYPE "sites_cms"."enum__pages_v_blocks_feature_cards_variant" AS ENUM('neutral', 'tile-bar', 'statement');
  CREATE TYPE "sites_cms"."enum__pages_v_blocks_contact_details_variant" AS ENUM('neutral', 'tiles');
  ALTER TYPE "sites_cms"."enum_pages_blocks_hero_variant" ADD VALUE 'cover-bottom-search';
  ALTER TYPE "sites_cms"."enum_pages_blocks_rich_text_variant" ADD VALUE 'prose';
  ALTER TYPE "sites_cms"."enum_pages_blocks_media_feature_variant" ADD VALUE 'split-panel';
  ALTER TYPE "sites_cms"."enum_pages_blocks_media_feature_variant" ADD VALUE 'panel-caption';
  ALTER TYPE "sites_cms"."enum_pages_blocks_cta_variant" ADD VALUE 'dark-panel-glow';
  ALTER TYPE "sites_cms"."enum_pages_blocks_offering_grid_variant" ADD VALUE 'photo-card';
  ALTER TYPE "sites_cms"."enum_pages_blocks_venue_reservation_variant" ADD VALUE 'neutral';
  ALTER TYPE "sites_cms"."enum_pages_blocks_menu_link_variant" ADD VALUE 'neutral';
  ALTER TYPE "sites_cms"."enum_pages_blocks_menu_board_variant" ADD VALUE 'neutral';
  ALTER TYPE "sites_cms"."enum_pages_blocks_menu_preview_variant" ADD VALUE 'neutral';
  ALTER TYPE "sites_cms"."enum_pages_blocks_video_feature_variant" ADD VALUE 'brand-film';
  ALTER TYPE "sites_cms"."enum_pages_blocks_team_variant" ADD VALUE 'voyage';
  ALTER TYPE "sites_cms"."enum_pages_blocks_gallery_variant" ADD VALUE 'voyage';
  ALTER TYPE "sites_cms"."enum_pages_blocks_hours_location_variant" ADD VALUE 'neutral';
  ALTER TYPE "sites_cms"."enum_pages_blocks_testimonials_variant" ADD VALUE 'quote-wall';
  ALTER TYPE "sites_cms"."enum_pages_blocks_faq_variant" ADD VALUE 'accordion-columns';
  ALTER TYPE "sites_cms"."enum_pages_blocks_contact_handoff_variant" ADD VALUE 'neutral';
  ALTER TYPE "sites_cms"."enum_pages_blocks_marquee_variant" ADD VALUE 'neutral';
  ALTER TYPE "sites_cms"."enum_pages_blocks_stats_variant" ADD VALUE 'voyage';
  ALTER TYPE "sites_cms"."enum_pages_blocks_pull_quote_variant" ADD VALUE 'voyage';
  ALTER TYPE "sites_cms"."enum_pages_blocks_map_embed_variant" ADD VALUE 'voyage';
  ALTER TYPE "sites_cms"."enum_pages_blocks_destination_grid_variant" ADD VALUE 'badge-tile';
  ALTER TYPE "sites_cms"."enum_pages_blocks_story_grid_variant" ADD VALUE 'card';
  ALTER TYPE "sites_cms"."enum_pages_blocks_offering_history_variant" ADD VALUE 'ledger';
  ALTER TYPE "sites_cms"."enum_pages_blocks_contact_form_variant" ADD VALUE 'panel';
  ALTER TYPE "sites_cms"."enum_pages_blocks_newsletter_signup_variant" ADD VALUE 'card';
  ALTER TYPE "sites_cms"."enum_pages_blocks_divider_variant" ADD VALUE 'voyage';
  ALTER TYPE "sites_cms"."enum_pages_blocks_spacer_variant" ADD VALUE 'voyage';
  ALTER TYPE "sites_cms"."enum__pages_v_blocks_hero_variant" ADD VALUE 'cover-bottom-search';
  ALTER TYPE "sites_cms"."enum__pages_v_blocks_rich_text_variant" ADD VALUE 'prose';
  ALTER TYPE "sites_cms"."enum__pages_v_blocks_media_feature_variant" ADD VALUE 'split-panel';
  ALTER TYPE "sites_cms"."enum__pages_v_blocks_media_feature_variant" ADD VALUE 'panel-caption';
  ALTER TYPE "sites_cms"."enum__pages_v_blocks_cta_variant" ADD VALUE 'dark-panel-glow';
  ALTER TYPE "sites_cms"."enum__pages_v_blocks_offering_grid_variant" ADD VALUE 'photo-card';
  ALTER TYPE "sites_cms"."enum__pages_v_blocks_venue_reservation_variant" ADD VALUE 'neutral';
  ALTER TYPE "sites_cms"."enum__pages_v_blocks_menu_link_variant" ADD VALUE 'neutral';
  ALTER TYPE "sites_cms"."enum__pages_v_blocks_menu_board_variant" ADD VALUE 'neutral';
  ALTER TYPE "sites_cms"."enum__pages_v_blocks_menu_preview_variant" ADD VALUE 'neutral';
  ALTER TYPE "sites_cms"."enum__pages_v_blocks_video_feature_variant" ADD VALUE 'brand-film';
  ALTER TYPE "sites_cms"."enum__pages_v_blocks_team_variant" ADD VALUE 'voyage';
  ALTER TYPE "sites_cms"."enum__pages_v_blocks_gallery_variant" ADD VALUE 'voyage';
  ALTER TYPE "sites_cms"."enum__pages_v_blocks_hours_location_variant" ADD VALUE 'neutral';
  ALTER TYPE "sites_cms"."enum__pages_v_blocks_testimonials_variant" ADD VALUE 'quote-wall';
  ALTER TYPE "sites_cms"."enum__pages_v_blocks_faq_variant" ADD VALUE 'accordion-columns';
  ALTER TYPE "sites_cms"."enum__pages_v_blocks_contact_handoff_variant" ADD VALUE 'neutral';
  ALTER TYPE "sites_cms"."enum__pages_v_blocks_marquee_variant" ADD VALUE 'neutral';
  ALTER TYPE "sites_cms"."enum__pages_v_blocks_stats_variant" ADD VALUE 'voyage';
  ALTER TYPE "sites_cms"."enum__pages_v_blocks_pull_quote_variant" ADD VALUE 'voyage';
  ALTER TYPE "sites_cms"."enum__pages_v_blocks_map_embed_variant" ADD VALUE 'voyage';
  ALTER TYPE "sites_cms"."enum__pages_v_blocks_destination_grid_variant" ADD VALUE 'badge-tile';
  ALTER TYPE "sites_cms"."enum__pages_v_blocks_story_grid_variant" ADD VALUE 'card';
  ALTER TYPE "sites_cms"."enum__pages_v_blocks_offering_history_variant" ADD VALUE 'ledger';
  ALTER TYPE "sites_cms"."enum__pages_v_blocks_contact_form_variant" ADD VALUE 'panel';
  ALTER TYPE "sites_cms"."enum__pages_v_blocks_newsletter_signup_variant" ADD VALUE 'card';
  ALTER TYPE "sites_cms"."enum__pages_v_blocks_divider_variant" ADD VALUE 'voyage';
  ALTER TYPE "sites_cms"."enum__pages_v_blocks_spacer_variant" ADD VALUE 'voyage';
  ALTER TYPE "sites_cms"."enum_site_settings_design" ADD VALUE 'voyage';
  ALTER TYPE "sites_cms"."enum__site_settings_v_version_design" ADD VALUE 'voyage';
  CREATE TABLE "sites_cms"."pages_blocks_hero_heading_lines" (
  	"_order" integer NOT NULL,
  	"_parent_id" varchar NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"text" varchar
  );
  
  CREATE TABLE "sites_cms"."history_links" (
  	"_order" integer NOT NULL,
  	"_parent_id" varchar NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"offering_id" varchar
  );
  
  CREATE TABLE "sites_cms"."pages_blocks_page_header" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"_path" text NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"heading" varchar,
  	"subheading" varchar,
  	"media_id" uuid,
  	"variant" "sites_cms"."enum_pages_blocks_page_header_variant" DEFAULT 'neutral',
  	"block_name" varchar
  );
  
  CREATE TABLE "sites_cms"."pages_blocks_feature_cards_cards" (
  	"_order" integer NOT NULL,
  	"_parent_id" varchar NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"title" varchar,
  	"body" varchar,
  	"icon" "sites_cms"."enum_pages_blocks_feature_cards_cards_icon"
  );
  
  CREATE TABLE "sites_cms"."pages_blocks_feature_cards" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"_path" text NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"heading" varchar,
  	"intro" varchar,
  	"variant" "sites_cms"."enum_pages_blocks_feature_cards_variant" DEFAULT 'neutral',
  	"block_name" varchar
  );
  
  CREATE TABLE "sites_cms"."pages_blocks_contact_details" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"_path" text NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"heading" varchar,
  	"body" varchar,
  	"email" varchar,
  	"location" varchar,
  	"variant" "sites_cms"."enum_pages_blocks_contact_details_variant" DEFAULT 'neutral',
  	"block_name" varchar
  );
  
  CREATE TABLE "sites_cms"."_pages_v_blocks_hero_heading_lines" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"text" varchar,
  	"_uuid" varchar
  );
  
  CREATE TABLE "sites_cms"."_history_links_v" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"offering_id" varchar,
  	"_uuid" varchar
  );
  
  CREATE TABLE "sites_cms"."_pages_v_blocks_page_header" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"_path" text NOT NULL,
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"heading" varchar,
  	"subheading" varchar,
  	"media_id" uuid,
  	"variant" "sites_cms"."enum__pages_v_blocks_page_header_variant" DEFAULT 'neutral',
  	"_uuid" varchar,
  	"block_name" varchar
  );
  
  CREATE TABLE "sites_cms"."_pages_v_blocks_feature_cards_cards" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"title" varchar,
  	"body" varchar,
  	"icon" "sites_cms"."enum__pages_v_blocks_feature_cards_cards_icon",
  	"_uuid" varchar
  );
  
  CREATE TABLE "sites_cms"."_pages_v_blocks_feature_cards" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"_path" text NOT NULL,
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"heading" varchar,
  	"intro" varchar,
  	"variant" "sites_cms"."enum__pages_v_blocks_feature_cards_variant" DEFAULT 'neutral',
  	"_uuid" varchar,
  	"block_name" varchar
  );
  
  CREATE TABLE "sites_cms"."_pages_v_blocks_contact_details" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"_path" text NOT NULL,
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"heading" varchar,
  	"body" varchar,
  	"email" varchar,
  	"location" varchar,
  	"variant" "sites_cms"."enum__pages_v_blocks_contact_details_variant" DEFAULT 'neutral',
  	"_uuid" varchar,
  	"block_name" varchar
  );
  
  ALTER TABLE "sites_cms"."pages_blocks_hero" ADD COLUMN "eyebrow" varchar;
  ALTER TABLE "sites_cms"."pages_blocks_hero" ADD COLUMN "show_search" boolean DEFAULT false;
  ALTER TABLE "sites_cms"."pages_blocks_rich_text" ADD COLUMN "width" "sites_cms"."enum_pages_blocks_rich_text_width";
  ALTER TABLE "sites_cms"."pages_blocks_offering_grid" ADD COLUMN "intro" varchar;
  ALTER TABLE "sites_cms"."pages_blocks_offering_grid" ADD COLUMN "cta_label" varchar;
  ALTER TABLE "sites_cms"."pages_blocks_offering_grid" ADD COLUMN "cta_href" varchar;
  ALTER TABLE "sites_cms"."pages_blocks_offering_grid" ADD COLUMN "empty_cta_label" varchar;
  ALTER TABLE "sites_cms"."pages_blocks_offering_grid" ADD COLUMN "empty_cta_href" varchar;
  ALTER TABLE "sites_cms"."_pages_v_blocks_hero" ADD COLUMN "eyebrow" varchar;
  ALTER TABLE "sites_cms"."_pages_v_blocks_hero" ADD COLUMN "show_search" boolean DEFAULT false;
  ALTER TABLE "sites_cms"."_pages_v_blocks_rich_text" ADD COLUMN "width" "sites_cms"."enum__pages_v_blocks_rich_text_width";
  ALTER TABLE "sites_cms"."_pages_v_blocks_offering_grid" ADD COLUMN "intro" varchar;
  ALTER TABLE "sites_cms"."_pages_v_blocks_offering_grid" ADD COLUMN "cta_label" varchar;
  ALTER TABLE "sites_cms"."_pages_v_blocks_offering_grid" ADD COLUMN "cta_href" varchar;
  ALTER TABLE "sites_cms"."_pages_v_blocks_offering_grid" ADD COLUMN "empty_cta_label" varchar;
  ALTER TABLE "sites_cms"."_pages_v_blocks_offering_grid" ADD COLUMN "empty_cta_href" varchar;
  ALTER TABLE "sites_cms"."pages_blocks_hero_heading_lines" ADD CONSTRAINT "pages_blocks_hero_heading_lines_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."pages_blocks_hero"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."history_links" ADD CONSTRAINT "history_links_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."pages_blocks_offering_history"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."pages_blocks_page_header" ADD CONSTRAINT "pages_blocks_page_header_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "sites_cms"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "sites_cms"."pages_blocks_page_header" ADD CONSTRAINT "pages_blocks_page_header_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."pages"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."pages_blocks_feature_cards_cards" ADD CONSTRAINT "pages_blocks_feature_cards_cards_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."pages_blocks_feature_cards"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."pages_blocks_feature_cards" ADD CONSTRAINT "pages_blocks_feature_cards_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."pages"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."pages_blocks_contact_details" ADD CONSTRAINT "pages_blocks_contact_details_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."pages"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."_pages_v_blocks_hero_heading_lines" ADD CONSTRAINT "_pages_v_blocks_hero_heading_lines_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."_pages_v_blocks_hero"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."_history_links_v" ADD CONSTRAINT "_history_links_v_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."_pages_v_blocks_offering_history"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."_pages_v_blocks_page_header" ADD CONSTRAINT "_pages_v_blocks_page_header_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "sites_cms"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "sites_cms"."_pages_v_blocks_page_header" ADD CONSTRAINT "_pages_v_blocks_page_header_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."_pages_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."_pages_v_blocks_feature_cards_cards" ADD CONSTRAINT "_pages_v_blocks_feature_cards_cards_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."_pages_v_blocks_feature_cards"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."_pages_v_blocks_feature_cards" ADD CONSTRAINT "_pages_v_blocks_feature_cards_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."_pages_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."_pages_v_blocks_contact_details" ADD CONSTRAINT "_pages_v_blocks_contact_details_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."_pages_v"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "pages_blocks_hero_heading_lines_order_idx" ON "sites_cms"."pages_blocks_hero_heading_lines" USING btree ("_order");
  CREATE INDEX "pages_blocks_hero_heading_lines_parent_id_idx" ON "sites_cms"."pages_blocks_hero_heading_lines" USING btree ("_parent_id");
  CREATE INDEX "history_links_order_idx" ON "sites_cms"."history_links" USING btree ("_order");
  CREATE INDEX "history_links_parent_id_idx" ON "sites_cms"."history_links" USING btree ("_parent_id");
  CREATE INDEX "pages_blocks_page_header_order_idx" ON "sites_cms"."pages_blocks_page_header" USING btree ("_order");
  CREATE INDEX "pages_blocks_page_header_parent_id_idx" ON "sites_cms"."pages_blocks_page_header" USING btree ("_parent_id");
  CREATE INDEX "pages_blocks_page_header_path_idx" ON "sites_cms"."pages_blocks_page_header" USING btree ("_path");
  CREATE INDEX "pages_blocks_page_header_media_idx" ON "sites_cms"."pages_blocks_page_header" USING btree ("media_id");
  CREATE INDEX "pages_blocks_feature_cards_cards_order_idx" ON "sites_cms"."pages_blocks_feature_cards_cards" USING btree ("_order");
  CREATE INDEX "pages_blocks_feature_cards_cards_parent_id_idx" ON "sites_cms"."pages_blocks_feature_cards_cards" USING btree ("_parent_id");
  CREATE INDEX "pages_blocks_feature_cards_order_idx" ON "sites_cms"."pages_blocks_feature_cards" USING btree ("_order");
  CREATE INDEX "pages_blocks_feature_cards_parent_id_idx" ON "sites_cms"."pages_blocks_feature_cards" USING btree ("_parent_id");
  CREATE INDEX "pages_blocks_feature_cards_path_idx" ON "sites_cms"."pages_blocks_feature_cards" USING btree ("_path");
  CREATE INDEX "pages_blocks_contact_details_order_idx" ON "sites_cms"."pages_blocks_contact_details" USING btree ("_order");
  CREATE INDEX "pages_blocks_contact_details_parent_id_idx" ON "sites_cms"."pages_blocks_contact_details" USING btree ("_parent_id");
  CREATE INDEX "pages_blocks_contact_details_path_idx" ON "sites_cms"."pages_blocks_contact_details" USING btree ("_path");
  CREATE INDEX "_pages_v_blocks_hero_heading_lines_order_idx" ON "sites_cms"."_pages_v_blocks_hero_heading_lines" USING btree ("_order");
  CREATE INDEX "_pages_v_blocks_hero_heading_lines_parent_id_idx" ON "sites_cms"."_pages_v_blocks_hero_heading_lines" USING btree ("_parent_id");
  CREATE INDEX "_history_links_v_order_idx" ON "sites_cms"."_history_links_v" USING btree ("_order");
  CREATE INDEX "_history_links_v_parent_id_idx" ON "sites_cms"."_history_links_v" USING btree ("_parent_id");
  CREATE INDEX "_pages_v_blocks_page_header_order_idx" ON "sites_cms"."_pages_v_blocks_page_header" USING btree ("_order");
  CREATE INDEX "_pages_v_blocks_page_header_parent_id_idx" ON "sites_cms"."_pages_v_blocks_page_header" USING btree ("_parent_id");
  CREATE INDEX "_pages_v_blocks_page_header_path_idx" ON "sites_cms"."_pages_v_blocks_page_header" USING btree ("_path");
  CREATE INDEX "_pages_v_blocks_page_header_media_idx" ON "sites_cms"."_pages_v_blocks_page_header" USING btree ("media_id");
  CREATE INDEX "_pages_v_blocks_feature_cards_cards_order_idx" ON "sites_cms"."_pages_v_blocks_feature_cards_cards" USING btree ("_order");
  CREATE INDEX "_pages_v_blocks_feature_cards_cards_parent_id_idx" ON "sites_cms"."_pages_v_blocks_feature_cards_cards" USING btree ("_parent_id");
  CREATE INDEX "_pages_v_blocks_feature_cards_order_idx" ON "sites_cms"."_pages_v_blocks_feature_cards" USING btree ("_order");
  CREATE INDEX "_pages_v_blocks_feature_cards_parent_id_idx" ON "sites_cms"."_pages_v_blocks_feature_cards" USING btree ("_parent_id");
  CREATE INDEX "_pages_v_blocks_feature_cards_path_idx" ON "sites_cms"."_pages_v_blocks_feature_cards" USING btree ("_path");
  CREATE INDEX "_pages_v_blocks_contact_details_order_idx" ON "sites_cms"."_pages_v_blocks_contact_details" USING btree ("_order");
  CREATE INDEX "_pages_v_blocks_contact_details_parent_id_idx" ON "sites_cms"."_pages_v_blocks_contact_details" USING btree ("_parent_id");
  CREATE INDEX "_pages_v_blocks_contact_details_path_idx" ON "sites_cms"."_pages_v_blocks_contact_details" USING btree ("_path");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP TABLE "sites_cms"."pages_blocks_hero_heading_lines" CASCADE;
  DROP TABLE "sites_cms"."history_links" CASCADE;
  DROP TABLE "sites_cms"."pages_blocks_page_header" CASCADE;
  DROP TABLE "sites_cms"."pages_blocks_feature_cards_cards" CASCADE;
  DROP TABLE "sites_cms"."pages_blocks_feature_cards" CASCADE;
  DROP TABLE "sites_cms"."pages_blocks_contact_details" CASCADE;
  DROP TABLE "sites_cms"."_pages_v_blocks_hero_heading_lines" CASCADE;
  DROP TABLE "sites_cms"."_history_links_v" CASCADE;
  DROP TABLE "sites_cms"."_pages_v_blocks_page_header" CASCADE;
  DROP TABLE "sites_cms"."_pages_v_blocks_feature_cards_cards" CASCADE;
  DROP TABLE "sites_cms"."_pages_v_blocks_feature_cards" CASCADE;
  DROP TABLE "sites_cms"."_pages_v_blocks_contact_details" CASCADE;
  ALTER TABLE "sites_cms"."pages_blocks_hero" ALTER COLUMN "variant" SET DATA TYPE text;
  ALTER TABLE "sites_cms"."pages_blocks_hero" ALTER COLUMN "variant" SET DEFAULT 'atelier'::text;
  DROP TYPE "sites_cms"."enum_pages_blocks_hero_variant";
  CREATE TYPE "sites_cms"."enum_pages_blocks_hero_variant" AS ENUM('atelier');
  ALTER TABLE "sites_cms"."pages_blocks_hero" ALTER COLUMN "variant" SET DEFAULT 'atelier'::"sites_cms"."enum_pages_blocks_hero_variant";
  ALTER TABLE "sites_cms"."pages_blocks_hero" ALTER COLUMN "variant" SET DATA TYPE "sites_cms"."enum_pages_blocks_hero_variant" USING "variant"::"sites_cms"."enum_pages_blocks_hero_variant";
  ALTER TABLE "sites_cms"."pages_blocks_rich_text" ALTER COLUMN "variant" SET DATA TYPE text;
  ALTER TABLE "sites_cms"."pages_blocks_rich_text" ALTER COLUMN "variant" SET DEFAULT 'atelier'::text;
  DROP TYPE "sites_cms"."enum_pages_blocks_rich_text_variant";
  CREATE TYPE "sites_cms"."enum_pages_blocks_rich_text_variant" AS ENUM('atelier');
  ALTER TABLE "sites_cms"."pages_blocks_rich_text" ALTER COLUMN "variant" SET DEFAULT 'atelier'::"sites_cms"."enum_pages_blocks_rich_text_variant";
  ALTER TABLE "sites_cms"."pages_blocks_rich_text" ALTER COLUMN "variant" SET DATA TYPE "sites_cms"."enum_pages_blocks_rich_text_variant" USING "variant"::"sites_cms"."enum_pages_blocks_rich_text_variant";
  ALTER TABLE "sites_cms"."pages_blocks_media_feature" ALTER COLUMN "variant" SET DATA TYPE text;
  ALTER TABLE "sites_cms"."pages_blocks_media_feature" ALTER COLUMN "variant" SET DEFAULT 'atelier'::text;
  DROP TYPE "sites_cms"."enum_pages_blocks_media_feature_variant";
  CREATE TYPE "sites_cms"."enum_pages_blocks_media_feature_variant" AS ENUM('atelier');
  ALTER TABLE "sites_cms"."pages_blocks_media_feature" ALTER COLUMN "variant" SET DEFAULT 'atelier'::"sites_cms"."enum_pages_blocks_media_feature_variant";
  ALTER TABLE "sites_cms"."pages_blocks_media_feature" ALTER COLUMN "variant" SET DATA TYPE "sites_cms"."enum_pages_blocks_media_feature_variant" USING "variant"::"sites_cms"."enum_pages_blocks_media_feature_variant";
  ALTER TABLE "sites_cms"."pages_blocks_cta" ALTER COLUMN "variant" SET DATA TYPE text;
  ALTER TABLE "sites_cms"."pages_blocks_cta" ALTER COLUMN "variant" SET DEFAULT 'atelier'::text;
  DROP TYPE "sites_cms"."enum_pages_blocks_cta_variant";
  CREATE TYPE "sites_cms"."enum_pages_blocks_cta_variant" AS ENUM('atelier');
  ALTER TABLE "sites_cms"."pages_blocks_cta" ALTER COLUMN "variant" SET DEFAULT 'atelier'::"sites_cms"."enum_pages_blocks_cta_variant";
  ALTER TABLE "sites_cms"."pages_blocks_cta" ALTER COLUMN "variant" SET DATA TYPE "sites_cms"."enum_pages_blocks_cta_variant" USING "variant"::"sites_cms"."enum_pages_blocks_cta_variant";
  ALTER TABLE "sites_cms"."pages_blocks_offering_grid" ALTER COLUMN "variant" SET DATA TYPE text;
  ALTER TABLE "sites_cms"."pages_blocks_offering_grid" ALTER COLUMN "variant" SET DEFAULT 'atelier'::text;
  DROP TYPE "sites_cms"."enum_pages_blocks_offering_grid_variant";
  CREATE TYPE "sites_cms"."enum_pages_blocks_offering_grid_variant" AS ENUM('atelier');
  ALTER TABLE "sites_cms"."pages_blocks_offering_grid" ALTER COLUMN "variant" SET DEFAULT 'atelier'::"sites_cms"."enum_pages_blocks_offering_grid_variant";
  ALTER TABLE "sites_cms"."pages_blocks_offering_grid" ALTER COLUMN "variant" SET DATA TYPE "sites_cms"."enum_pages_blocks_offering_grid_variant" USING "variant"::"sites_cms"."enum_pages_blocks_offering_grid_variant";
  ALTER TABLE "sites_cms"."pages_blocks_venue_reservation" ALTER COLUMN "variant" SET DATA TYPE text;
  ALTER TABLE "sites_cms"."pages_blocks_venue_reservation" ALTER COLUMN "variant" SET DEFAULT 'atelier'::text;
  DROP TYPE "sites_cms"."enum_pages_blocks_venue_reservation_variant";
  CREATE TYPE "sites_cms"."enum_pages_blocks_venue_reservation_variant" AS ENUM('atelier');
  ALTER TABLE "sites_cms"."pages_blocks_venue_reservation" ALTER COLUMN "variant" SET DEFAULT 'atelier'::"sites_cms"."enum_pages_blocks_venue_reservation_variant";
  ALTER TABLE "sites_cms"."pages_blocks_venue_reservation" ALTER COLUMN "variant" SET DATA TYPE "sites_cms"."enum_pages_blocks_venue_reservation_variant" USING "variant"::"sites_cms"."enum_pages_blocks_venue_reservation_variant";
  ALTER TABLE "sites_cms"."pages_blocks_menu_link" ALTER COLUMN "variant" SET DATA TYPE text;
  ALTER TABLE "sites_cms"."pages_blocks_menu_link" ALTER COLUMN "variant" SET DEFAULT 'atelier'::text;
  DROP TYPE "sites_cms"."enum_pages_blocks_menu_link_variant";
  CREATE TYPE "sites_cms"."enum_pages_blocks_menu_link_variant" AS ENUM('atelier');
  ALTER TABLE "sites_cms"."pages_blocks_menu_link" ALTER COLUMN "variant" SET DEFAULT 'atelier'::"sites_cms"."enum_pages_blocks_menu_link_variant";
  ALTER TABLE "sites_cms"."pages_blocks_menu_link" ALTER COLUMN "variant" SET DATA TYPE "sites_cms"."enum_pages_blocks_menu_link_variant" USING "variant"::"sites_cms"."enum_pages_blocks_menu_link_variant";
  ALTER TABLE "sites_cms"."pages_blocks_menu_board" ALTER COLUMN "variant" SET DATA TYPE text;
  ALTER TABLE "sites_cms"."pages_blocks_menu_board" ALTER COLUMN "variant" SET DEFAULT 'atelier'::text;
  DROP TYPE "sites_cms"."enum_pages_blocks_menu_board_variant";
  CREATE TYPE "sites_cms"."enum_pages_blocks_menu_board_variant" AS ENUM('atelier');
  ALTER TABLE "sites_cms"."pages_blocks_menu_board" ALTER COLUMN "variant" SET DEFAULT 'atelier'::"sites_cms"."enum_pages_blocks_menu_board_variant";
  ALTER TABLE "sites_cms"."pages_blocks_menu_board" ALTER COLUMN "variant" SET DATA TYPE "sites_cms"."enum_pages_blocks_menu_board_variant" USING "variant"::"sites_cms"."enum_pages_blocks_menu_board_variant";
  ALTER TABLE "sites_cms"."pages_blocks_menu_preview" ALTER COLUMN "variant" SET DATA TYPE text;
  ALTER TABLE "sites_cms"."pages_blocks_menu_preview" ALTER COLUMN "variant" SET DEFAULT 'atelier'::text;
  DROP TYPE "sites_cms"."enum_pages_blocks_menu_preview_variant";
  CREATE TYPE "sites_cms"."enum_pages_blocks_menu_preview_variant" AS ENUM('atelier');
  ALTER TABLE "sites_cms"."pages_blocks_menu_preview" ALTER COLUMN "variant" SET DEFAULT 'atelier'::"sites_cms"."enum_pages_blocks_menu_preview_variant";
  ALTER TABLE "sites_cms"."pages_blocks_menu_preview" ALTER COLUMN "variant" SET DATA TYPE "sites_cms"."enum_pages_blocks_menu_preview_variant" USING "variant"::"sites_cms"."enum_pages_blocks_menu_preview_variant";
  ALTER TABLE "sites_cms"."pages_blocks_video_feature" ALTER COLUMN "variant" SET DATA TYPE text;
  ALTER TABLE "sites_cms"."pages_blocks_video_feature" ALTER COLUMN "variant" SET DEFAULT 'atelier'::text;
  DROP TYPE "sites_cms"."enum_pages_blocks_video_feature_variant";
  CREATE TYPE "sites_cms"."enum_pages_blocks_video_feature_variant" AS ENUM('atelier');
  ALTER TABLE "sites_cms"."pages_blocks_video_feature" ALTER COLUMN "variant" SET DEFAULT 'atelier'::"sites_cms"."enum_pages_blocks_video_feature_variant";
  ALTER TABLE "sites_cms"."pages_blocks_video_feature" ALTER COLUMN "variant" SET DATA TYPE "sites_cms"."enum_pages_blocks_video_feature_variant" USING "variant"::"sites_cms"."enum_pages_blocks_video_feature_variant";
  ALTER TABLE "sites_cms"."pages_blocks_team" ALTER COLUMN "variant" SET DATA TYPE text;
  ALTER TABLE "sites_cms"."pages_blocks_team" ALTER COLUMN "variant" SET DEFAULT 'atelier'::text;
  DROP TYPE "sites_cms"."enum_pages_blocks_team_variant";
  CREATE TYPE "sites_cms"."enum_pages_blocks_team_variant" AS ENUM('atelier');
  ALTER TABLE "sites_cms"."pages_blocks_team" ALTER COLUMN "variant" SET DEFAULT 'atelier'::"sites_cms"."enum_pages_blocks_team_variant";
  ALTER TABLE "sites_cms"."pages_blocks_team" ALTER COLUMN "variant" SET DATA TYPE "sites_cms"."enum_pages_blocks_team_variant" USING "variant"::"sites_cms"."enum_pages_blocks_team_variant";
  ALTER TABLE "sites_cms"."pages_blocks_gallery" ALTER COLUMN "variant" SET DATA TYPE text;
  ALTER TABLE "sites_cms"."pages_blocks_gallery" ALTER COLUMN "variant" SET DEFAULT 'atelier'::text;
  DROP TYPE "sites_cms"."enum_pages_blocks_gallery_variant";
  CREATE TYPE "sites_cms"."enum_pages_blocks_gallery_variant" AS ENUM('atelier');
  ALTER TABLE "sites_cms"."pages_blocks_gallery" ALTER COLUMN "variant" SET DEFAULT 'atelier'::"sites_cms"."enum_pages_blocks_gallery_variant";
  ALTER TABLE "sites_cms"."pages_blocks_gallery" ALTER COLUMN "variant" SET DATA TYPE "sites_cms"."enum_pages_blocks_gallery_variant" USING "variant"::"sites_cms"."enum_pages_blocks_gallery_variant";
  ALTER TABLE "sites_cms"."pages_blocks_hours_location" ALTER COLUMN "variant" SET DATA TYPE text;
  ALTER TABLE "sites_cms"."pages_blocks_hours_location" ALTER COLUMN "variant" SET DEFAULT 'atelier'::text;
  DROP TYPE "sites_cms"."enum_pages_blocks_hours_location_variant";
  CREATE TYPE "sites_cms"."enum_pages_blocks_hours_location_variant" AS ENUM('atelier');
  ALTER TABLE "sites_cms"."pages_blocks_hours_location" ALTER COLUMN "variant" SET DEFAULT 'atelier'::"sites_cms"."enum_pages_blocks_hours_location_variant";
  ALTER TABLE "sites_cms"."pages_blocks_hours_location" ALTER COLUMN "variant" SET DATA TYPE "sites_cms"."enum_pages_blocks_hours_location_variant" USING "variant"::"sites_cms"."enum_pages_blocks_hours_location_variant";
  ALTER TABLE "sites_cms"."pages_blocks_testimonials" ALTER COLUMN "variant" SET DATA TYPE text;
  ALTER TABLE "sites_cms"."pages_blocks_testimonials" ALTER COLUMN "variant" SET DEFAULT 'atelier'::text;
  DROP TYPE "sites_cms"."enum_pages_blocks_testimonials_variant";
  CREATE TYPE "sites_cms"."enum_pages_blocks_testimonials_variant" AS ENUM('atelier');
  ALTER TABLE "sites_cms"."pages_blocks_testimonials" ALTER COLUMN "variant" SET DEFAULT 'atelier'::"sites_cms"."enum_pages_blocks_testimonials_variant";
  ALTER TABLE "sites_cms"."pages_blocks_testimonials" ALTER COLUMN "variant" SET DATA TYPE "sites_cms"."enum_pages_blocks_testimonials_variant" USING "variant"::"sites_cms"."enum_pages_blocks_testimonials_variant";
  ALTER TABLE "sites_cms"."pages_blocks_faq" ALTER COLUMN "variant" SET DATA TYPE text;
  ALTER TABLE "sites_cms"."pages_blocks_faq" ALTER COLUMN "variant" SET DEFAULT 'atelier'::text;
  DROP TYPE "sites_cms"."enum_pages_blocks_faq_variant";
  CREATE TYPE "sites_cms"."enum_pages_blocks_faq_variant" AS ENUM('atelier');
  ALTER TABLE "sites_cms"."pages_blocks_faq" ALTER COLUMN "variant" SET DEFAULT 'atelier'::"sites_cms"."enum_pages_blocks_faq_variant";
  ALTER TABLE "sites_cms"."pages_blocks_faq" ALTER COLUMN "variant" SET DATA TYPE "sites_cms"."enum_pages_blocks_faq_variant" USING "variant"::"sites_cms"."enum_pages_blocks_faq_variant";
  ALTER TABLE "sites_cms"."pages_blocks_contact_handoff" ALTER COLUMN "variant" SET DATA TYPE text;
  ALTER TABLE "sites_cms"."pages_blocks_contact_handoff" ALTER COLUMN "variant" SET DEFAULT 'atelier'::text;
  DROP TYPE "sites_cms"."enum_pages_blocks_contact_handoff_variant";
  CREATE TYPE "sites_cms"."enum_pages_blocks_contact_handoff_variant" AS ENUM('atelier');
  ALTER TABLE "sites_cms"."pages_blocks_contact_handoff" ALTER COLUMN "variant" SET DEFAULT 'atelier'::"sites_cms"."enum_pages_blocks_contact_handoff_variant";
  ALTER TABLE "sites_cms"."pages_blocks_contact_handoff" ALTER COLUMN "variant" SET DATA TYPE "sites_cms"."enum_pages_blocks_contact_handoff_variant" USING "variant"::"sites_cms"."enum_pages_blocks_contact_handoff_variant";
  ALTER TABLE "sites_cms"."pages_blocks_marquee" ALTER COLUMN "variant" SET DATA TYPE text;
  ALTER TABLE "sites_cms"."pages_blocks_marquee" ALTER COLUMN "variant" SET DEFAULT 'atelier'::text;
  DROP TYPE "sites_cms"."enum_pages_blocks_marquee_variant";
  CREATE TYPE "sites_cms"."enum_pages_blocks_marquee_variant" AS ENUM('atelier');
  ALTER TABLE "sites_cms"."pages_blocks_marquee" ALTER COLUMN "variant" SET DEFAULT 'atelier'::"sites_cms"."enum_pages_blocks_marquee_variant";
  ALTER TABLE "sites_cms"."pages_blocks_marquee" ALTER COLUMN "variant" SET DATA TYPE "sites_cms"."enum_pages_blocks_marquee_variant" USING "variant"::"sites_cms"."enum_pages_blocks_marquee_variant";
  ALTER TABLE "sites_cms"."pages_blocks_stats" ALTER COLUMN "variant" SET DATA TYPE text;
  ALTER TABLE "sites_cms"."pages_blocks_stats" ALTER COLUMN "variant" SET DEFAULT 'atelier'::text;
  DROP TYPE "sites_cms"."enum_pages_blocks_stats_variant";
  CREATE TYPE "sites_cms"."enum_pages_blocks_stats_variant" AS ENUM('atelier');
  ALTER TABLE "sites_cms"."pages_blocks_stats" ALTER COLUMN "variant" SET DEFAULT 'atelier'::"sites_cms"."enum_pages_blocks_stats_variant";
  ALTER TABLE "sites_cms"."pages_blocks_stats" ALTER COLUMN "variant" SET DATA TYPE "sites_cms"."enum_pages_blocks_stats_variant" USING "variant"::"sites_cms"."enum_pages_blocks_stats_variant";
  ALTER TABLE "sites_cms"."pages_blocks_pull_quote" ALTER COLUMN "variant" SET DATA TYPE text;
  ALTER TABLE "sites_cms"."pages_blocks_pull_quote" ALTER COLUMN "variant" SET DEFAULT 'atelier'::text;
  DROP TYPE "sites_cms"."enum_pages_blocks_pull_quote_variant";
  CREATE TYPE "sites_cms"."enum_pages_blocks_pull_quote_variant" AS ENUM('atelier');
  ALTER TABLE "sites_cms"."pages_blocks_pull_quote" ALTER COLUMN "variant" SET DEFAULT 'atelier'::"sites_cms"."enum_pages_blocks_pull_quote_variant";
  ALTER TABLE "sites_cms"."pages_blocks_pull_quote" ALTER COLUMN "variant" SET DATA TYPE "sites_cms"."enum_pages_blocks_pull_quote_variant" USING "variant"::"sites_cms"."enum_pages_blocks_pull_quote_variant";
  ALTER TABLE "sites_cms"."pages_blocks_map_embed" ALTER COLUMN "variant" SET DATA TYPE text;
  ALTER TABLE "sites_cms"."pages_blocks_map_embed" ALTER COLUMN "variant" SET DEFAULT 'atelier'::text;
  DROP TYPE "sites_cms"."enum_pages_blocks_map_embed_variant";
  CREATE TYPE "sites_cms"."enum_pages_blocks_map_embed_variant" AS ENUM('atelier');
  ALTER TABLE "sites_cms"."pages_blocks_map_embed" ALTER COLUMN "variant" SET DEFAULT 'atelier'::"sites_cms"."enum_pages_blocks_map_embed_variant";
  ALTER TABLE "sites_cms"."pages_blocks_map_embed" ALTER COLUMN "variant" SET DATA TYPE "sites_cms"."enum_pages_blocks_map_embed_variant" USING "variant"::"sites_cms"."enum_pages_blocks_map_embed_variant";
  ALTER TABLE "sites_cms"."pages_blocks_destination_grid" ALTER COLUMN "variant" SET DATA TYPE text;
  ALTER TABLE "sites_cms"."pages_blocks_destination_grid" ALTER COLUMN "variant" SET DEFAULT 'neutral'::text;
  DROP TYPE "sites_cms"."enum_pages_blocks_destination_grid_variant";
  CREATE TYPE "sites_cms"."enum_pages_blocks_destination_grid_variant" AS ENUM('neutral');
  ALTER TABLE "sites_cms"."pages_blocks_destination_grid" ALTER COLUMN "variant" SET DEFAULT 'neutral'::"sites_cms"."enum_pages_blocks_destination_grid_variant";
  ALTER TABLE "sites_cms"."pages_blocks_destination_grid" ALTER COLUMN "variant" SET DATA TYPE "sites_cms"."enum_pages_blocks_destination_grid_variant" USING "variant"::"sites_cms"."enum_pages_blocks_destination_grid_variant";
  ALTER TABLE "sites_cms"."pages_blocks_story_grid" ALTER COLUMN "variant" SET DATA TYPE text;
  ALTER TABLE "sites_cms"."pages_blocks_story_grid" ALTER COLUMN "variant" SET DEFAULT 'neutral'::text;
  DROP TYPE "sites_cms"."enum_pages_blocks_story_grid_variant";
  CREATE TYPE "sites_cms"."enum_pages_blocks_story_grid_variant" AS ENUM('neutral');
  ALTER TABLE "sites_cms"."pages_blocks_story_grid" ALTER COLUMN "variant" SET DEFAULT 'neutral'::"sites_cms"."enum_pages_blocks_story_grid_variant";
  ALTER TABLE "sites_cms"."pages_blocks_story_grid" ALTER COLUMN "variant" SET DATA TYPE "sites_cms"."enum_pages_blocks_story_grid_variant" USING "variant"::"sites_cms"."enum_pages_blocks_story_grid_variant";
  ALTER TABLE "sites_cms"."pages_blocks_offering_history" ALTER COLUMN "variant" SET DATA TYPE text;
  ALTER TABLE "sites_cms"."pages_blocks_offering_history" ALTER COLUMN "variant" SET DEFAULT 'neutral'::text;
  DROP TYPE "sites_cms"."enum_pages_blocks_offering_history_variant";
  CREATE TYPE "sites_cms"."enum_pages_blocks_offering_history_variant" AS ENUM('neutral');
  ALTER TABLE "sites_cms"."pages_blocks_offering_history" ALTER COLUMN "variant" SET DEFAULT 'neutral'::"sites_cms"."enum_pages_blocks_offering_history_variant";
  ALTER TABLE "sites_cms"."pages_blocks_offering_history" ALTER COLUMN "variant" SET DATA TYPE "sites_cms"."enum_pages_blocks_offering_history_variant" USING "variant"::"sites_cms"."enum_pages_blocks_offering_history_variant";
  ALTER TABLE "sites_cms"."pages_blocks_contact_form" ALTER COLUMN "variant" SET DATA TYPE text;
  ALTER TABLE "sites_cms"."pages_blocks_contact_form" ALTER COLUMN "variant" SET DEFAULT 'neutral'::text;
  DROP TYPE "sites_cms"."enum_pages_blocks_contact_form_variant";
  CREATE TYPE "sites_cms"."enum_pages_blocks_contact_form_variant" AS ENUM('neutral');
  ALTER TABLE "sites_cms"."pages_blocks_contact_form" ALTER COLUMN "variant" SET DEFAULT 'neutral'::"sites_cms"."enum_pages_blocks_contact_form_variant";
  ALTER TABLE "sites_cms"."pages_blocks_contact_form" ALTER COLUMN "variant" SET DATA TYPE "sites_cms"."enum_pages_blocks_contact_form_variant" USING "variant"::"sites_cms"."enum_pages_blocks_contact_form_variant";
  ALTER TABLE "sites_cms"."pages_blocks_newsletter_signup" ALTER COLUMN "variant" SET DATA TYPE text;
  ALTER TABLE "sites_cms"."pages_blocks_newsletter_signup" ALTER COLUMN "variant" SET DEFAULT 'neutral'::text;
  DROP TYPE "sites_cms"."enum_pages_blocks_newsletter_signup_variant";
  CREATE TYPE "sites_cms"."enum_pages_blocks_newsletter_signup_variant" AS ENUM('neutral');
  ALTER TABLE "sites_cms"."pages_blocks_newsletter_signup" ALTER COLUMN "variant" SET DEFAULT 'neutral'::"sites_cms"."enum_pages_blocks_newsletter_signup_variant";
  ALTER TABLE "sites_cms"."pages_blocks_newsletter_signup" ALTER COLUMN "variant" SET DATA TYPE "sites_cms"."enum_pages_blocks_newsletter_signup_variant" USING "variant"::"sites_cms"."enum_pages_blocks_newsletter_signup_variant";
  ALTER TABLE "sites_cms"."pages_blocks_divider" ALTER COLUMN "variant" SET DATA TYPE text;
  ALTER TABLE "sites_cms"."pages_blocks_divider" ALTER COLUMN "variant" SET DEFAULT 'atelier'::text;
  DROP TYPE "sites_cms"."enum_pages_blocks_divider_variant";
  CREATE TYPE "sites_cms"."enum_pages_blocks_divider_variant" AS ENUM('atelier');
  ALTER TABLE "sites_cms"."pages_blocks_divider" ALTER COLUMN "variant" SET DEFAULT 'atelier'::"sites_cms"."enum_pages_blocks_divider_variant";
  ALTER TABLE "sites_cms"."pages_blocks_divider" ALTER COLUMN "variant" SET DATA TYPE "sites_cms"."enum_pages_blocks_divider_variant" USING "variant"::"sites_cms"."enum_pages_blocks_divider_variant";
  ALTER TABLE "sites_cms"."pages_blocks_spacer" ALTER COLUMN "variant" SET DATA TYPE text;
  ALTER TABLE "sites_cms"."pages_blocks_spacer" ALTER COLUMN "variant" SET DEFAULT 'atelier'::text;
  DROP TYPE "sites_cms"."enum_pages_blocks_spacer_variant";
  CREATE TYPE "sites_cms"."enum_pages_blocks_spacer_variant" AS ENUM('atelier');
  ALTER TABLE "sites_cms"."pages_blocks_spacer" ALTER COLUMN "variant" SET DEFAULT 'atelier'::"sites_cms"."enum_pages_blocks_spacer_variant";
  ALTER TABLE "sites_cms"."pages_blocks_spacer" ALTER COLUMN "variant" SET DATA TYPE "sites_cms"."enum_pages_blocks_spacer_variant" USING "variant"::"sites_cms"."enum_pages_blocks_spacer_variant";
  ALTER TABLE "sites_cms"."_pages_v_blocks_hero" ALTER COLUMN "variant" SET DATA TYPE text;
  ALTER TABLE "sites_cms"."_pages_v_blocks_hero" ALTER COLUMN "variant" SET DEFAULT 'atelier'::text;
  DROP TYPE "sites_cms"."enum__pages_v_blocks_hero_variant";
  CREATE TYPE "sites_cms"."enum__pages_v_blocks_hero_variant" AS ENUM('atelier');
  ALTER TABLE "sites_cms"."_pages_v_blocks_hero" ALTER COLUMN "variant" SET DEFAULT 'atelier'::"sites_cms"."enum__pages_v_blocks_hero_variant";
  ALTER TABLE "sites_cms"."_pages_v_blocks_hero" ALTER COLUMN "variant" SET DATA TYPE "sites_cms"."enum__pages_v_blocks_hero_variant" USING "variant"::"sites_cms"."enum__pages_v_blocks_hero_variant";
  ALTER TABLE "sites_cms"."_pages_v_blocks_rich_text" ALTER COLUMN "variant" SET DATA TYPE text;
  ALTER TABLE "sites_cms"."_pages_v_blocks_rich_text" ALTER COLUMN "variant" SET DEFAULT 'atelier'::text;
  DROP TYPE "sites_cms"."enum__pages_v_blocks_rich_text_variant";
  CREATE TYPE "sites_cms"."enum__pages_v_blocks_rich_text_variant" AS ENUM('atelier');
  ALTER TABLE "sites_cms"."_pages_v_blocks_rich_text" ALTER COLUMN "variant" SET DEFAULT 'atelier'::"sites_cms"."enum__pages_v_blocks_rich_text_variant";
  ALTER TABLE "sites_cms"."_pages_v_blocks_rich_text" ALTER COLUMN "variant" SET DATA TYPE "sites_cms"."enum__pages_v_blocks_rich_text_variant" USING "variant"::"sites_cms"."enum__pages_v_blocks_rich_text_variant";
  ALTER TABLE "sites_cms"."_pages_v_blocks_media_feature" ALTER COLUMN "variant" SET DATA TYPE text;
  ALTER TABLE "sites_cms"."_pages_v_blocks_media_feature" ALTER COLUMN "variant" SET DEFAULT 'atelier'::text;
  DROP TYPE "sites_cms"."enum__pages_v_blocks_media_feature_variant";
  CREATE TYPE "sites_cms"."enum__pages_v_blocks_media_feature_variant" AS ENUM('atelier');
  ALTER TABLE "sites_cms"."_pages_v_blocks_media_feature" ALTER COLUMN "variant" SET DEFAULT 'atelier'::"sites_cms"."enum__pages_v_blocks_media_feature_variant";
  ALTER TABLE "sites_cms"."_pages_v_blocks_media_feature" ALTER COLUMN "variant" SET DATA TYPE "sites_cms"."enum__pages_v_blocks_media_feature_variant" USING "variant"::"sites_cms"."enum__pages_v_blocks_media_feature_variant";
  ALTER TABLE "sites_cms"."_pages_v_blocks_cta" ALTER COLUMN "variant" SET DATA TYPE text;
  ALTER TABLE "sites_cms"."_pages_v_blocks_cta" ALTER COLUMN "variant" SET DEFAULT 'atelier'::text;
  DROP TYPE "sites_cms"."enum__pages_v_blocks_cta_variant";
  CREATE TYPE "sites_cms"."enum__pages_v_blocks_cta_variant" AS ENUM('atelier');
  ALTER TABLE "sites_cms"."_pages_v_blocks_cta" ALTER COLUMN "variant" SET DEFAULT 'atelier'::"sites_cms"."enum__pages_v_blocks_cta_variant";
  ALTER TABLE "sites_cms"."_pages_v_blocks_cta" ALTER COLUMN "variant" SET DATA TYPE "sites_cms"."enum__pages_v_blocks_cta_variant" USING "variant"::"sites_cms"."enum__pages_v_blocks_cta_variant";
  ALTER TABLE "sites_cms"."_pages_v_blocks_offering_grid" ALTER COLUMN "variant" SET DATA TYPE text;
  ALTER TABLE "sites_cms"."_pages_v_blocks_offering_grid" ALTER COLUMN "variant" SET DEFAULT 'atelier'::text;
  DROP TYPE "sites_cms"."enum__pages_v_blocks_offering_grid_variant";
  CREATE TYPE "sites_cms"."enum__pages_v_blocks_offering_grid_variant" AS ENUM('atelier');
  ALTER TABLE "sites_cms"."_pages_v_blocks_offering_grid" ALTER COLUMN "variant" SET DEFAULT 'atelier'::"sites_cms"."enum__pages_v_blocks_offering_grid_variant";
  ALTER TABLE "sites_cms"."_pages_v_blocks_offering_grid" ALTER COLUMN "variant" SET DATA TYPE "sites_cms"."enum__pages_v_blocks_offering_grid_variant" USING "variant"::"sites_cms"."enum__pages_v_blocks_offering_grid_variant";
  ALTER TABLE "sites_cms"."_pages_v_blocks_venue_reservation" ALTER COLUMN "variant" SET DATA TYPE text;
  ALTER TABLE "sites_cms"."_pages_v_blocks_venue_reservation" ALTER COLUMN "variant" SET DEFAULT 'atelier'::text;
  DROP TYPE "sites_cms"."enum__pages_v_blocks_venue_reservation_variant";
  CREATE TYPE "sites_cms"."enum__pages_v_blocks_venue_reservation_variant" AS ENUM('atelier');
  ALTER TABLE "sites_cms"."_pages_v_blocks_venue_reservation" ALTER COLUMN "variant" SET DEFAULT 'atelier'::"sites_cms"."enum__pages_v_blocks_venue_reservation_variant";
  ALTER TABLE "sites_cms"."_pages_v_blocks_venue_reservation" ALTER COLUMN "variant" SET DATA TYPE "sites_cms"."enum__pages_v_blocks_venue_reservation_variant" USING "variant"::"sites_cms"."enum__pages_v_blocks_venue_reservation_variant";
  ALTER TABLE "sites_cms"."_pages_v_blocks_menu_link" ALTER COLUMN "variant" SET DATA TYPE text;
  ALTER TABLE "sites_cms"."_pages_v_blocks_menu_link" ALTER COLUMN "variant" SET DEFAULT 'atelier'::text;
  DROP TYPE "sites_cms"."enum__pages_v_blocks_menu_link_variant";
  CREATE TYPE "sites_cms"."enum__pages_v_blocks_menu_link_variant" AS ENUM('atelier');
  ALTER TABLE "sites_cms"."_pages_v_blocks_menu_link" ALTER COLUMN "variant" SET DEFAULT 'atelier'::"sites_cms"."enum__pages_v_blocks_menu_link_variant";
  ALTER TABLE "sites_cms"."_pages_v_blocks_menu_link" ALTER COLUMN "variant" SET DATA TYPE "sites_cms"."enum__pages_v_blocks_menu_link_variant" USING "variant"::"sites_cms"."enum__pages_v_blocks_menu_link_variant";
  ALTER TABLE "sites_cms"."_pages_v_blocks_menu_board" ALTER COLUMN "variant" SET DATA TYPE text;
  ALTER TABLE "sites_cms"."_pages_v_blocks_menu_board" ALTER COLUMN "variant" SET DEFAULT 'atelier'::text;
  DROP TYPE "sites_cms"."enum__pages_v_blocks_menu_board_variant";
  CREATE TYPE "sites_cms"."enum__pages_v_blocks_menu_board_variant" AS ENUM('atelier');
  ALTER TABLE "sites_cms"."_pages_v_blocks_menu_board" ALTER COLUMN "variant" SET DEFAULT 'atelier'::"sites_cms"."enum__pages_v_blocks_menu_board_variant";
  ALTER TABLE "sites_cms"."_pages_v_blocks_menu_board" ALTER COLUMN "variant" SET DATA TYPE "sites_cms"."enum__pages_v_blocks_menu_board_variant" USING "variant"::"sites_cms"."enum__pages_v_blocks_menu_board_variant";
  ALTER TABLE "sites_cms"."_pages_v_blocks_menu_preview" ALTER COLUMN "variant" SET DATA TYPE text;
  ALTER TABLE "sites_cms"."_pages_v_blocks_menu_preview" ALTER COLUMN "variant" SET DEFAULT 'atelier'::text;
  DROP TYPE "sites_cms"."enum__pages_v_blocks_menu_preview_variant";
  CREATE TYPE "sites_cms"."enum__pages_v_blocks_menu_preview_variant" AS ENUM('atelier');
  ALTER TABLE "sites_cms"."_pages_v_blocks_menu_preview" ALTER COLUMN "variant" SET DEFAULT 'atelier'::"sites_cms"."enum__pages_v_blocks_menu_preview_variant";
  ALTER TABLE "sites_cms"."_pages_v_blocks_menu_preview" ALTER COLUMN "variant" SET DATA TYPE "sites_cms"."enum__pages_v_blocks_menu_preview_variant" USING "variant"::"sites_cms"."enum__pages_v_blocks_menu_preview_variant";
  ALTER TABLE "sites_cms"."_pages_v_blocks_video_feature" ALTER COLUMN "variant" SET DATA TYPE text;
  ALTER TABLE "sites_cms"."_pages_v_blocks_video_feature" ALTER COLUMN "variant" SET DEFAULT 'atelier'::text;
  DROP TYPE "sites_cms"."enum__pages_v_blocks_video_feature_variant";
  CREATE TYPE "sites_cms"."enum__pages_v_blocks_video_feature_variant" AS ENUM('atelier');
  ALTER TABLE "sites_cms"."_pages_v_blocks_video_feature" ALTER COLUMN "variant" SET DEFAULT 'atelier'::"sites_cms"."enum__pages_v_blocks_video_feature_variant";
  ALTER TABLE "sites_cms"."_pages_v_blocks_video_feature" ALTER COLUMN "variant" SET DATA TYPE "sites_cms"."enum__pages_v_blocks_video_feature_variant" USING "variant"::"sites_cms"."enum__pages_v_blocks_video_feature_variant";
  ALTER TABLE "sites_cms"."_pages_v_blocks_team" ALTER COLUMN "variant" SET DATA TYPE text;
  ALTER TABLE "sites_cms"."_pages_v_blocks_team" ALTER COLUMN "variant" SET DEFAULT 'atelier'::text;
  DROP TYPE "sites_cms"."enum__pages_v_blocks_team_variant";
  CREATE TYPE "sites_cms"."enum__pages_v_blocks_team_variant" AS ENUM('atelier');
  ALTER TABLE "sites_cms"."_pages_v_blocks_team" ALTER COLUMN "variant" SET DEFAULT 'atelier'::"sites_cms"."enum__pages_v_blocks_team_variant";
  ALTER TABLE "sites_cms"."_pages_v_blocks_team" ALTER COLUMN "variant" SET DATA TYPE "sites_cms"."enum__pages_v_blocks_team_variant" USING "variant"::"sites_cms"."enum__pages_v_blocks_team_variant";
  ALTER TABLE "sites_cms"."_pages_v_blocks_gallery" ALTER COLUMN "variant" SET DATA TYPE text;
  ALTER TABLE "sites_cms"."_pages_v_blocks_gallery" ALTER COLUMN "variant" SET DEFAULT 'atelier'::text;
  DROP TYPE "sites_cms"."enum__pages_v_blocks_gallery_variant";
  CREATE TYPE "sites_cms"."enum__pages_v_blocks_gallery_variant" AS ENUM('atelier');
  ALTER TABLE "sites_cms"."_pages_v_blocks_gallery" ALTER COLUMN "variant" SET DEFAULT 'atelier'::"sites_cms"."enum__pages_v_blocks_gallery_variant";
  ALTER TABLE "sites_cms"."_pages_v_blocks_gallery" ALTER COLUMN "variant" SET DATA TYPE "sites_cms"."enum__pages_v_blocks_gallery_variant" USING "variant"::"sites_cms"."enum__pages_v_blocks_gallery_variant";
  ALTER TABLE "sites_cms"."_pages_v_blocks_hours_location" ALTER COLUMN "variant" SET DATA TYPE text;
  ALTER TABLE "sites_cms"."_pages_v_blocks_hours_location" ALTER COLUMN "variant" SET DEFAULT 'atelier'::text;
  DROP TYPE "sites_cms"."enum__pages_v_blocks_hours_location_variant";
  CREATE TYPE "sites_cms"."enum__pages_v_blocks_hours_location_variant" AS ENUM('atelier');
  ALTER TABLE "sites_cms"."_pages_v_blocks_hours_location" ALTER COLUMN "variant" SET DEFAULT 'atelier'::"sites_cms"."enum__pages_v_blocks_hours_location_variant";
  ALTER TABLE "sites_cms"."_pages_v_blocks_hours_location" ALTER COLUMN "variant" SET DATA TYPE "sites_cms"."enum__pages_v_blocks_hours_location_variant" USING "variant"::"sites_cms"."enum__pages_v_blocks_hours_location_variant";
  ALTER TABLE "sites_cms"."_pages_v_blocks_testimonials" ALTER COLUMN "variant" SET DATA TYPE text;
  ALTER TABLE "sites_cms"."_pages_v_blocks_testimonials" ALTER COLUMN "variant" SET DEFAULT 'atelier'::text;
  DROP TYPE "sites_cms"."enum__pages_v_blocks_testimonials_variant";
  CREATE TYPE "sites_cms"."enum__pages_v_blocks_testimonials_variant" AS ENUM('atelier');
  ALTER TABLE "sites_cms"."_pages_v_blocks_testimonials" ALTER COLUMN "variant" SET DEFAULT 'atelier'::"sites_cms"."enum__pages_v_blocks_testimonials_variant";
  ALTER TABLE "sites_cms"."_pages_v_blocks_testimonials" ALTER COLUMN "variant" SET DATA TYPE "sites_cms"."enum__pages_v_blocks_testimonials_variant" USING "variant"::"sites_cms"."enum__pages_v_blocks_testimonials_variant";
  ALTER TABLE "sites_cms"."_pages_v_blocks_faq" ALTER COLUMN "variant" SET DATA TYPE text;
  ALTER TABLE "sites_cms"."_pages_v_blocks_faq" ALTER COLUMN "variant" SET DEFAULT 'atelier'::text;
  DROP TYPE "sites_cms"."enum__pages_v_blocks_faq_variant";
  CREATE TYPE "sites_cms"."enum__pages_v_blocks_faq_variant" AS ENUM('atelier');
  ALTER TABLE "sites_cms"."_pages_v_blocks_faq" ALTER COLUMN "variant" SET DEFAULT 'atelier'::"sites_cms"."enum__pages_v_blocks_faq_variant";
  ALTER TABLE "sites_cms"."_pages_v_blocks_faq" ALTER COLUMN "variant" SET DATA TYPE "sites_cms"."enum__pages_v_blocks_faq_variant" USING "variant"::"sites_cms"."enum__pages_v_blocks_faq_variant";
  ALTER TABLE "sites_cms"."_pages_v_blocks_contact_handoff" ALTER COLUMN "variant" SET DATA TYPE text;
  ALTER TABLE "sites_cms"."_pages_v_blocks_contact_handoff" ALTER COLUMN "variant" SET DEFAULT 'atelier'::text;
  DROP TYPE "sites_cms"."enum__pages_v_blocks_contact_handoff_variant";
  CREATE TYPE "sites_cms"."enum__pages_v_blocks_contact_handoff_variant" AS ENUM('atelier');
  ALTER TABLE "sites_cms"."_pages_v_blocks_contact_handoff" ALTER COLUMN "variant" SET DEFAULT 'atelier'::"sites_cms"."enum__pages_v_blocks_contact_handoff_variant";
  ALTER TABLE "sites_cms"."_pages_v_blocks_contact_handoff" ALTER COLUMN "variant" SET DATA TYPE "sites_cms"."enum__pages_v_blocks_contact_handoff_variant" USING "variant"::"sites_cms"."enum__pages_v_blocks_contact_handoff_variant";
  ALTER TABLE "sites_cms"."_pages_v_blocks_marquee" ALTER COLUMN "variant" SET DATA TYPE text;
  ALTER TABLE "sites_cms"."_pages_v_blocks_marquee" ALTER COLUMN "variant" SET DEFAULT 'atelier'::text;
  DROP TYPE "sites_cms"."enum__pages_v_blocks_marquee_variant";
  CREATE TYPE "sites_cms"."enum__pages_v_blocks_marquee_variant" AS ENUM('atelier');
  ALTER TABLE "sites_cms"."_pages_v_blocks_marquee" ALTER COLUMN "variant" SET DEFAULT 'atelier'::"sites_cms"."enum__pages_v_blocks_marquee_variant";
  ALTER TABLE "sites_cms"."_pages_v_blocks_marquee" ALTER COLUMN "variant" SET DATA TYPE "sites_cms"."enum__pages_v_blocks_marquee_variant" USING "variant"::"sites_cms"."enum__pages_v_blocks_marquee_variant";
  ALTER TABLE "sites_cms"."_pages_v_blocks_stats" ALTER COLUMN "variant" SET DATA TYPE text;
  ALTER TABLE "sites_cms"."_pages_v_blocks_stats" ALTER COLUMN "variant" SET DEFAULT 'atelier'::text;
  DROP TYPE "sites_cms"."enum__pages_v_blocks_stats_variant";
  CREATE TYPE "sites_cms"."enum__pages_v_blocks_stats_variant" AS ENUM('atelier');
  ALTER TABLE "sites_cms"."_pages_v_blocks_stats" ALTER COLUMN "variant" SET DEFAULT 'atelier'::"sites_cms"."enum__pages_v_blocks_stats_variant";
  ALTER TABLE "sites_cms"."_pages_v_blocks_stats" ALTER COLUMN "variant" SET DATA TYPE "sites_cms"."enum__pages_v_blocks_stats_variant" USING "variant"::"sites_cms"."enum__pages_v_blocks_stats_variant";
  ALTER TABLE "sites_cms"."_pages_v_blocks_pull_quote" ALTER COLUMN "variant" SET DATA TYPE text;
  ALTER TABLE "sites_cms"."_pages_v_blocks_pull_quote" ALTER COLUMN "variant" SET DEFAULT 'atelier'::text;
  DROP TYPE "sites_cms"."enum__pages_v_blocks_pull_quote_variant";
  CREATE TYPE "sites_cms"."enum__pages_v_blocks_pull_quote_variant" AS ENUM('atelier');
  ALTER TABLE "sites_cms"."_pages_v_blocks_pull_quote" ALTER COLUMN "variant" SET DEFAULT 'atelier'::"sites_cms"."enum__pages_v_blocks_pull_quote_variant";
  ALTER TABLE "sites_cms"."_pages_v_blocks_pull_quote" ALTER COLUMN "variant" SET DATA TYPE "sites_cms"."enum__pages_v_blocks_pull_quote_variant" USING "variant"::"sites_cms"."enum__pages_v_blocks_pull_quote_variant";
  ALTER TABLE "sites_cms"."_pages_v_blocks_map_embed" ALTER COLUMN "variant" SET DATA TYPE text;
  ALTER TABLE "sites_cms"."_pages_v_blocks_map_embed" ALTER COLUMN "variant" SET DEFAULT 'atelier'::text;
  DROP TYPE "sites_cms"."enum__pages_v_blocks_map_embed_variant";
  CREATE TYPE "sites_cms"."enum__pages_v_blocks_map_embed_variant" AS ENUM('atelier');
  ALTER TABLE "sites_cms"."_pages_v_blocks_map_embed" ALTER COLUMN "variant" SET DEFAULT 'atelier'::"sites_cms"."enum__pages_v_blocks_map_embed_variant";
  ALTER TABLE "sites_cms"."_pages_v_blocks_map_embed" ALTER COLUMN "variant" SET DATA TYPE "sites_cms"."enum__pages_v_blocks_map_embed_variant" USING "variant"::"sites_cms"."enum__pages_v_blocks_map_embed_variant";
  ALTER TABLE "sites_cms"."_pages_v_blocks_destination_grid" ALTER COLUMN "variant" SET DATA TYPE text;
  ALTER TABLE "sites_cms"."_pages_v_blocks_destination_grid" ALTER COLUMN "variant" SET DEFAULT 'neutral'::text;
  DROP TYPE "sites_cms"."enum__pages_v_blocks_destination_grid_variant";
  CREATE TYPE "sites_cms"."enum__pages_v_blocks_destination_grid_variant" AS ENUM('neutral');
  ALTER TABLE "sites_cms"."_pages_v_blocks_destination_grid" ALTER COLUMN "variant" SET DEFAULT 'neutral'::"sites_cms"."enum__pages_v_blocks_destination_grid_variant";
  ALTER TABLE "sites_cms"."_pages_v_blocks_destination_grid" ALTER COLUMN "variant" SET DATA TYPE "sites_cms"."enum__pages_v_blocks_destination_grid_variant" USING "variant"::"sites_cms"."enum__pages_v_blocks_destination_grid_variant";
  ALTER TABLE "sites_cms"."_pages_v_blocks_story_grid" ALTER COLUMN "variant" SET DATA TYPE text;
  ALTER TABLE "sites_cms"."_pages_v_blocks_story_grid" ALTER COLUMN "variant" SET DEFAULT 'neutral'::text;
  DROP TYPE "sites_cms"."enum__pages_v_blocks_story_grid_variant";
  CREATE TYPE "sites_cms"."enum__pages_v_blocks_story_grid_variant" AS ENUM('neutral');
  ALTER TABLE "sites_cms"."_pages_v_blocks_story_grid" ALTER COLUMN "variant" SET DEFAULT 'neutral'::"sites_cms"."enum__pages_v_blocks_story_grid_variant";
  ALTER TABLE "sites_cms"."_pages_v_blocks_story_grid" ALTER COLUMN "variant" SET DATA TYPE "sites_cms"."enum__pages_v_blocks_story_grid_variant" USING "variant"::"sites_cms"."enum__pages_v_blocks_story_grid_variant";
  ALTER TABLE "sites_cms"."_pages_v_blocks_offering_history" ALTER COLUMN "variant" SET DATA TYPE text;
  ALTER TABLE "sites_cms"."_pages_v_blocks_offering_history" ALTER COLUMN "variant" SET DEFAULT 'neutral'::text;
  DROP TYPE "sites_cms"."enum__pages_v_blocks_offering_history_variant";
  CREATE TYPE "sites_cms"."enum__pages_v_blocks_offering_history_variant" AS ENUM('neutral');
  ALTER TABLE "sites_cms"."_pages_v_blocks_offering_history" ALTER COLUMN "variant" SET DEFAULT 'neutral'::"sites_cms"."enum__pages_v_blocks_offering_history_variant";
  ALTER TABLE "sites_cms"."_pages_v_blocks_offering_history" ALTER COLUMN "variant" SET DATA TYPE "sites_cms"."enum__pages_v_blocks_offering_history_variant" USING "variant"::"sites_cms"."enum__pages_v_blocks_offering_history_variant";
  ALTER TABLE "sites_cms"."_pages_v_blocks_contact_form" ALTER COLUMN "variant" SET DATA TYPE text;
  ALTER TABLE "sites_cms"."_pages_v_blocks_contact_form" ALTER COLUMN "variant" SET DEFAULT 'neutral'::text;
  DROP TYPE "sites_cms"."enum__pages_v_blocks_contact_form_variant";
  CREATE TYPE "sites_cms"."enum__pages_v_blocks_contact_form_variant" AS ENUM('neutral');
  ALTER TABLE "sites_cms"."_pages_v_blocks_contact_form" ALTER COLUMN "variant" SET DEFAULT 'neutral'::"sites_cms"."enum__pages_v_blocks_contact_form_variant";
  ALTER TABLE "sites_cms"."_pages_v_blocks_contact_form" ALTER COLUMN "variant" SET DATA TYPE "sites_cms"."enum__pages_v_blocks_contact_form_variant" USING "variant"::"sites_cms"."enum__pages_v_blocks_contact_form_variant";
  ALTER TABLE "sites_cms"."_pages_v_blocks_newsletter_signup" ALTER COLUMN "variant" SET DATA TYPE text;
  ALTER TABLE "sites_cms"."_pages_v_blocks_newsletter_signup" ALTER COLUMN "variant" SET DEFAULT 'neutral'::text;
  DROP TYPE "sites_cms"."enum__pages_v_blocks_newsletter_signup_variant";
  CREATE TYPE "sites_cms"."enum__pages_v_blocks_newsletter_signup_variant" AS ENUM('neutral');
  ALTER TABLE "sites_cms"."_pages_v_blocks_newsletter_signup" ALTER COLUMN "variant" SET DEFAULT 'neutral'::"sites_cms"."enum__pages_v_blocks_newsletter_signup_variant";
  ALTER TABLE "sites_cms"."_pages_v_blocks_newsletter_signup" ALTER COLUMN "variant" SET DATA TYPE "sites_cms"."enum__pages_v_blocks_newsletter_signup_variant" USING "variant"::"sites_cms"."enum__pages_v_blocks_newsletter_signup_variant";
  ALTER TABLE "sites_cms"."_pages_v_blocks_divider" ALTER COLUMN "variant" SET DATA TYPE text;
  ALTER TABLE "sites_cms"."_pages_v_blocks_divider" ALTER COLUMN "variant" SET DEFAULT 'atelier'::text;
  DROP TYPE "sites_cms"."enum__pages_v_blocks_divider_variant";
  CREATE TYPE "sites_cms"."enum__pages_v_blocks_divider_variant" AS ENUM('atelier');
  ALTER TABLE "sites_cms"."_pages_v_blocks_divider" ALTER COLUMN "variant" SET DEFAULT 'atelier'::"sites_cms"."enum__pages_v_blocks_divider_variant";
  ALTER TABLE "sites_cms"."_pages_v_blocks_divider" ALTER COLUMN "variant" SET DATA TYPE "sites_cms"."enum__pages_v_blocks_divider_variant" USING "variant"::"sites_cms"."enum__pages_v_blocks_divider_variant";
  ALTER TABLE "sites_cms"."_pages_v_blocks_spacer" ALTER COLUMN "variant" SET DATA TYPE text;
  ALTER TABLE "sites_cms"."_pages_v_blocks_spacer" ALTER COLUMN "variant" SET DEFAULT 'atelier'::text;
  DROP TYPE "sites_cms"."enum__pages_v_blocks_spacer_variant";
  CREATE TYPE "sites_cms"."enum__pages_v_blocks_spacer_variant" AS ENUM('atelier');
  ALTER TABLE "sites_cms"."_pages_v_blocks_spacer" ALTER COLUMN "variant" SET DEFAULT 'atelier'::"sites_cms"."enum__pages_v_blocks_spacer_variant";
  ALTER TABLE "sites_cms"."_pages_v_blocks_spacer" ALTER COLUMN "variant" SET DATA TYPE "sites_cms"."enum__pages_v_blocks_spacer_variant" USING "variant"::"sites_cms"."enum__pages_v_blocks_spacer_variant";
  ALTER TABLE "sites_cms"."site_settings" ALTER COLUMN "design" SET DATA TYPE text;
  ALTER TABLE "sites_cms"."site_settings" ALTER COLUMN "design" SET DEFAULT 'atelier'::text;
  DROP TYPE "sites_cms"."enum_site_settings_design";
  CREATE TYPE "sites_cms"."enum_site_settings_design" AS ENUM('atelier');
  ALTER TABLE "sites_cms"."site_settings" ALTER COLUMN "design" SET DEFAULT 'atelier'::"sites_cms"."enum_site_settings_design";
  ALTER TABLE "sites_cms"."site_settings" ALTER COLUMN "design" SET DATA TYPE "sites_cms"."enum_site_settings_design" USING "design"::"sites_cms"."enum_site_settings_design";
  ALTER TABLE "sites_cms"."_site_settings_v" ALTER COLUMN "version_design" SET DATA TYPE text;
  ALTER TABLE "sites_cms"."_site_settings_v" ALTER COLUMN "version_design" SET DEFAULT 'atelier'::text;
  DROP TYPE "sites_cms"."enum__site_settings_v_version_design";
  CREATE TYPE "sites_cms"."enum__site_settings_v_version_design" AS ENUM('atelier');
  ALTER TABLE "sites_cms"."_site_settings_v" ALTER COLUMN "version_design" SET DEFAULT 'atelier'::"sites_cms"."enum__site_settings_v_version_design";
  ALTER TABLE "sites_cms"."_site_settings_v" ALTER COLUMN "version_design" SET DATA TYPE "sites_cms"."enum__site_settings_v_version_design" USING "version_design"::"sites_cms"."enum__site_settings_v_version_design";
  ALTER TABLE "sites_cms"."pages_blocks_hero" DROP COLUMN "eyebrow";
  ALTER TABLE "sites_cms"."pages_blocks_hero" DROP COLUMN "show_search";
  ALTER TABLE "sites_cms"."pages_blocks_rich_text" DROP COLUMN "width";
  ALTER TABLE "sites_cms"."pages_blocks_offering_grid" DROP COLUMN "intro";
  ALTER TABLE "sites_cms"."pages_blocks_offering_grid" DROP COLUMN "cta_label";
  ALTER TABLE "sites_cms"."pages_blocks_offering_grid" DROP COLUMN "cta_href";
  ALTER TABLE "sites_cms"."pages_blocks_offering_grid" DROP COLUMN "empty_cta_label";
  ALTER TABLE "sites_cms"."pages_blocks_offering_grid" DROP COLUMN "empty_cta_href";
  ALTER TABLE "sites_cms"."_pages_v_blocks_hero" DROP COLUMN "eyebrow";
  ALTER TABLE "sites_cms"."_pages_v_blocks_hero" DROP COLUMN "show_search";
  ALTER TABLE "sites_cms"."_pages_v_blocks_rich_text" DROP COLUMN "width";
  ALTER TABLE "sites_cms"."_pages_v_blocks_offering_grid" DROP COLUMN "intro";
  ALTER TABLE "sites_cms"."_pages_v_blocks_offering_grid" DROP COLUMN "cta_label";
  ALTER TABLE "sites_cms"."_pages_v_blocks_offering_grid" DROP COLUMN "cta_href";
  ALTER TABLE "sites_cms"."_pages_v_blocks_offering_grid" DROP COLUMN "empty_cta_label";
  ALTER TABLE "sites_cms"."_pages_v_blocks_offering_grid" DROP COLUMN "empty_cta_href";
  DROP TYPE "sites_cms"."enum_pages_blocks_rich_text_width";
  DROP TYPE "sites_cms"."enum_pages_blocks_page_header_variant";
  DROP TYPE "sites_cms"."enum_pages_blocks_feature_cards_cards_icon";
  DROP TYPE "sites_cms"."enum_pages_blocks_feature_cards_variant";
  DROP TYPE "sites_cms"."enum_pages_blocks_contact_details_variant";
  DROP TYPE "sites_cms"."enum__pages_v_blocks_rich_text_width";
  DROP TYPE "sites_cms"."enum__pages_v_blocks_page_header_variant";
  DROP TYPE "sites_cms"."enum__pages_v_blocks_feature_cards_cards_icon";
  DROP TYPE "sites_cms"."enum__pages_v_blocks_feature_cards_variant";
  DROP TYPE "sites_cms"."enum__pages_v_blocks_contact_details_variant";`)
}
