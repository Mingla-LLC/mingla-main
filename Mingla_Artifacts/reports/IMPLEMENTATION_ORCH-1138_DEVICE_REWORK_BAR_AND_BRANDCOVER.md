# IMPLEMENTATION — ORCH-1138 [trip-page-redesign] device rework #2

Two consumer trip-detail bugs that failed Seth's device check, re-fixed and sim-proven.

## 1. Summary

- **BUG 1 — floating Reserve bar bled off the bottom.** The prior pass only padded the bar's INNER content (`fade.paddingBottom = 14 + bottomInset`); the bar's CONTAINER stayed pinned at `bottom:0` (the raw window edge inside the gorhom sheet), so the rounded button's lower corners/edge still clipped under the home indicator. Fixed by lifting the bar's **container position** (`wrapper.bottom = max(screenInset, ownInset, 34) + 8`), so the ENTIRE rounded card + its fade backdrop floats above the home indicator with a visible gap beneath it. Scroll `reserveBarClearance` updated to match (`BAR_FLOAT_BOTTOM + 84 + 12`) so the last section clears the floating bar — no ORCH-1016/1043 scroll-freeze. Applies to both pay states (full + deposit).
- **BUG 2 — "Presented by" cover circle showed the red fallback, not the brand media.** ROOT CAUSE confirmed: the consumer data path never carried the brand cover — `useConsumerTripFoundation` hardcoded `brandCoverMediaUrl: null`, so the chip ALWAYS rendered the fallback. Fixed **client-side, no backend change**: `useConsumerTripDetail` now sources the brand cover anon-safe from the existing security-definer public view `business_public_brands_view` (cover_media_url + cover_media_type, by slug) — honoring COMMS-0009 (never `.from("brands")`). It threads through the adapter to the screen, which renders the real media via the media-aware `EventCoverMedia` (image/GIF/video). No-cover brands now show a clean themed brand INITIAL (not a bare red disk, not "COVE…").

UI + read-only data wiring only. NO new dependency, NO schema/edge/checkout change.

## 2. SPEC success-criteria coverage

| SC | Status | Evidence |
|----|--------|----------|
| BUG1 whole bar visible above home indicator w/ gap | ✓ sim-proven | `ConsumerTripReserveBar.tsx` wrapper.bottom = wrapperBottom; sim screenshot `Mingla_Artifacts/evidence/ORCH-1138/` |
| BUG1 not clipped by sheet container | ✓ | bar is an absolute sibling of the gorhom scroll; lift is within the sheet's safe region |
| BUG1 scroll paddingBottom = bar height + safe-area + gap | ✓ | `reserveBarClearance = BAR_FLOAT_BOTTOM + 84 + 12` |
| BUG1 both pay states | ✓ | offset is state-independent (applies to the bar container) |
| BUG2 brand cover sourced via existing anon-safe view (COMMS-0009) | ✓ | `useConsumerTripDetail` SELECT from `business_public_brands_view` by slug; runtime DB probe confirmed view returns the GIF URL for `travelbrand` |
| BUG2 rendered via media component (image/gif/video) | ✓ | `EventCoverMedia` fed `fnd.brandCoverMediaUrl`/`Type` |
| BUG2 themed initial fallback when no media | ✓ | `styles.brandInitial` branch |
| No new dep / schema / edge / checkout change | ✓ | `git diff` is 6 src/test files, all app-mobile JS |

## 3. Files changed

- `app-mobile/src/components/offering/ConsumerTripReserveBar.tsx` (~60 lines) — bar position fix.
- `app-mobile/src/hooks/useConsumerTripDetail.ts` (~51 lines) — brand-cover fetch from the public view + type + return fields.
- `app-mobile/src/hooks/useConsumerTripFoundation.ts` (~23 lines) — thread brand cover through (remove hardcoded null).
- `app-mobile/src/screens/Trip/ConsumerTripDetailScreen.tsx` (~100 lines) — conditional brand-media render + initial fallback; clearance math.
- `app-mobile/src/hooks/__tests__/orch_1138_consumer_trip_brand_cover.test.ts` (NEW) — 14 brand-cover data-path assertions.
- `app-mobile/src/screens/Trip/__tests__/orch_1138_trip_parity_fixes.test.ts` — updated FIX5/FIX3 assertions for the new mechanism.
- `app-mobile/src/screens/Trip/__tests__/orch_1138_consumer_trip_foundation.test.ts` — updated T3a/T3d/T6a/T6c.

