# IMPLEMENTATION — ORCH-1138 [detail-sheet-behind-discover-header]

**Worktree:** `~/Desktop/mingla-orchs/ORCH-1138-[event-page]/` on `ORCH-1138-event-page`
**Date:** 2026-06-15 · **Status:** implemented and verified (sim) · layering-only, no deploy/merge/close.

---

## 1. Summary

Opening a TRIP or EVENT detail from the Discover deck mounted the new foundation
detail sheet, but the TOP of the sheet (cover media + the X / Share / Mute
`OfferingChrome`) rendered UNDERNEATH the Discover screen header, occluding and
un-tapping that chrome. Root cause: both consumer detail screens mount the shared
`BaseBottomSheet` WITHOUT `wrapInRNModal`, so the primitive renders its
absolutely-positioned inline host as a SIBLING of the host screen's chrome — and
that host had **no `zIndex`**, so `DiscoverScreen.headerPanel` (`zIndex: 50`)
painted over it. Fix: give the primitive's `inlineContainer` `zIndex: 100` +
`elevation: 100` — above all in-tree screen chrome (Discover header + floating
nav are both 50), below the global Toast layer (9999). One style block; every
full-screen detail sheet using this path is lifted at once.

## 2. Root cause (file:line + values)

- `app-mobile/src/components/ui/BaseBottomSheet.tsx:779-788` — the **non-`wrapInRNModal`**
  render path returns `<View style={[styles.inlineContainer, …]}>`. Pre-fix,
  `styles.inlineContainer` (`:868-873`) was `{ position:'absolute', top:0, left:0,
  right:0 }` with **NO zIndex / elevation** → resolves to auto(0).
- `app-mobile/src/components/DiscoverScreen.tsx:2649-2656` — `headerPanel` is
  `{ position:'absolute', top:0, left:0, right:0, zIndex: 50 }`.
