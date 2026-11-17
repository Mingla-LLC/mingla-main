/*
 * #4453 milestone 5 — the live booking contracts (packages/site-contracts
 * availability.ts, ratings.ts and the new block fields).
 *
 * MINGLA-INVARIANT: I-SITES-BOOKING-FACTS-FROM-MINGLA | issue #4453 | every slot, night, tier, price and count a site shows comes from Core's live reads, and every booking link is this brand's own Mingla route.
 * MINGLA-INVARIANT: I-SITES-RATINGS-MINGLA-ONLY | issue #4453 | a rating on a site comes only from approved Mingla reviews, at least 20 (19 shows nothing); Google data never.
 * MINGLA-INVARIANT: I-SITES-ACTIONS-RESOLVE-TO-MINGLA | issue #4453 | a booking link to another brand's Mingla page, another host, http: or javascript: is refused; a full slot is never a link.
 */
import { describe, expect, it } from "vitest";
import {
  bookingBarHref, bookingRequestFor, isBrandBookingHref, liveTicketTiers, parseAvailability, parseBookingRequest,
  parseBookingTarget, parseTicketTiers, slotStateFor, type BookingTarget,
} from "./generated/availability.ts";
import { parseMinglaRating, ratingLine } from "./generated/ratings.ts";
import { ARI_BLOCK_TYPES, assertSiteBlock, BLOCK_TYPES, usesBookingBlocksFeature } from "./generated/blocks.ts";
import { ariBlockCatalog, blocksSchema } from "./generated/ariToolSchemas.ts";
import { ATELIER, DESIGNS, HAVEN, MAISON, NOCTURNE, VOYAGE } from "./generated/designs.ts";
import { isSiteOffering } from "./generated/offerings.ts";

const VENUE = "aaaaaaaa-bbbb-4ccc-8ddd-000000000002";
const EVENT = "aaaaaaaa-bbbb-4ccc-8ddd-000000000003";
const TIER = "aaaaaaaa-bbbb-4ccc-8ddd-000000000004";
const OWN = "https://host.usemingla.com/b/alpha/v/kitchen?tab=book&date=2026-11-20&time=18:00&party=2";

const slot = (over: Record<string, unknown> = {}) => ({ label: "18:00", start_local: "2026-11-20T18:00", state: "open", left: 6, price_minor: null, currency: null, href: OWN, ...over });
const feed = (slots: unknown[], over: Record<string, unknown> = {}) => ({
  generated_at: "2026-11-16T12:00:00.000Z", timezone: "Africa/Lagos", source: "venue_slots", title: "Alpha Kitchen",
  days: [{ local_date: "2026-11-20", slots }], ...over,
});

describe("#4453 M5 booking links (I-SITES-ACTIONS-RESOLVE-TO-MINGLA)", () => {
  it("accepts this brand's venue, experience, event and trip pages with known pre-fill only", () => {
    expect(isBrandBookingHref(OWN, "alpha")).toBe(true);
    expect(isBrandBookingHref("https://host.usemingla.com/exp/alpha/workshop?date=2026-11-20&slot=16:00", "alpha")).toBe(true);
    expect(isBrandBookingHref("https://host.usemingla.com/b/alpha/v/kitchen?tab=stay&checkin=2026-11-20&checkout=2026-11-22&room=" + VENUE, "alpha")).toBe(true);
    expect(isBrandBookingHref(`https://host.usemingla.com/checkout/${EVENT}?seed=${TIER}:1`, "alpha", new Set([EVENT]))).toBe(true);
  });
  it("refuses another brand, another host, http, javascript, unknown or bad parameters, and a foreign checkout", () => {
    expect(isBrandBookingHref(OWN.replace("/b/alpha/", "/b/beta/"), "alpha")).toBe(false);
    expect(isBrandBookingHref(OWN.replace("host.usemingla.com", "book.example.com"), "alpha")).toBe(false);
    expect(isBrandBookingHref(OWN.replace("https:", "http:"), "alpha")).toBe(false);
    expect(isBrandBookingHref("javascript:alert(1)", "alpha")).toBe(false);
    expect(isBrandBookingHref(`${OWN}&utm_source=x`, "alpha")).toBe(false);
    expect(isBrandBookingHref(OWN.replace("2026-11-20", "2026-02-31"), "alpha")).toBe(false);
    expect(isBrandBookingHref(OWN.replace("party=2", "party=99"), "alpha")).toBe(false);
    expect(isBrandBookingHref(`https://host.usemingla.com/checkout/${EVENT}?seed=${TIER}:1`, "alpha")).toBe(false);
  });
});

