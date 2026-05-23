# IMPLEMENTATION ORCH-0918 REWORK 2 - Collab session group chat banners + in-chat deck + in-deck prefs

**Status:** implemented and verified  
**Date:** 2026-05-22  
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`  
**Base HEAD for receipts:** `0169b4a3` plus dirty scoped worktree changes  
**Input review:** `Mingla_Artifacts/reports/REVIEW_ORCH-0918_COLLAB_SESSION_GROUPCHAT_BANNERS_AND_DECK_REWORK.md`  
**Spec updated:** `Mingla_Artifacts/specs/SPEC_ORCH-0918_COLLAB_SESSION_GROUPCHAT_BANNERS_AND_DECK.md`

## Scope

Implemented Option A only. The in-chat deck sheet now mounts `SwipeableCards` below a nested session-scoped `RecommendationsProvider`, while the app-root provider remains unchanged for the home deck.

Hard guards held:
- Did not edit `app-mobile/src/contexts/RecommendationsContext.tsx`.
- Did not edit `app-mobile/src/components/SwipeableCards.tsx`.
- Did not edit `app-mobile/app/index.tsx`.
- Did not edit `BoardDiscussionTab.tsx`, `PreferencesSheet.tsx`, `SessionViewModal.tsx`, `SwipeableSessionCards.tsx`, trip/event broadcast paths, migrations, RPCs, RLS, or edge functions.
- Did not implement Option B mode-switch/restore.

## Phase-0 Verification

Provider prop signature:
- `RecommendationsProviderProps.currentMode?: string` confirmed at `app-mobile/src/contexts/RecommendationsContext.tsx:154`.
- Provider destructures `currentMode: propCurrentMode = "solo"` at `RecommendationsContext.tsx:168`.
- `persistedSessionId?: string | null` exists at `RecommendationsContext.tsx:158`, but was not needed for production session IDs.

Session ID resolution:
- `resolvedSessionId` returns `null` for solo, then checks hook-local `currentSession`, then `persistedSessionId`, then the UUID-regex path at `RecommendationsContext.tsx:349-351`.
- Chosen path: `<RecommendationsProvider currentMode={sessionId} key={sessionId}>`. Mingla collaboration session IDs are UUIDs, so the nested provider resolves through the UUID-regex path. `useSessionManagement()` state is hook-local and initializes `currentSession` to `null` for the nested provider instance, so the app-root mode does not override the nested provider.

Nestability:
- Provider state is instance-local React state/refs (`recommendations`, `batchSeed`, `DeckStateRegistry`, served IDs, exhaustion, dismissed cards).
- React Query reads are key-scoped. Under flag-on collab, `useDeckCards` uses `['deck-cards', 'collab', sessionId, currentPosition]`.
- AsyncStorage I/O is keyed by user plus `currentMode` for exhaustion/dismissed cards; the nested session provider writes session-scoped keys and does not mutate solo keys.
- `useBoardSession(sessionId)` registers callbacks through `realtimeService.subscribeToBoardSession` and unregisters on unmount.
- `useSessionManagement()` opens a `session_pills:${user.id}` channel per hook instance and removes it on cleanup.
- `useUserLocation`, `useUserPreferences`, and `useDeckCards` are hook/query based and tolerate multiple consumers.
- The only write-like provider mount effect in collab mode is the existing non-blocking GPS upsert via `upsert_participant_prefs`; this is already tied to collab entry and is idempotent for current user/session coordinates.

Feature flag:
- `FEATURE_FLAG_PER_CONTEXT_DECK_STATE` is `true` in `app-mobile/src/config/featureFlags.ts:85`.
- `RecommendationsContext.tsx:669-674` explicitly says this is the current production path and the legacy collab rollback path is broken if the flag is false. No stop condition triggered.

## Code Change

File: `app-mobile/src/components/chat/CollabSessionChatBanners.tsx`

```tsx
import { RecommendationsProvider } from "../../contexts/RecommendationsContext";
```

```tsx
<View style={styles.deckBody} key={sessionId}>
  <RecommendationsProvider currentMode={sessionId} key={sessionId}>
    <SwipeableCards
      key={sessionId}
      sessionIdOverride={sessionId}
      userPreferences={preferences}
      accountPreferences={accountPreferences}
      currentMode="collab"
      boardsSessions={scopedBoardsSessions}
      onCardLike={onCardLike || (async () => false)}
      onAddToCalendar={onAddToCalendar}
      onShareCard={onShareCard}
      onPurchaseComplete={onPurchaseComplete}
      onOpenCollabPreferences={() => setShowPrefsSheet(true)}
    />
  </RecommendationsProvider>
</View>
```

All existing `SwipeableCards` props were preserved exactly. The provider is additive and only changes which `RecommendationsContext` value the subtree consumes.

## Tests Added

File: `app-mobile/scripts/ci/orch-0918-regression-check.mjs`

New T-11:
- Name: `T-11 in-chat deck consumes session-scoped recommendations, not home-page recommendations`
- Asserts the in-chat deck imports and wraps `SwipeableCards` in `RecommendationsProvider currentMode={sessionId}`.
- Simulates ambient solo cards `solo-1,solo-2` and session cards `sA-1,sA-2,sA-3`.
- Fails if the nested provider is removed.

New T-A16:
- Name: `T-A16 switching chats renders each session's own deck with no cross-leak`
- Simulates opening chat session `sA`, unmounting, then opening `sB`.
- Requires disjoint rendered IDs and exact session stub matches.
- Fails if `key={sessionId}` is removed from the nested provider.

