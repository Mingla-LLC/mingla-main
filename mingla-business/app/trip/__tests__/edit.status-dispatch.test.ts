/**
 * ORCH-0876 [Trip CRUD + Purchase Flow Completion] — implementor happy-path
 * regression test per ORCH-0840 [Regression-test enforcement + append-only CI].
 *
 * Pins `app/trip/[id]/edit.tsx` status-based dispatch:
 *
 *   - status === "scheduled" || "live"     → <EditPublishedTripScreen>
 *   - status === "ended" || "cancelled"    → read-only empty state with
 *                                            "Back to trip" CTA
 *   - status === "draft" (default branch)  → <TripCreatorWizard>
 *
 * The original S-1 / S-2 / S-3 investigation surfaced a single-mode route
 * that ALWAYS rendered TripCreatorWizard regardless of status — published
 * operators had no Save flow, no Cover edit. Any refactor that collapses
 * the dispatch back to a single branch fails this test.
 *
 * Spec: SPEC_ORCH-0876_V2_FULL_PARITY §6 + §7.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const APP_ROOT = join(__dirname, "..", "..", "..", "app");
function readApp(rel: string): string {
  return readFileSync(join(APP_ROOT, rel), "utf8");
}

describe("ORCH-0876 — /trip/[id]/edit status-based dispatch", () => {
  const SRC = readApp("trip/[id]/edit.tsx");

  test("imports EditPublishedTripScreen + TripCreatorWizard", () => {
    expect(SRC).toContain(
      'import { TripCreatorWizard } from "../../../src/components/trip/TripCreatorWizard"',
    );
    expect(SRC).toContain(
      'import { EditPublishedTripScreen } from "../../../src/components/trip/EditPublishedTripScreen"',
    );
  });

  test("scheduled OR live trips route to EditPublishedTripScreen", () => {
    expect(SRC).toMatch(
      /if \(trip\.status === "scheduled" \|\| trip\.status === "live"\) \{\s*return <EditPublishedTripScreen trip=\{trip\} \/>;/,
    );
  });

  test("ended OR cancelled trips render the read-only empty state", () => {
    expect(SRC).toMatch(
      /if \(trip\.status === "ended" \|\| trip\.status === "cancelled"\) \{/,
    );
    // Both copy variants must be present.
    expect(SRC).toContain("This trip has ended");
    expect(SRC).toContain("This trip is cancelled");
  });

  test("read-only branch ships a 'Back to trip' Button (not a dead screen)", () => {
    expect(SRC).toMatch(/<Button[\s\S]*?label="Back to trip"/);
    expect(SRC).toMatch(/accessibilityLabel="Back to trip"/);
    expect(SRC).toMatch(/testID="trip-edit-readonly-back"/);
  });

  test("default branch (draft) renders TripCreatorWizard with isCreateMode + onDiscardTrip wired", () => {
    expect(SRC).toMatch(/<TripCreatorWizard\b[\s\S]*?isCreateMode=\{isCreateMode\}/);
    expect(SRC).toMatch(/<TripCreatorWizard\b[\s\S]*?onDiscardTrip=\{async \(\)/);
  });

  test("dispatch order is explicit: scheduled/live first, then ended/cancelled, then default wizard", () => {
    const editIdx = SRC.indexOf('"scheduled" || trip.status === "live"');
    const endedIdx = SRC.indexOf('"ended" || trip.status === "cancelled"');
    const wizardIdx = SRC.indexOf("<TripCreatorWizard");
    expect(editIdx).toBeGreaterThan(-1);
    expect(endedIdx).toBeGreaterThan(-1);
    expect(wizardIdx).toBeGreaterThan(-1);
    expect(editIdx).toBeLessThan(endedIdx);
    expect(endedIdx).toBeLessThan(wizardIdx);
  });

  test("isCreateMode flag still applies the pre-existing pristine-draft rule", () => {
    // Per ORCH-0874 [Trip surfaces visual parity with Events]: isCreateMode is
    // true ONLY for a freshly-created draft with no edits yet (title === "" +
    // 0 days + 0 inclusions). The Phase 3b dispatch refactor must not
    // accidentally widen this rule.
    expect(SRC).toMatch(
      /const isCreateMode\s*=[\s\S]*?trip\.status === "draft"[\s\S]*?trip\.title\.length === 0[\s\S]*?trip\.days\.length === 0[\s\S]*?trip\.inclusions\.length === 0/,
    );
  });

  test("loading + error + not-found states still render bare-View shells (don't route through editor)", () => {
    // Pre-flight defensive states must NOT delegate to either editor when the
    // trip query hasn't resolved yet — that would crash on `trip.status`.
    expect(SRC).toContain('if (tripQuery.isLoading)');
    expect(SRC).toContain('if (tripQuery.isError)');
    expect(SRC).toContain('if (trip === null || trip === undefined)');
  });
});
