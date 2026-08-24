/**
 * issue #2337 [free checkout says "no more tickets" for any conflict] — the
 * CLIENT half.
 *
 * The executable end-to-end proof lives in
 * `supabase/functions/ticket-checkout-create/__tests__/issue_2337_free_409_honest_copy.test.ts`,
 * which drives the REAL edge handler into all thirteen reachable free-rail 409
 * arms and runs each REAL response through this same mapper. This suite covers
 * what that one cannot: the transport shapes only a browser produces, the
 * totality of the mapper, and the two call sites.
 *
 * THE DEFECT, restated so a future reader does not have to reconstruct it:
 *
 *     if (httpStatusOf(error) === 409) return FREE_CHECKOUT_UNAVAILABLE_MESSAGE;
 *
 * One status, twelve meanings, one sentence. `free_reservation_already_exists`
 * — the guest ALREADY HOLDS the reservation — was rendered as "this free ticket
 * is no longer available … Nothing was reserved", on an event with UNLIMITED
 * tickets. That is why it looked intermittent: it depended on whether a prior
 * attempt had already reserved, never on capacity.
 *
 * WHAT MAKES THIS SUITE FAIL ON REVERT. `REVERT GUARD` below re-implements the
 * deleted line and asserts, arm by arm, that the shipped mapper disagrees with
 * it. Restore the status-keyed mapper and eight of the nine token cases go red.
 */
import { readFileSync } from "fs";
import { join } from "path";

/**
 * The real `supabase.functions.invoke`, replaced by the exact failure envelope
 * supabase-js produces. This is what lets the suite run `invokeOrThrow` FOR
 * REAL — the function that has to carry the status, the bounded token and (as of
 * #2337) the detail off the response before the body is gone. Asserting
 * `readEdgeRefusal` alone would leave that wiring unpinned: a change that stops
 * assigning `failure.detail` is invisible to every test that does not go through
 * the wrapper.
 */
const mockInvoke = jest.fn();
jest.mock("../supabase", () => ({
  supabase: { functions: { invoke: mockInvoke } },
}));

import {
  createTicketCheckout,
  FREE_CHECKOUT_ALREADY_RESERVED_MESSAGE,
  FREE_CHECKOUT_CONFLICT_MESSAGE,
  FREE_CHECKOUT_FAILED_MESSAGE,
  FREE_CHECKOUT_UNKNOWN_MESSAGE,
  FREE_CHECKOUT_INTAKE_STALE_MESSAGE,
  FREE_CHECKOUT_MESSAGES,
  FREE_CHECKOUT_SOLD_OUT_MESSAGE,
  FREE_CHECKOUT_UNAVAILABLE_MESSAGE,
  freeCheckoutErrorMessage,
  isFreeReservationAlreadyExists,
} from "../ticketCheckoutService";
import { readEdgeRefusal } from "../checkoutErrorCopy";

/** The shape `invokeOrThrow` throws after #2188 + #2337. */
const refusal = (
  status: number | null,
  code: string | null,
  detail: string | null = null,
): Error =>
  Object.assign(
    new Error("Edge Function returned a non-2xx status code"),
    { status, code, detail },
  );

/**
 * Every bounded token the FREE rail of `ticket-checkout-create` emits with a
 * 409, and the sentence it must produce. The tokens are not asserted from this
 * list — the Deno suite derives them by EXECUTING the handler. This list exists
 * so the client-side codomain is pinned in the runtime that renders it.
 */
const TOKEN_CASES: ReadonlyArray<[string, string]> = [
  ["free_reservation_already_exists", FREE_CHECKOUT_ALREADY_RESERVED_MESSAGE],
  ["checkout_unavailable", FREE_CHECKOUT_UNAVAILABLE_MESSAGE],
  ["checkout_session_failed", FREE_CHECKOUT_FAILED_MESSAGE],
  ["checkout_finalize_failed", FREE_CHECKOUT_CONFLICT_MESSAGE],
  ["intake_schema_stale", FREE_CHECKOUT_INTAKE_STALE_MESSAGE],
];

