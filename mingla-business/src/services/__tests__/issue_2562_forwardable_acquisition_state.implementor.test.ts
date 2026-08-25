/**
 * issue #2562 [a past event was still purchasable] — the forwarding rule.
 *
 * WHAT WAS BROKEN. `computeOfferingVariant` decides "past" from
 * `status === "ended"` OR from `acquisitionState`. Explorer set NEITHER from
 * the clock — it forwarded the operator's `status`, and a finished event is
 * still `scheduled` (status describes the LISTING, not the calendar).
 *
 * Observed on a dev build against pre-fix code: the native screen offered an
 * active "Buy ticket" and "28 tickets left" on FIFA Grill Night, whose last
 * occurrence ended 2026-07-26 — a month earlier. The buyer web showed
 * "PAST EVENT — this event has ended, ticket sales are closed" for the SAME
 * event, and the server (before migration 20270525002562) accepted a $20
 * checkout session for it. Three layers, three different answers.
 *
 * WHY THIS FILE LIVES IN mingla-business. The rule itself ships in
 * `@mingla/offering-rendering`, but the only CI gate that runs on EVERY pull
 * request with no path filter is `mingla-business jest (full suite)`, and its
 * roots stop at `mingla-business/src` — a copy under `packages/**` is collected
 * by nothing and would be a test that never runs. Adding a workflow to host it
 * is forbidden by I-PROPOSED-2148-CI-TOPOLOGY-BOUNDED ("ordinary work adds
 * suites to a stable registry; it does not add another wrapper"), so the test
 * goes where the existing gate already looks.
 *
 * THIS FILE IMPORTS THE REAL FUNCTION rather than restating its logic. An
 * earlier draft re-implemented the mapping inline and therefore could not fail
 * when the shipped code was reverted — the unfalsifiable-test class from #2113.
 *
 * FAILS ON REVERT: make the rule a pass-through of `resolveEventAcquisitionState`
 * and 5 of these 8 cases fail. Verified by mutation, not by assertion.
 */
import { describe, expect, test } from "@jest/globals";

// DEEP import on purpose. jest.config.cjs maps the package BARREL to a manual
// mock (`__manual_mocks__/offering-rendering.js`) because the barrel eagerly
// re-exports React Native .tsx that this node config cannot load. Importing
// the barrel here would assert against the mock and prove nothing. The
// lifecycle module is pure TypeScript with no RN imports, so the deep
// specifier resolves through the workspace symlink to the REAL shipped code.
import { forwardableAcquisitionState } from "@mingla/offering-rendering/eventAcquisitionLifecycle";

const NOW = Date.parse("2026-08-24T12:00:00.000Z");
const ENDED = "2026-07-26T06:00:00.000Z"; // FIFA Grill Night, the real row
const FUTURE = "2026-08-30T19:00:00.000Z"; // We Go Again, still selling

describe("issue #2562 — only a DEFINITE ending closes the buy path", () => {
  test("a finished event resolves to ended — the buy path must go", () => {
    expect(forwardableAcquisitionState("scheduled", ENDED, NOW)?.kind).toBe(
      "ended",
    );
  });

  test("an event still ahead is untouched — We Go Again keeps selling", () => {
    expect(
      forwardableAcquisitionState("scheduled", FUTURE, NOW),
    ).toBeUndefined();
  });

  test("an event ending LATER TODAY still sells — walk-up is not blocked", () => {
    const laterToday = new Date(NOW + 6 * 60 * 60 * 1000).toISOString();
    expect(
      forwardableAcquisitionState("scheduled", laterToday, NOW),
    ).toBeUndefined();
  });

  test("FAIL SAFE — a MISSING end time is NOT treated as past", () => {
    // The resolver answers `unavailable` here and `computeOfferingVariant`
    // reads that as past. Forwarding it would stop sales on a live event the
    // moment its end time went missing. Absence of data is not evidence of an
    // ending — the same principle the server guard is built on.
    expect(forwardableAcquisitionState("scheduled", null, NOW)).toBeUndefined();
  });

  test("FAIL SAFE — an UNPARSEABLE end time is NOT treated as past", () => {
    expect(
      forwardableAcquisitionState("scheduled", "not-a-timestamp", NOW),
    ).toBeUndefined();
  });

  test("the operator's own 'ended' status is still honoured", () => {
    expect(forwardableAcquisitionState("ended", FUTURE, NOW)?.kind).toBe(
      "ended",
    );
  });

  test("a cancelled event is forwarded as cancelled, not ended", () => {
    // The two render differently. Collapsing them would tell a guest an event
    // finished when it was called off.
    expect(forwardableAcquisitionState("cancelled", FUTURE, NOW)?.kind).toBe(
      "cancelled",
    );
  });

  test("an unknown status is treated as scheduled, not as an ending", () => {
    expect(forwardableAcquisitionState("draft", FUTURE, NOW)).toBeUndefined();
    expect(forwardableAcquisitionState(null, FUTURE, NOW)).toBeUndefined();
    expect(
      forwardableAcquisitionState(undefined, FUTURE, NOW),
    ).toBeUndefined();
  });
});
