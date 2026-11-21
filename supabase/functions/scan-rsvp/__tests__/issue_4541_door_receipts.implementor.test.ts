// #4541 R8.3 (SC-47, edge): the RSVP door's "See all answers" receipt is a
// fresh admission (success) by this actor at this event in the last 30 minutes.
// MINGLA-INVARIANT: I-4541-RSVP-DOOR-RECEIPT-FRESH-ADMISSION | issue #4541 | scan-rsvp opens full answers only for this actor's success scan at this event within 30 minutes; a duplicate scan is never a receipt (this suite).
//
// FAILS-ON-REVERT: putting "duplicate" back into RSVP_DOOR_FULL_ANSWERS_RECEIPTS fails T-DUP.
import { assert, assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import {
  ownsRecentAdmittedScan,
  RSVP_DOOR_FULL_ANSWERS_RECEIPTS,
  rsvpDoorSubjectFromScanResult,
} from "../doorAnswers.ts";

const ACTOR = "45410000-0000-4000-8000-0000000007a1";
const EVENT = "45410000-0000-4000-8000-0000000007e1";
const PRIMARY = "45410000-0000-4000-8000-0000000007b1";
const NOW = Date.parse("2026-11-21T20:00:00Z");
const base = {
  scanner_user_id: ACTOR,
  requested_event_id: EVENT,
  outcome: "success",
  scanned_at: new Date(NOW - 60_000).toISOString(),
};

Deno.test("T-FRESH a fresh admission is the receipt", () => {
  assert(ownsRecentAdmittedScan(base, ACTOR, EVENT, NOW));
});

Deno.test("T-DUP SC-47 a duplicate scan is not a receipt, though it still draws the door line", () => {
  assertEquals(ownsRecentAdmittedScan({ ...base, outcome: "duplicate" }, ACTOR, EVENT, NOW), false);
  assertEquals([...RSVP_DOOR_FULL_ANSWERS_RECEIPTS], ["success"]);
  // The scan display still shows the line for an already-admitted guest.
  assertEquals(
    rsvpDoorSubjectFromScanResult({ result: "duplicate", entityType: "primary", entityId: PRIMARY }),
    { kind: "rsvp", id: PRIMARY },
  );
});

// #4541 review fix 1 (BLOCKER): a duplicate RSVP scan must not offer "See all
// answers" (Host 1.3.0 shows the button whenever fullAnswers is true).
// FAILS-ON-REVERT: dropping rsvpDoorAnswersForScanResult from index.ts fails T-FLAG-SRC;
// letting a duplicate keep the flag fails T-FLAG-DUP.
import { rsvpDoorAnswersForScanResult } from "../doorAnswers.ts";

const view = { state: "answered", lines: ["Diet: vegan"], fullAnswers: true };

Deno.test("T-FLAG-DUP a duplicate RSVP scan never offers See all answers", () => {
  assertEquals(rsvpDoorAnswersForScanResult(view, "duplicate")?.fullAnswers, false);
  assertEquals(rsvpDoorAnswersForScanResult(view, "duplicate")?.lines, ["Diet: vegan"]);
});

Deno.test("T-FLAG-FRESH a fresh RSVP admission keeps the flag", () => {
  assertEquals(rsvpDoorAnswersForScanResult(view, "success")?.fullAnswers, true);
  assertEquals(rsvpDoorAnswersForScanResult(null, "success"), null);
});

Deno.test("T-FLAG-SRC the RSVP scan response passes the door answers through the gate", async () => {
  const src = await Deno.readTextFile(new URL("../index.ts", import.meta.url));
  assert(src.includes("rsvpDoorAnswersForScanResult(doorAnswers, result.result)"));
  assert(!/result = \{ \.\.\.result, doorAnswers \}/.test(src));
});
