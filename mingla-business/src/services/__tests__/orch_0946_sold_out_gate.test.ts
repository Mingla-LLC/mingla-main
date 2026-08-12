/**
 * ORCH-0946 — buyer-web sold-out gate regression tests.
 *
 * Bug: `tierToTicketStub` and `ticketRowToTicketStub` previously set
 * `capacity` to total tier capacity (`quantityTotal` / `quantity_total`)
 * which never decreases. The sold-out gate at
 * `mingla-business/app/checkout-trip/[tripEventId]/index.tsx:237-239` and
 * the event-side mirror at `app/checkout/[eventId]/index.tsx:173-176` then
 * never triggered, so the buyer could tap "+" all the way to the payment
 * screen on a sold-out tier and only failed at the final 409
 * `ticket_capacity_exceeded`.
 *
 * Fix: anon-callable `pg_public_ticket_types_remaining(event_id)` RPC
 * threads remaining-bookable-count through to the mappers, which now
 * prefer remaining over total when sold-out gating.
 *
 * Two regression tests covering ORCH-0840 Step 0.5 gate (a) happy-path +
 * (b) adversarial. fails-on-revert verified manually by reverting
 * `tier.ticketsRemaining ?? tier.quantityTotal` back to `tier.quantityTotal`
 * in `app/checkout-trip/[tripEventId]/index.tsx` and re-running this file.
 */

/* eslint-disable import/first */
import { describe, expect, jest, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import path from "node:path";

import type { TripPricingTier } from "../tripsService";

// [TEST-MOD-APPROVED ORCH-1062] B1 CONVERT (behavioral) — the adversarial
// "event-side public read overwrites capacity with remaining" assertion below
// was a source-text pin (`readFileSync` → `toMatch(/return { ...s, capacity:
// remaining }/)`). ORCH-1006 (server all-in) renamed the mapper's intermediate
// var `s` → `withAllIn` (publicEventsService.ts:1263-1274), so the exact-text pin
// broke on the refactor while the BEHAVIOR is unchanged. This invariant (event
// tickets expose `capacity = bookable remaining` for limited tiers, untouched for
// unlimited) is load-bearing and has NO other coverage (publicEventsService.test
// asserts no capacity; orch_1130 mocks the RPC empty), so per SPEC §B1 it is
// CONVERTED to a real behavioral assertion through the exported getPublicEventById
// (a strict-grep gate convert would touch DO-NOT-TOUCH CI/MANIFEST). Harness
// mirrors the proven publicEventsService.orch_1130_trip_dates.test.ts.
const rpcMock = jest.fn() as ReturnType<typeof jest.fn>;
const fromMock = jest.fn() as ReturnType<typeof jest.fn>;

jest.mock("../supabase", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
    from: (table: string) => fromMock(table),
  },
}));

jest.mock("expo-image", () => ({}), { virtual: true });

// `@mingla/offering-rendering` is a Metro-resolved workspace barrel; publicEvents
// Service only pulls the theme-slug guards from it. Stub them so the module loads
// under node/ts-jest (no moduleNameMapper in this worktree). Does not mask the
// capacity behavior under test.
jest.mock(
  "@mingla/offering-rendering",
  () => ({
    isThemeAnimationSlug: () => false,
    isThemeColor: () => false,
    isThemeFontSlug: () => false,
  }),
  { virtual: true },
);

import { getPublicEventById } from "../publicEventsService";

// Re-derive the trip-side mapper here (same logic as
// `app/checkout-trip/[tripEventId]/index.tsx:65`) so the test is fully
// hermetic and doesn't depend on RN module resolution.
const tierToCapacityForGate = (tier: TripPricingTier): number | null =>
  tier.isUnlimited ? null : (tier.ticketsRemaining ?? tier.quantityTotal);

const tier = (patch: Partial<TripPricingTier> = {}): TripPricingTier => ({
  id: "tier-1",
  eventId: "event-1",
  ticketTypeId: "tt-1",
  tierName: "Standard",
  tierMetadata: {},
  priceCents: 5000,
  currency: "USD",
  quantityTotal: 55,
  ticketsRemaining: null,
  isUnlimited: false,
  installmentSchedule: null,
  // [TEST-MOD-APPROVED META-ORCH-1174] — TripPricingTier gained `description`.
  description: null,
  ...patch,
});

