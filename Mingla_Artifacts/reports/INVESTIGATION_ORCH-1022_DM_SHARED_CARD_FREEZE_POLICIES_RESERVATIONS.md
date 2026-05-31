# INVESTIGATION — ORCH-1022 (DM shared-card freeze + single-card Policies & Reservations dead taps)

**Date:** 2026-05-30  
**Skill:** forensics  
**Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1022-[dm-shared-card-freeze-policies-reservations]`  
**Branch:** `ORCH-1022-dm-shared-card-freeze-policies-reservations`  
**Scope:** consumer iOS + consumer Android only. Buyer/anonymous web, business apps, admin, and business web preview are out of scope.

## Executive Summary

The "Policies & Reservations" dead tap is a shared expanded-card modal bug, not a per-screen wiring bug. Every single-card surface routes through `ExpandedCardModal` -> `ActionButtons`; `ActionButtons` fires `onOpenBrowser`, but `ExpandedCardModal` tries to show `InAppBrowserModal` while the root expanded-card sheet is still inside a `wrapInRNModal` `BaseBottomSheet`. The repo already documents and tests this failure class: two RN-Modal-backed surfaces cannot co-present reliably, especially on iOS, where the child silently fails or the OS reports a presentation conflict.

The DM shared-card freeze is not fully runtime-proven in this pass because the local Android development build failed before app load with a Metro `UnableToResolveError`, and iOS app-container probing hung against the booted simulator. Source evidence shows chat-shared cards open the same `ExpandedCardModal`, so the browser/sub-modal co-presentation fix is required for chat too; however, a freeze that occurs immediately on first expansion needs an implementor/tester runtime gate after the fix, because source-only evidence does not prove an immediate-expand freeze root cause.

Secondary finding: the current branch's existing ORCH-0910 curated chat-card regression checks are red. That is separate from single-card Policies & Reservations, but it affects DM shared curated cards and should not be hidden under this fix.

## Ledger / Prior-Art Inputs Read

- `COMMS_LEDGER.md`: no blocking row stopped the turn. Existing WARN rows to `ALL` were factored earlier in the turn.
- `Mingla_Artifacts/COVERAGE_MAP.md`: ORCH-0667/0685/0690/0696 history confirms DM card sharing and `ExpandedCardModal` are shared cross-surface contracts.
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0696_REPORT.md`: bottom-sheet conversion and chat-shared modal coverage precedent.
- `Mingla_Artifacts/reports/INVESTIGATION_META-ORCH-0991_CONSUMER_MODALS_TO_SHEETS.md`: modal-to-sheet architecture and `wrapInRNModal` constraints.
- `Mingla_Artifacts/specs/WAVE_B_CONVERSION_PLAYBOOK_META-ORCH-0991.md`: hard lesson that two `wrapInRNModal` surfaces cannot co-present on iOS.
- `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0908_CHAT_MENTION_AND_CARD_TAG.md`: chat card payload/card tag parity precedent.

## Finding 1 — Policies & Reservations Opens a Child RN Modal Without Dropping the Parent Sheet

**Severity:** P0  
**Confidence:** HIGH source proof, HIGH prior runtime precedent, runtime reproduction blocked this pass.  
**Affected:** single place cards in Discover, Saved, Calendar, friend profile, solo/collab decks, and chat-shared cards.

### Evidence

`ActionButtons` owns the single-card "Policies & Reservations" button:

- `app-mobile/src/components/expandedCard/ActionButtons.tsx:644-650`:
  - requires `onOpenBrowser`
  - normalizes `card.website`
  - calls `onOpenBrowser(url, card.title)`
- `app-mobile/src/components/expandedCard/ActionButtons.tsx:653`:
  - button visibility is `!!card.website`
- `app-mobile/src/components/expandedCard/ActionButtons.tsx:858-871`:
  - renders the tracked button.

`ExpandedCardModal` passes that callback and opens `InAppBrowserModal`:

- `app-mobile/src/components/ExpandedCardModal.tsx:2171-2193` passes `onOpenBrowser` into `ActionButtons`.
- `app-mobile/src/components/ExpandedCardModal.tsx:2212-2218` renders `InAppBrowserModal` when `browserUrl !== null`.

The parent expanded card is itself an RN-Modal-backed sheet:

- `app-mobile/src/components/ExpandedCardModal.tsx:1801-1805` renders `BaseBottomSheet` with `wrapInRNModal`.
- `app-mobile/src/components/ui/BaseBottomSheet.tsx:608-635` implements `wrapInRNModal` by wrapping the sheet in an RN `<Modal>`.
- `app-mobile/src/components/InAppBrowserModal.tsx:70-149` is also an RN `<Modal>` containing a WebView.

