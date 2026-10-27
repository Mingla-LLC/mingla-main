import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TABLE "sites_cms"."history_only" (
  	"_order" integer NOT NULL,
  	"_parent_id" varchar NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"offering_id" varchar
  );
  
  CREATE TABLE "sites_cms"."_history_only_v" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"offering_id" varchar,
  	"_uuid" varchar
  );
  
  ALTER TABLE "sites_cms"."pages_blocks_contact_form" ADD COLUMN "name_placeholder" varchar;
  ALTER TABLE "sites_cms"."pages_blocks_contact_form" ADD COLUMN "email_placeholder" varchar;
  ALTER TABLE "sites_cms"."_pages_v_blocks_contact_form" ADD COLUMN "name_placeholder" varchar;
  ALTER TABLE "sites_cms"."_pages_v_blocks_contact_form" ADD COLUMN "email_placeholder" varchar;
  ALTER TABLE "sites_cms"."history_only" ADD CONSTRAINT "history_only_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."pages_blocks_offering_history"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."_history_only_v" ADD CONSTRAINT "_history_only_v_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."_pages_v_blocks_offering_history"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "history_only_order_idx" ON "sites_cms"."history_only" USING btree ("_order");
  CREATE INDEX "history_only_parent_id_idx" ON "sites_cms"."history_only" USING btree ("_parent_id");
  CREATE INDEX "_history_only_v_order_idx" ON "sites_cms"."_history_only_v" USING btree ("_order");
  CREATE INDEX "_history_only_v_parent_id_idx" ON "sites_cms"."_history_only_v" USING btree ("_parent_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP TABLE "sites_cms"."history_only" CASCADE;
  DROP TABLE "sites_cms"."_history_only_v" CASCADE;
  ALTER TABLE "sites_cms"."pages_blocks_contact_form" DROP COLUMN "name_placeholder";
  ALTER TABLE "sites_cms"."pages_blocks_contact_form" DROP COLUMN "email_placeholder";
  ALTER TABLE "sites_cms"."_pages_v_blocks_contact_form" DROP COLUMN "name_placeholder";
  ALTER TABLE "sites_cms"."_pages_v_blocks_contact_form" DROP COLUMN "email_placeholder";`)
}
