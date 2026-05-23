# IMPLEMENTATION — ORCH-0918 Collab Session Group Chat Banners + Deck Rework

**Status:** implemented, partially verified  
**Date:** 2026-05-22  
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`  
**Base hash for fails-on-revert receipts:** `403d89a5fb4cc223514ba60fa26ee40152363cd6`

## Summary

Reworked the saved/liked chat banner per the operator's corrected data model. The chat sheet no longer reads or aggregates `board_user_swipe_states`; it reads quorum-promoted unlocked rows from `board_saved_cards` and Modal-wraps the existing `<SwipeableSessionCards>` Cards-tab primitive so votes, RSVPs, liker names, and the admin-gated "Lock it in" CTA are inherited unchanged.

No migrations, RPCs, edge functions, RLS changes, Supabase push, `BoardDiscussionTab`, `PreferencesSheet`, `SessionViewModal`, `SwipeableSessionCards` internals, or trip/event broadcast paths were changed.

## Deletion Receipts

| Path | Removed |
|---|---|
| `app-mobile/src/hooks/useSessionLikedCards.ts` | Deleted the entire stale hook file. It previously aggregated `board_user_swipe_states` right-swipes under `['sessionLikedCards', sessionId]`, which production RLS cannot expose cross-participant. |
| `app-mobile/src/components/chat/CollabSessionChatBanners.tsx:220-294` (old file) | Deleted the custom `<LikedCardsSheet>` JSX: horizontal `FlatList`, custom card previews, avatar stack, empty/error copy, and local expanded-card behavior. |
| `app-mobile/src/components/chat/CollabSessionChatBanners.tsx:536-578` (old file) | Deleted custom liked-card styles: `horizontalList`, `likedCard`, `likedImage`, `avatarRow`, `morePill`, and related style entries. |
| `app-mobile/src/components/session/LockedCardSchedulingSheet.tsx:149` (old file) | Removed `queryClient.invalidateQueries({ queryKey: ["sessionLikedCards", sessionId] });`. |
| `app-mobile/src/components/helpers/collabSaveCard.ts:249` (old file) | Removed `queryClient.invalidateQueries({ queryKey: ['sessionLikedCards', sessionId] });` and its now-unused `queryClient` import. |
| `app-mobile/src/components/helpers/collabRecordLeftSwipe.ts:84` (old file) | Removed `queryClient.invalidateQueries({ queryKey: ['sessionLikedCards', sessionId] });` and its now-unused `queryClient` import. |
| `app-mobile/src/hooks/__tests__/orch-0918-session-card-hooks.test.ts` | Removed the liked-aggregation fixture/import and retained the scheduled-card fixture only. |

## Replacement Receipts

| Path | New contract |
|---|---|
| `app-mobile/src/components/chat/CollabSessionChatBanners.tsx:91-149` | Added `useSessionSavedCardsForSheet(sessionId)`: reads `board_saved_cards`, filters `.eq("session_id", sessionId)` + `.eq("is_locked", false)`, orders `saved_at DESC`, ranges first 20 rows, and uses query key `["savedCards", sessionId]`. It reuses the existing `board_session` realtime channel callbacks for `onCardSaved`, debounced `onMatchPromoted`, and `onCardLocked`; no new channel/table subscription was added. |
| `app-mobile/src/components/chat/CollabSessionChatBanners.tsx:382-457` | Added `<SavedToSessionCardsSheet>` as a full-screen slide `Modal` whose body mounts `<SwipeableSessionCards>`. |
| `app-mobile/src/components/chat/CollabSessionChatBanners.tsx:434-443` | Prop wiring mirrors `SessionViewModal.tsx:787-797`: `cards={savedCards}`, `sessionId={sessionId}`, `userId={currentUserId ?? undefined}`, `participantCount={participantCount}`, `onViewDetails={openExpandedCardModal}`, `loading={savedCardsLoading}`, `accountPreferences={accountPreferences}`, `isAdmin={isAdmin}`. |
| `app-mobile/src/components/chat/CollabSessionChatBanners.tsx:470-477` | Banner #2 now says `Saved to session` and counts `${savedCardsForLikesSheet.length} cards saved`; hidden when length is zero. |
| `.github/scripts/strict-grep/orch-0918-banners-only-on-session-conv.mjs` | Added the 7th strict-grep check requiring `<SwipeableSessionCards>` inside `SavedToSessionCardsSheet`. |
| `app-mobile/scripts/ci/orch-0918-regression-check.mjs` | Replaced old T-03/T-09 likes assertions with `T-03-rev`, `T-09-rev`, and added `T-11` for the remount prop contract. |
| `Mingla_Artifacts/specs/SPEC_ORCH-0918_COLLAB_SESSION_GROUPCHAT_BANNERS_AND_DECK.md` | Updated §3.2.2 to `3.2.2-rev`, §4 SC-07/SC-08, §6 tests, and stale schema references (`board_user_swipe_states`, `calendar_entries.board_card_id`). |

## Verification

| Gate | Result |
|---|---|
| `node .github/scripts/strict-grep/orch-0918-banners-only-on-session-conv.mjs` | PASS 7/7 |
| `npm run test:orch-0918 --prefix app-mobile` | PASS 11/11 |
| `ORCH0918_SIMULATE_REVERT=1 npm run test:orch-0918 --prefix app-mobile` | Expected FAIL at base hash `403d89a5fb4cc223514ba60fa26ee40152363cd6`; failed T-02, T-03-rev, T-04, T-08, T-09-rev, T-10, T-11 |
| `npx eslint ...` focused changed-file set from `app-mobile/` | PASS |
| `rg "useSessionLikedCards\|SessionLikedCardRow\|LikedCardsSheet\|sessionLikedCards\|Liked cards\|liked\\.rows\|aggregateSessionLikedCards" app-mobile/src app-mobile/scripts .github/scripts` | PASS, no matches |
| `npx tsc --noEmit --pretty false` from `app-mobile/` | FAIL on existing repo-wide type debt, including `LockedPlanBanner.tsx`/`LockedCardSchedulingSheet.tsx` `JSX` namespace plus unrelated `BoardDiscussion`, shared package, and payment type errors. No ORCH-0918-specific new error was isolated by focused ESLint/static gates. |

## Constitutional Re-Audit

| Principle | Verdict | Evidence |
|---|---|---|
| #2 one owner per truth | PASS | Server state is `board_saved_cards`; no duplicate right-swipe aggregation state remains. |
| #3 no silent failures | PASS for rework scope | The broken RLS-blind data path is deleted. The sheet consumes `<SwipeableSessionCards>` as the dedicated Cards tab does, inheriting its voting/RSVP/lock states instead of custom UI with missing capabilities. |
| #4 query-key discipline | PASS | The live keys are `["savedCards", sessionId]` and `["scheduledCards", sessionId]`; obsolete `["sessionLikedCards", sessionId]` is gone. |
| #8 subtract before adding | PASS | Deleted hook, custom sheet, custom styles, stale invalidations, and stale tests before wiring the replacement. |
| #9 no fabricated data | PASS | Banner #2 hides when `savedCardsForLikesSheet.length === 0`; copy uses the actual saved-card row count. |
| TopSheet consumer count | PASS | All three sheets use standard `Modal`; no TopSheet consumer added. |

## Discoveries

1. `SessionViewModal` does not expose a reusable saved-cards hook; it owns local state and `BoardCache`. For the chat sheet, I reused the same table/filter/order/range and React Query key `["savedCards", sessionId]` so query invalidation works cleanly in the chat surface.
2. The saved-to-session sheet listens through `realtimeService.subscribeToBoardSession(sessionId, callbacks)`. This reuses the existing `board_session:${sessionId}` channel machinery and only registers another callback set; it does not create a new table/channel subscription.
3. `npx tsc --noEmit` is not a useful close gate yet because the shared checkout has broad pre-existing type failures outside this rework. Focused ESLint plus strict-grep/regression gates are clean.

## Next Gates

Claude `mingla-orchestrator` REVIEW IMPL should verify the rework against `Mingla_Artifacts/reports/REVIEW_ORCH-0918_COLLAB_SESSION_GROUPCHAT_BANNERS_AND_DECK.md`, this report, and the updated spec. Then Claude `mingla-tester` TEST mode should run iOS Simulator + Android Emulator parity and the T-A01..T-A15 adversarial suite, including the two-real-participant production RLS proof that saved cards visible in session chat are cross-participant quorum-promoted `board_saved_cards` rows.
