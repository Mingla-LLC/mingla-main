import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "sites_cms"."media" ADD COLUMN "quarantine_delete_by" timestamp(3) with time zone;
  ALTER TABLE "sites_cms"."media" ADD COLUMN "recovery_until" timestamp(3) with time zone;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "sites_cms"."media" DROP COLUMN "quarantine_delete_by";
  ALTER TABLE "sites_cms"."media" DROP COLUMN "recovery_until";`)
}
