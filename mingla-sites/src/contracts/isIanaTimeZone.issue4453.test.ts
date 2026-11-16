/*
 * #4453 Part 1 — a trip stored in UTC must reach the site.
 *
 * INVARIANT I-SITES-TZ-ONE-SOURCE: isIanaTimeZone exists only in packages/site-contracts/src/safety.ts; consumers import the generated copy (#4453).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { isIanaTimeZone, isRegionCityTimeZone } from "./generated/safety.ts";
import { assertSiteBlock } from "./generated/blocks.ts";
import { parseOfferingsFeed } from "./generated/offerings.ts";

const TRIP = {
  id: "11111111-1111-4111-8111-111111111111",
  kind: "trip",
  slug: "y-s-france-ski-week",
  title: "Y&S France Ski Week '27",
  summary: null,
  cover: null,
  destination_text: "Val d'Isere",
  start_at: "2027-01-10T08:00:00.000Z",
  end_at: "2027-01-17T08:00:00.000Z",
  timezone: "UTC",
  status: "scheduled",
  bookings_closed: false,
  capacity: null,
  spots_left: null,
  group_minimum: null,
  min_price_minor: null,
  currency: null,
  has_free_tier: false,
  public_url: "https://host.usemingla.com/t/youngandstamped/y-s-france-ski-week",
  waitlist_enabled: false,
  installments_available: false,
};

const feed = (rows: unknown[]) =>
  parseOfferingsFeed({
    generated_at: "2026-11-16T00:00:00.000Z",
    brand: { slug: "youngandstamped", currency: "USD", payment_rails: "stripe" },
    offerings: rows,
  });

describe("#4453 isIanaTimeZone (SC-1.1)", () => {
  it.each(["UTC", "Etc/UTC", "GMT", "Etc/GMT", "Europe/Paris", "America/Argentina/Buenos_Aires"])("accepts %s", (zone) => {
    expect(isIanaTimeZone(zone)).toBe(true);
  });
  it.each(["utc", "EST", "Japan", "+01:00", "GMT+1", "WAT", "Mars/Olympus_Mons", "", "x".repeat(61), null, 5, undefined])(
    "refuses %j",
    (zone) => {
      expect(isIanaTimeZone(zone)).toBe(false);
    },
  );
});

describe("#4453 venue clocks stay strict (SC-1.2, SC-1.4)", () => {
  it("isRegionCityTimeZone refuses bare UTC and accepts a city", () => {
    expect(isRegionCityTimeZone("UTC")).toBe(false);
    expect(isRegionCityTimeZone("GMT")).toBe(false);
    expect(isRegionCityTimeZone("Africa/Lagos")).toBe(true);
  });
  const hours = (timezone: string) => ({
    type: "hours_location",
    variant: "default",
    heading: "Find us",
    address: "1 High Street",
    hours: [{ day: "Mon", value: "9-5" }],
    timezone,
  });
  it("hours_location refuses UTC and takes a city", () => {
    expect(() => assertSiteBlock(hours("UTC") as never, "about" as never)).toThrow();
    expect(() => assertSiteBlock(hours("Africa/Lagos") as never, "about" as never)).not.toThrow();
  });
});

describe("#4453 an offering is never dropped for its timezone (SC-1.3)", () => {
  it("keeps a UTC row with the zone preserved", () => {
    const out = feed([TRIP]).offerings;
    expect(out).toHaveLength(1);
    expect(out[0]!.timezone).toBe("UTC");
  });
  it("keeps a row with a legacy alias, blanking only the timezone", () => {
    const out = feed([{ ...TRIP, timezone: "EST" }]).offerings;
    expect(out).toHaveLength(1);
    expect(out[0]!.timezone).toBeNull();
    expect(out[0]!.title).toBe(TRIP.title);
  });
});

describe("#4453 one source (I-SITES-TZ-ONE-SOURCE)", () => {
  const SHAPE = "A-Za-z0-9_+-]*(?:";
  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (name === "node_modules" || name === "generated" || name === ".next") continue;
      if (statSync(full).isDirectory()) walk(full, out);
      else if (/\.(ts|tsx)$/.test(name) && !name.includes(".issue4453.")) out.push(full);
    }
    return out;
  }
  it("no second copy of the function or the shape regex in mingla-sites or mingla-site-cms", () => {
    const root = resolve(__dirname, "../../..");
    for (const dir of ["mingla-sites/src", "mingla-site-cms/src"]) {
      for (const file of walk(join(root, dir))) {
        const text = readFileSync(file, "utf8");
        expect(text, file).not.toMatch(/function isIanaTimeZone/);
        expect(text.includes(SHAPE), file).toBe(false);
      }
    }
  });
});
