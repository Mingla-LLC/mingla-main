# Investigation Report: Card Pool Exhaustion Behavior During a Swipe Session

> Date: 2026-04-14
> Source: User question (behavioral investigation, not bug report)
> Confidence: H — all code paths read and traced
> Status: behavior fully mapped

---

## 1. Layman Summary

Yes, a user CAN exhaust all cards in a single session. Here's how it works:

When you open the app, it asks the database for ALL matching cards at once (up to 10,000).
For Nature in Raleigh, that's ~291 cards. They're all loaded into memory immediately. As
you swipe, each dismissed card is removed from the visible stack. When you've swiped through
all 291, you see a "You've seen everything" screen with two buttons: change preferences,
or review your dismissed cards.

If you close and reopen the app, you see the SAME "exhausted" state — it's persisted. The
only way to get fresh cards is to change your preferences (which resets the deck) or for new
cards to be added to the pool by the admin seeding pipeline.

There is NO server-side dedup. The old impression system was removed. Cards are NOT
excluded from future queries based on having been swiped. If you change preferences and
change back, you get the SAME 291 cards again (minus any you saved or scheduled).

---

## 2. Complete Card Lifecycle

### Fetch Phase

1. User opens app or changes preferences
2. `RecommendationsContext` computes deck params (categories, price tiers, location, etc.)
3. `useDeckCards` fires a React Query fetch calling `deckService.fetchDeck()`
4. `deckService` calls edge function `discover-cards` with `limit: 10000`
5. Edge function calls `serveCardsFromPipeline` → `query_pool_cards` RPC
6. RPC returns ALL matching cards (e.g., 291 for Nature in Raleigh)
7. Edge function applies datetime/hours filter, then scoring
8. Response: `{ cards: [...], metadata: { hasMore: false } }`

### Display Phase

9. `useDeckCards` stores the full card array in React Query cache
10. `RecommendationsContext` syncs cards to `recommendations` state
11. `SwipeableCards` renders the top card from the stack
12. User sees one card at a time, swipes left (dismiss) or right (save/schedule)

### Swipe Phase

13. On dismiss: card is added to `removedCards` (local component state — `useState`)
14. On dismiss: card is added to `sessionSwipedCards` (Zustand store — **persisted to AsyncStorage**)
15. `removedCards` filters the visible stack: `availableRecommendations = recommendations.filter(card => !removedCards.has(card.id))`
16. When `availableRecommendations` reaches 0 and `hasMore` is false → `isExhausted = true`

### Exhaustion Phase

17. `isExhausted` is **persisted to AsyncStorage** per user+mode key
18. UI shows "You've seen everything" with:
    - "Shift Preferences" button → opens PreferencesSheet
    - "Review All Cards" button → opens DismissedCardsSheet (shows all swiped cards)
19. Mixpanel event `deck_exhausted` is fired once

### Reset Triggers

20. Changing preferences: resets `batchSeed` to 0, clears `isExhausted`, clears `dismissedCards`, clears `accumulatedCardsRef`
21. Mode switch (solo ↔ collab): same reset
22. Logout: clears everything (`resetState()` in Zustand)

---

## 3. Key Mechanisms

### `excludeCardIds` (server-side exclusion)

**Source:** `RecommendationsContext.tsx` lines 222-246

Only contains:
- Saved card IDs (from `useSavedCards`)
- Scheduled card IDs with status pending/confirmed (from `useCalendarEntries`)

**Does NOT contain:** `sessionSwipedCards`. The comment at line 241 explicitly says:
> "Session-served IDs are NOT included here. Including session-served IDs in p_exclude_place_ids causes 0 cards after swiping through a small pool."

This means the server has NO knowledge of what the user has already swiped. Every fetch returns the same cards (minus saved/scheduled ones).

### `sessionSwipedCards` (client-side tracking)

**Source:** Zustand store `appStore.ts` lines 96, 173-179

- Array of full `Recommendation` objects (not just IDs)
- **Persisted to AsyncStorage** (line 215)
- **Capped at 200 entries** — oldest dropped on overflow (line 175-177)
- Used by `DismissedCardsSheet` to show "review your swiped cards"
- Reset on preference change (`resetDeckHistory`)

### `removedCards` (visual filtering)

**Source:** `SwipeableCards.tsx` line 430

- `useState<Set<string>>` — local component state, NOT persisted
- Controls which cards are visually hidden from the deck stack
- Reset on component remount (app restart, preference change)

### `isExhausted` (exhaustion flag)

**Source:** `RecommendationsContext.tsx` line 129

- Set to `true` when: `deckCards.length === 0 && !deckHasMore && isDeckBatchLoaded && !isDeckFetching`
- **Persisted to AsyncStorage** per user+mode key (line 207)
- Survives app restart
- Reset on: preference change, mode switch, or when new cards arrive

---

## 4. Behavioral Map

