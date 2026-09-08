import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/*
 * #2830 — the block tables and hero video column the deployed code expects.
 *
 * Studio's Pages list was returning `column _pages_v_blocks_hero.video_id does
 * not exist`: the hero video, team, gallery-adjacent and menu blocks shipped in
 * the application weeks ago with no matching schema change. It went unnoticed
 * because this CMS had never successfully deployed, so the code and the
 * database had never met.
 *
 * The enum values this relies on are added by the migration before it.
*/

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`

  CREATE TABLE "sites_cms"."pages_blocks_menu_board" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"_path" text NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"heading" varchar,
  	"note" varchar,
  	"block_name" varchar
  );
  
  CREATE TABLE "sites_cms"."pages_blocks_video_feature" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"_path" text NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"heading" varchar,
  	"caption" varchar,
  	"video_id" uuid,
  	"poster_id" uuid,
  	"block_name" varchar
  );
  
  CREATE TABLE "sites_cms"."pages_blocks_team_members" (
  	"_order" integer NOT NULL,
  	"_parent_id" varchar NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"name" varchar,
  	"role" varchar,
  	"media_id" uuid,
  	"alt" varchar
  );
  
  CREATE TABLE "sites_cms"."pages_blocks_team" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"_path" text NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"heading" varchar,
  	"caption" varchar,
  	"block_name" varchar
  );
  
  CREATE TABLE "sites_cms"."_pages_v_blocks_menu_board" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"_path" text NOT NULL,
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"heading" varchar,
  	"note" varchar,
  	"_uuid" varchar,
  	"block_name" varchar
  );
  
  CREATE TABLE "sites_cms"."_pages_v_blocks_video_feature" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"_path" text NOT NULL,
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"heading" varchar,
  	"caption" varchar,
  	"video_id" uuid,
  	"poster_id" uuid,
  	"_uuid" varchar,
  	"block_name" varchar
  );
  
  CREATE TABLE "sites_cms"."_pages_v_blocks_team_members" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"name" varchar,
  	"role" varchar,
  	"media_id" uuid,
  	"alt" varchar,
  	"_uuid" varchar
  );
  
  CREATE TABLE "sites_cms"."_pages_v_blocks_team" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"_path" text NOT NULL,
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"heading" varchar,
  	"caption" varchar,
  	"_uuid" varchar,
  	"block_name" varchar
  );
  
  ALTER TABLE "sites_cms"."site_settings" ALTER COLUMN "typography" SET DEFAULT 'condensed-display';
  ALTER TABLE "sites_cms"."_site_settings_v" ALTER COLUMN "version_typography" SET DEFAULT 'condensed-display';
  ALTER TABLE "sites_cms"."pages_blocks_hero" ADD COLUMN "video_id" uuid;
  ALTER TABLE "sites_cms"."_pages_v_blocks_hero" ADD COLUMN "video_id" uuid;
  ALTER TABLE "sites_cms"."pages_blocks_menu_board" ADD CONSTRAINT "pages_blocks_menu_board_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."pages"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."pages_blocks_video_feature" ADD CONSTRAINT "pages_blocks_video_feature_video_id_media_id_fk" FOREIGN KEY ("video_id") REFERENCES "sites_cms"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "sites_cms"."pages_blocks_video_feature" ADD CONSTRAINT "pages_blocks_video_feature_poster_id_media_id_fk" FOREIGN KEY ("poster_id") REFERENCES "sites_cms"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "sites_cms"."pages_blocks_video_feature" ADD CONSTRAINT "pages_blocks_video_feature_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."pages"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."pages_blocks_team_members" ADD CONSTRAINT "pages_blocks_team_members_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "sites_cms"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "sites_cms"."pages_blocks_team_members" ADD CONSTRAINT "pages_blocks_team_members_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."pages_blocks_team"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."pages_blocks_team" ADD CONSTRAINT "pages_blocks_team_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."pages"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."_pages_v_blocks_menu_board" ADD CONSTRAINT "_pages_v_blocks_menu_board_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."_pages_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."_pages_v_blocks_video_feature" ADD CONSTRAINT "_pages_v_blocks_video_feature_video_id_media_id_fk" FOREIGN KEY ("video_id") REFERENCES "sites_cms"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "sites_cms"."_pages_v_blocks_video_feature" ADD CONSTRAINT "_pages_v_blocks_video_feature_poster_id_media_id_fk" FOREIGN KEY ("poster_id") REFERENCES "sites_cms"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "sites_cms"."_pages_v_blocks_video_feature" ADD CONSTRAINT "_pages_v_blocks_video_feature_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."_pages_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."_pages_v_blocks_team_members" ADD CONSTRAINT "_pages_v_blocks_team_members_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "sites_cms"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "sites_cms"."_pages_v_blocks_team_members" ADD CONSTRAINT "_pages_v_blocks_team_members_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."_pages_v_blocks_team"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "sites_cms"."_pages_v_blocks_team" ADD CONSTRAINT "_pages_v_blocks_team_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "sites_cms"."_pages_v"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "pages_blocks_menu_board_order_idx" ON "sites_cms"."pages_blocks_menu_board" USING btree ("_order");
  CREATE INDEX "pages_blocks_menu_board_parent_id_idx" ON "sites_cms"."pages_blocks_menu_board" USING btree ("_parent_id");
  CREATE INDEX "pages_blocks_menu_board_path_idx" ON "sites_cms"."pages_blocks_menu_board" USING btree ("_path");
  CREATE INDEX "pages_blocks_video_feature_order_idx" ON "sites_cms"."pages_blocks_video_feature" USING btree ("_order");
  CREATE INDEX "pages_blocks_video_feature_parent_id_idx" ON "sites_cms"."pages_blocks_video_feature" USING btree ("_parent_id");
  CREATE INDEX "pages_blocks_video_feature_path_idx" ON "sites_cms"."pages_blocks_video_feature" USING btree ("_path");
  CREATE INDEX "pages_blocks_video_feature_video_idx" ON "sites_cms"."pages_blocks_video_feature" USING btree ("video_id");
  CREATE INDEX "pages_blocks_video_feature_poster_idx" ON "sites_cms"."pages_blocks_video_feature" USING btree ("poster_id");
  CREATE INDEX "pages_blocks_team_members_order_idx" ON "sites_cms"."pages_blocks_team_members" USING btree ("_order");
  CREATE INDEX "pages_blocks_team_members_parent_id_idx" ON "sites_cms"."pages_blocks_team_members" USING btree ("_parent_id");
  CREATE INDEX "pages_blocks_team_members_media_idx" ON "sites_cms"."pages_blocks_team_members" USING btree ("media_id");
  CREATE INDEX "pages_blocks_team_order_idx" ON "sites_cms"."pages_blocks_team" USING btree ("_order");
  CREATE INDEX "pages_blocks_team_parent_id_idx" ON "sites_cms"."pages_blocks_team" USING btree ("_parent_id");
  CREATE INDEX "pages_blocks_team_path_idx" ON "sites_cms"."pages_blocks_team" USING btree ("_path");
  CREATE INDEX "_pages_v_blocks_menu_board_order_idx" ON "sites_cms"."_pages_v_blocks_menu_board" USING btree ("_order");
  CREATE INDEX "_pages_v_blocks_menu_board_parent_id_idx" ON "sites_cms"."_pages_v_blocks_menu_board" USING btree ("_parent_id");
  CREATE INDEX "_pages_v_blocks_menu_board_path_idx" ON "sites_cms"."_pages_v_blocks_menu_board" USING btree ("_path");
  CREATE INDEX "_pages_v_blocks_video_feature_order_idx" ON "sites_cms"."_pages_v_blocks_video_feature" USING btree ("_order");
  CREATE INDEX "_pages_v_blocks_video_feature_parent_id_idx" ON "sites_cms"."_pages_v_blocks_video_feature" USING btree ("_parent_id");
  CREATE INDEX "_pages_v_blocks_video_feature_path_idx" ON "sites_cms"."_pages_v_blocks_video_feature" USING btree ("_path");
  CREATE INDEX "_pages_v_blocks_video_feature_video_idx" ON "sites_cms"."_pages_v_blocks_video_feature" USING btree ("video_id");
  CREATE INDEX "_pages_v_blocks_video_feature_poster_idx" ON "sites_cms"."_pages_v_blocks_video_feature" USING btree ("poster_id");
  CREATE INDEX "_pages_v_blocks_team_members_order_idx" ON "sites_cms"."_pages_v_blocks_team_members" USING btree ("_order");
  CREATE INDEX "_pages_v_blocks_team_members_parent_id_idx" ON "sites_cms"."_pages_v_blocks_team_members" USING btree ("_parent_id");
  CREATE INDEX "_pages_v_blocks_team_members_media_idx" ON "sites_cms"."_pages_v_blocks_team_members" USING btree ("media_id");
  CREATE INDEX "_pages_v_blocks_team_order_idx" ON "sites_cms"."_pages_v_blocks_team" USING btree ("_order");
  CREATE INDEX "_pages_v_blocks_team_parent_id_idx" ON "sites_cms"."_pages_v_blocks_team" USING btree ("_parent_id");
  CREATE INDEX "_pages_v_blocks_team_path_idx" ON "sites_cms"."_pages_v_blocks_team" USING btree ("_path");
  ALTER TABLE "sites_cms"."pages_blocks_hero" ADD CONSTRAINT "pages_blocks_hero_video_id_media_id_fk" FOREIGN KEY ("video_id") REFERENCES "sites_cms"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "sites_cms"."_pages_v_blocks_hero" ADD CONSTRAINT "_pages_v_blocks_hero_video_id_media_id_fk" FOREIGN KEY ("video_id") REFERENCES "sites_cms"."media"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "pages_blocks_hero_video_idx" ON "sites_cms"."pages_blocks_hero" USING btree ("video_id");
  CREATE INDEX "_pages_v_blocks_hero_video_idx" ON "sites_cms"."_pages_v_blocks_hero" USING btree ("video_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`

   ALTER TABLE "sites_cms"."pages_blocks_menu_board" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "sites_cms"."pages_blocks_video_feature" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "sites_cms"."pages_blocks_team_members" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "sites_cms"."pages_blocks_team" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "sites_cms"."_pages_v_blocks_menu_board" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "sites_cms"."_pages_v_blocks_video_feature" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "sites_cms"."_pages_v_blocks_team_members" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "sites_cms"."_pages_v_blocks_team" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "sites_cms"."pages_blocks_menu_board" CASCADE;
  DROP TABLE "sites_cms"."pages_blocks_video_feature" CASCADE;
  DROP TABLE "sites_cms"."pages_blocks_team_members" CASCADE;
  DROP TABLE "sites_cms"."pages_blocks_team" CASCADE;
  DROP TABLE "sites_cms"."_pages_v_blocks_menu_board" CASCADE;
  DROP TABLE "sites_cms"."_pages_v_blocks_video_feature" CASCADE;
  DROP TABLE "sites_cms"."_pages_v_blocks_team_members" CASCADE;
  DROP TABLE "sites_cms"."_pages_v_blocks_team" CASCADE;
  ALTER TABLE "sites_cms"."pages_blocks_hero" DROP CONSTRAINT "pages_blocks_hero_video_id_media_id_fk";
  
  ALTER TABLE "sites_cms"."_pages_v_blocks_hero" DROP CONSTRAINT "_pages_v_blocks_hero_video_id_media_id_fk";
  
  DROP INDEX "sites_cms"."pages_blocks_hero_video_idx";
  DROP INDEX "sites_cms"."_pages_v_blocks_hero_video_idx";
  ALTER TABLE "sites_cms"."pages_blocks_hero" DROP COLUMN "video_id";
  ALTER TABLE "sites_cms"."_pages_v_blocks_hero" DROP COLUMN "video_id";`)
}