The repo already documents this exact class:

- `Mingla_Artifacts/specs/WAVE_B_CONVERSION_PLAYBOOK_META-ORCH-0991.md:333-341` says two `wrapInRNModal` sheets cannot co-present on iOS and the child silently fails.
- `app-mobile/src/components/ui/__tests__/WaveCBatch2.test.mjs:12-16` locks the same iOS failure string.
- `app-mobile/src/components/profile/AccountSettings.tsx:471-478` and `app-mobile/src/components/ConnectionsPage.tsx:776-783` show the established solution: one-sheet-at-a-time gating, dropping the root RN modal while a child surface is open.
- `app-mobile/src/components/FeedbackHistorySheet.tsx:263-288` shows a working pattern for a sibling RN modal child: `visible={visible && !screenshotOpen}` plus a root close guard.

### Root Cause

`ExpandedCardModal` keeps the root `wrapInRNModal` sheet visible while trying to show `InAppBrowserModal`. That creates two RN Modal windows competing for presentation. On affected devices, the tap can log/fire but the browser does not appear, so users experience it as a dead button.

### Required Fix Contract

Implement one-sheet-at-a-time orchestration inside `ExpandedCardModal`:

1. Derive a child-open flag for every RN-modal-backed child surface opened by the expanded card:
   - `browserUrl !== null`
   - `ticketBrowserUrl !== null`
   - `isNightOutShareOpen`
   - any other future child RN modal in this component.
2. Gate the root `BaseBottomSheet` visibility with `visible && !anyChildModalOpen`.
3. Add a guarded root close handler so the synthetic `onClose` caused by hiding the parent for a child does not clear the selected card or close the whole flow.
4. Keep the child modal mounted while the parent is dropped, then restore the parent when the child closes.
5. Add regression coverage that fails if `ExpandedCardModal` renders root `BaseBottomSheet visible={visible}` while any child RN modal can be open.

This should be modeled on `FeedbackHistorySheet` and `AccountSettings`, not invented from scratch.

## Finding 2 — Single-Card Surfaces Are All Hit Because They Share the Same Modal

**Severity:** P0  
**Confidence:** HIGH.

### Evidence

The same modal and button path is shared across the reported "anywhere in the app" surface:

- Discover: `app-mobile/src/components/DiscoverScreen.tsx:2263-2316`.
- Swipeable deck: `app-mobile/src/components/SwipeableCards.tsx:2083-2115` and `:2611-2638`.
- Saved tab: `app-mobile/src/components/activity/SavedTab.tsx:2058-2077`.
- Calendar tab: `app-mobile/src/components/activity/CalendarTab.tsx:2374-2395`.
- Friend profile: `app-mobile/src/components/profile/ViewFriendProfileScreen.tsx:803-819`.
- Session view / collab cards: `app-mobile/src/components/SessionViewModal.tsx:853-875`.
- Direct messages: `app-mobile/src/components/MessageInterface.tsx:2158-2174`.

The single-card data converters preserve `website` when it exists:

- Swipeable deck: `app-mobile/src/components/SwipeableCards.tsx:1516-1518`, `:1865-1866`.
- Saved tab: `app-mobile/src/components/activity/SavedTab.tsx:1440-1441`.
- Calendar tab: `app-mobile/src/components/activity/CalendarTab.tsx:1517-1518`.
- Session view: `app-mobile/src/components/SessionViewModal.tsx:627-629`.
- Chat payload adapter: `app-mobile/src/services/cardPayloadAdapter.ts:55-57`.
- Card payload trim: `app-mobile/src/services/messagingService.ts:283-284`.

### Root Cause

The bug is centralized in `ExpandedCardModal` child modal orchestration. Fixing only one screen would miss the shared failure.

### Required Fix Contract

Apply the fix only in the shared modal/browser orchestration path unless runtime testing proves a surface-specific issue. Do not duplicate browser-opening logic in individual mount surfaces.

## Finding 3 — Curated DM Cards Have Existing Red Gates Separate From Single-Card Buttons

**Severity:** P1 for DM shared curated cards; not the root cause of single-card Policies & Reservations.  
**Confidence:** MEDIUM-HIGH from existing regression checks.

### Evidence

Existing checks run in this worktree:

- `npm run test:orch-0908-chat` passed 6/6.
- `node ./scripts/ci/orch-0910-regression-check.mjs` failed:
  - `T-06 buildCardDataPayload curated synths top-level image/images from stops`.
- `node ./scripts/ci/orch-0910-adversarial-check.mjs` failed:
  - `T-23 all-null stop imageUrl produces undefined image`.

