// #4490 P6 — member messages, the member token and the member link: the
// renewal email states the month's money (base, VAT, total) and never names a
// payment provider; the member token is derived from the member id and only
// re-derived when it matches the stored hash; the email button is trusted only
// for the same member, from the service role, on the expected origin.
// TEST-MOD-APPROVED #4490: spec 07 G/M adds approval/decline steps and the
// member's approved fallback door code to this issue-owned message matrix.
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { renderVenueMembershipMessage } from "../email/templates/venueMembershipEmails.ts";
import {
  buildVenueMemberUrl,
  deriveVenueMemberToken,
  issueVenueMemberToken,
  rederiveVenueMemberToken,
  venueMemberUrlSubscriptionId,
} from "../venueMembershipToken.ts";
import { trustedVenueVisitCta } from "../venueOfferVisitLink.ts";
import { venueOfferTokenHashHex } from "../venueOfferBookingToken.ts";
import { renderCategoryMessage } from "../notifyTemplates.ts";

const SUB = "00000000-4490-4000-8000-0000000000d6";
const OTHER = "00000000-4490-4000-8000-0000000000e6";
const ORIGIN = "http://localhost:8491";
const KEY = { kid: "k1", key: new Uint8Array(32).fill(7) };
// deno-lint-ignore no-explicit-any
const RING: any = { ok: true, current: KEY, previous: null };

const PAYLOAD = {
  subscription_id: SUB,
  venue_name: "Kora Works",
  plan_name: "Hot desk",
  member_name: "Amaka Eze",
  amount_cents: 8500000,
  vat_cents: 637500,
  total_cents: 9137500,
  currency: "NGN",
  period_start_date: "2026-12-01",
  grace_ends_on: "2026-12-08",
  paid_through: "2027-01-01",
  ends_on: "2026-12-01",
  member_code: "K7P4QX",
};

Deno.test("renewal email: the date, the month's money and no provider name", () => {
  const m = renderVenueMembershipMessage("venue_membership_renewal", { ...PAYLOAD, step: "renewal" });
  assertEquals(m.email.subject, "Your Hot desk renews on Tue 1 Dec");
  assert(m.email.body.startsWith("Hi Amaka,"));
  assert(m.email.body.includes("Hot desk from Tue 1 Dec: ₦85,000"));
  assert(m.email.body.includes("VAT: ₦6,375"));
  assert(m.email.body.includes("Total: ₦91,375"));
  assert(m.email.body.includes("Nothing is charged by itself"));
  for (const text of [m.email.subject, m.email.body, m.push.title, m.push.body, m.sms]) {
    assert(!/paystack|stripe/i.test(text), text);
  }
});

Deno.test("yearly messages name the year, use the venue in the renewal subject and distinguish the seven-day reminder", () => {
  const annual = { ...PAYLOAD, period: "year", period_start_date: "2027-12-01", paid_through: "2028-12-01" };
  const renewal = renderVenueMembershipMessage("venue_membership_renewal", { ...annual, step: "renewal" });
  assertEquals(renewal.email.subject, "Your year with Kora Works renews on Wed 1 Dec");
  const reminder = renderVenueMembershipMessage("venue_membership_renewal", { ...annual, step: "year_reminder" });
  assertEquals(reminder.email.subject, "Reminder: Your year with Kora Works renews on Wed 1 Dec");
  const approved = renderVenueMembershipMessage("venue_membership_renewal", { ...annual, step: "approval" });
  assert(approved.email.body.includes("for your first year within 3 days"));
  const first = renderVenueMembershipMessage("venue_membership_paid", { ...annual, step: "first" });
  assert(first.email.body.includes("Your first year is paid"));
  assert(first.email.body.includes("Before each new year"));
});