describe("#2337 freeCheckoutErrorMessage keys on the bounded token, never on the status", () => {
  test.each(TOKEN_CASES)(
    "409 '%s' produces its own sentence",
    (token, expected) => {
      expect(freeCheckoutErrorMessage(refusal(409, token))).toBe(expected);
    },
  );

  test("the token wins even when the transport reports no status at all", () => {
    // A body that parsed but a context that never exposed `status`.
    expect(freeCheckoutErrorMessage(refusal(null, "free_reservation_already_exists")))
      .toBe(FREE_CHECKOUT_ALREADY_RESERVED_MESSAGE);
    expect(freeCheckoutErrorMessage(refusal(null, "checkout_unavailable")))
      .toBe(FREE_CHECKOUT_UNAVAILABLE_MESSAGE);
  });

  test("an UNRECOGNISED 409 says something true and non-specific — never sold out", () => {
    for (
      const unknown of [
        refusal(409, null),
        refusal(409, "some_token_from_a_future_server"),
        Object.assign(new Error("boom"), { context: { status: 409 } }),
        Object.assign(new Error("boom"), { status: 409 }),
      ]
    ) {
      const message = freeCheckoutErrorMessage(unknown);
      expect(message).toBe(FREE_CHECKOUT_CONFLICT_MESSAGE);
      expect(message).not.toBe(FREE_CHECKOUT_UNAVAILABLE_MESSAGE);
      expect(message).not.toBe(FREE_CHECKOUT_SOLD_OUT_MESSAGE);
      // It must not claim a direction it cannot know.
      expect(message).not.toMatch(/no longer available/i);
      expect(message).not.toMatch(/nothing was reserved/i);
    }
  });

  test("the ONLY route to a sold-out sentence is the database raising ticket_capacity_exceeded", () => {
    expect(
      freeCheckoutErrorMessage(
        refusal(409, "checkout_session_failed", "ticket_capacity_exceeded"),
      ),
    ).toBe(FREE_CHECKOUT_SOLD_OUT_MESSAGE);
    // Same token, a different RPC failure — not sold out.
    expect(
      freeCheckoutErrorMessage(
        refusal(409, "checkout_session_failed", "deadlock detected"),
      ),
    ).toBe(FREE_CHECKOUT_FAILED_MESSAGE);
    // And nothing else in the codomain makes the claim.
    for (const message of FREE_CHECKOUT_MESSAGES) {
      if (message === FREE_CHECKOUT_SOLD_OUT_MESSAGE) continue;
      expect(message).not.toMatch(/no free tickets left/i);
    }
  });

  test("an UNLIMITED ticket type can never reach the sold-out sentence", () => {
    // `IF v_ticket_type.quantity_total IS NOT NULL AND …` — an unlimited tier
    // has NULL and is skipped, so `ticket_capacity_exceeded` is unreachable and
    // no detail can carry it. Every other free-rail token, exhaustively:
    for (const [token] of TOKEN_CASES) {
      for (const status of [409, null]) {
        expect(freeCheckoutErrorMessage(refusal(status, token)))
          .not.toBe(FREE_CHECKOUT_SOLD_OUT_MESSAGE);
      }
    }
    expect(freeCheckoutErrorMessage(refusal(409, null)))
      .not.toBe(FREE_CHECKOUT_SOLD_OUT_MESSAGE);
  });
});

