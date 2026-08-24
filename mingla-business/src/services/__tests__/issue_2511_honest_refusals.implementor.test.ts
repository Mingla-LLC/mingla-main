/**
 * issue #2511 items 5 + 6 — EVERY REFUSAL SAYS WHAT HAPPENED, AND WE NEVER CLAIM
 * SOMETHING WE CANNOT KNOW.
 *
 * WHAT WAS BROKEN.
 *
 * `biz_ticket_checkout_create_session` raises twenty-plus distinct bounded
 * tokens. `ticket-checkout-create` puts every one of them in `detail` under a
 * single `checkout_session_failed` code, and the mapper matched exactly ONE of
 * them (`ticket_capacity_exceeded`). So nineteen different, permanent,
 * actionable refusals — sales closed, a per-person limit, a removed ticket
 * type, a finished day — all rendered as:
 *
 *     "We could not reserve your free ticket. Nothing was reserved — please try
 *      again."
 *
 * telling the guest to repeat an action that could never succeed. That is the
 * message on the screenshots that opened #2462.
 *
 * Separately, the mapper's TERMINAL arm returned that same sentence for an
 * OPAQUE failure — a dropped connection, a timeout, a 5xx. In that case the
 * request may well have reached the server and created the reservation; only the
 * reply is missing. "Nothing was reserved" is unprovable there, and it caused
 * measurable harm: three guests on We Go Again were told it, changed their email,
 * resubmitted, and ended up holding two orders each.
 *
 * WHAT THIS PINS.
 *
 *  1. Each raise token gets its OWN sentence — not the generic one, and not
 *     shared with another token.
 *  2. Every sentence is ACTIONABLE or terminal; none says "try again" for a
 *     refusal that retrying cannot clear.
 *  3. "Nothing was reserved" appears ONLY on messages where it is provably true
 *     (refusals raised before any row can exist). The opaque arm must not say it.
 *  4. Totality survives: every input still yields a string this module owns.
 *
 * THE TOKENS ARE REAL. Each was forced against the production RPC and the raised
 * MESSAGE_TEXT captured verbatim — they arrive as bare tokens, which is why
 * matching `detail` is sound.
 *
 * FAILS ON REVERT: restore the single-token detail check and the
 * FREE_CHECKOUT_FAILED_MESSAGE terminal arm, and the per-token and no-lie tests
 * below fail.
 */
import { describe, expect, test } from "@jest/globals";

import {
  FREE_CHECKOUT_FAILED_MESSAGE,
  FREE_CHECKOUT_MESSAGES,
  FREE_CHECKOUT_SOLD_OUT_MESSAGE,
  FREE_CHECKOUT_UNKNOWN_MESSAGE,
  freeCheckoutErrorMessage,
} from "../checkoutErrorCopy";

/** Shape `invokeOrThrow` produces for a handled edge refusal. */
const refusal = (code: string, detail: string): Error => {
  const e = new Error("Edge Function returned a non-2xx status code") as Error & {
    status: number;
    code: string;
    detail: string;
  };
  e.status = 409;
  e.code = code;
  e.detail = detail;
  return e;
};

/**
 * Every raise token reachable on the FREE rail, captured from the production
 * RPC. `ticket_capacity_exceeded` is covered separately — it has always had its
 * own sentence and keeps precedence.
 */
const FREE_RAIL_RAISE_TOKENS = [
  "ticket_lines_required",
  "ticket_quantity_invalid",
  "buyer_phone_required",
  "event_not_found",
  "event_not_selling",
  "occurrence_not_found",
  "occurrence_not_available",
  "ticket_type_not_found",
  "ticket_type_unavailable",
  "ticket_sales_not_started",
  "ticket_sales_ended",
  "ticket_quantity_below_min",
  "ticket_quantity_above_max",
  "mixed_currency_cart",
] as const;

