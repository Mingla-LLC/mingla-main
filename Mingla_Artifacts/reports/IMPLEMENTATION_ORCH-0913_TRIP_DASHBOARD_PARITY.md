# IMPLEMENTATION - ORCH-0913 Trip Dashboard Parity

**Implementor:** Codex `$implementor`  
**Date:** 2026-05-22  
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`  
**Status:** implemented, partially verified  
**Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-0913_TRIP_DASHBOARD_PARITY.md`  
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0913_TRIP_DASHBOARD_PARITY.md`

## Summary

ORCH-0913 is implemented on the `mingla-business` trip dashboard without touching the event dashboard, trip edit flow, hooks, database, RLS, edge functions, external APIs, or shared event blasts/group-chat routes.

The trip dashboard no longer has the legacy Overview / Travelers / Money tab strip. It now renders the ORCH-0913 tile grid, Revenue/Spots strip, Pricing Tiers section, Recent Activity section, and bottom Cancel trip CTA. Travelers and Money moved to dedicated routes.

## Phase Receipts

| Phase | Result |
|---|---|
| 1 | Removed `TabKey`, `tab` state, tab Pressables, per-tab body branches, dashboard-owned Travelers body, dashboard-owned Money body, and tab-only styles from `mingla-business/app/trip/[id]/index.tsx`. |
| 2 | Added `mingla-business/app/trip/[id]/travelers/index.tsx` with the former Travelers body, `TopBar leftKind="back" title="Travelers"`, loading/error/empty states, intake answer cards, and tier chips. |
| 3 | Added `mingla-business/app/trip/[id]/money/index.tsx` with the former Money ledger body, refund preview sheet, installment schedule display, filters, expand/collapse rows, retry mutation, and toast feedback. |
| 4 | Added 7 dashboard tiles in locked order: Travelers, Money, Blasts, Group chat, Public page, Brand page, Edit trip. Blasts and Group chat copy now matches event dashboard. |
| 5 | Added `TripDetailKpiCard` for Revenue + Spots using elevated `GlassCard` two-column shape. Event dashboard untouched (Option B). |
| 6 | Added Pricing Tiers section using `EventDetailTicketTypeRow` with a local `TripPricingTier -> TicketStub` adapter and real per-tier counts when intake `ticket_type_id` exists. |
| 7 | Added Recent Activity merge from real timestamped streams: paid booking via `TripOrderRow.createdAt`, installment collected via `collectedAt`, installment failed via `failedAt`; capped to 5 newest-first. |
| 8 | Preserved Cancel trip CTA gating and made it the final direct child of the dashboard `ScrollView`. |
| 9 | Added `TripDetailHeroStatusPill` and `deriveTripLifecycleStatus` for Live / Upcoming / Past / Cancelled. |
| 10 | Added trip hero `Platform.OS === "web"` `textShadow` shorthand with native RN text-shadow fallback. |
| 11 | Added file header and tile-local `[ORCH-0913 deliberate divergence from event]` comments documenting Edit trip as a primary tile. |
| 12 | Added `mingla-business/app/trip/[id]/__tests__/dashboard-parity.test.tsx` with T-01..T-18. Updated stale `trip-dashboard-edit.test.ts` to the new primary-tile contract. |
| 13 | Added `.github/scripts/strict-grep/orch-0913-no-tabs-on-dashboards.mjs` and registered it in `.github/workflows/strict-grep-mingla-business.yml`. |
| 14 | Ran scoped Jest, strict-grep, targeted lint, in-scope TypeScript filter, and desktop-web contract gates. Full repo lint/typecheck remain blocked by unrelated baseline failures listed below. |
| 15 | Wrote this implementation report. |

## Old -> New Receipts

| File | Old | New |
|---|---|---|
| `mingla-business/app/trip/[id]/index.tsx` | 5-tile grid plus Overview / Travelers / Money tab strip with hidden KPI, Travelers, and Money bodies. Binary Draft/Published pill. Native-only hero text shadow. | 7-tile grid, Revenue/Spots strip, Pricing Tiers, Recent Activity, lifecycle pill, web-safe hero text shadow, bottom Cancel CTA. No `accessibilityRole="tab"`, no tab state, no dashboard Money/Travelers body. |
| `mingla-business/app/trip/[id]/travelers/index.tsx` | Route absent; Travelers only existed as tab body. | Dedicated Travelers route with lifted list body, intake answer cards, tier chips, loading/error/empty states, and back TopBar. |
| `mingla-business/app/trip/[id]/money/index.tsx` | Route absent; Money only existed as tab body. | Dedicated Money route with lifted installment ledger, refund preview, schedule header, filters, retry, and toast feedback. |
| `mingla-business/src/components/trip/TripDetailKpiCard.tsx` | Absent. | Trip Revenue/Spots KPI strip matching event KPI shell shape without event sparkline placeholder. |
| `mingla-business/src/components/trip/TripDetailHeroStatusPill.tsx` | Absent. | Trip lifecycle derivation and 4-state status pill. |
| `mingla-business/app/trip/[id]/__tests__/dashboard-parity.test.tsx` | Absent. | T-01..T-18 happy-path regression suite. |
| `mingla-business/app/trip/__tests__/trip-dashboard-edit.test.ts` | Pinned removed header Edit Pressable. | Pins primary Edit action tile route and deliberate divergence comment. |
| `.github/scripts/strict-grep/orch-0913-no-tabs-on-dashboards.mjs` | Absent. | CI gate blocks dashboard `accessibilityRole="tab"` regression; includes `--self-test`. |
| `.github/workflows/strict-grep-mingla-business.yml` | No ORCH-0913 dashboard parity job. | Registers ORCH-0913 no-tabs dashboard job. |

## Data Truth And Omissions

No hook signatures or return shapes changed.

Recent Activity uses only real exposed timestamps:

| Stream | Implemented? | Field |
|---|---:|---|
| order-paid / booking | Yes | `TripOrderRow.createdAt` |
| order-cancelled | No | `useTripOrders` exposes no `cancelledAt`; omitted per Constitution #9. |
| installment-collected | Yes | `OrderInstallmentForBrand.collectedAt` |
| installment-failed | Yes | `OrderInstallmentForBrand.failedAt` |
| trip-cancelled lifecycle | No | `useTrip` `Trip` exposes no `cancelledAt`; omitted per Constitution #9. |

DISC-0913-A: if order cancellation and trip cancellation timestamps are needed in Recent Activity, expose real `cancelledAt` fields through the existing service/hook contracts in a future scoped ORCH. This implementation deliberately did not fabricate timestamps.

## Verification

Passed:

```bash
cd mingla-business
npx jest --runTestsByPath 'app/trip/[id]/__tests__/dashboard-parity.test.tsx' 'app/trip/__tests__/trip-dashboard-edit.test.ts' --runInBand
# PASS: 2 suites, 23 tests
```

```bash
node .github/scripts/strict-grep/orch-0913-no-tabs-on-dashboards.mjs --self-test
node .github/scripts/strict-grep/orch-0913-no-tabs-on-dashboards.mjs
# PASS
```

```bash
cd mingla-business
npx eslint 'app/trip/[id]/index.tsx' 'app/trip/[id]/travelers/index.tsx' 'app/trip/[id]/money/index.tsx' 'src/components/trip/TripDetailKpiCard.tsx' 'src/components/trip/TripDetailHeroStatusPill.tsx' 'app/trip/[id]/__tests__/dashboard-parity.test.tsx' 'app/trip/__tests__/trip-dashboard-edit.test.ts'
# PASS
```

```bash
cd mingla-business
npx tsc --noEmit --pretty false 2>&1 | rg 'app/trip|src/components/trip/TripDetail|src/components/event/EventDetailTicketTypeRow|src/components/event/EventDetailActivityRow' || true
# PASS: no in-scope TypeScript errors emitted
```

```bash
cd mingla-business
npm run test:orch-0885-a
npx jest src/components/ui/__tests__/BottomNavWebDesktopPolish.test.ts src/components/__tests__/wizardDesktopLayout.test.ts src/utils/__tests__/homeKpiPresentation.test.ts src/hooks/__tests__/useResponsiveLayout.test.ts --runInBand
# PASS: ORCH-0885-A gate, useResponsiveLayout, BottomNavWebDesktopPolish, wizardDesktopLayout, homeKpiPresentation
```

Fails-on-revert receipt:

```bash
git rev-parse HEAD
# 55190d19dbc13486735408e811ff1ed7e357fb4a

