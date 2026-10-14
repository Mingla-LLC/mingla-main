// issue #3827 [buyer email on a live-listing change] — tester RETEST 3 for
// the "Last update" line after the round-3 rework (528396ba1, finding D3).
//
// A different angle from the implementor's suite, which pins one sentence per
// named state: this file feeds the line the exact `last` objects the status
// function returned in the retest-3 database run, and holds every answer to
// three rules a host relies on:
//   LU-1  a copy held because emails were switched off is never described as
//         "being tested", and a copy held while testing is never described
//         as switched off;
//   LU-2  a held copy is never shown as failed (no red, no "Contact support");
//   LU-3  while a waiting email is being tested, the line counts the test
//         addresses it can reach, not every buyer.
//
// FAILS-ON-REVERT: with mingla-business/src/utils/buyerNoticeCopy.ts at
// bdc95f54c (before 528396ba1), LU-1 (both cases), LU-2 and LU-3 fail.
//
// Run: npx jest src/components/event/__tests__/issue_3827_buyer_email_copy.tester.retest3.test.ts --maxWorkers=2

import { describe, expect, test } from "@jest/globals";

import {
  lastNoticeLine,
  parseBuyerNoticeStatus,
} from "../../../utils/buyerNoticeCopy";

// The `last` objects below are the status function's answers in the retest-3
// database run (R3-06 and its neighbours), passed through the real parser.
const status = (last: Record<string, unknown>, audience = 2) =>
  parseBuyerNoticeStatus({ live: true, audience, noEmail: 0, allowlistOnly: true, last });

const fannedOut = {
  state: "fanned_out",
  holdCode: null,
  sendAfter: null,
  audience: 2,
  sent: 0,
  pending: 0,
  failed: 0,
  noEmail: 0,
  alerted: 0,
  emailable: 2,
};

describe("LU-1 a hold is described by its real reason", () => {
  test("held by the switch only: says switched off, never testing", () => {
    const line = lastNoticeLine(
      status({ ...fannedOut, held: 2, heldTesting: 0, heldSwitchedOff: 2, testing: false }),
    );
    expect(line).not.toBeNull();
    expect(line!.text).toMatch(/switched off/);
    expect(line!.text).not.toMatch(/tested|test address/);
  });

  test("one held while testing, one held by the switch (R3-06): both reasons, each once", () => {
    const line = lastNoticeLine(
      status({ ...fannedOut, held: 2, heldTesting: 1, heldSwitchedOff: 1, testing: true }),
    );
    expect(line).not.toBeNull();
    expect(line!.text).toMatch(/1 buyer not emailed while emails are being tested/);
    expect(line!.text).toMatch(/1 not sent because emails were switched off/);
  });
});

describe("LU-2 a held copy is never a failure", () => {
  test.each([
    [{ held: 2, heldTesting: 2, heldSwitchedOff: 0, testing: true }],
    [{ held: 2, heldTesting: 0, heldSwitchedOff: 2, testing: false }],
    [{ held: 2, heldTesting: 1, heldSwitchedOff: 1, testing: true }],
  ])("%j", (held) => {
    const line = lastNoticeLine(status({ ...fannedOut, ...held }));
    expect(line).not.toBeNull();
    expect(line!.failed).toBe(false);
    expect(line!.text).not.toMatch(/failed|Contact support/);
  });
});

describe("LU-3 a waiting email while testing counts test addresses", () => {
  test("three test addresses out of 254 buyers", () => {
    const line = lastNoticeLine(
      parseBuyerNoticeStatus({
        live: true,
        audience: 254,
        allowlistOnly: true,
        last: {
          state: "scheduled",
          holdCode: null,
          audience: 254,
          sent: 0,
          pending: 0,
          failed: 0,
          noEmail: 0,
          held: 0,
          emailable: 254,
          testing: true,
          testAddresses: 3,
        },
      }),
    );
    expect(line).not.toBeNull();
    expect(line!.text).toMatch(/3 test addresses/);
    expect(line!.text).not.toMatch(/254/);
  });
});
