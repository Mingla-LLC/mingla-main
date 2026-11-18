import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/*
 * #4453 milestone 11 (spec v2.1 §3.1) — Studio's half of "Add a page with Ari":
 * - pages: `origin` ('ari' for a page Ari added), the Draft-by-Ari marker
 *   `ari_draft` (true until the owner accepts the page), the owner's request
 *   verbatim `ari_request`, and the owner-only `owner_questions` (jsonb list);
 *   live AND versioned (`_pages_v`);
 * - navigation items: the Studio-only `draft` marker on a menu entry Ari added
 *   for a Draft page; live and versioned.
 * Additive only: no existing table, column or enum value changes.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "sites_cms"."pages" ADD COLUMN IF NOT EXISTS "origin" varchar;
  ALTER TABLE "sites_cms"."pages" ADD COLUMN IF NOT EXISTS "ari_draft" boolean DEFAULT false;
  ALTER TABLE "sites_cms"."pages" ADD COLUMN IF NOT EXISTS "ari_request" varchar;
  ALTER TABLE "sites_cms"."pages" ADD COLUMN IF NOT EXISTS "owner_questions" jsonb;
  ALTER TABLE "sites_cms"."_pages_v" ADD COLUMN IF NOT EXISTS "version_origin" varchar;
  ALTER TABLE "sites_cms"."_pages_v" ADD COLUMN IF NOT EXISTS "version_ari_draft" boolean DEFAULT false;
  ALTER TABLE "sites_cms"."_pages_v" ADD COLUMN IF NOT EXISTS "version_ari_request" varchar;
  ALTER TABLE "sites_cms"."_pages_v" ADD COLUMN IF NOT EXISTS "version_owner_questions" jsonb;
  ALTER TABLE "sites_cms"."navigation_items" ADD COLUMN IF NOT EXISTS "draft" boolean DEFAULT false;
  ALTER TABLE "sites_cms"."_navigation_v_version_items" ADD COLUMN IF NOT EXISTS "draft" boolean DEFAULT false;
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "sites_cms"."pages" DROP COLUMN IF EXISTS "origin";
  ALTER TABLE "sites_cms"."pages" DROP COLUMN IF EXISTS "ari_draft";
  ALTER TABLE "sites_cms"."pages" DROP COLUMN IF EXISTS "ari_request";
  ALTER TABLE "sites_cms"."pages" DROP COLUMN IF EXISTS "owner_questions";
  ALTER TABLE "sites_cms"."_pages_v" DROP COLUMN IF EXISTS "version_origin";
  ALTER TABLE "sites_cms"."_pages_v" DROP COLUMN IF EXISTS "version_ari_draft";
  ALTER TABLE "sites_cms"."_pages_v" DROP COLUMN IF EXISTS "version_ari_request";
  ALTER TABLE "sites_cms"."_pages_v" DROP COLUMN IF EXISTS "version_owner_questions";
  ALTER TABLE "sites_cms"."navigation_items" DROP COLUMN IF EXISTS "draft";
  ALTER TABLE "sites_cms"."_navigation_v_version_items" DROP COLUMN IF EXISTS "draft";
  `)
}
