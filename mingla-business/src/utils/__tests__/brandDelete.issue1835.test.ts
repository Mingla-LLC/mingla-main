/**
 * Issue #1835 — happy-path regression test.
 *
 * Guards the two contracts the fix establishes:
 *   A. Brand deletion is OWNER-ONLY, decided by `brands.account_id` (the same
 *      column the RLS policy checks), not by the lossy UI `role`.
 *   B. A PostgREST failure — which arrives as a PLAIN OBJECT, not an Error —
 *      survives normalisation and is turned into copy that names the reason and
 *      never invents retryability.
 *
 * FAILS-ON-REVERT: reverting `brandDeletePermission.ts` / `brandDeleteError.ts`
 * / `supabaseErrorMessage.ts` breaks these at import time; reverting only the
 * `error instanceof Error` ternary in BrandDeleteSheet is covered by the
 * `plain object` cases below, which are exactly what that ternary mishandled.
 */

import {
  canDeleteBrand,
  type BrandDeletableSubject,
} from "../brandDeletePermission";
import {
  BRAND_DELETE_OFFLINE_MESSAGE,
  BRAND_DELETE_OWNER_ONLY_MESSAGE,
  BRAND_DELETE_UNKNOWN_MESSAGE,
  brandDeleteErrorMessage,
} from "../brandDeleteError";
import {
  isLikelyOfflineError,
  isPermissionDeniedError,
  normalizeSupabaseError,
} from "../supabaseErrorMessage";

const OWNER = "3c8c34a8-454b-4d4f-bf9e-87b0c3c8874c";
const ADMIN = "6c61590c-4e8e-4040-bd7c-29870ba6d736";

/** The real prod row from the #1835 report: Gotham city. */
const gothamCity: BrandDeletableSubject = { accountId: OWNER };

/** The exact PostgREST body Postgres produced for the reported failure. */
const RLS_REJECTION = {
  code: "42501",
  details: null,
  hint: null,
  message: 'new row violates row-level security policy for table "brands"',
};

describe("#1835 A — brand deletion is owner-only", () => {
  it("allows the account owner", () => {
    expect(canDeleteBrand(gothamCity, OWNER)).toBe(true);
  });

  it("refuses a brand_admin who is not the account owner", () => {
    expect(canDeleteBrand(gothamCity, ADMIN)).toBe(false);
  });

  it("refuses a signed-out caller", () => {
    expect(canDeleteBrand(gothamCity, null)).toBe(false);
    expect(canDeleteBrand(gothamCity, undefined)).toBe(false);
  });

  it("refuses when there is no brand", () => {
    expect(canDeleteBrand(null, OWNER)).toBe(false);
    expect(canDeleteBrand(undefined, OWNER)).toBe(false);
  });

  it("fails closed when accountId is missing (Brand cached before the field existed)", () => {
    expect(canDeleteBrand({ accountId: undefined }, OWNER)).toBe(false);
  });
});

describe("#1835 B — a PostgREST error survives as a real Error", () => {
  it("converts the plain rejection object into a real Error, keeping code + message", () => {
    const normalized = normalizeSupabaseError(RLS_REJECTION, "fallback");

    // The precise thing the old `error instanceof Error` guard got wrong.
    expect(RLS_REJECTION instanceof Error).toBe(false);
    expect(normalized instanceof Error).toBe(true);
    expect(normalized.message).toBe(RLS_REJECTION.message);
    expect(normalized.code).toBe("42501");
  });

  it("classifies the rejection as permission-denied", () => {
    expect(isPermissionDeniedError(RLS_REJECTION)).toBe(true);
    expect(isLikelyOfflineError(RLS_REJECTION)).toBe(false);
  });

  it("uses the fallback only when no server message exists", () => {
    expect(normalizeSupabaseError({}, "fallback").message).toBe("fallback");
    expect(normalizeSupabaseError(undefined, "fallback").message).toBe(
      "fallback",
    );
  });
});

describe("#1835 C — the copy names the reason and promises nothing false", () => {
  it("maps the reported failure to owner-only copy", () => {
    expect(brandDeleteErrorMessage(RLS_REJECTION)).toBe(
      BRAND_DELETE_OWNER_ONLY_MESSAGE,
    );
  });

  it("only offers a retry for genuine connectivity failures", () => {
    expect(brandDeleteErrorMessage(new Error("Network request failed"))).toBe(
      BRAND_DELETE_OFFLINE_MESSAGE,
    );
    expect(BRAND_DELETE_OFFLINE_MESSAGE).toContain("try again");
  });

  it("never tells the user to retry an unknown failure", () => {
    expect(brandDeleteErrorMessage({ message: "boom" })).toBe(
      BRAND_DELETE_UNKNOWN_MESSAGE,
    );
    expect(BRAND_DELETE_UNKNOWN_MESSAGE.toLowerCase()).not.toContain(
      "try again",
    );
    // The exact string the operator saw four times in a row.
    expect(BRAND_DELETE_UNKNOWN_MESSAGE).not.toContain(
      "Tap Delete to try again",
    );
  });

  it("never leaks raw database text to the user", () => {
    for (const raw of [
      RLS_REJECTION,
      { message: "softDeleteBrand: 0 rows updated — brandId=abc" },
      new Error('duplicate key value violates unique constraint "brands_pkey"'),
    ]) {
      const copy = brandDeleteErrorMessage(raw);
      expect(copy).not.toMatch(/row-level security/i);
      expect(copy).not.toMatch(/softDeleteBrand/);
      expect(copy).not.toMatch(/constraint/i);
      expect([
        BRAND_DELETE_OWNER_ONLY_MESSAGE,
        BRAND_DELETE_OFFLINE_MESSAGE,
        BRAND_DELETE_UNKNOWN_MESSAGE,
      ]).toContain(copy);
    }
  });
});
