// issue #3827 [buyer email on a live-listing change] — tester RETEST 5 for
// the "Last update" line after the round-5 rework (549aa5787).
//
// The `last` objects are the status function's real answers from the
// retest-5 database run, through the real parser:
//   LT-1  the switch killed part-way through an untested send (probe F:
//         one emailed, two alerted, testing false at the fan-out): the line
//         says "sent to 1 of 3" and names no test address.
//   LT-2  the same counts sent under test (T5-02): the line names the test
//         address, so the two cases are told apart only by what the server
//         recorded at the send.
//   LT-3  no line ever says "0 have no email address" or "0 test addresses".
//
// FAILS-ON-REVERT: with mingla-business/src/utils/buyerNoticeCopy.ts at
// 0c6fdea64 (before 549aa5787), LT-1 and LT-3 fail.
//
// Run: npx jest src/components/event/__tests__/issue_3827_buyer_email_copy.tester.retest5.test.ts --maxWorkers=2

import { describe, expect, test } from "@jest/globals";

import {
  lastNoticeLine,
  parseBuyerNoticeStatus,
} from "../../../utils/buyerNoticeCopy";

const line = (last: Record<string, unknown>) =>
  lastNoticeLine(
    parseBuyerNoticeStatus({ live: true, audience: last.audience, noEmail: 0, last }),
    "guests",
  );

const probeF = {
  state: "fanned_out",
  holdCode: null,
  sendAfter: null,
  audience: 3,
  sent: 1,
  pending: 0,
  failed: 0,
  noEmail: 0,
  held: 0,
  heldTesting: 0,
  heldSwitchedOff: 0,
  alerted: 2,
  reachedOther: 0,
  emailable: 2,
  testAddresses: 0,
};

describe("LT the line follows what was recorded at the send", () => {
  test("LT-1 killed mid-send, untested: no test address", () => {
    const out = line({ ...probeF, testing: false });
    expect(out).not.toBeNull();
    expect(out!.text).toMatch(/sent to 1 of 3/);
    expect(out!.text).toMatch(/2 guests alerted the usual way/);
    expect(out!.text).not.toMatch(/test/);
  });

  test("LT-2 the same counts sent under test: the test address is named", () => {
    const out = line({ ...probeF, testing: true });
    expect(out).not.toBeNull();
    expect(out!.text).toMatch(/1 test address emailed/);
  });

  test.each([
    [{ ...probeF, testing: false, sent: 2, alerted: 0, reachedOther: 1 }],
    [{ ...probeF, testing: true, sent: 0, alerted: 3 }],
    [{ ...probeF, testing: false, sent: 3, alerted: 0 }],
  ])("LT-3 no zero clause: %j", (last) => {
    const out = line(last);
    expect(out).not.toBeNull();
    expect(out!.text).not.toMatch(/\b0 (have|has) no email address|\b0 test address/);
  });
});
