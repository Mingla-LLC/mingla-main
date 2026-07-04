/**
 * ORCH-1285 — SUPERSEDED by META-ORCH-1290 (D-1). [TEST-MOD-APPROVED META-ORCH-1290]
 *
 * This suite guarded the create → durable `/venue/deck-readiness` navigation on
 * "Submit for review" (the ORCH-1285 web-flash fix). META-ORCH-1290 D-1 folds the
 * whole deck-readiness leg INTO the single wizard submit — create now lands on the
 * venue management page in the "In review" state via `onDone`, and no longer
 * navigates to a separate durable deck-readiness route on submit. The matching
 * strict-grep gate (`i-proposed-1285-create-lands-on-durable-deck-readiness.mjs`)
 * was retired in META-ORCH-1290 Leg A for the same reason. The durable route itself
 * SURVIVES as the Hub → "Edit listing" recovery/edit surface.
 *
 * The append-only policy (ORCH-0840) forbids deleting a test file, so this file is
 * retained as a superseded marker. Live coverage of the folded one-submit flow lives
 * in `venueAuthoringOneSubmission.metaOrch1290.test.ts`.
 */
describe("ORCH-1285 create->durable-deck-readiness nav (SUPERSEDED by META-ORCH-1290 D-1)", () => {
  test.skip("superseded - see venueAuthoringOneSubmission.metaOrch1290.test.ts", () => {
    // intentionally empty; behavior retired by META-ORCH-1290 D-1
  });
});
