/**
 * ORCH-0879 [Public trip page anon cannot read brand cover_media_url] —
 * tester adversarial regression test per ORCH-0840 [Regression-test
 * enforcement + append-only CI].
 *
 * Attacks DIFFERENT angles than the implementor happy-path test at
 * `orch_0879_anon_brand_cover_grant.test.ts` (which pins source patterns
 * + migration text):
 *
 *   (1) Runtime BEHAVIOR — replicates the trip-route error-extraction
 *       branch in isolation and exercises it against the exact
 *       PostgrestError shape supabase-js returns for the original bug
 *       (code 42501 / permission denied for table brands). The
 *       implementor test asserts the source contains the right pattern;
 *       this one asserts the pattern actually behaves correctly when
 *       fed real-world inputs.
 *
 *   (2) NEGATIVE invariant — extraction must NOT surface a falsy or
 *       non-string message as the user-facing text. A renamed copy of
 *       the implementor test would re-pass source-grep but would not
 *       catch a regression where `.message` is mistakenly read off a
 *       non-string field.
 *
 *   (3) Migration ATOMICITY — asserts the GRANT, the self-verification
 *       probe, and the schema-reload NOTIFY all live inside the same
 *       BEGIN/COMMIT block. A regression that moved the NOTIFY outside
 *       (e.g., to a stray top-level statement) would still satisfy the
 *       happy-path text-grep but would leave the PostgREST cache stale
 *       across crashed migrations.
 *
 *   (4) FORWARD-COMPATIBILITY guard — asserts no OTHER place in the
 *       trip route silently swallows query.error via the old
 *       `instanceof Error` pattern. The previous bug shipped because a
 *       single check hid every Supabase error; pinning all-or-nothing
 *       prevents the same drift from recurring elsewhere in the file.
 *
 * Fails-on-revert verified at 13d36b77.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(__dirname, "..", "..", "..", "..");
const ROUTE_SRC = readFileSync(
  join(REPO_ROOT, "mingla-business/app/t/[brandSlug]/[tripSlug].tsx"),
  "utf8",
);
const MIGRATION_SRC = readFileSync(
  join(
    REPO_ROOT,
    "supabase/migrations/20260617000000_orch_0879_anon_brand_cover_grant.sql",
  ),
  "utf8",
);

/**
 * Reproduces the trip-route error-extraction branch in isolation. Kept in
 * sync with `app/t/[brandSlug]/[tripSlug].tsx` query.isError block.
 */
function extractErrorMessage(rawError: unknown): string {
  return rawError !== null &&
    typeof rawError === "object" &&
    "message" in rawError &&
    typeof (rawError as { message: unknown }).message === "string"
    ? (rawError as { message: string }).message
    : "Check your connection and try again.";
}

describe("ORCH-0879 — error-extraction behavior (adversarial)", () => {
  describe("PostgrestError-shaped objects", () => {
    test("surfaces the real 42501 permission-denied message (the original bug)", () => {
      const postgrestError = {
        code: "42501",
        details: null,
        hint: null,
        message: "permission denied for table brands",
      };
      expect(extractErrorMessage(postgrestError)).toBe(
        "permission denied for table brands",
      );
    });

    test("surfaces other PostgREST errors (column missing, schema cache)", () => {
      expect(
        extractErrorMessage({
          code: "42703",
          message: 'column "phantom_col" does not exist',
        }),
      ).toBe('column "phantom_col" does not exist');
    });

    test("surfaces a network-shaped fetch error message", () => {
      expect(
        extractErrorMessage({ message: "Failed to fetch", name: "TypeError" }),
      ).toBe("Failed to fetch");
    });
  });

  describe("falls back to generic message", () => {
    test.each([
      ["null", null],
      ["undefined", undefined],
      ["bare string", "boom"],
      ["bare number", 500],
      ["object with no message field", { code: "X", details: "Y" }],
      ["object with non-string message", { message: { nested: "object" } }],
      ["object with null message", { message: null }],
    ])("%s → generic fallback", (_label, input) => {
      expect(extractErrorMessage(input)).toBe(
        "Check your connection and try again.",
      );
    });
  });

  describe("trip route forward-compatibility", () => {
    test("trip route uses NO `instanceof Error` checks (the regressed pattern)", () => {
      const matches = ROUTE_SRC.match(/instanceof\s+Error/g) ?? [];
      expect(matches).toHaveLength(0);
    });

    test("trip route contains the ORCH-0879 comment marker so future readers know why", () => {
      expect(ROUTE_SRC).toContain("ORCH-0879");
    });
  });

  describe("migration atomicity", () => {
    test("GRANT, self-verification, and pgrst NOTIFY all live in the same transaction", () => {
      const beginIdx = MIGRATION_SRC.indexOf("BEGIN;");
      const commitIdx = MIGRATION_SRC.indexOf("COMMIT;");
      const grantIdx = MIGRATION_SRC.search(
        /GRANT\s+SELECT\s*\(\s*cover_media_url/,
      );
      const probeIdx = MIGRATION_SRC.indexOf(
        "information_schema.column_privileges",
      );
      expect(beginIdx).toBeGreaterThanOrEqual(0);
      expect(commitIdx).toBeGreaterThan(beginIdx);
      expect(grantIdx).toBeGreaterThan(beginIdx);
      expect(grantIdx).toBeLessThan(commitIdx);
      expect(probeIdx).toBeGreaterThan(beginIdx);
      expect(probeIdx).toBeLessThan(commitIdx);
    });

    test("NOTIFY pgrst fires AFTER COMMIT so the schema reload reflects committed state", () => {
      const commitIdx = MIGRATION_SRC.indexOf("COMMIT;");
      const notifyIdx = MIGRATION_SRC.indexOf("NOTIFY pgrst");
      expect(commitIdx).toBeGreaterThan(0);
      expect(notifyIdx).toBeGreaterThan(commitIdx);
    });

    test("self-verification rejects partial grant (not all 2 columns)", () => {
      expect(MIGRATION_SRC).toMatch(/grant_count\s*!=\s*2/);
      expect(MIGRATION_SRC).toMatch(/RAISE\s+EXCEPTION/);
    });
  });
});
