/*
 * #2829 AD-6 (T-W4) — offering state in each offering's OWN timezone, the
 * date-range and price words, the grid selection and filters, and the
 * snapshot contract the artifact carries.
 * see I-PROPOSED-2829-11 (declared beside the builder test) — an ended or cancelled offering is a
 * state the site shows, never a reason to refuse a publish.
 */
import { describe, expect, it } from "vitest";
import {
  assertOfferingsSnapshot,
  formatOfferingDates,
  formatOfferingPrice,
  normalizeSiteOffering,
  offeringState,
  parseOfferingsFeed,
  selectGridOfferings,
  type SiteOffering,
} from "./generated/offerings.ts";
import { assertSiteBlock } from "./generated/blocks.ts";

const base: SiteOffering = {
  id: "11111111-1111-4111-8111-111111111111",
  kind: "trip",
  slug: "bali",
  title: "Bali",
  summary: "Seven days.",
  cover: null,
  destination_text: "Ubud, Bali",
  start_at: "2026-06-20T02:00:00.000Z",
  end_at: "2026-06-27T02:00:00.000Z",
  timezone: "Asia/Makassar",
  status: "scheduled",
  bookings_closed: false,
  capacity: 20,
  spots_left: 5,
  group_minimum: null,
  min_price_minor: 249900,
  currency: "USD",
  has_free_tier: false,
  public_url: "https://host.usemingla.com/t/youngandstamped/bali",
  waitlist_enabled: false,
  installments_available: true,
};
const offering = (patch: Partial<SiteOffering>): SiteOffering => ({ ...base, ...patch });
let n = 0;
const uid = () => `22222222-2222-4222-8222-${String(++n).padStart(12, "0")}`;

describe("#2829 offering state", () => {
  it("decides upcoming / running / ended from the offering's own local dates", () => {
    const now = new Date("2026-06-10T12:00:00Z");
    expect(offeringState(base, now)).toMatchObject({ phase: "upcoming", bookable: true, badge: null });
    expect(offeringState(base, new Date("2026-06-22T12:00:00Z"))).toMatchObject({ phase: "running", bookable: false, badge: "Happening now" });
    expect(offeringState(base, new Date("2026-06-28T12:00:00Z"))).toMatchObject({ phase: "ended", bookable: false, badge: "Ended" });
  });

  it("uses the offering's timezone across the date line, not the server's", () => {
    // One stored trip; only the timezone differs.
    const trip = (timezone: string) => offering({ start_at: "2026-06-27T10:30:00.000Z", end_at: "2026-06-27T10:45:00.000Z", timezone });
    // 11:30Z: June 28 01:30 in Kiritimati (UTC+14) — the trip is on today;
    // June 27 00:30 in Pago Pago (UTC-11) — it was yesterday, so it ended.
    const now = new Date("2026-06-27T11:30:00Z");
    expect(offeringState(trip("Pacific/Kiritimati"), now).phase).toBe("running");
    expect(offeringState(trip("Pacific/Pago_Pago"), now).phase).toBe("ended");
    // 09:30Z: still June 27 in Kiritimati, the trip starts tomorrow there,
    // although in UTC it is "today".
    expect(offeringState(trip("Pacific/Kiritimati"), new Date("2026-06-27T09:30:00Z")).phase).toBe("upcoming");
    expect(offeringState(trip("UTC"), new Date("2026-06-27T09:30:00Z")).phase).toBe("running");
  });

  it("is correct across a DST change (London, last Sunday of October)", () => {
    // 2026-10-25 01:00Z: clocks go back. A one-day event on the 25th local.
    const event = offering({ kind: "event", start_at: "2026-10-24T23:30:00.000Z", end_at: null, timezone: "Europe/London" });
    // 23:30Z on the 24th is 00:30 BST on the 25th.
    expect(offeringState(event, new Date("2026-10-24T22:30:00Z")).phase).toBe("upcoming");
    // In UTC the event is on the 24th, so a UTC clock would call it ended all
    // of the 25th; in London it is on the 25th until midnight GMT.
    expect(offeringState(event, new Date("2026-10-25T12:00:00Z")).phase).toBe("running");
    expect(offeringState(event, new Date("2026-10-25T23:30:00Z")).phase).toBe("running");
    expect(offeringState(event, new Date("2026-10-26T00:30:00Z")).phase).toBe("ended");
  });

  it("sold out, cancelled, bookings closed and unlimited", () => {
    const now = new Date("2026-06-10T12:00:00Z");
    expect(offeringState(offering({ spots_left: 0 }), now)).toMatchObject({ soldOut: true, bookable: false, badge: "Sold out" });
    expect(offeringState(offering({ status: "cancelled" }), now)).toMatchObject({ cancelled: true, bookable: false, badge: "Cancelled" });
    expect(offeringState(offering({ bookings_closed: true }), now)).toMatchObject({ bookingsClosed: true, bookable: false, badge: "Bookings closed" });
    expect(offeringState(offering({ capacity: null, spots_left: null }), now)).toMatchObject({ soldOut: false, bookable: true });
    expect(offeringState(offering({ status: "ended" }), now)).toMatchObject({ phase: "ended", bookable: false });
  });

  it("fails closed for a trip without dates, but not for an ongoing experience", () => {
    const now = new Date("2026-06-10T12:00:00Z");
    expect(offeringState(offering({ start_at: null, end_at: null }), now)).toMatchObject({ phase: "ended", bookable: false });
    expect(offeringState(offering({ kind: "experience", start_at: null, end_at: null, public_url: "https://host.usemingla.com/exp/b/x" }), now))
      .toMatchObject({ phase: "upcoming", bookable: true });
  });
});

