import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/*
 * #3149 wave 4 — the sixth page role, ALONE IN ITS OWN MIGRATION.
 *
 * Postgres refuses to USE a new enum value in the transaction that ADDED it:
 * `unsafe use of new value ... of enum type`. This exact trap already produced
 * a broken migration on #2830, which is why `20260908_152600` exists and says
 * the same thing. Splitting the ADD VALUEs into a file of their own commits
 * them before anything can reference them, and NOTHING in this file uses the
 * value it adds.
 *
 * BOTH enums. Payload keeps drafts in a parallel `_pages_v` table with its own
 * enum type, and missing that one produces the worst possible failure shape:
 * the page saves, the DRAFT write fails, and the publish reads a version row
 * that does not exist. `enum__pages_v_version_role` is not optional.
 *
 * `IF NOT EXISTS` so a re-run is a no-op. No table is rewritten, no row is
 * read, and no existing value is touched — adding a value to an enum does not
 * revalidate the columns that use it.
 *
 * NOT APPLIED BY THE AUTHOR.
 */

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  ALTER TYPE "sites_cms"."enum_pages_role" ADD VALUE IF NOT EXISTS 'reservations';
  ALTER TYPE "sites_cms"."enum__pages_v_version_role" ADD VALUE IF NOT EXISTS 'reservations';`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  /*
   * DELIBERATELY EMPTY, and this is the honest choice rather than a lazy one.
   *
   * Postgres cannot drop a value from an enum. Undoing this means recreating
   * both types and rewriting every column that uses them — which, if any page
   * has meanwhile been given the `reservations` role, DESTROYS that page's row
   * and its entire version history. An unused extra value in an enum costs
   * nothing; a down migration that silently deletes a customer's page costs
   * a great deal.
   */
}
