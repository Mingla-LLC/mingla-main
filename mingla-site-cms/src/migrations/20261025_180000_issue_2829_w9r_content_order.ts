import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "sites_cms"."testimonials" ALTER COLUMN "enabled" SET DEFAULT false;
  ALTER TABLE "sites_cms"."_testimonials_v" ALTER COLUMN "version_enabled" SET DEFAULT false;
  ALTER TABLE "sites_cms"."site_settings" ADD COLUMN "hidden_offering_ids" jsonb;
  ALTER TABLE "sites_cms"."_site_settings_v" ADD COLUMN "version_hidden_offering_ids" jsonb;
  ALTER TABLE "sites_cms"."destinations" ADD COLUMN "sort_order" numeric;
  ALTER TABLE "sites_cms"."destinations" ADD COLUMN "updated_by" varchar;
  ALTER TABLE "sites_cms"."_destinations_v" ADD COLUMN "version_sort_order" numeric;
  ALTER TABLE "sites_cms"."_destinations_v" ADD COLUMN "version_updated_by" varchar;
  ALTER TABLE "sites_cms"."categories" ADD COLUMN "sort_order" numeric;
  ALTER TABLE "sites_cms"."categories" ADD COLUMN "updated_by" varchar;
  ALTER TABLE "sites_cms"."_categories_v" ADD COLUMN "version_sort_order" numeric;
  ALTER TABLE "sites_cms"."_categories_v" ADD COLUMN "version_updated_by" varchar;
  ALTER TABLE "sites_cms"."stories" ADD COLUMN "sort_order" numeric;
  ALTER TABLE "sites_cms"."stories" ADD COLUMN "updated_by" varchar;
  ALTER TABLE "sites_cms"."_stories_v" ADD COLUMN "version_sort_order" numeric;
  ALTER TABLE "sites_cms"."_stories_v" ADD COLUMN "version_updated_by" varchar;
  ALTER TABLE "sites_cms"."testimonials" ADD COLUMN "confirmed_by" varchar;
  ALTER TABLE "sites_cms"."testimonials" ADD COLUMN "confirmed_at" timestamp(3) with time zone;
  ALTER TABLE "sites_cms"."testimonials" ADD COLUMN "sort_order" numeric;
  ALTER TABLE "sites_cms"."testimonials" ADD COLUMN "updated_by" varchar;
  ALTER TABLE "sites_cms"."_testimonials_v" ADD COLUMN "version_confirmed_by" varchar;
  ALTER TABLE "sites_cms"."_testimonials_v" ADD COLUMN "version_confirmed_at" timestamp(3) with time zone;
  ALTER TABLE "sites_cms"."_testimonials_v" ADD COLUMN "version_sort_order" numeric;
  ALTER TABLE "sites_cms"."_testimonials_v" ADD COLUMN "version_updated_by" varchar;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "sites_cms"."testimonials" ALTER COLUMN "enabled" SET DEFAULT true;
  ALTER TABLE "sites_cms"."_testimonials_v" ALTER COLUMN "version_enabled" SET DEFAULT true;
  ALTER TABLE "sites_cms"."site_settings" DROP COLUMN "hidden_offering_ids";
  ALTER TABLE "sites_cms"."_site_settings_v" DROP COLUMN "version_hidden_offering_ids";
  ALTER TABLE "sites_cms"."destinations" DROP COLUMN "sort_order";
  ALTER TABLE "sites_cms"."destinations" DROP COLUMN "updated_by";
  ALTER TABLE "sites_cms"."_destinations_v" DROP COLUMN "version_sort_order";
  ALTER TABLE "sites_cms"."_destinations_v" DROP COLUMN "version_updated_by";
  ALTER TABLE "sites_cms"."categories" DROP COLUMN "sort_order";
  ALTER TABLE "sites_cms"."categories" DROP COLUMN "updated_by";
  ALTER TABLE "sites_cms"."_categories_v" DROP COLUMN "version_sort_order";
  ALTER TABLE "sites_cms"."_categories_v" DROP COLUMN "version_updated_by";
  ALTER TABLE "sites_cms"."stories" DROP COLUMN "sort_order";
  ALTER TABLE "sites_cms"."stories" DROP COLUMN "updated_by";
  ALTER TABLE "sites_cms"."_stories_v" DROP COLUMN "version_sort_order";
  ALTER TABLE "sites_cms"."_stories_v" DROP COLUMN "version_updated_by";
  ALTER TABLE "sites_cms"."testimonials" DROP COLUMN "confirmed_by";
  ALTER TABLE "sites_cms"."testimonials" DROP COLUMN "confirmed_at";
  ALTER TABLE "sites_cms"."testimonials" DROP COLUMN "sort_order";
  ALTER TABLE "sites_cms"."testimonials" DROP COLUMN "updated_by";
  ALTER TABLE "sites_cms"."_testimonials_v" DROP COLUMN "version_confirmed_by";
  ALTER TABLE "sites_cms"."_testimonials_v" DROP COLUMN "version_confirmed_at";
  ALTER TABLE "sites_cms"."_testimonials_v" DROP COLUMN "version_sort_order";
  ALTER TABLE "sites_cms"."_testimonials_v" DROP COLUMN "version_updated_by";`)
}
