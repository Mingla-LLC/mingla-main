/**
 * ORCH-0859 [Tr2 Minimum Viable Trip] REWORK 4 + ORCH-0913 — operator
 * dashboard Edit affordance regression test.
 *
 * Operator's RETEST 4 smoke surfaced: no way to edit a trip in either
 * draft or published phase from the operator dashboard. REWORK 4 adds
 * an Edit header button that routes to /trip/{id}/edit regardless of
 * status. Wizard host at app/trip/[id]/edit.tsx already loads via
 * useTrip and populates all 5 steps; for published trips re-tapping
 * Publish updates all fields except slug (slug-immutability already
 * enforced by biz_prevent_event_slug_change trigger from ORCH-0763 +
 * dual-flag fix from ORCH-0859 REWORK 3).
 *
 * ORCH-0913 moved Edit from the header Pressable into the primary action
 * tile. The route contract remains /trip/{id}/edit.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "@jest/globals";

const DASHBOARD_SRC = readFileSync(
  join(__dirname, "..", "[id]", "index.tsx"),
  "utf8",
);

describe("ORCH-0859 REWORK 4 — operator dashboard Edit affordance", () => {
  test("renders Edit as a primary dashboard action tile", () => {
    expect(DASHBOARD_SRC).toMatch(
      /<ActionTile[\s\S]*?icon="edit"[\s\S]*?primary[\s\S]*?router\.push\(\s*`\/trip\/\$\{trip\.id\}\/edit`/,
    );
  });

  test("Edit Pressable routes to /trip/{trip.id}/edit regardless of status", () => {
    // The router.push call uses the trip.id from useTrip and appends /edit.
    // Pattern matches both draft and published paths because the route is
    // status-agnostic per REWORK 4 dispatch (wizard handles both cases).
    expect(DASHBOARD_SRC).toMatch(
      /router\.push\(\s*`\/trip\/\$\{trip\.id\}\/edit`\s+as\s+never\s*\)/,
    );
  });

  test("Edit tile label is status-aware", () => {
    expect(DASHBOARD_SRC).toMatch(/Continue editing/);
    expect(DASHBOARD_SRC).toMatch(/Edit trip/);
  });

  test("Edit primary-tile divergence is documented", () => {
    expect(DASHBOARD_SRC).toContain("[ORCH-0913 deliberate divergence from event]");
  });
});

// [REAPED at ORCH-0859 CLOSE 2026-05-17] — the prior "ORCH-0859 REWORK 4 —
// Item A diagnostic instrumentation" describe block (2 test cases) is removed
// in the same commit as the DIAG marker reap at businessEvents.ts:508-519.
// The block was instrumentation-only and explicitly self-described as
// "intentionally NOT fails-on-revert tested" — it existed only to gate the
// CLOSE Step 1.5 reap, which has now run. [TEST-MOD-APPROVED ORCH-0859]
// per .github/workflows/tests-append-only.yml.

describe("ORCH-0859 REWORK 4 — Item C Maestro gate", () => {
  test("canonical events-tab-no-trip-leak Maestro flow exists", () => {
    const flowPath = join(
      __dirname,
      "..",
      "..",
      "..",
      "maestro",
      "tr2-events-tab-no-trip-leak.yaml",
    );
    const flow = readFileSync(flowPath, "utf8");
    // Asserts the flow cycles all 5 filters and asserts no trip leak.
    expect(flow).toMatch(/text: "All"/);
    expect(flow).toMatch(/text: "Live"/);
    expect(flow).toMatch(/text: "Upcoming"/);
    expect(flow).toMatch(/text: "Drafts"/);
    expect(flow).toMatch(/text: "Past"/);
    // Five assertNotVisible for the trip title (one per filter).
    const assertions = flow.match(/assertNotVisible/g);
    expect((assertions ?? []).length).toBeGreaterThanOrEqual(5);
    // Plus a positive cross-check on the Trips sub-tab.
    expect(flow).toMatch(/assertVisible/);
  });
});
