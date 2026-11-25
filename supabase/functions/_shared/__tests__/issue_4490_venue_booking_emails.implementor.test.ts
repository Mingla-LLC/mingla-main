// #4490 P2-6 — venue booking emails: the copy for each category, the private
// booking link built at send time (public host, token in the fragment only),
// the dispatch-side validation of that link, and the local-only mail route.
import {
  assert,
  assertEquals,
  assertFalse,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  renderVenueBookingMessage,
  venueBookingEmailFacts,
} from "../email/templates/venueBookingEmails.ts";
import { renderCategoryMessage } from "../notifyTemplates.ts";
import { providerSafePayload } from "../notifyV2.ts";
import {
  buildVenueVisitUrl,
  resolveVenueVisitOrigin,
  trustedVenueVisitCta,
  venueVisitUrlGroupId,
} from "../venueOfferVisitLink.ts";
import {
  deriveVenueOfferBookingToken,
  venueOfferTokenHashHex,
} from "../venueOfferBookingToken.ts";
import { resendEmailsUrl } from "../adapters/emailAdapter.ts";
import { resolveVenueBookingDispatch } from "../../notify-outbox-drain/index.ts";

const GROUP = "00000000-4490-4000-8000-0000000000aa";
const OTHER = "00000000-4490-4000-8000-0000000000bb";
const TOKEN = "k1." + "A".repeat(43);
const PROD = "https://host.usemingla.com";
const env = (values: Record<string, string>) => (name: string) => values[name];

const projection = {
  groupId: GROUP,
  currencyCode: "NGN",
  paidMinor: 1505000,
  refundedMinor: 752500,
  venue: { name: "Gameland QA" },
  offer: { name: "Entry" },
  window: { localDate: "2026-11-19" },
  lines: [{ guests: 2 }, { guests: 1 }],
  passes: [{ admits: 3, idCheckLabel: "Student or NYSC ID", idCheckCount: 1 }],
};

Deno.test("copy: each venue category names the venue, the day and the numbers, never a code or a provider", () => {
  const facts = venueBookingEmailFacts(projection, {
    amount_cents: 1505000,
    currency: "NGN",
  });
  const base = { ...facts, public_reference: "VB-1234" };
  const confirmed = renderCategoryMessage("venue_booking_confirmed", base);
  assertEquals(
    confirmed.email.subject,
    "You're in: Entry at Gameland QA on Thu 19 Nov",
  );
  assertStringIncludes(confirmed.email.body, "confirmed for 3 guests");
  assertStringIncludes(confirmed.email.body, "You paid ₦15,050.");
  assertStringIncludes(
    confirmed.email.body,
    "Bring a valid Student or NYSC ID for 1 guest",
  );
  assertStringIncludes(confirmed.email.body, "Booking VB-1234.");

  const cancelled = renderVenueBookingMessage("venue_booking_cancelled", base);
  assertStringIncludes(cancelled.email.body, "₦7,525 is on its way back");
  const refund = renderVenueBookingMessage("venue_refund_state", {
    ...venueBookingEmailFacts(projection, {
      amount_cents: 752500,
      currency: "NGN",
    }),
    public_reference: "VB-1234",
  });
  assertEquals(refund.email.subject, "Your refund from Gameland QA");
  assertStringIncludes(refund.email.body, "₦7,525 for your Entry");
  for (const m of [confirmed, cancelled, refund]) {
    const all = JSON.stringify(m);
    assertFalse(/paystack|stripe|venue_|offer_/i.test(all), all);
    assertFalse(/[^\x20-\x7E]/.test(m.sms), `SMS stays GSM-7 ascii: ${m.sms}`);
  }
});

Deno.test("link: public host, token only in the fragment, one accepted spelling", () => {
  const url = buildVenueVisitUrl({
    origin: PROD,
    groupId: GROUP,
    token: TOKEN,
  });
  assertEquals(url, `${PROD}/visit/${GROUP}#t=${TOKEN}`);
  const parsed = new URL(url);
  assertEquals(parsed.host, "host.usemingla.com");
  assertEquals(parsed.search, "");
  assertFalse(
    parsed.pathname.includes(TOKEN),
    "the token never sits in the path",
  );
  assertEquals(venueVisitUrlGroupId(url, PROD), GROUP);
  assertEquals(venueVisitUrlGroupId(`${url}&x=1`, PROD), null);
  assertEquals(
    venueVisitUrlGroupId(url.replace(PROD, "https://evil.example"), PROD),
    null,
  );
  assertEquals(
    venueVisitUrlGroupId(`${PROD}/visit/${GROUP}?t=${TOKEN}`, PROD),
    null,
  );
});

