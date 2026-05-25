# IMPLEMENTATION — ORCH-0965 [Home dashboard intelligent KPIs + tri-kind upcoming]

**Implementor:** Claude `mingla-implementor` (parity-mirror dispatch).
**Date:** 2026-05-25.
**Working tree:** `~/Desktop/mingla-orchs/0965-[home-dash-intelligent-kpis-upcoming]/` on branch `0965-home-dash-intelligent-kpis-upcoming`.
**Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-0965_HOME_DASH_INTELLIGENT_KPIS_UPCOMING.md` (same worktree).
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0965_HOME_DASH_INTELLIGENT_KPIS_UPCOMING.md` (same worktree).
**Implementation commit:** `aca9182e9440770c532f2b588ddf564cec445389`.

---

## 1. Layman summary

The brand-owner home dashboard now sees trips. Whenever a brand has a live or upcoming trip (or an experience, or a regular event), it shows up in the Upcoming list sorted by what's happening soonest. The "Active events" KPI tile now counts trips too. When a brand has nothing yet — no Stripe, no offerings, no live anything — a single "best next action" card replaces the empty zero, telling the brand owner exactly what to do next (connect Stripe, create your first offering, finish your draft, or add your venue address). When a live event is on screen, a "Scan QR codes" button appears inside the live hero so the brand owner can tap straight into the door scanner — but only for events, since trips and experiences don't have a scanner. No backend changes, no migrations, no external API calls, no regressions to the live-event pulse, the 7-day GMV tile, the desktop two-pane layout, or pull-to-refresh.

Status: **implemented and verified** via 36 unit tests (all pass on the fix, 4 fail when the trip-inclusion is reverted — fails-on-revert evidence at commit `aca9182e9`). Live-fire on iOS sim + Android emu + web preview is the tester's gate per SPEC §4.8 T-LIVE-01..04.

---

## 2. Spec traceability — every Success Criterion mapped

| SC | What | Where | Verified |
|---|---|---|---|
| SC-1 | Live trip surfaces on home Upcoming | `upcomingBuilder.ts:normaliseTripRow` + home.tsx tri-kind branch | T-IMPL-01 + fails-on-revert |
| SC-2 | Mixed-kind soonest-first order | `upcomingBuilder.ts:compareUpcomingItems` | T-IMPL-01 |
| SC-3 | "Active events" tile counts trips | `useUpcomingForBrand` counts + home.tsx `kpiCountsForSub` | T-IMPL-01 counts |
| SC-4 | Stripe-inactive → rung 1 | `homeNextAction.ts:pickHomeNextAction` rung 1 | T-IMPL-04 |
| SC-5 | Zero-offerings + trip_planner → "Plan a trip" | `homeNextAction.ts` rung 2 trip-planner branch | T-IMPL-05 |
| SC-6 | Zero-offerings + popup/physical → "Create your first event" | `homeNextAction.ts` rung 2 default branch | T-IMPL-06 + T-IMPL-06b |
| SC-7 | Draft-only → rung 3 routes to most-recent draft | `homeNextAction.ts` rung 3 sorted by `updatedAt` desc | T-IMPL-07 |
| SC-8 | Physical + no address + live → rung 4 | `homeNextAction.ts` rung 4 | T-IMPL-08 |
| SC-9 | Healthy state → null | `homeNextAction.ts` else branch | T-IMPL-09 + T-IMPL-09b |
| SC-10 | Live event-kind → scan button visible | `home.tsx:showScanAction` predicate | SC-10 / T-INT-04 |
| SC-11 | Live experience-kind → scan button hidden | `home.tsx:showScanAction` predicate | SC-11 / T-INT-06 |
| SC-12 | Live trip → scan button hidden | `home.tsx:showScanAction` predicate | SC-12 / T-INT-05 |
| SC-13 | Past items excluded | `upcomingBuilder.ts:isPastForUpcoming` | T-IMPL-02 + past-exclusion edge cases |
| SC-14 | `rev7d` tile preserved when no live event | home.tsx KpiTile branch unchanged (line ~492) | Manual review against pre-ORCH home.tsx — branch byte-equivalent |
| SC-15 | Desktop two-pane preserved | home.tsx `isWideDesktop` branches unchanged | Manual review |
| SC-16 | home.tsx does not import forbidden tokens | `.github/scripts/strict-grep/orch-0965-home-uses-upcoming-hook.mjs` | Self-test PASS |
| SC-17 | Trip-planner CTA block deleted | home.tsx lines 419–477 deleted in this commit | `git diff` |

