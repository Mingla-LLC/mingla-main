/**
 * issue #3645 bundle 2C — the client's sold-price lock mirrors the server's:
 * a paid experience whose first option is free (Kids 0 beside Adult) was sold
 * at its whole price, so an edit that keeps that price passes; a real price
 * change is still refused (price_change_with_sales).
 */
import { describe, expect, test } from "@jest/globals";

import type { ExperienceDetail } from "../../services/experienceDetailService";
import {
  type LiveExperiencePatch,
  validateLiveExperienceFieldUpdate,
} from "../publishedExperienceEditGuards";

const REASON = "Updating the walk description for guests";

const ticket = (id: string, name: string, priceCents: number) => ({
  id,
  name,
  priceCents,
  currency: "NGN",
  quantityTotal: 20,
  isUnlimited: false,
  isFree: priceCents === 0,
});

const experience = (patch: Partial<ExperienceDetail> = {}): ExperienceDetail => ({
  id: "exp-1",
  brandId: "brand-1",
  brandSlug: "coastline",
  title: "Lagos walk",
  slug: "lagos-walk",
  description: "Two good places.",
  status: "live",
  visibility: "public",
  currency: "NGN",
  timezone: "Africa/Lagos",
  coverMediaUrl: null,
  coverMediaType: null,
  locationMode: "single",
  pricingMode: "whole",
  wholePriceCents: 500_000,
  isRecurring: false,
  isMultiDate: false,
  recurrenceRule: null,
  whenMode: "single",
  whenDraft: null,
  venueText: null,
  experienceIntents: ["group-fun"],
  experienceIntent: null,
  stops: [],
  // The first option is free; the experience is paid (bundle 2C reads it so).
  ticket: ticket("t-kids", "Kids", 0),
  tickets: [ticket("t-kids", "Kids", 0), ticket("t-adult", "Adult", 500_000)],
  isFree: false,
  dates: [
    {
      id: "date-1",
      startAt: "2026-12-10T17:00:00.000Z",
      endAt: "2026-12-10T19:00:00.000Z",
      timezone: "Africa/Lagos",
      isMaster: true,
    },
  ],
  ...patch,
});

// What the wizard sends when only the description changed.
const unchanged = (over: Partial<LiveExperiencePatch> = {}): LiveExperiencePatch => ({
  is_free: false,
  pricing_mode: "whole",
  whole_price_cents: 500_000,
  dates: [{ startAt: "2026-12-10T17:00:00.000Z", endAt: "2026-12-10T19:00:00.000Z" }],
  ...over,
});

describe("issue #3645 2C — sold-price lock with a free first option", () => {
  test("an edit that keeps the price passes once sold", () => {
    expect(validateLiveExperienceFieldUpdate(experience(), unchanged(), 3, REASON).ok).toBe(true);
  });

  test("a real price change is still refused once sold", () => {
    const r = validateLiveExperienceFieldUpdate(
      experience(),
      unchanged({ whole_price_cents: 600_000 }),
      3,
      REASON,
    );
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("unreachable");
    expect(r.reason).toBe("price_change_with_sales");
  });

  test("an explicitly free experience is still price 0 once sold", () => {
    const free = experience({
      isFree: true,
      wholePriceCents: 0,
      ticket: ticket("t1", "Standard", 0),
      tickets: [ticket("t1", "Standard", 0)],
    });
    expect(
      validateLiveExperienceFieldUpdate(free, unchanged({ is_free: true, whole_price_cents: 0 }), 3, REASON).ok,
    ).toBe(true);
    const r = validateLiveExperienceFieldUpdate(free, unchanged(), 3, REASON);
    expect(r.ok).toBe(false);
  });

  test("a first ticket re-priced away from the whole price still locks its own price", () => {
    // Ari's tier tool can price the ticket directly; buyers paid the ticket.
    const repriced = experience({
      ticket: ticket("t1", "Standard", 450_000),
      tickets: [ticket("t1", "Standard", 450_000)],
    });
    const r = validateLiveExperienceFieldUpdate(repriced, unchanged(), 3, REASON);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("unreachable");
    expect(r.reason).toBe("price_change_with_sales");
  });

  test("a ticket re-priced to 0 keeps its lock at 0 (no stale whole price)", () => {
    // Ari re-priced the only ticket to 0 before bookings; the whole price is stale.
    const zeroed = experience({
      isFree: false,
      ticket: ticket("t1", "Standard", 0),
      tickets: [ticket("t1", "Standard", 0)],
    });
    const r = validateLiveExperienceFieldUpdate(zeroed, unchanged(), 3, REASON);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("unreachable");
    expect(r.reason).toBe("price_change_with_sales");
  });
});