Deno.test("origin: production by default; loopback only when the function runs on a local stack", () => {
  assertEquals(resolveVenueVisitOrigin(env({})), PROD);
  assertEquals(
    resolveVenueVisitOrigin(
      env({
        BUSINESS_WEB_ORIGIN: "http://127.0.0.1:8491",
        SUPABASE_URL: "https://x.supabase.co",
      }),
    ),
    PROD,
  );
  assertEquals(
    resolveVenueVisitOrigin(
      env({
        BUSINESS_WEB_ORIGIN: "http://127.0.0.1:8491",
        SUPABASE_URL: "http://kong:8000",
      }),
    ),
    "http://127.0.0.1:8491",
  );
  assertEquals(
    resolveVenueVisitOrigin(
      env({ BUSINESS_WEB_ORIGIN: "https://evil.example" }),
    ),
    PROD,
  );
  assertEquals(
    resolveVenueVisitOrigin(
      env({
        BUSINESS_WEB_ORIGIN: "http://guest.localhost:8491",
        SUPABASE_URL: "http://kong:8000",
      }),
    ),
    "http://guest.localhost:8491",
  );
  assertEquals(
    resolveVenueVisitOrigin(
      env({
        BUSINESS_WEB_ORIGIN: "http://guest.localhost:8491",
        SUPABASE_URL: "https://x.supabase.co",
      }),
    ),
    PROD,
  );
  assertEquals(
    resolveVenueVisitOrigin(
      env({
        BUSINESS_WEB_ORIGIN: "http://evil.com.localhost.example:8491",
        SUPABASE_URL: "http://kong:8000",
      }),
    ),
    PROD,
  );
});

Deno.test("dispatch: the button is rendered only for the service role, a venue category and the same booking", () => {
  const url = buildVenueVisitUrl({
    origin: PROD,
    groupId: GROUP,
    token: TOKEN,
  });
  const ok = trustedVenueVisitCta({
    serviceCaller: true,
    categoryKey: "venue_booking_confirmed",
    payload: { venue_group_id: GROUP },
    visitUrl: url,
    origin: PROD,
  });
  assertEquals(ok?.label, "See your pass");
  assertEquals(ok?.url, url);
  for (
    const bad of [
      {
        serviceCaller: false,
        categoryKey: "venue_booking_confirmed",
        payload: { venue_group_id: GROUP },
      },
      {
        serviceCaller: true,
        categoryKey: "buyer_reservation_confirmed",
        payload: { venue_group_id: GROUP },
      },
      {
        serviceCaller: true,
        categoryKey: "venue_booking_confirmed",
        payload: { venue_group_id: OTHER },
      },
    ]
  ) {
    assertEquals(
      trustedVenueVisitCta({ ...bad, visitUrl: url, origin: PROD }),
      undefined,
    );
  }
});

Deno.test("drain: the link is re-derived at send time from the stored hash; push payload keeps ids only", async () => {
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
  const admin = {
    rpc: () => Promise.resolve({ data: projection, error: null }),
    from: () => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: () =>
          Promise.resolve({ data: { buyer_token_hash: hash }, error: null }),
      };
      return chain;
    },
  };
  const row = {
    id: "o1",
    category_key: "venue_booking_confirmed",
    contact: "ada@example.test",
    payload: { venue_group_id: GROUP, amount_cents: 1505000, currency: "NGN" },
  };
  const local = await resolveVenueBookingDispatch(
    admin,
    row,
    env({
      BUSINESS_WEB_ORIGIN: "http://127.0.0.1:8491",
      SUPABASE_URL: "http://kong:8000",
    }),
    ring,
  );
  assertEquals(
    local.visitUrl,
    `http://127.0.0.1:8491/visit/${GROUP}#t=${token}`,
  );
  assertEquals(local.facts.venue_name, "Gameland QA");
  assertFalse(
    JSON.stringify(local.facts).includes(token),
    "the token never enters the payload",
  );
  const prod = await resolveVenueBookingDispatch(admin, row, env({}), ring);
  assert(prod.visitUrl?.startsWith(`${PROD}/visit/${GROUP}#t=`));
  // a phone contact (no email) never gets the link
  const sms = await resolveVenueBookingDispatch(
    admin,
    { ...row, contact: "+2348030000000" },
    env({}),
    ring,
  );
  assertEquals(sms.visitUrl, null);
  assertEquals(
    providerSafePayload("venue_booking_confirmed", {
      ...local.facts,
      venue_group_id: GROUP,
      venue_id: "v",
    }),
    { venue_group_id: GROUP, venue_id: "v" },
  );
});

Deno.test("mail route: the local stand-in is honoured only on a local stack", () => {
  assertEquals(resendEmailsUrl(env({})), "https://api.resend.com/emails");
  assertEquals(
    resendEmailsUrl(
      env({
        LOCAL_RESEND_API_URL: "http://host.docker.internal:57541",
        SUPABASE_URL: "https://x.supabase.co",
      }),
    ),
    "https://api.resend.com/emails",
  );
  assertEquals(
    resendEmailsUrl(
      env({
        LOCAL_RESEND_API_URL: "https://evil.example",
        SUPABASE_URL: "http://kong:8000",
      }),
    ),
    "https://api.resend.com/emails",
  );
  assertEquals(
    resendEmailsUrl(
      env({
        LOCAL_RESEND_API_URL: "http://host.docker.internal:57541",
        SUPABASE_URL: "http://kong:8000",
      }),
    ),
    "http://host.docker.internal:57541/emails",
  );
});