describe("#2829 offering words", () => {
  it("writes date ranges the way Young & Stamped does (same month, cross month, cross year)", () => {
    const tz = "UTC";
    expect(formatOfferingDates({ start_at: "2026-06-20T00:00:00Z", end_at: "2026-06-27T00:00:00Z", timezone: tz })).toBe("June 20–27, 2026");
    expect(formatOfferingDates({ start_at: "2026-06-28T00:00:00Z", end_at: "2026-07-02T00:00:00Z", timezone: tz })).toBe("June 28 – July 2, 2026");
    expect(formatOfferingDates({ start_at: "2026-12-28T00:00:00Z", end_at: "2027-01-03T00:00:00Z", timezone: tz })).toBe("December 28, 2026 – January 3, 2027");
    expect(formatOfferingDates({ start_at: "2026-06-20T00:00:00Z", end_at: null, timezone: tz })).toBe("June 20, 2026");
    expect(formatOfferingDates({ start_at: null, end_at: null, timezone: tz })).toBe("");
    // The local date, not the UTC one: 23:00Z on the 19th is the 20th in Bali.
    expect(formatOfferingDates({ start_at: "2026-06-19T23:00:00Z", end_at: "2026-06-26T23:00:00Z", timezone: "Asia/Makassar" })).toBe("June 20–27, 2026");
  });

  it("formats price in the offering's currency; missing is 'Price on request'", () => {
    expect(formatOfferingPrice(base)).toBe("From $2,499");
    expect(formatOfferingPrice(offering({ min_price_minor: 12550, currency: "GBP" }))).toBe("From £125.50");
    expect(formatOfferingPrice(offering({ min_price_minor: 850000, currency: "NGN" }))).toMatch(/^From (NGN|₦)\s?8,500$/);
    expect(formatOfferingPrice(offering({ min_price_minor: null }))).toBe("Price on request");
    expect(formatOfferingPrice(offering({ min_price_minor: 1000, currency: null }))).toBe("Price on request");
    expect(formatOfferingPrice(offering({ min_price_minor: null, has_free_tier: true }))).toBe("Free");
  });
});