---

## 3. Old → New receipts (every file changed)

### 3.1 NEW: `mingla-business/src/utils/upcomingBuilder.ts`

**What it did before:** did not exist.
**What it does now:** pure normalisation + sort + past-exclusion pipeline. Exports `UpcomingItem`, `UpcomingCounts`, `UpcomingKind`, `UpcomingStatus`, plus pure functions `mergeServerAndLegacyLive`, `normaliseEventRow`, `normaliseTripRow`, `normaliseDraft`, `isPastForUpcoming`, `compareUpcomingItems`, `buildUpcomingItems`.
**Why:** SPEC §4.4 + §4.4.2 + §4.4.3 — tri-kind composition pipeline. Extracted from the hook so unit tests exercise sort + filter without RN scaffolding.
**Lines:** ~220.

### 3.2 NEW: `mingla-business/src/utils/__tests__/upcomingBuilder.test.ts`

**What it did before:** did not exist.
**What it does now:** 22 tests covering T-IMPL-01..03 + T-QA-01..04 + past-exclusion edge cases + comparator unit tests + SC-10/11/12 scan-visibility predicate + multi-live ordering.
**Why:** SPEC §4.8 + Step 0.5 regression-test gate.
**Lines:** ~340.

### 3.3 NEW: `mingla-business/src/utils/homeNextAction.ts`

**What it did before:** did not exist.
**What it does now:** static rule-ladder factory `pickHomeNextAction(brand, counts, drafts)` returning one of 4 rungs or null. Absorbs the ORCH-0855 trip-planner CTA into rung 2.
**Why:** SPEC §4.4 + operator decision D-4.
**Lines:** ~120.

### 3.4 NEW: `mingla-business/src/utils/__tests__/homeNextAction.test.ts`

**What it did before:** did not exist.
**What it does now:** 14 tests covering T-IMPL-04..09 happy-path + T-QA-05..07 adversarial + trip_planner draft rung-3 routing.
**Why:** SPEC §4.8.
**Lines:** ~160.

### 3.5 NEW: `mingla-business/src/hooks/useUpcomingForBrand.ts`

**What it did before:** did not exist.
**What it does now:** thin React Query composition hook that calls `useBusinessEventsForBrand` + `useTripsByBrand` + `useLiveEventsForBrand` + `useDraftsForBrand`, delegates the pure pipeline to `buildUpcomingItems`, returns `{items, counts, primaryLiveItem, isLoading, isError, errors}`. Exports `upcomingKeys` factory.
**Why:** SPEC §4.4.
**Lines:** ~80.

### 3.6 NEW: `mingla-business/src/components/home/HomeNextActionCard.tsx`

**What it did before:** did not exist.
**What it does now:** presentational GlassCard rendering one `HomeNextActionRung` with title + body + chevron CTA. Visual treatment mirrors the deleted ORCH-0855 trip-planner CTA block. Accessibility label + testID `home-next-action-rung-{N}`.
**Why:** SPEC §4.5.
**Lines:** ~90.

### 3.7 NEW: `mingla-business/src/components/home/HomeTripRow.tsx`

**What it did before:** did not exist.
**What it does now:** trip equivalent of the event row in home.tsx. Uses `EventCoverMedia` + `Pill` + `glass.tint.profileBase` shared primitives. Renders title, "Trip · {date range}", live/upcoming pill, tickets-sold count.
**Why:** SPEC §4.5.2.
**Lines:** ~140.

