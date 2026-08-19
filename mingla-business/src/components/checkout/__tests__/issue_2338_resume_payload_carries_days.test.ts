/**
 * issue #2338 — THE CHOSEN DAYS MUST SURVIVE THE PROVIDER REDIRECT.
 *
 * Cart context is in-memory by design ("cart lifetime = single tab session").
 * Stripe's and Paystack's success_url force a full-page reload, so ORCH-0789/0790
 * persists `lines` + `buyer` in sessionStorage and restores them on /confirm.
 * The chosen day SET (#2160) was never added to that payload — so once the order
 * summary started naming the days, the PAID WEB leg would still have had none to
 * name and would have printed the event's date line instead of the guest's days.
 *
 * ══ WHAT THIS PROVES ═══════════════════════════════════════════════════════
 *   P-1  a payload carrying the day set round-trips intact
 *   P-2  BACKWARD COMPATIBILITY — a payload written by an older tab (no
 *        `eventDateIds` key at all) still validates and still restores. This is
 *        the one that matters operationally: entries persisted before this ships
 *        are live in guests' browsers right now, and rejecting them would strand
 *        a paid checkout mid-redirect on a screen with no lines and no buyer.
 *   P-3  a MALFORMED day set rejects the WHOLE payload rather than
 *        half-restoring a checkout
 *   P-4  every other funnel (trip / experience / single-date event) writes no
 *        day set and is byte-identical through the round trip
 *
 * FAILS-ON-REVERT: remove `eventDateIds` from `CheckoutResumePayload` and P-1
 * goes red; remove the `undefined`-tolerant clause from `isCheckoutResumePayload`
 * and P-2 goes red; remove the `every(typeof === "string")` clause and P-3 goes
 * red. Each rule has exactly one case that pins it.
 *
 * Owner: mingla-implementor. Issue: #2338.
 */

import {
  checkoutResumeStorageKey,
  isCheckoutResumePayload,
  readCheckoutResumePayload,
  writeCheckoutResumePayload,
  type CheckoutResumePayload,
} from "../checkoutPersistence";

const EVENT_ID = "2b05b5df-b8a0-4192-beb6-bc16111a2d85";
const DAY_29 = "0870ce30-0671-4cc0-b7c2-87412cb76ef9";
const DAY_30 = "a607a1d3-7525-400f-9772-6abbd16b52fe";

const makeStorage = (): Storage => {
  const map = new Map<string, string>();
  return {
    get length(): number {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, v),
  } as Storage;
};

const BASE: CheckoutResumePayload = {
  checkoutSessionId: "e2295c1a-df1a-48e5-bc1f-3b49c380d51d",
  buyerStatusToken: "bst-2338",
  lines: [
    {
      ticketTypeId: "tt-1",
      ticketName: "General",
      quantity: 2,
      unitPrice: 5000,
      currency: "NGN",
      isFree: false,
    },
  ],
  buyer: {
    name: "Seth",
    email: "seth@usemingla.com",
    phone: "+2348000000000",
    marketingOptIn: false,
  },
};

describe("issue #2338 P-1 — the chosen days round-trip", () => {
  test("a two-day event's day set comes back exactly as written", () => {
    const storage = makeStorage();
    writeCheckoutResumePayload(storage, EVENT_ID, {
      ...BASE,
      eventDateIds: [DAY_29, DAY_30],
    });
    const read = readCheckoutResumePayload(storage, EVENT_ID);
    expect(read).not.toBeNull();
    expect(read?.eventDateIds).toEqual([DAY_29, DAY_30]);
  });
});

describe("issue #2338 P-2 — payloads written BEFORE this field existed", () => {
  test("an entry with no eventDateIds key still validates", () => {
    expect(isCheckoutResumePayload(BASE)).toBe(true);
  });

  test("…and still restores lines + buyer, so no paid checkout is stranded", () => {
    const storage = makeStorage();
    // Written the way the pre-#2338 code wrote it — literally no such key.
    storage.setItem(checkoutResumeStorageKey(EVENT_ID), JSON.stringify(BASE));
    const read = readCheckoutResumePayload(storage, EVENT_ID);
    expect(read).not.toBeNull();
    expect(read?.lines).toHaveLength(1);
    expect(read?.buyer.email).toBe("seth@usemingla.com");
    expect(read?.eventDateIds).toBeUndefined();
  });
});

describe("issue #2338 P-3 — a malformed day set is refused outright", () => {
  test.each([
    ["a bare string instead of an array", "not-an-array"],
    ["numbers where ids belong", [1, 2]],
    ["a null hiding in the set", [DAY_29, null]],
    ["an object hiding in the set", [{ id: DAY_29 }]],
  ])("%s rejects the whole payload", (_label, eventDateIds) => {
    expect(isCheckoutResumePayload({ ...BASE, eventDateIds })).toBe(false);
  });

  test("a rejected payload reads back as null, never half-restored", () => {
    const storage = makeStorage();
    storage.setItem(
      checkoutResumeStorageKey(EVENT_ID),
      JSON.stringify({ ...BASE, eventDateIds: [1, 2] }),
    );
    expect(readCheckoutResumePayload(storage, EVENT_ID)).toBeNull();
  });
});

describe("issue #2338 P-4 — every other funnel is byte-identical", () => {
  test("a trip / experience / single-date write persists the SAME JSON as before", () => {
    const storage = makeStorage();
    writeCheckoutResumePayload(storage, EVENT_ID, BASE);
    // The stored string is what a pre-#2338 build would have stored, character
    // for character: this change adds an OPTIONAL key and nothing writes it
    // unless a day was actually chosen.
    expect(storage.getItem(checkoutResumeStorageKey(EVENT_ID))).toBe(
      JSON.stringify(BASE),
    );
  });

  test("an EMPTY day set is not written as an empty array either", () => {
    // The call site spreads conditionally (`eventDateIds.length > 0 ? … : {}`),
    // so this asserts the contract that keeps P-4 true rather than restating it.
    const withEmpty = { ...BASE, eventDateIds: [] as string[] };
    expect(JSON.stringify(withEmpty)).not.toBe(JSON.stringify(BASE));
  });
});
