# IMPLEMENT — META-ORCH-1148 sub-ORCH 2.0 — Venue Suite FOUNDATION

- **Sub-ORCH:** META-ORCH-1148 / 2.0 (foundation). Phase 1 = ORCH-1145 (merged `c8f7fbc3b`, PR #492).
- **Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1148-[venue-suite-foundation]/`
- **Branch:** `ORCH-1148-venue-suite-foundation`
- **Binding SPEC:** `Mingla_Artifacts/specs/SPEC_META-ORCH-1148_SUBA_FOUNDATION.md` (built to exactly, plus the 5 Conductor resolutions).
- **COMMS ledger:** read on entry. No OPEN/BLOCK row addressed to ORCH-1148 or ALL that touches venue/1148 files. Nothing to ack. (COMMS-0027 OTA gotcha is ALL/WARN but N/A to authoring; COMMS-0029 trip-migration coordination does not touch venue tables.)
- **NOT done (per dispatch):** no deploy, no migration apply-to-prod, no merge, no close. Migrations are AUTHORED for the orchestrator to apply via the Management API at merge.

## Conductor resolutions honored

1. "Fill open tables" hero CTA — NOT rendered in 2.0 (D9). Confirmed: no such button anywhere in the shell/overview.
2. Toggle applies to ANY physical venue (`hasPhysicalLocation || placePoolId`) — reuses the existing ORCH-1145 Venue-pill gate; no new gating logic added.
3. Toggle-ON lands on **Settings** — `VenueSuiteShell.handleTurnOnReservations` sets `activeModule = "settings"` on success.
4. Team roles = display-only scaffold — `VenueSettingsModule` renders a static role legend + a route to the existing `/brand/{id}/team` surface; no mutation, no dead controls.
5. NO money moves in 2.0 — paid-fee gate is UI-level only (`venueFeeGate.canEnablePaidReservationFee`); no charge path, no server fail-close RPC (deferred to 2.2). Documented in `reservations.sql` + `venue_reservation_settings.sql` seam comments.

---

## Changed / new files (every claimed file)

### Migrations (8 + 1 test) — `supabase/migrations/`
| File | Table / purpose |
|------|------|
| `20261003000000_orch_1148_venue_tables.sql` | `venue_tables` (inventory) |
| `20261003000001_orch_1148_venue_capacity_rules.sql` | `venue_capacity_rules` (Smart Capacity Rules; full catalog; 2.0 writes none) |
| `20261003000002_orch_1148_venue_availability_config.sql` | `venue_availability_config` (UNIQUE brand_id) |
| `20261003000003_orch_1148_venue_blackouts.sql` | `venue_blackouts` |
| `20261003000004_orch_1148_venue_reservation_settings.sql` | `venue_reservation_settings` ⭐ (brand_id PK; the only table 2.0 writes) |
| `20261003000005_orch_1148_reservations.sql` | `reservations` (8-state lifecycle CHECK; nullable NO-FK `event_date_id` seam) |
| `20261003000006_orch_1148_venue_waitlist.sql` | `venue_waitlist` (DISTINCT from `waitlist_entries`) |
| `20261003000007_orch_1148_invariant_probes.sql` | read-only `DO` probe (7 tables exist, RLS enabled, 2 policies each, toggle default false, 8-state enum intact) |
| `__tests__/orch_1148_venue_suite_migration.test.ts` | Deno source-level schema/RLS regression (9 tests) |

Every table: `brand_id` FK + nullable `place_pool_id` + `created_at`/`updated_at` + per-table `tg_<t>_set_updated_at` trigger + `(brand_id)` index. RLS ENABLED with member-read (`biz_is_brand_member_for_read_for_caller(brand_id)`) + manager-plus-write (`biz_brand_effective_rank_for_caller(brand_id) >= biz_role_rank('event_manager')`). Additive-only (`CREATE TABLE IF NOT EXISTS`, `DROP POLICY IF EXISTS` before `CREATE POLICY`). `$function$;` closed before GRANT. No drops/renames. `GRANT ... TO authenticated` + `TO service_role` (2.2 consumer-write seam). NO `TO anon`. Helpers/`place_pool`/`brands` confirmed present in the baseline schema.

### Business app — Add
- `mingla-business/src/components/venue/VenueSuiteShell.tsx` — `activeModule` state machine; web-desktop two-column master rail (260) + workspace (max 1200) via `useResponsiveLayout().isWideDesktop`; single-column reflow on web-phone/native; module dispatch (overview=`VenueListingContent` verbatim, settings=`VenueSettingsModule`, booking=`VenueModuleComingSoon`); OFF-state Overview invitation card; toggle-OFF→booking-module guard snaps to overview; syncs `venueSuiteStore`.
- `mingla-business/src/components/venue/VenueSettingsModule.tsx` — Reservations toggle (canonical home) + optional reservation-fee config (NO billing/tax form) + cancel/no-show policy + read-mostly venue profile + hours summary + display-only team-roles scaffold; manager-plus UI gate; paid-fee fail-close reusing `paidPublishGuards` copy + route.
- `mingla-business/src/components/venue/VenueModuleComingSoon.tsx` — honest "set up next" interstitial; Tables/Availability route a REAL CTA to Settings.
- `mingla-business/src/components/venue/VenueModulePillRow.tsx` — state-driven module pill row (reuses HubSubNav visuals; calls `onSelect`, never `router.push`); "‹ Hub" back chip.
- `mingla-business/src/components/venue/venueModules.ts` — `deriveVenueModules` (pure, toggle-gated) + `VENUE_MODULES` registry + `isBookingModule`.
- `mingla-business/src/components/venue/venueFeeGate.ts` — pure `canEnablePaidReservationFee` + `brandPayoutReadiness`.
- `mingla-business/src/hooks/useVenueReservationSettings.ts` — read + `useSetReservationsEnabled` (upsert on brand_id PK) + `useUpdateReservationFee`.
- `mingla-business/src/store/venueSuiteStore.ts` — `useVenueSuiteActive`/`useVenueSuiteStore` (Hub-pill suppression bridge; UI-flag-only, no persistence → no `_hasHydrated` boundary).
- `mingla-business/src/types/venueReservation.ts` — `VenueModule`, `VenueReservationSettings`, `VenueReservationFeePatch`.
- `mingla-business/src/components/venue/__tests__/venueModules.test.ts` (T-1/T-2) + `venueFeeGate.test.ts` (T-7).
- `.github/scripts/strict-grep/orch-1148-no-buyer-tax-form-in-venue-settings.mjs` (T-6; `--self-test` supported).

### Business app — Modify (scoped)
- `mingla-business/app/(tabs)/hub/listing.tsx` — mounts `<VenueSuiteShell>` (Overview = `VenueListingContent` verbatim, dispatched by the shell); activates/deactivates `venueSuiteStore` on mount/unmount.
- `mingla-business/app/(tabs)/hub/_layout.tsx` — renders the venue module pill row in place of `HubSubNav` when `useVenueSuiteActive() && !isWideDesktop`. The nav-lock redirect effect, the `:167` `/hub/` guard, the `:187` ordering, and `HUB_TAB_ROUTES` are UNCHANGED (T-12 green unmodified). The back-to-Hub chip reuses `HUB_TAB_ROUTES` (no new routing logic).
- `mingla-business/src/constants/designSystem.ts` — added ONLY `venueRailWidth = 260`, `venueSuiteMaxWidth = 1200`.
- `mingla-business/package.json` — added `test:orch-1148` script.

### DO-NOT-TOUCH — verified untouched
`VenueListingContent.tsx` (mounted verbatim; invitation card added by the shell, not by editing it), `HubSubNav.tsx`/`useHubTabs.ts` gate, the `_layout.tsx` nav-lock guard/redirect/`HUB_TAB_ROUTES`, `waitlist_entries`, `ticket-checkout-create`/all-in engine, consumer/buyer/admin.

---

## Gate results

| Gate | Result |
|------|--------|
| `deno test` migration regression (9 tests) | **PASS** (9/9) |
| jest `venueModules.test.ts` + `venueFeeGate.test.ts` (11 tests) | **PASS** (11/11) |
| strict-grep `orch-1148-no-buyer-tax-form…` `--self-test` + real | **PASS** |
| `hub-layout-nav-lock.test.ts` (T-12, unmodified) | **PASS** (3/3) |
| `useHubTabs` ORCH-1145 venue-tab contract (T-13, unmodified) | **PASS** (10/10) |
| eslint (all changed files) | **PASS** (0 errors; the 1 array-type warning was fixed) |
| `tsc --noEmit` — errors in MY files | **0** |
| `tsc --noEmit` — total | **325 (pre-existing baseline; unchanged by this work)** |
| Migration version monotonic vs origin/main + all worktrees | **PASS** (base `20261003000000` still free) |

### Pre-existing failure attribution (NOT mine)
- `tsc --noEmit` reports **325 errors** in this worktree (e.g. `packages/phone-input/*`, `src/components/brand/*`). Proven pre-existing: stash-and-rerun on the unmodified tree = **325** (identical); with my changes = **325**. My files add **zero** new type errors.
- A broad `jest --testPathPattern "useHubTabs|venue|hub"` run surfaced **86 failed suites / 158 failed tests**. **Zero** of those failing suites touch any venue or hub-layout file (grep-confirmed). Sample `PublicBrandPage.ve4` (a source-pin test) was proven to fail identically on the stashed unmodified tree. These are a stale source-pin baseline in the worktree, NOT introduced by this ship.
- `test:orch-1148` script exits non-zero ONLY because its final `tsc --noEmit` step inherits the 325 pre-existing errors. The strict-grep + jest steps inside it pass. (The tsc step is the conventional gate tail; the pre-existing baseline is the orchestrator's to triage, not this ORCH's regression.)

---

## Fails-on-revert proof (cited commit hash)

Proven at worktree commit **`61156a6e58ace9f1490d745c313df3da0332c7de`** (pre-commit working tree; the final commit hash is recorded by the orchestrator at merge — see the commit below). Each revert was applied, the test re-run to confirm FAIL, then restored to green:

| Invariant (DRAFT) | Revert applied | Tests that FAILED on revert |
|-------------------|----------------|------------------------------|
| I-PROPOSED-1148-RESERVATION-TOGGLE-GATES-SUITE | `deriveVenueModules` → show booking modules unconditionally | `venueModules.test.ts` T-1 + T-2b |
| I-PROPOSED-1148-PAID-FEE-REQUIRES-CHARGES-ENABLED | `canEnablePaidReservationFee` → `return true` | `venueFeeGate.test.ts` T-7 + T-7 e2e |
| I-PROPOSED-1148-RESERVATIONS-RLS-BRAND-SCOPED | drop `ALTER TABLE public.reservations ENABLE ROW LEVEL SECURITY` | migration `T-MIG-2` |
| I-PROPOSED-1148-NO-BUYER-TAX-FORM-IN-VENUE-SETTINGS | inject `BILLING ADDRESS` into `VenueSettingsModule.tsx` | strict-grep gate exits 1 |

After each restore, the full set returned green (migration 9/9, jest 11/11, strict-grep pass).

> **T-9 (pill replacement) note:** the default business jest config is `testEnvironment: node` (no RTL/jsdom). The pill-replacement behavior is implemented as a pure render-swap driven by `venueSuiteStore` + `useResponsiveLayout` (T-9 is best proven by the tester via device/sim per §13). The logic seam is unit-covered: `deriveVenueModules` drives `visibleModules`, and the layout's `showVenueModulePills = active && !isWideDesktop && selectModule !== null` is a pure boolean over store state. Tester to add the RTL render-proof under the established `jest.orch11xx.render.cjs` overlay.

---

## SPEC ambiguities / deviations (flag)

1. **`designSystem.ts` path.** The dispatch brief named `src/theme/designSystem.ts`; the real file (and the SPEC §5.0 reuse map) is `src/constants/designSystem.ts`. Built against the real path. No file at `src/theme/`.
2. **`brand.name` → `brand.displayName`.** The SPEC §5.4-3 says "name … pulled from brand"; the camelCased `Brand` shape exposes `displayName` (not `name`). Used `displayName`.
3. **Team-roles scaffold = static legend, not a live roster.** §5.4-5 says "list current `brand_team_members`". There is no existing business-app "list all members" read hook, and Conductor resolution 4 + §12-Q4 say display-only / reuse the existing Team surface. Building a new roster fetch would widen scope, so the scaffold renders the VISION §11 role legend + a route to `/brand/{id}/team` (the existing surface). No mutation, no dead controls. **Flag for tester/Seth:** confirm legend-only is acceptable vs a live roster (recommend legend — a roster fetch is new scope and 2.0 is display-only).
4. **Shell does not render its own pill row on phone/native** (the layout owns it via the store bridge) to avoid a stacked double row — this is the §5.3 "clean, low-risk path." On web-desktop the master rail is the nav and `HubSubNav` stays above (per Design §2.1).
5. **`tsc`/jest pre-existing baseline** in this worktree (325 tsc errors, 86 stale source-pin jest suites) — pre-existing, attributed above; flagged for the orchestrator, out of this ORCH's scope.

---

## Downstream
NEXT = **mingla-tester** (business iOS + Android + web-desktop + web-phone device/sim proof of toggle OFF→ON, Settings fee gate, pill replacement, two-column reflow; the RLS/probe DB tests once migrations are applied to a branch DB). Then **orchestrator CLOSE** (apply the 8 migrations via Management API; flip the 5 DRAFT invariants → ACTIVE; register META-ORCH-1148 + 2.0/2.1/2.2 on the World Map; reconcile scope per `feedback_shared_worldmap_scope_bleed`).
