import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/*
 * #4453 PR 6b (designs: Journal, Grid, Terra) — Studio's half of the three
 * new designs:
 * - the design keys join SiteSettings' design enum, live and versioned
 *   (Core's brand_site_design_keys() returns the same eight; a test pins the
 *   two together, SC-D1);
 * - the two signature headers (`journal-mast`, `grid-bar`) join the
 *   Navigation header enum, live and versioned;
 * - every layout the three designs offer that no earlier design offered
 *   joins each block's variant enum, on the live table AND the version table
 *   (`_pages_v`): exactly Journal's five, Grid's and Terra's signature
 *   layouts (every shared layout they offer is already there from 6a).
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  ALTER TYPE "sites_cms"."enum_site_settings_design" ADD VALUE IF NOT EXISTS 'journal';
  ALTER TYPE "sites_cms"."enum_site_settings_design" ADD VALUE IF NOT EXISTS 'grid';
  ALTER TYPE "sites_cms"."enum_site_settings_design" ADD VALUE IF NOT EXISTS 'terra';
  ALTER TYPE "sites_cms"."enum__site_settings_v_version_design" ADD VALUE IF NOT EXISTS 'journal';
  ALTER TYPE "sites_cms"."enum__site_settings_v_version_design" ADD VALUE IF NOT EXISTS 'grid';
  ALTER TYPE "sites_cms"."enum__site_settings_v_version_design" ADD VALUE IF NOT EXISTS 'terra';
  ALTER TYPE "sites_cms"."enum_pages_blocks_hero_variant" ADD VALUE IF NOT EXISTS 'journal-front';
  ALTER TYPE "sites_cms"."enum_pages_blocks_offering_grid_variant" ADD VALUE IF NOT EXISTS 'journal-columns';
  ALTER TYPE "sites_cms"."enum_pages_blocks_gallery_variant" ADD VALUE IF NOT EXISTS 'journal-essay';
  ALTER TYPE "sites_cms"."enum_pages_blocks_testimonials_variant" ADD VALUE IF NOT EXISTS 'journal-letters';
  ALTER TYPE "sites_cms"."enum_pages_blocks_newsletter_signup_variant" ADD VALUE IF NOT EXISTS 'journal-coupon';
  ALTER TYPE "sites_cms"."enum_pages_blocks_hero_variant" ADD VALUE IF NOT EXISTS 'grid-index';
  ALTER TYPE "sites_cms"."enum_pages_blocks_hero_variant" ADD VALUE IF NOT EXISTS 'terra-pebble';
  ALTER TYPE "sites_cms"."enum_navigation_header_variant" ADD VALUE IF NOT EXISTS 'journal-mast';
  ALTER TYPE "sites_cms"."enum_navigation_header_variant" ADD VALUE IF NOT EXISTS 'grid-bar';
  ALTER TYPE "sites_cms"."enum__navigation_v_version_header_variant" ADD VALUE IF NOT EXISTS 'journal-mast';
  ALTER TYPE "sites_cms"."enum__navigation_v_version_header_variant" ADD VALUE IF NOT EXISTS 'grid-bar';
  ALTER TYPE "sites_cms"."enum__pages_v_blocks_hero_variant" ADD VALUE IF NOT EXISTS 'journal-front';
  ALTER TYPE "sites_cms"."enum__pages_v_blocks_offering_grid_variant" ADD VALUE IF NOT EXISTS 'journal-columns';
  ALTER TYPE "sites_cms"."enum__pages_v_blocks_gallery_variant" ADD VALUE IF NOT EXISTS 'journal-essay';
  ALTER TYPE "sites_cms"."enum__pages_v_blocks_testimonials_variant" ADD VALUE IF NOT EXISTS 'journal-letters';
  ALTER TYPE "sites_cms"."enum__pages_v_blocks_newsletter_signup_variant" ADD VALUE IF NOT EXISTS 'journal-coupon';
  ALTER TYPE "sites_cms"."enum__pages_v_blocks_hero_variant" ADD VALUE IF NOT EXISTS 'grid-index';
  ALTER TYPE "sites_cms"."enum__pages_v_blocks_hero_variant" ADD VALUE IF NOT EXISTS 'terra-pebble';
  `)
}

/* Postgres cannot drop an enum value; the added keys and layouts stay (no stored site or block may use them after a down). */
export async function down(_args: MigrateDownArgs): Promise<void> {}
