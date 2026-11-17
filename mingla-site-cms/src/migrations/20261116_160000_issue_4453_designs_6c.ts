import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/*
 * #4453 PR 6c (designs: Pop, Sunset, Pulse) — Studio's half of the three new
 * designs:
 * - the design keys join SiteSettings' design enum, live and versioned
 *   (Core's brand_site_design_keys() returns the same ten; a test pins the
 *   two together, SC-D1);
 * - each design's signature hero (`pop-stack`, `sunset-sun`, `pulse-stage`)
 *   joins the hero variant enum, on the live table AND the version table
 *   (`_pages_v`). Every shared layout they offer is already there from 6a,
 *   and they use the existing header and footer layouts.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  ALTER TYPE "sites_cms"."enum_site_settings_design" ADD VALUE IF NOT EXISTS 'pop';
  ALTER TYPE "sites_cms"."enum_site_settings_design" ADD VALUE IF NOT EXISTS 'sunset';
  ALTER TYPE "sites_cms"."enum_site_settings_design" ADD VALUE IF NOT EXISTS 'pulse';
  ALTER TYPE "sites_cms"."enum__site_settings_v_version_design" ADD VALUE IF NOT EXISTS 'pop';
  ALTER TYPE "sites_cms"."enum__site_settings_v_version_design" ADD VALUE IF NOT EXISTS 'sunset';
  ALTER TYPE "sites_cms"."enum__site_settings_v_version_design" ADD VALUE IF NOT EXISTS 'pulse';
  ALTER TYPE "sites_cms"."enum_pages_blocks_hero_variant" ADD VALUE IF NOT EXISTS 'pop-stack';
  ALTER TYPE "sites_cms"."enum_pages_blocks_hero_variant" ADD VALUE IF NOT EXISTS 'sunset-sun';
  ALTER TYPE "sites_cms"."enum_pages_blocks_hero_variant" ADD VALUE IF NOT EXISTS 'pulse-stage';
  ALTER TYPE "sites_cms"."enum__pages_v_blocks_hero_variant" ADD VALUE IF NOT EXISTS 'pop-stack';
  ALTER TYPE "sites_cms"."enum__pages_v_blocks_hero_variant" ADD VALUE IF NOT EXISTS 'sunset-sun';
  ALTER TYPE "sites_cms"."enum__pages_v_blocks_hero_variant" ADD VALUE IF NOT EXISTS 'pulse-stage';
  `)
}

/* Postgres cannot drop an enum value; the added keys and layouts stay (no stored site or block may use them after a down). */
export async function down(_args: MigrateDownArgs): Promise<void> {}