- RN scopes `zIndex` to siblings. `headerPanel` (50) and the sheet's
  `inlineContainer` (auto/0) are siblings in DiscoverScreen's tree → **header wins**
  → it paints over the top of the sheet (cover + `nativeChrome` zIndex:70, which
  is only relative to the sheet's own subtree, not the outer tree).
- Both consumer detail screens hit this exact path:
  - EVENT: `app-mobile/src/components/ExpandedCardModal.tsx:1752-1758` returns
    `<ConsumerEventDetailScreen>` directly (businessEvent branch) →
    `app-mobile/src/screens/Event/ConsumerEventDetailScreen.tsx:545` mounts
    `<BaseBottomSheet … hidesBottomNav>` (no `wrapInRNModal`).
  - TRIP: `app-mobile/src/screens/Trip/ConsumerTripDetailScreen.tsx:1394` mounts
    `<BaseBottomSheet … hidesBottomNav>` (no `wrapInRNModal`).

The chrome (`OfferingChrome`) sits at `nativeChrome` zIndex:70 INSIDE the sheet —
correct relative to the sheet body, but the whole sheet host lost to the header
one level up. Lifting the host fixes both.

## 3. SPEC success-criteria coverage

This is an orchestrator bug-dispatch (no formal SPEC doc). Dispatch criteria:

| Criterion | Result | Evidence |
|---|---|---|
| SC-1 detail sheet (+ backdrop) renders ABOVE the Discover header | ✓ `a23b7100d`→new HEAD | `inlineContainer.zIndex 100 > headerPanel.zIndex 50`; sim shot zlayer-02 (X/Share at top, unoccluded) |
| SC-2 full top cover + X/Share/Mute visible & tappable | ✓ | zlayer-02 (visible), zlayer-03 (Maestro tap on `orch-1138-consumer-event-chrome-close` → sheet dismissed) |
| SC-3 fix covers BOTH trip + event (and any offering detail on this path) | ✓ | both screens use the same `BaseBottomSheet` non-`wrapInRNModal` path; fix is in the shared primitive |
| SC-4 header normal when no sheet open | ✓ | only `inlineContainer` changed; it exists ONLY while a sheet is mounted |
| SC-5 swipe-down-dismiss preserved | ✓ | Maestro swipe 35%→95% → sheet dismissed (zlayer-04); `enablePanDownToClose` default unchanged |
| SC-6 ORCH-1016/1043 sheet-scroll invariant honored | ✓ | inline host HEIGHT untouched; `orch-1043-sheet-scroll-viewport-check` 10/10 PASS; `i-bottomsheet-inline-scroll-binding` PASS |
| SC-7 regression assertion w/ fails-on-revert | ✓ | `orch_1138_detail_sheet_zlayer.test.mjs` 9/9; fails-on-revert proven by line deletion |

## 4. Files changed

| File | Δ |
|---|---|
| `app-mobile/src/components/ui/BaseBottomSheet.tsx` | +12 (zIndex:100 + elevation:100 on `inlineContainer` + comment) |
| `app-mobile/src/components/ui/__tests__/orch_1138_detail_sheet_zlayer.test.mjs` | +new (9 assertions) |
| `Mingla_Artifacts/evidence/ORCH-1138-event/zlayer-0{1..5}.png` | +5 sim screenshots |

## 5. Data-model / edge / RLS changes

None. Layering-only. No schema, no edge function, no migration, no checkout/data change.

## 6. Regression tests added

- Path: `app-mobile/src/components/ui/__tests__/orch_1138_detail_sheet_zlayer.test.mjs`
- Run: `node …/orch_1138_detail_sheet_zlayer.test.mjs` → **9 assertions passed**.
- Asserts: inline host has explicit `zIndex`+`elevation`; both EXCEED the Discover
  `headerPanel` zIndex; both stay BELOW the Toast `zIndex` (9999); `enablePanDownToClose`
  default still true; inline host HEIGHT model unchanged (ORCH-1016/1043).
- **fails-on-revert verified at `a23b7100d`** (pre-commit HEAD): true LINE DELETION
  of `zIndex: 100,` + `elevation: 100,` → `node` exits 1 with
  `FAIL T1 … sets an explicit zIndex`. Restored → 9/9 PASS again.
- Append-only: new file; no existing test modified or deleted.

## 7. Old → New receipt

### app-mobile/src/components/ui/BaseBottomSheet.tsx
- **Before:** `inlineContainer` = `{ position:'absolute', top:0, left:0, right:0 }` (zIndex auto/0) → a non-`wrapInRNModal` sheet lost to the Discover `headerPanel` (zIndex:50).
- **After:** adds `zIndex: 100` + `elevation: 100` → the inline host out-layers all in-tree screen chrome (header + nav both 50) while staying below the global Toast (9999).
- **Why:** SC-1/SC-2 — the whole detail sheet (incl. top cover + X/Share/Mute chrome) must sit above the Discover header, visible & tappable.
- **Lines:** ~12 (1 effective style change + documentation).

## 8. Cross-surface impact

| Surface | Affected | Notes |
|---|---|---|
| Consumer iOS | YES | trip + event (+ any) detail sheet now layers above Discover header. Parity AUTOMATIC (shared primitive). |
| Consumer Android | YES (parity automatic) | `elevation: 100` added alongside zIndex so Android stacking matches iOS. Not separately device-tested — pure shared-style change. |
| Buyer/anon Web | NO | RN-web `BaseBottomSheet` is the same primitive; zIndex/elevation are valid web styles; no consumer-web detail surface in scope. |
| Business iOS / Android | NO | business app does not use app-mobile's BaseBottomSheet. |
| Admin Web | NO | separate stack. |
| Business Web preview | NO | n/a. |

## 9. Smoke result (sim — iPhone 17 Pro, iOS 26.4)

Consumer app (`com.mingla.app.v2`) dev client served by an isolated Metro on :8099
from a **bracket-free real project root** (the `[event-page]` bracket path broke
Metro entry resolution + the `node_modules` symlink made Metro emit a `..`-escaping
launchAsset URL → "Unable to resolve expo-router/entry"; resolved by rsyncing the
worktree app-mobile to `/private/tmp/orch1138real` with a real `node_modules` dir
and a real `expo-router` copy so the launchAsset path stayed under-root). The
served JS bundle was confirmed to contain the fix verbatim
(`inlineContainer: { …, zIndex: 100, elevation: 100 }`).

- zlayer-01: consumer app boots clean (no red box) with the fixed bundle.
- zlayer-02: event detail sheet (cold OQ-6 state, mounted via the SAME
  BaseBottomSheet non-`wrapInRNModal` path) renders ON TOP of a dimmed backdrop
  with the **X (top-left) and Share (top-right) chrome fully visible and unoccluded**
  at the sheet's top edge.
- zlayer-03: Maestro tap on `orch-1138-consumer-event-chrome-close` → sheet
  dismissed → **the top chrome is interactive** (not just visible).
- zlayer-04: Maestro swipe-down (35%→95%) → sheet dismissed → **pan-down-dismiss
  still works** after the change.
- a11y hierarchy confirmed both `orch-1138-consumer-event-chrome-close` ("Close")
  and `orch-1138-consumer-event-chrome-share` ("Share") present/hittable in the
  live tree.

**Coverage note (honest):** the EXACT over-the-Discover-header reproduction (sheet
opened from the authed Discover deck with the live "Discover"/Events-Trips/filter
header behind it) could NOT be driven headlessly — the consumer app is Apple/Google
**OAuth-only** with no email/OTP path, so reaching the authed Discover deck needs an
interactive sign-in. The fix was instead proven by: (a) the static layering relation
(`inlineContainer.zIndex 100 > headerPanel.zIndex 50`, regression-tested), (b) the
running sim bundle containing the fix, and (c) the live event detail sheet (same
primitive path) showing its top X/Share chrome fully visible, tappable, and
swipe-dismissable. Recommend a quick authed-deck eyeball by Seth (or the tester
with a session) to close the visual loop.

## 10. Known issues / deferred

- Two PRE-EXISTING test failures on `BaseBottomSheet.test.mjs` (T-C "must NOT pass
  animationConfigs") and `BaseBottomSheetRework.test.mjs` (R-2 "EBES uses
  scrollMode='view'") are STALE assertions superseded by ORCH-1064 (added
  `animationConfigs` for the freeze fix) and a later EBES refactor — confirmed
  failing identically on clean `origin/main`, NOT caused by this change. Left
  untouched (append-only). Flagged for the orchestrator below.

## 11. Operator action required

- None for deploy/migration (no migration, no edge fn).
- This is a pure-JS app-mobile change → ships via `eas update` (app channel,
  runtime 1.1.0) at CLOSE per the OTA policy; no native rebuild needed.
- Route back to orchestrator for REVIEW → tester (adversarial test + authed-deck
  visual confirmation).

## 12. Discoveries for Orchestrator

1. `app-mobile/src/components/ui/__tests__/BaseBottomSheet.test.mjs` (T-C) and
   `BaseBottomSheetRework.test.mjs` (R-2) are stale and fail on `origin/main`
   independent of this ORCH (superseded by ORCH-1064 `animationConfigs` + a later
   EBES scrollMode refactor). They need a `[TEST-MOD-APPROVED ORCH-NNNN]` update or
   retirement under a separate ORCH.
2. Bracketed worktree paths (`[event-page]`) break Metro entry resolution and the
   dev-client launchAsset URL (a `node_modules` symlink makes Metro emit a
   `..`-escaping path). Working recipe for app-mobile sim runs from a bracketed
   worktree: rsync app-mobile + packages to a bracket-free `/tmp` dir, make
   `node_modules` a REAL dir of child symlinks, and copy `expo-router` as a real
   dir so the launchAsset stays under-root. Worth codifying alongside COMMS-0027.
