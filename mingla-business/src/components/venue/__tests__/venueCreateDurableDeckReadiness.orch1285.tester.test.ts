/**
 * ORCH-1285(tester) — SUPERSEDED by META-ORCH-1290 (D-1). [TEST-MOD-APPROVED META-ORCH-1290]
 *
 * Tester adversarial companion to the ORCH-1285 create->durable-deck-readiness suite.
 * META-ORCH-1290 D-1 folds the deck-readiness leg into the single wizard submit, so
 * the create->durable-route navigation this attacked no longer exists (create lands on
 * the management page "In review" via onDone). The matching strict-grep gate was
 * retired in META-ORCH-1290 Leg A.
 *
 * Retained (append-only policy forbids test-file deletion). Live coverage of the
 * folded one-submit flow lives in `venueAuthoringOneSubmission.metaOrch1290.test.ts`.
 */
describe("ORCH-1285(tester) adversarial (SUPERSEDED by META-ORCH-1290 D-1)", () => {
  test.skip("superseded - see venueAuthoringOneSubmission.metaOrch1290.test.ts", () => {
    // intentionally empty; behavior retired by META-ORCH-1290 D-1
  });
});
