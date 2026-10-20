/**
 * issue #3281 — open-daily occurrence + start survive the provider redirect.
 *
 * FAILS-ON-REVERT: drop `eventDateId` / `bookedStartAt` from the payload type
 * or the validator and the round-trip goes red.
 */

import {
  checkoutResumeStorageKey,
  isCheckoutResumePayload,
  readCheckoutResumePayload,
  writeCheckoutResumePayload,
  type CheckoutResumePayload,
} from "../checkoutPersistence";

const EVENT_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const DATE_ID = "11111111-2222-3333-4444-555555555555";
const BOOKED = "2026-11-07T16:00:00.000Z";

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
  checkoutSessionId: "cs-3281-resume",
  buyerStatusToken: "bst-3281",
  lines: [
    {
      ticketTypeId: "tt-1",
      ticketName: "Open daily",
      quantity: 2,
      unitPrice: 0,
      currency: "NGN",
      isFree: true,
    },
  ],
  buyer: {
    name: "Guest",
    email: "guest@usemingla.com",
    phone: "+2348000000000",
    marketingOptIn: false,
  },
};

describe("issue #3281 — resume payload carries occurrence + booked start", () => {
  test("eventDateId and bookedStartAt round-trip together", () => {
    const storage = makeStorage();
    writeCheckoutResumePayload(storage, EVENT_ID, {
      ...BASE,
      eventDateId: DATE_ID,
      bookedStartAt: BOOKED,
    });
    const read = readCheckoutResumePayload(storage, EVENT_ID);
    expect(read).not.toBeNull();
    expect(read?.eventDateId).toBe(DATE_ID);
    expect(read?.bookedStartAt).toBe(BOOKED);
  });

  test("older payloads without those keys still validate", () => {
    expect(isCheckoutResumePayload(BASE)).toBe(true);
    const storage = makeStorage();
    storage.setItem(checkoutResumeStorageKey(EVENT_ID), JSON.stringify(BASE));
    expect(readCheckoutResumePayload(storage, EVENT_ID)).not.toBeNull();
  });
});
