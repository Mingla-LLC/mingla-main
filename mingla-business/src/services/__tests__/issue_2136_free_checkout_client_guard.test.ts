/**
 * issue #2136 [free-ticket checkout] — the CLIENT half of the contract.
 *
 * The guest-facing symptom of #2136 was a raw JavaScript error rendered into
 * the checkout form:
 *
 *     Cannot read properties of undefined (reading 'map')
 *
 * thrown by `app/checkout/[eventId]/buyer.tsx` at
 * `ticketIds: result.tickets.map((ticket) => ticket.ticketId)` because the
 * server's `free_completed` envelope carried no `tickets` at all.
 *
 * The guard is deliberately a REFUSAL, not a fallback to `[]`. Rendering the
 * confirmation screen for a reservation the server never made would replace a
 * loud failure with a silent one — the guest would walk to the door holding a
 * ticket that does not exist. That is strictly worse than the bug.
 *
 * This suite pins:
 *   1. the envelope predicate (`isCompletedFreeOrder`) rejects every shape the
 *      server can produce without an order + issued tickets;
 *   2. the error mapper (`freeCheckoutErrorMessage`) is TOTAL — it never
 *      returns a raw runtime or transport string;
 *   3. `buyer.tsx` actually uses both, and no longer renders `error.message`.
 */
import { readFileSync } from "fs";
import { join } from "path";

import {
  // issue #2337 — the honest non-specific sentence for a 409 whose bounded
  // token the client could not read.
  FREE_CHECKOUT_CONFLICT_MESSAGE,
  FREE_CHECKOUT_FAILED_MESSAGE,
  FREE_CHECKOUT_UNAVAILABLE_MESSAGE,
  freeCheckoutErrorMessage,
  isCompletedFreeOrder,
} from "../ticketCheckoutService";
import type { TicketCheckoutCreateResult } from "../ticketCheckoutService";

const completedEnvelope = (
  overrides: Record<string, unknown> = {},
): TicketCheckoutCreateResult =>
  ({
    kind: "free_completed",
    orderId: "40000000-0000-4000-8000-00000000e139",
    checkoutSessionId: "30000000-0000-4000-8000-00000000e138",
    eventId: "10000000-0000-4000-8000-00000000e136",
    paymentStatus: "paid",
    totalCents: 0,
    currency: "NGN",
    notificationStatus: "queued",
    tickets: [
      {
        ticketId: "50000000-0000-4000-8000-00000000e13a",
        ticketTypeId: "20000000-0000-4000-8000-00000000e137",
        ticketName: "Free entry",
        qrPayload: "mgl_free_2136_qr",
        status: "valid",
      },
    ],
    ...overrides,
  }) as TicketCheckoutCreateResult;

describe("#2136 isCompletedFreeOrder — an envelope is a confirmation only with an order AND tickets", () => {
  test("a fully-formed free_completed envelope is accepted", () => {
    expect(isCompletedFreeOrder(completedEnvelope())).toBe(true);
  });

  test("the exact production envelope — no tickets key at all — is REFUSED", () => {
    // What `ticket-checkout-create` returned before #2136: the finalize RPC's
    // `{outcome, orderId}` spread under a `free_completed` label.
    const envelope = completedEnvelope();
    delete (envelope as unknown as Record<string, unknown>).tickets;
    expect(isCompletedFreeOrder(envelope)).toBe(false);
  });

  test.each([
    ["tickets undefined", { tickets: undefined }],
    ["tickets null", { tickets: null }],
    ["tickets empty", { tickets: [] }],
    ["tickets not an array", { tickets: "mgl_free_2136_qr" }],
    ["orderId missing", { orderId: undefined }],
    ["orderId empty", { orderId: "" }],
  ])("%s is REFUSED", (_label, overrides) => {
    expect(isCompletedFreeOrder(completedEnvelope(overrides))).toBe(false);
  });

  test("a paid envelope is never mistaken for a completed free order", () => {
    expect(
      isCompletedFreeOrder({
        kind: "requires_payment",
        checkoutSessionId: "cs",
        buyerStatusToken: "tok",
        totalCents: 2000,
        currency: "NGN",
        clientSecret: "cs_secret",
        paymentIntentId: "pi_123",
        publishableKey: null,
      }),
    ).toBe(false);
  });
});

