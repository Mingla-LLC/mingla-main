import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/*
 * #4453 PR 6a (designs: Nocturne, Haven, Maison) — Studio's half of the
 * three new designs:
 * - the design keys join SiteSettings' design enum, live and versioned
 *   (Core's brand_site_design_keys() returns the same five; a test pins the
 *   two together, SC-D1);
 * - every layout the three designs offer that no earlier design offered
 *   joins each block's variant enum, on the live table AND the version table
 *   (`_pages_v`), exactly the values site-contracts NOCTURNE / HAVEN / MAISON
 *   add (the design-neutral layout, the other shared layouts, and Maison's
 *   three signature layouts).
 * The header and footer enums already hold every shared layout.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  ALTER TYPE "sites_cms"."enum_site_settings_design" ADD VALUE IF NOT EXISTS 'nocturne';
  ALTER TYPE "sites_cms"."enum_site_settings_design" ADD VALUE IF NOT EXISTS 'haven';
  ALTER TYPE "sites_cms"."enum_site_settings_design" ADD VALUE IF NOT EXISTS 'maison';
  ALTER TYPE "sites_cms"."enum__site_settings_v_version_design" ADD VALUE IF NOT EXISTS 'nocturne';
  ALTER TYPE "sites_cms"."enum__site_settings_v_version_design" ADD VALUE IF NOT EXISTS 'haven';
  ALTER TYPE "sites_cms"."enum__site_settings_v_version_design" ADD VALUE IF NOT EXISTS 'maison';
  ALTER TYPE "sites_cms"."enum_pages_blocks_hero_variant" ADD VALUE IF NOT EXISTS 'editorial';
  ALTER TYPE "sites_cms"."enum_pages_blocks_hero_variant" ADD VALUE IF NOT EXISTS 'arch';
  ALTER TYPE "sites_cms"."enum_pages_blocks_hero_variant" ADD VALUE IF NOT EXISTS 'maison-frame';
  ALTER TYPE "sites_cms"."enum_pages_blocks_media_feature_variant" ADD VALUE IF NOT EXISTS 'neutral';
  ALTER TYPE "sites_cms"."enum_pages_blocks_cta_variant" ADD VALUE IF NOT EXISTS 'neutral';
  ALTER TYPE "sites_cms"."enum_pages_blocks_offering_grid_variant" ADD VALUE IF NOT EXISTS 'list';
  ALTER TYPE "sites_cms"."enum_pages_blocks_offering_grid_variant" ADD VALUE IF NOT EXISTS 'cards';
  ALTER TYPE "sites_cms"."enum_pages_blocks_offering_grid_variant" ADD VALUE IF NOT EXISTS 'maison-rows';
  ALTER TYPE "sites_cms"."enum_pages_blocks_gallery_variant" ADD VALUE IF NOT EXISTS 'pinned';
  ALTER TYPE "sites_cms"."enum_pages_blocks_gallery_variant" ADD VALUE IF NOT EXISTS 'stagger';
  ALTER TYPE "sites_cms"."enum_pages_blocks_gallery_variant" ADD VALUE IF NOT EXISTS 'maison-plates';
  ALTER TYPE "sites_cms"."enum_pages_blocks_video_feature_variant" ADD VALUE IF NOT EXISTS 'neutral';
  ALTER TYPE "sites_cms"."enum_pages_blocks_team_variant" ADD VALUE IF NOT EXISTS 'neutral';
  ALTER TYPE "sites_cms"."enum_pages_blocks_testimonials_variant" ADD VALUE IF NOT EXISTS 'wall';
  ALTER TYPE "sites_cms"."enum_pages_blocks_testimonials_variant" ADD VALUE IF NOT EXISTS 'switcher';
  ALTER TYPE "sites_cms"."enum_pages_blocks_divider_variant" ADD VALUE IF NOT EXISTS 'neutral';
  ALTER TYPE "sites_cms"."enum_pages_blocks_spacer_variant" ADD VALUE IF NOT EXISTS 'neutral';
  ALTER TYPE "sites_cms"."enum_pages_blocks_pull_quote_variant" ADD VALUE IF NOT EXISTS 'neutral';
  ALTER TYPE "sites_cms"."enum_pages_blocks_stats_variant" ADD VALUE IF NOT EXISTS 'neutral';
  ALTER TYPE "sites_cms"."enum_pages_blocks_map_embed_variant" ADD VALUE IF NOT EXISTS 'neutral';
  ALTER TYPE "sites_cms"."enum_pages_blocks_destination_grid_variant" ADD VALUE IF NOT EXISTS 'tiles';
  ALTER TYPE "sites_cms"."enum_pages_blocks_offering_history_variant" ADD VALUE IF NOT EXISTS 'split';
  ALTER TYPE "sites_cms"."enum_pages_blocks_feature_cards_variant" ADD VALUE IF NOT EXISTS 'numbered';
  ALTER TYPE "sites_cms"."enum_pages_blocks_feature_cards_variant" ADD VALUE IF NOT EXISTS 'tiles';
  ALTER TYPE "sites_cms"."enum__pages_v_blocks_hero_variant" ADD VALUE IF NOT EXISTS 'editorial';
  ALTER TYPE "sites_cms"."enum__pages_v_blocks_hero_variant" ADD VALUE IF NOT EXISTS 'arch';
  ALTER TYPE "sites_cms"."enum__pages_v_blocks_hero_variant" ADD VALUE IF NOT EXISTS 'maison-frame';
  ALTER TYPE "sites_cms"."enum__pages_v_blocks_media_feature_variant" ADD VALUE IF NOT EXISTS 'neutral';
  ALTER TYPE "sites_cms"."enum__pages_v_blocks_cta_variant" ADD VALUE IF NOT EXISTS 'neutral';
  ALTER TYPE "sites_cms"."enum__pages_v_blocks_offering_grid_variant" ADD VALUE IF NOT EXISTS 'list';
  ALTER TYPE "sites_cms"."enum__pages_v_blocks_offering_grid_variant" ADD VALUE IF NOT EXISTS 'cards';
  ALTER TYPE "sites_cms"."enum__pages_v_blocks_offering_grid_variant" ADD VALUE IF NOT EXISTS 'maison-rows';
  ALTER TYPE "sites_cms"."enum__pages_v_blocks_gallery_variant" ADD VALUE IF NOT EXISTS 'pinned';
  ALTER TYPE "sites_cms"."enum__pages_v_blocks_gallery_variant" ADD VALUE IF NOT EXISTS 'stagger';
  ALTER TYPE "sites_cms"."enum__pages_v_blocks_gallery_variant" ADD VALUE IF NOT EXISTS 'maison-plates';
  ALTER TYPE "sites_cms"."enum__pages_v_blocks_video_feature_variant" ADD VALUE IF NOT EXISTS 'neutral';
  ALTER TYPE "sites_cms"."enum__pages_v_blocks_team_variant" ADD VALUE IF NOT EXISTS 'neutral';
  ALTER TYPE "sites_cms"."enum__pages_v_blocks_testimonials_variant" ADD VALUE IF NOT EXISTS 'wall';
  ALTER TYPE "sites_cms"."enum__pages_v_blocks_testimonials_variant" ADD VALUE IF NOT EXISTS 'switcher';
  ALTER TYPE "sites_cms"."enum__pages_v_blocks_divider_variant" ADD VALUE IF NOT EXISTS 'neutral';
  ALTER TYPE "sites_cms"."enum__pages_v_blocks_spacer_variant" ADD VALUE IF NOT EXISTS 'neutral';
  ALTER TYPE "sites_cms"."enum__pages_v_blocks_pull_quote_variant" ADD VALUE IF NOT EXISTS 'neutral';
  ALTER TYPE "sites_cms"."enum__pages_v_blocks_stats_variant" ADD VALUE IF NOT EXISTS 'neutral';
  ALTER TYPE "sites_cms"."enum__pages_v_blocks_map_embed_variant" ADD VALUE IF NOT EXISTS 'neutral';
  ALTER TYPE "sites_cms"."enum__pages_v_blocks_destination_grid_variant" ADD VALUE IF NOT EXISTS 'tiles';
  ALTER TYPE "sites_cms"."enum__pages_v_blocks_offering_history_variant" ADD VALUE IF NOT EXISTS 'split';
  ALTER TYPE "sites_cms"."enum__pages_v_blocks_feature_cards_variant" ADD VALUE IF NOT EXISTS 'numbered';
  ALTER TYPE "sites_cms"."enum__pages_v_blocks_feature_cards_variant" ADD VALUE IF NOT EXISTS 'tiles';
  `)
}

/* Postgres cannot drop an enum value; the added keys and layouts stay (no stored site or block may use them after a down). */
export async function down(_args: MigrateDownArgs): Promise<void> {}