describe("#2829 grid selection", () => {
  const now = new Date("2026-06-10T12:00:00Z");
  const upcomingLate = offering({ id: uid(), slug: "late", title: "Late", start_at: "2026-09-01T00:00:00Z", end_at: "2026-09-05T00:00:00Z" });
  const upcomingSoon = offering({ id: uid(), slug: "soon", title: "Soon", destination_text: "Tirana, Albania", start_at: "2026-07-01T00:00:00Z", end_at: "2026-07-05T00:00:00Z" });
  const endedOld = offering({ id: uid(), slug: "old", title: "Old", start_at: "2025-01-01T00:00:00Z", end_at: "2025-01-05T00:00:00Z" });
  const endedRecent = offering({ id: uid(), slug: "recent", title: "Recent", start_at: "2026-03-01T00:00:00Z", end_at: "2026-03-05T00:00:00Z" });
  const cancelled = offering({ id: uid(), slug: "cx", title: "Cancelled", status: "cancelled" });
  const event = offering({ id: uid(), kind: "event", slug: "ev", title: "Event", public_url: "https://host.usemingla.com/e/b/ev", start_at: "2026-06-15T18:00:00Z", end_at: null });
  const all = [upcomingLate, endedOld, cancelled, upcomingSoon, endedRecent, event];
  const titles = (r: ReturnType<typeof selectGridOfferings>) => (r.kind === "ok" ? r.offerings.map((e) => e.offering.title) : r.kind);

  it("upcoming soonest first, past newest first; cancelled leaves lists", () => {
    expect(titles(selectGridOfferings(all, { kind: "trip", mode: "upcoming" }, now))).toEqual(["Soon", "Late"]);
    expect(titles(selectGridOfferings(all, { kind: "trip", mode: "past" }, now))).toEqual(["Recent", "Old"]);
    expect(titles(selectGridOfferings(all, { kind: "all", mode: "all" }, now))).toEqual(["Event", "Soon", "Late", "Recent", "Old"]);
  });

  it("picked offerings keep the owner's order, whatever their state", () => {
    expect(titles(selectGridOfferings(all, { mode: "all", offering_ids: [{ id: cancelled.id }, { id: endedOld.id }] }, now))).toEqual(["Cancelled", "Old"]);
  });

  it("filters on the server: place, overlapping dates, inverted range, no match", () => {
    expect(titles(selectGridOfferings(all, { kind: "trip", mode: "upcoming" }, now, { where: "albania", from: null, to: null }))).toEqual(["Soon"]);
    expect(titles(selectGridOfferings(all, { kind: "trip", mode: "upcoming" }, now, { where: null, from: "2026-07-04", to: "2026-07-20" }))).toEqual(["Soon"]);
    expect(titles(selectGridOfferings(all, { kind: "trip", mode: "upcoming" }, now, { where: null, from: "2026-08-01", to: "2026-07-01" }))).toBe("check_dates");
    expect(titles(selectGridOfferings(all, { kind: "trip", mode: "upcoming" }, now, { where: "mars", from: null, to: null }))).toBe("no_match");
    expect(titles(selectGridOfferings([], { kind: "trip", mode: "upcoming" }, now))).toBe("empty");
  });
});

describe("#2829 feed and snapshot contracts", () => {
  it("drops untrustworthy rows from a live feed, keeps the rest", () => {
    const feed = parseOfferingsFeed({
      generated_at: "2026-06-10T00:00:00.000Z",
      brand: { slug: "youngandstamped", currency: "USD", payment_rails: "stripe" },
      offerings: [
        { ...base, extra_new_core_key: 1 },
        { ...base, id: uid(), public_url: "https://evil.example.com/t/x/y" },
        { ...base, id: uid(), cover: { path: "event_covers/../secrets", type: "image" } },
        { ...base, id: uid(), kind: "trip", public_url: "https://host.usemingla.com/e/wrong/kind" },
        { ...base, id: uid(), summary: "metadata: <script>x</script>" },
      ],
    });
    expect(feed.offerings).toHaveLength(2);
    expect(feed.offerings[1]!.summary).toBeNull();
    expect(() => parseOfferingsFeed({ offerings: "nope" })).toThrow("OFFERINGS_FEED_INVALID");
  });

  it("the artifact snapshot is strict and capped at 200", () => {
    expect(() => assertOfferingsSnapshot([base])).not.toThrow();
    expect(() => assertOfferingsSnapshot([{ ...base, extra: 1 }])).toThrow("ARTIFACT_OFFERINGS_MISMATCH");
    expect(() => assertOfferingsSnapshot([base, base])).toThrow("ARTIFACT_OFFERINGS_MISMATCH");
    expect(() => assertOfferingsSnapshot(Array.from({ length: 201 }, () => offering({ id: uid() })))).toThrow("ARTIFACT_OFFERINGS_MISMATCH");
    expect(normalizeSiteOffering({ ...base, has_free_tier: undefined })?.has_free_tier).toBe(false);
  });

  it("an offering grid is either live or an original v1 grid, never both or neither", () => {
    const ctx = { mediaUrls: new Set<string>(), assertMedia: () => undefined };
    expect(() => assertSiteBlock({ type: "offering_grid", variant: "atelier", heading: "Trips", kind: "trip", mode: "upcoming", show_filters: true }, ctx)).not.toThrow();
    expect(() => assertSiteBlock({ type: "offering_grid", variant: "atelier", offerings: [{ id: base.id, label: "Bali", url: base.public_url }] }, ctx)).not.toThrow();
    expect(() => assertSiteBlock({ type: "offering_grid", variant: "atelier", heading: "Trips" }, ctx)).toThrow("offering_grid.source");
    expect(() => assertSiteBlock({ type: "offering_grid", variant: "atelier", mode: "past", offerings: [{ id: base.id, label: "Bali", url: base.public_url }] }, ctx)).toThrow("offering_grid.source");
    expect(() => assertSiteBlock({ type: "offering_grid", variant: "atelier", mode: "soon" }, ctx)).toThrow("offering_grid.mode");
  });
});
