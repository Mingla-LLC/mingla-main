// #4490 P3 — balance due / overdue, booking changed and balance paid messages:
// plain words with the amounts read from the booking at send time, the private
// "Pay the rest" button only for the same booking, ids only in push payloads.
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  isVenueBookingCategory,
  renderVenueBookingMessage,
  venueBookingEmailFacts,
} from "../email/templates/venueBookingEmails.ts";
import { providerSafePayload } from "../notifyV2.ts";
import { trustedVenueVisitCta } from "../venueOfferVisitLink.ts";

const GROUP = "00000000-4490-4000-8000-0000000000aa";
const PROD = "https://host.usemingla.com";
const TOKEN = "k1." + "A".repeat(43);

const projection = {
  groupId: GROUP,
  currencyCode: "NGN",
  paidMinor: 7525000,
  balanceDueMinor: 7525000,
  balanceDueAt: "2026-11-26T15:00:00+00:00",
  venue: { name: "Gameland QA" },
  offer: { name: "Squad" },
  window: { localDate: "2026-11-28" },
  passes: [{ admits: 12 }],
  lines: [{ guests: 12 }],
};

const NEW = [
  "venue_balance_due",
  "venue_balance_overdue",
  "venue_booking_changed",
  "venue_balance_paid",
];

Deno.test("the four P3 categories are venue booking categories", () => {
  for (const key of NEW) assert(isVenueBookingCategory(key), key);
});

Deno.test("balance due and overdue say how much and by when, from the booking at send time", () => {
  const facts = venueBookingEmailFacts(projection, { amount_cents: 1 });
  assertEquals(facts.balance, "₦75,250");
  assertEquals(facts.balance_due_date, "Thu 26 Nov");
  const payload = { ...facts, public_reference: "VB-ABC" };
  const due = renderVenueBookingMessage("venue_balance_due", payload);
  assertStringIncludes(due.email.subject, "due by Thu 26 Nov");
  assertStringIncludes(due.email.body, "₦75,250 is left to pay");
  assertStringIncludes(due.email.body, "Squad at Gameland QA on Sat 28 Nov");
  const overdue = renderVenueBookingMessage("venue_balance_overdue", payload);
  assertStringIncludes(overdue.email.subject, "overdue");
  assertStringIncludes(overdue.email.body, "was due on Thu 26 Nov");
  for (const msg of [due, overdue]) {
    assert(!/paystack|stripe/i.test(JSON.stringify(msg)), "no provider names");
    assert(!/[₦]/.test(msg.sms), "SMS stays GSM-7");
  }
});

Deno.test("booking changed and balance paid read plainly", () => {
  const facts = venueBookingEmailFacts({ ...projection, balanceDueMinor: 0 }, {
    amount_cents: 7525000,
  });
  const changed = renderVenueBookingMessage("venue_booking_changed", {
    ...facts,
  });
  assertStringIncludes(changed.email.body, "now on Sat 28 Nov for 12 guests");
  const paid = renderVenueBookingMessage("venue_balance_paid", { ...facts });
  assertStringIncludes(
    paid.email.body,
    "₦75,250 for your Squad at Gameland QA",
  );
  assertStringIncludes(paid.email.body, "Nothing more to pay.");
});

Deno.test("the Pay the rest button only opens the same booking; push payloads carry ids only", () => {
  const url = `${PROD}/visit/${GROUP}#t=${TOKEN}`;
  const cta = trustedVenueVisitCta({
    serviceCaller: true,
    categoryKey: "venue_balance_due",
    payload: { venue_group_id: GROUP },
    visitUrl: url,
    origin: PROD,
  });
  assertEquals(cta?.label, "Pay the rest");
  assertEquals(
    trustedVenueVisitCta({
      serviceCaller: true,
      categoryKey: "venue_balance_due",
      payload: { venue_group_id: "00000000-4490-4000-8000-0000000000bb" },
      visitUrl: url,
      origin: PROD,
    }),
    undefined,
  );
  for (const key of NEW) {
    const safe = providerSafePayload(key, {
      venue_group_id: GROUP,
      venue_id: "v",
      balance: "₦75,250",
      guest_email: "x@example.test",
    });
    assertEquals(Object.keys(safe).sort(), ["venue_group_id", "venue_id"]);
  }
});
