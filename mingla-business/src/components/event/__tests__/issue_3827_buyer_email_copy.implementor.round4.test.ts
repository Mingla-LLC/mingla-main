// issue #3827 [buyer email on a live-listing change] — implementor ROUND 4
// for the "Last update" line, from the tester's retest-3 findings 6 and 7.
//
//   R4-C1 (finding 6) going guests with no email address who were reached by
//         text or the app are counted and named; "no email address" counts
//         only guests reached by nothing.
//   R4-C2 (finding 7) when nothing was being tested and nobody had the new
//         email, the line never says "0 test addresses emailed".
//   R4-C3 the switched-off RSVP case reads as what happened: the guests were
//         alerted the usual way.
//
// The `last` objects are what business_event_buyer_notice_status returns,
// passed through the real parser.
//
// FAILS-ON-REVERT: with mingla-business/src/utils/buyerNoticeCopy.ts at
// ce80f2996, R4-C1 (no reachedOther), R4-C2 and R4-C3 ("0 test addresses
// emailed") fail.
//
// Run: npx jest src/components/event/__tests__/issue_3827_buyer_email_copy.implementor.round4.test.ts --maxWorkers=2

import { describe, expect, test } from "@jest/globals";

import { lastNoticeLine, parseBuyerNoticeStatus } from "../../../utils/buyerNoticeCopy";

const fannedOut = {
  state: "fanned_out",
  holdCode: null,
  sendAfter: null,
  audience: 3,
  sent: 0,
  pending: 0,
  failed: 0,
  noEmail: 0,
  held: 0,
  heldTesting: 0,
  heldSwitchedOff: 0,
  alerted: 0,
  reachedOther: 0,
  emailable: 2,
  testing: false,
  testAddresses: 0,
};
const line = (last: Record<string, unknown>, noun: "buyers" | "guests" = "guests") =>
  lastNoticeLine(parseBuyerNoticeStatus({ live: true, audience: 2, noEmail: 1, allowlistOnly: false, last }), noun);

describe("issue #3827 round 4 — every guest is counted, once, truthfully", () => {
  test("R4-C1: guests reached by text or the app are named; 'no email address' is only the unreached", () => {
    expect(line({ ...fannedOut, sent: 2, reachedOther: 1, noEmail: 0 })?.text).toBe(
      "Last update: sent to 2 of 3 guests · 1 guest with no email address reached by text or the app · 0 have no email address · 0 failed",
    );
    expect(line({ ...fannedOut, audience: 4, sent: 2, reachedOther: 1, noEmail: 1 })?.text).toBe(
      "Last update: sent to 2 of 4 guests · 1 guest with no email address reached by text or the app · 1 has no email address · 0 failed",
    );
    const parsed = parseBuyerNoticeStatus({ live: true, audience: 2, last: { ...fannedOut, reachedOther: 1 } });
    expect(parsed?.last?.reachedOther).toBe(1);
  });

  test("R4-C2: nothing tested and nobody emailed: no '0 test addresses' clause", () => {
    for (const last of [
      { ...fannedOut, alerted: 3 },
      { ...fannedOut, alerted: 2, heldSwitchedOff: 1, held: 1 },
      { ...fannedOut, heldTesting: 2, held: 2, testing: true },
    ]) {
      const text = line(last)?.text ?? "";
      expect(text).not.toMatch(/0 test address/);
      expect(text).not.toBe("");
    }
  });

  test("R4-C3: switched off on an RSVP: the guests were alerted the usual way", () => {
    expect(line({ ...fannedOut, alerted: 3 })?.text).toBe("Last update: 3 guests alerted the usual way");
    expect(line({ ...fannedOut, alerted: 2, heldSwitchedOff: 1, held: 1 })?.text).toBe(
      "Last update: 2 guests alerted the usual way · 1 not sent because emails were switched off",
    );
    // Still testing with a test address emailed: that is said.
    expect(line({ ...fannedOut, alerted: 2, sent: 1, testing: true })?.text).toBe(
      "Last update: 2 guests alerted the usual way · 1 test address emailed",
    );
  });
});