describe("#2337 REVERT GUARD — restoring the status-keyed line changes what a guest reads", () => {
  /** The exact line #2337 deleted. */
  const revertedMapper = (error: unknown): string => {
    const status = (error as { status?: unknown })?.status;
    const contextStatus = ((error as { context?: { status?: unknown } })?.context)
      ?.status;
    const resolved = typeof status === "number"
      ? status
      : typeof contextStatus === "number"
      ? contextStatus
      : null;
    if (resolved === 409) return FREE_CHECKOUT_UNAVAILABLE_MESSAGE;
    return FREE_CHECKOUT_FAILED_MESSAGE;
  };

  test.each(TOKEN_CASES.filter(([, m]) => m !== FREE_CHECKOUT_UNAVAILABLE_MESSAGE))(
    "409 '%s': the shipped mapper disagrees with the reverted one",
    (token, expected) => {
      const error = refusal(409, token);
      expect(freeCheckoutErrorMessage(error)).toBe(expected);
      expect(revertedMapper(error)).toBe(FREE_CHECKOUT_UNAVAILABLE_MESSAGE);
      expect(freeCheckoutErrorMessage(error)).not.toBe(revertedMapper(error));
    },
  );

  test("the sold-out and the already-reserved arms are BOTH lost under the revert", () => {
    const soldOut = refusal(
      409,
      "checkout_session_failed",
      "ticket_capacity_exceeded",
    );
    const held = refusal(409, "free_reservation_already_exists");
    expect(freeCheckoutErrorMessage(soldOut)).toBe(FREE_CHECKOUT_SOLD_OUT_MESSAGE);
    expect(freeCheckoutErrorMessage(held)).toBe(
      FREE_CHECKOUT_ALREADY_RESERVED_MESSAGE,
    );
    expect(revertedMapper(soldOut)).toBe(FREE_CHECKOUT_UNAVAILABLE_MESSAGE);
    expect(revertedMapper(held)).toBe(FREE_CHECKOUT_UNAVAILABLE_MESSAGE);
  });

  test("the already-reserved copy is the OPPOSITE of what the revert says", () => {
    // The reverted sentence tells a guest holding a ticket that nothing was
    // reserved, which is what sends them off to reserve again somewhere else.
    expect(FREE_CHECKOUT_UNAVAILABLE_MESSAGE).toMatch(/nothing was reserved/i);
    expect(FREE_CHECKOUT_ALREADY_RESERVED_MESSAGE).toMatch(/already have/i);
    expect(FREE_CHECKOUT_ALREADY_RESERVED_MESSAGE).not.toMatch(
      /Nothing was reserved\./,
    );
    expect(FREE_CHECKOUT_ALREADY_RESERVED_MESSAGE).not.toMatch(
      /no longer available/i,
    );
  });
});

describe("#2337 the mapper is TOTAL and owns every string it can return", () => {
  test.each([
    ["null", null],
    ["undefined", undefined],
    ["zero", 0],
    ["empty string", ""],
    ["a bare string", "boom"],
    ["an empty object", {}],
    ["an array", []],
    ["NaN", NaN],
    ["false", false],
    ["a TypeError", new TypeError("Cannot read properties of undefined (reading 'map')")],
    ["a prototype key", { code: "constructor" }],
    ["another prototype key", { code: "toString" }],
    ["a numeric code", { code: 409 }],
    ["a 500", refusal(500, "qr_token_pepper_missing")],
    ["a 401", refusal(401, "sign_in_required")],
  ])("%s still yields copy this module owns", (_label, value) => {
    const message = freeCheckoutErrorMessage(value);
    expect(typeof message).toBe("string");
    expect(FREE_CHECKOUT_MESSAGES).toContain(message);
  });

  test("a prototype-key token can never resolve to an inherited member", () => {
    // The #2264 P1-1 class: a plain-object lookup table returns a Function for
    // `constructor` / `toString`, which `??` cannot catch and which renders as
    // NOTHING inside a <Text>. Both must land on real sentences.
    for (const key of ["constructor", "toString", "__proto__", "valueOf"]) {
      const message = freeCheckoutErrorMessage({ status: 409, code: key });
      expect(typeof message).toBe("string");
      expect(FREE_CHECKOUT_MESSAGES).toContain(message);
    }
  });

  test("the opaque transport string is never shown verbatim", () => {
    const opaque = new Error("Edge Function returned a non-2xx status code");
    // [TEST-MOD-APPROVED #2511] The terminal arm no longer claims
    // "nothing was reserved" for an OPAQUE failure. A dropped reply may mean
    // the reservation SUCCEEDED, so that claim was unprovable - and it caused
    // real duplicate orders (#2462). The invariant this test exists to protect
    // is unchanged and still asserted: never a raw runtime string, always a
    // string this module owns. Only WHICH honest sentence changed.
    expect(freeCheckoutErrorMessage(opaque)).toBe(FREE_CHECKOUT_UNKNOWN_MESSAGE);
    for (const message of FREE_CHECKOUT_MESSAGES) {
      expect(message).not.toMatch(/non-2xx/);
      expect(message).not.toMatch(/undefined/);
    }
  });
});

