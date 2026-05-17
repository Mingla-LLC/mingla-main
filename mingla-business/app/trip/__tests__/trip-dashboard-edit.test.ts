/**
 * ORCH-0859 [Tr2 Minimum Viable Trip] REWORK 4 — operator dashboard
 * Edit button regression test.
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
 * Fails-on-revert: removing the Edit Pressable or its router.push
 * causes the source-grep assertions below to fail.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "@jest/globals";

const DASHBOARD_SRC = readFileSync(
  join(__dirname, "..", "[id]", "index.tsx"),
  "utf8",
);

describe("ORCH-0859 REWORK 4 — operator dashboard Edit affordance", () => {
  test("renders an Edit Pressable in the header with testID 'trip-dashboard-edit'", () => {
    expect(DASHBOARD_SRC).toMatch(/testID="trip-dashboard-edit"/);
  });

  test("Edit Pressable routes to /trip/{trip.id}/edit regardless of status", () => {
    // The router.push call uses the trip.id from useTrip and appends /edit.
    // Pattern matches both draft and published paths because the route is
    // status-agnostic per REWORK 4 dispatch (wizard handles both cases).
    expect(DASHBOARD_SRC).toMatch(
      /router\.push\(\s*`\/trip\/\$\{trip\.id\}\/edit`\s+as\s+never\s*\)/,
    );
  });

  test("Edit Pressable has status-aware accessibilityLabel", () => {
    // Different label for draft vs published — operator-facing UX.
    expect(DASHBOARD_SRC).toMatch(/Continue editing trip/);
    expect(DASHBOARD_SRC).toMatch(/Edit published trip/);
  });

  test("Edit button text reads 'Edit'", () => {
    // Pin the user-visible copy.
    expect(DASHBOARD_SRC).toMatch(/<Text style=\{styles\.editBtnText\}>Edit<\/Text>/);
  });
});

describe("ORCH-0859 REWORK 4 — Item A diagnostic instrumentation", () => {
  // Item A is intentionally NOT fails-on-revert tested (instrumentation,
  // not behavior). But it MUST carry the DIAG marker so CLOSE's Step 1.5
  // reap removes it cleanly. Pin the marker presence.
  const SERVICE_SRC = readFileSync(
    join(__dirname, "..", "..", "..", "src", "services", "businessEvents.ts"),
    "utf8",
  );

  test("fetchBusinessEventsForBrand carries the ORCH-0859-REWORK-4-DIAG marker", () => {
    expect(SERVICE_SRC).toMatch(/\[ORCH-0859-REWORK-4-DIAG\]/);
  });

  test("diagnostic console.log prints the 4 expected fields", () => {
    const block = SERVICE_SRC.match(
      /\[ORCH-0859-REWORK-4-DIAG\][^]*?fetchBusinessEventsForBrand[^]*?\}\);/,
    );
    expect(block).not.toBeNull();
    expect(block?.[0]).toMatch(/brandId/);
    expect(block?.[0]).toMatch(/rowsCount/);
    expect(block?.[0]).toMatch(/tripIdsCount/);
    expect(block?.[0]).toMatch(/filteredCount/);
  });
});

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
