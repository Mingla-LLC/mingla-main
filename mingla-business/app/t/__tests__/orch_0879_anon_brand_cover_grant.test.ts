/**
 * ORCH-0879 [Public trip page anon cannot read brand cover_media_url] —
 * implementor happy-path regression test per ORCH-0840 [Regression-test
 * enforcement + append-only CI].
 *
 * Pins the two-part fix:
 *   1. Migration `20260617000000_orch_0879_anon_brand_cover_grant.sql`
 *      GRANTs anon SELECT on brands.cover_media_url + brands.cover_media_type,
 *      and the self-verification probe enforces both grants exist.
 *   2. `app/t/[brandSlug]/[tripSlug].tsx` error-state UI surfaces the
 *      actual error message from PostgrestError-shaped objects (was
 *      previously gated on `instanceof Error` which hid every Supabase
 *      error behind the generic "Check your connection" fallback).
 *
 * Without the migration, anon visitors to /t/<brand>/<trip> see
 * "Couldn't load trip" because the SELECT including cover_media_url is
 * rejected with `42501 permission denied for table brands`. Without the
 * UI fix, that error is invisible — debugging requires direct DB probing.
 *
 * Fails-on-revert verified at 13d36b77 (the ORCH-0878 close commit; the
 * tree state immediately before the ORCH-0879 fix). If either the GRANT
 * line is removed from the migration or the `instanceof Error` check
 * returns in the route, this test fails.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(__dirname, "..", "..", "..", "..");

function readFile(rel: string): string {
  return readFileSync(join(REPO_ROOT, rel), "utf8");
}

describe("ORCH-0879 — anon GRANT on brands cover-media columns + error UI surfaces real message", () => {
  const MIGRATION = readFile(
    "supabase/migrations/20260617000000_orch_0879_anon_brand_cover_grant.sql",
  );
  const ROUTE = readFile(
    "mingla-business/app/t/[brandSlug]/[tripSlug].tsx",
  );

  test("migration grants anon SELECT on cover_media_url + cover_media_type", () => {
    expect(MIGRATION).toMatch(
      /GRANT\s+SELECT\s*\(\s*cover_media_url\s*,\s*cover_media_type\s*\)\s+ON\s+public\.brands\s+TO\s+anon\s*;/,
    );
  });

  test("migration self-verification probe asserts both grants land", () => {
    expect(MIGRATION).toContain("information_schema.column_privileges");
    expect(MIGRATION).toContain("grantee = 'anon'");
    expect(MIGRATION).toContain("privilege_type = 'SELECT'");
    expect(MIGRATION).toMatch(/grant_count\s*!=\s*2/);
  });

  test("migration reloads PostgREST schema cache after grant", () => {
    expect(MIGRATION).toContain("NOTIFY pgrst, 'reload schema'");
  });

  test("trip route error UI no longer gates on `instanceof Error`", () => {
    expect(ROUTE).not.toMatch(/query\.error\s+instanceof\s+Error/);
  });

  test("trip route error UI extracts .message from PostgrestError-shaped objects", () => {
    expect(ROUTE).toContain('"message" in rawError');
    expect(ROUTE).toMatch(/\(rawError as \{ message: string \}\)\.message/);
  });

  test("trip route error UI keeps generic fallback for non-object errors", () => {
    expect(ROUTE).toContain('"Check your connection and try again."');
  });
});
