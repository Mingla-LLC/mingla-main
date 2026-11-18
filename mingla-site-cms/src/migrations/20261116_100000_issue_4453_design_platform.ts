import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/*
 * #4453 PR 4 (design platform + Voyage) — Studio's half of the design keys
 * and layouts:
 * - voyage's new shared layouts join each block's variant enum, on the live
 *   table AND the version table (`_pages_v`), exactly the values
 *   site-contracts VOYAGE_VARIANTS adds (a test pins the two together);
 * - the shared header and footer layouts (`header_variant` on Navigation,
 *   `footer_variant` on Footer), live and versioned.
 * No design key is added: Core's brand_site_design_keys() returns atelier and
 * voyage, which SiteSettings already holds.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  ALTER TYPE "sites_cms"."enum_pages_blocks_hero_variant" ADD VALUE IF NOT EXISTS 'fullbleed';
  ALTER TYPE "sites_cms"."enum_pages_blocks_offering_grid_variant" ADD VALUE IF NOT EXISTS 'poster';
  ALTER TYPE "sites_cms"."enum_pages_blocks_offering_history_variant" ADD VALUE IF NOT EXISTS 'ledger-count';
  ALTER TYPE "sites_cms"."enum_pages_blocks_testimonials_variant" ADD VALUE IF NOT EXISTS 'rail';
  ALTER TYPE "sites_cms"."enum_pages_blocks_rich_text_variant" ADD VALUE IF NOT EXISTS 'manifesto';
  ALTER TYPE "sites_cms"."enum_pages_blocks_faq_variant" ADD VALUE IF NOT EXISTS 'split';
  ALTER TYPE "sites_cms"."enum_pages_blocks_newsletter_signup_variant" ADD VALUE IF NOT EXISTS 'photo';
  ALTER TYPE "sites_cms"."enum_pages_blocks_gallery_variant" ADD VALUE IF NOT EXISTS 'mosaic';
  ALTER TYPE "sites_cms"."enum_pages_blocks_menu_board_variant" ADD VALUE IF NOT EXISTS 'columns';
  ALTER TYPE "sites_cms"."enum_pages_blocks_hours_location_variant" ADD VALUE IF NOT EXISTS 'split';
  ALTER TYPE "sites_cms"."enum_pages_blocks_marquee_variant" ADD VALUE IF NOT EXISTS 'ticker';
  ALTER TYPE "sites_cms"."enum__pages_v_blocks_hero_variant" ADD VALUE IF NOT EXISTS 'fullbleed';
  ALTER TYPE "sites_cms"."enum__pages_v_blocks_offering_grid_variant" ADD VALUE IF NOT EXISTS 'poster';
  ALTER TYPE "sites_cms"."enum__pages_v_blocks_offering_history_variant" ADD VALUE IF NOT EXISTS 'ledger-count';
  ALTER TYPE "sites_cms"."enum__pages_v_blocks_testimonials_variant" ADD VALUE IF NOT EXISTS 'rail';
  ALTER TYPE "sites_cms"."enum__pages_v_blocks_rich_text_variant" ADD VALUE IF NOT EXISTS 'manifesto';
  ALTER TYPE "sites_cms"."enum__pages_v_blocks_faq_variant" ADD VALUE IF NOT EXISTS 'split';
  ALTER TYPE "sites_cms"."enum__pages_v_blocks_newsletter_signup_variant" ADD VALUE IF NOT EXISTS 'photo';
  ALTER TYPE "sites_cms"."enum__pages_v_blocks_gallery_variant" ADD VALUE IF NOT EXISTS 'mosaic';
  ALTER TYPE "sites_cms"."enum__pages_v_blocks_menu_board_variant" ADD VALUE IF NOT EXISTS 'columns';
  ALTER TYPE "sites_cms"."enum__pages_v_blocks_hours_location_variant" ADD VALUE IF NOT EXISTS 'split';
  ALTER TYPE "sites_cms"."enum__pages_v_blocks_marquee_variant" ADD VALUE IF NOT EXISTS 'ticker';
  CREATE TYPE "sites_cms"."enum_navigation_header_variant" AS ENUM('glass', 'center', 'pill');
  CREATE TYPE "sites_cms"."enum__navigation_v_version_header_variant" AS ENUM('glass', 'center', 'pill');
  CREATE TYPE "sites_cms"."enum_footer_footer_variant" AS ENUM('giant', 'columns');
  CREATE TYPE "sites_cms"."enum__footer_v_version_footer_variant" AS ENUM('giant', 'columns');
  ALTER TABLE "sites_cms"."navigation" ADD COLUMN "header_variant" "sites_cms"."enum_navigation_header_variant";
  ALTER TABLE "sites_cms"."_navigation_v" ADD COLUMN "version_header_variant" "sites_cms"."enum__navigation_v_version_header_variant";
  ALTER TABLE "sites_cms"."footer" ADD COLUMN "footer_variant" "sites_cms"."enum_footer_footer_variant";
  ALTER TABLE "sites_cms"."_footer_v" ADD COLUMN "version_footer_variant" "sites_cms"."enum__footer_v_version_footer_variant";
  `)
}

/* Postgres cannot drop an enum value; the added layouts stay (no stored block may use them after a down). */
export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "sites_cms"."navigation" DROP COLUMN IF EXISTS "header_variant";
  ALTER TABLE "sites_cms"."_navigation_v" DROP COLUMN IF EXISTS "version_header_variant";
  ALTER TABLE "sites_cms"."footer" DROP COLUMN IF EXISTS "footer_variant";
  ALTER TABLE "sites_cms"."_footer_v" DROP COLUMN IF EXISTS "version_footer_variant";
  DROP TYPE IF EXISTS "sites_cms"."enum_navigation_header_variant";
  DROP TYPE IF EXISTS "sites_cms"."enum__navigation_v_version_header_variant";
  DROP TYPE IF EXISTS "sites_cms"."enum_footer_footer_variant";
  DROP TYPE IF EXISTS "sites_cms"."enum__footer_v_version_footer_variant";
  `)
}
