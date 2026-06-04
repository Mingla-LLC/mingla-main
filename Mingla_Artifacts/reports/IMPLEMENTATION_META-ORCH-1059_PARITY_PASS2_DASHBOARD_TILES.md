# IMPLEMENTATION — META-ORCH-1059 Parity Pass 2: Dashboard Tile Grid + Analytics (Sub-F)

**ORCH:** META-ORCH-1059 [experiences-business-parity], Pass 2
**Branch:** `meta-orch-1059-experiences-business-parity`
**Worktree:** `~/Desktop/mingla-orchs/meta-orch-1059-[experiences-business-parity]/`
**Base commit:** `b658f5eeb` (Pass 1 — shared offering primitives)
**Status:** implemented + verified (experience dashboard live on iOS sim; trip dashboard bundle-verified + shared-code-path-proven + regression-tested — live trip render UNVERIFIED, see §Verification)

---

## Goal

Bring the TRIP (`app/trip/[id]/index.tsx`) and EXPERIENCE (`app/experience/[id]/index.tsx`)
operator dashboards to EVENT-grade tile parity using the Pass-1 config-driven
`offering/` approach (extend, don't fork). Operator-confirmed tile set for both
kinds: **Scan · Scanners · Orders · Guests · Blasts · Public page · Brand page ·
Reconciliation**, plus a single revenue-left/payout-right tile, a kind-aware
"Types" tile, and a Recent activity feed.

---

## Comms ledger

Read on entry. No BLOCK/WARN addressed to this skill or META-ORCH-1059. Relevant
FYI/WARN factored: COMMS-0014/0016 (experiences route through the shared
`ticket-checkout-create` — confirms orders are read by `event_id`, offering-
agnostic, which this pass relies on) and COMMS-0018 (META-ORCH-1009 Sub-F
reconciliation — unrelated to dashboard tiles). No new COMMS entry written (no
cross-ORCH discovery beyond the pre-existing test drift noted below, which is
in-ORCH advisory).

---

## Architecture — per-kind config, no forks

### Per-kind dashboard tile config (NEW)
`mingla-business/src/components/offering/offeringDashboardTiles.ts`
`buildOfferingDashboardTiles(kind)` returns the ordered 8-tile set. Each tile
carries `{ key, icon, label, requiresPublicPage, route(input), sub? }`. Labels +
routes read through the Pass-1 `offeringKind` lens — NO hardcoded
"event"/"attendee" strings in shared code:

| Tile | event | trip | experience | Route |
|---|---|---|---|---|
| Scan | Scan tickets | Scan tickets | Scan tickets | `/event/{id}/scanner` |
| Scanners | Scanners | Scanners | Scanners | `/event/{id}/scanners` |
| Orders | Orders | Orders | Orders | `/event/{id}/orders` |
| Guests (metric lens) | Attendees | **Travelers** | **Spots** | trip→`/trip/{id}/travelers`; else `/event/{id}/guests` |
| Blasts | Blasts | Blasts | Blasts | `/event/{id}/blasts` |
| Public page | Public page | Public page | Public page | `{/e,/t,/exp}/{brandSlug}/{slug}` |
| Brand page | Brand page | Brand page | Brand page | `/b/{brandSlug}` |
| Reconciliation | Reconciliation | Reconciliation | Reconciliation | `/event/{id}/reconciliation` |

The Guests tile is the one kind-specific route override: trips already ship a
dedicated `/trip/{id}/travelers` route (the trip "Guests" lens), so the tile
points there for trips and at the shared `/event/{id}/guests` otherwise. The
metric LABEL ("Travelers"/"Spots"/"Attendees") comes from `offeringKind`.

### Which event screens were GENERALIZED vs newly routed

- **Reused as-is (offering-agnostic, no edit):** `/event/{id}/orders`,
  `/event/{id}/guests`, `/event/{id}/scanner`, `/event/{id}/scanners`,
  `/event/{id}/reconciliation`, `/event/{id}/blasts`. These key off the
  offering id and read `orders` by `event_id` (`fetchEventOrders` →
  `orders.select(... events!inner(brand_id) ...).eq('event_id', id)`), which is
  identical for events, trips, and experiences (all are events-table rows
  issuing `ticket_types`-backed tickets). Experiences resolve through these
  screens directly (they pass the `business_management_events_view` path).
- **`useManagedEventRoute` (GENERALIZED, additive):** the event-only detail
  read (`fetchBusinessEventById`) deliberately rejects `event_type='trip'`
  (ORCH-0859, locked by `eventType.filter.audit.test.ts`). So the shared
  scanner/scanners/orders/recon screens could not resolve a TRIP id via that
  path. Rather than fork five screens or relax the locked probe, Pass 2 adds an
  **additive trip fallback** to `useManagedEventRoute`: when the local store +
  server-event-detail both return null, it reads the trip via `useTrip` and
  adapts it (`tripToLiveEvent`) into the minimal `LiveEvent` the sub-screens
  consume (id, brandId, brandSlug, eventSlug, name, currency, status, tickets,
  lifecycle). Event/experience paths are untouched (the fallback only activates
  once the primary paths return null) → the event dashboard is unaffected and
  the locked trip-rejection probe stays intact.

### NEW shared components / utils

- `offering/offeringDashboardTiles.ts` — per-kind tile config (above).
- `offering/ExperienceStopsGalleryTile.tsx` — the experience "Types" tile: each
  stop's name + address + per-stop blurb + per-stop price above a **horizontally
  scrollable image gallery** from `experience_stops.image_urls`.
- `utils/tripToLiveEvent.ts` — trip→LiveEvent adapter (chokepoint for the
  shared sub-screens; does NOT touch the locked `fetchBusinessEventById`).
- `utils/offeringActivityFromOrders.ts` — derives the Recent-activity feed
  (purchase/refund/cancel) from `OrderRecord[]`, the same shape the event
  dashboard walks. Reused by the experience dashboard.

---

## Old → New Receipts

### `app/experience/[id]/index.tsx`
**Before:** Sub-B functional core — tiles: Edit, Public page, Brand page, Share,
Cancel only. PRICING (price/capacity) card. STOPS rendered as a static
vertical list with a single thumbnail per stop. No orders/scan/guests/orders/
reconciliation tiles, no revenue/payout, no recent activity.
**Now:** full event-grade tile grid built from `buildOfferingDashboardTiles
("experience")` (Scan · Scanners · Orders[N sold] · Spots · Blasts · Public ·
Brand · Reconciliation) + Edit (primary). Adds `EventDetailKpiCard`
(revenue-left / payout-right, real money from `useEventOrders`), the STOPS
"Types" tile via `ExperienceStopsGalleryTile` (horizontal image gallery + full
detail), and a RECENT ACTIVITY feed from `offeringActivityFromOrders`. Bottom
safe-area (Pass 1) preserved.
**Why:** operator-confirmed tile set + revenue/payout + Types gallery + activity.
**Lines:** ~+90 / −70.

### `app/trip/[id]/index.tsx`
**Before:** tiles: Travelers, Payments, Blasts, Group chat, Public, Brand, Edit.
`TripDetailKpiCard` (revenue + spots). Pricing tiers + recent activity already
present (ORCH-0913/0874).
**Now:** event-grade grid from `buildOfferingDashboardTiles("trip")` adds Scan ·
Scanners · Orders · **Travelers** (Guests lens → `/trip/{id}/travelers`) ·
Blasts · Public · Brand · Reconciliation, keeping Edit (primary) + Payments +
Group chat as trip-specific extras. Adds a single `EventDetailKpiCard`
(revenue-left/payout-right) above the existing `TripDetailKpiCard`, with real
money from `useEventOrders` + `summarizeEventMoney`. Pricing tiers + recent
activity unchanged.
**Why:** parity tile set + revenue/payout summary.
**Lines:** ~+55 / −30.

### `src/hooks/useManagedEventRoute.ts`
**Before:** resolved a managed event from the local store or
`fetchBusinessEventById` (event/experience only; trips return null).
**Now:** additive trip fallback — when both primary paths yield null, reads the
trip via `useTrip` and adapts via `tripToLiveEvent`, so the shared
scanner/scanners/orders/recon screens resolve trip ids. Event/experience paths
byte-unchanged; `isServerBacked`/`isLoading`/`brand` updated to fold the trip
fallback.
**Why:** unblock the shared sub-screens for trips without forking them or
touching the locked event-only detail probe.
**Lines:** ~+30.

### NEW files
- `src/components/offering/offeringDashboardTiles.ts` (~140 lines)
- `src/components/offering/ExperienceStopsGalleryTile.tsx` (~190 lines)
- `src/utils/tripToLiveEvent.ts` (~140 lines)
- `src/utils/offeringActivityFromOrders.ts` (~65 lines)

---

## The experience "Types" stops-gallery tile

`ExperienceStopsGalleryTile` renders, per `experience_stops` row: `"{n}.
{place_name}"` + per-stop `start_time` + per-stop price (when `pricing_mode =
per_stop` and `price_cents > 0`) + full `address` + `ai_description` blurb,
above a horizontal `ScrollView` of `image_urls` (132×96 cards, gap-spaced; empty
state "No photos"). Pulls from the already-loaded `ExperienceDetail.stops` — no
new fetch. Verified live: "Sparkling Welcome Flight $30.00" + "Rooftop Nightcap
$25.00" with addresses + images rendered.

## Revenue/payout + recent activity

Both dashboards compute the single revenue-left/payout-right tile from
`summarizeEventMoney({ orders: useEventOrders(id), ... })` and render it via the
canonical `EventDetailKpiCard` (revenue = `onlineRevenue`, payout =
`onlineNetMajor` from real Stripe app-fee columns). Recent activity uses
`offeringActivityFromOrders` (experience) / the existing trip activity merge
(trip). No schema change — all reads hit existing tables (`orders`,
`ticket_types`, `event_dates`, `experience_stops`).

---

## Migrations

NONE. All counts/aggregates read from existing tables via existing services
(`fetchEventOrders`, `getExperienceDetail`, `useTrip`). No migration filename to
apply.

---

## tsc

`npx tsc --noEmit` — **zero errors in any touched file** (filtered:
experience/trip index, offeringDashboardTiles, ExperienceStopsGalleryTile,
tripToLiveEvent, offeringActivityFromOrders, useManagedEventRoute → no matches).
Repo-wide pre-existing errors remain in untouched foreign files (`packages/*`,
`app/checkout/*`, `app/(tabs)/account.tsx` `trending-up`, marketing composer,
`@mingla/payments-native`) — present on the base commit, NOT introduced here.

---

## Regression Tests (fails-on-revert verified @ b658f5eeb)

3 new Jest files, 18 tests, all green; each proven to fail on revert:

1. `src/components/offering/__tests__/offeringDashboardTiles.parity.test.ts` —
   canonical 8-tile set + order per kind; per-kind routes (scan/scanners/orders/
   recon shared; Guests=travelers for trips); per-kind public prefix; Guests
   label lens. **Fails-on-revert:** repointing trip Guests `/trip/{id}/travelers`
   → `/event/{id}/guests` failed the assertion.
2. `src/utils/__tests__/tripToLiveEvent.parity.test.ts` — adapter maps the
   fields the shared sub-screens consume; draft→published-status scaffold;
   ticket-stub per tier; null brandSlug→"". **Fails-on-revert:** zeroing the
   `eventSlug` mapping failed the identity assertion.
3. `src/utils/__tests__/offeringActivityFromOrders.test.ts` — purchase/refund/
   cancel rows, anonymous-buyer, newest-first + cap. **Fails-on-revert:**
   breaking the buyer-name derivation failed 2 assertions.

Command: `npx jest <3 files>` → `Test Suites: 3 passed, Tests: 18 passed`.

---

## Device Evidence (iOS sim 17091E60 — iPhone 17 Pro, Metro 8090 serving this worktree)

Physical `R58R54YV7JT` not connected; verified on the iOS simulator + Android
emulator available. Business dev-client connected to Metro on 8090 (this
worktree, confirmed via lsof cwd). Live bundle of the changed code.

- **Experience dashboard** ("Raleigh Wine and Dine Crawl", Lantern & Vine,
  published, per-stop pricing): renders the full Pass-2 tile grid — Edit ·
  Scan tickets · Scanners · Orders (0 sold) · **Spots** · Blasts · Public page ·
  Brand page · Reconciliation — plus the **REVENUE $0.00 / PAYOUT —** summary
  tile. Scrolled: PRICING ($55 / 20 spots), **STOPS** gallery (Sparkling Welcome
  Flight $30 + image, Rooftop Nightcap $25 + image, full addresses), RECENT
  ACTIVITY "No activity yet.", Cancel experience CTA with bottom safe-area.
- **Tile routing:** tapped **Scan tickets** → resolved the shared
  `/event/{expId}/scanner` screen ("Point camera at ticket QR code", "Recent
  scans (0)") — proves the experience id resolves through the offering-agnostic
  event sub-screen (no "not found").
- **Event dashboard:** untouched code paths; the additive `useManagedEventRoute`
  fallback only activates when the primary event/experience resolution returns
  null, so the event dashboard is unaffected (regression test + source review).

### UNVERIFIED (one criterion)
- **Trip dashboard live render** — the only trip with data ("The DC Adventure",
  24 orders) belongs to **TravelBrand**, which the sim's logged-in account
  (Lantern & Vine owner) cannot access; Lantern & Vine has no trips. Trip
  dashboard parity is therefore proven by: (a) the trip route **bundles
  cleanly** via Metro (HTTP 200, no errors), (b) it shares the exact Pass-2 code
  paths (`buildOfferingDashboardTiles`, `EventDetailKpiCard`,
  `summarizeEventMoney`, `tripToLiveEvent`) that rendered correctly live on the
  experience dashboard, and (c) the tile-config + adapter regression tests pass
  and fail-on-revert. **Manual test needed:** sign the business app into
  TravelBrand and open "The DC Adventure" to confirm the grid + revenue/payout +
  scanner-resolves-trip live.

---

## Discoveries for Orchestrator

1. **Pre-existing locked-test drift (NOT this pass).** 3 assertions in the
   locked `src/services/__tests__/eventType.filter.audit.test.ts` fail on the
   **base commit** (`b658f5eeb`), independent of Pass 2 (proven by stashing all
   Pass-2 source and re-running — same 3 fail): `getPublicBrandBySlug filters
   trip rows`, `updateTripBasics theme SELECT pins event_type='trip'`,
   `getPublicTripById pins event_type='trip'`. These are brittle regex
   assertions over `publicEventsService.ts`/`tripsService.ts` (files Pass 2 does
   NOT touch) that drifted at some earlier point. Pass 2 does not fix or worsen
   them. Recommend a follow-up to re-tighten or update those regexes (the
   underlying `.eq("event_type","trip")` filters may still be present but the
   function-boundary regex no longer matches).

2. **Trip-dashboard live verification needs a TravelBrand login** on the test
   device (see UNVERIFIED above).

---

## Files changed (commit pathspec — mingla-business only)

```
mingla-business/app/experience/[id]/index.tsx                                  (M)
mingla-business/app/trip/[id]/index.tsx                                         (M)
mingla-business/src/hooks/useManagedEventRoute.ts                              (M)
mingla-business/src/components/offering/offeringDashboardTiles.ts             (A)
mingla-business/src/components/offering/ExperienceStopsGalleryTile.tsx        (A)
mingla-business/src/components/offering/__tests__/offeringDashboardTiles.parity.test.ts (A)
mingla-business/src/utils/tripToLiveEvent.ts                                   (A)
mingla-business/src/utils/offeringActivityFromOrders.ts                        (A)
mingla-business/src/utils/__tests__/tripToLiveEvent.parity.test.ts            (A)
mingla-business/src/utils/__tests__/offeringActivityFromOrders.test.ts        (A)
```
Foreign cruft (`app-mobile/*`, `packages/*`, anchor `COMMS_LEDGER.md`) left
untouched and NOT committed.

**Commit hash:** `53fc732da` (11 files, +1392/−180; mingla-business + report only).
