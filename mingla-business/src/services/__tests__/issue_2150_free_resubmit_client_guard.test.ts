/**
 * issue #2150 [duplicate free tickets on resubmit] — CLIENT guard.
 *
 * The server refuses to hand a completed free reservation to a caller who
 * cannot prove it is theirs. Two client-side things have to be right for that
 * to be safe AND humane:
 *
 *   1. The guest's browser must actually HOLD the buyer status token, or every
 *      legitimate resubmit is indistinguishable from an attacker who merely
 *      knows the guest's email and phone. The free path never persisted it
 *      before this issue — `writeCheckoutResumePayload` was called only from
 *      the PAID redirect path in `payment.tsx`.
 *   2. The "you already have this" answer must NOT be rendered with the
 *      "nothing was reserved" copy. That is the exact opposite of the truth and
 *      would push a guest who already holds a ticket into reserving again.
 */
import {
  FREE_CHECKOUT_ALREADY_RESERVED_MESSAGE,
  FREE_CHECKOUT_FAILED_MESSAGE,
  FREE_CHECKOUT_UNAVAILABLE_MESSAGE,
  isCompletedFreeOrder,
  isFreeAlreadyReserved,
  type TicketCheckoutCreateResult,
} from "../ticketCheckoutService";
import {
  isCheckoutResumePayload,
  readCheckoutResumePayload,
  writeCheckoutResumePayload,
} from "../../components/checkout/checkoutPersistence";
import { readFileSync } from "fs";
import { join } from "path";

const memoryStorage = (): Storage => {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, v),
  } as Storage;
};

const EVENT_ID = "10000000-0000-4000-8000-000000002150";
const TOKEN = "issue2150validbuyerstatustoken0123456789abcdef";

const alreadyReserved: TicketCheckoutCreateResult = {
  kind: "free_already_reserved",
  eventId: EVENT_ID,
};

describe("#2150 the already-reserved answer is narrowed and never mistaken for a failure", () => {
  it("is recognised by its own guard", () => {
    expect(isFreeAlreadyReserved(alreadyReserved)).toBe(true);
  });

  it("is NOT a completed free order — it must never reach the confirm screen", () => {
    // There is deliberately no order payload on it, so the confirm screen would
    // have nothing to render.
    expect(isCompletedFreeOrder(alreadyReserved)).toBe(false);
  });

  it("carries NO order id, NO checkout session id and NO tickets", () => {
    const serialized = JSON.stringify(alreadyReserved);
    expect(serialized).not.toContain("orderId");
    expect(serialized).not.toContain("checkoutSessionId");
    expect(serialized).not.toContain("tickets");
    expect(serialized).not.toContain("qrPayload");
  });

  it("gets copy that says the guest HAS a ticket, not that nothing was reserved", () => {
    expect(FREE_CHECKOUT_ALREADY_RESERVED_MESSAGE).toMatch(/already have/i);
    // The two failure messages both say "Nothing was reserved" — the exact
    // opposite of the truth here.
    expect(FREE_CHECKOUT_ALREADY_RESERVED_MESSAGE).not.toBe(
      FREE_CHECKOUT_FAILED_MESSAGE,
    );
    expect(FREE_CHECKOUT_ALREADY_RESERVED_MESSAGE).not.toBe(
      FREE_CHECKOUT_UNAVAILABLE_MESSAGE,
    );
    expect(FREE_CHECKOUT_ALREADY_RESERVED_MESSAGE).not.toMatch(
      /no longer available/i,
    );
    expect(FREE_CHECKOUT_ALREADY_RESERVED_MESSAGE).not.toMatch(
      /Nothing was reserved\./,
    );
  });
});