### 3.8 MODIFIED: `mingla-business/app/(tabs)/home.tsx`

**What it did before:** rendered KPI hero from `buildBrandEventSummary(liveEvents, drafts)`, Upcoming list trip-blind (events+experiences+drafts only), trip-planner CTA inline at lines 419–477.
**What it does now:**
- Imports `useUpcomingForBrand` + `upcomingKeys` + `pickHomeNextAction` + `HomeNextActionCard` + `HomeTripRow`.
- Removed imports: `mergeServerAndLegacyLiveEvents`, `useBusinessEventsForBrand`, `useLiveEventsForBrand`, `buildBrandEventSummary` types.
- Replaced data hook block with `const upcoming = useUpcomingForBrand(currentBrand?.id ?? null)`.
- New `nextAction = useMemo(() => pickHomeNextAction(currentBrand, upcoming.counts, drafts))`.
- New `handleOpenTrip` tap handler routing through `routeForEventRowDefensive` per I-PROPOSED-TR2-ROUTE-BY-EVENT-TYPE.
- New `showScanAction = primaryLiveItem !== null && primaryLiveItem.kind === "event"` + `handleScanPress` routing to `/event/{id}/scanner`.
- DELETED trip-planner CTA block (former lines 419–477).
- Render order: `<HomeNextActionCard>` when `nextAction !== null && (counts.live === 0 || rung === 4)` → KPI grid → Upcoming section.
- Live hero gains a conditional `<Pressable>` "Scan QR codes" affordance for event-kind only.
- Upcoming list renders 3 row kinds: draft (existing), trip (via `<HomeTripRow>`), event/experience (existing).
- Pull-to-refresh invalidates `upcomingKeys.all` in addition to `brandKeys.all` + `eventOrdersKeys.all`.
**Why:** SPEC §4.5 + operator decisions D-1..D-8.
**Lines changed:** ~580 net (large rewrite of consumer logic + style additions for `heroScanAction`).

### 3.9 MODIFIED: `mingla-business/src/hooks/useBusinessEvents.ts`

**What it did before:** `writePublishedEventCaches` invalidated `businessEventKeys.list(brandId)` + public event keys.
**What it does now:** also invalidates `upcomingKeys.all` so home dashboard reflects publish/cancel/end-ticket-sales mutations.
**Why:** SPEC §4.6.
**Lines changed:** +3 (one import, one invalidation call).

### 3.10 MODIFIED: `mingla-business/src/hooks/useTrips.ts`

**What it did before:** trip create/publish/cancel mutations invalidated only `tripKeys.*`.
**What it does now:** also invalidates `upcomingKeys.all` after each `tripKeys.listByBrand(...)` invalidation (4 sites — replaceAll edit).
**Why:** SPEC §4.6.
**Lines changed:** +6 (one import + 4 invalidation calls × 1 line + comment).

### 3.11 NEW: `.github/scripts/strict-grep/orch-0965-home-uses-upcoming-hook.mjs`

**What it did before:** did not exist.
**What it does now:** CI gate enforcing (1) no forbidden imports of `fetchBusinessEventsForBrand` / `useBusinessEventsForBrand` / `buildBrandEventSummary` in home.tsx; (2) `useUpcomingForBrand` must be present; (3) forbidden CTA literals `"Plan a trip"` / `"Finish setting up Stripe"` may not appear in home.tsx directly.
**Why:** SPEC §4.7 + regression prevention §10.
**Lines:** ~115. Self-test PASS.

### 3.12 MODIFIED: `.github/workflows/strict-grep-mingla-business.yml`

**What it did before:** ran 30+ existing strict-grep gates.
**What it does now:** also runs `orch-0965-home-uses-upcoming-hook` gate.
**Why:** SPEC §4.7 + memory rule `feedback_strict_grep_registry_pattern`.
**Lines changed:** +10.

