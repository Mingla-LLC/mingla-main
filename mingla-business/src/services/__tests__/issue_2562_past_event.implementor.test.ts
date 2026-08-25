/**
 * issue #2562 — A PAST EVENT CANNOT BE PAID FOR.
 *
 * WHAT WAS BROKEN. Nothing on the reservation path asked whether the event had
 * already happened. `event_not_selling` checks `events.status`, and a finished
 * event is still `scheduled` — status describes the LISTING, not the clock.
 *
 * The only thing standing between a guest and paying for a past event was an
 * OPTIONAL per-tier `sale_end_at`, and six live tiers did not have one. So:
 *
 *   - buyer web        REFUSED  ("PAST EVENT — this event has ended")
 *   - Explorer app     OFFERED  an active "Buy ticket" + "28 tickets left"
 *   - the SERVER       ACCEPTED — proven on production against FIFA Grill
 *                      Night, whose last day ended 2026-07-26:
 *                      `status=requires_payment total=2000 currency=USD`
 *
 * A guarantee cannot rest on an optional field being filled in, so the refusal
 * belongs on the server. This file pins the guest-facing half: the new bounded
 * token must produce its OWN honest sentence rather than falling through to the
 * generic refusal that #2511 exists to eliminate.
 *
 * FAILS ON REVERT: remove `event_already_ended` from the raise map and the
 * first two cases fail.
 */
import { describe, expect, test } from "@jest/globals";

import {
  FREE_CHECKOUT_FAILED_MESSAGE,
  FREE_CHECKOUT_MESSAGES,
  FREE_CHECKOUT_UNKNOWN_MESSAGE,
  freeCheckoutErrorMessage,
} from "../checkoutErrorCopy";

/** The shape `invokeOrThrow` produces for a handled edge refusal. */
const refusal = (detail: string): Error => {
  const e = new Error("Edge Function returned a non-2xx status code") as Error & {
    status: number;
    code: string;
    detail: string;
  };
  e.status = 409;
  e.code = "checkout_session_failed";
  e.detail = detail;
  return e;
};

describe("issue #2562 — the past-event refusal is honest and its own", () => {
  test("it does not fall through to the generic refusal", () => {
    const message = freeCheckoutErrorMessage(refusal("event_already_ended"));
    expect(message).not.toBe(FREE_CHECKOUT_FAILED_MESSAGE);
    expect(message).not.toBe(FREE_CHECKOUT_UNKNOWN_MESSAGE);
    expect(FREE_CHECKOUT_MESSAGES).toContain(message);
  });

  test("it says the event already happened, and that nothing was reserved", () => {
    const message = freeCheckoutErrorMessage(
      refusal("event_already_ended"),
    ).toLowerCase();
    expect(message).toContain("already taken place");
    // The guard fires before any row can exist, so the claim is provably true.
    expect(message).toContain("nothing was reserved");
  });

  test("it never tells the guest to try again — nothing can make it work", () => {
    // The whole point of #2511 item 5: a permanent refusal must not invite a
    // retry. An event in the past is the most permanent refusal there is.
    expect(
      freeCheckoutErrorMessage(refusal("event_already_ended")).toLowerCase(),
    ).not.toContain("try again");
  });

  test("it is DISTINCT from 'the organiser closed sales'", () => {
    // `ticket_sales_ended` means the organiser shut sales on an event that is
    // still ahead — a guest can ask them to reopen it. `event_already_ended`
    // means the event is over and nothing can be done. Collapsing the two would
    // reintroduce exactly the ambiguity this work removed.
    const past = freeCheckoutErrorMessage(refusal("event_already_ended"));
    const closed = freeCheckoutErrorMessage(refusal("ticket_sales_ended"));
    expect(past).not.toBe(closed);
  });

  test("a past-event refusal never reads as sold out", () => {
    // "No tickets left" implies demand and invites a waitlist. Wrong, and it is
    // the #2337 lie in a new costume.
    expect(
      freeCheckoutErrorMessage(refusal("event_already_ended")).toLowerCase(),
    ).not.toContain("no free tickets left");
  });
});
