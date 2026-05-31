# IMPLEMENTATION_ORCH-1022 — DM Shared Card Freeze + Single-Card Buttons

Date: 2026-05-30
Skill: implementor+codex
Worktree: `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1022-[dm-shared-card-freeze-policies-reservations]`
Branch: `ORCH-1022-dm-shared-card-freeze-policies-reservations`

## Outcome

Implemented the shared expanded-card modal fix for ORCH-1022. Policies & Reservations, reservations/scheduling browser launches, event ticket browser, event share modal, and curated image lightbox now all route through parent-owned child overlay state. While any child RN Modal/WebView overlay is open, the root `BaseBottomSheet` is suppressed and its synthetic close is swallowed so the expanded card is not torn down.

## Root Cause Addressed

Forensics proved that `ExpandedCardModal` used `BaseBottomSheet wrapInRNModal`, then allowed child RN Modal-backed surfaces to mount under or alongside that root sheet. On iOS this can co-present two native modal surfaces, producing dead taps/freezes when opening browser-backed CTAs from expanded cards, especially from cards shared through chat.

## Code Changes

### `app-mobile/src/components/ExpandedCardModal.tsx`

- Added parent-level `anyChildModalOpen` covering:
  - `browserUrl !== null`
  - `ticketBrowserUrl !== null`
  - `isNightOutShareOpen`
  - `curatedLightbox.visible`
- Changed the main card root sheet to:
  - `visible={visible && !anyChildModalOpen}`
  - `onClose={handleRootSheetClose}`
- Added `handleRootSheetClose()` to ignore synthetic root closes while a child overlay is active.
- Moved curated stop Policies & Reservations browser ownership from `MultiStopPlanView` to the parent expanded modal.
- Moved curated stop image lightbox ownership from `MultiStopPlanView` to the parent expanded modal.
- Kept child overlays as siblings of the root sheet:
  - event ticket `InAppBrowserModal`
  - Policies & Reservations `InAppBrowserModal`
  - curated `ImageLightbox`
  - event `ShareModal`
- Reset all child overlay state when the expanded card closes.

### `app-mobile/scripts/ci/orch-1022-expanded-card-modal-gating-check.mjs`

Added a repo-running structural regression that fails if the old broken structure returns:

- no aggregate child-overlay gate,
- ungated root `BaseBottomSheet`,
- root `onClose` not guarded,
- nested curated browser modal,
- nested curated lightbox modal,
- missing overlay state reset on close.

### `app-mobile/package.json`

Added:

```json
"test:orch-1022": "node ./scripts/ci/orch-1022-expanded-card-modal-gating-check.mjs"
```

## Scope Matrix

| Surface | Status | Notes |
| --- | --- | --- |
| Consumer iOS/Android expanded place cards | Touched | Shared `ExpandedCardModal` action buttons now route through gated parent browser state. |
| Consumer iOS/Android curated cards | Touched | Stop Policies & Reservations and image lightbox now use gated parent overlay state. |
| Consumer iOS/Android event cards | Touched | Ticket browser and event share modal included in the same child-overlay gate. |
| DM shared cards | Touched indirectly | DM card expansion uses the same expanded-card modal path; requires live tester confirmation. |
| Saved cards, Discover cards, Calendar cards, friend-profile cards, session cards | Touched indirectly | These share `ExpandedCardModal`; requires tester spot checks. |
| Business mobile/web, admin web, buyer web | Not touched | No files under those surfaces changed. |
| Supabase/schema/RLS/cache | Not touched | No data contract or persistence changes. |

## Verification

Passed:

```bash
cd app-mobile && npm run test:orch-1022
cd app-mobile && npm run test:orch-0908-chat
cd app-mobile && npx eslint src/components/ExpandedCardModal.tsx
```

`npx eslint src/components/ExpandedCardModal.tsx` passed with 0 errors and 8 existing warnings in the file.

Blocked by existing baseline:

```bash
cd app-mobile && npx tsc --noEmit --pretty false
```

This failed on existing repo-wide issues outside the ORCH-1022 edit, including Deno-style tests under `__tests__`, pre-existing `BoardDiscussion.tsx` type mismatches, and shared package React/module typing failures under `packages/*`. The failure output did not identify a new ORCH-1022-specific issue in `ExpandedCardModal.tsx`.

## Manual Tester Gates

Tester must live-fire this on iOS and Android:

1. Open a DM containing a shared place card, expand it, then close it. The app must not freeze.
2. From that expanded shared card, tap Policies & Reservations. Browser opens; closing browser returns to the same expanded card state.
3. From single cards outside DM, tap Policies & Reservations / reservation browser buttons. Browser opens and closes without dead taps.
4. From an event card, tap Get Tickets and Share. Each overlay opens, closes, and returns to the card without freezing.
5. From a curated card, tap a stop image. Lightbox opens, closes, and returns to the card without freezing.
6. Confirm no regression to ORCH-0908 chat card-tag behavior.

## Known Residual Risk

The implementation is structurally verified, but the original DM expansion freeze was not reproduced live during forensics. Runtime QA must still prove the DM shared-card expansion path on real simulator/device before this can be called production-ready.