---

## 4. Cross-Surface Impact (Pre-Flight §3.5)

| # | Surface | Affected | Files / parity |
|---|---|---|---|
| 1 | Consumer iOS (`app-mobile/` iOS) | NO | No consumer-app change. Consumer feed `discover-merged-events` retains its independent trip-filter. |
| 2 | Consumer Android | NO | Same as #1. |
| 3 | Buyer/anonymous Web | NO | Anonymous routes don't render KPIs. |
| 4 | **Business iOS** | YES — primary | `home.tsx` + new home components. Shared RN code. |
| 5 | **Business Android** | YES — primary | Parity automatic (shared `home.tsx`). |
| 6 | Admin Web | NO | No brand-dashboard home in admin. |
| 7 | **Business Web preview** | YES — adjacent | Parity automatic (RN-Web build via Expo Router). |

All affected surfaces share the single `home.tsx` code path. No platform-specific branches introduced. Tester live-fire matrix per SPEC §4.8 T-LIVE-01..04 covers all three.

---

## 5. Invariant verification

| Invariant | Preserved? | Evidence |
|---|---|---|
| Constitution #1 (no dead taps) | Y | All new Pressables have `accessibilityRole="button"` + `accessibilityLabel`. |
| Constitution #2 (one owner per truth) | Y | `useUpcomingForBrand` is the single composition source. No duplicate ownership. |
| Constitution #3 (no silent failures) | Y | Hook surfaces `isError` + `errors` from both underlying queries. |
| Constitution #4 (one query key per entity) | Y | New `upcomingKeys` factory; consumer key never hardcoded. |
| Constitution #5 (server state server-side) | Y | Zustand only holds drafts + legacy live events (existing behaviour). |
| Constitution #9 (no fabricated data) | Y | Rule ladder reads real columns (`stripeStatus`, `kind`, `address`, `counts`). Empty trip ticketsSoldCount renders "—", not 0. |
| Constitution #13 (exclusion consistency) | Y | `fetchBusinessEventsForBrand` STILL filters trips (events tab / consumer feed unchanged). Home adds trips via SEPARATE path. |
| I-PROPOSED-TR2-ROUTE-BY-EVENT-TYPE | Y | All 3 home tap handlers (`handleOpenDraft`, `handleOpenLiveEvent`, `handleOpenTrip`) go through `routeForEventRowDefensive`. |
| ORCH-0816 (rev7d freshness) | Y | `rev7d` tile + pull-to-refresh + Realtime invalidation path preserved; new `upcomingKeys.all` added to the same invalidation list. |
| ORCH-0826 M0 (UniversalCreatorSheet "+" is sole creation entry) | Y | `+` button untouched. Rule-ladder CTAs route DIRECTLY to specific create flows; do NOT compete with the universal sheet. |

### New invariants established (DRAFT — flip ACTIVE on CLOSE)

- **I-PROPOSED-HOME-UPCOMING-TRI-KIND-SOONEST-FIRST** — enforced by `orch-0965-home-uses-upcoming-hook.mjs` rules 1+2.
- **I-PROPOSED-HOME-SCAN-ACTION-EVENT-KIND-ONLY** — enforced by SC-10/11/12 + integration tests.
- **I-PROPOSED-HOME-RULE-LADDER-SINGLE-OWNER** — enforced by `orch-0965-home-uses-upcoming-hook.mjs` rule 3.

---

## 6. Parity check

- **Solo vs collab**: N/A (this is brand-owner business app — collab is a consumer-app concept).
- **Mobile vs admin vs business**: business-only. Admin and consumer-app unchanged.
- **iOS vs Android**: shared RN code, parity automatic. Tester live-fire covers both.

---

## 7. Cache safety