git worktree add --detach /tmp/orch0913-baseline HEAD
cp mingla-business/app/trip/[id]/__tests__/dashboard-parity.test.tsx /tmp/orch0913-baseline/mingla-business/app/trip/[id]/__tests__/dashboard-parity.test.tsx
cd /tmp/orch0913-baseline/mingla-business
npx jest --runTestsByPath 'app/trip/[id]/__tests__/dashboard-parity.test.tsx' --runInBand
# FAIL on baseline: ENOENT for new travelers route; pre-fix dashboard lacks the ORCH-0913 route/section structure.
```

Blocked / partial:

```bash
cd mingla-business
npx tsc --noEmit
# FAILS on unrelated baseline issues in checkout buyer files, ComposerV2, payments-native package resolution, DraftEvent test fixtures, and packages/* type resolution.
```

```bash
cd mingla-business
npx expo lint --no-cache
# FAILS on unrelated baseline lint issues: 393 total problems across account, marketing, styleguide, checkout, brand, services/tests, etc.
# Targeted eslint for touched ORCH-0913 files passes.
```

Manual / TEST-mode gates not run by implementor:

- Business iOS live-fire sim
- Business Android live-fire emu
- Business web-preview visual check
- Metro console check for absence of web `shadow*` warning

## Guards Preserved

- `mingla-business/app/event/[id]/index.tsx` untouched.
- `mingla-business/app/trip/[id]/edit.tsx` untouched.
- `/event/[id]/blasts/` and `/event/[id]/group-chat/` untouched.
- `useTrip`, `useTripOrders`, `useInstallmentsForBrandTrips`, `useTripIntakeSchemasByEvent`, `useRetryInstallment`, `useSoftDeleteTrip` signatures and return shapes unchanged.
- No database tables, migrations, edge functions, RPCs, external API calls, RLS, or brand-team predicates changed.
- Desktop-web contract files from `feedback_mingla_business_desktop_web_contracts.md` were not edited; listed desktop gates passed.

## Next Verification Recommendation

Route to Claude `mingla-tester` TEST mode for independent QA with mandatory business-iOS and business-Android live-fire simulator checks, desktop-web visual check, and confirmation that the dashboard structure matches SPEC_ORCH-0913 across the 5-tap golden path: open trip, tap Travelers, back, tap Money, back.
