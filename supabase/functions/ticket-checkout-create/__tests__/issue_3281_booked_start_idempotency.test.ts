/**
 * issue #3281 — bookedStartAt is part of the reservation identity.
 *
 * Absent start => key STRING-IDENTICAL to today's (old clients / slots).
 * Different start => different key (never replay an old session).
 */
import {
  assertEquals,
  assertNotEquals,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { checkoutIdempotencyKey } from "../../_shared/ticketCheckout.ts";

const BASE = {
  eventId: "evt-3281",
  buyerEmail: "Guest@Example.com",
  buyerPhoneE164: "+2348012345678",
  lines: [{ ticketTypeId: "tt-exp", quantity: 2 }],
};
const DAY = "occ-day-1";
const START_A = "2026-11-20T11:00:00.000Z";
const START_B = "2026-11-20T14:00:00.000Z";

Deno.test("#3281 no bookedStartAt => identical to day-only / legacy key", () => {
  const dayOnly = checkoutIdempotencyKey({
    ...BASE,
    eventDateIds: [DAY],
  });
  assertEquals(
    checkoutIdempotencyKey({
      ...BASE,
      eventDateIds: [DAY],
      bookedStartAt: null,
    }),
    dayOnly,
  );
  assertEquals(
    checkoutIdempotencyKey({
      ...BASE,
      eventDateIds: [DAY],
      bookedStartAt: undefined,
    }),
    dayOnly,
  );
  assertEquals(
    checkoutIdempotencyKey({
      ...BASE,
      eventDateIds: [DAY],
      bookedStartAt: "",
    }),
    dayOnly,
  );
});

Deno.test("#3281 different bookedStartAt => different key (fails on silent omit)", () => {
  const a = checkoutIdempotencyKey({
    ...BASE,
    eventDateIds: [DAY],
    bookedStartAt: START_A,
  });
  const b = checkoutIdempotencyKey({
    ...BASE,
    eventDateIds: [DAY],
    bookedStartAt: START_B,
  });
  assertNotEquals(a, b);
  assertEquals(a.endsWith(`start:${START_A}`), true);
  assertEquals(b.endsWith(`start:${START_B}`), true);
});

Deno.test("#3281 start segment sits after days and before choice", () => {
  const key = checkoutIdempotencyKey({
    ...BASE,
    eventDateIds: [DAY],
    bookedStartAt: START_A,
    paymentPlanChoice: "full",
  });
  assertEquals(
    key,
    [
      "ticket_checkout",
      "evt-3281",
      "guest@example.com",
      "+2348012345678",
      "tt-exp:2",
      `days:${DAY}`,
      `start:${START_A}`,
      "choice:full",
    ].join(":"),
  );
});
