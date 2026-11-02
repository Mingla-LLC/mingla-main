/**
 * issue #3281 — Extras, buyer side: the cart's reading of the event's extras
 * and the limits it offers mirror issue_3281_price_extras, and extras are part
 * of a checkout attempt's identity.
 */

import {
  assert,
  assertEquals,
  assertNotEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  extraCap,
  extrasCartDates,
  extrasLineDates,
  extrasParentCount,
  extrasRefusalCopy,
  extrasRefusalIn,
  extraSoldOutOnLine,
  fitExtrasToLine,
  parsePublicTicketExtras,
  withExtraQuantity,
} from "../ticketExtrasCart.ts";
import {
  checkoutClientAttemptFingerprint,
  normalizeCheckoutV2Lines,
  type CheckoutClientAttemptInput,
} from "../ticketCheckoutContract.ts";

const FRI = "11111111-1111-4111-8111-111111111111";
const SAT = "22222222-2222-4222-8222-222222222222";
const DINNER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TOTE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TICKET = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const EVENT = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

// The shape pg_direct_event_checkout_bundle carries (migration 20280315003281).
const payload = [
  {
    id: DINNER,
    name: "Friday dinner",
    description: "Three courses",
    priceCents: 1500,
    priceAllInCents: 1620,
    maxPerTicket: 2,
    isUnlimited: false,
    validOccurrenceIds: [FRI],
    remaining: { [FRI]: 3 },
  },
  {
    id: TOTE,
    name: "Tote bag",
    description: null,
    priceCents: 0,
    priceAllInCents: 0,
    maxPerTicket: 1,
    isUnlimited: true,
    validOccurrenceIds: null,
    remaining: null,
  },
];

Deno.test("#3281 extras: the cart reads the reader's extras and drops malformed ones", () => {
  const extras = parsePublicTicketExtras([
    ...payload,
    { id: 7, name: "bad id" },
    { id: "x", name: "no cap", priceCents: 100, maxPerTicket: 0 },
    "not an object",
  ]);
  assertEquals(extras.map((extra) => extra.id), [DINNER, TOTE]);
  assertEquals(extras[0].priceAllInCents, 1620);
  assertEquals(extras[0].remaining, { [FRI]: 3 });
  assertEquals(extras[1].remaining, null);
  assertEquals(parsePublicTicketExtras(undefined), []);
  // A limited extra whose count can't be read is not offered.
  const unreadable = parsePublicTicketExtras([{ ...payload[0], remaining: "3" }]);
  assertEquals(extraCap(unreadable[0], 5, [FRI]), 0);
});

Deno.test("#3281 extras: the cap is maxPerTicket × tickets, then places left on each date", () => {
  const [dinner, tote] = parsePublicTicketExtras(payload);
  // One ticket: 2 per ticket allows 2, 3 left on Friday allows 3 → 2.
  assertEquals(extraCap(dinner, 1, [FRI, SAT]), 2);
  // Two tickets: 4 allowed, but only 3 left on Friday.
  assertEquals(extraCap(dinner, 2, [FRI, SAT]), 3);
  // Not on the line's dates: not offered.
  assertEquals(extraCap(dinner, 2, [SAT]), 0);
  // No tickets: nothing.
  assertEquals(extraCap(tote, 0, []), 0);
  // Unlimited and every date: only the per-ticket cap.
  assertEquals(extraCap(tote, 4, []), 4);
});

Deno.test("#3281 extras: a line's tickets and dates are counted the way the server counts them", () => {
  assertEquals(extrasParentCount({ quantity: 3 }), 3);
  assertEquals(extrasParentCount({ quantity: 3, byDate: { [FRI]: 2, [SAT]: 1 } }), 3);
  assertEquals(extrasParentCount(undefined), 0);
  assertEquals(extrasLineDates({ quantity: 1, byDate: { [FRI]: 1, [SAT]: 0 } }, null, [FRI, SAT]), [FRI]);
  assertEquals(extrasLineDates({ quantity: 1 }, [SAT], [FRI, SAT]), [SAT]);
  assertEquals(extrasLineDates({ quantity: 1 }, null, [FRI, SAT]), [FRI, SAT]);
});

Deno.test("#3281 extras: an all-days pass reads every date that hasn't ended", () => {
  const now = Date.parse("2027-03-02T00:00:00Z");
  const occurrences = [
    { id: FRI, endAt: "2027-03-01T22:00:00Z" },
    { id: SAT, endAt: "2027-03-02T22:00:00Z" },
  ];
  assertEquals(extrasCartDates([], occurrences, true, now), [SAT]);
  // Any other cart reads the guest's chosen dates.
  assertEquals(extrasCartDates([FRI], occurrences, false, now), [FRI]);
  const [dinner] = parsePublicTicketExtras([{ ...payload[0], validOccurrenceIds: [SAT], remaining: { [SAT]: 3 } }]);
  assertEquals(extraCap(dinner, 1, extrasLineDates({ quantity: 1 }, null, extrasCartDates([], occurrences, true, now))), 2);
});