describe("#2136 freeCheckoutErrorMessage — the guest never sees a raw runtime string", () => {
  test("the exact TypeError #2136 produced maps to human copy", () => {
    const thrown = new TypeError(
      "Cannot read properties of undefined (reading 'map')",
    );
    expect(freeCheckoutErrorMessage(thrown)).toBe(FREE_CHECKOUT_FAILED_MESSAGE);
    expect(freeCheckoutErrorMessage(thrown)).not.toContain("undefined");
    expect(freeCheckoutErrorMessage(thrown)).not.toContain("map");
  });

  test("a handled 409 from the server is human copy — and, post-#2337, only claims what the server said", () => {
    // supabase-js collapses every non-2xx into a FunctionsHttpError whose
    // `.message` is opaque and whose status rides `.context`.
    //
    // issue #2337 CORRECTED THIS EXPECTATION. #2136's requirement was "never a
    // raw runtime string", and that still holds below. But this test also
    // pinned the mapper's FIRST LINE — `httpStatusOf(error) === 409` ->
    // FREE_CHECKOUT_UNAVAILABLE_MESSAGE — and 409 is what
    // `ticket-checkout-create` answers for THIRTEEN distinct free-rail
    // conflicts. One of them, `free_reservation_already_exists`, means the guest
    // ALREADY HOLDS the reservation, and it was being rendered as "no longer
    // available … Nothing was reserved" on an event with UNLIMITED tickets.
    //
    // A 409 whose body we could not read is now the honest non-specific
    // sentence: the sale-is-gone copy is reserved for the bounded token that
    // actually means the sale is gone, which is asserted immediately below and
    // exhaustively in issue_2337_free_409_token_mapper.test.ts.
    const httpError = Object.assign(
      new Error("Edge Function returned a non-2xx status code"),
      { context: { status: 409 } },
    );
    expect(freeCheckoutErrorMessage(httpError)).toBe(
      FREE_CHECKOUT_CONFLICT_MESSAGE,
    );
    expect(freeCheckoutErrorMessage(httpError)).not.toMatch(/non-2xx/);
    const directStatus = Object.assign(new Error("boom"), { status: 409 });
    expect(freeCheckoutErrorMessage(directStatus)).toBe(
      FREE_CHECKOUT_CONFLICT_MESSAGE,
    );
    expect(freeCheckoutErrorMessage(directStatus)).not.toBe("boom");

    // The sale-is-gone copy is still exactly one bounded token away.
    expect(
      freeCheckoutErrorMessage(
        Object.assign(new Error("Edge Function returned a non-2xx status code"), {
          status: 409,
          code: "checkout_unavailable",
        }),
      ),
    ).toBe(FREE_CHECKOUT_UNAVAILABLE_MESSAGE);
  });

  test("the bounded server token is recognised even without a status", () => {
    expect(
      freeCheckoutErrorMessage(new Error("checkout_unavailable")),
    ).toBe(FREE_CHECKOUT_UNAVAILABLE_MESSAGE);
  });

  test("the opaque transport message is never shown verbatim", () => {
    const opaque = new Error("Edge Function returned a non-2xx status code");
    expect(freeCheckoutErrorMessage(opaque)).toBe(FREE_CHECKOUT_FAILED_MESSAGE);
  });

  test("it is TOTAL — every non-Error shape still yields human copy", () => {
    for (const value of [null, undefined, 0, "", "boom", {}, [], NaN, false]) {
      const message = freeCheckoutErrorMessage(value);
      expect([
        FREE_CHECKOUT_FAILED_MESSAGE,
        FREE_CHECKOUT_UNAVAILABLE_MESSAGE,
      ]).toContain(message);
    }
  });

  test("both messages tell the guest nothing was reserved", () => {
    for (
      const message of [
        FREE_CHECKOUT_FAILED_MESSAGE,
        FREE_CHECKOUT_UNAVAILABLE_MESSAGE,
      ]
    ) {
      expect(message.toLowerCase()).toContain("nothing was reserved");
    }
  });
});

describe("#2136 buyer.tsx wires the guard on the free path", () => {
  const source = readFileSync(
    join(__dirname, "../../../app/checkout/[eventId]/buyer.tsx"),
    "utf8",
  );

  test("the envelope is refused before .map runs", () => {
    const guardAt = source.indexOf("isCompletedFreeOrder(result)");
    // The executable call site, not the comment above it that quotes it.
    const mapAt = source.indexOf("ticketIds: result.tickets.map(");
    expect(guardAt).toBeGreaterThan(-1);
    expect(mapAt).toBeGreaterThan(-1);
    expect(guardAt).toBeLessThan(mapAt);
  });

  test("the raw thrown message is no longer rendered to the guest", () => {
    expect(source).toContain("setSubmitError(freeCheckoutErrorMessage(error))");
    expect(source).not.toContain("error instanceof Error\n            ? error.message");
  });
});
