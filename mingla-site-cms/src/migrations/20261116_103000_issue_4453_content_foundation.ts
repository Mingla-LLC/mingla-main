import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/*
 * #4453 PR 3 (content foundation) — Studio's half:
 * - every block carries the Studio-only Draft stamp `review` (jsonb), on the
 *   live table AND the version table, for every catalogue block type (a test
 *   pins this list to siteBlocks);
 * - reviews, destinations and stories carry `setup_ref`, the Website-setup
 *   entry they were created from, so Build creates each one once.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "sites_cms"."pages_blocks_hero" ADD COLUMN IF NOT EXISTS "review" jsonb;
  ALTER TABLE "sites_cms"."_pages_v_blocks_hero" ADD COLUMN IF NOT EXISTS "review" jsonb;
  ALTER TABLE "sites_cms"."pages_blocks_rich_text" ADD COLUMN IF NOT EXISTS "review" jsonb;
  ALTER TABLE "sites_cms"."_pages_v_blocks_rich_text" ADD COLUMN IF NOT EXISTS "review" jsonb;
  ALTER TABLE "sites_cms"."pages_blocks_media_feature" ADD COLUMN IF NOT EXISTS "review" jsonb;
  ALTER TABLE "sites_cms"."_pages_v_blocks_media_feature" ADD COLUMN IF NOT EXISTS "review" jsonb;
  ALTER TABLE "sites_cms"."pages_blocks_cta" ADD COLUMN IF NOT EXISTS "review" jsonb;
  ALTER TABLE "sites_cms"."_pages_v_blocks_cta" ADD COLUMN IF NOT EXISTS "review" jsonb;
  ALTER TABLE "sites_cms"."pages_blocks_offering_grid" ADD COLUMN IF NOT EXISTS "review" jsonb;
  ALTER TABLE "sites_cms"."_pages_v_blocks_offering_grid" ADD COLUMN IF NOT EXISTS "review" jsonb;
  ALTER TABLE "sites_cms"."pages_blocks_venue_reservation" ADD COLUMN IF NOT EXISTS "review" jsonb;
  ALTER TABLE "sites_cms"."_pages_v_blocks_venue_reservation" ADD COLUMN IF NOT EXISTS "review" jsonb;
  ALTER TABLE "sites_cms"."pages_blocks_menu_link" ADD COLUMN IF NOT EXISTS "review" jsonb;
  ALTER TABLE "sites_cms"."_pages_v_blocks_menu_link" ADD COLUMN IF NOT EXISTS "review" jsonb;
  ALTER TABLE "sites_cms"."pages_blocks_menu_board" ADD COLUMN IF NOT EXISTS "review" jsonb;
  ALTER TABLE "sites_cms"."_pages_v_blocks_menu_board" ADD COLUMN IF NOT EXISTS "review" jsonb;
  ALTER TABLE "sites_cms"."pages_blocks_menu_preview" ADD COLUMN IF NOT EXISTS "review" jsonb;
  ALTER TABLE "sites_cms"."_pages_v_blocks_menu_preview" ADD COLUMN IF NOT EXISTS "review" jsonb;
  ALTER TABLE "sites_cms"."pages_blocks_video_feature" ADD COLUMN IF NOT EXISTS "review" jsonb;
  ALTER TABLE "sites_cms"."_pages_v_blocks_video_feature" ADD COLUMN IF NOT EXISTS "review" jsonb;
  ALTER TABLE "sites_cms"."pages_blocks_team" ADD COLUMN IF NOT EXISTS "review" jsonb;
  ALTER TABLE "sites_cms"."_pages_v_blocks_team" ADD COLUMN IF NOT EXISTS "review" jsonb;
  ALTER TABLE "sites_cms"."pages_blocks_gallery" ADD COLUMN IF NOT EXISTS "review" jsonb;
  ALTER TABLE "sites_cms"."_pages_v_blocks_gallery" ADD COLUMN IF NOT EXISTS "review" jsonb;
  ALTER TABLE "sites_cms"."pages_blocks_hours_location" ADD COLUMN IF NOT EXISTS "review" jsonb;
  ALTER TABLE "sites_cms"."_pages_v_blocks_hours_location" ADD COLUMN IF NOT EXISTS "review" jsonb;
  ALTER TABLE "sites_cms"."pages_blocks_testimonials" ADD COLUMN IF NOT EXISTS "review" jsonb;
  ALTER TABLE "sites_cms"."_pages_v_blocks_testimonials" ADD COLUMN IF NOT EXISTS "review" jsonb;
  ALTER TABLE "sites_cms"."pages_blocks_faq" ADD COLUMN IF NOT EXISTS "review" jsonb;
  ALTER TABLE "sites_cms"."_pages_v_blocks_faq" ADD COLUMN IF NOT EXISTS "review" jsonb;
  ALTER TABLE "sites_cms"."pages_blocks_contact_handoff" ADD COLUMN IF NOT EXISTS "review" jsonb;
  ALTER TABLE "sites_cms"."_pages_v_blocks_contact_handoff" ADD COLUMN IF NOT EXISTS "review" jsonb;
  ALTER TABLE "sites_cms"."pages_blocks_marquee" ADD COLUMN IF NOT EXISTS "review" jsonb;
  ALTER TABLE "sites_cms"."_pages_v_blocks_marquee" ADD COLUMN IF NOT EXISTS "review" jsonb;
  ALTER TABLE "sites_cms"."pages_blocks_stats" ADD COLUMN IF NOT EXISTS "review" jsonb;
  ALTER TABLE "sites_cms"."_pages_v_blocks_stats" ADD COLUMN IF NOT EXISTS "review" jsonb;
  ALTER TABLE "sites_cms"."pages_blocks_pull_quote" ADD COLUMN IF NOT EXISTS "review" jsonb;
  ALTER TABLE "sites_cms"."_pages_v_blocks_pull_quote" ADD COLUMN IF NOT EXISTS "review" jsonb;
  ALTER TABLE "sites_cms"."pages_blocks_map_embed" ADD COLUMN IF NOT EXISTS "review" jsonb;
  ALTER TABLE "sites_cms"."_pages_v_blocks_map_embed" ADD COLUMN IF NOT EXISTS "review" jsonb;
  ALTER TABLE "sites_cms"."pages_blocks_destination_grid" ADD COLUMN IF NOT EXISTS "review" jsonb;
  ALTER TABLE "sites_cms"."_pages_v_blocks_destination_grid" ADD COLUMN IF NOT EXISTS "review" jsonb;
  ALTER TABLE "sites_cms"."pages_blocks_story_grid" ADD COLUMN IF NOT EXISTS "review" jsonb;
  ALTER TABLE "sites_cms"."_pages_v_blocks_story_grid" ADD COLUMN IF NOT EXISTS "review" jsonb;
  ALTER TABLE "sites_cms"."pages_blocks_offering_history" ADD COLUMN IF NOT EXISTS "review" jsonb;
  ALTER TABLE "sites_cms"."_pages_v_blocks_offering_history" ADD COLUMN IF NOT EXISTS "review" jsonb;
  ALTER TABLE "sites_cms"."pages_blocks_contact_form" ADD COLUMN IF NOT EXISTS "review" jsonb;
  ALTER TABLE "sites_cms"."_pages_v_blocks_contact_form" ADD COLUMN IF NOT EXISTS "review" jsonb;
  ALTER TABLE "sites_cms"."pages_blocks_newsletter_signup" ADD COLUMN IF NOT EXISTS "review" jsonb;
  ALTER TABLE "sites_cms"."_pages_v_blocks_newsletter_signup" ADD COLUMN IF NOT EXISTS "review" jsonb;
  ALTER TABLE "sites_cms"."pages_blocks_page_header" ADD COLUMN IF NOT EXISTS "review" jsonb;
  ALTER TABLE "sites_cms"."_pages_v_blocks_page_header" ADD COLUMN IF NOT EXISTS "review" jsonb;
  ALTER TABLE "sites_cms"."pages_blocks_feature_cards" ADD COLUMN IF NOT EXISTS "review" jsonb;
  ALTER TABLE "sites_cms"."_pages_v_blocks_feature_cards" ADD COLUMN IF NOT EXISTS "review" jsonb;
  ALTER TABLE "sites_cms"."pages_blocks_contact_details" ADD COLUMN IF NOT EXISTS "review" jsonb;
  ALTER TABLE "sites_cms"."_pages_v_blocks_contact_details" ADD COLUMN IF NOT EXISTS "review" jsonb;
  ALTER TABLE "sites_cms"."pages_blocks_divider" ADD COLUMN IF NOT EXISTS "review" jsonb;
  ALTER TABLE "sites_cms"."_pages_v_blocks_divider" ADD COLUMN IF NOT EXISTS "review" jsonb;
  ALTER TABLE "sites_cms"."pages_blocks_spacer" ADD COLUMN IF NOT EXISTS "review" jsonb;
  ALTER TABLE "sites_cms"."_pages_v_blocks_spacer" ADD COLUMN IF NOT EXISTS "review" jsonb;
  ALTER TABLE "sites_cms"."testimonials" ADD COLUMN IF NOT EXISTS "setup_ref" varchar;
  ALTER TABLE "sites_cms"."_testimonials_v" ADD COLUMN IF NOT EXISTS "version_setup_ref" varchar;
  CREATE UNIQUE INDEX IF NOT EXISTS "testimonials_setup_ref_idx" ON "sites_cms"."testimonials" USING btree ("tenant_id", "setup_ref") WHERE "setup_ref" IS NOT NULL;
  ALTER TABLE "sites_cms"."destinations" ADD COLUMN IF NOT EXISTS "setup_ref" varchar;
  ALTER TABLE "sites_cms"."_destinations_v" ADD COLUMN IF NOT EXISTS "version_setup_ref" varchar;
  CREATE UNIQUE INDEX IF NOT EXISTS "destinations_setup_ref_idx" ON "sites_cms"."destinations" USING btree ("tenant_id", "setup_ref") WHERE "setup_ref" IS NOT NULL;
  ALTER TABLE "sites_cms"."stories" ADD COLUMN IF NOT EXISTS "setup_ref" varchar;
  ALTER TABLE "sites_cms"."_stories_v" ADD COLUMN IF NOT EXISTS "version_setup_ref" varchar;
  CREATE UNIQUE INDEX IF NOT EXISTS "stories_setup_ref_idx" ON "sites_cms"."stories" USING btree ("tenant_id", "setup_ref") WHERE "setup_ref" IS NOT NULL;
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "sites_cms"."pages_blocks_hero" DROP COLUMN IF EXISTS "review";
  ALTER TABLE "sites_cms"."_pages_v_blocks_hero" DROP COLUMN IF EXISTS "review";
  ALTER TABLE "sites_cms"."pages_blocks_rich_text" DROP COLUMN IF EXISTS "review";
  ALTER TABLE "sites_cms"."_pages_v_blocks_rich_text" DROP COLUMN IF EXISTS "review";
  ALTER TABLE "sites_cms"."pages_blocks_media_feature" DROP COLUMN IF EXISTS "review";
  ALTER TABLE "sites_cms"."_pages_v_blocks_media_feature" DROP COLUMN IF EXISTS "review";
  ALTER TABLE "sites_cms"."pages_blocks_cta" DROP COLUMN IF EXISTS "review";
  ALTER TABLE "sites_cms"."_pages_v_blocks_cta" DROP COLUMN IF EXISTS "review";
  ALTER TABLE "sites_cms"."pages_blocks_offering_grid" DROP COLUMN IF EXISTS "review";
  ALTER TABLE "sites_cms"."_pages_v_blocks_offering_grid" DROP COLUMN IF EXISTS "review";
  ALTER TABLE "sites_cms"."pages_blocks_venue_reservation" DROP COLUMN IF EXISTS "review";
  ALTER TABLE "sites_cms"."_pages_v_blocks_venue_reservation" DROP COLUMN IF EXISTS "review";
  ALTER TABLE "sites_cms"."pages_blocks_menu_link" DROP COLUMN IF EXISTS "review";
  ALTER TABLE "sites_cms"."_pages_v_blocks_menu_link" DROP COLUMN IF EXISTS "review";
  ALTER TABLE "sites_cms"."pages_blocks_menu_board" DROP COLUMN IF EXISTS "review";
  ALTER TABLE "sites_cms"."_pages_v_blocks_menu_board" DROP COLUMN IF EXISTS "review";
  ALTER TABLE "sites_cms"."pages_blocks_menu_preview" DROP COLUMN IF EXISTS "review";
  ALTER TABLE "sites_cms"."_pages_v_blocks_menu_preview" DROP COLUMN IF EXISTS "review";
  ALTER TABLE "sites_cms"."pages_blocks_video_feature" DROP COLUMN IF EXISTS "review";
  ALTER TABLE "sites_cms"."_pages_v_blocks_video_feature" DROP COLUMN IF EXISTS "review";
  ALTER TABLE "sites_cms"."pages_blocks_team" DROP COLUMN IF EXISTS "review";
  ALTER TABLE "sites_cms"."_pages_v_blocks_team" DROP COLUMN IF EXISTS "review";
  ALTER TABLE "sites_cms"."pages_blocks_gallery" DROP COLUMN IF EXISTS "review";
  ALTER TABLE "sites_cms"."_pages_v_blocks_gallery" DROP COLUMN IF EXISTS "review";
  ALTER TABLE "sites_cms"."pages_blocks_hours_location" DROP COLUMN IF EXISTS "review";
  ALTER TABLE "sites_cms"."_pages_v_blocks_hours_location" DROP COLUMN IF EXISTS "review";
  ALTER TABLE "sites_cms"."pages_blocks_testimonials" DROP COLUMN IF EXISTS "review";
  ALTER TABLE "sites_cms"."_pages_v_blocks_testimonials" DROP COLUMN IF EXISTS "review";
  ALTER TABLE "sites_cms"."pages_blocks_faq" DROP COLUMN IF EXISTS "review";
  ALTER TABLE "sites_cms"."_pages_v_blocks_faq" DROP COLUMN IF EXISTS "review";
  ALTER TABLE "sites_cms"."pages_blocks_contact_handoff" DROP COLUMN IF EXISTS "review";
  ALTER TABLE "sites_cms"."_pages_v_blocks_contact_handoff" DROP COLUMN IF EXISTS "review";
  ALTER TABLE "sites_cms"."pages_blocks_marquee" DROP COLUMN IF EXISTS "review";
  ALTER TABLE "sites_cms"."_pages_v_blocks_marquee" DROP COLUMN IF EXISTS "review";
  ALTER TABLE "sites_cms"."pages_blocks_stats" DROP COLUMN IF EXISTS "review";
  ALTER TABLE "sites_cms"."_pages_v_blocks_stats" DROP COLUMN IF EXISTS "review";
  ALTER TABLE "sites_cms"."pages_blocks_pull_quote" DROP COLUMN IF EXISTS "review";
  ALTER TABLE "sites_cms"."_pages_v_blocks_pull_quote" DROP COLUMN IF EXISTS "review";
  ALTER TABLE "sites_cms"."pages_blocks_map_embed" DROP COLUMN IF EXISTS "review";
  ALTER TABLE "sites_cms"."_pages_v_blocks_map_embed" DROP COLUMN IF EXISTS "review";
  ALTER TABLE "sites_cms"."pages_blocks_destination_grid" DROP COLUMN IF EXISTS "review";
  ALTER TABLE "sites_cms"."_pages_v_blocks_destination_grid" DROP COLUMN IF EXISTS "review";
  ALTER TABLE "sites_cms"."pages_blocks_story_grid" DROP COLUMN IF EXISTS "review";
  ALTER TABLE "sites_cms"."_pages_v_blocks_story_grid" DROP COLUMN IF EXISTS "review";
  ALTER TABLE "sites_cms"."pages_blocks_offering_history" DROP COLUMN IF EXISTS "review";
  ALTER TABLE "sites_cms"."_pages_v_blocks_offering_history" DROP COLUMN IF EXISTS "review";
  ALTER TABLE "sites_cms"."pages_blocks_contact_form" DROP COLUMN IF EXISTS "review";
  ALTER TABLE "sites_cms"."_pages_v_blocks_contact_form" DROP COLUMN IF EXISTS "review";
  ALTER TABLE "sites_cms"."pages_blocks_newsletter_signup" DROP COLUMN IF EXISTS "review";
  ALTER TABLE "sites_cms"."_pages_v_blocks_newsletter_signup" DROP COLUMN IF EXISTS "review";
  ALTER TABLE "sites_cms"."pages_blocks_page_header" DROP COLUMN IF EXISTS "review";
  ALTER TABLE "sites_cms"."_pages_v_blocks_page_header" DROP COLUMN IF EXISTS "review";
  ALTER TABLE "sites_cms"."pages_blocks_feature_cards" DROP COLUMN IF EXISTS "review";
  ALTER TABLE "sites_cms"."_pages_v_blocks_feature_cards" DROP COLUMN IF EXISTS "review";
  ALTER TABLE "sites_cms"."pages_blocks_contact_details" DROP COLUMN IF EXISTS "review";
  ALTER TABLE "sites_cms"."_pages_v_blocks_contact_details" DROP COLUMN IF EXISTS "review";
  ALTER TABLE "sites_cms"."pages_blocks_divider" DROP COLUMN IF EXISTS "review";
  ALTER TABLE "sites_cms"."_pages_v_blocks_divider" DROP COLUMN IF EXISTS "review";
  ALTER TABLE "sites_cms"."pages_blocks_spacer" DROP COLUMN IF EXISTS "review";
  ALTER TABLE "sites_cms"."_pages_v_blocks_spacer" DROP COLUMN IF EXISTS "review";
  DROP INDEX IF EXISTS "sites_cms"."testimonials_setup_ref_idx";
  ALTER TABLE "sites_cms"."testimonials" DROP COLUMN IF EXISTS "setup_ref";
  ALTER TABLE "sites_cms"."_testimonials_v" DROP COLUMN IF EXISTS "version_setup_ref";
  DROP INDEX IF EXISTS "sites_cms"."destinations_setup_ref_idx";
  ALTER TABLE "sites_cms"."destinations" DROP COLUMN IF EXISTS "setup_ref";
  ALTER TABLE "sites_cms"."_destinations_v" DROP COLUMN IF EXISTS "version_setup_ref";
  DROP INDEX IF EXISTS "sites_cms"."stories_setup_ref_idx";
  ALTER TABLE "sites_cms"."stories" DROP COLUMN IF EXISTS "setup_ref";
  ALTER TABLE "sites_cms"."_stories_v" DROP COLUMN IF EXISTS "version_setup_ref";
  `)
}
