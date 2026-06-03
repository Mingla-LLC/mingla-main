/**
 * META-ORCH-1059 Sub-E [experiences-business-parity] — edit-after-publish guard
 * regression test per ORCH-0840 [Regression-test enforcement + append-only CI].
 *
 * Tests the client-side UX fast-path mirror of `biz_update_live_experience`
 * RPC's buyer-protection refund-gate (`src/utils/publishedExperienceEditGuards.ts`).
 *
 * Server is canonical; this guard pre-flights destructive intent to avoid the
 * RPC round-trip when the patch is provably bad. Every server-side rejection
 * reason MUST be mirrored here. Mirror of `publishedTripEditGuards.test.ts`.
 */

import { describe, expect, test } from "@jest/globals";

import type { ExperienceDetail } from "../../services/experienceDetailService";
import {
  validateLiveExperienceFieldUpdate,
  liveExperienceRejectCopy,
  type LiveExperiencePatch,
} from "../publishedExperienceEditGuards";

const experience = (patch: Partial<ExperienceDetail> = {}): ExperienceDetail => ({
  id: "exp-1",
  brandId: "brand-1",
  brandSlug: "tulum-nights",
  title: "Friday Night Jazz Crawl",
  slug: "friday-night-jazz-crawl",
  description: "A multi-stop jazz crawl.",
  status: "live",
  visibility: "public",
  currency: "USD",
  timezone: "America/New_York",
  coverMediaUrl: null,
  coverMediaType: null,
  locationMode: "per_stop",
  pricingMode: "whole",
  wholePriceCents: 6000,
  isRecurring: false,
  isMultiDate: false,
  recurrenceRule: null,
  whenMode: "single",
  whenDraft: null,
  venueText: "Blue Note, NYC",
  experienceIntents: ["group-fun"],
  experienceIntent: null,
  stops: [
    {
      id: "stop-1",
      stopOrder: 0,
      placeId: "place-1",
      placeName: "Blue Note",
      address: "131 W 3rd St, New York, NY",
      city: "New York",
      region: "NY",
      countryCode: "US",
      lat: 40.7308,
      lng: -74.0007,
      imageUrls: [],
      startTime: "19:00",
      priceCents: 3000,
      description: "Opening set.",
    },
    {
      id: "stop-2",
      stopOrder: 1,
      placeId: "place-2",
      placeName: "Smalls",
      address: "183 W 10th St, New York, NY",
      city: "New York",
      region: "NY",
      countryCode: "US",
      lat: 40.7338,
      lng: -74.0027,
      imageUrls: [],
      startTime: "21:00",
      priceCents: 3000,
      description: "Late set.",
    },
  ],
  ticket: {
    id: "ticket-1",
    name: "Standard",
    priceCents: 6000,
    currency: "USD",
    quantityTotal: 20,
    isUnlimited: false,
    isFree: false,
  },
  dates: [
    {
      id: "date-1",
      startAt: "2026-07-10T23:00:00.000Z",
      endAt: "2026-07-11T03:00:00.000Z",
      timezone: "America/New_York",
      isMaster: true,
    },
  ],
  ...patch,
});

// The "no-op / benign" patch: same price (whole 6000), same dates, same stops.
const benignPatch = (over: Partial<LiveExperiencePatch> = {}): LiveExperiencePatch => ({
  capacity: 20,
  is_free: false,
  pricing_mode: "whole",
  whole_price_cents: 6000,
  stops: [
    { placeName: "Blue Note", priceCents: 0 },
    { placeName: "Smalls", priceCents: 0 },
  ],
  dates: [{ startAt: "2026-07-10T23:00:00.000Z", endAt: "2026-07-11T03:00:00.000Z" }],
  ...over,
});