Deno.test("due, reminder, lapsed, paid and ended read in plain words", () => {
  const approved = renderVenueMembershipMessage("venue_membership_renewal", { ...PAYLOAD, step: "approval" });
  assertEquals(approved.email.subject, "You're approved for Hot desk at Kora Works");
  assert(approved.email.body.includes("Pay ₦91,375 within 3 days to start"));
  assert(approved.email.body.includes("Nothing renews or is charged by itself"));
  const due = renderVenueMembershipMessage("venue_membership_renewal", { ...PAYLOAD, step: "due" });
  assert(due.email.body.includes("You can still come in until Tue 8 Dec"));
  const reminder = renderVenueMembershipMessage("venue_membership_renewal", { ...PAYLOAD, step: "reminder" });
  assertEquals(reminder.email.subject, "Reminder: pay for your Hot desk by Tue 8 Dec");
  const lapsed = renderVenueMembershipMessage("venue_membership_lapsed", PAYLOAD);
  assertEquals(lapsed.email.subject, "Your Hot desk at Kora Works is paused");
  const first = renderVenueMembershipMessage("venue_membership_paid", { ...PAYLOAD, step: "first" });
  assertEquals(first.email.subject, "Welcome to Hot desk at Kora Works");
  assert(first.email.body.includes("Nothing renews by itself"));
  const renewal = renderVenueMembershipMessage("venue_membership_paid", { ...PAYLOAD, step: "renewal" });
  assertEquals(renewal.email.subject, "Your Hot desk is paid until Fri 1 Jan");
  const leaving = renderVenueMembershipMessage("venue_membership_ended", { ...PAYLOAD, step: "leaving" });
  assertEquals(leaving.email.subject, "You're leaving Hot desk on Tue 1 Dec");
  const declined = renderVenueMembershipMessage("venue_membership_ended", { ...PAYLOAD, step: "declined" });
  assertEquals(declined.email.subject, "Your Hot desk request at Kora Works");
  assert(declined.email.body.includes("No payment was taken"));
  // The shared renderer routes the member categories here.
  assertEquals(renderCategoryMessage("venue_membership_lapsed", PAYLOAD).email.subject, lapsed.email.subject);
});

Deno.test("join, approval and renewal emails show the member code with display spacing", () => {
  const first = renderVenueMembershipMessage("venue_membership_paid", { ...PAYLOAD, step: "first" });
  const approved = renderVenueMembershipMessage("venue_membership_renewal", { ...PAYLOAD, step: "approval" });
  const renewal = renderVenueMembershipMessage("venue_membership_renewal", { ...PAYLOAD, step: "renewal" });
  const paid = renderVenueMembershipMessage("venue_membership_paid", { ...PAYLOAD, step: "renewal" });
  for (const message of [first, approved, renewal, paid]) {
    assert(message.email.body.includes("Can’t scan? Your code: K7P 4QX"));
    assert(!message.email.body.includes("K7P4QX"));
  }
});

Deno.test("the member token is derived from the member id and re-derived only when it matches", async () => {
  const issued = await issueVenueMemberToken({ subscriptionId: SUB, ring: RING });
  assert(issued.derived);
  assertEquals(issued.token, await deriveVenueMemberToken({ subscriptionId: SUB, key: KEY }));
  const hash = await venueOfferTokenHashHex(issued.token);
  assertEquals(await rederiveVenueMemberToken({ subscriptionId: SUB, storedHashHex: `\\x${hash}`, ring: RING }), issued.token);
  assertEquals(await rederiveVenueMemberToken({ subscriptionId: OTHER, storedHashHex: `\\x${hash}`, ring: RING }), null);
  // A different label from the booking token: the same id never gives the same token.
  const { deriveVenueOfferBookingToken } = await import("../venueOfferBookingToken.ts");
  assert(issued.token !== await deriveVenueOfferBookingToken({ groupId: SUB, key: KEY }));
  const random = await issueVenueMemberToken({ subscriptionId: SUB, ring: { ok: false, reason: "manage_key_absent" } });
  assertEquals(random.derived, false);
});

Deno.test("the member link button is trusted only for the same member, from the service role", async () => {
  const token = await deriveVenueMemberToken({ subscriptionId: SUB, key: KEY });
  const url = buildVenueMemberUrl({ origin: ORIGIN, subscriptionId: SUB, token });
  assertEquals(url, `${ORIGIN}/visit/plan/${SUB}#t=${token}`);
  assertEquals(venueMemberUrlSubscriptionId(url, ORIGIN), SUB);
  assertEquals(venueMemberUrlSubscriptionId(`${url}&x=1`, ORIGIN), null);
  assertEquals(venueMemberUrlSubscriptionId(url.replace(ORIGIN, "https://evil.example"), ORIGIN), null);
  const ok = trustedVenueVisitCta({
    serviceCaller: true, categoryKey: "venue_membership_renewal", payload: PAYLOAD, visitUrl: url, origin: ORIGIN,
  });
  assertEquals(ok?.label, "Pay now");
  assertEquals(ok?.url, url);
  assertEquals(trustedVenueVisitCta({
    serviceCaller: true, categoryKey: "venue_membership_renewal", payload: { ...PAYLOAD, subscription_id: OTHER },
    visitUrl: url, origin: ORIGIN,
  }), undefined);
  assertEquals(trustedVenueVisitCta({
    serviceCaller: false, categoryKey: "venue_membership_renewal", payload: PAYLOAD, visitUrl: url, origin: ORIGIN,
  }), undefined);
  // A member link is never accepted as a booking button.
  assertEquals(trustedVenueVisitCta({
    serviceCaller: true, categoryKey: "venue_booking_confirmed", payload: { venue_group_id: SUB }, visitUrl: url, origin: ORIGIN,
  }), undefined);
});
