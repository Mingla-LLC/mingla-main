import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/*
 * #2829 W1 — Studio for more than one brand.
 *
 * 1. Every tenant learns its live address (`primary_hostname`), which Core
 *    names at provision time. Existing tenants are backfilled from the
 *    canonical address their own site settings already hold (data-driven: no
 *    hostname is written by this file).
 * 2. The single-brand column defaults on site settings are dropped (the
 *    canonical is computed from the tenant's primary host from now on). Rows
 *    keep their values.
 * 3. New tenants and settings default to the `sites-v2` renderer; existing
 *    rows keep theirs.
 *
 * Nullable column, no rewrite; every statement is safe to run twice.
 * NOT APPLIED BY THE AUTHOR.
 */

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "sites_cms"."tenants" ADD COLUMN IF NOT EXISTS "primary_hostname" varchar;
   UPDATE "sites_cms"."tenants" AS tenant
     SET "primary_hostname" = substring(settings."canonical_url" from '^https://([a-z0-9.-]+)$')
     FROM "sites_cms"."site_settings" AS settings
     WHERE settings."tenant_id" = tenant."id"
       AND tenant."primary_hostname" IS NULL
       AND settings."canonical_url" ~ '^https://[a-z0-9.-]+$';
   ALTER TABLE "sites_cms"."tenants" ALTER COLUMN "renderer_key" SET DEFAULT 'sites-v2';
   ALTER TABLE "sites_cms"."site_settings" ALTER COLUMN "canonical_url" DROP DEFAULT;
   ALTER TABLE "sites_cms"."site_settings" ALTER COLUMN "renderer_key" SET DEFAULT 'sites-v2';
   ALTER TABLE "sites_cms"."_site_settings_v" ALTER COLUMN "version_canonical_url" DROP DEFAULT;
   ALTER TABLE "sites_cms"."_site_settings_v" ALTER COLUMN "version_renderer_key" SET DEFAULT 'sites-v2';`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  // Forward-only in practice; down restores only what this file changed that
  // carries no customer data (the column defaults). primary_hostname is kept.
  await db.execute(sql`
   ALTER TABLE "sites_cms"."tenants" ALTER COLUMN "renderer_key" SET DEFAULT 'restaurant-website-v1';
   ALTER TABLE "sites_cms"."site_settings" ALTER COLUMN "renderer_key" SET DEFAULT 'restaurant-website-v1';
   ALTER TABLE "sites_cms"."_site_settings_v" ALTER COLUMN "version_renderer_key" SET DEFAULT 'restaurant-website-v1';`)
}
