# TEST REPORT — ORCH-1022 DM Shared Card Freeze + Single-Card Buttons

Date: 2026-05-30
Skill: tester+codex
Mode: TARGETED / RETEST
Worktree: `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1022-[dm-shared-card-freeze-policies-reservations]`
Branch: `ORCH-1022-dm-shared-card-freeze-policies-reservations`
Implementation commit reviewed: `50affcf6d fix: gate expanded card child modals`

## Verdict

FAIL.

The reported Policies & Reservations browser path is structurally fixed and covered by a regression that fails on the pre-fix component. However, the implementation does not satisfy the full one-modal-at-a-time contract: the iOS Schedule date/time picker in `ActionButtons` still opens a `BaseBottomSheet wrapInRNModal` inside the already RN-Modal-backed `ExpandedCardModal`. This is the same native-modal collision class as the reported dead-tap/freeze bug, and the new ORCH-1022 regression does not catch it.

Runtime iOS/Android live-fire remains unverified because local simulator/emulator tooling did not provide a usable app flow during this pass.

## Findings

### P1 — iOS Schedule picker still co-presents an RN-modal sheet inside `ExpandedCardModal`

Evidence:

- `app-mobile/src/components/ExpandedCardModal.tsx:1407-1411` defines `anyChildModalOpen` only from parent-owned browser/ticket/share/lightbox state.
- `app-mobile/src/components/ExpandedCardModal.tsx:1812-1815` gates the root `BaseBottomSheet` with `visible={visible && !anyChildModalOpen}`.
- `app-mobile/src/components/expandedCard/ActionButtons.tsx:657-720` still renders the iOS date/time picker as a local `BaseBottomSheet` with `wrapInRNModal`.
- That local picker is mounted under the expanded card body, and its `showDateTimePicker` state is not included in `anyChildModalOpen`.

Why this blocks:

The forensic fix contract required one-sheet-at-a-time orchestration for RN-modal-backed child surfaces opened by the expanded card. The implementation moved browser/lightbox overlays to the parent but left this iOS schedule child sheet nested. If a user taps Schedule inside an expanded card on iOS, the app can still attempt to present a second RN Modal while the root expanded-card RN Modal is visible.

Required rework:

1. Move the iOS date/time picker ownership out of `ActionButtons` into `ExpandedCardModal`, or expose controlled picker state/events so the root sheet can be hidden while it is open.
2. Add that state to `anyChildModalOpen` and to `handleRootSheetClose`.
3. Reset it when the expanded card closes.
4. Extend `app-mobile/scripts/ci/orch-1022-expanded-card-modal-gating-check.mjs` so it fails if `ActionButtons` can render a `wrapInRNModal` child without parent-level gating.

### P2 — Existing curated DM card regression checks are still red

Evidence:

- `node ./scripts/ci/orch-0910-regression-check.mjs` failed `T-06 buildCardDataPayload curated synths top-level image/images from stops`.
- `node ./scripts/ci/orch-0910-adversarial-check.mjs` failed `T-23 all-null stop imageUrl produces undefined image`.
- The forensics report already identified these as separate from single-card Policies & Reservations but relevant to DM shared curated-card quality.

Why this matters:

This should not block the single-place browser fix by itself, but it must not be hidden under ORCH-1022 close. DM shared curated cards still have known red gates.

Required routing:

Keep the ORCH-0910 failures as a separate rework/closeout dependency unless Seth explicitly folds curated chat payload repair into ORCH-1022.

### P2 — iOS/Android runtime live-fire could not be completed

Evidence:

- iOS: `xcrun simctl get_app_container 17091E60-C3B6-4167-980D-60C348E177F6 com.mingla.app.v2` timed out after 8 seconds.
- iOS: `xcrun simctl io 17091E60-C3B6-4167-980D-60C348E177F6 screenshot /tmp/orch1022_ios_launch.png` failed with `Device does not have a 'default' display port`.
- Android: `adb shell pm list packages` timed out after 8 seconds.
- Android: `adb shell am start -n com.mingla.app.v2/.MainActivity` returned `Starting: Intent { cmp=com.mingla.app.v2/.MainActivity }`, but `adb exec-out screencap` produced a 0-byte file and window dumps returned no useful focused-app output.