describe("issue #2511 item 5 — every server refusal gets its own honest sentence", () => {
  test.each(FREE_RAIL_RAISE_TOKENS)(
    "%s does not fall through to the generic sentence",
    (token) => {
      const message = freeCheckoutErrorMessage(
        refusal("checkout_session_failed", token),
      );
      // THE BUG: every one of these used to return exactly this.
      expect(message).not.toBe(FREE_CHECKOUT_FAILED_MESSAGE);
      expect(FREE_CHECKOUT_MESSAGES).toContain(message);
    },
  );

  test("each token gets a DISTINCT sentence — no two share one", () => {
    const seen = new Map<string, string>();
    for (const token of FREE_RAIL_RAISE_TOKENS) {
      const message = freeCheckoutErrorMessage(
        refusal("checkout_session_failed", token),
      );
      const clash = seen.get(message);
      expect(clash).toBeUndefined();
      seen.set(message, token);
    }
    expect(seen.size).toBe(FREE_RAIL_RAISE_TOKENS.length);
  });

  test("a refusal that retrying cannot clear never says 'try again'", () => {
    // Sales closed and a finished day are permanent. Telling someone to retry
    // is the exact failure mode this issue exists to remove.
    for (const token of ["ticket_sales_ended", "occurrence_not_available"]) {
      const message = freeCheckoutErrorMessage(
        refusal("checkout_session_failed", token),
      );
      expect(message.toLowerCase()).not.toContain("try again");
    }
  });

  test("a refusal the guest CAN act on tells them what to change", () => {
    expect(
      freeCheckoutErrorMessage(
        refusal("checkout_session_failed", "ticket_quantity_above_max"),
      ).toLowerCase(),
    ).toContain("lower the quantity");
    expect(
      freeCheckoutErrorMessage(
        refusal("checkout_session_failed", "buyer_phone_required"),
      ).toLowerCase(),
    ).toContain("country code");
  });

  test("capacity keeps precedence over every other raise token", () => {
    // A detail carrying BOTH must still read as sold out — that arm is the one
    // claim allowed to say there are none left.
    expect(
      freeCheckoutErrorMessage(
        refusal(
          "checkout_session_failed",
          "ticket_capacity_exceeded ticket_sales_ended",
        ),
      ),
    ).toBe(FREE_CHECKOUT_SOLD_OUT_MESSAGE);
  });
});

describe("issue #2511 item 6 — we never claim 'nothing was reserved' unless we know", () => {
  test("an opaque transport failure says we do not know, and to check first", () => {
    const opaque = new Error("Failed to fetch");
    const message = freeCheckoutErrorMessage(opaque);
    expect(message).toBe(FREE_CHECKOUT_UNKNOWN_MESSAGE);
    // THE LIE, gone.
    expect(message.toLowerCase()).not.toContain("nothing was reserved");
    // And it must steer them away from the duplicate-order behaviour.
    expect(message.toLowerCase()).toContain("check your email");
  });

  test("every shape with no status and no token lands on the honest arm", () => {
    for (const value of [null, undefined, 0, "", "boom", {}, [], NaN, false]) {
      expect(freeCheckoutErrorMessage(value)).toBe(
        FREE_CHECKOUT_UNKNOWN_MESSAGE,
      );
    }
  });

  test("'nothing was reserved' survives ONLY where it is provably true", () => {
    // Every raise in the list fires BEFORE any row is inserted, so the claim is
    // sound for them. It must NOT appear on the unknown arm.
    for (const token of FREE_RAIL_RAISE_TOKENS) {
      expect(
        freeCheckoutErrorMessage(refusal("checkout_session_failed", token))
          .toLowerCase(),
      ).toContain("nothing was reserved");
    }
    expect(FREE_CHECKOUT_UNKNOWN_MESSAGE.toLowerCase()).not.toContain(
      "nothing was reserved",
    );
  });

  test("the mapper is still TOTAL and never leaks a runtime string", () => {
    const nasty: unknown[] = [
      new TypeError("undefined is not an object"),
      { message: "Edge Function returned a non-2xx status code" },
      Symbol("x"),
      () => undefined,
    ];
    for (const value of nasty) {
      const message = freeCheckoutErrorMessage(value);
      expect(typeof message).toBe("string");
      expect(FREE_CHECKOUT_MESSAGES).toContain(message);
      expect(message).not.toMatch(/non-2xx/);
      expect(message).not.toMatch(/undefined/);
    }
  });
});