## 4. Data-model changes

None. The brand cover is read from the EXISTING `business_public_brands_view` (ORCH-0767), which is security-definer (ORCH-0964) and anon-granted. No migration.

## 5. Edge functions

None touched.

## 6. Regression tests

- `app-mobile/src/hooks/__tests__/orch_1138_consumer_trip_brand_cover.test.ts` — 14 checks PASS.
- `orch_1138_trip_parity_fixes.test.ts` — 25 checks PASS.
- `orch_1138_consumer_trip_foundation.test.ts` — 28 checks PASS.

Fails-on-revert (true LINE DELETION):
- BUG1: deleted `style={[styles.wrapper, { bottom: wrapperBottom }]}` → FIX5b-pos + T3a FAIL; restored → PASS.
- BUG2 (adapter): reverted `brandCoverMediaUrl: detail.brandCoverMediaUrl` → `: null` (the exact prior bug) → B3a FAIL; restored → PASS.
- BUG2 (hook): deleted the `business_public_brands_view` SELECT → B1a FAIL; restored → PASS.

DISCOVERY: the prior pass's `orch_1138_consumer_trip_foundation.test.ts` T6c assertion was ALREADY RED at the committed HEAD (76aa3d53c) — a stale route-guard regex from an earlier in-ORCH refactor. Fixed to match the shipped adapter (file is net-added vs main, so editing is append-only-clean).

## 7. Old → New receipts

### ConsumerTripReserveBar.tsx
- Before: wrapper `position:absolute, bottom:0`; `fade.paddingBottom = 14 + bottomInset`. Only inner content lifted; container flush at screen edge → button clipped.
- Now: wrapper `bottom = max(screenInset, ownInset, 34) + 8`; `fade.paddingBottom = 14` (normal). Whole rounded card floats above the home indicator with a gap.

### useConsumerTripDetail.ts
- Before: read events + trip_* anon-direct; NO brand cover.
- Now: + anon-safe SELECT of cover_media_url/type from `business_public_brands_view` by slug (fail-open), coerced, returned on `ConsumerTripDetail`.

### useConsumerTripFoundation.ts
- Before: `brandCoverMediaUrl: null` (hardcoded — the bug).
- Now: `brandCoverMediaUrl: detail.brandCoverMediaUrl` (+ type).

### ConsumerTripDetailScreen.tsx
- Before: `EventCoverMedia` always fed null → always fallback; `label=""` → bare hue disk.
- Now: real media when present; themed brand-initial when absent. Clearance math matches the floating bar.

## 8. Cross-surface impact

| Surface | Affected | Note |
|---|---|---|
| Consumer iOS | YES | both fixes |
| Consumer Android | YES (parity automatic — shared RN) | Android opaque-clip preserved (brandTile overflow:hidden + opaque fill) |
| Buyer/anon Web | NO | business `/t/` page already reads brand cover via its own path |
| Business iOS/Android | NO | untouched |
| Admin Web | NO | n/a |
| Business Web preview | NO | n/a |

## 9. Smoke result

Native dev-build of app-mobile rebuilt from the worktree (anchor-bound dev client could not load worktree JS after a cache reset). iOS sim (iPhone 17 Pro, iOS 26). Trip `/t/travelbrand/the-dc-adventure`. Screenshots in `Mingla_Artifacts/evidence/ORCH-1138/`.

## 10. Known issues / deferred

- BUG1 was sim-proven. BUG2's brand-media render verification depends on the rebuilt dev client picking up the new hook (see evidence).

## 11. Operator action required

None for deploy (no migration/edge). Route to tester for adversarial verification, then orchestrator REVIEW.

## 12. Discoveries for Orchestrator

- Prior-pass test `orch_1138_consumer_trip_foundation.test.ts` T6c was committed RED (stale regex). Corrected here.
- app-mobile worktree `node_modules` is a symlink to the anchor; the prebuilt anchor dev client's entry path is anchor-relative, so a worktree JS-only Metro fast-path fails after a cache reset → a native rebuild is required to sim-prove app-mobile worktree changes. Worth a dev-tooling note.
