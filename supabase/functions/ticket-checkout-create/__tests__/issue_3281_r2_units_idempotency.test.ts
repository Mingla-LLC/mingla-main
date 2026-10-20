/**
 * issue #3281 R2 — bookedEndAt + partySize are part of reservation identity.
 * Absent => key string-identical to start-only; different => different key.
 */
import {
  assertEquals,
  assertNotEquals,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { checkoutIdempotencyKey } from "../../_shared/ticketCheckout.ts";

const BASE = {
  eventId: "evt-3281-r2",
  buyerEmail: "Guest@Example.com",
  buyerPhoneE164: "+2348012345678",
  lines: [{ ticketTypeId: "tt-block", quantity: 1 }],
};
const DAY = "occ-day-1";
const START = "2026-11-20T11:00:00.000Z";
const END_A = "2026-11-20T12:00:00.000Z";
const END_B = "2026-11-20T13:00:00.000Z";

Deno.test("#3281 R2 no end/party => identical to start-only key", () => {
  const startOnly = checkoutIdempotencyKey({
    ...BASE,
    eventDateIds: [DAY],
    bookedStartAt: START,
  });
  assertEquals(
    checkoutIdempotencyKey({
      ...BASE,
      eventDateIds: [DAY],
      bookedStartAt: START,
      bookedEndAt: null,
      partySize: null,
    }),
    startOnly,
  );
  assertEquals(
    checkoutIdempotencyKey({
      ...BASE,
      eventDateIds: [DAY],
      bookedStartAt: START,
      bookedEndAt: "",
      partySize: 0,
    }),
    startOnly,
  );
});

Deno.test("#3281 R2 different end => different key", () => {
  const a = checkoutIdempotencyKey({
    ...BASE,
    eventDateIds: [DAY],
    bookedStartAt: START,
    bookedEndAt: END_A,
  });
  const b = checkoutIdempotencyKey({
    ...BASE,
    eventDateIds: [DAY],
    bookedStartAt: START,
    bookedEndAt: END_B,
  });
  assertNotEquals(a, b);
  assertEquals(a.includes(`end:${END_A}`), true);
});

Deno.test("#3281 R2 different party => different key", () => {
  const a = checkoutIdempotencyKey({
    ...BASE,
    eventDateIds: [DAY],
    bookedStartAt: START,
    partySize: 4,
  });
  const b = checkoutIdempotencyKey({
    ...BASE,
    eventDateIds: [DAY],
    bookedStartAt: START,
    partySize: 6,
  });
  assertNotEquals(a, b);
  assertEquals(a.includes("party:4"), true);
});
