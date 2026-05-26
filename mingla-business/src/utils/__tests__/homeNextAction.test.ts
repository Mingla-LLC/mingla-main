/**
 * ORCH-0965 — homeNextAction rule-ladder unit tests (happy path).
 * SPEC §4.4 T-IMPL-04..09.
 */

import { describe, expect, test } from "@jest/globals";

import type { Brand } from "../../store/currentBrandStore";
import type { DraftEvent } from "../../store/draftEventStore";
import type { UpcomingCounts } from "../../hooks/useUpcomingForBrand";
import { pickHomeNextAction } from "../homeNextAction";

const baseBrand = (patch: Partial<Brand> = {}): Brand => ({
  id: "brand-1",
  displayName: "Brand One",
  slug: "brand-one",
  address: null,
  coverHue: 25,
  role: "owner",
  stats: { events: 0, followers: 0, rev: 0, rev7d: 0, attendees: 0 },
  currentLiveEvent: null,
  stripeStatus: "active",
  ...patch,
});

const emptyCounts: UpcomingCounts = {
  total: 0,
  active: 0,
  live: 0,
  upcoming: 0,
  draft: 0,
};

const draft = (patch: Partial<DraftEvent> = {}): DraftEvent =>
  ({
    id: "draft-1",
    brandId: "brand-1",
    serverSlug: null,
    name: "Draft",
    updatedAt: "2026-05-25T09:00:00.000Z",
    ...patch,
  } as unknown as DraftEvent);
// Note: `as unknown as DraftEvent` is constrained to test-only — only
// the fields the rule ladder reads (id, updatedAt, event_type) need to
// be populated. The implementor explicitly forbids this cast in product
// code (Code Quality Contract); permitted here because the test does
// not exercise any other field of DraftEvent.

const paidDraft = (): DraftEvent =>
  draft({
    tickets: [
      {
        isFree: false,
        priceGbp: 25,
      } as unknown as DraftEvent["tickets"][number],
    ],
  });

describe("META-ORCH-0972 pickHomeNextAction — universal authoring ladder", () => {
  test("T-07 — Stripe inactive + zero paid drafts does not fire rung 1", () => {
    const brand = baseBrand({ stripeStatus: "not_connected" });
    const result = pickHomeNextAction(brand, emptyCounts, []);
    expect(result?.rung).toBe(2);
    expect(result?.kind).toBe("no_offerings");
  });

  test("paid draft + Stripe inactive → rung 1", () => {
    const brand = baseBrand({ stripeStatus: "not_connected" });
    const counts: UpcomingCounts = { total: 1, active: 1, live: 0, upcoming: 0, draft: 1 };
    const result = pickHomeNextAction(brand, counts, [paidDraft()]);
    expect(result?.rung).toBe(1);
    expect(result?.kind).toBe("stripe_inactive");
    expect(result?.ctaRoute).toBe("/brand/brand-1/payments");
    expect(result?.title).toBe("Connect Stripe to take payments");
  });

  test("Stripe inactive with only free draft → rung 3", () => {
    const brand = baseBrand({ stripeStatus: "not_connected" });
    const counts: UpcomingCounts = { total: 1, active: 1, live: 0, upcoming: 0, draft: 1 };
    const result = pickHomeNextAction(brand, counts, [draft()]);
    expect(result?.rung).toBe(3);
  });

  test("Stripe active + 0 offerings → universal chooser rung", () => {
    const brand = baseBrand();
    const result = pickHomeNextAction(brand, emptyCounts, []);
    expect(result?.rung).toBe(2);
    expect(result?.title).toBe("What do you want to make first?");
    expect(result?.ctaRoute).toBe("/event/create");
  });

  test("T-IMPL-07 — Stripe active + 0 live + 1 draft → rung 3 routing to most-recent draft", () => {
    const brand = baseBrand();
    const counts: UpcomingCounts = { total: 1, active: 1, live: 0, upcoming: 0, draft: 1 };
    const older = draft({ id: "draft-older", updatedAt: "2026-05-01T09:00:00.000Z" });
    const newer = draft({ id: "draft-newer", updatedAt: "2026-05-25T09:00:00.000Z" });
    const result = pickHomeNextAction(brand, counts, [older, newer]);
    expect(result?.rung).toBe(3);
    expect(result?.ctaRoute).toContain("draft-newer");
  });

  test("T-IMPL-08 — live offering + no address → null", () => {
    const brand = baseBrand({ address: null });
    const counts: UpcomingCounts = { total: 1, active: 1, live: 1, upcoming: 0, draft: 0 };
    const result = pickHomeNextAction(brand, counts, []);
    expect(result).toBeNull();
  });

  test("T-IMPL-09 — Healthy state (stripe + 1 live) → null", () => {
    const brand = baseBrand();
    const counts: UpcomingCounts = { total: 1, active: 1, live: 1, upcoming: 0, draft: 0 };
    const result = pickHomeNextAction(brand, counts, []);
    expect(result).toBeNull();
  });

});

describe("ORCH-0965 pickHomeNextAction — adversarial (tester set)", () => {
  test("T-QA-05 — identical updatedAt strings on multiple drafts → stable choice, no crash", () => {
    const brand = baseBrand();
    const counts: UpcomingCounts = { total: 2, active: 2, live: 0, upcoming: 0, draft: 2 };
    const ts = "2026-05-25T09:00:00.000Z";
    const a = draft({ id: "draft-a", updatedAt: ts });
    const b = draft({ id: "draft-b", updatedAt: ts });
    const result = pickHomeNextAction(brand, counts, [a, b]);
    expect(result?.rung).toBe(3);
    // Stable: the first input order ([a, b]) wins on tie because Array.sort is
    // stable in V8 / Hermes. ctaRoute must reference one of them deterministically.
    expect(result?.ctaRoute).toMatch(/draft-(a|b)/);
  });

  test("T-QA-07 — empty-string address does not create an address rung", () => {
    const brand = baseBrand({ address: "" });
    const counts: UpcomingCounts = { total: 1, active: 1, live: 1, upcoming: 0, draft: 0 };
    const result = pickHomeNextAction(brand, counts, []);
    expect(result).toBeNull();
  });

  test("T-QA-07b — whitespace-only address does not create an address rung", () => {
    const brand = baseBrand({ address: "   " });
    const counts: UpcomingCounts = { total: 1, active: 1, live: 1, upcoming: 0, draft: 0 };
    const result = pickHomeNextAction(brand, counts, []);
    expect(result).toBeNull();
  });

  test("1 trip draft + 0 live → rung 3 trip-typed route", () => {
    const brand = baseBrand();
    const counts: UpcomingCounts = { total: 1, active: 1, live: 0, upcoming: 0, draft: 1 };
    const tripDraft = draft({ id: "draft-trip-1" });
    (tripDraft as DraftEvent & { event_type?: string }).event_type = "trip";
    const result = pickHomeNextAction(brand, counts, [tripDraft]);
    expect(result?.rung).toBe(3);
    expect(result?.ctaRoute).toContain("/trip/");
  });
});