| State | What Happens | Cards in Deck | isExhausted | Persisted? |
|-------|-------------|--------------|-------------|-----------|
| **Fresh session** | All pool cards fetched at once (limit: 10000) | 291 | false | — |
| **After swiping 50** | 50 in `removedCards`, 241 visible | 241 visible | false | sessionSwipedCards has 50 |
| **After swiping 200** | sessionSwipedCards capped at 200 (oldest 0-149 dropped), 91 visible | 91 visible | false | Only last 200 swiped cards kept |
| **After swiping 291 (all)** | "You've seen everything" screen | 0 | true | Yes (AsyncStorage) |
| **Close + reopen app** | isExhausted loaded from AsyncStorage → same "exhausted" screen | 0 | true | Yes |
| **Change preferences + change back** | isExhausted reset, deck refetched → SAME 291 cards appear again | 291 | false | Reset |
| **New day, same preferences** | If isExhausted was persisted → still exhausted. Same cards if refetched. | 0 (or 291 if reset) | true (persisted) | Yes |
| **New cards seeded by admin** | If pool grows from 291 to 350, next fetch returns 350. But if isExhausted is persisted and user hasn't changed prefs, they won't see them until they trigger a reset. | Depends on reset | Stale true | Yes — BUG |

---

## 5. Findings

### 🟡 Hidden Flaw: Stale exhaustion flag blocks new cards

**HF-1: `isExhausted` persisted to AsyncStorage survives new card additions**

- **File:** `RecommendationsContext.tsx` lines 198-208
- **Code:** `AsyncStorage.setItem(exhaustionKey, isExhausted ? 'true' : 'false')`
- **Risk:** If the admin seeds 50 new Nature cards into the pool overnight, a user who exhausted the deck yesterday will still see "You've seen everything" today because `isExhausted` was persisted as `true`. The flag only resets on preference change or mode switch — not on app restart with a potentially larger pool.
- **Recommended fix:** On app cold start, clear `isExhausted` so the deck always refetches. Or compare `total_unseen` from the server against the cached exhaustion state.
- **Priority:** Fix in next wave — affects users who exhaust the deck and return later.

### 🟡 Hidden Flaw: sessionSwipedCards capped at 200 loses history

**HF-2: Only the last 200 swiped cards are preserved**

- **File:** `appStore.ts` lines 175-177
- **Code:** `if (updated.length > 200) { return { sessionSwipedCards: updated.slice(updated.length - 200) }; }`
- **Risk:** If a user swipes through 291 cards, only the last 200 are in `sessionSwipedCards`. The "Review All Cards" sheet would only show 200 of 291 swiped cards. The first 91 are silently lost.
- **Priority:** Low — 200 is a reasonable cap, but the user might expect to see all reviewed cards.

### 🔵 Observation: No server-side dedup exists

**OB-1:** The old `user_card_impressions` system was fully removed (ORCH-0408). There is ZERO server-side tracking of which cards a user has seen. Every fetch returns the full pool (minus saved/scheduled). Dedup is entirely client-side via `removedCards` (in-memory, not persisted across restarts).

This means:
- Closing and reopening the app during a session would show the same cards again (if `isExhausted` wasn't persisted, but it is)
- Changing preferences and changing back shows the same cards again
- There's no "card fatigue" protection — the same 291 cards are served forever until new ones are seeded

### 🔵 Observation: `batchSeed` pagination exists but is effectively unused

**OB-2:** The code has batch pagination logic (`batchSeed` increments, prefetch fires for next page). But with `limit: 10000`, all cards are fetched in one request. `hasMore` is always `false` because the pool is smaller than 10,000. The pagination code is dead weight in the current configuration.

### 🔵 Observation: Good exhaustion UX exists

**OB-3:** The exhaustion state has proper UI — "You've seen everything" with actionable buttons (change preferences, review dismissed cards). Mixpanel tracking fires. This is well-implemented.

---

## 6. Answer to the User's Question

**Can a user exhaust all cards in the pool for a given category?**

**Yes.** All cards are fetched in one request (limit: 10,000). The user swipes through them one by one. When the last card is dismissed, the deck shows "You've seen everything." The exhaustion state is persisted — closing and reopening the app preserves it.

**What happens after exhaustion?**
- The user can change preferences (resets the deck)
- The user can review dismissed cards
- The user CANNOT get new cards for the same category unless new places are seeded into the pool by the admin pipeline
- If new cards ARE seeded, the user won't see them until they trigger a reset (preference change or mode switch) because `isExhausted` is stale-persisted

---

## 7. Discoveries for Orchestrator

- **DISC-1:** `isExhausted` persists across sessions and blocks new cards from being discovered. If admin seeds new places, exhausted users won't see them until they manually reset. Estimated severity: S2. Recommend: clear `isExhausted` on cold start or TTL it.
- **DISC-2:** `sessionSwipedCards` cap at 200 means "Review All Cards" loses cards in pools > 200. Estimated severity: S3. Recommend: increase cap or store only IDs instead of full Recommendation objects.

---

## 8. Recommended Next Step

No urgent fix needed — the exhaustion UX is functional. The stale `isExhausted` flag (HF-1) should be addressed before launch if the admin pipeline regularly adds new cards, otherwise users will think the pool is permanently empty.