describe("#4453 M5 availability (SC-B1)", () => {
  it("parses a valid feed; few means 1-3 left, 0 is full", () => {
    expect(parseAvailability(feed([slot(), slot({ start_local: "2026-11-20T18:30", state: "few", left: 2 }), slot({ start_local: "2026-11-20T19:00", state: "full", left: 0, href: null })]), "alpha")?.days[0]?.slots).toHaveLength(3);
    expect(slotStateFor(3, false)).toBe("few");
    expect(slotStateFor(4, false)).toBe("open");
    expect(slotStateFor(0, false)).toBe("full");
  });
  it("adversarial: a full slot that links, a wrong state, another brand's link or over the limits fails the whole feed", () => {
    expect(parseAvailability(feed([slot({ state: "full", left: 0 })]), "alpha")).toBeNull();
    expect(parseAvailability(feed([slot({ state: "open", left: 2 })]), "alpha")).toBeNull();
    expect(parseAvailability(feed([slot({ href: OWN.replace("/alpha/", "/beta/") })]), "alpha")).toBeNull();
    expect(parseAvailability(feed(Array.from({ length: 25 }, (_, i) => slot({ start_local: `2026-11-20T${String(i % 24).padStart(2, "0")}:00` }))), "alpha")).toBeNull();
    expect(parseAvailability(feed([slot({ label: "x".repeat(25) })]), "alpha")).toBeNull();
    expect(parseAvailability({ ...feed([]), days: Array.from({ length: 15 }, (_, i) => ({ local_date: `2026-12-${String(i + 1).padStart(2, "0")}`, slots: [] })) }, "alpha")).toBeNull();
    expect(parseAvailability(feed([slot({ start_local: "2026-11-21T18:00" })]), "alpha")).toBeNull();
    expect(parseAvailability(feed([slot()], { timezone: "Mars/Base" }), "alpha")).toBeNull();
  });
});

describe("#4453 M5 ticket tiers (SC-B2)", () => {
  const tiers = (over: Record<string, unknown> = {}, tier: Record<string, unknown> = {}) => ({
    generated_at: "2026-11-16T12:00:00.000Z",
    event: { id: EVENT, title: "Night", start_at: "2026-12-01T19:00:00Z", end_at: "2026-12-01T23:00:00Z", timezone: "Africa/Lagos", status: "scheduled", public_url: "https://host.usemingla.com/e/alpha/night", ...over },
    tiers: [{ id: TIER, name: "General", price_minor: 500000, currency: "NGN", is_free: false, state: "on_sale", sale_starts_at: null, href: `https://host.usemingla.com/checkout/${EVENT}?seed=${TIER}:1`, ...tier }],
  });
  it("an on-sale tier links to this event's checkout with the tier seeded", () => {
    expect(liveTicketTiers(parseTicketTiers(tiers(), "alpha"), new Date("2026-11-16T12:00:00Z"))).toHaveLength(1);
  });
  it("adversarial: a sold-out tier that links, another brand's event, more than six tiers are refused", () => {
    expect(parseTicketTiers(tiers({}, { state: "sold_out" }), "alpha")).toBeNull();
    expect(parseTicketTiers(tiers({ public_url: "https://host.usemingla.com/e/beta/night" }), "alpha")).toBeNull();
    expect(parseTicketTiers(tiers({}, { href: `https://host.usemingla.com/checkout/${VENUE}?seed=${TIER}:1` }), "alpha")).toBeNull();
    const many = tiers();
    many.tiers = Array.from({ length: 7 }, (_, i) => ({ ...many.tiers[0]!, id: `aaaaaaaa-bbbb-4ccc-8ddd-00000000001${i}`, href: `https://host.usemingla.com/checkout/${EVENT}?seed=aaaaaaaa-bbbb-4ccc-8ddd-00000000001${i}:1` }));
    expect(parseTicketTiers(many, "alpha")).toBeNull();
  });
  it("a past, ended or cancelled event renders nothing; only not-yet tiers left renders nothing", () => {
    const now = new Date("2026-12-02T00:00:00Z");
    expect(liveTicketTiers(parseTicketTiers(tiers(), "alpha"), now)).toEqual([]);
    expect(liveTicketTiers(parseTicketTiers(tiers({ status: "ended" }), "alpha"), new Date("2026-11-16T12:00:00Z"))).toEqual([]);
    expect(liveTicketTiers(parseTicketTiers(tiers({ status: "cancelled" }), "alpha"), new Date("2026-11-16T12:00:00Z"))).toEqual([]);
    expect(liveTicketTiers(parseTicketTiers(tiers({}, { state: "not_yet", href: null, sale_starts_at: "2026-11-20T00:00:00Z" }), "alpha"), new Date("2026-11-16T12:00:00Z"))).toEqual([]);
  });
});