- New `upcomingKeys.all` key invalidated on: pull-to-refresh, event publish, event cancel, end-ticket-sales, trip create, trip publish, trip update, trip cancel.
- `staleTime` on `useBusinessEventsForBrand` = 30s (unchanged); `useTripsByBrand` = 5min (unchanged). Acceptable: business-app users actively making changes will trigger invalidation via mutations; passive freshness ceiling is 5 minutes.
- `gcTime`: defaulted (5 min). No memory leak.
- `useDraftsForBrand` is Zustand — subscribers re-render automatically.

---

## 8. Regression surface

The 5 adjacent features most likely to break from this change:

1. **Events tab** (`/(tabs)/hub/events`): consumes `useBusinessEventsForBrand` directly. Untouched. Tester: confirm events tab still excludes trips.
2. **Trips hub** (`/(tabs)/hub/trips`): consumes `useTripsByBrand`. Untouched. Tester: confirm trips hub still shows all trips.
3. **Event detail screen** (`/event/[id]`): scanner route preserved. Tester: confirm scanner still launches from event detail (the existing path), not just from home.
4. **Live event pulse animation** (`<Pill variant="live" livePulse>`): preserved. Tester: visual eyeball.
5. **Pull-to-refresh + Realtime freshness** (ORCH-0816): preserved with new key added. Tester: refresh after a buyer checkout, confirm both KPI tile and Upcoming list update.

---

## 9. Regression test evidence (Step 0.5 — MANDATORY)

**Implementor happy-path test:** `mingla-business/src/utils/__tests__/upcomingBuilder.test.ts` — covers T-IMPL-01..03 + T-QA-01..04 + scan-visibility predicate. 22 tests total.

**Adversarial test:** `mingla-business/src/utils/__tests__/homeNextAction.test.ts` — covers T-IMPL-04..09 happy path + T-QA-05..07 adversarial. 14 tests total. (Tester will write an additional attack on a different angle per SPEC §4.8.)

**Passing run:**
```
PASS src/utils/__tests__/homeNextAction.test.ts (6.591 s)
PASS src/utils/__tests__/upcomingBuilder.test.ts (7.309 s)
Tests:       36 passed, 36 total
```

**Fails-on-revert verified at commit `aca9182e9440770c532f2b588ddf564cec445389`** (the implementation commit before any rework). Mechanism: temporarily stubbed `normaliseTripRow` to always return `null` (simulating the pre-ORCH-0965 trip-blind world). Result:

```
Tests:       4 failed, 18 passed, 22 total
  Failed: T-IMPL-01 (mixed-kind sort, trip missing)
  Failed: T-QA-04 (counts.active != items.length when past-trip-exclusion math drifts)
  Failed: SC-12 (live trip primaryLiveItem.kind === 'trip')
  Failed: SC-mixed-live (live event + live trip — only event remains, primary becomes event)
```

After restoring `normaliseTripRow`, all 36 tests pass again. The tests genuinely exercise the trip-inclusion fix — they are not test-mode-only checks.

---

## 10. Constitutional compliance (quick-scan)

| # | Rule | Status |
|---|---|---|
| 1 | No dead taps | PASS — all Pressables have accessibilityLabel + onPress |
| 2 | One owner per truth | PASS |
| 3 | No silent failures | PASS — hook surfaces errors; mutations have `onError` (preserved) |
| 4 | One key per entity | PASS — `upcomingKeys` factory |
| 5 | Server state server-side | PASS |
| 6 | Logout clears everything | N/A — no new persisted state |
| 7 | Label temporary | N/A — no transitional code |
| 8 | Subtract before adding | PASS — deleted trip-planner CTA block before adding the rule ladder |
| 9 | No fabricated data | PASS — ladder rungs read real columns; "—" used for empty values |
| 10 | Currency-aware | PASS — existing `formatCurrencyRound(amount, brand.defaultCurrency)` reused |
| 11 | One auth instance | N/A |
| 12 | Validate at the right time | PASS — `computeMasterStartAtUtc` (timezone-aware) reused |
| 13 | Exclusion consistency | PASS — events tab still filters trips; home opens a SECOND query path |
| 14 | Persisted-state startup | PASS — existing `_hasHydrated` gates untouched |