Source evidence:

- `app-mobile/src/services/messagingService.ts:112-130` defines `TrimmedCuratedStop` without `website`, `openingHours`, `isOpenNow`, `imageUrls`, and several full `CuratedStop` fields.
- `app-mobile/src/services/messagingService.ts:237-254` trims stops to the reduced shape.
- `app-mobile/src/components/ExpandedCardModal.tsx:1106-1125` can only render curated per-stop Policies & Reservations when `stop.website` exists.
- `app-mobile/src/types/curatedExperience.ts:3-58` says full `CuratedStop` includes `website` and `openingHours`.

### Interpretation

This does not explain the reported "single cards anywhere" button failure. It does explain why chat-shared curated cards can lose key affordances or degrade after sharing. It is also a warning that a runtime test for "DM shared card expansion" must include both single-place and curated payloads.

### Required Fix Contract

Keep this as a separate implementation subtask or explicit non-goal. If included in ORCH-1022 implementation, add a small source regression that proves the fields read by the curated modal are either preserved in `TrimmedCuratedStop` or the modal handles their absence without dead affordances.

## Finding 4 — Immediate DM Expansion Freeze Still Needs Live Runtime Proof

**Severity:** P0 because user reports a freeze.  
**Confidence:** MEDIUM source confidence; LOW runtime confidence in this pass.

### Evidence

DM card expansion path:

- `app-mobile/src/components/chat/MessageBubble.tsx:365-390` renders shared-card bubbles and calls `onCardBubbleTap`.
- `app-mobile/src/components/MessageInterface.tsx:1658-1661` converts the payload with `cardPayloadToExpandedCardData(payload)` and sets `showExpandedCardFromChat`.
- `app-mobile/src/components/MessageInterface.tsx:2158-2174` opens `ExpandedCardModal`.
- `app-mobile/src/services/cardPayloadAdapter.ts:23-88` maps `CardPayload` into `ExpandedCardData`.

This path is structurally sound for a single-place card and uses the same modal as every other surface. I did not find a source-only infinite loop or immediate render crash in the single-card adapter path.

Runtime attempt:

- Metro started on `8088`.
- Android dev client launch failed before app load with "There was a problem loading the project" and a `DebugServerException` / `UnableToResolveError`.
- The emulator also showed a system "System UI isn't responding" dialog after the failed dev-client load, so the requested in-app repro could not be executed.
- iOS booted simulators were present, but app-container probing for `com.mingla.app.v2` hung; I stopped only the scoped hung `simctl` processes and did not kill global simulator state.

### Interpretation

The immediate DM expansion freeze is not proven by source alone. The implementor should first fix the source-proven modal co-presentation bug, then tester must live-fire:

1. Open a direct message containing a shared single-place card with a valid website.
2. Tap the card bubble.
3. Confirm the expanded sheet opens without freezing.
4. Tap Policies & Reservations.
5. Confirm the browser appears, the root sheet is temporarily dropped, and closing the browser restores/returns cleanly.
6. Repeat with a curated shared card and a card tag.

If step 2 still freezes after the modal orchestration fix, open a follow-up investigation focused only on chat mount/runtime data.

## Tests / Commands Run

Passed:

```bash
cd app-mobile && npm run test:orch-0908-chat
```

Failed existing checks:

```bash
cd app-mobile && node ./scripts/ci/orch-0910-regression-check.mjs
cd app-mobile && node ./scripts/ci/orch-0910-adversarial-check.mjs
```

Runtime attempted:

```bash
cd app-mobile && npx expo start --port 8088
adb shell am start -a android.intent.action.VIEW -d 'exp+mingla://expo-development-client/?url=http%3A%2F%2F10.0.2.2%3A8088' com.mingla.app.v2/.MainActivity
adb exec-out screencap -p > /tmp/orch1022_android_launch.png
```

Result: blocked before app reproduction by Android dev-client load error / Metro resolution failure and system UI not responding dialog. Metro was stopped cleanly after the attempt.

## Implementation Handoff

Implementor should make the smallest shared fix in `ExpandedCardModal`:

- Add one-sheet-at-a-time gating for root `BaseBottomSheet` when `InAppBrowserModal`, ticket browser, or share modal is open.
- Use a root close guard so hiding the parent for a child does not clear the selected card.
- Ensure `ActionButtons` still only opens normalized `https://` URLs.
- Add a structural regression in the same style as `WaveCBatch2.test.mjs` / `WaveCBatch3.test.mjs` proving the root expanded-card sheet is gated while child RN modal surfaces are open.
- Add a manual tester gate for the immediate DM expansion freeze because it was not runtime-reproduced in this forensic pass.

