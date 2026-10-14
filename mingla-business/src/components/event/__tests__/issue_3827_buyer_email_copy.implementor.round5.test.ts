// issue #3827 [buyer email on a live-listing change] — implementor ROUND 5
// for the "Last update" line, from the tester's retest-4 copy findings.
//
//   R5-C1 after a kill switch mid-send, a notice that went out with nothing
//         under test (the server says testing: false) is never described
//         as "test addresses emailed".
//   R5-C2 a notice the server says went out under test still reads as test
//         addresses emailed, whatever else is in the status.
//   R5-C3 a zero is never a clause: no "0 have no email address" beside
//         guests reached by text or the app.
//   R5-C4 one guest is "1 guest", not "1 guests".
//
// FAILS-ON-REVERT: with mingla-business/src/utils/buyerNoticeCopy.ts at
// 541309b18, R5-C1 ("1 test address emailed"), R5-C3 ("0 have no email
// address") and R5-C4 ("of 1 guests") fail.
//
// Run: npx jest src/components/event/__tests__/issue_3827_buyer_email_copy.implementor.round5.test.ts --maxWorkers=2

import { describe, expect, test } from "@jest/globals";

import { lastNoticeLine, parseBuyerNoticeStatus } from "../../../utils/buyerNoticeCopy";

const base = {
  state: "fanned_out",
  holdCode: null,
  sendAfter: null,
  audience: 2,
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

function line(last: Record<string, unknown>, noun: "buyers" | "guests"): string | null {
  const status = parseBuyerNoticeStatus({ live: true, audience: 2, allowlistOnly: false, last: { ...base, ...last } });
  if (status === null) throw new Error("status did not parse");
  return lastNoticeLine(status, noun)?.text ?? null;
}

describe("issue #3827 round 5 — the Last update line says only what happened", () => {
  test("R5-C1: a kill switch mid-send with nothing under test never says test address", () => {
    const text = line({ sent: 1, alerted: 1, emailable: 1, testing: false }, "guests");
    expect(text).not.toBeNull();
    expect(text).not.toMatch(/test/);
    expect(text).toBe("Last update: sent to 1 of 2 guests · 1 guest alerted the usual way · 0 failed");
  });

  test("R5-C2: a notice that went out under test still says test addresses", () => {
    const text = line({ sent: 1, heldTesting: 1, testing: true }, "buyers");
    expect(text).toMatch(/1 test address emailed/);
  });

  test("R5-C3: no zero clause beside guests reached by text or the app", () => {
    const text = line({ audience: 3, sent: 2, reachedOther: 1 }, "guests");
    expect(text).toBe(
      "Last update: sent to 2 of 3 guests · 1 guest with no email address reached by text or the app · 0 failed",
    );
    expect(text).not.toMatch(/0 have no email address/);
  });

  test("R5-C4: one guest is singular", () => {
    const text = line({ audience: 1, sent: 1, emailable: 1 }, "guests");
    expect(text).toBe("Last update: sent to 1 of 1 guest · 0 failed");
    expect(text).not.toMatch(/1 guests/);
  });
});