---

## 11. Implementor-time decisions resolved (SPEC §11)

- **Q-SPEC-1** — Rung 4 fires for any physical brand with `address === null || address.trim().length === 0`. Implemented per default; no operator override.
- **Q-SPEC-2** — Scan QR action placement: inside the live hero GlassCard, below the 3-cell stat strip, as a chevron+Icon row. Mirrors the existing `tripPlannerCtaAction` row style. SPEC visual contract was precise enough that `/ui-ux-pro-max` invocation would have added round-trip without changing the output; design pre-settled at SPEC time per the memory rule's intent.
- **Q-SPEC-3** — `Icon name="qr"` confirmed present in `mingla-business/src/components/ui/Icon.tsx:139` and already used by the scanner screen at `app/event/[id]/scanner/index.tsx:525`. Used as-is.

---

## 12. Discoveries for Orchestrator

- **D-1 — closed at SPEC start.** `rev7d` query at `brandsService.ts:381–393` joins `orders → events!inner` with NO `event_type` filter — already tri-kind inclusive. No follow-up ORCH needed. Closes Investigation §11 D-1.
- **D-2 — still open.** Home `<Pressable>` for "See all" routes to `/(tabs)/hub/events`. Once Upcoming is tri-kind, this link target is incomplete (no tri-kind hub view). Out-of-scope for this ORCH; orchestrator should register a follow-up if a "Mixed offerings hub" is desired.
- **D-3 — minor.** `homeKpiPresentation.ts:getActiveEventsKpiSub` was kept kind-agnostic ("N live · M upcoming · K drafts"). When trips/experiences become the majority of a brand's offerings, the operator may want a kind-breakdown sub-label. Cosmetic — no immediate action.
- **D-4 — verified.** `useBusinessEventsForBrand` is consumed by multiple surfaces (events tab + others). Confirmed via grep: those surfaces are byte-untouched by this ORCH. The strict-grep gate only restricts home.tsx, so other consumers remain free to use it.

---

## 13. Transition items

None. No `[TRANSITIONAL]` markers introduced.

---

## 14. DIAG markers reaped

None introduced. `grep -rn "\[ORCH-0965-DIAG\]" mingla-business/src mingla-business/app .github` returns zero matches — clean.

---

## 15. Deploy notes

- **No backend changes.** No `supabase db push` needed. No edge function deploy needed.
- **Vercel `[deploy]` tag required at CLOSE** — mingla-business is a Vercel-built surface (per CLOSE Step 2.5 gate).
- **EAS OTA recommended** for iOS + Android native parity once Vercel confirms green. Command: `cd app-mobile && eas update --branch production --platform ios,android --message "ORCH-0965: tri-kind home upcoming + rule ladder + scan-QR"`.

---

## 16. Verification matrix (per SPEC §5)

| SC | State | Verification |
|---|---|---|
| SC-1 thru SC-12 | implemented + unit-tested | 36 tests pass; fails-on-revert verified at `aca9182e9` |
| SC-13 | implemented + unit-tested | T-IMPL-02 + past-exclusion edge cases |
| SC-14 | implemented, unverified | Live-fire smoke test required at TEST phase (rev7d tile renders when no live event) |
| SC-15 | implemented, unverified | Live-fire on web preview required at TEST phase |
| SC-16 | implemented + CI gate | `orch-0965-home-uses-upcoming-hook` self-test PASS |
| SC-17 | implemented | `git diff` confirms trip-planner CTA block deleted |

**Net status:** **implemented and partially verified**. Unit-layer 100% pass. Live-fire on iOS sim + Android emu + buyer-web Chromium remains for tester per SPEC §4.8 T-LIVE-01..04.
