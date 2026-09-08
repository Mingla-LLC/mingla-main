import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/*
 * #2830 — enum values only, deliberately alone in their own migration.
 *
 * Postgres refuses to USE a new enum value in the same transaction that ADDED
 * it. Payload generated one migration that added `condensed-display` and then
 * set it as a column DEFAULT; that fails with
 * `unsafe use of new value ... of enum type`. It would have failed against
 * production exactly as it failed against a scratch copy.
 *
 * Splitting the ADD VALUEs into their own migration commits them before the
 * next migration uses them.
 *
 * `video/mp4` here is the DATABASE half of the media gate. The code allowlist
 * was only half the fix: without this value the media row insert rejects every
 * video regardless of what the application permits.
*/

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TYPE "sites_cms"."enum_media_declared_mime" ADD VALUE 'video/mp4';
  ALTER TYPE "sites_cms"."enum_site_settings_typography" ADD VALUE 'condensed-display' BEFORE 'modern-sans';
  ALTER TYPE "sites_cms"."enum__site_settings_v_version_typography" ADD VALUE 'condensed-display' BEFORE 'modern-sans';`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "sites_cms"."media" ALTER COLUMN "declared_mime" SET DATA TYPE text;
  DROP TYPE "sites_cms"."enum_media_declared_mime";
  CREATE TYPE "sites_cms"."enum_media_declared_mime" AS ENUM('image/jpeg', 'image/png', 'image/webp');
  ALTER TABLE "sites_cms"."media" ALTER COLUMN "declared_mime" SET DATA TYPE "sites_cms"."enum_media_declared_mime" USING "declared_mime"::"sites_cms"."enum_media_declared_mime";
  ALTER TABLE "sites_cms"."site_settings" ALTER COLUMN "typography" SET DATA TYPE text;
  ALTER TABLE "sites_cms"."site_settings" ALTER COLUMN "typography" SET DEFAULT 'editorial-serif'::text;
  DROP TYPE "sites_cms"."enum_site_settings_typography";
  CREATE TYPE "sites_cms"."enum_site_settings_typography" AS ENUM('modern-sans', 'editorial-serif');
  ALTER TABLE "sites_cms"."site_settings" ALTER COLUMN "typography" SET DEFAULT 'editorial-serif'::"sites_cms"."enum_site_settings_typography";
  ALTER TABLE "sites_cms"."site_settings" ALTER COLUMN "typography" SET DATA TYPE "sites_cms"."enum_site_settings_typography" USING "typography"::"sites_cms"."enum_site_settings_typography";
  ALTER TABLE "sites_cms"."_site_settings_v" ALTER COLUMN "version_typography" SET DATA TYPE text;
  ALTER TABLE "sites_cms"."_site_settings_v" ALTER COLUMN "version_typography" SET DEFAULT 'editorial-serif'::text;
  DROP TYPE "sites_cms"."enum__site_settings_v_version_typography";
  CREATE TYPE "sites_cms"."enum__site_settings_v_version_typography" AS ENUM('modern-sans', 'editorial-serif');
  ALTER TABLE "sites_cms"."_site_settings_v" ALTER COLUMN "version_typography" SET DEFAULT 'editorial-serif'::"sites_cms"."enum__site_settings_v_version_typography";
  ALTER TABLE "sites_cms"."_site_settings_v" ALTER COLUMN "version_typography" SET DATA TYPE "sites_cms"."enum__site_settings_v_version_typography" USING "version_typography"::"sites_cms"."enum__site_settings_v_version_typography";`)
}