describe("#2337 readEdgeRefusal carries the token AND the detail off a real Response", () => {
  const invokeError = (status: number, body: unknown): unknown => ({
    message: "Edge Function returned a non-2xx status code",
    context: new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  });

  it("reads the bounded token", async () => {
    const read = await readEdgeRefusal(
      invokeError(409, { error: "free_reservation_already_exists" }),
    );
    expect(read).toEqual({
      status: 409,
      code: "free_reservation_already_exists",
      detail: null,
    });
  });

  it("reads the detail — without it a sold-out sale is indistinguishable", async () => {
    const read = await readEdgeRefusal(
      invokeError(409, {
        error: "checkout_session_failed",
        detail: "ticket_capacity_exceeded",
      }),
    );
    expect(read.detail).toBe("ticket_capacity_exceeded");
    expect(
      freeCheckoutErrorMessage(
        Object.assign(new Error("x"), read),
      ),
    ).toBe(FREE_CHECKOUT_SOLD_OUT_MESSAGE);
  });

  it("degrades to status-only when the body is not JSON, and the mapper stays honest", async () => {
    const read = await readEdgeRefusal({
      message: "Edge Function returned a non-2xx status code",
      context: new Response("<html>502</html>", { status: 409 }),
    });
    expect(read).toEqual({ status: 409, code: null, detail: null });
    expect(freeCheckoutErrorMessage(Object.assign(new Error("x"), read)))
      .toBe(FREE_CHECKOUT_CONFLICT_MESSAGE);
  });
});

describe("#2337 isFreeReservationAlreadyExists is the routing predicate, not a second mapper", () => {
  it("is true for the bounded token, however it arrives", () => {
    expect(isFreeReservationAlreadyExists(refusal(409, "free_reservation_already_exists")))
      .toBe(true);
    expect(isFreeReservationAlreadyExists(new Error("free_reservation_already_exists")))
      .toBe(true);
    expect(isFreeReservationAlreadyExists("free_reservation_already_exists"))
      .toBe(true);
  });

  it("is false for every other free-rail refusal", () => {
    for (const [token] of TOKEN_CASES) {
      if (token === "free_reservation_already_exists") continue;
      expect(isFreeReservationAlreadyExists(refusal(409, token))).toBe(false);
    }
    for (const value of [null, undefined, 0, "", {}, [], refusal(409, null)]) {
      expect(isFreeReservationAlreadyExists(value)).toBe(false);
    }
  });

  it("agrees with the mapper — the predicate and the copy cannot drift", () => {
    const held = refusal(409, "free_reservation_already_exists");
    expect(isFreeReservationAlreadyExists(held)).toBe(true);
    expect(freeCheckoutErrorMessage(held)).toBe(
      FREE_CHECKOUT_ALREADY_RESERVED_MESSAGE,
    );
  });
});

