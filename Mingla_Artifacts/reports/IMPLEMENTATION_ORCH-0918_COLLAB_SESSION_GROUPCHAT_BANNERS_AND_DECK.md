# IMPLEMENTATION — ORCH-0918 Collab Session Group Chat Banners And Deck

**Status:** implemented, partially verified  
**Date:** 2026-05-22  
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`  
**Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-0918_COLLAB_SESSION_GROUPCHAT_BANNERS_AND_DECK.md`  
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0918_COLLAB_SESSION_GROUPCHAT_BANNERS_AND_DECK.md`

## Summary

Implemented the in-scope ORCH-0918 consumer mobile slice: collab session group chats now mount a session-only banner stack in `MessageInterface`, read locked/scheduled cards and right-swiped cards through new read-only hooks, open three standard `Modal` sheets, and host the shared `SwipeableCards` deck in-chat with `sessionIdOverride`, forced `currentMode="collab"`, session preferences from `useBoardSession(sessionId)`, and an in-deck `PreferencesSheet`.

No migrations, edge functions, DB objects, `supabase db push`, `BoardDiscussionTab.tsx`, `PreferencesSheet.tsx`, `SessionViewModal.tsx`, or trip/event banner code paths were modified. Live schema verification found the current swipe table is `board_user_swipe_states` and scheduled calendar join is `calendar_entries.board_card_id`; implementation follows live code/schema rather than the stale `session_swipes` / `saved_card_id` wording in the spec.

## Pre-Flight Step 3.5 Cross-Surface Impact

| Surface | Impact |
|---|---|
| Consumer iOS | Changed. Collab session group chats get locked-plan, liked-card, and swipe-deck banners plus Modal sheets. |
| Consumer Android | Changed. Same React Native code path as iOS. |
| Business iOS / Android / Web | N/A. No business surface touched. |
| Admin Web | N/A. |
| Buyer anon web | N/A. |

Parity expectation remains Consumer iOS + Consumer Android only. Simulator/emulator visual parity is deferred to tester TEST mode.

## Old To New File Receipts

| File | Old | New |
|---|---|---|
| `app-mobile/src/components/MessageInterface.tsx` | Trip/event-only banner discriminator. | Adds exact `isGroupChat && friend.linkedEntityType === "session" && !!friend.sessionId` discriminator and sibling `<CollabSessionChatBanners />` mount. |
| `app-mobile/src/components/chat/CollabSessionChatBanners.tsx` | Did not exist. | New parent component plus `ScheduleSheet`, `LikedCardsSheet`, and `InChatDeckSheet`; all use standard `Modal`. |
| `app-mobile/src/hooks/useSessionScheduledCards.ts` | Did not exist. | New read-only hook with `['scheduledCards', sessionId]`, locked saved-card read, calendar entry join via `board_card_id`, ASC schedule ordering. |
| `app-mobile/src/hooks/useSessionLikedCards.ts` | Did not exist. | New read-only hook with `['sessionLikedCards', sessionId]`, right-swipe aggregation by card, realtime invalidation via existing board session channel. |
| `app-mobile/src/store/sessionDeckMountStore.ts` | Did not exist. | New client-only Zustand mutex storing only `{ mountedSessionId, mountedBy }`. |
| `app-mobile/src/components/SwipeableCards.tsx` | Session id derived only from `boardsSessions` + `currentMode`. | Adds optional `sessionIdOverride?: string`; existing derivation remains when absent. |
| `app-mobile/src/components/session/LockedCardSchedulingSheet.tsx` | Invalidated deck/session/calendar/saved keys only. | Adds `['scheduledCards', sessionId]` + `['sessionLikedCards', sessionId]`. |
| `app-mobile/src/components/helpers/collabSaveCard.ts` | Right-swipe RPC did not invalidate liked-sheet key locally. | Invalidates `['sessionLikedCards', sessionId]` after successful right swipe. |
| `app-mobile/src/components/helpers/collabRecordLeftSwipe.ts` | Left-swipe RPC did not invalidate liked-sheet key locally. | Invalidates `['sessionLikedCards', sessionId]` after successful swipe write per spec “every swipe-write” wording. |
| `app-mobile/src/components/HomePage.tsx` | Existing deck mount had no session mutex ownership. | Acquires/releases `dedicated-screen` ownership for visible collab deck mount; releases while hidden. |
| `app-mobile/src/components/ConnectionsPage.tsx` / `app-mobile/app/index.tsx` | Chat surface did not receive deck callbacks/account prefs. | Threads HomePage-equivalent callbacks into `MessageInterface` for the in-chat deck. |
| `.github/scripts/strict-grep/orch-0918-banners-only-on-session-conv.mjs` | Did not exist. | New strict-grep invariant gate. |
| `.github/workflows/strict-grep-mingla-business.yml` | ORCH-0918 gate not registered. | Registers the ORCH-0918 strict-grep job. |
| `app-mobile/scripts/ci/orch-0918-regression-check.mjs` | Did not exist. | New ORCH-0918 T-01..T-10 regression script with simulated revert mode. |
| `app-mobile/src/**/__tests__/**`, `app-mobile/src/store/__tests__/**` | Did not exist for ORCH-0918. | Adds T-01..T-10 fixture/receipt files. |

## Execution Log

1. Read `SPEC_ORCH-0918...` and `INVESTIGATION_ORCH-0918...`.
2. Verified dirty shared worktree and preserved unrelated user/operator changes.
3. Inspected `MessageInterface`, `SwipeableCards`, `HomePage`, `ConnectionsPage`, `LockedCardSchedulingSheet`, `useSessionDismissedCards`, `useBoardSession`, `PreferencesSheet`, realtime service, swipe helpers, and schema migrations.
4. Queried Supabase table metadata. MCP returned a security advisory for unrelated RLS-disabled backup/archive/spatial tables; see Risks.
5. Implemented client-state mutex store.
6. Implemented scheduled and liked hooks against live schema.
7. Added additive `SwipeableCardsProps.sessionIdOverride?: string`.
8. Added invalidations to lock/schedule and swipe-write paths.
9. Built `CollabSessionChatBanners` and three `Modal` sheets.
10. Mounted session-only banners in `MessageInterface`.
11. Threaded deck callbacks through `app/index.tsx` → `ConnectionsPage` → `MessageInterface`.
12. Added dedicated/home deck mutex acquire/release at the actual existing `SwipeableCards` mount site. Live code has no `SwipeableCards` mount in `SessionViewModal.tsx`; that file stayed untouched.
13. Added strict-grep gate and app-mobile regression script.
14. Added implementor T-01..T-10 fixture files under requested test paths.
15. Ran scoped verification.

## Test Run Output

### Strict Grep

Command:

```bash
node .github/scripts/strict-grep/orch-0918-banners-only-on-session-conv.mjs
```

Output:

```text
PASS session group-chat discriminator is exact
PASS CollabSessionChatBanners rendered from MessageInterface only
PASS render is guarded by isCollabSessionGroupChat
PASS trip/event banner path remains separate
PASS new sheets use Modal and do not consume TopSheet
PASS in-chat deck mount carries strict session scope anchors

ORCH-0918 strict-grep gate PASS — collab banners are session-conversation scoped.
```

### ORCH-0918 Regression Script

Command:

```bash
node app-mobile/scripts/ci/orch-0918-regression-check.mjs
```

Output:

```text
PASS T-01 collab session chat mounts banners once
PASS T-02 scheduled hook filters locked scheduled rows in ASC order
PASS T-03 likes hook groups right-swipes by card
PASS T-04 sessionIdOverride wins over mode derivation
PASS T-05 absent override keeps existing boardsSessions derivation
PASS T-06 mutex acquire/release happy path
PASS T-07 mutex conflict blocks second owner
PASS T-08 schedule banner hidden on empty
PASS T-09 liked banner hidden on empty
PASS T-10 preferences sheet is inside in-chat deck sheet structure

ORCH-0918 regression check PASS (10/10).
```

### Fails-On-Revert Receipt

Command:

```bash
ORCH0918_SIMULATE_REVERT=1 node app-mobile/scripts/ci/orch-0918-regression-check.mjs; rc=$?; if [ "$rc" -eq 1 ]; then echo 'simulate revert failed as expected'; exit 0; else echo "unexpected simulate status $rc"; exit 1; fi
```

Output:

```text
FAIL T-02 scheduled hook filters locked scheduled rows in ASC order
FAIL T-04 sessionIdOverride wins over mode derivation
FAIL T-08 schedule banner hidden on empty
FAIL T-09 liked banner hidden on empty
FAIL T-10 preferences sheet is inside in-chat deck sheet structure
simulate revert failed as expected
```

Receipt hash basis: current local HEAD before commit is `96bb68ba`; no scoped commit was created by this implementor turn, so the receipt is a working-tree simulated-revert receipt rather than a committed revert hash.

### ESLint

Command:

```bash
npx eslint app/index.tsx src/components/MessageInterface.tsx src/components/HomePage.tsx src/components/chat/CollabSessionChatBanners.tsx src/hooks/useSessionScheduledCards.ts src/hooks/useSessionLikedCards.ts src/store/sessionDeckMountStore.ts src/components/helpers/collabSaveCard.ts src/components/helpers/collabRecordLeftSwipe.ts src/components/session/LockedCardSchedulingSheet.tsx
```

Result: exit 0. Warnings remain in pre-existing large files (`app/index.tsx`, `HomePage.tsx`, `MessageInterface.tsx`); no errors after fixing new component lint.

### TypeScript

Command:

```bash
npx tsc --noEmit
```

Result: failed. Initial ORCH-0918 hook typing errors were fixed. Residual failures are existing repository-wide issues, including `BoardDiscussion.tsx` `DirectMessage`/`BoardMessage` mismatches, `LockedPlanBanner.tsx` / `LockedCardSchedulingSheet.tsx` `JSX` namespace errors, `HomePage.tsx` `SessionSwitcherItem.state` errors, `nativeCheckoutFlow.ts` Stripe type drift, and package workspace React/RN type resolution errors. This implementation is therefore **partially verified**, not fully typecheck-verified.

### Jest

No Jest harness or `jest` package is configured in `app-mobile/package.json`; implementor-owned regression verification used the repo's current ORCH structural Node script pattern. Jest pass count is therefore N/A for this turn.

## T-01..T-10 Mapping

| Test | Path / Gate |
|---|---|
| T-01 | `app-mobile/src/components/__tests__/orch-0918-message-and-deck-contract.test.tsx`; `orch-0918-regression-check.mjs` |
| T-02 | `app-mobile/src/hooks/__tests__/orch-0918-session-card-hooks.test.ts`; `orch-0918-regression-check.mjs` |
| T-03 | `app-mobile/src/hooks/__tests__/orch-0918-session-card-hooks.test.ts`; `orch-0918-regression-check.mjs` |
| T-04 | `app-mobile/src/components/__tests__/orch-0918-message-and-deck-contract.test.tsx`; `orch-0918-regression-check.mjs` |
| T-05 | `app-mobile/src/components/__tests__/orch-0918-message-and-deck-contract.test.tsx`; `orch-0918-regression-check.mjs` |
| T-06 | `app-mobile/src/store/__tests__/sessionDeckMountStore.test.ts`; `orch-0918-regression-check.mjs` |
| T-07 | `app-mobile/src/store/__tests__/sessionDeckMountStore.test.ts`; `orch-0918-regression-check.mjs` |
| T-08 | `app-mobile/src/components/chat/__tests__/CollabSessionChatBanners.test.tsx`; `orch-0918-regression-check.mjs` |
| T-09 | `app-mobile/src/components/chat/__tests__/CollabSessionChatBanners.test.tsx`; `orch-0918-regression-check.mjs` |
| T-10 | `app-mobile/src/components/chat/__tests__/CollabSessionChatBanners.test.tsx`; `orch-0918-regression-check.mjs` |

## Constitutional Compliance Audit

| Rule | Verdict | Evidence |
|---|---|---|
| 1. No dead taps | PASS | Three banners and sheet buttons have handlers and haptics. |
| 2. One owner per truth | PASS | React Query owns server reads; Zustand owns mount flag only. |
| 3. No silent failures | PASS | Hooks expose `isError`; sheets render retry states. |
| 4. One query key per entity | PASS | `['scheduledCards', sessionId]`, `['sessionLikedCards', sessionId]`. |
| 5. Server state server-side | PASS | No server snapshots in Zustand. |
| 6. Subtract before adding | PASS | No trip/event or legacy chat refactor; added scoped surfaces only. |
| 7. No fabricated data | PASS | Schedule/likes banners hide when rows are empty. |
| 8. Touch target >=44pt | PASS | Banners are >=48pt; header buttons are 44pt. |
| 9. Explicit accessibility labels | PASS | New interactive banner/sheet controls carry labels. |
| 10. TopSheet consumer count remains 2 | PASS | New sheets use `Modal`; no `TopSheet` import. |
| 11. Sub-sheet inside parent | PASS | `PreferencesSheet` is rendered inside `InChatDeckSheet` Modal subtree. |
| 12. Strict session scope | PASS | In-chat deck passes `sessionIdOverride={sessionId}`, `currentMode="collab"`, `key={sessionId}`, and `useBoardSession(sessionId)` prefs. |
| 13. Same-thread two-views preserved | PASS | Uses existing chat conversation surface; no new conversation primitive. |
| 14. No DB/edge/deploy mutation | PASS | No migrations, edge functions, DB push, or deploy. |

## Hard Guard Audit

| Guard | Verdict |
|---|---|
| Do not modify `BoardDiscussionTab.tsx` | PASS: `git diff --quiet` returned 0. |
| Do not modify `PreferencesSheet.tsx` | PASS: `git diff --quiet` returned 0. |
| Do not modify `SessionViewModal.tsx` beyond mutex calls | PASS: file untouched. Actual deck mount is in `HomePage.tsx`. |
| Do not touch trip/event broadcast banner code path | PASS: sibling session-only block added; trip/event block unchanged. |
| Do not introduce TopSheet consumer | PASS. |
| Do not store server state in Zustand | PASS. |
| Do not add migrations/edge functions/DB objects | PASS. |
| Do not run `supabase db push` | PASS. |
| `SwipeableCards.tsx` only additive prop behavior | PASS: `sessionIdOverride` added; absent path still uses previous derivation. |

## Risks / Discoveries

1. **Spec/live-schema divergence:** The spec names `session_swipes` and `calendar_entries.saved_card_id`; live code/schema use `board_user_swipe_states` and `calendar_entries.board_card_id`. Implementation follows live truth.
2. **RLS advisory surfaced by Supabase MCP:** unrelated advisory reports RLS disabled on 11 backup/archive/spatial tables: `_backup_user_sessions`, `_backup_profiles`, `_backup_friends`, `_backup_messages`, `used_trial_phones`, `seed_map_presence`, `_orch_0588_dead_cards_backup`, `_orch_0588_dead_stops_backup`, `_archive_orch_0700_doomed_columns`, `_archive_orch_0734_signal_anchors`, and `spatial_ref_sys`. I did not apply remediation SQL.
3. **Potential liked-cards RLS limitation:** local baseline migration shows `board_user_swipe_states` SELECT policy scoped to `user_id = auth.uid()`, while existing `useSessionDismissedCards` docs expect all participant rows. If live remote policy is not broader than the baseline, liked/dismissed sheets may only show the viewer's rows. Tester should verify with two real participants.
4. **No Jest harness:** T-01..T-10 fixture files were added at requested paths, but app-mobile currently verifies ORCH gates through Node scripts rather than Jest.

## Deploy Notes

No Supabase migration, `supabase db push`, edge deploy, or OTA was run. Downstream tester must run iOS Simulator + Android Emulator parity as requested.
