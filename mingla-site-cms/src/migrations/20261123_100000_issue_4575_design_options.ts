import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/*
 * #4575 (Grid design options) — SiteSettings' new `design_options` group:
 * Grid's full-screen cover (`cover`: 'full') and its photos (`photos`:
 * 'colour' | 'mono'), on the live table and the version table
 * (`_site_settings_v`). Additive only: two enums per table, four nullable
 * columns, no defaults (null = not set; an artifact without options is
 * unchanged). Hand-written to Payload's own naming for a group's select
 * (`enum_<table>_<group>_<field>`, column `<group>_<field>`, version column
 * `version_<group>_<field>`), as earlier group fields (navigation
 * header_cta) were generated.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  CREATE TYPE "sites_cms"."enum_site_settings_design_options_cover" AS ENUM('full');
  CREATE TYPE "sites_cms"."enum_site_settings_design_options_photos" AS ENUM('colour', 'mono');
  CREATE TYPE "sites_cms"."enum__site_settings_v_version_design_options_cover" AS ENUM('full');
  CREATE TYPE "sites_cms"."enum__site_settings_v_version_design_options_photos" AS ENUM('colour', 'mono');
  ALTER TABLE "sites_cms"."site_settings" ADD COLUMN "design_options_cover" "sites_cms"."enum_site_settings_design_options_cover";
  ALTER TABLE "sites_cms"."site_settings" ADD COLUMN "design_options_photos" "sites_cms"."enum_site_settings_design_options_photos";
  ALTER TABLE "sites_cms"."_site_settings_v" ADD COLUMN "version_design_options_cover" "sites_cms"."enum__site_settings_v_version_design_options_cover";
  ALTER TABLE "sites_cms"."_site_settings_v" ADD COLUMN "version_design_options_photos" "sites_cms"."enum__site_settings_v_version_design_options_photos";`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "sites_cms"."site_settings" DROP COLUMN "design_options_cover";
  ALTER TABLE "sites_cms"."site_settings" DROP COLUMN "design_options_photos";
  ALTER TABLE "sites_cms"."_site_settings_v" DROP COLUMN "version_design_options_cover";
  ALTER TABLE "sites_cms"."_site_settings_v" DROP COLUMN "version_design_options_photos";
  DROP TYPE "sites_cms"."enum_site_settings_design_options_cover";
  DROP TYPE "sites_cms"."enum_site_settings_design_options_photos";
  DROP TYPE "sites_cms"."enum__site_settings_v_version_design_options_cover";
  DROP TYPE "sites_cms"."enum__site_settings_v_version_design_options_photos";`)
}