Deno.test("#3281 extras: a sold-out extra on the line's dates says so", () => {
  const [dinner] = parsePublicTicketExtras([{ ...payload[0], remaining: { [FRI]: 0 } }]);
  assert(extraSoldOutOnLine(dinner, [FRI]));
  assert(!extraSoldOutOnLine(dinner, [SAT]));
});

Deno.test("#3281 extras: counts change one extra and stay in the server's order", () => {
  let addOns = withExtraQuantity(undefined, TOTE, 1);
  addOns = withExtraQuantity(addOns, DINNER, 2);
  assertEquals(addOns, [
    { addOnId: DINNER, quantity: 2 },
    { addOnId: TOTE, quantity: 1 },
  ]);
  addOns = withExtraQuantity(addOns, DINNER, 0);
  assertEquals(addOns, [{ addOnId: TOTE, quantity: 1 }]);
  // The last one removed leaves no list, so the line's body is unchanged.
  assertEquals(withExtraQuantity(addOns, TOTE, 0), undefined);
});

Deno.test("#3281 extras: fewer tickets bring the extras down; nothing changed keeps the same list", () => {
  const extras = parsePublicTicketExtras(payload);
  const picked = [
    { addOnId: DINNER, quantity: 3 },
    { addOnId: TOTE, quantity: 2 },
  ];
  assertEquals(fitExtrasToLine(picked, extras, 1, [FRI]), [
    { addOnId: DINNER, quantity: 2 },
    { addOnId: TOTE, quantity: 1 },
  ]);
  // Saturday only: the Friday dinner goes.
  assertEquals(fitExtrasToLine(picked, extras, 2, [SAT]), [{ addOnId: TOTE, quantity: 2 }]);
  // An extra taken off sale goes.
  assertEquals(fitExtrasToLine(picked, [extras[1]], 2, [FRI]), [{ addOnId: TOTE, quantity: 2 }]);
  const fine = [{ addOnId: TOTE, quantity: 1 }];
  assert(fitExtrasToLine(fine, extras, 2, [FRI]) === fine);
});

Deno.test("#3281 extras: every database refusal has buyer copy, found inside a raw message", () => {
  for (const code of [
    "extras_invalid",
    "extra_not_available",
    "extra_quantity_above_max",
    "extra_not_on_chosen_days",
    "extra_capacity_exceeded",
    "extras_need_paid_ticket",
    "extras_not_on_installments",
  ]) {
    assert(extrasRefusalCopy(code) !== null, code);
    assertEquals(extrasRefusalIn(`ERROR: ${code}`), code);
  }
  assertEquals(extrasRefusalCopy("ticket_capacity_exceeded"), null);
  assertEquals(extrasRefusalIn("checkout_quote_failed"), null);
});

const attempt = (lines: CheckoutClientAttemptInput["lines"]): CheckoutClientAttemptInput => ({
  eventId: EVENT,
  purchaseTermsAccepted: true,
  buyer: { name: "Ada", email: "ada@example.test", phone: "+15555550100", marketingOptIn: false },
  providerInput: { surface: "web" },
  lines,
  eventDateId: null,
  eventDateIds: [],
  intakeFormData: [],
});

Deno.test("#3281 extras: a change of extras is a new checkout attempt", () => {
  const plain = { ticketTypeId: TICKET, quantity: 2, paymentPlanChoice: "full" as const };
  const withDinner = {
    ...plain,
    addOns: [
      { addOnId: TOTE, quantity: 1 },
      { addOnId: DINNER, quantity: 1 },
    ],
  };
  const none = checkoutClientAttemptFingerprint(attempt([plain]));
  const some = checkoutClientAttemptFingerprint(attempt([withDinner]));
  assertNotEquals(none, some);
  assertNotEquals(
    checkoutClientAttemptFingerprint(attempt([{ ...plain, addOns: [{ addOnId: TOTE, quantity: 2 }] }])),
    some,
  );
  // An empty list is the same cart as no list.
  assertEquals(checkoutClientAttemptFingerprint(attempt([{ ...plain, addOns: [] }])), none);
  const parsed = normalizeCheckoutV2Lines([withDinner]);
  assert(parsed.ok);
  // The cart keeps them sorted (withExtraQuantity), so the contract keeps the order it's given.
  assertEquals(parsed.lines[0].addOns?.map((entry) => entry.addOnId), [TOTE, DINNER]);
});