describe("#4453 M5 rating (SC-B3, I-SITES-RATINGS-MINGLA-ONLY)", () => {
  it("19 approved reviews: nothing; 20: one decimal; a Google source is refused", () => {
    expect(parseMinglaRating({ source: "mingla_place_reviews", score: 4.8, count: 19 })).toBeNull();
    expect(parseMinglaRating({ source: "google", score: 4.8, count: 900 })).toBeNull();
    expect(parseMinglaRating({ source: "mingla_place_reviews", score: 4.8, count: 20, google_rating: 4.9 })).toBeNull();
    const rating = parseMinglaRating({ source: "mingla_place_reviews", score: 3.94, count: 20 });
    expect(rating && ratingLine(rating)).toBe("3.9 · 20 reviews on Mingla");
  });
});

describe("#4453 M5 hero bar and requests", () => {
  const target: BookingTarget = { kind: "venue_table", id: VENUE, title: "Alpha Kitchen", base_url: "https://host.usemingla.com/b/alpha/v/kitchen", timezone: "Africa/Lagos", min_price_minor: null, currency: null };
  it("builds the Mingla URL with only valid pre-fill (bad values dropped)", () => {
    expect(bookingBarHref(target, { date: "2026-11-20", time: "19:30", party: "4" })).toBe("https://host.usemingla.com/b/alpha/v/kitchen?tab=book&date=2026-11-20&time=19%3A30&party=4");
    expect(bookingBarHref(target, { date: "tomorrow", time: "7pm", party: "40" })).toBe("https://host.usemingla.com/b/alpha/v/kitchen?tab=book");
    const stay = { ...target, kind: "stay" as const };
    expect(bookingBarHref(stay, { checkin: "2026-11-22", checkout: "2026-11-20", guests: "2" })).toBe("https://host.usemingla.com/b/alpha/v/kitchen?tab=stay&checkin=2026-11-22&guests=2");
    expect(parseBookingTarget({ ...target, base_url: "https://host.usemingla.com/b/beta/v/kitchen" }, "alpha")).toBeNull();
    expect(parseBookingTarget({ ...target, base_url: `${target.base_url}?tab=book` }, "alpha")).toBeNull();
  });
  it("the request comes only from stored blocks, deduplicated and capped", () => {
    const request = bookingRequestFor([
      { type: "availability", source: "venue_slots", offering_id: VENUE, party_size: 3, days: 5 },
      { type: "availability", source: "venue_slots", offering_id: VENUE, party_size: 3, days: 5 },
      { type: "ticket_tiers", offering_id: EVENT },
      { type: "hero", booking_bar: "venue_table", booking_target_id: VENUE, show_rating: true },
      { type: "hero", booking_bar: "trip_search" },
    ]);
    expect(request).toEqual({ availability: [{ source: "venue_slots", target_id: VENUE, party_size: 3, days: 5 }], ticket_tiers: [EVENT], targets: [{ kind: "venue_table", id: VENUE }], rating: true });
    expect(parseBookingRequest(request)).toEqual(request);
  });
});