Required runtime gate after rework:

1. iOS simulator or real device: DM shared single-place card expands without freeze.
2. iOS simulator or real device: Policies & Reservations opens browser, closing browser returns to the same card.
3. iOS simulator or real device: Schedule opens date/time picker, closing picker returns to the same card without dead taps.
4. Android emulator or real device: repeat DM expansion and Policies & Reservations flow.
5. Curated card: stop image lightbox opens/closes without freezing.

## Claim Table

| Claim | Status | Evidence |
| --- | --- | --- |
| Parent-level browser/lightbox overlay state exists. | Verified | `ExpandedCardModal.tsx:1407-1411`, `:1859-1865`, `:2205-2208`, `:2231-2242`. |
| Root expanded card sheet hides while parent-owned child overlays are open. | Verified for browser/ticket/share/lightbox state | `ExpandedCardModal.tsx:1812-1815`. |
| Synthetic root close is swallowed while parent-owned child overlays are open. | Verified for browser/ticket/share/lightbox state | `ExpandedCardModal.tsx:1413-1421`. |
| Curated stop Policies & Reservations no longer mounts a nested browser modal. | Verified | `MultiStopPlanView` now calls `onOpenBrowser(normalized, stop.placeName)` at `ExpandedCardModal.tsx:1118-1122`; no local curated `InAppBrowserModal` remains. |
| Curated lightbox is parent-owned. | Verified | `StopImageGallery` calls `onOpenImageLightbox` at `ExpandedCardModal.tsx:1047-1052`; parent renders `ImageLightbox` at `:2238-2242`. |
| All expanded-card child RN Modal surfaces are safe. | Refuted | `ActionButtons.tsx:657-720` still renders an iOS `BaseBottomSheet wrapInRNModal` under the root modal without parent gating. |
| Regression test would catch the original browser/modal structure returning. | Verified | Current `npm run test:orch-1022` passes; the same script against `HEAD^` failed 6/6. |
| Runtime DM expansion freeze is fixed. | Unverified | Local iOS/Android runtime tooling blocked live-fire. |

## Platform Matrix

| Platform | Result | Notes |
| --- | --- | --- |
| iOS app-mobile | FAIL / unverified runtime | Source finding blocks release; simulator tooling timed out or had no default display port before app flow could be exercised. |
| Android app-mobile | UNVERIFIED runtime | `am start` returned a launch intent, but package/screenshot/window tooling was not usable enough to prove the flow. |
| Web/browser | N/A | ORCH-1022 scope is consumer mobile expanded-card modal behavior. |
| Business/admin/buyer surfaces | N/A | No business/admin/buyer files changed and implementation report scoped them out. |

## Commands Run

Passed:

```bash
cd app-mobile && npm run test:orch-1022
```

Output excerpt:

```text
PASS G-01 child overlay aggregate covers all RN Modal child surfaces
PASS G-02 root sheet is gated while child overlays are open
PASS G-03 synthetic root closes are swallowed during child overlays
PASS G-04 curated policies no longer mount a nested browser modal
PASS G-05 curated lightbox is parent-owned like the browser overlays
PASS G-06 overlay state is reset when the expanded card closes
ORCH-1022 expanded-card modal gating regression passed.
```

Passed:

```bash
cd app-mobile && npm run test:orch-0908-chat
```

Output excerpt:

```text
ORCH-0908 chat mention/card-tag regression passed: 6/6
```

Passed with warnings only:

```bash
cd app-mobile && npx eslint src/components/ExpandedCardModal.tsx
```

Output excerpt:

```text
✖ 8 problems (0 errors, 8 warnings)
```

Fail-on-revert proof:

```bash
tmp=$(mktemp -d /tmp/orch1022-revert-proof.XXXXXX)
mkdir -p "$tmp/app-mobile/src/components" "$tmp/app-mobile/scripts/ci"
git show HEAD^:app-mobile/src/components/ExpandedCardModal.tsx > "$tmp/app-mobile/src/components/ExpandedCardModal.tsx"
cp app-mobile/scripts/ci/orch-1022-expanded-card-modal-gating-check.mjs "$tmp/app-mobile/scripts/ci/"
(cd "$tmp/app-mobile" && node ./scripts/ci/orch-1022-expanded-card-modal-gating-check.mjs)
```

Output excerpt:

```text
FAIL G-01 child overlay aggregate covers all RN Modal child surfaces
FAIL G-02 root sheet is gated while child overlays are open
FAIL G-03 synthetic root closes are swallowed during child overlays
FAIL G-04 curated policies no longer mount a nested browser modal
FAIL G-05 curated lightbox is parent-owned like the browser overlays
FAIL G-06 overlay state is reset when the expanded card closes
ORCH-1022 expanded-card modal gating regression failed: 6/6
```

Failed existing baseline:

```bash
cd app-mobile && npx tsc --noEmit --pretty false
```

Output excerpt:

```text
__tests__/googlePay_testEnvProductionGate.test.ts(...): Cannot find module 'https://deno.land/...'
src/components/BoardDiscussion.tsx(...): DirectMessage type mismatches
../packages/brand-rendering/PublicBrandPage.tsx(...): Cannot find module 'react'
../packages/event-rendering/EventCover.tsx(...): Cannot find module 'react'
../packages/payments-native/StripeNativeProvider.tsx(...): Cannot find module '@stripe/stripe-react-native'
```

Failed known ORCH-0910 checks:

```bash
cd app-mobile && node ./scripts/ci/orch-0910-regression-check.mjs
cd app-mobile && node ./scripts/ci/orch-0910-adversarial-check.mjs
```

Output excerpt:

```text
FAIL T-06 buildCardDataPayload curated synths top-level image/images from stops
FAIL T-23 all-null stop imageUrl produces undefined image
```

Runtime attempts:

```bash
xcrun simctl list devices booted
adb devices
~/.maestro/bin/maestro --version
```

Output excerpt:

```text
iPhone 17 Pro (...) (Booted)
iPhone 17 Pro Max (...) (Booted)
iPhone 17e (...) (Booted)
emulator-5554 device
2.5.1
```

Blocked runtime commands:

```bash
adb shell pm list packages
xcrun simctl get_app_container 17091E60-C3B6-4167-980D-60C348E177F6 com.mingla.app.v2
xcrun simctl io 17091E60-C3B6-4167-980D-60C348E177F6 screenshot /tmp/orch1022_ios_launch.png
adb exec-out screencap -p > /tmp/orch1022_android_launch.png
```

Output excerpt:

```text
TIMEOUT adb shell pm list packages after 8s
TIMEOUT simctl get_app_container after 8s
Device does not have a 'default' display port
/tmp/orch1022_android_launch.png: empty
```

## Regression Coverage Assessment

The new ORCH-1022 regression is valuable and proves the browser/lightbox root fix would fail on the pre-fix component. It is not sufficient for release because it asserts "all RN Modal child surfaces" while missing the iOS `ActionButtons` date/time picker. The regression must be expanded before retest.

## Rework Checklist

1. Gate the iOS `ActionButtons` date/time picker through `ExpandedCardModal` parent state, or remove its RN-modal-backed nested presentation under the root expanded card.
2. Add structural coverage that fails when `ActionButtons` contains a local `wrapInRNModal` picker under `ExpandedCardModal` without root gating.
3. Re-run:
   - `npm run test:orch-1022`
   - `npm run test:orch-0908-chat`
   - `npx eslint src/components/ExpandedCardModal.tsx src/components/expandedCard/ActionButtons.tsx`
4. Complete iOS + Android live-fire for DM shared card expansion, Policies & Reservations, Schedule picker, and curated lightbox.