describe("META-ORCH-1059 Sub-E — published experience edit guards (client fast-path)", () => {
  test("rejects missing reason with reason='missing_edit_reason'", () => {
    const r = validateLiveExperienceFieldUpdate(experience(), benignPatch(), 0, "");
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("unreachable");
    expect(r.reason).toBe("missing_edit_reason");
  });

  test("rejects reason shorter than 10 chars with reason='invalid_edit_reason'", () => {
    const r = validateLiveExperienceFieldUpdate(experience(), benignPatch(), 0, "too short");
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("unreachable");
    expect(r.reason).toBe("invalid_edit_reason");
  });

  test("rejects reason longer than 200 chars with reason='invalid_edit_reason'", () => {
    const r = validateLiveExperienceFieldUpdate(experience(), benignPatch(), 0, "x".repeat(201));
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("unreachable");
    expect(r.reason).toBe("invalid_edit_reason");
  });

  test("rejects when status is not scheduled/live (a DRAFT never trips these guards)", () => {
    const r = validateLiveExperienceFieldUpdate(
      experience({ status: "draft" }),
      benignPatch(),
      0,
      "Fixing the meeting point address",
    );
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("unreachable");
    expect(r.reason).toBe("experience_not_editable_status");
  });

  test("rejects capacity below confirmed sold count with affectedOrderCount", () => {
    const r = validateLiveExperienceFieldUpdate(
      experience(),
      benignPatch({ capacity: 5 }),
      7,
      "Reducing capacity to free up space",
    );
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("unreachable");
    expect(r.reason).toBe("capacity_below_sold");
    expect(r.affectedOrderCount).toBe(7);
  });

  test("rejects whole-price change when at least one confirmed order exists", () => {
    const r = validateLiveExperienceFieldUpdate(
      experience(),
      benignPatch({ whole_price_cents: 8000 }),
      3,
      "Bumping the price for the next wave",
    );
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("unreachable");
    expect(r.reason).toBe("price_change_with_sales");
    expect(r.affectedOrderCount).toBe(3);
  });

  test("rejects per-stop price sum change when sold > 0", () => {
    const r = validateLiveExperienceFieldUpdate(
      experience({ pricingMode: "per_stop" }),
      benignPatch({
        pricing_mode: "per_stop",
        stops: [
          { placeName: "Blue Note", priceCents: 4000 }, // was 3000
          { placeName: "Smalls", priceCents: 3000 },
        ],
      }),
      2,
      "Raising the first stop cover charge",
    );
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("unreachable");
    expect(r.reason).toBe("price_change_with_sales");
  });

  test("rejects making a sold paid experience free (price change)", () => {
    const r = validateLiveExperienceFieldUpdate(
      experience(),
      benignPatch({ is_free: true, whole_price_cents: 0 }),
      1,
      "Making it free for the holiday weekend",
    );
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("unreachable");
    expect(r.reason).toBe("price_change_with_sales");
  });

  test("rejects date shift when at least one confirmed order exists", () => {
    const r = validateLiveExperienceFieldUpdate(
      experience(),
      benignPatch({
        dates: [{ startAt: "2026-08-10T23:00:00.000Z", endAt: "2026-08-11T03:00:00.000Z" }],
      }),
      4,
      "Pushing the crawl out by a month",
    );
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("unreachable");
    expect(r.reason).toBe("dates_shifted_with_sales");
    expect(r.affectedOrderCount).toBe(4);
  });

  test("rejects removing an occurrence when sold > 0", () => {
    const r = validateLiveExperienceFieldUpdate(
      experience({
        dates: [
          {
            id: "d1",
            startAt: "2026-07-10T23:00:00.000Z",
            endAt: "2026-07-11T03:00:00.000Z",
            timezone: "America/New_York",
            isMaster: true,
          },
          {
            id: "d2",
            startAt: "2026-07-17T23:00:00.000Z",
            endAt: "2026-07-18T03:00:00.000Z",
            timezone: "America/New_York",
            isMaster: false,
          },
        ],
        isMultiDate: true,
        whenMode: "multi_date",
      }),
      benignPatch({
        dates: [{ startAt: "2026-07-10T23:00:00.000Z", endAt: "2026-07-11T03:00:00.000Z" }],
      }),
      2,
      "Dropping the second Friday date",
    );
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("unreachable");
    expect(r.reason).toBe("dates_shifted_with_sales");
  });

  test("rejects removing a stop when sold > 0", () => {
    const r = validateLiveExperienceFieldUpdate(
      experience(),
      benignPatch({
        stops: [{ placeName: "Blue Note", priceCents: 0 }], // "Smalls" removed
      }),
      2,
      "Removing the late-night Smalls stop",
    );
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("unreachable");
    expect(r.reason).toBe("stop_removed_with_sales");
    expect(r.droppedStops).toEqual(["Smalls"]);
  });

  test("accepts a benign no-op patch (same price/dates/stops) with valid reason and sold > 0", () => {
    const r = validateLiveExperienceFieldUpdate(
      experience(),
      benignPatch(),
      5,
      "Fixing a typo in the description",
    );
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("unreachable");
    expect(r.trimmedReason).toBe("Fixing a typo in the description");
  });

  test("accepts ADDING a stop even when sold > 0 (additive, not destructive)", () => {
    const r = validateLiveExperienceFieldUpdate(
      experience(),
      benignPatch({
        stops: [
          { placeName: "Blue Note", priceCents: 0 },
          { placeName: "Smalls", priceCents: 0 },
          { placeName: "Village Vanguard", priceCents: 0 }, // new — whole price unchanged
        ],
      }),
      3,
      "Adding a third stop to the crawl",
    );
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("unreachable");
    expect(r.trimmedReason).toBe("Adding a third stop to the crawl");
  });

  test("accepts capacity increase even when sold > 0", () => {
    const r = validateLiveExperienceFieldUpdate(
      experience(),
      benignPatch({ capacity: 40 }),
      12,
      "Opening up more spots after demand spike",
    );
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("unreachable");
    expect(r.trimmedReason).toBe("Opening up more spots after demand spike");
  });

  test("accepts any change (price/dates/stops) when ZERO orders exist", () => {
    const r = validateLiveExperienceFieldUpdate(
      experience(),
      benignPatch({
        whole_price_cents: 9000,
        dates: [{ startAt: "2026-09-10T23:00:00.000Z", endAt: "2026-09-11T03:00:00.000Z" }],
        stops: [{ placeName: "Blue Note", priceCents: 0 }],
      }),
      0,
      "Reworking the whole experience before any sale",
    );
    expect(r.ok).toBe(true);
  });

  test("trims surrounding whitespace from the reason on accept", () => {
    const r = validateLiveExperienceFieldUpdate(
      experience(),
      benignPatch(),
      0,
      "   Updating the experience cover image   ",
    );
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("unreachable");
    expect(r.trimmedReason).toBe("Updating the experience cover image");
  });

  test("reject copy is human + names the affected buyer count", () => {
    expect(liveExperienceRejectCopy("price_change_with_sales", 3)).toContain("3 buyers");
    expect(liveExperienceRejectCopy("capacity_below_sold", 1)).toContain("1 buyer");
    expect(liveExperienceRejectCopy("stop_removed_with_sales", 2)).toContain("itinerary");
    expect(liveExperienceRejectCopy("dates_shifted_with_sales", 4)).toContain("refund");
  });
});
