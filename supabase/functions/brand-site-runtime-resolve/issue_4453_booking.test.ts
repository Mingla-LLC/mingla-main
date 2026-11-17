// #4453 milestone 5 — brand-site-runtime-resolve's booking answer: every Core
// read is re-validated against the shared contract before it leaves Core.
import { assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { answerBooking, bookingBrandSlug, type BookingRpc } from "./booking.ts";
import { parseBookingRequest } from "../_shared/siteContracts/availability.ts";

const SITE = "aaaaaaaa-bbbb-4ccc-8ddd-000000000001";
const VENUE = "aaaaaaaa-bbbb-4ccc-8ddd-000000000002";
const EVENT = "aaaaaaaa-bbbb-4ccc-8ddd-000000000003";
const TIER = "aaaaaaaa-bbbb-4ccc-8ddd-000000000004";

const slot = (state: string, left: number | null, href: string | null) => ({
  label: "18:00", start_local: "2026-11-20T18:00", state, left, price_minor: null, currency: null, href,
});
const venueFeed = (slots: unknown[]) => ({
  generated_at: "2026-11-16T12:00:00.000Z", timezone: "Africa/Lagos", source: "venue_slots", title: "Alpha Kitchen",
  days: [{ local_date: "2026-11-20", slots }],
});
const OWN = "https://host.usemingla.com/b/alpha/v/kitchen?tab=book&date=2026-11-20&time=18:00&party=2";

function rpcOf(answers: Record<string, unknown>, calls: Array<{ fn: string; args: Record<string, unknown> }> = []): BookingRpc {
  return async (fn, args) => {
    calls.push({ fn, args });
    return { data: answers[fn] ?? null, error: null };
  };
}

const request = parseBookingRequest({
  availability: [{ source: "venue_slots", target_id: VENUE, party_size: 2, days: 7 }],
  ticket_tiers: [EVENT],
  targets: [{ kind: "venue_table", id: VENUE }],
  rating: true,
})!;

Deno.test("#4453 M5 — a valid Core answer passes through, keyed by the request", async () => {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const answer = await answerBooking(rpcOf({
    brand_site_venue_slots: venueFeed([slot("open", 6, OWN), slot("full", 0, null)].map((s, i) => ({ ...s, start_local: `2026-11-20T1${8 + i}:00` }))),
    brand_site_ticket_tiers: {
      generated_at: "2026-11-16T12:00:00.000Z",
      event: { id: EVENT, title: "Night", start_at: "2026-12-01T19:00:00Z", end_at: null, timezone: "Africa/Lagos", status: "scheduled", public_url: "https://host.usemingla.com/e/alpha/night" },
      tiers: [{ id: TIER, name: "General", price_minor: 500000, currency: "NGN", is_free: false, state: "on_sale", sale_starts_at: null, href: `https://host.usemingla.com/checkout/${EVENT}?seed=${TIER}:1` }],
    },
    brand_site_booking_target: { kind: "venue_table", id: VENUE, title: "Alpha Kitchen", base_url: "https://host.usemingla.com/b/alpha/v/kitchen", timezone: "Africa/Lagos", min_price_minor: null, currency: null },
    brand_site_mingla_rating: { source: "mingla_place_reviews", score: 4.4, count: 20 },
  }, calls), SITE, "alpha", request);
  assertEquals(Object.keys(answer.availability), [`venue_slots:${VENUE}:2:7`]);
  assertEquals(answer.ticket_tiers[EVENT]?.tiers.length, 1);
  assertEquals(answer.targets[`venue_table:${VENUE}`]?.base_url, "https://host.usemingla.com/b/alpha/v/kitchen");
  assertEquals(answer.rating, { source: "mingla_place_reviews", score: 4.4, count: 20 });
  // Every read is bound to the signed site.
  assertEquals(calls.every((call) => call.args.p_site_id === SITE), true);
});

Deno.test("#4453 M5 — adversarial: a full slot with a link, another brand's link, or 19 reviews are dropped", async () => {
  const answer = await answerBooking(rpcOf({
    brand_site_venue_slots: venueFeed([slot("full", 0, OWN)]),
    brand_site_ticket_tiers: {
      generated_at: "2026-11-16T12:00:00.000Z",
      event: { id: EVENT, title: "Night", start_at: null, end_at: null, timezone: null, status: "scheduled", public_url: "https://host.usemingla.com/e/other-brand/night" },
      tiers: [],
    },
    brand_site_booking_target: { kind: "venue_table", id: VENUE, title: "X", base_url: "https://booking.example.com/b/alpha/v/kitchen", timezone: null, min_price_minor: null, currency: null },
    brand_site_mingla_rating: { source: "mingla_place_reviews", score: 4.9, count: 19 },
  }), SITE, "alpha", request);
  assertEquals(answer.availability, {});
  assertEquals(answer.ticket_tiers, {});
  assertEquals(answer.targets, {});
  assertEquals(answer.rating, null);
});

Deno.test("#4453 M5 — a Google-sourced rating is refused even at 500 reviews", async () => {
  const answer = await answerBooking(rpcOf({ brand_site_mingla_rating: { source: "google", score: 4.9, count: 500 } }), SITE, "alpha",
    parseBookingRequest({ availability: [], ticket_tiers: [], targets: [], rating: true })!);
  assertEquals(answer.rating, null);
});

Deno.test("#4453 M5 — a request outside the contract is refused before any read", () => {
  assertEquals(parseBookingRequest({ availability: [{ source: "venue_slots", target_id: VENUE, party_size: 40, days: 7 }], ticket_tiers: [], targets: [], rating: false }), null);
  assertEquals(parseBookingRequest({ availability: [], ticket_tiers: ["not-a-uuid"], targets: [], rating: false }), null);
  assertEquals(parseBookingRequest({ availability: [], ticket_tiers: [], targets: [{ kind: "trip_search", id: VENUE }], rating: false }), null);
  assertEquals(parseBookingRequest({ availability: [], ticket_tiers: Array(7).fill(EVENT), targets: [], rating: false }), null);
  assertEquals(parseBookingRequest({ availability: [], ticket_tiers: [], targets: [], rating: false, extra: 1 }), null);
});

Deno.test("#4453 M5 — the brand slug comes from Core's own read of the site", async () => {
  assertEquals(await bookingBrandSlug(rpcOf({ brand_site_booking_brand: [{ brand_id: SITE, brand_slug: "alpha" }] }), SITE), "alpha");
  assertEquals(await bookingBrandSlug(rpcOf({ brand_site_booking_brand: [] }), SITE), null);
});
