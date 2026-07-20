// orch_0893_cycle2_legacy_loop_skips_untouched.test
// ORCH-0893 cycle 2 regression test. Closes the operator-reported runtime
// bug "wizard shows up quickly, but still reverts back to home" that the
// cycle-1 hydration-gate rework did NOT close.
//
// Root cause: the legacy migration loop in useServerDraftEvents.ts runs
// whenever useServerDraftsForBrand is active (home.tsx:138 mounts it).
// When /event/create mints a fresh d_<ts36> into Zustand, the loop
// fires createServerDraft and then replaceDraft, removing the d_* from
// Zustand. The edit route's bounce-home guard then fires.
//
// Fix shape (cycle 2):
//   Part 1: legacy loop filter gates on isDraftDirty so freshly-minted
//           untouched d_* drafts are skipped.
//   Part 2: edit-route bounce-home guard scans brand-drafts cache for a
//           swapped server draft whose legacyLocalDraftId matches idParam,
//           navigating to the server uuid instead of bouncing home.
//
// Fails-on-revert verified at the commit captured in the implementation
// report (stash both touched files; 4/4 cases fail).

import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(__dirname, "..", "..", "..", "..");
const HOOK = join(
  REPO_ROOT,
  "mingla-business",
  "src",
  "hooks",
  "useServerDraftEvents.ts",
);
const EDIT_ROUTE = join(
  REPO_ROOT,
  "mingla-business",
  "app",
  "event",
  "[id]",
  "edit.tsx",
);

describe("ORCH-0893 cycle 2 Part 1 — legacy migration loop skips untouched d_* drafts", () => {
  test("useServerDraftEvents.ts imports isDraftDirty from draftDirtyCheck util", () => {
    const source = readFileSync(HOOK, "utf8");
    expect(source).toMatch(
      /import\s+\{\s*isDraftDirty\s*\}\s*from\s+["']\.\.\/utils\/draftDirtyCheck["']/,
    );
  });

  test("useServerDraftsForBrand's legacy-migration filter gates on isDraftDirty", () => {
    const source = readFileSync(HOOK, "utf8");

    // Bound the search to the legacy migration loop block — between the
    // `localDrafts.filter(` opening and the `.forEach(` that follows.
    const filterStart = source.indexOf("localDrafts\n      .filter(");
    expect(filterStart).toBeGreaterThan(-1);
    const filterEnd = source.indexOf(".forEach(", filterStart);
    expect(filterEnd).toBeGreaterThan(filterStart);
    const filterBlock = source.slice(filterStart, filterEnd);

    // The filter MUST include all three predicates:
    //   draft.brandId === brandId
    //   draft.id.startsWith("d_")
    //   isDraftDirty(draft)
    expect(filterBlock).toMatch(/draft\.brandId\s*===\s*brandId/);
    expect(filterBlock).toMatch(/draft\.id\.startsWith\(\s*["']d_["']\s*\)/);
    expect(filterBlock).toMatch(/isDraftDirty\(\s*draft\s*\)/);
  });
});

describe("ORCH-0893 cycle 2 Part 2 — bounce-home safety belt follows replaceDraft swap", () => {
  // Issue #976 [event-name-focus] — Part-2 pins updated ([TEST-MOD-APPROVED
  // ORCH-0976]): the safety belt no longer router.replace's to the swapped id
  // (a screen-replacing navigation remounts the wizard and drops the keyboard
  // mid-type — the exact class the belt existed to recover from). It now
  // adopts the ORCH-1355 no-remount mechanism: store-upsert +ROUTE-state
  // promotion (`setPromotedServerId`) + in-place URL reconcile
  // (`router.setParams`). The order pin's old literal
  // `router.replace("/(tabs)/home" as never)` had also gone stale when the
  // bounce moved to `safeEventsExitRoute()` — it is re-pinned on the real
  // bounce inside the same guard block.
  test("edit.tsx bounce-home guard scans cached brand-drafts lists for legacyLocalDraftId match before bouncing", () => {
    const source = readFileSync(EDIT_ROUTE, "utf8");

    // Bound the search to the bounce-home branch — between the
    // `if (draft === null` predicate and the closing `clearTimeout` cleanup.
    const guardStart = source.indexOf("if (\n      draft === null &&");
    expect(guardStart).toBeGreaterThan(-1);
    const guardEnd = source.indexOf("return (): void => clearTimeout(t)", guardStart);
    expect(guardEnd).toBeGreaterThan(guardStart);
    const guardBlock = source.slice(guardStart, guardEnd);

    // The guard MUST:
    //   (a) gate the safety-belt scan on isLegacyLocalDraftId
    //   (b) call queryClient.getQueriesData with eventDraftKeys.lists() prefix
    //   (c) find a draft whose `legacyLocalDraftId === idParam`
    //   (d) on hit, adopt the swapped draft WITHOUT a screen replace:
    //       setPromotedServerId + router.setParams — and NEVER a
    //       router.replace to `/event/${swapped.id}/edit` (issue #976).
    expect(guardBlock).toMatch(/isLegacyLocalDraftId/);
    expect(guardBlock).toMatch(
      /queryClient\s*\.\s*getQueriesData[\s\S]*?eventDraftKeys\.lists\(\)/,
    );
    expect(guardBlock).toMatch(/legacyLocalDraftId\s*===\s*idParam/);
    expect(guardBlock).toMatch(/setPromotedServerId\s*\(/);
    expect(guardBlock).toMatch(/router\.setParams\s*\(/);
    // Use RegExp constructor to avoid backtick-inside-regex-literal parser issue.
    expect(guardBlock).not.toMatch(
      new RegExp("router\\.replace\\(\\s*`/event/\\$\\{swapped\\.id\\}/edit"),
    );
  });

  test("edit.tsx safety-belt scan executes BEFORE the bounce-home setTimeout (correctness order)", () => {
    const source = readFileSync(EDIT_ROUTE, "utf8");

    // Bound to the same guard block so the order pin cannot accidentally
    // match an earlier safeEventsExitRoute bounce elsewhere in the file.
    const guardStart = source.indexOf("if (\n      draft === null &&");
    expect(guardStart).toBeGreaterThan(-1);
    const guardEnd = source.indexOf("return (): void => clearTimeout(t)", guardStart);
    expect(guardEnd).toBeGreaterThan(guardStart);
    const guardBlock = source.slice(guardStart, guardEnd);

    const safetyBeltIndex = guardBlock.indexOf(
      "queryClient.getQueriesData<DraftEvent[]>",
    );
    const setTimeoutBounceIndex = guardBlock.indexOf(
      "router.replace(safeEventsExitRoute() as never)",
    );

    // The safety belt MUST run BEFORE the setTimeout-bounce. If a future
    // refactor swaps the order, the bounce would fire even when a swapped
    // draft exists — defeating the safety belt.
    expect(safetyBeltIndex).toBeGreaterThan(-1);
    expect(setTimeoutBounceIndex).toBeGreaterThan(-1);
    expect(safetyBeltIndex).toBeLessThan(setTimeoutBounceIndex);
  });
});