describe("#2150 the free path persists the buyer status token so a resubmit can prove possession", () => {
  it("round-trips the token through the existing resume payload", () => {
    const storage = memoryStorage();
    writeCheckoutResumePayload(storage, EVENT_ID, {
      checkoutSessionId: "30000000-0000-4000-8000-000000002152",
      buyerStatusToken: TOKEN,
      lines: [{
        ticketTypeId: "20000000-0000-4000-8000-000000002151",
        ticketName: "Free entry",
        quantity: 1,
        unitPrice: 0,
        currency: "NGN",
        isFree: true,
      }],
      buyer: {
        name: "Resubmitting Guest",
        email: "guest@issue2150.test",
        phone: "+15551234567",
        marketingOptIn: false,
      },
    });

    const read = readCheckoutResumePayload(storage, EVENT_ID);
    expect(read).not.toBeNull();
    expect(read?.buyerStatusToken).toBe(TOKEN);
  });

  it("yields no token for an event that was never reserved — the request must then omit it", () => {
    const storage = memoryStorage();
    expect(readCheckoutResumePayload(storage, EVENT_ID)).toBeNull();
    expect(readCheckoutResumePayload(storage, EVENT_ID)?.buyerStatusToken ?? "")
      .toBe("");
  });

  it("refuses a stored payload with an empty token rather than presenting one", () => {
    // A blank token must never be treated as possession — the server rejects an
    // empty hash, and the client must not pretend to hold something.
    expect(
      isCheckoutResumePayload({
        checkoutSessionId: "30000000-0000-4000-8000-000000002152",
        buyerStatusToken: "",
        lines: [],
        buyer: {
          name: "n",
          email: "e",
          phone: "p",
          marketingOptIn: false,
        },
      }),
    ).toBe(false);
  });
});

/**
 * The call site itself, pinned by ORDER rather than by mere presence — the
 * pattern `issue_2136_free_checkout_client_guard.test.ts` established for this
 * exact file. Presence alone would stay green if the persist were moved
 * somewhere it never runs, and a token that is never stored is a token the
 * guest can never present.
 */
describe("#2150 buyer.tsx wires the possession round-trip on the free path", () => {
  const source = readFileSync(
    join(__dirname, "../../../app/checkout/[eventId]/buyer.tsx"),
    "utf8",
  );

  test("the held token is READ and FORWARDED into the create call", () => {
    const readAt = source.indexOf("readCheckoutResumePayload(storage, eventId)");
    const forwardAt = source.indexOf(
      "{ buyerStatusToken: heldToken }",
    );
    const createAt = source.indexOf("await createTicketCheckout({");
    expect(readAt).toBeGreaterThan(-1);
    expect(forwardAt).toBeGreaterThan(-1);
    expect(createAt).toBeGreaterThan(-1);
    // Read first, then forwarded inside the create call's argument object.
    expect(readAt).toBeLessThan(createAt);
    expect(createAt).toBeLessThan(forwardAt);
  });

  test("the token is PERSISTED after the order is confirmed and before the result is recorded", () => {
    const guardAt = source.indexOf("isCompletedFreeOrder(result)");
    const persistAt = source.indexOf("writeCheckoutResumePayload(storage, eventId, {");
    const recordAt = source.indexOf("recordResult({");
    expect(guardAt).toBeGreaterThan(-1);
    expect(persistAt).toBeGreaterThan(-1);
    expect(recordAt).toBeGreaterThan(-1);
    // Only a confirmed order's token is stored, and it is stored before the
    // component hands off to the confirm screen.
    expect(guardAt).toBeLessThan(persistAt);
    expect(persistAt).toBeLessThan(recordAt);
  });

  test("the already-reserved answer is handled BEFORE the free_completed narrowing", () => {
    const alreadyAt = source.indexOf("isFreeAlreadyReserved(result)");
    const completedAt = source.indexOf('result.kind !== "free_completed"');
    expect(alreadyAt).toBeGreaterThan(-1);
    expect(completedAt).toBeGreaterThan(-1);
    // Otherwise the guest is told their reservation "unexpectedly required
    // payment" about a free ticket they already hold.
    expect(alreadyAt).toBeLessThan(completedAt);
    expect(source).toContain(
      "setSubmitError(FREE_CHECKOUT_ALREADY_RESERVED_MESSAGE)",
    );
  });
});
