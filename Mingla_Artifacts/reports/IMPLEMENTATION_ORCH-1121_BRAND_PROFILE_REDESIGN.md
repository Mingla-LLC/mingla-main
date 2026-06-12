# IMPLEMENTATION — ORCH-1121 [Business brand-profile redesign: cover/avatar/about hero + wire Recent Events to real data]

- **Status:** implemented, partially verified (jest/tsc/eslint green; device runtime proof is the tester's phase — source-only caps at "suspected" per the SPEC).
- **Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1121-[brand-profile-redesign]/` on branch `ORCH-1121-brand-profile-redesign` (rebased on origin/main).
- **Commit:** `6167c9b0a`.
- **Comms ledger:** read on entry. COMMS-0024 (WARN, ALL) confirms ORCH-1121 is a legitimately-held number for this lineage (no renumber) — factored, no action. COMMS-0021 (WARN) — preserved the provider-neutral "Payments & Bank" payout copy/logic verbatim (SECTIONS B/C/D untouched). No BLOCK+OPEN entry addressed to implementor / ORCH-1121 / ALL.

---

## 1. Summary

The business brand-profile screen (`mingla-business`, owner's OWN `/brand/{id}`) had two defects in one file. Both are fixed:

- **Issue A (cropped cover hero):** the cover was hard-cropped into a fixed 140px band. It now renders as a full-bleed 16:9 cover via `EventCoverMedia` (image/GIF/**video**, motion-gated) with a required bottom scrim, a 96px page-color ring avatar half-overlapping the seam, centered name/tagline/location, an About-us block with read-more, and centered social chips with hitSlop. The 3-state media→hue fallback + `coverMediaFailed` flip is preserved.
- **Issue B (lying Recent Events — Constitution #9):** SECTION E was a 100%-hardcoded "Create your first event" empty card with zero data wiring. It now derives from the live `useBusinessEventsForBrand(brand.id)` query: up to 5 most-recent published+past events as `OfferingListCard` rows (3-dot hidden, tap → detail, ENDED pill for past), a "See all" link only when >5, and four truthful states (loading / error-with-retry / populated / genuine-empty). The empty card shows ONLY on a settled, non-error, zero-length result.

No backend, migration, edge, RLS, or schema change. `PublicBrandPage.tsx` untouched (divergence accepted, Seth).

---

## 2. SPEC success-criteria coverage

| SC | Criterion | Status | Evidence (commit `6167c9b0a`) |
|---|---|---|---|
| SC-1 | Hero un-cropped 16:9 (clamp 176–240), avatar half-overlaps seam | ✓ source; UNVERIFIED runtime | `heroCover` height = `COVER_H = Math.min(240, Math.max(176, Math.round((coverWidth*9)/16)))`; `heroAvatarRing` w/h 96 + `marginTop:-48`. Device proof = tester. |
| SC-2 | Hero composition order; no placeholder when data absent | ✓ | Name → tagline (guarded) → location (guarded on `brand.address`) → About (or dashed empty-bio CTA) → centered chips. |
| SC-3 | 3-state fallback preserved; video animates (motion-gated) | ✓ | `EventCoverMedia` state 1; `onMediaError` → `coverMediaFailed` flip → hue `LinearGradient`; `autoplay/playbackActive={!reduceMotion}`. |
| SC-4 | Events populate ≤5 most-recent; past → ENDED pill | ✓ | `recentEvents` map→sort(date DESC, nulls last)→`slice(0,5)`; `OfferingListCard` + `liveEventToOfferingModel`; `deriveCardStatus` (cancelled→past→ENDED). |
| SC-5 | Empty card only at settled zero; CTA → `/event/create` | ✓ | `eventsSettledEmpty = !eventsLoading && !eventsError && brandEvents.length === 0`; CTA `handleCreateEvent` → `onCreateEvent` (live). |
| SC-6 | Loading ≠ empty | ✓ | Final fallthrough renders skeleton rows, never the empty card mid-load. |
| SC-7 | Error surfaced (retry), never silent/lie | ✓ | `eventsError` branch → "Couldn't load your events" + "Tap to retry" → `refetchEvents()`. |
| SC-8 | Row tap navigates via `routeForEventRowDefensive` | ✓ | `onOpen → onOpenEvent(id, event_type, status)` → route file `routeForEventRowDefensive`. |
| SC-9 | "See all" only when `totalEventCount > 5` → Hub events | ✓ | Header `totalEventCount > 5 ? <Pressable onPress={onSeeAllEvents}>`; route `/(tabs)/hub/events`. |
| SC-10 | No 3-dot on rows | ✓ | `onManageOpen` omitted from `OfferingListCard` (hides trigger — verified `OfferingListCard.tsx` L165). |
| SC-11 | No regression to B/C/D/F (incl. COMMS-0021 copy) | ✓ | SECTIONS B/C/D/F byte-unchanged; "Payments & Bank" + `isBrandPayoutReady` preserved. Test pins this. |
| SC-12 | Android opaque glass + clip + no shadow under rounded fill | ✓ source; UNVERIFIED device | New surfaces reuse opaque-Android `GlassCard`/`OfferingListCard`; skeleton uses `Platform.select` opaque `rgba(20,22,26,0.92)` + `overflow:'hidden'`, no elevation. Device = tester. |
| SC-13 | a11y: chip/See-all/Read-more hitSlop; reading order | ✓ source | Chips `hitSlop={{6,6,6,6}}`; See-all/Read-more `hitSlop={8}`; verified badge OMITTED (no `Brand.verified` field — SPEC OQ a). |

Per-surface (manual parity): SC-1/SC-12 split iOS/Android — both render from the same shared RN source; the only manual delta is the opaque-Android glass (handled via `Platform.select` + reused opaque components). Runtime proof on Business iOS AND Android is the tester's phase.

---

## 3. Files changed (+837 / −97; 5 files)

| File | Δ | What |
|---|---|---|
| `mingla-business/src/components/brand/BrandProfileView.tsx` | +~417/−97 | SECTION A hero rewrite (Direction 1) + SECTION E data wiring + top-level hooks + styles + comment cleanup. |
| `mingla-business/src/components/offering/offeringCardModels.ts` | +47 | Added pure `liveEventToOfferingModel(event, status)`. |
| `mingla-business/app/brand/[id]/index.tsx` | +28 | Added `onOpenEvent` (→ `routeForEventRowDefensive`) + `onSeeAllEvents` (→ Hub) handlers; passed both into `<BrandProfileView>`. |
| `mingla-business/src/components/offering/__tests__/liveEventToOfferingModel.orch_1121.test.ts` | +95 (new) | T-10 behavioral util test (5 cases). |
| `mingla-business/src/components/brand/__tests__/BrandProfileView.orch_1121.test.tsx` | +250 (new) | T-1 + the other SPEC cases as source-structure assertions (22 cases). |

---

## 4. Data-model changes applied

None. No migration, no table/column/constraint/index/RLS change. The data source (`business_management_events_view` via `useBusinessEventsForBrand`) already exists and is consumed as-is.

## 5. Edge functions touched

None.

---

## 6. Regression tests added

**`fails-on-revert verified at 6167c9b0a`** (the fix commit; revert done by true LINE DELETION of SECTION E back to the hardcoded unconditional empty card).

- **Happy-path / T-10 (util, behavioral):** `mingla-business/src/components/offering/__tests__/liveEventToOfferingModel.orch_1121.test.ts` — 5/5 PASS. Real mapper assertions (id/title/status, null metric/capacity/revenue, cover passthrough, subline date·venue vs date-only, unknown-type → null).
- **T-1 + SPEC cases (component + route, source-structure):** `mingla-business/src/components/brand/__tests__/BrandProfileView.orch_1121.test.tsx` — 22/22 PASS. Pins: top-level brand-scoped hook ordering, populated-rows mapping (3 events → 3 rows), the gone-lying-empty gate, settled-empty derivation, loading≠empty, error+retry, See-all gating, 3-dot hidden, row-tap routing, hero (16:9/scrim/ring/location/About/no-verified/centered-chips/comment-cleanup), B/C/D preservation, and route-file helper wiring.

**Fails-on-revert proof (both directions):**
- AFTER deleting SECTION E's live-query branch (restoring the original hardcoded empty `<GlassCard>`): `Tests: 6 failed, 16 passed` — the 6 load-bearing T-1 assertions (populated rows, lying-empty-gone gate, loading≠empty, error branch, See-all gating, row-tap routing) FAIL.
- AFTER restoring the fix (`git checkout --`): `Tests: 22 passed, 22 total`.

**Harness note (spec-vs-environment resolution):** `mingla-business` runs Jest in a **node** environment with `ts-jest` and **no** `react-test-renderer` / `@testing-library/react-native` (verified `jest.config.cjs` + the established `StripeBlockedCard.test.tsx` / `EventListCard_defensiveFilter.test.tsx` precedent — both are source-assertion tests because RN components cannot transform here). The SPEC's literal "render BrandProfileView → assert 3 rows" cannot execute in this harness. T-1 is therefore implemented as a **source-structure** assertion that satisfies the SPEC's intent and the fails-on-revert contract exactly: the test FAILS when SECTION E reverts to the unconditional empty card and PASSES when the live-query branch is restored (both demonstrated above). The pure mapper (T-10) IS tested behaviorally (it has no RN deps). This is documented under §11 spec ambiguities.

Append-only respected: both test files are git-status `A` (added); no existing test modified or deleted.

---

## 7. Old → New receipts

### BrandProfileView.tsx — SECTION A (hero)
- **Before:** fixed `heroCoverBand` `height:140` + `overflow:'hidden'` + `cover` fit; raw `ExpoImage`(Android)/`RNImage`(iOS/web) with the ORCH-0805-WEB width/height hotfix; 84×84 `Avatar` yanked `marginTop:-42`; name/tagline/bio left in a flat block; social chips left-aligned, no hitSlop; stale "mirrors PublicBrandPage.tsx:259-346" comments.
- **Now:** full-bleed 16:9 `heroCover` (height `COVER_H` clamp 176–240, top corners `radius.xl`) rendering `EventCoverMedia` (per-platform element + motion-gated GIF/video, fixing D-1) with a required bottom scrim (`LinearGradient` 0→0.55); 96px `heroAvatarRing` in `canvas.profile` (`marginTop:-48`, no Avatar fork); centered `heroNameRow`; guarded tagline; new guarded `heroLocationRow` (`brand.address`, `location` icon — resolves D-2); `heroDivider`; About-us eyebrow + body (`numberOfLines` 4 collapsed) + read-more toggle (long bios via `LayoutAnimation`, motion-gated); centered chips with `hitSlop`. Stale comments removed (D-3).
- **Why:** SC-1/2/3/13; investigation F-1 + D-1/D-2/D-3.
- **Lines:** ~+200/−60.

### BrandProfileView.tsx — SECTION E (Recent Events)
- **Before:** an unconditional hardcoded "No events yet / Events you create will show here / Create your first event" `<GlassCard>` — no query, no list, no conditional (Constitution #9 violation).
- **Now:** top-level `useBusinessEventsForBrand(brand?.id ?? null)` + `recentEvents` memo (map→`deriveCardStatus`→sort date DESC nulls-last→slice 5) + `totalEventCount`. Four truthful branches: error (retry → `refetchEvents`), populated (`OfferingListCard` rows, 3-dot hidden, tap → `onOpenEvent`), settled-empty (the existing card verbatim, gated), loading (skeleton, never the empty card). "See all" only when `>5`.
- **Why:** SC-4..SC-10; Constitution #9/#3/#1; investigation F-2.
- **Lines:** ~+85/−18.

### BrandProfileView.tsx — hooks/imports/styles
- Added top-level `useWindowDimensions`, `useReducedMotion`, `aboutExpanded` state, the events query, and the `recentEvents`/`totalEventCount` memo — all ABOVE the L421/L440 early returns (ORCH-0710). New imports: `LinearGradient`, `useReducedMotion`, `canvas`, `LiveEvent` type, `useBusinessEventsForBrand`, `deriveCardStatus`, `EventCoverMedia`, `OfferingListCard`, `liveEventToOfferingModel`, `LayoutAnimation`, `useWindowDimensions`. Removed `ExpoImage`/`RNImage` imports (ECM owns the element). New style keys per SPEC §7. `Platform` retained (skeleton opaque-Android fill).

### offeringCardModels.ts
- **Before:** `tripToOfferingModel` + `experienceToOfferingModel` only.
- **Now:** added pure `liveEventToOfferingModel(event, status)` (its canonical home), reusing `formatDraftDateLine` + `normalizeCoverType`; metric/capacity/revenue null (no per-row orders hook on a glance surface).
- **Why:** SPEC change #1 / B.1 / B.5.
- **Lines:** +47.

### app/brand/[id]/index.tsx
- **Before:** wired `onCreateEvent` + the rest; no row-open / see-all handlers.
- **Now:** `handleOpenEvent(id, eventType?, status?)` → `routeForEventRowDefensive({id, eventType, status})` → `router.push`; `handleSeeAllEvents` → `router.push("/(tabs)/hub/events")`; both passed into `<BrandProfileView>`. Import `routeForEventRowDefensive`.
- **Why:** SPEC change #2 / §4.C; SC-8/9; route-by-event-type invariant.
- **Lines:** +28.

---

## 8. Cross-surface impact

| Surface | Affected | Note |
|---|---|---|
| Consumer iOS | No | Different app. |
| Consumer Android | No | Different app. |
| Buyer/anon Web | No | `/b/{slug}` = `PublicBrandPage`, explicitly excluded. |
| **Business iOS** | **Yes** | Redesigned hero + live Recent Events. Shared RN source. |
| **Business Android** | **Yes** | Same; opaque-Android glass delta handled via `Platform.select` + reused opaque components. |
| Admin Web | No | Unaffected. |
| Business Web preview | No regression | `EventCoverMedia` owns the web image/video element (raw-image web hotfix removed); no web build break expected — tester should confirm the preview doesn't crash (adversarial angle #2). |

Parity is automatic (shared code) except the opaque-Android glass, which is a manual delta satisfied by reusing already-opaque `GlassCard`/`OfferingListCard` + an explicit opaque skeleton fill.

---

## 9. Smoke result (gates)

- **jest (new + nearby):** the 2 ORCH-1121 suites → **27/27 PASS**. Nearby `src/components/brand` + `src/components/offering` runs show 13 PRE-EXISTING failing suites (`PublicBrandPage.*`, `PublicEventPage.*`, `TripMiniCard.*`, `OfferingParity`) — every source file those suites assert against is **byte-identical to origin/main** (verified via `git diff origin/main...HEAD`), so they are baseline failures inherited from the stale-anchor base, NOT introduced by ORCH-1121. My 5 changed files intersect none of their assertion targets.
- **tsc:** no errors in any ORCH-1121 file (`tsc --noEmit`). (Unrelated pre-existing `packages/phone-input` errors remain, untouched.)
- **eslint:** clean on all 5 changed files.
- **strict-grep `i-proposed-tr2-route-by-event-type`:** exits 1 with 6 violations — ALL in files NOT touched by ORCH-1121 (`home.tsx`, `hub/trips.tsx`, `accept-scanner-invitation.tsx`, `ScannerHome.tsx`), each **byte-identical to origin/main**. ORCH-1121 introduces **zero** new violations (my row-tap routes through `routeForEventRowDefensive`; "See all" uses a Hub list route, not an event/trip detail route). The gate's red is a pre-existing baseline condition.
- **Device/sim runtime:** NOT run by the implementor (Business-account login is a Seth-only blocker, per the investigation). SC-1/SC-12 device proof + the false-empty-flash live-fire are the tester's phase.

---

## 10. Known issues / deferred

- No `[TRANSITIONAL]` code added.
- **Loading state** is "render a 2-row skeleton" (the SPEC-acceptable minimal alternative); `staleTime` 30s makes cached loads instant, so the false-empty flash is structurally impossible. Tester should confirm on a cold load (adversarial angle #3).
- **Metric/revenue null** on Recent-Events rows is intentional (B.5 — no per-row orders fetch on a glance surface). Live sold-counts here would be an additive follow-on ORCH, not this scope. Tester to confirm `OfferingListCard` renders cleanly with all three null on device (adversarial angle #1) — verified in source (`OfferingListCard.tsx` L136/L149/L183).

---

## 11. Operator action required

- None for deploy (no migration, no edge fn). Route back to orchestrator for REVIEW → tester dispatch.
- **Edge-fn deploy list:** none.
- **Migration `db push`:** none.

### Spec ambiguities resolved (in-file, no amendment needed — SPEC §10 allowed)
1. **Verified badge (OQ a):** `Brand` has NO `verified` field (confirmed `src/types/brand.ts`). Per SPEC, the badge is OMITTED entirely (not invented). A test pins that "Verified brand"/`brand.verified` never appear.
2. **Location pin icon + Hub route (OQ b):** no `pin`/`mapPin` icon exists; `location` does — used it. Hub events route is `/(tabs)/hub/events` (confirmed against `app/(tabs)/home.tsx:220`).
3. **EventCoverMedia error callback:** the public ECM prop is `onMediaError` (event-arg), NOT `onError`. Used `onMediaError={() => setCoverMediaFailed(true)}` (mirrors how the package exposes it). The `coverMediaFailed` flip is preserved.
4. **Reduce-motion source:** `useReducedMotion` from `react-native-reanimated` (the same signal `Pill livePulse` consults).
5. **`expo-linear-gradient`:** confirmed present (`~15.0.8`) → used `LinearGradient` for both the scrim and the no-media hue gradient (the SPEC's preferred path; the flat fallback was not needed).
6. **Test harness:** node/ts-jest with no RN renderer → T-1 implemented as a source-structure fails-on-revert test (the documented repo pattern), with the pure mapper tested behaviorally (T-10). See §6.

---

## 12. Discoveries for Orchestrator

- **D-A (pre-existing baseline red):** on this branch's base, `src/components/brand` + `src/components/offering` carry 13 failing suites and the `route-by-event-type` strict-grep gate is red — all from files identical to origin/main (a stale-anchor parallel-session drift: the failing tests expect newer `<OfferingManageSheet>` / `taglineCentered` patterns + the 6 flagged route sites that predate this ORCH). ORCH-1121 introduces none of them, but a clean CI green for the closing PR may require origin/main to advance past those parallel ORCHs first. Flag for the orchestrator's REVIEW/merge sequencing.
- No unrelated product bugs found inside the touched surface.
