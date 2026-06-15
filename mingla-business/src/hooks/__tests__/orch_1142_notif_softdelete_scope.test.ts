/**
 * ORCH-1142 — IMPLEMENTOR happy-path regression (source-assertion) for the
 * notifications soft-delete scope contract (SPEC §9, invariant I-PROPOSED-BH).
 *
 * Reads the real hook + screen source and asserts the load-bearing invariants:
 *   1. fetchBusinessNotifications EXCLUDES soft-deleted rows AND keeps the
 *      I-PROPOSED-W inclusion clause (`type.like.stripe.%` + `.is("deleted_at"`).
 *   2. clearRead is scoped to READ rows (`.not("read_at", "is", null)`) + the
 *      business-type `.or(...)` + not-already-deleted — it must NOT be a
 *      delete-all and must NOT touch consumer rows.
 *   3. softDelete updates `deleted_at` and targets by `.eq("id"`.
 *   4. The realtime UPDATE handler DROPS soft-deleted rows from cache.
 *   5. The screen reveals full text when expanded (drops the numberOfLines cap)
 *      and demotes the deep-link to an expanded "Open" button.
 *
 * # Fails-on-revert (proven by the implementor via true LINE DELETION):
 *   - Remove `.is("deleted_at", null)` from the fetch        → case 1 RED.
 *   - Widen clearRead to drop the read/business scope        → case 2 RED.
 *   - Drop `deleted_at` from the softDelete update           → case 3 RED.
 *   - Remove the realtime soft-delete drop branch            → case 4 RED.
 *   - Keep numberOfLines={1} when expanded / drop "Open"     → case 5 RED.
 *
 * Append-only post-merge per `.github/workflows/tests-append-only.yml`.
 */
import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const HOOK_SRC = readFileSync(
  join(__dirname, "..", "useBusinessNotifications.ts"),
  "utf8",
);
const SCREEN_SRC = readFileSync(
  join(
    __dirname,
    "..",
    "..",
    "components",
    "notifications",
    "BusinessNotificationsScreen.tsx",
  ),
  "utf8",
);

/** Strip `//` line-comments so a comment mentioning a clause can't satisfy a
 *  code assertion (otherwise fails-on-revert is a false pass). */
function stripLineComments(src: string): string {
  return src
    .split("\n")
    .map((l) => {
      const i = l.indexOf("//");
      return i >= 0 ? l.slice(0, i) : l;
    })
    .join("\n");
}

/** Slice a named function/arrow body (CODE ONLY) so assertions are scoped. */
function sliceFrom(src: string, anchor: string, span = 60): string {
  const idx = src.indexOf(anchor);
  if (idx < 0) throw new Error(`anchor not found: ${anchor}`);
  return stripLineComments(src.slice(idx).split("\n").slice(0, span).join("\n"));
}

describe("ORCH-1142 — notifications soft-delete scope (I-PROPOSED-BH)", () => {
  test("1. fetch excludes soft-deleted rows AND keeps the I-PROPOSED-W clause", () => {
    const fetch = sliceFrom(HOOK_SRC, "async function fetchBusinessNotifications");
    // I-PROPOSED-W inclusion clause intact (verbatim).
    expect(fetch).toContain("type.like.stripe.%");
    expect(fetch).toContain("type.like.business.%");
    // Soft-delete exclusion present.
    expect(fetch).toMatch(/\.is\(\s*["']deleted_at["']\s*,\s*null\s*\)/);
  });

  test("2. clearRead targets READ + business-type rows only (never delete-all, never consumer)", () => {
    const clearRead = sliceFrom(HOOK_SRC, "const clearRead = useCallback");
    // It sets deleted_at (soft-delete) ...
    expect(clearRead).toMatch(/\.update\(\s*\{\s*deleted_at/);
    // ... scoped to READ rows (read_at IS NOT NULL) ...
    expect(clearRead).toMatch(/\.not\(\s*["']read_at["']\s*,\s*["']is["']\s*,\s*null\s*\)/);
    // ... and business-type only (the .or inclusion clause) ...
    expect(clearRead).toContain("type.like.stripe.%");
    expect(clearRead).toContain("type.like.business.%");
    // ... and pinned to this user.
    expect(clearRead).toMatch(/\.eq\(\s*["']user_id["']/);
    // It must NOT be a blanket "all read_at" delete-all without the type scope:
    // the .or(...) above guarantees the scope. Guard against an accidental
    // `.is("read_at", null)` (which would target UNREAD rows).
    expect(clearRead).not.toMatch(/\.is\(\s*["']read_at["']\s*,\s*null\s*\)/);
  });

  test("3. softDelete sets deleted_at and targets by primary key", () => {
    const softDelete = sliceFrom(HOOK_SRC, "const softDelete = useCallback");
    expect(softDelete).toMatch(/\.update\(\s*\{\s*deleted_at/);
    expect(softDelete).toMatch(/\.eq\(\s*["']id["']/);
  });

  test("4. realtime UPDATE drops soft-deleted rows from cache", () => {
    // The drop branch filters the row out when deleted_at is set (code only).
    const code = stripLineComments(HOOK_SRC);
    expect(code).toMatch(/updated\.deleted_at !== null/);
    expect(code).toMatch(/old = \[\]\) =>\s*old\.filter\(\(n\) => n\.id !== updated\.id\)/);
  });

  test("5. screen reveals full text when expanded + demotes deep-link to an Open button", () => {
    // Title/body drop their numberOfLines cap when expanded.
    expect(SCREEN_SRC).toMatch(/numberOfLines=\{expanded \? undefined : 2\}/);
    expect(SCREEN_SRC).toContain("const titleLines = expanded ? undefined : 1;");
    // The expanded "Open" secondary button exists and is gated on deep_link.
    expect(SCREEN_SRC).toContain("expanded && hasDeepLink");
    expect(SCREEN_SRC).toMatch(/accessibilityLabel="Open notification target"/);
    // Tap no longer navigates from the row (Open is the navigate path).
    expect(SCREEN_SRC).toContain("onOpenDeepLink(notification)");
  });
});