// =====================================================================
// (a) HAPPY-PATH REGRESSION — sold-out tier surfaces capacity=0 to the
// gate at index.tsx:237-239 (which then renders the "Sold out" EmptyState).
// =====================================================================
describe("ORCH-0946 sold-out gate (happy path)", () => {
  test("sold-out tier (remaining=0, total=55) maps to capacity=0", () => {
    const t = tier({ quantityTotal: 55, ticketsRemaining: 0 });
    expect(tierToCapacityForGate(t)).toBe(0);
  });

  test("aggregate sold-out detection fires when every non-unlimited tier has remaining=0", () => {
    const tiers = [
      tier({ id: "a", quantityTotal: 55, ticketsRemaining: 0 }),
      tier({ id: "b", quantityTotal: 20, ticketsRemaining: 0 }),
    ];
    const allSoldOut = tiers.every(
      (x) => !x.isUnlimited && (tierToCapacityForGate(x) ?? 0) <= 0,
    );
    expect(allSoldOut).toBe(true);
  });

  test("the trip-side mapper uses ticketsRemaining (not quantityTotal) for capacity", () => {
    const file = readFileSync(
      path.resolve(
        __dirname,
        "../../../app/checkout-trip/[tripEventId]/index.tsx",
      ),
      "utf-8",
    );
    expect(file).toMatch(
      /capacity:\s*tier\.ticketsRemaining\s*\?\?\s*tier\.quantityTotal/,
    );
    expect(file).not.toMatch(/capacity:\s*tier\.quantityTotal,/);
  });
});

