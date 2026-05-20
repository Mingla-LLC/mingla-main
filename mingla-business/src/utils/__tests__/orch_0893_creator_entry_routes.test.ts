/**
 * orch_0893_creator_entry_routes.test — ORCH-0893
 * [Eager server-draft on creator entry — replace with client-id + lazy autosave].
 *
 * Second implementor regression test, at a DIFFERENT angle from
 * `draftDirtyCheck.test.ts` (which exercises the dirty-gate primitive).
 * This test attacks the SOURCE TEXT of the two create routes to assert
 * the contract: NO entry-blocking server mutation token may appear in
 * the file body outside an allowlist comment, AND the route must
 * `router.replace` to a `d_<ts36>` resume URL.
 *
 * Mirrors the I-PROPOSED-CREATOR-ENTRY-IS-INSTANT strict-grep CI gate
 * (`.github/scripts/strict-grep/i-proposed-creator-entry-is-instant.mjs`)
 * as a jest-runnable check so failures surface in `npm test` not just in
 * CI.
 *
 * Fails-on-revert: when `app/event/create.tsx` or `app/trip/create.tsx`
 * is reverted to the pre-ORCH-0893 eager-mutation shape, the forbidden
 * tokens reappear and these tests fail. Verified at implementation
 * time with `git stash` of the two files — the strict-grep CLI yields
 * 8 violations across 3 files (the gate's exit code 1).
 *
 * Per SPEC §11 + §13 + §10 SC-1-web / SC-2.
 */

import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(__dirname, "..", "..", "..", "..");
const EVENT_CREATE = join(REPO_ROOT, "mingla-business", "app", "event", "create.tsx");
const TRIP_CREATE = join(REPO_ROOT, "mingla-business", "app", "trip", "create.tsx");

const FORBIDDEN_TOKENS = [
  "useMutation",
  "mutateAsync",
  "useCreateServerDraft",
  "useCreateTripDraft",
  "createServerDraft",
  "createTripDraft",
] as const;

const ALLOWLIST_TAG = "orch-strict-grep-allow creator-entry-is-instant";

function readNonCommentLines(filePath: string): { line: string; lineNumber: number }[] {
  const source = readFileSync(filePath, "utf8");
  return source.split("\n").map((line, idx) => ({ line, lineNumber: idx + 1 }));
}

function isCommentLine(line: string): boolean {
  return /^\s*(\/\/|\*|\/\*)/.test(line);
}

function hasAllowlistAbove(
  lines: { line: string; lineNumber: number }[],
  index: number,
): boolean {
  for (let k = index - 1; k >= Math.max(0, index - 5); k -= 1) {
    if (lines[k].line.includes(ALLOWLIST_TAG)) return true;
  }
  return false;
}

describe("ORCH-0893 creator entry route source contract — no entry-blocking server mutation", () => {
  test("app/event/create.tsx contains zero forbidden tokens outside allowlist", () => {
    const lines = readNonCommentLines(EVENT_CREATE);
    const violations: string[] = [];
    for (let i = 0; i < lines.length; i += 1) {
      const { line, lineNumber } = lines[i];
      if (isCommentLine(line)) continue;
      for (const token of FORBIDDEN_TOKENS) {
        const re = new RegExp(`\\b${token}\\b`);
        if (re.test(line) && !hasAllowlistAbove(lines, i)) {
          violations.push(`event/create.tsx:${lineNumber}: ${token}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  test("app/trip/create.tsx contains zero forbidden tokens outside allowlist", () => {
    const lines = readNonCommentLines(TRIP_CREATE);
    const violations: string[] = [];
    for (let i = 0; i < lines.length; i += 1) {
      const { line, lineNumber } = lines[i];
      if (isCommentLine(line)) continue;
      for (const token of FORBIDDEN_TOKENS) {
        const re = new RegExp(`\\b${token}\\b`);
        if (re.test(line) && !hasAllowlistAbove(lines, i)) {
          violations.push(`trip/create.tsx:${lineNumber}: ${token}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  test("app/event/create.tsx router.replace target is the d_<ts36> resume URL", () => {
    const source = readFileSync(EVENT_CREATE, "utf8");
    // Asserts the route calls router.replace to /event/${draft.id}/edit?step=0
    // where draft is produced by the synchronous Zustand createDraft action
    // (the `d_*` id-generating path).
    expect(source).toMatch(/router\.replace\(\s*`\/event\/\$\{draft\.id\}\/edit\?step=0`/);
    expect(source).toMatch(/useDraftEventStore.*createDraft/s);
  });

  test("app/trip/create.tsx router.replace target uses a generateDraftId client-side id", () => {
    const source = readFileSync(TRIP_CREATE, "utf8");
    // Asserts the route imports generateDraftId and calls router.replace
    // with the client-minted id (not a server-fetched id).
    expect(source).toMatch(/from\s+["']\.\.\/\.\.\/src\/utils\/draftEventId["']/);
    expect(source).toMatch(/generateDraftId\(\)/);
    expect(source).toMatch(/router\.replace\(\s*`\/trip\/\$\{clientId\}\/edit`/);
  });
});
