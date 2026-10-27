/*
 * #2829 W3 — the design system in Studio (generated with `payload
 * migrate:create`, then the data conversion below added by hand and reviewed).
 *
 * 1. Every block gets a `variant` (layout) column, default 'atelier', so every
 *    existing gögi block keeps its look with no data change.
 * 2. Site settings gain the look: design (atelier), tokens (the owner's exact
 *    colours), fonts, and shape/motion presets.
 * 3. The v1 colour and pairing fields are CONVERTED into tokens and fonts —
 *    exactly the values the owner set (no colour is changed) — before they are
 *    dropped, in both the live and the version tables.
 * 4. The shared font-assets cache table (not tenant-scoped; public font files).
 */
import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "sites_cms"."enum_pages_blocks_hero_variant" AS ENUM('atelier');
  CREATE TYPE "sites_cms"."enum_pages_blocks_rich_text_variant" AS ENUM('atelier');
  CREATE TYPE "sites_cms"."enum_pages_blocks_media_feature_variant" AS ENUM('atelier');
  CREATE TYPE "sites_cms"."enum_pages_blocks_cta_variant" AS ENUM('atelier');
  CREATE TYPE "sites_cms"."enum_pages_blocks_offering_grid_variant" AS ENUM('atelier');
  CREATE TYPE "sites_cms"."enum_pages_blocks_venue_reservation_variant" AS ENUM('atelier');
  CREATE TYPE "sites_cms"."enum_pages_blocks_menu_link_variant" AS ENUM('atelier');
  CREATE TYPE "sites_cms"."enum_pages_blocks_menu_board_variant" AS ENUM('atelier');
  CREATE TYPE "sites_cms"."enum_pages_blocks_menu_preview_variant" AS ENUM('atelier');
  CREATE TYPE "sites_cms"."enum_pages_blocks_video_feature_variant" AS ENUM('atelier');
  CREATE TYPE "sites_cms"."enum_pages_blocks_team_variant" AS ENUM('atelier');
  CREATE TYPE "sites_cms"."enum_pages_blocks_gallery_variant" AS ENUM('atelier');
  CREATE TYPE "sites_cms"."enum_pages_blocks_hours_location_variant" AS ENUM('atelier');
  CREATE TYPE "sites_cms"."enum_pages_blocks_testimonials_variant" AS ENUM('atelier');
  CREATE TYPE "sites_cms"."enum_pages_blocks_faq_variant" AS ENUM('atelier');
  CREATE TYPE "sites_cms"."enum_pages_blocks_contact_handoff_variant" AS ENUM('atelier');
  CREATE TYPE "sites_cms"."enum_pages_blocks_marquee_variant" AS ENUM('atelier');
  CREATE TYPE "sites_cms"."enum_pages_blocks_stats_variant" AS ENUM('atelier');
  CREATE TYPE "sites_cms"."enum_pages_blocks_pull_quote_variant" AS ENUM('atelier');
  CREATE TYPE "sites_cms"."enum_pages_blocks_map_embed_variant" AS ENUM('atelier');
  CREATE TYPE "sites_cms"."enum_pages_blocks_divider_variant" AS ENUM('atelier');
  CREATE TYPE "sites_cms"."enum_pages_blocks_spacer_variant" AS ENUM('atelier');
  CREATE TYPE "sites_cms"."enum__pages_v_blocks_hero_variant" AS ENUM('atelier');
  CREATE TYPE "sites_cms"."enum__pages_v_blocks_rich_text_variant" AS ENUM('atelier');
  CREATE TYPE "sites_cms"."enum__pages_v_blocks_media_feature_variant" AS ENUM('atelier');
  CREATE TYPE "sites_cms"."enum__pages_v_blocks_cta_variant" AS ENUM('atelier');
  CREATE TYPE "sites_cms"."enum__pages_v_blocks_offering_grid_variant" AS ENUM('atelier');
  CREATE TYPE "sites_cms"."enum__pages_v_blocks_venue_reservation_variant" AS ENUM('atelier');
  CREATE TYPE "sites_cms"."enum__pages_v_blocks_menu_link_variant" AS ENUM('atelier');
  CREATE TYPE "sites_cms"."enum__pages_v_blocks_menu_board_variant" AS ENUM('atelier');
  CREATE TYPE "sites_cms"."enum__pages_v_blocks_menu_preview_variant" AS ENUM('atelier');
  CREATE TYPE "sites_cms"."enum__pages_v_blocks_video_feature_variant" AS ENUM('atelier');
  CREATE TYPE "sites_cms"."enum__pages_v_blocks_team_variant" AS ENUM('atelier');
  CREATE TYPE "sites_cms"."enum__pages_v_blocks_gallery_variant" AS ENUM('atelier');
  CREATE TYPE "sites_cms"."enum__pages_v_blocks_hours_location_variant" AS ENUM('atelier');
  CREATE TYPE "sites_cms"."enum__pages_v_blocks_testimonials_variant" AS ENUM('atelier');
  CREATE TYPE "sites_cms"."enum__pages_v_blocks_faq_variant" AS ENUM('atelier');
  CREATE TYPE "sites_cms"."enum__pages_v_blocks_contact_handoff_variant" AS ENUM('atelier');
  CREATE TYPE "sites_cms"."enum__pages_v_blocks_marquee_variant" AS ENUM('atelier');
  CREATE TYPE "sites_cms"."enum__pages_v_blocks_stats_variant" AS ENUM('atelier');
  CREATE TYPE "sites_cms"."enum__pages_v_blocks_pull_quote_variant" AS ENUM('atelier');
  CREATE TYPE "sites_cms"."enum__pages_v_blocks_map_embed_variant" AS ENUM('atelier');
  CREATE TYPE "sites_cms"."enum__pages_v_blocks_divider_variant" AS ENUM('atelier');
  CREATE TYPE "sites_cms"."enum__pages_v_blocks_spacer_variant" AS ENUM('atelier');
  CREATE TYPE "sites_cms"."enum_site_settings_design" AS ENUM('atelier');
  CREATE TYPE "sites_cms"."enum_site_settings_radius" AS ENUM('design', 'sharp', 'soft', 'round');
  CREATE TYPE "sites_cms"."enum_site_settings_button_shape" AS ENUM('design', 'pill', 'rounded', 'square');
  CREATE TYPE "sites_cms"."enum_site_settings_motion" AS ENUM('design', 'calm', 'lively', 'none');
  CREATE TYPE "sites_cms"."enum__site_settings_v_version_design" AS ENUM('atelier');
  CREATE TYPE "sites_cms"."enum__site_settings_v_version_radius" AS ENUM('design', 'sharp', 'soft', 'round');
  CREATE TYPE "sites_cms"."enum__site_settings_v_version_button_shape" AS ENUM('design', 'pill', 'rounded', 'square');
  CREATE TYPE "sites_cms"."enum__site_settings_v_version_motion" AS ENUM('design', 'calm', 'lively', 'none');
  CREATE TYPE "sites_cms"."enum_font_assets_style" AS ENUM('normal', 'italic');
  CREATE TABLE "sites_cms"."font_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_key" varchar NOT NULL,
	"family" varchar NOT NULL,
	"weight" numeric NOT NULL,
	"style" "sites_cms"."enum_font_assets_style" NOT NULL,
	"unicode_range" varchar NOT NULL,
	"digest" varchar NOT NULL,
	"bytes" numeric NOT NULL,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );

  ALTER TABLE "sites_cms"."pages_blocks_hero" ADD COLUMN "variant" "sites_cms"."enum_pages_blocks_hero_variant" DEFAULT 'atelier';
  ALTER TABLE "sites_cms"."pages_blocks_rich_text" ADD COLUMN "variant" "sites_cms"."enum_pages_blocks_rich_text_variant" DEFAULT 'atelier';
  ALTER TABLE "sites_cms"."pages_blocks_media_feature" ADD COLUMN "variant" "sites_cms"."enum_pages_blocks_media_feature_variant" DEFAULT 'atelier';
  ALTER TABLE "sites_cms"."pages_blocks_cta" ADD COLUMN "variant" "sites_cms"."enum_pages_blocks_cta_variant" DEFAULT 'atelier';
  ALTER TABLE "sites_cms"."pages_blocks_offering_grid" ADD COLUMN "variant" "sites_cms"."enum_pages_blocks_offering_grid_variant" DEFAULT 'atelier';
  ALTER TABLE "sites_cms"."pages_blocks_venue_reservation" ADD COLUMN "variant" "sites_cms"."enum_pages_blocks_venue_reservation_variant" DEFAULT 'atelier';
  ALTER TABLE "sites_cms"."pages_blocks_menu_link" ADD COLUMN "variant" "sites_cms"."enum_pages_blocks_menu_link_variant" DEFAULT 'atelier';
  ALTER TABLE "sites_cms"."pages_blocks_menu_board" ADD COLUMN "variant" "sites_cms"."enum_pages_blocks_menu_board_variant" DEFAULT 'atelier';
  ALTER TABLE "sites_cms"."pages_blocks_menu_preview" ADD COLUMN "variant" "sites_cms"."enum_pages_blocks_menu_preview_variant" DEFAULT 'atelier';
  ALTER TABLE "sites_cms"."pages_blocks_video_feature" ADD COLUMN "variant" "sites_cms"."enum_pages_blocks_video_feature_variant" DEFAULT 'atelier';
  ALTER TABLE "sites_cms"."pages_blocks_team" ADD COLUMN "variant" "sites_cms"."enum_pages_blocks_team_variant" DEFAULT 'atelier';
  ALTER TABLE "sites_cms"."pages_blocks_gallery" ADD COLUMN "variant" "sites_cms"."enum_pages_blocks_gallery_variant" DEFAULT 'atelier';
  ALTER TABLE "sites_cms"."pages_blocks_hours_location" ADD COLUMN "variant" "sites_cms"."enum_pages_blocks_hours_location_variant" DEFAULT 'atelier';
  ALTER TABLE "sites_cms"."pages_blocks_testimonials" ADD COLUMN "variant" "sites_cms"."enum_pages_blocks_testimonials_variant" DEFAULT 'atelier';
  ALTER TABLE "sites_cms"."pages_blocks_faq" ADD COLUMN "variant" "sites_cms"."enum_pages_blocks_faq_variant" DEFAULT 'atelier';
  ALTER TABLE "sites_cms"."pages_blocks_contact_handoff" ADD COLUMN "variant" "sites_cms"."enum_pages_blocks_contact_handoff_variant" DEFAULT 'atelier';
  ALTER TABLE "sites_cms"."pages_blocks_marquee" ADD COLUMN "variant" "sites_cms"."enum_pages_blocks_marquee_variant" DEFAULT 'atelier';
  ALTER TABLE "sites_cms"."pages_blocks_stats" ADD COLUMN "variant" "sites_cms"."enum_pages_blocks_stats_variant" DEFAULT 'atelier';
  ALTER TABLE "sites_cms"."pages_blocks_pull_quote" ADD COLUMN "variant" "sites_cms"."enum_pages_blocks_pull_quote_variant" DEFAULT 'atelier';
  ALTER TABLE "sites_cms"."pages_blocks_map_embed" ADD COLUMN "variant" "sites_cms"."enum_pages_blocks_map_embed_variant" DEFAULT 'atelier';
  ALTER TABLE "sites_cms"."pages_blocks_divider" ADD COLUMN "variant" "sites_cms"."enum_pages_blocks_divider_variant" DEFAULT 'atelier';
  ALTER TABLE "sites_cms"."pages_blocks_spacer" ADD COLUMN "variant" "sites_cms"."enum_pages_blocks_spacer_variant" DEFAULT 'atelier';
  ALTER TABLE "sites_cms"."_pages_v_blocks_hero" ADD COLUMN "variant" "sites_cms"."enum__pages_v_blocks_hero_variant" DEFAULT 'atelier';
  ALTER TABLE "sites_cms"."_pages_v_blocks_rich_text" ADD COLUMN "variant" "sites_cms"."enum__pages_v_blocks_rich_text_variant" DEFAULT 'atelier';
  ALTER TABLE "sites_cms"."_pages_v_blocks_media_feature" ADD COLUMN "variant" "sites_cms"."enum__pages_v_blocks_media_feature_variant" DEFAULT 'atelier';
  ALTER TABLE "sites_cms"."_pages_v_blocks_cta" ADD COLUMN "variant" "sites_cms"."enum__pages_v_blocks_cta_variant" DEFAULT 'atelier';
  ALTER TABLE "sites_cms"."_pages_v_blocks_offering_grid" ADD COLUMN "variant" "sites_cms"."enum__pages_v_blocks_offering_grid_variant" DEFAULT 'atelier';
  ALTER TABLE "sites_cms"."_pages_v_blocks_venue_reservation" ADD COLUMN "variant" "sites_cms"."enum__pages_v_blocks_venue_reservation_variant" DEFAULT 'atelier';
  ALTER TABLE "sites_cms"."_pages_v_blocks_menu_link" ADD COLUMN "variant" "sites_cms"."enum__pages_v_blocks_menu_link_variant" DEFAULT 'atelier';
  ALTER TABLE "sites_cms"."_pages_v_blocks_menu_board" ADD COLUMN "variant" "sites_cms"."enum__pages_v_blocks_menu_board_variant" DEFAULT 'atelier';
  ALTER TABLE "sites_cms"."_pages_v_blocks_menu_preview" ADD COLUMN "variant" "sites_cms"."enum__pages_v_blocks_menu_preview_variant" DEFAULT 'atelier';
  ALTER TABLE "sites_cms"."_pages_v_blocks_video_feature" ADD COLUMN "variant" "sites_cms"."enum__pages_v_blocks_video_feature_variant" DEFAULT 'atelier';
  ALTER TABLE "sites_cms"."_pages_v_blocks_team" ADD COLUMN "variant" "sites_cms"."enum__pages_v_blocks_team_variant" DEFAULT 'atelier';
  ALTER TABLE "sites_cms"."_pages_v_blocks_gallery" ADD COLUMN "variant" "sites_cms"."enum__pages_v_blocks_gallery_variant" DEFAULT 'atelier';
  ALTER TABLE "sites_cms"."_pages_v_blocks_hours_location" ADD COLUMN "variant" "sites_cms"."enum__pages_v_blocks_hours_location_variant" DEFAULT 'atelier';
  ALTER TABLE "sites_cms"."_pages_v_blocks_testimonials" ADD COLUMN "variant" "sites_cms"."enum__pages_v_blocks_testimonials_variant" DEFAULT 'atelier';
  ALTER TABLE "sites_cms"."_pages_v_blocks_faq" ADD COLUMN "variant" "sites_cms"."enum__pages_v_blocks_faq_variant" DEFAULT 'atelier';
  ALTER TABLE "sites_cms"."_pages_v_blocks_contact_handoff" ADD COLUMN "variant" "sites_cms"."enum__pages_v_blocks_contact_handoff_variant" DEFAULT 'atelier';
  ALTER TABLE "sites_cms"."_pages_v_blocks_marquee" ADD COLUMN "variant" "sites_cms"."enum__pages_v_blocks_marquee_variant" DEFAULT 'atelier';
  ALTER TABLE "sites_cms"."_pages_v_blocks_stats" ADD COLUMN "variant" "sites_cms"."enum__pages_v_blocks_stats_variant" DEFAULT 'atelier';
  ALTER TABLE "sites_cms"."_pages_v_blocks_pull_quote" ADD COLUMN "variant" "sites_cms"."enum__pages_v_blocks_pull_quote_variant" DEFAULT 'atelier';
  ALTER TABLE "sites_cms"."_pages_v_blocks_map_embed" ADD COLUMN "variant" "sites_cms"."enum__pages_v_blocks_map_embed_variant" DEFAULT 'atelier';
  ALTER TABLE "sites_cms"."_pages_v_blocks_divider" ADD COLUMN "variant" "sites_cms"."enum__pages_v_blocks_divider_variant" DEFAULT 'atelier';
  ALTER TABLE "sites_cms"."_pages_v_blocks_spacer" ADD COLUMN "variant" "sites_cms"."enum__pages_v_blocks_spacer_variant" DEFAULT 'atelier';
  ALTER TABLE "sites_cms"."site_settings" ADD COLUMN "design" "sites_cms"."enum_site_settings_design" DEFAULT 'atelier';
  ALTER TABLE "sites_cms"."site_settings" ADD COLUMN "tokens" jsonb;
  ALTER TABLE "sites_cms"."site_settings" ADD COLUMN "fonts" jsonb;
  ALTER TABLE "sites_cms"."site_settings" ADD COLUMN "radius" "sites_cms"."enum_site_settings_radius" DEFAULT 'design';
  ALTER TABLE "sites_cms"."site_settings" ADD COLUMN "button_shape" "sites_cms"."enum_site_settings_button_shape" DEFAULT 'design';
  ALTER TABLE "sites_cms"."site_settings" ADD COLUMN "motion" "sites_cms"."enum_site_settings_motion" DEFAULT 'design';
  ALTER TABLE "sites_cms"."_site_settings_v" ADD COLUMN "version_design" "sites_cms"."enum__site_settings_v_version_design" DEFAULT 'atelier';
  ALTER TABLE "sites_cms"."_site_settings_v" ADD COLUMN "version_tokens" jsonb;
  ALTER TABLE "sites_cms"."_site_settings_v" ADD COLUMN "version_fonts" jsonb;
  ALTER TABLE "sites_cms"."_site_settings_v" ADD COLUMN "version_radius" "sites_cms"."enum__site_settings_v_version_radius" DEFAULT 'design';
  ALTER TABLE "sites_cms"."_site_settings_v" ADD COLUMN "version_button_shape" "sites_cms"."enum__site_settings_v_version_button_shape" DEFAULT 'design';
  ALTER TABLE "sites_cms"."_site_settings_v" ADD COLUMN "version_motion" "sites_cms"."enum__site_settings_v_version_motion" DEFAULT 'design';
  ALTER TABLE "sites_cms"."payload_locked_documents_rels" ADD COLUMN "font_assets_id" uuid;
  CREATE INDEX "font_assets_request_key_idx" ON "sites_cms"."font_assets" USING btree ("request_key");
  CREATE INDEX "font_assets_digest_idx" ON "sites_cms"."font_assets" USING btree ("digest");
  CREATE INDEX "font_assets_updated_at_idx" ON "sites_cms"."font_assets" USING btree ("updated_at");
  CREATE INDEX "font_assets_created_at_idx" ON "sites_cms"."font_assets" USING btree ("created_at");
  ALTER TABLE "sites_cms"."payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_font_assets_fk" FOREIGN KEY ("font_assets_id") REFERENCES "sites_cms"."font_assets"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_font_assets_id_idx" ON "sites_cms"."payload_locked_documents_rels" USING btree ("font_assets_id");
  -- #2829 W3 — carry the v1 look into tokens and fonts BEFORE the old
  -- columns go. Only valid 6-digit hex values are carried; anything else was
  -- already refused by Studio and means "design default".
  UPDATE "sites_cms"."site_settings" SET
    "tokens" = jsonb_strip_nulls(jsonb_build_object(
      'colors', jsonb_strip_nulls(jsonb_build_object(
        'canvas', CASE WHEN "background_color" ~* '^#[0-9a-f]{6}$' THEN lower("background_color") END,
        'ink_body', CASE WHEN "foreground_color" ~* '^#[0-9a-f]{6}$' THEN lower("foreground_color") END,
        'accent', CASE WHEN "accent_color" ~* '^#[0-9a-f]{6}$'
          THEN jsonb_build_object('steps', jsonb_build_object('400', lower("accent_color"))) END
      )),
      'heading_case', CASE "typography"::text
        WHEN 'condensed-display' THEN 'uppercase'
        WHEN 'modern-sans' THEN 'none'
        WHEN 'editorial-serif' THEN 'none' END
    )),
    "fonts" = CASE "typography"::text
      WHEN 'modern-sans' THEN '{"display":{"family":"Plus Jakarta Sans","source":"google"},"body":{"family":"Plus Jakarta Sans","source":"google"}}'::jsonb
      WHEN 'editorial-serif' THEN '{"display":{"family":"Playfair Display","source":"google"},"body":{"family":"Plus Jakarta Sans","source":"google"}}'::jsonb
      ELSE NULL END;
  UPDATE "sites_cms"."_site_settings_v" SET
    "version_tokens" = jsonb_strip_nulls(jsonb_build_object(
      'colors', jsonb_strip_nulls(jsonb_build_object(
        'canvas', CASE WHEN "version_background_color" ~* '^#[0-9a-f]{6}$' THEN lower("version_background_color") END,
        'ink_body', CASE WHEN "version_foreground_color" ~* '^#[0-9a-f]{6}$' THEN lower("version_foreground_color") END,
        'accent', CASE WHEN "version_accent_color" ~* '^#[0-9a-f]{6}$'
          THEN jsonb_build_object('steps', jsonb_build_object('400', lower("version_accent_color"))) END
      )),
      'heading_case', CASE "version_typography"::text
        WHEN 'condensed-display' THEN 'uppercase'
        WHEN 'modern-sans' THEN 'none'
        WHEN 'editorial-serif' THEN 'none' END
    )),
    "version_fonts" = CASE "version_typography"::text
      WHEN 'modern-sans' THEN '{"display":{"family":"Plus Jakarta Sans","source":"google"},"body":{"family":"Plus Jakarta Sans","source":"google"}}'::jsonb
      WHEN 'editorial-serif' THEN '{"display":{"family":"Playfair Display","source":"google"},"body":{"family":"Plus Jakarta Sans","source":"google"}}'::jsonb
      ELSE NULL END;
  ALTER TABLE "sites_cms"."site_settings" DROP COLUMN "background_color";
  ALTER TABLE "sites_cms"."site_settings" DROP COLUMN "foreground_color";
  ALTER TABLE "sites_cms"."site_settings" DROP COLUMN "accent_color";
  ALTER TABLE "sites_cms"."site_settings" DROP COLUMN "typography";
  ALTER TABLE "sites_cms"."_site_settings_v" DROP COLUMN "version_background_color";
  ALTER TABLE "sites_cms"."_site_settings_v" DROP COLUMN "version_foreground_color";
  ALTER TABLE "sites_cms"."_site_settings_v" DROP COLUMN "version_accent_color";
  ALTER TABLE "sites_cms"."_site_settings_v" DROP COLUMN "version_typography";
  DROP TYPE "sites_cms"."enum_site_settings_typography";
  DROP TYPE "sites_cms"."enum__site_settings_v_version_typography";`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "sites_cms"."enum_site_settings_typography" AS ENUM('condensed-display', 'modern-sans', 'editorial-serif');
  CREATE TYPE "sites_cms"."enum__site_settings_v_version_typography" AS ENUM('condensed-display', 'modern-sans', 'editorial-serif');
  ALTER TABLE "sites_cms"."font_assets" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "sites_cms"."font_assets" CASCADE;
  ALTER TABLE "sites_cms"."payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_font_assets_fk";

  DROP INDEX "sites_cms"."payload_locked_documents_rels_font_assets_id_idx";
  ALTER TABLE "sites_cms"."site_settings" ADD COLUMN "background_color" varchar;
  ALTER TABLE "sites_cms"."site_settings" ADD COLUMN "foreground_color" varchar;
  ALTER TABLE "sites_cms"."site_settings" ADD COLUMN "accent_color" varchar;
  ALTER TABLE "sites_cms"."site_settings" ADD COLUMN "typography" "sites_cms"."enum_site_settings_typography" DEFAULT 'condensed-display';
  ALTER TABLE "sites_cms"."_site_settings_v" ADD COLUMN "version_background_color" varchar;
  ALTER TABLE "sites_cms"."_site_settings_v" ADD COLUMN "version_foreground_color" varchar;
  ALTER TABLE "sites_cms"."_site_settings_v" ADD COLUMN "version_accent_color" varchar;
  ALTER TABLE "sites_cms"."_site_settings_v" ADD COLUMN "version_typography" "sites_cms"."enum__site_settings_v_version_typography" DEFAULT 'condensed-display';
  -- #2829 W3 — put the owner's colours and pairing back into the v1 fields.
  UPDATE "sites_cms"."site_settings" SET
    "background_color" = "tokens"#>>'{colors,canvas}',
    "foreground_color" = "tokens"#>>'{colors,ink_body}',
    "accent_color" = "tokens"#>>'{colors,accent,steps,400}',
    "typography" = (CASE
      WHEN "fonts"#>>'{display,family}' = 'Playfair Display' THEN 'editorial-serif'
      WHEN "fonts"#>>'{display,family}' = 'Plus Jakarta Sans' THEN 'modern-sans'
      ELSE 'condensed-display' END)::"sites_cms"."enum_site_settings_typography";
  UPDATE "sites_cms"."_site_settings_v" SET
    "version_background_color" = "version_tokens"#>>'{colors,canvas}',
    "version_foreground_color" = "version_tokens"#>>'{colors,ink_body}',
    "version_accent_color" = "version_tokens"#>>'{colors,accent,steps,400}',
    "version_typography" = (CASE
      WHEN "version_fonts"#>>'{display,family}' = 'Playfair Display' THEN 'editorial-serif'
      WHEN "version_fonts"#>>'{display,family}' = 'Plus Jakarta Sans' THEN 'modern-sans'
      ELSE 'condensed-display' END)::"sites_cms"."enum__site_settings_v_version_typography";
  ALTER TABLE "sites_cms"."pages_blocks_hero" DROP COLUMN "variant";
  ALTER TABLE "sites_cms"."pages_blocks_rich_text" DROP COLUMN "variant";
  ALTER TABLE "sites_cms"."pages_blocks_media_feature" DROP COLUMN "variant";
  ALTER TABLE "sites_cms"."pages_blocks_cta" DROP COLUMN "variant";
  ALTER TABLE "sites_cms"."pages_blocks_offering_grid" DROP COLUMN "variant";
  ALTER TABLE "sites_cms"."pages_blocks_venue_reservation" DROP COLUMN "variant";
  ALTER TABLE "sites_cms"."pages_blocks_menu_link" DROP COLUMN "variant";
  ALTER TABLE "sites_cms"."pages_blocks_menu_board" DROP COLUMN "variant";
  ALTER TABLE "sites_cms"."pages_blocks_menu_preview" DROP COLUMN "variant";
  ALTER TABLE "sites_cms"."pages_blocks_video_feature" DROP COLUMN "variant";
  ALTER TABLE "sites_cms"."pages_blocks_team" DROP COLUMN "variant";
  ALTER TABLE "sites_cms"."pages_blocks_gallery" DROP COLUMN "variant";
  ALTER TABLE "sites_cms"."pages_blocks_hours_location" DROP COLUMN "variant";
  ALTER TABLE "sites_cms"."pages_blocks_testimonials" DROP COLUMN "variant";
  ALTER TABLE "sites_cms"."pages_blocks_faq" DROP COLUMN "variant";
  ALTER TABLE "sites_cms"."pages_blocks_contact_handoff" DROP COLUMN "variant";
  ALTER TABLE "sites_cms"."pages_blocks_marquee" DROP COLUMN "variant";
  ALTER TABLE "sites_cms"."pages_blocks_stats" DROP COLUMN "variant";
  ALTER TABLE "sites_cms"."pages_blocks_pull_quote" DROP COLUMN "variant";
  ALTER TABLE "sites_cms"."pages_blocks_map_embed" DROP COLUMN "variant";
  ALTER TABLE "sites_cms"."pages_blocks_divider" DROP COLUMN "variant";
  ALTER TABLE "sites_cms"."pages_blocks_spacer" DROP COLUMN "variant";
  ALTER TABLE "sites_cms"."_pages_v_blocks_hero" DROP COLUMN "variant";
  ALTER TABLE "sites_cms"."_pages_v_blocks_rich_text" DROP COLUMN "variant";
  ALTER TABLE "sites_cms"."_pages_v_blocks_media_feature" DROP COLUMN "variant";
  ALTER TABLE "sites_cms"."_pages_v_blocks_cta" DROP COLUMN "variant";
  ALTER TABLE "sites_cms"."_pages_v_blocks_offering_grid" DROP COLUMN "variant";
  ALTER TABLE "sites_cms"."_pages_v_blocks_venue_reservation" DROP COLUMN "variant";
  ALTER TABLE "sites_cms"."_pages_v_blocks_menu_link" DROP COLUMN "variant";
  ALTER TABLE "sites_cms"."_pages_v_blocks_menu_board" DROP COLUMN "variant";
  ALTER TABLE "sites_cms"."_pages_v_blocks_menu_preview" DROP COLUMN "variant";
  ALTER TABLE "sites_cms"."_pages_v_blocks_video_feature" DROP COLUMN "variant";
  ALTER TABLE "sites_cms"."_pages_v_blocks_team" DROP COLUMN "variant";
  ALTER TABLE "sites_cms"."_pages_v_blocks_gallery" DROP COLUMN "variant";
  ALTER TABLE "sites_cms"."_pages_v_blocks_hours_location" DROP COLUMN "variant";
  ALTER TABLE "sites_cms"."_pages_v_blocks_testimonials" DROP COLUMN "variant";
  ALTER TABLE "sites_cms"."_pages_v_blocks_faq" DROP COLUMN "variant";
  ALTER TABLE "sites_cms"."_pages_v_blocks_contact_handoff" DROP COLUMN "variant";
  ALTER TABLE "sites_cms"."_pages_v_blocks_marquee" DROP COLUMN "variant";
  ALTER TABLE "sites_cms"."_pages_v_blocks_stats" DROP COLUMN "variant";
  ALTER TABLE "sites_cms"."_pages_v_blocks_pull_quote" DROP COLUMN "variant";
  ALTER TABLE "sites_cms"."_pages_v_blocks_map_embed" DROP COLUMN "variant";
  ALTER TABLE "sites_cms"."_pages_v_blocks_divider" DROP COLUMN "variant";
  ALTER TABLE "sites_cms"."_pages_v_blocks_spacer" DROP COLUMN "variant";
  ALTER TABLE "sites_cms"."site_settings" DROP COLUMN "design";
  ALTER TABLE "sites_cms"."site_settings" DROP COLUMN "tokens";
  ALTER TABLE "sites_cms"."site_settings" DROP COLUMN "fonts";
  ALTER TABLE "sites_cms"."site_settings" DROP COLUMN "radius";
  ALTER TABLE "sites_cms"."site_settings" DROP COLUMN "button_shape";
  ALTER TABLE "sites_cms"."site_settings" DROP COLUMN "motion";
  ALTER TABLE "sites_cms"."_site_settings_v" DROP COLUMN "version_design";
  ALTER TABLE "sites_cms"."_site_settings_v" DROP COLUMN "version_tokens";
  ALTER TABLE "sites_cms"."_site_settings_v" DROP COLUMN "version_fonts";
  ALTER TABLE "sites_cms"."_site_settings_v" DROP COLUMN "version_radius";
  ALTER TABLE "sites_cms"."_site_settings_v" DROP COLUMN "version_button_shape";
  ALTER TABLE "sites_cms"."_site_settings_v" DROP COLUMN "version_motion";
  ALTER TABLE "sites_cms"."payload_locked_documents_rels" DROP COLUMN "font_assets_id";
  DROP TYPE "sites_cms"."enum_pages_blocks_hero_variant";
  DROP TYPE "sites_cms"."enum_pages_blocks_rich_text_variant";
  DROP TYPE "sites_cms"."enum_pages_blocks_media_feature_variant";
  DROP TYPE "sites_cms"."enum_pages_blocks_cta_variant";
  DROP TYPE "sites_cms"."enum_pages_blocks_offering_grid_variant";
  DROP TYPE "sites_cms"."enum_pages_blocks_venue_reservation_variant";
  DROP TYPE "sites_cms"."enum_pages_blocks_menu_link_variant";
  DROP TYPE "sites_cms"."enum_pages_blocks_menu_board_variant";
  DROP TYPE "sites_cms"."enum_pages_blocks_menu_preview_variant";
  DROP TYPE "sites_cms"."enum_pages_blocks_video_feature_variant";
  DROP TYPE "sites_cms"."enum_pages_blocks_team_variant";
  DROP TYPE "sites_cms"."enum_pages_blocks_gallery_variant";
  DROP TYPE "sites_cms"."enum_pages_blocks_hours_location_variant";
  DROP TYPE "sites_cms"."enum_pages_blocks_testimonials_variant";
  DROP TYPE "sites_cms"."enum_pages_blocks_faq_variant";
  DROP TYPE "sites_cms"."enum_pages_blocks_contact_handoff_variant";
  DROP TYPE "sites_cms"."enum_pages_blocks_marquee_variant";
  DROP TYPE "sites_cms"."enum_pages_blocks_stats_variant";
  DROP TYPE "sites_cms"."enum_pages_blocks_pull_quote_variant";
  DROP TYPE "sites_cms"."enum_pages_blocks_map_embed_variant";
  DROP TYPE "sites_cms"."enum_pages_blocks_divider_variant";
  DROP TYPE "sites_cms"."enum_pages_blocks_spacer_variant";
  DROP TYPE "sites_cms"."enum__pages_v_blocks_hero_variant";
  DROP TYPE "sites_cms"."enum__pages_v_blocks_rich_text_variant";
  DROP TYPE "sites_cms"."enum__pages_v_blocks_media_feature_variant";
  DROP TYPE "sites_cms"."enum__pages_v_blocks_cta_variant";
  DROP TYPE "sites_cms"."enum__pages_v_blocks_offering_grid_variant";
  DROP TYPE "sites_cms"."enum__pages_v_blocks_venue_reservation_variant";
  DROP TYPE "sites_cms"."enum__pages_v_blocks_menu_link_variant";
  DROP TYPE "sites_cms"."enum__pages_v_blocks_menu_board_variant";
  DROP TYPE "sites_cms"."enum__pages_v_blocks_menu_preview_variant";
  DROP TYPE "sites_cms"."enum__pages_v_blocks_video_feature_variant";
  DROP TYPE "sites_cms"."enum__pages_v_blocks_team_variant";
  DROP TYPE "sites_cms"."enum__pages_v_blocks_gallery_variant";
  DROP TYPE "sites_cms"."enum__pages_v_blocks_hours_location_variant";
  DROP TYPE "sites_cms"."enum__pages_v_blocks_testimonials_variant";
  DROP TYPE "sites_cms"."enum__pages_v_blocks_faq_variant";
  DROP TYPE "sites_cms"."enum__pages_v_blocks_contact_handoff_variant";
  DROP TYPE "sites_cms"."enum__pages_v_blocks_marquee_variant";
  DROP TYPE "sites_cms"."enum__pages_v_blocks_stats_variant";
  DROP TYPE "sites_cms"."enum__pages_v_blocks_pull_quote_variant";
  DROP TYPE "sites_cms"."enum__pages_v_blocks_map_embed_variant";
  DROP TYPE "sites_cms"."enum__pages_v_blocks_divider_variant";
  DROP TYPE "sites_cms"."enum__pages_v_blocks_spacer_variant";
  DROP TYPE "sites_cms"."enum_site_settings_design";
  DROP TYPE "sites_cms"."enum_site_settings_radius";
  DROP TYPE "sites_cms"."enum_site_settings_button_shape";
  DROP TYPE "sites_cms"."enum_site_settings_motion";
  DROP TYPE "sites_cms"."enum__site_settings_v_version_design";
  DROP TYPE "sites_cms"."enum__site_settings_v_version_radius";
  DROP TYPE "sites_cms"."enum__site_settings_v_version_button_shape";
  DROP TYPE "sites_cms"."enum__site_settings_v_version_motion";
  DROP TYPE "sites_cms"."enum_font_assets_style";`)
}
