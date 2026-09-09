import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/*
 * #3149 — the eyebrow, and a heading for a run of films.
 *
 * A block had nowhere to store the brand's own line above a heading, so the
 * renderer emitted a generic label for it ("Gallery", "Film", "Team"). These
 * columns are what let a brand supply their own words; without them Payload
 * DROPS both fields silently on save, so a seed would report success and
 * publish nothing.
 *
 * Hand-written rather than generated. Every statement is an idempotent
 * ADD COLUMN on a nullable varchar with no default: no table is rewritten, no
 * row is read, and re-running is a no-op. Verified before writing that all 28
 * block tables and both video_feature tables exist in production and that
 * none of them already carry these columns.
 */

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "sites_cms"."pages_blocks_rich_text" ADD COLUMN IF NOT EXISTS "eyebrow" varchar;
  ALTER TABLE "sites_cms"."_pages_v_blocks_rich_text" ADD COLUMN IF NOT EXISTS "eyebrow" varchar;
  ALTER TABLE "sites_cms"."pages_blocks_media_feature" ADD COLUMN IF NOT EXISTS "eyebrow" varchar;
  ALTER TABLE "sites_cms"."_pages_v_blocks_media_feature" ADD COLUMN IF NOT EXISTS "eyebrow" varchar;
  ALTER TABLE "sites_cms"."pages_blocks_cta" ADD COLUMN IF NOT EXISTS "eyebrow" varchar;
  ALTER TABLE "sites_cms"."_pages_v_blocks_cta" ADD COLUMN IF NOT EXISTS "eyebrow" varchar;
  ALTER TABLE "sites_cms"."pages_blocks_offering_grid" ADD COLUMN IF NOT EXISTS "eyebrow" varchar;
  ALTER TABLE "sites_cms"."_pages_v_blocks_offering_grid" ADD COLUMN IF NOT EXISTS "eyebrow" varchar;
  ALTER TABLE "sites_cms"."pages_blocks_venue_reservation" ADD COLUMN IF NOT EXISTS "eyebrow" varchar;
  ALTER TABLE "sites_cms"."_pages_v_blocks_venue_reservation" ADD COLUMN IF NOT EXISTS "eyebrow" varchar;
  ALTER TABLE "sites_cms"."pages_blocks_menu_link" ADD COLUMN IF NOT EXISTS "eyebrow" varchar;
  ALTER TABLE "sites_cms"."_pages_v_blocks_menu_link" ADD COLUMN IF NOT EXISTS "eyebrow" varchar;
  ALTER TABLE "sites_cms"."pages_blocks_menu_board" ADD COLUMN IF NOT EXISTS "eyebrow" varchar;
  ALTER TABLE "sites_cms"."_pages_v_blocks_menu_board" ADD COLUMN IF NOT EXISTS "eyebrow" varchar;
  ALTER TABLE "sites_cms"."pages_blocks_gallery" ADD COLUMN IF NOT EXISTS "eyebrow" varchar;
  ALTER TABLE "sites_cms"."_pages_v_blocks_gallery" ADD COLUMN IF NOT EXISTS "eyebrow" varchar;
  ALTER TABLE "sites_cms"."pages_blocks_video_feature" ADD COLUMN IF NOT EXISTS "eyebrow" varchar;
  ALTER TABLE "sites_cms"."_pages_v_blocks_video_feature" ADD COLUMN IF NOT EXISTS "eyebrow" varchar;
  ALTER TABLE "sites_cms"."pages_blocks_team" ADD COLUMN IF NOT EXISTS "eyebrow" varchar;
  ALTER TABLE "sites_cms"."_pages_v_blocks_team" ADD COLUMN IF NOT EXISTS "eyebrow" varchar;
  ALTER TABLE "sites_cms"."pages_blocks_hours_location" ADD COLUMN IF NOT EXISTS "eyebrow" varchar;
  ALTER TABLE "sites_cms"."_pages_v_blocks_hours_location" ADD COLUMN IF NOT EXISTS "eyebrow" varchar;
  ALTER TABLE "sites_cms"."pages_blocks_testimonials" ADD COLUMN IF NOT EXISTS "eyebrow" varchar;
  ALTER TABLE "sites_cms"."_pages_v_blocks_testimonials" ADD COLUMN IF NOT EXISTS "eyebrow" varchar;
  ALTER TABLE "sites_cms"."pages_blocks_faq" ADD COLUMN IF NOT EXISTS "eyebrow" varchar;
  ALTER TABLE "sites_cms"."_pages_v_blocks_faq" ADD COLUMN IF NOT EXISTS "eyebrow" varchar;
  ALTER TABLE "sites_cms"."pages_blocks_contact_handoff" ADD COLUMN IF NOT EXISTS "eyebrow" varchar;
  ALTER TABLE "sites_cms"."_pages_v_blocks_contact_handoff" ADD COLUMN IF NOT EXISTS "eyebrow" varchar;
  ALTER TABLE "sites_cms"."pages_blocks_video_feature" ADD COLUMN IF NOT EXISTS "group_heading" varchar;
  ALTER TABLE "sites_cms"."_pages_v_blocks_video_feature" ADD COLUMN IF NOT EXISTS "group_heading" varchar;
  `)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "sites_cms"."pages_blocks_rich_text" DROP COLUMN IF EXISTS "eyebrow";
  ALTER TABLE "sites_cms"."_pages_v_blocks_rich_text" DROP COLUMN IF EXISTS "eyebrow";
  ALTER TABLE "sites_cms"."pages_blocks_media_feature" DROP COLUMN IF EXISTS "eyebrow";
  ALTER TABLE "sites_cms"."_pages_v_blocks_media_feature" DROP COLUMN IF EXISTS "eyebrow";
  ALTER TABLE "sites_cms"."pages_blocks_cta" DROP COLUMN IF EXISTS "eyebrow";
  ALTER TABLE "sites_cms"."_pages_v_blocks_cta" DROP COLUMN IF EXISTS "eyebrow";
  ALTER TABLE "sites_cms"."pages_blocks_offering_grid" DROP COLUMN IF EXISTS "eyebrow";
  ALTER TABLE "sites_cms"."_pages_v_blocks_offering_grid" DROP COLUMN IF EXISTS "eyebrow";
  ALTER TABLE "sites_cms"."pages_blocks_venue_reservation" DROP COLUMN IF EXISTS "eyebrow";
  ALTER TABLE "sites_cms"."_pages_v_blocks_venue_reservation" DROP COLUMN IF EXISTS "eyebrow";
  ALTER TABLE "sites_cms"."pages_blocks_menu_link" DROP COLUMN IF EXISTS "eyebrow";
  ALTER TABLE "sites_cms"."_pages_v_blocks_menu_link" DROP COLUMN IF EXISTS "eyebrow";
  ALTER TABLE "sites_cms"."pages_blocks_menu_board" DROP COLUMN IF EXISTS "eyebrow";
  ALTER TABLE "sites_cms"."_pages_v_blocks_menu_board" DROP COLUMN IF EXISTS "eyebrow";
  ALTER TABLE "sites_cms"."pages_blocks_gallery" DROP COLUMN IF EXISTS "eyebrow";
  ALTER TABLE "sites_cms"."_pages_v_blocks_gallery" DROP COLUMN IF EXISTS "eyebrow";
  ALTER TABLE "sites_cms"."pages_blocks_video_feature" DROP COLUMN IF EXISTS "eyebrow";
  ALTER TABLE "sites_cms"."_pages_v_blocks_video_feature" DROP COLUMN IF EXISTS "eyebrow";
  ALTER TABLE "sites_cms"."pages_blocks_team" DROP COLUMN IF EXISTS "eyebrow";
  ALTER TABLE "sites_cms"."_pages_v_blocks_team" DROP COLUMN IF EXISTS "eyebrow";
  ALTER TABLE "sites_cms"."pages_blocks_hours_location" DROP COLUMN IF EXISTS "eyebrow";
  ALTER TABLE "sites_cms"."_pages_v_blocks_hours_location" DROP COLUMN IF EXISTS "eyebrow";
  ALTER TABLE "sites_cms"."pages_blocks_testimonials" DROP COLUMN IF EXISTS "eyebrow";
  ALTER TABLE "sites_cms"."_pages_v_blocks_testimonials" DROP COLUMN IF EXISTS "eyebrow";
  ALTER TABLE "sites_cms"."pages_blocks_faq" DROP COLUMN IF EXISTS "eyebrow";
  ALTER TABLE "sites_cms"."_pages_v_blocks_faq" DROP COLUMN IF EXISTS "eyebrow";
  ALTER TABLE "sites_cms"."pages_blocks_contact_handoff" DROP COLUMN IF EXISTS "eyebrow";
  ALTER TABLE "sites_cms"."_pages_v_blocks_contact_handoff" DROP COLUMN IF EXISTS "eyebrow";
  ALTER TABLE "sites_cms"."pages_blocks_video_feature" DROP COLUMN IF EXISTS "group_heading";
  ALTER TABLE "sites_cms"."_pages_v_blocks_video_feature" DROP COLUMN IF EXISTS "group_heading";
  `)
}
