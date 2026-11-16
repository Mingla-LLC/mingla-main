/*
 * #4453 Part 1 tester angle: boundary and malformed zones, per-zone keep-or-blank
 * through the feed, and the strict venue-hours path. Different angle from the
 * implementor's happy-path test (which covers SC-1.1 to SC-1.3 headline cases).
 */
import { describe, expect, it } from "vitest";
import { isIanaTimeZone, isRegionCityTimeZone } from "./generated/safety.ts";
import { parseOfferingsFeed } from "./generated/offerings.ts";
import { assertSiteBlock } from "./generated/blocks.ts";

const ACCEPT_WIDE = ["UTC", "GMT", "Etc/UTC", "Etc/GMT", "Etc/GMT+5", "America/New_York", "America/Argentina/Buenos_Aires"];
const REJECT_WIDE: unknown[] = ["utc", "gmt", "EST", "Japan", "", null, undefined, 5, {}, "x".repeat(61), "Mars/Olympus", "../etc/passwd", "UTC ", " UTC", "UTC\n", "UTC/", "/UTC", "Etc/UTC/", "GMT+1", "+01:00", "WAT", "a/b/c/d"];

const row = (tz: unknown) => ({
  id: "11111111-1111-4111-8111-111111111111", kind: "trip", slug: "t", title: "T", summary: null, cover: null,
  destination_text: null, start_at: "2027-01-10T08:00:00.000Z", end_at: "2027-01-17T08:00:00.000Z", timezone: tz,
  status: "scheduled", bookings_closed: false, capacity: null, spots_left: null, group_minimum: null,
  min_price_minor: null, currency: null, has_free_tier: false,
  public_url: "https://host.usemingla.com/t/b/t", waitlist_enabled: false, installments_available: false,
});
const feed = (tz: unknown) => parseOfferingsFeed({ generated_at: "2026-11-16T00:00:00.000Z", brand: { slug: "b", currency: "USD", payment_rails: "stripe" }, offerings: [row(tz)] });

describe("#4453 tester: zone boundaries", () => {
  it.each(ACCEPT_WIDE)("isIanaTimeZone accepts %s", (z) => expect(isIanaTimeZone(z)).toBe(true));
  it.each(REJECT_WIDE)("isIanaTimeZone rejects %j", (z) => expect(isIanaTimeZone(z)).toBe(false));
  it("isRegionCityTimeZone rejects bare UTC/GMT and accepts cities", () => {
    for (const z of ["UTC", "GMT", "utc", "", null, "UTC "]) expect(isRegionCityTimeZone(z)).toBe(false);
    for (const z of ["Africa/Lagos", "Etc/UTC", "America/Argentina/Buenos_Aires"]) expect(isRegionCityTimeZone(z)).toBe(true);
  });
  it.each(["UTC", "GMT", "Etc/UTC", "Africa/Lagos"])("feed keeps %s timezone", (z) => {
    const o = feed(z).offerings;
    expect(o).toHaveLength(1);
    expect(o[0].timezone).toBe(z);
  });
  it.each(["EST", "Japan", "utc", "Mars/Olympus", "../etc/passwd", "UTC ", "", "x".repeat(61)])("feed keeps offering but blanks bad zone %j", (z) => {
    const o = feed(z).offerings;
    expect(o).toHaveLength(1);
    expect(o[0].timezone).toBeNull();
  });
  it("feed keeps null zone", () => expect(feed(null).offerings[0].timezone).toBeNull());
  it("feed keeps a non-string zone offering with zone blanked", () => {
    const o = feed(42).offerings;
    expect(o).toHaveLength(1);
    expect(o[0].timezone).toBeNull();
  });
});

describe("#4453 tester: venue hours stays strict", () => {
  const hours = (tz: unknown) => ({ type: "hours_location", variant: "default", heading: "Hours", address: "1 St", hours: [{ day: "Mon", value: "9-5" }], timezone: tz });
  it("refuses UTC and GMT, accepts a city", () => {
    expect(() => assertSiteBlock(hours("UTC") as never, "about" as never)).toThrow("hours_location.timezone");
    expect(() => assertSiteBlock(hours("GMT") as never, "about" as never)).toThrow("hours_location.timezone");
    expect(() => assertSiteBlock(hours("Africa/Lagos") as never, "about" as never)).not.toThrow();
  });
});
