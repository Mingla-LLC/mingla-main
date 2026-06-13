/**
 * ORCH-0876 [Trip CRUD + Purchase Flow Completion — Full Event↔Trip Parity] —
 * TESTER adversarial regression test per ORCH-0840
 * [Regression-test enforcement + append-only CI].
 *
 * Attacks angles DIFFERENT from the five implementor happy-path tests at
 * `mingla-business/src/utils/__tests__/publishedTripEditGuards.test.ts`,
 * `.../components/trip/__tests__/EditPublishedTripScreen.save.test.ts`,
 * `.../EditPublishedTripScreen.refundGate.test.ts`,
 * `.../TripCreatorWizard.cover.test.ts`, and
 * `.../app/trip/__tests__/edit.status-dispatch.test.ts`.
 *
 * Adversarial angles attacked here:
 *
 *   A1. **Silent mid-edit re-seed bug.** `EditPublishedTripScreen.tsx:484-486`
 *       has `useEffect(() => setEditState(tripToLocalEditState(trip)), [trip])`.
 *       The `[trip]` dependency fires on every prop-reference change, NOT
 *       just on first mount. React Query's `useTrip` hook has 60s
 *       `staleTime` + default `refetchOnWindowFocus: true`. When the
 *       operator is mid-edit, any refetch (window focus, cache
 *       invalidation, polling) reseats `editState` to the server snapshot
 *       and silently wipes in-progress edits. The implementor's tests
 *       only assert the useEffect EXISTS; none assert it's guarded
 *       against mid-edit reseats. (P1 — silent data loss.)
 *
 *   A2. **S-3 buyer-route fix has zero test coverage.** The original
 *       investigation gap S-3 ("Reserve my spot routes buyers to /checkout
 *       showing 'Event not found'") was closed by a one-line change at
 *       `TripCheckoutFlow.tsx:69` (router.push to /checkout-trip/{id}).
 *       None of the five implementor regression tests assert this route.
 *       A future refactor that reverts the single line trips zero tests.
 *
 *   A3. **Capacity edge cases — null + equal-to-sold.** The implementor's
 *       guard test covers `newCapacity < totalConfirmedOrders` rejection
 *       and `newCapacity > totalConfirmedOrders` acceptance, but skips:
 *       (a) `newCapacity === totalConfirmedOrders` (exactly full —
 *       SHOULD pass per strict-less-than guard) and (b) `newCapacity ===
 *       null` (operator clears capacity field — guard skips the check
 *       entirely; server is canonical but the fast-path UX swallows this
 *       case).
 *
 *   A4. **Anon-tolerance invariant pin on /checkout-trip routes.** Per
 *       `feedback_anon_buyer_routes.md`, every checkout-trip route MUST
 *       live outside `app/(tabs)/` AND MUST NOT import `useAuth` or
 *       redirect to signin. Verify across all 5 trip-buyer route files.
 *
 *   A5. **Severity rule on destinationPlaceId-only change.** The
 *       MATERIAL_BUSINESS_TRIP_KEYS array excludes `destinationPlaceId`,
 *       `destinationLat`, `destinationLng`, but `classifyTripSeverity`
 *       unconditionally returns "material" when `theme` is in changedKeys.
 *       Verify this safety net holds — destination re-pick (placeId
 *       change only, same text) still flips to material. Without this
 *       guard, a destination re-pick that keeps the text but moves the
 *       geo (e.g., picking the wrong Tulum) would silently classify as
 *       additive and skip the buyer notification.
 *
 *   A6. **Equal-but-out-of-order inclusions emit a no-op patch.** The
 *       inclusion-signature comparison in `buildLiveTripPatch` sorts by
 *       `(kind, ordinal)`. If operator reorders inclusions (same kind+item
 *       but different ordinal), the signatures differ → patch emitted →
 *       but `computeTripInclusionDiffs` (keyed by `kind:item`) returns
 *       zero rows. The modal would show "2 items → 2 items" with no row
 *       detail. Pin this so a future fix narrows the signature check.
 *
 *   A7. **ChangeSummaryModal entityLabel default lands on event.** If a
 *       future trip consumer forgets to pass `entityLabel="trip"`, the
 *       modal silently labels trip diffs as "event" — operator confusion
 *       at save time. Verify the default + verify EditPublishedTripScreen
 *       still passes the explicit prop.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "@jest/globals";

import type { Trip } from "../../../services/tripsService";
import { validateLiveTripFieldUpdate } from "../../../utils/publishedTripEditGuards";

const SRC_ROOT = join(__dirname, "..", "..", "..");
const APP_ROOT = join(__dirname, "..", "..", "..", "..", "app");
function read(rel: string): string {
  return readFileSync(join(SRC_ROOT, rel), "utf8");
}
function readApp(rel: string): string {
  return readFileSync(join(APP_ROOT, rel), "utf8");
}

const trip = (patch: Partial<Trip> = {}): Trip => ({
  id: "trip-1",
  brandId: "brand-1",
  brandSlug: "tulum-yoga-co",
  title: "Tulum Yoga Retreat",
  description: "A trip.",
  slug: "tulum-yoga-march-2026",
  status: "live",
  visibility: "public",
  publishedAt: "2026-05-01T10:00:00.000Z",
  timezone: "America/Cancun",
  coverMediaUrl: null,
  coverMediaType: null,
  businessTrip: {
    startAt: "2026-06-10T00:00:00.000Z",
    endAt: "2026-06-14T23:59:59.000Z",
    destinationPlaceId: "place-1",
    destinationLocationText: "Tulum, Quintana Roo, Mexico",
    destinationLat: 20.2114,
    destinationLng: -87.4654,
    departurePlaceId: null,
    departureLocationText: null,
    departureLat: null,
    departureLng: null,
    capacity: 12,
  },
  days: [],
  pricingTiers: [
    {
      id: "tier-1",
      eventId: "trip-1",
      ticketTypeId: "ticket-1",
      tierName: "Standard",
      tierMetadata: {},
      priceCents: 150000,
      currency: "USD",
      quantityTotal: 12,
      ticketsRemaining: null,
      isUnlimited: false,
      installmentSchedule: null,
    },
  ],
  inclusions: [],
  createdAt: "2026-05-01T10:00:00.000Z",
  updatedAt: "2026-05-01T10:00:00.000Z",
  refundPolicy: null,
  bookingDeadline: null,
  bookingsClosed: false,
  bookingsClosedAt: null,
  ticketsSoldCount: 0,
  ...patch,
});

// ============================================================
// A1 — Silent mid-edit re-seed bug
// ============================================================

describe("ORCH-0876 adversarial — A1: editState re-seed on prop change", () => {
  const SRC = read("components/trip/EditPublishedTripScreen.tsx");

  test("re-seed useEffect with [trip] dependency is GUARDED against mid-edit reseats", () => {
    // The implementation must NOT call setEditState unconditionally when
    // the `trip` prop reference changes — that wipes operator edits on
    // every React Query refetch (60s staleTime + default
    // refetchOnWindowFocus: true on `useTrip`).
    //
    // Two valid patterns satisfy this gate:
    //   (a) prevTripIdRef / hasSeededRef guard inside the existing
    //       useEffect([trip]) — only re-seed when trip.id actually changes
    //   (b) Drop the useEffect entirely, replace with a lazy useState
    //       initializer that runs once per mount
    //
    // Either way, the surrounding region around the useEffect or the
    // useState declaration must show one of the guard tokens below.
    //
    // ORCH-0876 P1-1 (tester adversarial; rework lands a prevTripIdRef
    // pattern at line ~484 of EditPublishedTripScreen.tsx).

    // Anchor: SOME useEffect with [trip] dependency MUST exist (or the
    // entire surface has been rewritten to a lazy init — also acceptable).
    const tripEffectIdx = SRC.search(
      /useEffect\([\s\S]*?setEditState[\s\S]*?\}\s*,\s*\[trip[,\s\]]/,
    );
    const lazyInitIdx = SRC.search(
      /useState<LocalTripEditState>\(\s*\(\) => tripToLocalEditState\(trip\)\s*\)/,
    );
    // At least one of the two patterns must be present.
    expect(tripEffectIdx !== -1 || lazyInitIdx !== -1).toBe(true);

    // Sentinel: the surrounding region around the chosen pattern MUST
    // contain a guard token. Without one, every refetch clobbers edits.
    const anchorIdx = tripEffectIdx !== -1 ? tripEffectIdx : lazyInitIdx;
    const seedRegion = SRC.slice(
      Math.max(0, anchorIdx - 400),
      anchorIdx + 600,
    );
    const hasGuard =
      /hasSeededRef|prevTripIdRef|trip\.id !== prev\b|useState<LocalTripEditState>\(\s*\(\) =>|TRANSITIONAL/.test(
        seedRegion,
      );
    expect({
      hint: "EditPublishedTripScreen.tsx mid-edit re-seed wipes operator edits — add a prevTripIdRef guard or lazy useState initializer",
      hasGuard,
    }).toEqual({
      hint: "EditPublishedTripScreen.tsx mid-edit re-seed wipes operator edits — add a prevTripIdRef guard or lazy useState initializer",
      hasGuard: true,
    });
  });
});

// ============================================================
// A2 — S-3 buyer-route fix has zero test coverage
// ============================================================

describe("ORCH-0876 adversarial — A2: TripCheckoutFlow S-3 fix pinned", () => {
  const SRC = read("components/trip/TripCheckoutFlow.tsx");
  // [TEST-MOD-APPROVED by orchestrator, ORCH-1117 CLOSE] — ORCH-1117's LOCKED
  // decision (§4.5) removed the LOUD inline Reserve nav from TripCheckoutFlow
  // and moved it to the public trip route's floating Buy bar. The S-3
  // destination invariant (route to /checkout-trip/{id}, NEVER the events
  // /checkout/{id} chain that hard-rejects trip rows) is UNCHANGED — it simply
  // lives in app/t/[brandSlug]/[tripSlug].tsx now. The A2 source read is
  // re-pointed at the route; the destination invariant assertion is preserved
  // verbatim. Authorized by the ORCH-1117 TEST dispatch.
  const ROUTE = readApp("t/[brandSlug]/[tripSlug].tsx");

  test("trip floating-bar reserve routes to /checkout-trip/{id} (NOT the events chain)", () => {
    // Pre-ORCH-0876 the same buyer action pushed to `/checkout/${trip.id}`
    // and buyers saw "Event not found" because getPublicEventById
    // hard-rejects trip rows by audit-test invariant. ORCH-1117 moved the
    // action to the floating bar in the route, still via tripCheckoutPath.
    // DESTINATION INVARIANT (preserved): the route navigates to the
    // trip-specific checkout chain, never the events /checkout/{id} chain.
    // [TEST-MOD-APPROVED ORCH-1130] — ORCH-1130 threads the public-page
    // pay-full/installments choice as a route param, so the Reserve nav is now
    // the object form `router.push({ pathname: tripCheckoutPath(trip.id),
    // params: { plan: ... } })`. The destination invariant is UNCHANGED — the
    // pathname is still `tripCheckoutPath(trip.id)`. The assertion is widened to
    // accept either the bare-string OR the object form, both anchored on
    // tripCheckoutPath(trip.id).
    expect(ROUTE).toMatch(
      /router\.push\(\s*(?:tripCheckoutPath\(trip\.id\) as never|\{[\s\S]*?pathname:\s*tripCheckoutPath\(trip\.id\)[\s\S]*?\} as never)/,
    );
    // And explicitly NOT the broken events chain (raw or via helper).
    expect(ROUTE).not.toMatch(/router\.push\(`\/checkout\/\$\{trip\.id\}` as never\)/);
    expect(ROUTE).not.toMatch(/router\.push\(checkoutPublicPath\(trip\.id\)/);
  });

  test("handleReserve callsite cites ORCH-0876 + audit-test invariant in a comment", () => {
    // Future refactors deserve a sign that says "do not revert this line."
    // The comment stays in TripCheckoutFlow.tsx (ORCH-1117 preserved it when
    // it moved the LOUD nav out) so the trip-chain invariant rationale is
    // documented at the surface the original investigation pointed at.
    expect(SRC).toMatch(/ORCH-0876.*trip-specific chain/);
    expect(SRC).toMatch(/eventType\.filter\.audit\.test\.ts/);
  });
});

// ============================================================
// A3 — Capacity edge cases (null + equal-to-sold)
// ============================================================

describe("ORCH-0876 adversarial — A3: capacity guard edge cases", () => {
  test("newCapacity exactly equal to totalConfirmedOrders is ACCEPTED (strict-less-than guard)", () => {
    // Trip is exactly full. Reducing capacity to the sold count is not
    // a refund-triggering change. The implementor's tests cover
    // newCapacity < sold (reject) and newCapacity > sold (accept) but
    // not the boundary.
    const result = validateLiveTripFieldUpdate(
      trip(),
      { theme: { business_trip: { capacity: 7 } } },
      { "ticket-1": 7 },
      7,
      "Capping capacity at the current booked count",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.trimmedReason).toBe(
      "Capping capacity at the current booked count",
    );
  });

  test("newCapacity === null (operator clears the field) silently skips the guard", () => {
    // Today the guard at publishedTripEditGuards.ts has:
    //   if (newCapacity !== undefined && newCapacity !== null) { ... }
    // — so a `null` patch (cleared field) is passed to the server. This
    // documents the current behavior; the server-side RPC is canonical.
    // If the UX intent ever becomes "treat null as unlimited", this test
    // anchors the trade-off so it's explicit, not silent.
    const result = validateLiveTripFieldUpdate(
      trip(),
      { theme: { business_trip: { capacity: null } } },
      { "ticket-1": 5 },
      5,
      "Clearing capacity to mark this trip as unlimited",
    );
    // CURRENT BEHAVIOR: client passes through; server decides.
    expect(result.ok).toBe(true);
  });
});

// ============================================================
// A4 — Anon-tolerance of /checkout-trip routes
// ============================================================

describe("ORCH-0876 adversarial — A4: /checkout-trip anon-tolerance pin", () => {
  const ROUTES = [
    "checkout-trip/[tripEventId]/_layout.tsx",
    "checkout-trip/[tripEventId]/index.tsx",
    "checkout-trip/[tripEventId]/buyer.tsx",
    "checkout-trip/[tripEventId]/payment.tsx",
    "checkout-trip/[tripEventId]/confirm.tsx",
  ];

  test.each(ROUTES)("route %s never imports useAuth", (relPath) => {
    const src = readApp(relPath);
    // Allow `useAuth` only inside comments mentioning anon-tolerance.
    // The cheap rule: zero non-comment matches of `useAuth(`.
    const codeOnly = src.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
    expect(codeOnly).not.toMatch(/useAuth\s*\(/);
    expect(codeOnly).not.toMatch(/from\s+["'][^"']*AuthContext["']/);
  });

  test.each(ROUTES)("route %s never redirects to signin/login", (relPath) => {
    const src = readApp(relPath);
    const codeOnly = src.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
    expect(codeOnly).not.toMatch(/router\.replace\(["'`][^"'`]*\/signin/);
    expect(codeOnly).not.toMatch(/router\.replace\(["'`][^"'`]*\/login/);
    expect(codeOnly).not.toMatch(/router\.push\(["'`][^"'`]*\/signin/);
    expect(codeOnly).not.toMatch(/router\.push\(["'`][^"'`]*\/login/);
  });

  test("Trip-buyer chain lives OUTSIDE app/(tabs)/", () => {
    // Per feedback_anon_buyer_routes.md: anon-tolerant routes MUST live
    // outside the (tabs) group. The dir name is the contract.
    for (const rel of ROUTES) {
      expect(rel).not.toMatch(/^\(tabs\)/);
    }
  });
});

// ============================================================
// A5 — destinationPlaceId-only change still classifies material
// ============================================================

describe("ORCH-0876 adversarial — A5: classifyTripSeverity safety net", () => {
  // The tripAdapter classifies any `theme` key as MATERIAL unconditionally,
  // which catches destinationPlaceId/Lat/Lng changes that aren't in
  // MATERIAL_BUSINESS_TRIP_KEYS. Verify this guard exists.
  const SRC = read("utils/tripAdapter.ts");

  test("classifyTripSeverity returns 'material' immediately when 'theme' is in changedKeys", () => {
    expect(SRC).toMatch(
      /if \(k === "theme"\) \{[\s\S]*?return "material";/,
    );
  });

  test("MATERIAL_BUSINESS_TRIP_KEYS lists the 4 buyer-visible business_trip fields", () => {
    // startAt, endAt, destinationLocationText, capacity. NOT
    // destinationPlaceId/Lat/Lng (those are silent — keep them out of
    // the surface-level list but rely on the `theme`-is-material guard).
    expect(SRC).toMatch(
      /MATERIAL_BUSINESS_TRIP_KEYS:[\s\S]*?"startAt"[\s\S]*?"endAt"[\s\S]*?"destinationLocationText"[\s\S]*?"capacity"/,
    );
    // Negative: must NOT include destinationPlaceId at the surface level.
    const matKeys = SRC.match(
      /MATERIAL_BUSINESS_TRIP_KEYS:[\s\S]*?\];/,
    );
    expect(matKeys).not.toBeNull();
    expect(matKeys![0]).not.toMatch(/"destinationPlaceId"/);
  });
});

// ============================================================
// A6 — Reorder-only inclusion patch emits a no-op diff
// ============================================================

describe("ORCH-0876 adversarial — A6: inclusion reorder generates no-op diff", () => {
  const SRC = read("components/trip/EditPublishedTripScreen.tsx");

  test("buildLiveTripPatch inclusions signature includes ordinal", () => {
    // Today's behavior: signature includes ordinal, so reorder-only flips
    // signatures and emits a patch. The diff list (keyed by kind:item)
    // returns zero rows → modal shows "N items → N items" with no detail.
    // This anchors the current trade-off; a future fix would either
    // ignore ordinal-only changes OR add a "reorder" row to the modal.
    expect(SRC).toMatch(
      /trip\.inclusions[\s\S]*?\.map\(\(i\) => \(\{ kind: i\.kind, item: i\.item, ordinal: i\.ordinal \}\)\)/,
    );
  });
});

// ============================================================
// A7 — ChangeSummaryModal entityLabel safety
// ============================================================

describe("ORCH-0876 adversarial — A7: ChangeSummaryModal entityLabel default", () => {
  const MODAL = read("components/event/ChangeSummaryModal.tsx");
  const SCREEN = read("components/trip/EditPublishedTripScreen.tsx");

  test("entityLabel defaults to 'event' (event-side legacy preservation)", () => {
    expect(MODAL).toMatch(/entityLabel\s*=\s*"event"/);
  });

  test("EditPublishedTripScreen passes the explicit entityLabel=\"trip\" prop", () => {
    expect(SCREEN).toMatch(
      /<ChangeSummaryModal[\s\S]*?entityLabel="trip"/,
    );
  });

  test("Modal footer copy uses the entityLabel for ownership", () => {
    // The "your {entity}'s edit history" copy must use the entityLabel,
    // not be hardcoded to "event".
    expect(MODAL).toMatch(
      /your \$\{entityLabel\}'?s edit history|your \{entityLabel\}'?s edit history|`your \$\{entityLabel\}/,
    );
  });
});
