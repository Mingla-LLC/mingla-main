// #4490 P4 — private hire request messages: request sent, they said yes (pay
// the deposit, with the hold clock), hold ending, declined (with the reason),
// closed; and the venue's own "new request" message, which never carries the
// guest's private booking link.
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  isVenueBookingCategory,
  isVenueHostCategory,
  renderVenueBookingMessage,
  venueBookingEmailFacts,
} from "../email/templates/venueBookingEmails.ts";
import { providerSafePayload } from "../notifyV2.ts";
import { trustedVenueVisitCta } from "../venueOfferVisitLink.ts";
import {
  deriveVenueOfferBookingToken,
  venueOfferTokenHashHex,
} from "../venueOfferBookingToken.ts";
import { resolveVenueBookingDispatch } from "../../notify-outbox-drain/index.ts";

const GROUP = "00000000-4490-4000-8000-0000000000ab";
const PROD = "https://host.usemingla.com";
const TOKEN = "k1." + "A".repeat(43);

const projection = {
  groupId: GROUP,
  currencyCode: "NGN",
  holdUntil: "2026-12-04T17:00:00+00:00",
  amountDueNowMinor: 365500000,
  venue: { name: "Gameland QA", timezone: "Africa/Lagos" },
  offer: { name: "Private hire" },
  window: { localDate: "2026-12-12" },
  lines: [{ guests: 120 }],
  passes: [],
  hire: {
    placeName: "The Lounge Side",
    sessionLabel: "Evening",
    guests: 120,
    replyWithinHours: 48,
    declineReason: "We have a wedding that day",
    hostNote: "Including the projector",
  },
};

const GUEST = [
  "venue_request_received",
  "venue_payment_required",
  "venue_hold_expiring",
  "venue_request_declined",
  "venue_request_expired",
];

Deno.test("the request categories are venue booking categories; only the host one is a host message", () => {
  for (const key of [...GUEST, "venue_request_action_needed"]) {
    assert(isVenueBookingCategory(key), key);
  }
  assert(isVenueHostCategory("venue_request_action_needed"));
  for (const key of GUEST) assert(!isVenueHostCategory(key), key);
});

Deno.test("they said yes: the place, the hold clock in venue time, the deposit, the host's note", () => {
  const facts = venueBookingEmailFacts(projection, { amount_cents: 365500000 });
  assertEquals(facts.place_name, "The Lounge Side");
  assertEquals(facts.due_now, "₦3,655,000");
  assertEquals(facts.hold_until_text, "Fri 4 Dec 18:00");
  const payload = { ...facts, public_reference: "VB-ABC" };
  const yes = renderVenueBookingMessage("venue_payment_required", payload);
  assertStringIncludes(yes.email.subject, "Gameland QA said yes");
  assertStringIncludes(
    yes.email.body,
    "The Lounge Side is held for you until Fri 4 Dec 18:00",
  );
  assertStringIncludes(yes.email.body, "Pay ₦3,655,000 to make it yours");
  assertStringIncludes(yes.email.body, "Including the projector");
  const ending = renderVenueBookingMessage("venue_hold_expiring", payload);
  assertStringIncludes(ending.email.subject, "ends soon");
  const sent = renderVenueBookingMessage("venue_request_received", payload);
  assertStringIncludes(sent.email.body, "Nothing to pay yet");
  assertStringIncludes(sent.email.body, "within 48 hours");
  const no = renderVenueBookingMessage("venue_request_declined", payload);
  assertStringIncludes(no.email.body, "We have a wedding that day");
  assertStringIncludes(no.email.body, "Nothing was charged");
  const closed = renderVenueBookingMessage("venue_request_expired", {
    ...payload,
    reminder_reason: "not_paid",
  });
  assertStringIncludes(closed.email.body, "ended before it was paid");
  for (const key of [...GUEST, "venue_request_action_needed"]) {
    const msg = renderVenueBookingMessage(key, payload);
    assert(!/paystack|stripe|undefined|null|_/i.test(msg.email.subject), key);
    assert(
      !/paystack|stripe/i.test(JSON.stringify(msg)),
      `${key}: no provider names`,
    );
    assert(!/[₦]/.test(msg.sms), `${key}: SMS stays GSM-7`);
  }
});

Deno.test("the venue's message: a new request, or next in line; ids only in push", () => {
  const facts = venueBookingEmailFacts(projection, {});
  const fresh = renderVenueBookingMessage("venue_request_action_needed", {
    ...facts,
    public_reference: "VB-ABC",
  });
  assertStringIncludes(fresh.email.subject, "New request: The Lounge Side");
  const next = renderVenueBookingMessage("venue_request_action_needed", {
    ...facts,
    reminder_reason: "next_in_line",
  });
  assertStringIncludes(next.email.body, "is free again");
  assertEquals(
    Object.keys(providerSafePayload("venue_request_action_needed", {
      venue_group_id: GROUP,
      venue_id: "v",
      place_name: "The Lounge Side",
      guest_email: "x@example.test",
    })).sort(),
    ["venue_group_id", "venue_id"],
  );
});

Deno.test("the guest's private link never goes on the venue's message", async () => {
  assertEquals(
    trustedVenueVisitCta({
      serviceCaller: true,
      categoryKey: "venue_request_action_needed",
      payload: { venue_group_id: GROUP },
      visitUrl: `${PROD}/visit/${GROUP}#t=${TOKEN}`,
      origin: PROD,
    }),
    undefined,
  );
  assert(trustedVenueVisitCta({
    serviceCaller: true,
    categoryKey: "venue_payment_required",
    payload: { venue_group_id: GROUP },
    visitUrl: `${PROD}/visit/${GROUP}#t=${TOKEN}`,
    origin: PROD,
  }));
  const ring = {
    ok: true as const,
    current: { kid: "k1", key: new Uint8Array(32).fill(7) },
    previous: null,
  };
  const token = await deriveVenueOfferBookingToken({
    groupId: GROUP,
    key: ring.current,
  });
  const hash = `\\x${await venueOfferTokenHashHex(token)}`;
  let reads = 0;
  const admin = {
    rpc: () => Promise.resolve({ data: projection, error: null }),
    from: () => {
      reads += 1;
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: () =>
          Promise.resolve({ data: { buyer_token_hash: hash }, error: null }),
      };
      return chain;
    },
  };
  const host = await resolveVenueBookingDispatch(
    admin,
    {
      id: "o1",
      category_key: "venue_request_action_needed",
      contact: "owner@example.test",
      payload: { venue_group_id: GROUP },
    },
    () => undefined,
    ring,
  );
  assertEquals(host.visitUrl, null);
  assertEquals(reads, 0, "the token hash is not even read for a host message");
  assertEquals(host.facts.place_name, "The Lounge Side");
  const guest = await resolveVenueBookingDispatch(
    admin,
    {
      id: "o2",
      category_key: "venue_payment_required",
      contact: "ada@example.test",
      payload: { venue_group_id: GROUP },
    },
    () => undefined,
    ring,
  );
  assert(guest.visitUrl?.startsWith(`${PROD}/visit/${GROUP}#t=`));
});