describe("#4453 M5 blocks, designs and Ari", () => {
  const ctx = { mediaUrls: new Set<string>(), assertMedia: () => undefined };
  it("an availability block names exactly its source's target; a booking bar names its own", () => {
    expect(() => assertSiteBlock({ type: "availability", variant: "strip", source: "venue_slots", offering_id: VENUE, party_size: 2 }, ctx)).not.toThrow();
    expect(() => assertSiteBlock({ type: "availability", variant: "strip", source: "stay_nights", offering_id: VENUE }, ctx)).toThrow(/availability.target/);
    expect(() => assertSiteBlock({ type: "availability", variant: "strip", source: "event_dates", offering_id: VENUE, party_size: 2 }, ctx)).toThrow(/party_size/);
    expect(() => assertSiteBlock({ type: "availability", variant: "strip", source: "venue_slots", offering_id: VENUE, days: 30 }, ctx)).toThrow();
    expect(() => assertSiteBlock({ type: "hero", variant: "fullbleed", heading: "Hi", media_url: "/m", ctas: [], booking_bar: "venue_table" }, { ...ctx, mediaUrls: new Set(["/m"]) })).toThrow(/booking_target_id/);
    expect(() => assertSiteBlock({ type: "hero", variant: "fullbleed", heading: "Hi", media_url: "/m", ctas: [], booking_bar: "trip_search", booking_target_id: VENUE }, { ...ctx, mediaUrls: new Set(["/m"]) })).toThrow(/booking_target_id/);
  });
  it("every gallery design and Voyage draws the booking layouts; Atelier draws none (refused, never blank)", () => {
    for (const design of [VOYAGE, NOCTURNE, HAVEN, MAISON]) {
      expect(design.variants.availability).toContain("strip");
      expect(design.variants.ticket_tiers).toContain("split");
      expect(design.variants.process_steps).toContain("band");
    }
    expect(ATELIER.variants.availability).toEqual([]);
    expect(Object.keys(DESIGNS)).toContain("atelier");
  });
  it("Ari's declared tools do not offer the booking blocks or fields until milestone 7 (#3355)", () => {
    expect(ARI_BLOCK_TYPES).not.toContain("availability");
    expect(BLOCK_TYPES).toContain("availability");
    const declared = JSON.stringify([blocksSchema(), ariBlockCatalog()]);
    for (const word of ["availability", "ticket_tiers", "process_steps", "booking_bar", "booking_target_id", "show_rating", "\"stay\""]) expect(declared).not.toContain(word);
  });
  it("usesBookingBlocksFeature flags exactly the new offer (a stored trip search is not)", () => {
    expect(usesBookingBlocksFeature({ blockType: "ticket_tiers" })).toBe(true);
    expect(usesBookingBlocksFeature({ type: "hero", booking_bar: "stay" })).toBe(true);
    expect(usesBookingBlocksFeature({ type: "hero", booking_bar: "trip_search" })).toBe(false);
    expect(usesBookingBlocksFeature({ type: "testimonials", show_rating: true })).toBe(true);
    expect(usesBookingBlocksFeature({ type: "faq" })).toBe(false);
  });
});

describe("#4453 M5 stay feed rows (SC-B6)", () => {
  const room = {
    id: VENUE, kind: "stay", slug: VENUE, title: "Lagoon Room", summary: null, cover: null, destination_text: "Lagoon Stay",
    start_at: null, end_at: null, timezone: null, status: "scheduled", bookings_closed: false, capacity: null, spots_left: null,
    group_minimum: null, min_price_minor: 9900000, currency: "NGN", has_free_tier: false, waitlist_enabled: false, installments_available: false,
    public_url: `https://host.usemingla.com/b/lagoon/v/lagoonstay?tab=stay&room=${VENUE}`,
  };
  it("a stay row links only to a venue page's stay tab with the room", () => {
    expect(isSiteOffering(room)).toBe(true);
    expect(isSiteOffering({ ...room, public_url: `https://host.usemingla.com/b/lagoon/v/lagoonstay?tab=stay` })).toBe(false);
    expect(isSiteOffering({ ...room, public_url: `https://host.usemingla.com/b/lagoon/v/lagoonstay?tab=stay&room=${VENUE}&x=1` })).toBe(false);
    expect(isSiteOffering({ ...room, public_url: `https://host.usemingla.com/t/lagoon/trip` })).toBe(false);
  });
});