Previous saved-to-session remount test was renumbered to T-12. The original assertion body and intent were preserved.

## Strict-Grep Update

File: `.github/scripts/strict-grep/orch-0918-banners-only-on-session-conv.mjs`

Added 8th check:

```txt
PASS in-chat deck mount is wrapped in session-scoped RecommendationsProvider
```

This prevents future PRs from keeping the prop anchors while silently removing the nested context owner.

## Verification

Strict-grep:

```txt
PASS session group-chat discriminator is exact
PASS CollabSessionChatBanners rendered from MessageInterface only
PASS render is guarded by isCollabSessionGroupChat
PASS trip/event banner path remains separate
PASS new sheets use Modal and do not consume TopSheet
PASS in-chat deck mount carries strict session scope anchors
PASS in-chat deck mount is wrapped in session-scoped RecommendationsProvider
PASS saved-to-session sheet remounts SwipeableSessionCards

ORCH-0918 strict-grep gate PASS - collab banners are session-conversation scoped.
```

Regression:

```txt
npm run test:orch-0918
ORCH-0918 regression check PASS (13/13).
```

The 13 checks are T-01, T-02, T-03-rev, T-04, T-05, T-06, T-07, T-08, T-09-rev, T-10, T-11, T-12, and T-A16.

Fails-on-revert receipts:

```txt
ORCH0918_SIMULATE_REMOVE_PROVIDER=1 npm run test:orch-0918
FAIL T-11 in-chat deck consumes session-scoped recommendations, not home-page recommendations
FAIL T-A16 switching chats renders each session's own deck with no cross-leak
```

```txt
ORCH0918_SIMULATE_REMOVE_PROVIDER_KEY=1 npm run test:orch-0918
PASS T-11 in-chat deck consumes session-scoped recommendations, not home-page recommendations
FAIL T-A16 switching chats renders each session's own deck with no cross-leak
```

```txt
ORCH0918_SIMULATE_REVERT=1 npm run test:orch-0918
FAIL includes T-11 and T-A16, plus the prior ORCH-0918 anchors.
```

Scoped ESLint:

```txt
npx eslint src/components/chat/CollabSessionChatBanners.tsx scripts/ci/orch-0918-regression-check.mjs
PASS - no output
```

## Spec Updates

Updated `Mingla_Artifacts/specs/SPEC_ORCH-0918_COLLAB_SESSION_GROUPCHAT_BANNERS_AND_DECK.md`:
- Added section 3.3.3 Rule 7 requiring nested `<RecommendationsProvider currentMode={sessionId} key={sessionId}>`.
- Added section 4 SC-23d for JSX-tree + behavioral assertion.
- Updated section 5 Constitution #2 language so the in-chat session deck data owner is the nested session provider, distinct from the app-root/home provider.
- Added T-11 and T-A16 to section 6 and renumbered the saved-to-session remount check to T-12.

## Constitutional Re-Audit

- Constitution #1 no dead taps: PASS. No interaction path changed.
- Constitution #2 one owner per truth: PASS. The session deck data now comes from a session-scoped `RecommendationsProvider` subtree. Home deck data remains owned by the app-root provider. React Query still owns server deck reads; Zustand only owns the mount mutex.
- Constitution #3 no silent failures: PASS. Existing provider and `SwipeableCards` loading/error states remain intact.
- Constitution #4 one query key per entity: PASS. Collab deck query key remains `['deck-cards', 'collab', sessionId, currentPosition]`.
- Constitution #5 server state server-side: PASS. No new client server-state snapshots.
- Constitution #8 subtract before adding: PASS. No Option B mode-switch path, no provider internals changed.
- Constitution #9 no fabricated data: PASS. No banner/sheet data fabrication changed.

## Operator Smoke Checklist

Under 60 seconds on dev build:

1. Open Home in solo mode and note the first 2-3 visible solo card titles.
2. Open Friends tab, enter chat for collab session X whose location or prefs differ from solo.
3. Tap `Swipe cards together`.
4. Confirm the visible in-chat cards differ from the solo cards and match session X's expected location/prefs.
5. Close the sheet, open chat for a different session Y, tap `Swipe cards together`, and confirm the visible cards are not session X's cards.
6. Optional fast sanity: open session prefs from the sheet header, close it, and confirm the deck sheet stays mounted under the chat modal.

## Residual Risk

Nested provider mount duplicates the existing provider's query/subscription work while the sheet is open. Phase-0 found cleanup paths and no provider-internal singleton blocker, but live-device smoke should still watch for visible open-sheet jank on low-end Android. No DB, RLS, migration, or edge-function risk was introduced.

## Next Routing

Return to Seth. Next dispatch is Claude `mingla-orchestrator` REVIEW IMPL REWORK 2 to verify the nested provider JSX shape, T-11/T-A16 fails-on-revert receipts, strict-grep output, and operator-smoke checklist before live-fire smoke and tester routing.
