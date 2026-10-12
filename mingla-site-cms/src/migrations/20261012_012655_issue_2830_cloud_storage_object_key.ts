import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/*
 * #2830 — the column Payload 3.90.2 reads on every `media` query.
 *
 * `@payloadcms/plugin-cloud-storage` 3.90.2 adds a hidden text field
 * `_objectKey` to every upload collection it manages; 3.88.0 had no such
 * field. The dependency bump shipped without a migration, so every Payload
 * read of `media` failed in Postgres with `column "_objectkey" does not exist`
 * — the retention sweep first, because nothing else had called it.
 *
 * `media` is the only upload collection, so this is the only table.
 *
 * WHERE THE STATEMENT COMES FROM. `payload migrate:create` on 3.90.2 emits
 * `ALTER TABLE "sites_cms"."media" ADD COLUMN "_objectkey" varchar;` and a dry
 * drizzle-kit push against a database built from the committed migrations
 * (which matches production exactly) emits the same statement. The identifier
 * is `_objectkey` — no underscore before `key` — because that is what the
 * adapter's snake-casing makes of a leading-underscore name. Do not "correct"
 * it to `_object_key`: the adapter selects `_objectkey`.
 *
 * WHAT WAS LEFT OUT, ON PURPOSE. `migrate:create` diffs the config against the
 * newest snapshot `.json` in this directory, not against a database. The four
 * #3149 migrations were hand-written without snapshots, so the raw output also
 * re-created everything they already created, and two statements that DESTROY
 * data:
 *
 *   ALTER TABLE "sites_cms"."pages_blocks_venue_reservation" DROP COLUMN "reservation_target_id";
 *   ALTER TABLE "sites_cms"."_pages_v_blocks_venue_reservation" DROP COLUMN "reservation_target_id";
 *
 * That field was removed from the block by #3149 (PR #3167) and the column was
 * left in place; an unread nullable column costs nothing, and dropping it is not
 * this repair's decision. None of that is here. The snapshot beside this file
 * IS the full 3.90.2 schema, so the next `migrate:create` starts from the truth
 * and does not offer those drops again.
 *
 * Nullable, no default, no index: no table rewrite, no row read, and
 * `IF NOT EXISTS` makes a second run a no-op.
 *
 * NOT APPLIED BY THE AUTHOR.
 */

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "sites_cms"."media" ADD COLUMN IF NOT EXISTS "_objectkey" varchar;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "sites_cms"."media" DROP COLUMN IF EXISTS "_objectkey";`)
}
