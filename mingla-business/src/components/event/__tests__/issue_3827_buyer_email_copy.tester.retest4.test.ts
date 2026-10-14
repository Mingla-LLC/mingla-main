// issue #3827 [buyer email on a live-listing change] — tester RETEST 4 for
// the "Last update" line after the round-4 rework (0c6fdea64).
//
// A different angle from the implementor's R4-C1..C3: the `last` objects here
// are the status function's real answers from the retest-4 database run
// (T4-04 and the probes), passed through the real parser, and each line is
// checked for the one thing a host must be able to trust: every guest the
// server counted appears in the line, and nothing is called a test while
// nothing was tested.
//
//   LR-1  two emailed and one reached by text (probe B): the line names the
//         guest reached by text, and the people it names add up to the guests.
//   LR-2  two emailed, one reached by text, one with no email who joined
//         after the send (T4-04): all four are accounted for.
//   LR-3  the switch went off before anything was sent and every guest was
//         alerted the usual way (testing off): no "test address" anywhere.
//
// FAILS-ON-REVERT: with mingla-business/src/utils/buyerNoticeCopy.ts at
// 743e56e00 (before ce80f2996 and 0c6fdea64), LR-1, LR-2 and LR-3 fail.
//
// Run: npx jest src/components/event/__tests__/issue_3827_buyer_email_copy.tester.retest4.test.ts --maxWorkers=2

import { describe, expect, test } from "@jest/globals";

import {
  lastNoticeLine,
  parseBuyerNoticeStatus,
} from "../../../utils/buyerNoticeCopy";

const line = (last: Record<string, unknown>, audience: number) =>
  lastNoticeLine(parseBuyerNoticeStatus({ live: true, audience, noEmail: 0, last }), "guests");

const base = {
  state: "fanned_out",
  holdCode: null,
  sendAfter: null,
  held: 0,
  heldTesting: 0,
  heldSwitchedOff: 0,
  pending: 0,
  failed: 0,
  alerted: 0,
  testAddresses: 0,
  testing: false,
};

/** Every "<n> guest(s)" / "sent to <n>" number the line names, summed. */
const namedPeople = (text: string): number => {
  let total = 0;
  const sent = /sent to (\d+) of/.exec(text);
  if (sent) total += Number(sent[1]);
  for (const m of text.matchAll(/(\d+) guests? with no email address reached/g)) total += Number(m[1]);
  for (const m of text.matchAll(/(?:^|· )(\d+) (?:has|have) no email address/g)) total += Number(m[1]);
  return total;
};

describe("LR every counted guest is in the line", () => {
  test("LR-1 two emailed, one reached by text (probe B)", () => {
    const out = line({ ...base, audience: 3, sent: 2, reachedOther: 1, noEmail: 0, emailable: 2 }, 3);
    expect(out).not.toBeNull();
    expect(out!.text).toMatch(/1 guest with no email address reached by text or the app/);
    expect(namedPeople(out!.text)).toBe(3);
    expect(out!.failed).toBe(false);
  });

  test("LR-2 plus one with no email who joined after the send (T4-04)", () => {
    const out = line({ ...base, audience: 3, sent: 2, reachedOther: 1, noEmail: 1, emailable: 2 }, 3);
    expect(out).not.toBeNull();
    expect(out!.text).toMatch(/reached by text or the app/);
    expect(out!.text).toMatch(/1 has no email address/);
    expect(namedPeople(out!.text)).toBe(4);
  });
});

describe("LR nothing is a test unless something was tested", () => {
  test("LR-3 switched off before any send, every guest alerted the usual way", () => {
    const out = line({ ...base, audience: 3, sent: 0, alerted: 3, noEmail: 0, reachedOther: 0, emailable: 2 }, 3);
    expect(out).not.toBeNull();
    expect(out!.text).toMatch(/3 guests alerted the usual way/);
    expect(out!.text).not.toMatch(/test/);
  });
});