describe("#2337 invokeOrThrow carries the refusal all the way to the guest's sentence", () => {
  /** Exactly what supabase-js throws: opaque message, real Response on context. */
  const functionsHttpError = (status: number, body: unknown): unknown =>
    Object.assign(new Error("Edge Function returned a non-2xx status code"), {
      name: "FunctionsHttpError",
      context: new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
    });

  const createFree = async (): Promise<unknown> => {
    try {
      await createTicketCheckout({
        eventId: "10000000-0000-4000-8000-000000002337",
        buyer: {
          name: "Guest Person",
          email: "guest@issue2337.test",
          phone: "+15551234567",
          marketingOptIn: false,
        },
        lines: [{
          ticketTypeId: "20000000-0000-4000-8000-000000002338",
          ticketName: "Free entry",
          quantity: 1,
          unitPrice: 0,
          currency: "NGN",
          isFree: true,
        }],
      });
    } catch (error) {
      return error;
    }
    throw new Error("createTicketCheckout resolved on a 409");
  };

  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it("a 409 free_reservation_already_exists reaches the guest as 'you already have it'", async () => {
    mockInvoke.mockResolvedValueOnce({
      data: null,
      error: functionsHttpError(409, {
        error: "free_reservation_already_exists",
      }),
    });
    const thrown = await createFree();
    expect((thrown as { status?: unknown }).status).toBe(409);
    expect((thrown as { code?: unknown }).code).toBe(
      "free_reservation_already_exists",
    );
    expect(isFreeReservationAlreadyExists(thrown)).toBe(true);
    expect(freeCheckoutErrorMessage(thrown)).toBe(
      FREE_CHECKOUT_ALREADY_RESERVED_MESSAGE,
    );
  });

  it("a 409 checkout_session_failed + ticket_capacity_exceeded reaches the guest as sold out", async () => {
    // The DETAIL is the only thing that distinguishes this from a plumbing
    // failure. `invokeOrThrow` must put it on the thrown error.
    mockInvoke.mockResolvedValueOnce({
      data: null,
      error: functionsHttpError(409, {
        error: "checkout_session_failed",
        detail: "ticket_capacity_exceeded",
      }),
    });
    const thrown = await createFree();
    expect((thrown as { detail?: unknown }).detail).toBe(
      "ticket_capacity_exceeded",
    );
    expect(freeCheckoutErrorMessage(thrown)).toBe(FREE_CHECKOUT_SOLD_OUT_MESSAGE);
  });

  it("the same token WITHOUT that detail is not sold out", async () => {
    mockInvoke.mockResolvedValueOnce({
      data: null,
      error: functionsHttpError(409, {
        error: "checkout_session_failed",
        detail: "deadlock detected",
      }),
    });
    const thrown = await createFree();
    expect((thrown as { detail?: unknown }).detail).toBe("deadlock detected");
    expect(freeCheckoutErrorMessage(thrown)).toBe(FREE_CHECKOUT_FAILED_MESSAGE);
  });

  it("a 409 checkout_unavailable still reaches the guest as the sale being gone", async () => {
    mockInvoke.mockResolvedValueOnce({
      data: null,
      error: functionsHttpError(409, {
        error: "checkout_unavailable",
        message: "This sale is no longer available.",
      }),
    });
    const thrown = await createFree();
    expect(freeCheckoutErrorMessage(thrown)).toBe(
      FREE_CHECKOUT_UNAVAILABLE_MESSAGE,
    );
  });

  it("a 409 whose body is unreadable reaches the guest as the non-specific sentence", async () => {
    mockInvoke.mockResolvedValueOnce({
      data: null,
      error: Object.assign(
        new Error("Edge Function returned a non-2xx status code"),
        { context: new Response("<html>", { status: 409 }) },
      ),
    });
    const thrown = await createFree();
    expect((thrown as { code?: unknown }).code).toBeNull();
    expect(freeCheckoutErrorMessage(thrown)).toBe(FREE_CHECKOUT_CONFLICT_MESSAGE);
  });
});