// =====================================================================
// (b) ADVERSARIAL REGRESSION — different angles than (a):
//   - unlimited tier never reports sold-out even when remaining=0 leaks
//   - partial-sold tier caps gate at remaining, not at total
//   - ticketsRemaining=null (RPC degraded) falls back to quantityTotal
//     so a partial-sold trip still bookable, never a false sold-out
//   - server-side RPC SQL invariants hold (status filter + GREATEST guard)
// =====================================================================
describe("ORCH-0946 sold-out gate (adversarial)", () => {
  test("unlimited tier stays unbounded (capacity=null) even with stale remaining=0", () => {
    const t = tier({
      isUnlimited: true,
      quantityTotal: null,
      ticketsRemaining: 0,
    });
    expect(tierToCapacityForGate(t)).toBeNull();
    const isSoldOut = !t.isUnlimited && (tierToCapacityForGate(t) ?? 0) <= 0;
    expect(isSoldOut).toBe(false);
  });

  test("partial-sold tier caps QuantityRow + at remaining, not at total", () => {
    const t = tier({ quantityTotal: 55, ticketsRemaining: 3 });
    expect(tierToCapacityForGate(t)).toBe(3);
    expect(tierToCapacityForGate(t)).not.toBe(55);
  });

  test("RPC-degraded tier (ticketsRemaining=null) falls back to quantityTotal — no false sold-out, no crash", () => {
    const t = tier({ quantityTotal: 55, ticketsRemaining: null });
    expect(tierToCapacityForGate(t)).toBe(55);
    const isSoldOut = !t.isUnlimited && (tierToCapacityForGate(t) ?? 0) <= 0;
    expect(isSoldOut).toBe(false);
  });

  test("migration RPC counts only status IN (valid, used, transferred) and clamps remaining >= 0", () => {
    const file = readFileSync(
      path.resolve(
        __dirname,
        "../../../../supabase/migrations/20260724000006_orch_0946_public_ticket_types_remaining.sql",
      ),
      "utf-8",
    );
    expect(file).toMatch(/status\s+IN\s*\(\s*'valid',\s*'used',\s*'transferred'\s*\)/);
    expect(file).toMatch(/GREATEST\(\s*tt\.quantity_total\s*-\s*COALESCE\(s\.sold,\s*0\),\s*0\s*\)/);
    expect(file).toMatch(/GRANT EXECUTE ON FUNCTION public\.pg_public_ticket_types_remaining\(uuid\) TO anon, authenticated/);
  });

  test("event-side public read overwrites capacity with remaining for non-unlimited tickets", async () => {
    // BEHAVIORAL CONVERT (see file header): drive the exported getPublicEventById
    // and assert the mapper wires the bookable `remaining` into `capacity` for a
    // limited tier while leaving an unlimited tier untouched — the exact invariant
    // the old source-text pin guarded, now refactor-proof.
    const EVENT_ID = "11111111-1111-4111-8111-111111111111";
    const eventRow = {
      id: EVENT_ID,
      brand_id: "brand-1",
      brand_slug: "brand-1",
      brand_name: "Brand One",
      brand_description: null,
      brand_profile_photo_url: null,
      brand_display_attendee_count: false,
      brand_address: null,
      brand_cover_media_url: null,
      brand_theme_color: null,
      brand_theme_font: null,
      brand_theme_animation: null,
      title: "Sold-out gate event",
      description: null,
      slug: "sold-out-gate-event",
      event_type: "event",
      location_text: null,
      online_url: null,
      is_online: false,
      is_recurring: false,
      is_multi_date: false,
      recurrence_rules: null,
      cover_media_url: null,
      cover_media_type: null,
      cover_media_provider: null,
      cover_media_source_url: null,
      cover_media_credit: null,
      cover_media_credit_url: null,
      cover_media_alt: null,
      currency: "USD",
      visibility: "public",
      show_on_discover: true,
      status: "scheduled",
      published_at: "2026-05-01T00:00:00Z",
      timezone: "UTC",
      created_at: "2026-05-01T00:00:00Z",
      updated_at: "2026-05-01T00:00:00Z",
      public_theme: null,
      theme_color_override: null,
      theme_font_override: null,
      theme_animation_override: null,
      master_start_at: "2026-09-19T18:00:00Z",
      master_end_at: "2026-09-19T22:00:00Z",
      master_timezone: "UTC",
      master_event_date_id: "date-1",
    };

    fromMock.mockReset();
    rpcMock.mockReset();
    fromMock.mockImplementation((table: string) => {
      throw new Error(`unexpected from(${table}) in ORCH-0946 behavioral test`);
    });
    // #1929 moves standard exact hydration to the canonical direct bundle. The
    // limited tier carries remaining=3 while the unlimited tier stays unbounded.
    rpcMock.mockImplementation((name: string) => {
      if (name !== "pg_direct_event_checkout_bundle") {
        throw new Error(`unexpected RPC ${name} in ORCH-0946 behavioral test`);
      }
      return Promise.resolve({
        data: {
          id: eventRow.id,
          brandId: eventRow.brand_id,
          brandSlug: eventRow.brand_slug,
          eventSlug: eventRow.slug,
          name: eventRow.title,
          description: eventRow.description,
          status: eventRow.status,
          currency: "USD",
          brand: {
            id: eventRow.brand_id,
            slug: eventRow.brand_slug,
            name: eventRow.brand_name,
          },
          tickets: [
            {
              id: "tt-limited",
              name: "Limited",
              priceCents: 0,
              allInCents: 0,
              currency: "USD",
              capacity: 55,
              remaining: 3,
              isUnlimited: false,
              isFree: true,
              isHidden: false,
              isDisabled: false,
              availableOnline: true,
              availableInPerson: false,
              displayOrder: 0,
            },
            {
              id: "tt-unlimited",
              name: "Unlimited",
              priceCents: 0,
              allInCents: 0,
              currency: "USD",
              capacity: null,
              remaining: null,
              isUnlimited: true,
              isFree: true,
              isHidden: false,
              isDisabled: false,
              availableOnline: true,
              availableInPerson: false,
              displayOrder: 1,
            },
          ],
        },
        error: null,
      });
    });

    const detail = await getPublicEventById(EVENT_ID);
    expect(detail).not.toBeNull();

    const limited = detail!.tickets.find((t) => t.id === "tt-limited");
    const unlimited = detail!.tickets.find((t) => t.id === "tt-unlimited");
    expect(limited).toBeDefined();
    expect(unlimited).toBeDefined();

    // Non-unlimited tier: capacity is OVERWRITTEN with the bookable remaining (3),
    // NOT the total tier capacity (55) — this is the sold-out-gate fix.
    expect(limited!.capacity).toBe(3);
    expect(limited!.capacity).not.toBe(55);
    // Unlimited tier: capacity untouched (null), never overwritten with remaining.
    expect(unlimited!.isUnlimited).toBe(true);
    expect(unlimited!.capacity).toBeNull();
    expect(fromMock).not.toHaveBeenCalled();
    expect(rpcMock).toHaveBeenCalledTimes(1);
  });
});