/**
 * The call sites, pinned by ORDER — the pattern
 * `issue_2136_free_checkout_client_guard.test.ts` established for these exact
 * files. Presence alone would stay green if the arm were moved somewhere it
 * never runs.
 */
describe("#2337 the free rails wire the already-reserved answer and the possession fallback", () => {
  const eventBuyer = readFileSync(
    join(__dirname, "../../../app/checkout/[eventId]/buyer.tsx"),
    "utf8",
  );
  const tripBuyer = readFileSync(
    join(__dirname, "../../../app/checkout-trip/[tripEventId]/buyer.tsx"),
    "utf8",
  );
  const experienceBuyer = readFileSync(
    join(
      __dirname,
      "../../../app/checkout-experience/[experienceEventId]/buyer.tsx",
    ),
    "utf8",
  );

  test("the event rail answers the 409 BEFORE falling through to the generic mapper", () => {
    const armAt = eventBuyer.indexOf("if (isFreeReservationAlreadyExists(error)) {");
    const genericAt = eventBuyer.indexOf(
      "setSubmitError(freeCheckoutErrorMessage(error))",
    );
    expect(armAt).toBeGreaterThan(-1);
    expect(genericAt).toBeGreaterThan(-1);
    expect(armAt).toBeLessThan(genericAt);
    expect(eventBuyer).toContain(
      "setSubmitError(FREE_CHECKOUT_ALREADY_RESERVED_MESSAGE)",
    );
  });

  test("the event rail falls back to the cart's held token so a NATIVE resubmit can prove possession", () => {
    // `sessionStorage` is web-only: without this fallback `storage` is
    // `undefined` on iOS and Android, no token is ever presented, and EVERY
    // native resubmit of a completed free reservation is refused.
    const readAt = eventBuyer.indexOf(
      "readCheckoutResumePayload(storage, eventId)?.buyerStatusToken ??",
    );
    const fallbackAt = eventBuyer.indexOf("cartResult?.buyerStatusToken ??");
    const createAt = eventBuyer.indexOf("await createTicketCheckout({");
    expect(readAt).toBeGreaterThan(-1);
    expect(fallbackAt).toBeGreaterThan(-1);
    // The stored token is preferred, the cart's is the fallback, and both are
    // resolved before the request is built.
    expect(readAt).toBeLessThan(fallbackAt);
    expect(fallbackAt).toBeLessThan(createAt);
    expect(eventBuyer).toContain("{ buyerStatusToken: heldToken }");
  });

  test("the experience rail no longer renders the raw thrown message", () => {
    // The third free rail. Same leak, same fix, same mapper.
    expect(experienceBuyer).toContain(
      "setSubmitError(freeCheckoutErrorMessage(error))",
    );
    expect(experienceBuyer).toContain(
      "setSubmitError(FREE_CHECKOUT_ALREADY_RESERVED_MESSAGE)",
    );
    expect(experienceBuyer).not.toContain(
      "error instanceof Error\n            ? error.message",
    );
  });

  test("the trip rail no longer renders the raw thrown message", () => {
    // Pre-#2337 this catch rendered `error.message`, so a handled 409 arrived at
    // the guest as the literal string "Edge Function returned a non-2xx status
    // code" — the #2136 defect, still live on this route.
    expect(tripBuyer).toContain("setSubmitError(freeCheckoutErrorMessage(error))");
    expect(tripBuyer).toContain(
      "setSubmitError(FREE_CHECKOUT_ALREADY_RESERVED_MESSAGE)",
    );
    expect(tripBuyer).not.toContain(
      "error instanceof Error\n            ? error.message",
    );
  });

  test("neither rail inlines guest copy — the mapper is the only owner of these sentences", () => {
    for (const source of [eventBuyer, tripBuyer, experienceBuyer]) {
      for (const sentence of FREE_CHECKOUT_MESSAGES) {
        expect(source).not.toContain(sentence);
      }
    }
  });
});
