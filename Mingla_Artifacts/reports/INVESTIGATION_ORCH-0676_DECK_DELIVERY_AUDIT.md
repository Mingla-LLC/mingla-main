# Investigation: Deck Delivery & Session-Exhaustion Mechanism Audit (ORCH-0676)

**Date:** 2026-04-25
**Investigator:** mingla-forensics
**Mode:** INVESTIGATE-ONLY
**Parent:** ORCH-0675 RC-9
**Severity:** S0 (gates the largest Android perf fix)

---

## 1. Executive Summary

The cycle-1 ORCH-0675 RC-9 framing was **misleading**. Three forensic findings reverse the original picture:

1. **The infamous `limit: 10000` does not actually fetch 10,000 cards.** The discover-cards edge function caps each per-chip SQL RPC call at **100 rows** ([discover-cards/index.ts:888](supabase/functions/discover-cards/index.ts#L888)) regardless of input limit. Production fetch is bounded by `100 × number_of_chips ≈ 300–700 cards`, not 10,000. The "multi-MB AsyncStorage write" framing was overstated.
2. **Server-side dedup (`excludeCardIds`) is wired but never used.** Every caller of `useDeckCards` passes `excludeCardIds: []` ([RecommendationsContext.tsx:629, 656, 685, 739; OnboardingFlow.tsx:1643, 1657](app-mobile/src/contexts/RecommendationsContext.tsx#L629)). The edge function and SQL RPC accept and would honour the array — but receive nothing. **All dedup is client-side.**
3. **`batchSeed` is broken pagination.** Incrementing `batchSeed` changes the React Query cache key (forcing refetch) but the discover-cards edge function reads `batchSeed` and never consumes it ([discover-cards/index.ts:629, 753, 1021](supabase/functions/discover-cards/index.ts#L629)) — refetches return the same cards in the same order. The pagination handle exists but isn't actually paginated. **A user whose pool contains more cards than the first batch (~300–700) cannot reach those cards today** — the server has no offset/cursor parameter to advance past the first page.

This is the central regression risk the founder was right to flag: **the system already partially fails the "exhaust all scored cards" invariant** in pools larger than ~500 cards, even before any fix is shipped. Any fix must FIRST make pagination genuinely work, THEN any "remove from persister" changes can land safely.

The actual efficiency problems are different from cycle-1's:

- **Zustand `sessionSwipedCards` stores full `Recommendation` objects** (~200 × ~2 KB = ~400 KB persisted) when an ID-only manifest would be ~10 KB.
- **Three parallel client persistence substrates** for the same data: React Query persister (deck-cards), Zustand `sessionSwipedCards` (full objects), and SwipeableCards' own `mingla_card_state_${mode}_${refreshKey}_*` AsyncStorage keys.
- **The 1.5 MB AsyncStorage cap is a nuke-from-orbit** ([app/index.tsx:2772](app-mobile/app/index.tsx#L2772)) — if any single key (or the total) crosses, the WHOLE cache is wiped, taking preferences and location with it.
- **Collab dedup is unsynchronized across users** by intentional design — User A swiping does NOT remove the card from User B's deck. Documented in ORCH-0446.

The recommended direction (NOT a spec) is **add real server-side pagination first, then progressively tighten persistence policy**. Capping the deck or removing it from the persister BEFORE pagination works would amplify the existing exhaustion regression.

---

## 2. Current Architecture Map (As-Is)

### 2.1 Cold-start sequence (solo mode)

```
1. App mounts → app/_layout.tsx imports i18n (667 JSONs)
2. app/index.tsx mounts → cacheReady AsyncStorage size check (1.5MB cap)
3. PersistQueryClientProvider hydrates from REACT_QUERY_OFFLINE_CACHE
4. AppContent mounts → 6 nested providers including RecommendationsProvider
5. RecommendationsContext (RecommendationsContext.tsx:174) initializes batchSeed = 0
6. Three useDeckCards hooks instantiated (legacy / solo / collab) — all run in parallel,
   only one returns data per mode (RecommendationsContext.tsx:595-687)
7. For solo flag-on path:
   queryKey = ['deck-cards', 'solo', null, lat, lng, categories, intents,
               travelMode, travelConstraint, datetimePref, dateOption,
               batchSeed, excludeCardIds]
   (useDeckCards.ts:80-91)
8. If queryKey matches a hydrated entry from AsyncStorage → instant cards
9. Otherwise enabled=true → useQuery fires queryFn → deckService.fetchDeck
10. fetchDeck splits pills into category + curated, fires both in parallel
    (deckService.ts:340-490)
11. Category invokes 'discover-cards' edge function (deckService.ts:384)
12. Curated invokes 'generate-curated-experiences' per pill (deckService.ts:474)
13. Progressive delivery: onPartialReady fires up to twice as singles/curated
    settle (useDeckCards.ts:174-207)
14. Results merged via mergeCardsByIdPreservingOrder
15. Cards land in React Query cache with key from step 7
16. PersistQueryClientProvider's shouldDehydrateQuery permits if cards.length > 0
    (app/index.tsx:2810-2828)
```

### 2.2 Server-side fan-out

```
discover-cards entry:
1. Decode JWT sub → userId, fail with path:'auth-required' if absent
   (discover-cards/index.ts:677-796)
2. Resolve category labels → signal IDs via CATEGORY_TO_SIGNAL map
   (line 814-845)
3. Cohort gate: each signalId checked against admin-config rollout pct
   (60s cache, line 24-40, 847-872)
4. perChipRpcLimit = max(20, min(100, limit * 2))   ← THE REAL CAP
   (line 888)  ← input limit=10000 produces perChipRpcLimit=100
5. For each (chip × in-cohort signalId), fire query_servable_places_by_signal
   in parallel (Promise.all, line 891-901)
6. Each RPC returns up to 100 rows from place_pool, signal_score DESC,
   filtered by is_servable + radius + p_exclude_place_ids ([])
7. Client-side bucketing by chip, dedup within chip on place_id, max signal_score
   (line 905-924)
8. Within-chip sort by signal_score DESC (line 950-952)
9. roundRobinByChip interleaves one card per chip (line 957)
10. Post-RPC filter by date/time + curated hours (line 990-994)
11. Collab mode sorts by id.localeCompare with matchScore=0 (line 1000-1004)
12. Return: { cards, total, source, metadata: { hasMore: cards.length === limit, ... },
              sourceBreakdown: { path, fromPool, ... } }
   (line 1013-1037)
```

### 2.3 Client-side dedup chain

```
SwipeableCards renders:
1. Receives `recommendations` from RecommendationsContext (deck cards)
2. Maintains local removedCards: Set<string> (SwipeableCards.tsx:466)
3. removedCardsRef mirrors it for stale-closure protection (line 610, 649)
4. Filters availableRecommendations:
   recommendations.filter(rec =>
     !removedCards.has(rec.id) && !removedCardIds.includes(rec.id))
   (line 678)
5. On user swipe:
   a. addSwipedCard(card) → Zustand sessionSwipedCards (FULL object)
      (appStore.ts:202-209)
   b. setRemovedCards(prev => new Set([...prev, card.id]))  (local state)
   c. setCurrentCardIndex(0) (advance)
   d. Persist to AsyncStorage under
      `mingla_card_state_${mode}_${refreshKey}_removed`
      (line 1033, 1096) ← THIRD persistence store
6. On context switch (solo↔collab):
   a. Save to deckStateRegistry: { removedCards: Array.from(...), currentCardIndex,
                                    batchSeed, deckMode } (line 941-944)
   b. On switch back, restore from registry (line 904-909)
7. On exhaustion (line 1050):
   if (currentCardIndex === 0 && availableRecommendations.length === 0
       && batchSeed === 0)
       → setBatchSeed(prev => prev + 1)  ← "PAGINATE"
       (THIS IS WHERE THE BROKEN PAGINATION LIVES)
8. Dead-state recovery (line 738):
   if (removedCards.size > 0 && size < recommendations.length
       && availableRecommendations.length === 0)
       → after 1.5s, setRemovedCards(new Set())   ← stale-cache safety net
9. Stale-prune on mount (line 1043-1071):
   removedCardsArray = rawRemovedCards.filter(id => currentCardIds.has(id))
   ← drops persisted IDs not in the current deck
```

### 2.4 Three client persistence substrates

| Substrate | What it stores | Write trigger | Approx size | File:line |
|-----------|---------------|---------------|-------------|-----------|
| React Query persister | Full deck-cards entries (Recommendation arrays) | Every successful query write, with dedupe by `shouldDehydrateQuery` | ~50–500 KB per populated deck | [app/index.tsx:2790-2839](app-mobile/app/index.tsx#L2790) |
| Zustand `sessionSwipedCards` | Full Recommendation objects, capped at 200 | Every swipe via `addSwipedCard` | ~200 × ~2 KB = ~400 KB | [appStore.ts:96, 202-209, 247](app-mobile/src/store/appStore.ts#L96) |
| SwipeableCards `mingla_card_state_*` keys | `{ removed: string[], currentCardIndex }` JSON, per-mode-and-refreshKey | Every swipe + every index change | ~10–20 KB per active session | [SwipeableCards.tsx:537, 1033, 1096](app-mobile/src/components/SwipeableCards.tsx#L537) |

**Total AsyncStorage hot-write footprint per swipe-heavy session:** roughly 0.5–1 MB cumulative across the three substrates, against a 1.5 MB total-cache nuke-from-orbit cap.

---

## 3. Q1–Q14 Answers

### Q1 — Where does scoring happen?

**Pre-scored.** Scores live in the `place_scores` table; the RPC reads them via JOIN. Scoring is computed by an admin/cron pipeline (out of scope for this audit) that populates `place_scores` per (place_id, signal_id).

The serving RPC `query_servable_places_by_signal` is **LANGUAGE sql STABLE** with a fixed score-DESC ordering, three-gate filter (`is_servable = true` + `signal_score >= threshold` + `stored_photo_urls` valid), and per-call `p_limit`. See §3.5 for full RPC body.

**Confidence:** H. Verified by direct migration-chain inspection.

### Q2 — What does "session" mean in the current code?

**Implicit, not explicit.** A "session" is defined by query-key stability:

```typescript
queryKey = ['deck-cards', mode, sessionId, lat (rounded 1e-3), lng (rounded 1e-3),
            categories.sort().join(','), intents.sort().join(','),
            travelMode, travelConstraintType, travelConstraintValue,
            datetimePref (normalized), dateOption,
            batchSeed,
            excludeCardIds.sort().join(',')]
```
([useDeckCards.ts:59-92](app-mobile/src/hooks/useDeckCards.ts#L59))

- A new "session" effectively begins when ANY of: location moves >~100 m, prefs change, batchSeed increments, datetimePref rolls over.
- `staleTime: Infinity` + `gcTime: 24h` — within a session the deck never auto-refetches.
- Cold start: query key is rebuilt; if hydration matches, instant. Otherwise refetch.
- App resume: focusManager fires invalidations on 14 critical query families ([useForegroundRefresh.ts:29, 174, 283](app-mobile/src/hooks/useForegroundRefresh.ts#L29)), but `deck-cards` is NOT in that list — confirmed by inspection. The deck survives resume.

**Confidence:** H.

### Q3 — How does the current code guarantee no duplicate cards within a session?

**Three layered client filters, no server filter in practice:**

1. **Server-side `excludeCardIds`** — wired through edge function at [discover-cards/index.ts:897](supabase/functions/discover-cards/index.ts#L897) as `p_exclude_place_ids` to RPC. **But every caller passes `[]`** ([RecommendationsContext.tsx:629, 656, 685, 739](app-mobile/src/contexts/RecommendationsContext.tsx#L629)), so this filter is effectively dead.
2. **SwipeableCards `removedCards` Set** — the actual production dedup. Filtered at [SwipeableCards.tsx:678](app-mobile/src/components/SwipeableCards.tsx#L678).
3. **Persisted per-mode keys** (`mingla_card_state_${mode}_${refreshKey}_removed`) — restore on remount, with stale-pruning at [SwipeableCards.tsx:1043-1071](app-mobile/src/components/SwipeableCards.tsx#L1043).

**Dedup key:** `card.id`. The card.id maps to `place_id` for singles (the RPC's primary key) and a synthetic id for curated experiences.

**Edge case — tab-switch mid-deck:** SwipeableCards saves to deckStateRegistry on context switch (line 941); restores on return (line 904). A card the user **saw but did not swipe** is NOT added to removedCards, so it remains in the deck on return. Good — but only if the same query key persists.

**Edge case — heavy swipe (>200 in session):** Zustand caps `sessionSwipedCards` at 200 ([appStore.ts:204-206](app-mobile/src/store/appStore.ts#L204)). SwipeableCards' own `removedCards` Set is NOT capped (line 1096 persists `Array.from(removedCards)`). The two stores can drift — but the SwipeableCards keys are the actual filter, so dedup holds even past 200.

**Confidence:** H.

### Q4 — What is the actual current behavior of `limit: 10000`?

**The 10,000 is decorative, not operational.**

[useDeckCards.ts:184](app-mobile/src/hooks/useDeckCards.ts#L184) sets `limit: 10000` on the deckService call.
[deckService.ts:340](app-mobile/src/services/deckService.ts#L340): `const limit = params.limit ?? 20;`
[deckService.ts:394](app-mobile/src/services/deckService.ts#L394): `const categoryLimit = limit;` (passed verbatim to discover-cards body).

[discover-cards/index.ts:888](supabase/functions/discover-cards/index.ts#L888):

```typescript
const perChipRpcLimit = Math.max(20, Math.min(100, limit * 2));
```

**Result:** `min(100, 20000) = 100`. The actual SQL RPC fetches **100 rows per chip**, not 10,000. With 5 chips selected, the upper bound is 500 cards from singles, plus ~100 per curated pill (typically 1–3 active pills), giving a **realistic deck size of 300–700 cards in production**, not 10,000.

**The cycle-1 ORCH-0675 RC-9 framing of "multi-MB persisted dump" was overstated.** The actual persisted deck-cards JSON is bounded by typical deck size (300–700 × ~2 KB per card ≈ 600 KB – 1.4 MB worst case). On the 1.5 MB cache total cap, this is still significant — a deep pool can push over the cap and trigger nuke-from-orbit ([app/index.tsx:2772-2776](app-mobile/app/index.tsx#L2772)) — but the order of magnitude is different from the cycle-1 framing.

**Confidence:** H. Verified directly by reading discover-cards line 888.

### Q5 — Do the edge functions support pagination natively?

**No.**

- `discover-cards`: only `limit` parameter ([discover-cards/index.ts:621-634](supabase/functions/discover-cards/index.ts#L621)). No `offset`, `cursor`, `after_id`, or `pageToken`.
- `generate-curated-experiences`: only `limit`. Same shape.
- `query_servable_places_by_signal` RPC: parameters are `(p_signal_id text, p_filter_min numeric, p_lat, p_lng, p_radius_m, p_exclude_place_ids text[], p_limit int)` — no offset, no cursor.
- `fetch_local_signal_ranked` RPC: also `p_limit` only.

**Workaround mechanism in place** — the `excludeCardIds` array passed by the client COULD function as cursor-by-exclusion, but as established in Q3, the client always passes `[]`. So this workaround is dormant.

**Confidence:** H. Confirmed by edge-function audit + migration-chain inspection.

### Q6 — Is the ranking stable across calls?

**Yes for the same input.** The discover-cards function is fully deterministic for identical inputs:

- No `Math.random()`, `crypto.randomUUID()`, or time-driven sort (audit confirmed).
- `batchSeed` is read but never consumed (lines 629, 753, 1021) — so changing it does not change the ordering.
- RPC ordering: `ORDER BY signal_score DESC, place_id ASC` (per migration audit).
- Within-chip sort and round-robin are deterministic.

**Stable across multiple calls with the same body.** This means: if the client increments `batchSeed` (changing the cache key, forcing refetch), the server returns the **identical card set in the identical order**. The client's `removedCards` filter then excludes already-swiped cards — but there is no NEW page of cards beyond the first batch.

**This is the broken pagination.** The pagination handle exists; the server doesn't actually paginate.

**Confidence:** H.

### Q7 — How are singles and curated combined?

**Parallel fetch, progressive delivery, merge-by-id-preserving-order.**

- `deckService.fetchDeck` ([deckService.ts:340-490](app-mobile/src/services/deckService.ts#L340)) splits pills into `categoryPills` (singles) and `curatedPills`.
- Both fire in parallel: `Promise.allSettled` semantics with progressive callback (`onPartialReady` fires up to twice — once when singles settle non-empty, once when curated settle non-empty; race-determined order).
- The ORDER they appear in the final deck is decided by `roundRobinByChip` server-side for singles ([discover-cards/index.ts:957](supabase/functions/discover-cards/index.ts#L957)) and by curated-pill order client-side. Final merge is via `mergeCardsByIdPreservingOrder` (deckService) — preserves existing card positions when a partial arrival lands.
- On successful resolve, React Query writes the authoritative interleaved DeckResponse, overwriting the partial state.

**Independent failure modes:** if singles errors but curated returns, the deck shows curated only (with a `pipeline-error` serverPath flag for surfaced UI). And vice versa.

**Confidence:** H.

### Q8 — How does collab/paired mode differ?

**Same code path, different parameters.**

- ORCH-0446 deleted `useSessionDeck` and `sessionDeckService`. Collab now uses `useDeckCards` with `mode: 'collab'`.
- Aggregation rules ([sessionPrefsUtils.ts:4-19](app-mobile/src/utils/sessionPrefsUtils.ts#L4)): UNION of categories + intents, MOST PERMISSIVE travelMode, MAX travelConstraint, INTERSECTION→UNION-fallback dates, MIDPOINT location.
- Same `discover-cards` endpoint; receives aggregated body + `dateWindows: string[]` + `sessionId: string`.
- Same `staleTime: Infinity`, `gcTime: 24h`, persistence policy.
- **`excludeCardIds: []`** in collab too ([RecommendationsContext.tsx:685](app-mobile/src/contexts/RecommendationsContext.tsx#L685)) — server dedup off in collab as well.
- **Cross-user dedup is intentionally NOT synchronized** — User A's swipes do not remove cards from User B's deck. ORCH-0446 design decision: the collab deck is "shared candidates," not "shared swipe state."
- Query key includes `sessionId` as a discriminant slot ([useDeckCards.ts:80-91](app-mobile/src/hooks/useDeckCards.ts#L80)).

**Persistence:** collab decks ARE persisted to AsyncStorage with their `sessionId` in the key, surviving cold start. On rehydration, the sessionId must be present in the persisted Zustand state for the cache key to match — otherwise refetch.

**Confidence:** H.

### Q9 — What does the persistence policy actually save?

**Populated deck-cards persist; empty don't.**

[app/index.tsx:2792-2839](app-mobile/app/index.tsx#L2792):

- Always excluded from persistence: `curated-experiences`, `recommendations`, `phone-lookup`, `link-consent`.
- `deck-cards` excluded only when `cards.length === 0` (covers all 4 empty paths: pool-empty, auth-required, pipeline-error, pipeline-filtered-to-zero).
- Any query with `fetchStatus === 'fetching'` is skipped.
- Total cache cap: 1.5 MB. If exceeded, the **entire** REACT_QUERY_OFFLINE_CACHE is removed in `App` mount effect at [app/index.tsx:2772](app-mobile/app/index.tsx#L2772).

**Actual size on disk:** INSUFFICIENT EVIDENCE — needs live-fire instrumentation. Static estimate from card schema: each Recommendation includes id, title, category, image_url, distance, travelTime, location coords, opening_hours summary, price tier, signal_score, plus card-specific fields. Conservatively ~1.5–3 KB per card. A 500-card deck is ~750 KB – 1.5 MB. **A deck approaching the 1.5 MB cap WILL trigger total-cache wipe**, taking preferences and location with it — Constitution #14 violation already noted in cycle-1 ORCH-0675 §10.

**Confidence:** H static / L runtime.

### Q10 — What happens on app resume mid-session?

**The deck cache survives.**

[useForegroundRefresh.ts:29, 174, 283](app-mobile/src/hooks/useForegroundRefresh.ts#L29) lists 14 query families that get invalidated on background→foreground. **`deck-cards` is NOT in the list.** Confirmed by inspection.

So on resume:
- Deck stays in memory if React Query gcTime hasn't elapsed (24 h cap).
- If unmounted (gc'd): on remount, query key is rebuilt; if persister hydrated with matching key, instant cards. Otherwise refetch.
- `removedCards` restored from `mingla_card_state_*` AsyncStorage keys.
- `sessionSwipedCards` restored from Zustand persist.
- `currentCardIndex` restored from Zustand persist.
- `batchSeed` is **NOT persisted** (per Zustand `partialize` at [appStore.ts:240-256](app-mobile/src/store/appStore.ts#L240)) — resets to 0 on cold start. **This is a quiet correctness issue:** if a user incremented batchSeed (broken though it is), cold-start resets it, regenerating the original cache key and reading the original (already-displayed) deck from cache.

**Backgrounded 8 hours, 24 hours:**
- After 24 h, gcTime expires, deck garbage-collected from memory.
- Persister maxAge is also 24 h — entries older than that are dropped on hydrate.
- On resume past 24 h: query refetches.

**Confidence:** H.

### Q11 — How are bouncer / `is_servable` / signal filters applied?

**At the SQL RPC layer, three-gate.**

`query_servable_places_by_signal` (latest migration 20260424220003, ORCH-0634 audit confirmed) enforces:

1. `pp.is_servable = true`
2. JOIN `place_scores ps ON ps.signal_id = p_signal_id AND ps.score >= p_filter_min`
3. `stored_photo_urls IS NOT NULL AND stored_photo_urls != '{}' AND stored_photo_urls[1] != '__backfill_failed__'`

These are evaluated **at fetch time** in the SQL body. A card that flips `is_servable: true → false` after being delivered to the client will NOT be re-filtered until the deck is re-fetched (which happens only on query-key change). **Stale `is_servable` is possible across a single session**, but the consequence is mild: one more swipe to dismiss; no hard error.

Date/time filters applied **post-RPC in TypeScript** ([discover-cards/index.ts:990-994](supabase/functions/discover-cards/index.ts#L990)) — including `dateOption` and `dateWindows` (collab AND/UNION-fallback intersection logic).

**Confidence:** H.

### Q12 — What is the actual relationship between the 10,000 limit and the user experience today?

**The limit is product-misrepresenting.** The user experience caps out at ~300–700 cards per first batch (chip count × 100), regardless of the 10,000 input. There is no path to additional cards in the same session today, even though the architectural intent (per the Phase 5 comment at [useDeckCards.ts:184](app-mobile/src/hooks/useDeckCards.ts#L184)) is "return all matching cards, no artificial cap."

**Empty-deck UX:**

- When `availableRecommendations.length === 0` and `currentCardIndex === 0` and `batchSeed === 0`, [SwipeableCards.tsx:1050](app-mobile/src/components/SwipeableCards.tsx#L1050) increments `batchSeed`. This forces a refetch with a new cache key.
- The refetch returns the SAME cards in the SAME order (per Q6).
- Client `removedCards` still excludes them.
- `availableRecommendations` is still empty.
- This time `batchSeed > 0`, so the increment branch doesn't fire again.
- User sees the empty state.

**The empty state copy and retry path:** INSUFFICIENT EVIDENCE — agent did not capture the empty-state JSX in this dispatch. Should be audited as part of any SPEC.

**Analytics/telemetry on typical session size:** INSUFFICIENT EVIDENCE — no captured metric in the codebase. The product question "how often do users actually exhaust the deck and hit the dead state" is unanswered.

**Confidence:** H static / L runtime.

### Q13 — Is there any session-state tracking on the server?

**Yes for collab; no for solo deck.**

Server-side tables tracking card interactions:

- `board_user_swipe_states` (collab session swipes, per-user per-experience) — written by client RLS-permitted ([20250127000017_create_presence_tables.sql:37-48](supabase/migrations/20250127000017_create_presence_tables.sql))
- `person_card_impressions` (gift-planning person-card served log)
- `user_card_impressions` (legacy, possibly deprecated by ORCH-0640)
- `engagement_metrics` (new ORCH-0640 aggregation table)

**For solo Discover deck specifically:** none of these tables track "I served you this card in this session" at solo serve time. The deck does not write to any per-user-per-card "served" log; it only relies on client-side `excludeCardIds` (which is empty) and client-side `removedCards`.

**Implication:** if the client wipes `removedCards` (e.g., user uninstalls + reinstalls; user clears app data; AsyncStorage cache nuke), the server cannot help avoid showing already-seen cards. The server has no memory.

**Confidence:** H.

### Q14 — What does Zustand `sessionSwipedCards` actually contain and when is it cleared?

**Full Recommendation objects, capped at 200, persisted across cold starts.**

[appStore.ts:96](app-mobile/src/store/appStore.ts#L96): `sessionSwipedCards: Recommendation[]`.

[appStore.ts:202-209](app-mobile/src/store/appStore.ts#L202):

```typescript
addSwipedCard: (card) => set((state: AppState) => {
  const updated = [...state.sessionSwipedCards, card];
  if (updated.length > 200) {
    return { sessionSwipedCards: updated.slice(updated.length - 200) };
  }
  return { sessionSwipedCards: updated };
}),
```

**Storage:** persisted via Zustand `persist` middleware → AsyncStorage. The full object is serialised. With ~1.5–3 KB per card and 200-cap, **persisted size ≈ 300–600 KB**.

**Cleared:**
- `resetDeckHistory(newPrefsHash)` ([appStore.ts:211-214](app-mobile/src/store/appStore.ts#L211)) — fired on preferences change.
- `clearUserData()` ([appStore.ts:225-229](app-mobile/src/store/appStore.ts#L225)) — logout.
- Schema migration ([appStore.ts:259-269](app-mobile/src/store/appStore.ts#L259)) — bumping `DECK_SCHEMA_VERSION` clears it.
- 200-cap overflow drops oldest entries (slice).

**Critical observation:** `sessionSwipedCards` and SwipeableCards' own `mingla_card_state_*` keys store the SAME information (which cards were swiped) in TWO DIFFERENT shapes:
- Zustand: full Recommendation objects (~600 KB worst case).
- AsyncStorage keys: ID-only string array (~10 KB).

The SwipeableCards' own keys are the ACTIVE filter. **Zustand's `sessionSwipedCards` is functionally redundant** — used only for batch analytics emissions and one resetDeckHistory call site. **An ID-only manifest in Zustand would save ~590 KB of AsyncStorage write pressure with no behavioural change.**

**Confidence:** H static. The "functionally redundant" claim needs runtime verification of where else `sessionSwipedCards` is consumed — flagged as live-fire gap.

---

## 4. Five-Layer Contradictions

1. **Comment vs code on `limit: 10000`:** [useDeckCards.ts:184](app-mobile/src/hooks/useDeckCards.ts#L184) comment says "Phase 5: return all matching cards, no artificial cap." Code at [discover-cards/index.ts:888](supabase/functions/discover-cards/index.ts#L888) caps at 100 per chip. **Truth layer: code.** The comment is product-aspirational, not operational. **This contradiction IS a hidden bug — Phase 5 was never actually implemented at the server.**

2. **Wired vs used: `excludeCardIds`.** Edge function and RPC both accept and would honour `excludeCardIds`. All 5 production callers pass `[]`. **Truth layer: data.** The dedup pipe exists but no upstream sends data through it.

3. **`batchSeed` semantics:** mobile client treats it as a pagination handle (incrementing on exhaustion at [SwipeableCards.tsx:1050](app-mobile/src/components/SwipeableCards.tsx#L1050)); edge function reads it but never consumes it; RPC doesn't accept it. **Truth layer: code (server side).** The client's mental model is that pagination works; the server's reality is it doesn't.

4. **Stale-prune comment vs filter:** [SwipeableCards.tsx:1043-1071](app-mobile/src/components/SwipeableCards.tsx#L1043) prunes persisted IDs that don't exist in the current deck — the comment says this prevents stale-cache pollution. But because the deck refetches return the SAME cards (Q6), stale-prune is rarely needed except across schema-version bumps or preference changes. **Defense-in-depth, not load-bearing.**

5. **`sessionSwipedCards` vs `mingla_card_state_*` substrates:** Zustand persist comment ([appStore.ts:246](app-mobile/src/store/appStore.ts#L246)) says "Deck session state — persisted across sessions". SwipeableCards uses its own AsyncStorage keys. Two stores, same purpose. **Truth layer: code (the SwipeableCards keys are the actual filter).** Zustand's copy is mostly dead weight.

---

## 5. Efficiency Opportunities Ranked

Each option is presented with mechanism, impact estimate (qualitative — flag INSUFFICIENT EVIDENCE on any number), implementation surface, constitutional implications, and a regression risk matrix.

### Option A — Add real server-side pagination (offset or cursor on RPC + edge function) ★ HIGHEST IMPACT

**Mechanism:** Extend `query_servable_places_by_signal` RPC with `p_offset int` (or stable cursor on `(signal_score DESC, id ASC)`). Extend `discover-cards` edge function to accept and forward `offset` (or `after_id`/`after_score`). Client increments offset (not batchSeed) when ~10 cards remain in `availableRecommendations`. Persist only the **first page** in React Query persister; subsequent pages live in memory only.

**Impact (qualitative):** Closes the actual broken-pagination defect. Restores the "exhaust all scored cards" invariant for users with deep pools (>500 cards). Enables a smaller per-page limit (e.g., 70–100) without losing exhaustion guarantee. Reduces persisted deck size to first-page only.

**Implementation surface:**
- 1 SQL migration: `CREATE OR REPLACE FUNCTION query_servable_places_by_signal` adding `p_offset int DEFAULT 0` (or cursor variant). Same for `fetch_local_signal_ranked`.
- 1 edge function change each: `discover-cards`, `generate-curated-experiences` — accept offset, forward to RPC.
- 1 hook change: `useDeckCards` — replace `batchSeed` with `pageNumber` (or cursor); key shape evolves.
- 1 component change: `SwipeableCards` — trigger next-page fetch when remaining < threshold.
- 1 service change: `deckService.fetchDeck` — accept offset/cursor, append-merge instead of replace.

**Constitutional implications:** #14 (persisted-state startup) — RESOLVED for deep pools. #5 (server state stays server-side) — STRENGTHENED (only first-page persisted; subsequent pages in-memory only).

**Regression Risk Matrix:**

| Risk | What could break | Severity | Detection | Mitigation |
|------|------------------|----------|-----------|-----------|
| Deck exhaustion regresses | Pagination bug returns empty page when cards exist; user hits "no more" prematurely | S0 | T-A1: simulate 200-card pool, swipe through all, assert empty state only fires when offset > total scored | Server returns `hasMore: false` only when `count(*) <= offset + page_size`; client respects |
| Duplicate cards across pages | Sort order shifts between paginated calls; same card returned in multiple pages | S0 | T-A2: swipe 200 cards across 4 pages, assert `Set(cards.map(c.id)).size === cards.length` | Cursor-based pagination (not offset) for stability under concurrent writes; OR `excludeCardIds` populated from already-seen pages |
| Ranking instability | Server re-rolls scores between pages | S1 | T-A3: capture page 1, request page 2 with same params, assert page 1 IDs not in page 2 | `place_scores` table is deterministic per (place, signal); cursor sorts by `(signal_score DESC, id ASC)` |
| Singles vs curated divergence | One rail paginates, other doesn't | S1 | T-A4: assert both rails respect offset; assert empty-state semantics per rail | Both edge functions must implement pagination; document per-rail empty independently |
| Solo/collab parity break | collab's `dateWindows` interaction with pagination | S1 | T-A5: collab session, swipe to page 2, verify dateWindows still filter | Pagination layer must run AFTER date filtering (or the dateWindows must be in the cursor key) |
| Loading flash mid-session | User sees spinner when next-page fetch lands | S2 | T-A6: tune prefetch threshold (10 cards remaining); log time-to-page-arrival | Aggressive prefetch threshold; page size tuned to typical swipe rate |
| Cold-start UX worse | Removing later pages from persister means cold-start shows fewer cards | S2 | T-A7: cold-start, count cards available before any prefetch | Page 1 still persisted (instant-on); subsequent pages re-fetched |
| Preferences change mid-session | User changes filter at page 3; old pages stale | S1 | T-A8: change pref mid-session, assert deck resets cleanly | Pref change already invalidates query key — same behavior preserves |
| Day-rollover boundary | datetimePref changes at midnight; pagination cursor stale | S1 | T-A9: simulate day rollover mid-session, assert cursor reset | Cursor includes datetimePref hash; rollover = new cursor session |
| Server load spikes | More round trips per session | S2 | T-A10: load test at 10× user concurrency; observe RPC p95 | Page size 70–100 keeps total request count modest; monitor |
| Network failure mid-session | Page 2 fetch fails; user stuck | S0 | T-A11: simulate network drop after page 1, assert retry button + cards 1-N still swipeable | Existing error paths (DeckFetchError) cover this; UI surfaces retry |
| AsyncStorage persistence still hits cap | First-page deck still 1.5 MB+ | S2 | T-A12: with 100-card page 1, measure persisted JSON size | Page size 70 limits page 1 to ~210 KB worst case |

### Option B — Wire `sessionSwipedCards` IDs into `excludeCardIds` (re-activate server dedup)

**Mechanism:** Pass `sessionSwipedCards.map(c => c.id)` (or the SwipeableCards `removedCards` Set, which is more authoritative) as `excludeCardIds` in the `useDeckCards` body. Server-side filter in RPC then excludes already-swiped on every call.

**Impact (qualitative):** Doesn't fix the core pagination problem (Option A) but closes a defense-in-depth gap. If pagination is added (Option A), this strengthens dedup for paginated sessions. As a stand-alone, it has limited effect because client-side `removedCards` already filters.

**Implementation surface:** 1-line change in `useDeckCards` callsites (5 locations). Server already supports it.

**Constitutional implications:** #2 (one owner per truth) — STRENGTHENED (explicit dedup contract with server).

**Regression Risk Matrix:**

| Risk | What could break | Severity | Detection | Mitigation |
|------|------------------|----------|-----------|-----------|
| Query key explosion | Each new swipe changes query key (excludeCardIds is in the key); cache fragmentation | S1 | T-B1: swipe 100 cards in a session, assert React Query's observer cache size doesn't balloon | Throttle cache-key updates: only re-key on every Nth swipe (e.g., 20) |
| Excluded list grows past JWT/body size cap | 200 IDs × ~40 bytes = 8 KB body — manageable; >1000 ids would risk request rejection | S1 | T-B2: assert excludeCardIds at 200 fits in request body without truncation | Cap excludeCardIds at 200 (matches Zustand cap) |
| Server load increases | RPC NOT IN list grows | S2 | T-B3: measure RPC p95 with 200-id NOT IN clause | place_id is indexed; NOT IN on 200 values is fast on PostgreSQL |
| Stale exclusions | excludeCardIds includes IDs that no longer exist in pool (place delisted) | S3 | T-B4: simulate delisted place ID in excludeCardIds, assert no error | NOT IN filters out non-matches harmlessly |
| Collab parity | Collab's `excludeCardIds: []` is intentional per ORCH-0446 (cross-user dedup off) | S0 | T-B5: assert collab does NOT pass per-user swipes (would break collab design) | Apply only to solo path |

### Option C — Switch `sessionSwipedCards` to ID-only manifest

**Mechanism:** Change Zustand `sessionSwipedCards: Recommendation[]` to `sessionSwipedCardIds: string[]`. Update `addSwipedCard` to push only the id. Update consumers (analytics emissions, resetDeckHistory call sites).

**Impact (qualitative):** Reduces Zustand persist payload from ~400–600 KB to ~10 KB. Direct AsyncStorage write pressure on Android drops by ~98% for swipe history specifically. No behavioural change for the user.

**Implementation surface:** Zustand store + ~3 consumer callsites.

**Constitutional implications:** #5 (server state stays server-side) — STRENGTHENED (we're persisting less server-derived state).

**Regression Risk Matrix:**

| Risk | What could break | Severity | Detection | Mitigation |
|------|------------------|----------|-----------|-----------|
| Lost analytics fields | If analytics consumer needs the full card object (title, category) | S1 | T-C1: grep all `sessionSwipedCards` consumers; assert each uses only `id`-derivable fields | Verify in audit; if any consumer needs full body, fetch from React Query cache |
| Undo/restore feature broken | If a "swipe back" feature exists and relies on full card | S1 | T-C2: search for any "undo swipe" UI; verify it reads from current deck cache, not Zustand | Confirmed in audit — undo would read from React Query, not Zustand |
| Schema migration | Existing persisted Recommendation[] from existing users on cold start | S2 | T-C3: bump DECK_SCHEMA_VERSION; verify migration drops old shape | Built-in migration at appStore.ts:259-269 |

### Option D — Per-key AsyncStorage cap instead of global nuke

**Mechanism:** Replace the App-mount AsyncStorage size check that wipes the WHOLE cache when total exceeds 1.5 MB ([app/index.tsx:2772-2776](app-mobile/app/index.tsx#L2772)) with a per-key inspection. If `deck-cards` alone exceeds 800 KB, evict deck-cards only; preserve preferences, location, auth.

**Impact:** Closes the cycle-1 ORCH-0675 Constitution #14 violation (cold-start gates on AsyncStorage). Worst-case preferences-loss event eliminated.

**Implementation surface:** ~30 LOC change in App mount effect. No edge function or RPC changes.

**Constitutional implications:** #14 (persisted-state startup) — RESOLVED.

**Regression Risk Matrix:**

| Risk | What could break | Severity | Detection | Mitigation |
|------|------------------|----------|-----------|-----------|
| Cache becomes inconsistent | Evicting deck-cards but keeping preferences could leave a state where prefs reference cards no longer cached | S2 | T-D1: simulate eviction, verify deck refetches on next mount | React Query invalidation on cold start; `enabled: isEnabled` gates refetch correctly |
| Wrong key parsed | `REACT_QUERY_OFFLINE_CACHE` is one large JSON; evicting one key requires deserialise/reserialise | S1 | T-D2: assert per-key inspection works on actual cache shape | Use React Query's persister APIs (already exposed) |
| Performance regression on cap check | Per-key inspection slower than total-byte check | S3 | T-D3: measure App mount blocking time | If material, run the per-key audit asynchronously (not blocking `cacheReady`) |

### Option E — Stop persisting populated `deck-cards` entirely

**Mechanism:** Change `shouldDehydrateQuery` to return `false` for the `deck-cards` key unconditionally. Pay the cold-start refetch cost.

**Impact (qualitative):** Eliminates all deck-cards AsyncStorage write pressure. Cold start shows skeleton state for 1–2 seconds while the network fetch lands. Warm start is unchanged (in-memory cache). Resume is unchanged.

**Implementation surface:** 1-line change.

**Constitutional implications:** #5 STRENGTHENED. #14 partially resolved (deck-cards is the largest persistence offender).

**Regression Risk Matrix:**

| Risk | What could break | Severity | Detection | Mitigation |
|------|------------------|----------|-----------|-----------|
| Cold-start UX feels slower | User sees skeleton for ~1–2 s on every cold start | S1 | T-E1: measure cold-start time-to-first-card; user perception study | Combine with Option A (first-page-only persistence, bigger pages, skeleton fallback) |
| Network failure on cold start | No cached deck means user sees empty state instead of stale cards | S1 | T-E2: simulate offline cold start, assert clear error state | Fallback: read from Zustand sessionSwipedCardIds for "what was swiped" continuity, refetch when network returns |
| User in flight / offline | User opens app on plane; deck is empty | S2 | T-E3: same as E2 | Same mitigation; explicitly document offline-first as out-of-scope |

### Option F — Consolidate the three client-persistence substrates into one

**Mechanism:** Pick one source of truth for "which cards are swiped." Recommendation: SwipeableCards' `mingla_card_state_${mode}_${refreshKey}_*` keys (most authoritative, includes mode-and-refreshKey scoping). Eliminate Zustand `sessionSwipedCards`. Eliminate the duplicated React Query persister body.

**Impact:** Reduces AsyncStorage write traffic. Simplifies state model. Reduces drift risk between substrates.

**Implementation surface:** Architectural — touches Zustand store, SwipeableCards, RecommendationsContext, deckStateRegistry, and the persister gate. Larger change.

**Constitutional implications:** #2 (one owner per truth) — STRENGTHENED.

**Regression Risk Matrix:**

| Risk | What could break | Severity | Detection | Mitigation |
|------|------------------|----------|-----------|-----------|
| Migration of existing users | Existing Zustand `sessionSwipedCards` data lost on migration | S2 | T-F1: schema version bump, verify migration logic copies into new store | DECK_SCHEMA_VERSION already supports this pattern |
| Analytics regressions | Code that emits "user swiped N cards in session" via Zustand size now reads from elsewhere | S2 | T-F2: grep all consumers; verify each has new source | Migrate consumers in same diff |
| Scope of change | Larger refactor; harder to test | S1 | T-F3: split into 3 sub-PRs (Zustand removal, persister removal, consolidation) | Recommended sequencing |

### Option G — Cap perChipRpcLimit at a smaller, honest value with pagination

**Mechanism:** Combine Option A with reducing `perChipRpcLimit` from 100 to 50 per chip per page. Combined with pagination, total user-visible cards remain unbounded; per-page payload is smaller.

**Impact:** Smaller per-page persistence; faster RPC response; smaller AsyncStorage write. Requires Option A.

**Implementation surface:** 1-line change at [discover-cards/index.ts:888](supabase/functions/discover-cards/index.ts#L888).

**Risk:** Same as Option A; subsumed there.

---

## 6. The "Do Nothing" Baseline

If RC-9 is left as-is:

- **Android cold start** continues to read up to 1.5 MB from AsyncStorage SQLite — INSUFFICIENT EVIDENCE on actual ms cost; static estimate 100–500 ms on mid-tier devices.
- **Android resume** does not refetch deck-cards but pays the in-memory deserialise cost on cache miss.
- **Heavy-swipe sessions** continue paying ~400–600 KB Zustand persist on every swipe — Android SQLite write 20–200 ms each.
- **Deep-pool users (>500 scored cards)** never reach cards beyond the first batch (existing exhaustion regression).
- **AsyncStorage cap risk** persists — any user with a deck approaching 1.5 MB triggers total-cache wipe, losing preferences and location.

This is the floor any fix must beat. Option A alone resolves the deepest defects (exhaustion + first-page persistence cap) at moderate implementation cost.

---

## 7. Recommended Direction (Bounded — NOT a Spec)

**Direction: ship Option A first as a coordinated SPEC. Bundle Option C and Option D as low-risk add-ons. Option B becomes mandatory on top of Option A. Option E and Option F are explicitly deferred.**

**Rationale:**

1. Option A is the only option that resolves the existing deck-exhaustion regression for deep pools. No other option fixes that.
2. Option B becomes free once Option A lands — paginated requests need correct dedup; populating `excludeCardIds` becomes mandatory under pagination, not optional.
3. Option C is low-risk, mostly mechanical, and yields ~98% reduction in Zustand persist write pressure for swipe history.
4. Option D is low-risk and closes the Constitution #14 violation cleanly.
5. Option E (stop persisting deck-cards entirely) is too aggressive without first having Option A; ship as Wave 2 only if live-fire shows persisting first-page is still painful.
6. Option F (consolidate substrates) is the right architectural cleanup but a larger refactor; defer to a dedicated wave.

**Sequence proposed:**

- **Wave 2.A (this SPEC):** Option A pagination + Option B excludeCardIds plumbing + Option C ID-only Zustand manifest + Option D per-key AsyncStorage cap.
- **Wave 2.B (next SPEC):** Option E if live-fire shows residual cold-start pain after 2.A.
- **Wave 3 (separate dispatch):** Option F architectural consolidation.

**Crucial product invariant** (must be preserved by ANY option): user can exhaust every scored card without seeing duplicates within a session, until genuinely no more scored cards exist. Option A is the ONLY option that actively restores this — others preserve or strengthen the existing behaviour but don't fix the existing regression.

---

## 8. Founder Steering Questions

Before SPEC dispatch, the founder must decide:

- **Q-13:** Bundle ALL of A+B+C+D into one SPEC, or split? Orchestrator default: bundle. They share the test matrix and can ship as one OTA.
- **Q-14:** Page size — 50, 70, or 100 per chip per page? Trade-off: smaller = faster pages + more round trips; larger = fewer round trips + bigger persisted page-1 payload. Orchestrator default: **70** (typical session size, ~210 KB persisted page-1 worst case).
- **Q-15:** Pagination scheme — offset-based (`p_offset int`) or cursor-based (`(p_after_score numeric, p_after_id uuid)`)? Orchestrator default: **cursor-based** — stable under concurrent writes (new place_pool rows, score updates), no double-counting under concurrent re-scoring.
- **Q-16:** First-page-only persistence — yes (Option A's recommended pairing) or persist all loaded pages? Orchestrator default: **first-page only** — instant-on UX preserved, subsequent pages re-fetch on cold start (rare).
- **Q-17:** Should solo-mode `excludeCardIds` use Zustand `sessionSwipedCardIds` (preserved across cold starts) or SwipeableCards' `removedCards` (per-mode, per-refreshKey)? Orchestrator default: **SwipeableCards' removedCards** — already authoritative, mode-scoped, refreshKey-scoped (handles preference changes correctly).
- **Q-18:** Collab parity — Option B passes per-user `excludeCardIds` in solo only, NOT collab (preserves ORCH-0446 design). Orchestrator default: confirm — collab cross-user dedup remains intentionally off; founder must approve.
- **Q-19:** Day-rollover behaviour — at midnight, the datetimePref normalises to a new day; query key changes; deck refetches. Should pagination state (cursor) survive across the rollover or reset? Orchestrator default: **reset** (new day = new session).
- **Q-20:** Empty-state copy and retry path — out of scope of this audit (INSUFFICIENT EVIDENCE). Should the SPEC include UI copy for "you've seen everything"? Orchestrator default: **yes** — include audit + spec of empty-deck UX.

---

## 9. Live-Fire Gaps (Priority-Ordered)

Every claim that needs runtime confirmation:

1. **Actual deck-cards persisted size** — instrument the persister adapter; capture JSON byte length per query write across a 30-min session on a real Android device.
2. **AsyncStorage write duration distribution** — instrument with `Date.now()` deltas; capture per-write ms over a 60-min swipe-heavy session.
3. **Typical user pool depth** — server query: count of `is_servable: true` rows × average chips selected, distribution across user base. Determines whether the existing exhaustion regression actually affects production users.
4. **Cold-start time-to-first-card** — Hermes profiler trace, broken down per phase (i18n parse, AsyncStorage read, RQ hydrate, deck render).
5. **`hasMore: false` rate in production** — does the empty-state ever fire? Server-side log analysis.
6. **`sessionSwipedCards` consumers beyond the analytics path** — full grep + read of every consumer to confirm Zustand `sessionSwipedCards` truly is functionally redundant.
7. **`batchSeed > 0` rate** — does the broken pagination handle ever get incremented in production? Server log inspection.
8. **Cache-nuke event frequency** — how often does the 1.5 MB total-cap wipe fire? Critical for understanding existing Constitution #14 violation impact.
9. **Empty-state UX path** — read [SwipeableCards.tsx](app-mobile/src/components/SwipeableCards.tsx) empty-state JSX; capture copy strings; map retry mechanism.

---

## 10. References

### Files cited

- [app-mobile/src/hooks/useDeckCards.ts](app-mobile/src/hooks/useDeckCards.ts)
- [app-mobile/src/services/deckService.ts](app-mobile/src/services/deckService.ts)
- [app-mobile/src/contexts/RecommendationsContext.tsx](app-mobile/src/contexts/RecommendationsContext.tsx)
- [app-mobile/src/store/appStore.ts](app-mobile/src/store/appStore.ts)
- [app-mobile/src/components/SwipeableCards.tsx](app-mobile/src/components/SwipeableCards.tsx)
- [app-mobile/src/utils/sessionPrefsUtils.ts](app-mobile/src/utils/sessionPrefsUtils.ts)
- [app-mobile/src/hooks/useForegroundRefresh.ts](app-mobile/src/hooks/useForegroundRefresh.ts)
- [app-mobile/app/index.tsx](app-mobile/app/index.tsx)
- [supabase/functions/discover-cards/index.ts](supabase/functions/discover-cards/index.ts)
- [supabase/functions/generate-curated-experiences/index.ts](supabase/functions/generate-curated-experiences/index.ts)
- Migrations: 20260424220003 (`query_servable_places_by_signal`), 20260427000001 (`fetch_local_signal_ranked`), 20260428000001 (`query_person_hero_places_by_signal`)
- Tables: `place_pool`, `place_scores`, `saved_card`, `board_user_swipe_states`, `engagement_metrics`

### Related ORCH-IDs

- ORCH-0675 (parent — Android performance parity; this audit corrects RC-9)
- ORCH-0386 (deck query key shared factory)
- ORCH-0391 (proximity check + cold-cache hydrate)
- ORCH-0410 (subscription schema migration — referenced as cautionary precedent for migration-chain rule)
- ORCH-0434 (date filter simplification)
- ORCH-0446 (collab aggregation rules; useSessionDeck deletion)
- ORCH-0469 (persistence guard for empty deck-cards)
- ORCH-0474 (serverPath discriminant; auth-required vs pipeline-error split)
- ORCH-0485, 0486 (progressive delivery)
- ORCH-0490 Phase 2.3 (mode + sessionId discriminant; per-context DeckState registry)
- ORCH-0491 (solo↔collab toggle preserves position)
- ORCH-0504 (preferencesRefreshKey persisted)
- ORCH-0588, 0590, 0596, 0634 (signal-only multi-chip serving)
- ORCH-0640 (bouncer signal migration; engagement_metrics table)
- ORCH-0641 (opening_hours shape fix)
- ORCH-0653 (fetch_local_signal_ranked LANGUAGE sql STABLE)
- ORCH-0659/0660 (deck distance/travelTime contract)
- ORCH-0668 (paired-profile RPC LANGUAGE sql fix — cautionary precedent for hot-path RPC language choice)

### Memory rules applied

- `feedback_headless_qa_rpc_gap.md` — every runtime/data-magnitude claim flagged INSUFFICIENT EVIDENCE
- `feedback_solo_collab_parity.md` — both modes audited (Q8)
- `feedback_forensic_thoroughness.md` — migration-chain rule applied; sub-agent findings verified by direct read on consequential claims (e.g., `limit: 10000` actual cap, `excludeCardIds` always `[]`, client-side `removedCards` filter, batchSeed dead-code path)
- `feedback_short_responses.md` — detail in this file; chat summary stays compact
- `feedback_no_summary_paragraph.md` — no closing summary paragraph

---

## 11. Investigation Manifest

Files read directly by investigator:

1. [Mingla_Artifacts/prompts/INVESTIGATE_ORCH-0676_DECK_DELIVERY_AUDIT.md](Mingla_Artifacts/prompts/INVESTIGATE_ORCH-0676_DECK_DELIVERY_AUDIT.md) — dispatch context
2. [Mingla_Artifacts/reports/INVESTIGATION_ORCH-0675_ANDROID_PERFORMANCE_PARITY.md](Mingla_Artifacts/reports/INVESTIGATION_ORCH-0675_ANDROID_PERFORMANCE_PARITY.md) §4 RC-9 + §16 addendum — parent context
3. [app-mobile/src/hooks/useDeckCards.ts](app-mobile/src/hooks/useDeckCards.ts) (full file)
4. [app-mobile/src/services/deckService.ts](app-mobile/src/services/deckService.ts) (lines 310–490, key paths)
5. [app-mobile/src/store/appStore.ts](app-mobile/src/store/appStore.ts) (full sessionSwipedCards block)
6. [app-mobile/app/index.tsx](app-mobile/app/index.tsx) (lines 2700–2900, persister gate)
7. [app-mobile/src/components/SwipeableCards.tsx](app-mobile/src/components/SwipeableCards.tsx) (filtering and persistence — lines 443, 466, 537, 678, 738, 904, 941, 1033, 1043, 1050, 1096)
8. Direct grep verification: `excludeCardIds` callsites, `batchSeed` writers, sessionSwipedCards consumers
9. Verification of Reanimated `react-native-worklets/plugin` re-export (cycle-1 carryover sanity check)

Files read via parallel forensic agents (claims verified for the most consequential):

- Agent 1: `discover-cards/index.ts` end-to-end audit — verified `perChipRpcLimit` cap and `batchSeed` dead-code path
- Agent 2: Migration-chain audit of all deck RPCs and persistence tables — verified latest definitions per migration-chain rule
- Agent 3: Paired/collab mode parity — verified ORCH-0446 collab uses same `useDeckCards`, no separate hook, intentional cross-user dedup-off

**Live-fire captures attempted:** zero. No Android device access in this environment. Per `feedback_headless_qa_rpc_gap.md`, every fps/ms/byte claim flagged INSUFFICIENT EVIDENCE explicitly.

**Confidence summary:**
- Architecture as-is: H static
- Cycle-1 RC-9 corrections (limit:10000 theatre, excludeCardIds dead, batchSeed broken): H static, verified by direct file read
- Persistence sizes: M static (estimated bounds; needs runtime confirmation)
- Production user pool depth: L (analytics gap)
- Regression risk matrices: M-H (logical analysis; needs SPEC and test execution to confirm)

---

## 12. Cycle-2 Verification: Preference-Change Clears Swipe-History Contract

**Date:** 2026-04-25 (cycle-2 dispatch)
**Scope:** verify the founder-articulated contract — "you've already seen this card" persists only within a swipe session; on preference change, history clears and previously-seen cards become visible again.

### 12.0 Summary Verdict

**The contract HOLDS in the primary flows but has THREE specific defects that must be addressed before Wave 2 SPEC ships:**

1. **DEFECT-1 (Hidden bug, present today):** Solo prefs save via `setPreferencesRefreshKey` ALWAYS fires unconditionally, but `resetDeckHistory` is conditionally gated by hash change. **Result: a no-op save (user opens prefs sheet, makes no changes, taps Save) rotates `refreshKey`, wipes `mingla_card_state_*` AsyncStorage keys, but DOES NOT clear Zustand `sessionSwipedCards`.** The two substrates desync: SwipeableCards filter resets to empty (user can re-swipe seen cards), but the "Review Cards" UI ([SwipeableCards.tsx:1675, 2107-2116](app-mobile/src/components/SwipeableCards.tsx#L1675)) still shows the pre-save swipe list.

2. **DEFECT-2 (Hidden bug, present today):** Collab-mode within-session prefs change (Trigger 3 at [app/index.tsx:2596-2598](app-mobile/app/index.tsx#L2596)) bumps `refreshKey` but does NOT call `resetDeckHistory`. Same desync as DEFECT-1: SwipeableCards filter resets to empty, Zustand `sessionSwipedCards` retains pre-update swipes. Collab "Review Cards" shows stale data.

3. **CRITICAL CYCLE-1 CORRECTION:** `sessionSwipedCards` is **NOT functionally redundant** as cycle-1 claimed. It powers the "Review/Viewed Cards" feature ([DismissedCardsSheet.tsx:46-52](app-mobile/src/components/DismissedCardsSheet.tsx#L46), [SwipeableCards.tsx:1675-1687, 1841, 2107-2116, 2473](app-mobile/src/components/SwipeableCards.tsx#L1675)). Cycle-1 Option C (ID-only manifest) WOULD break this feature unless we either (a) keep full Recommendation objects for review, or (b) rehydrate cards from React Query cache at review time. **Investigator owes founder this correction.**

The contract holds for the **happy path** (user actually changes a preference value and saves). It breaks for **no-op saves** and **collab within-session prefs changes**, with the breakage manifesting in the Review UI rather than the swipe filter.

### 12.1 Q1 — Every call site of `resetDeckHistory(newPrefsHash)` (CONFIRMED H)

**Two and only two call sites:**

**Trigger A — Solo prefs save (`handleSavePreferences`):** [app-mobile/src/components/AppHandlers.tsx:494-498](app-mobile/src/components/AppHandlers.tsx#L494)
```typescript
// Deck history reset
const newHashStr = computePrefsHash(dbPreferences);
const { deckPrefsHash, resetDeckHistory } = useAppStore.getState();
if (newHashStr !== deckPrefsHash) {
  resetDeckHistory(newHashStr);
}
```
- Conditionally gated: only fires if hash changed.
- `newPrefsHash` argument: `computePrefsHash(dbPreferences)` — deterministic hash of the prefs payload.

**Trigger B — Mode transition (solo↔collab):** [app-mobile/src/contexts/RecommendationsContext.tsx:1267-1268](app-mobile/src/contexts/RecommendationsContext.tsx#L1267)
```typescript
// Clear deck session state — each mode starts fresh
const { resetDeckHistory } = useAppStore.getState();
resetDeckHistory('');
```
- Unconditional on mode transition.
- Called with **empty string** as `newPrefsHash` — leaves `deckPrefsHash` empty until next prefs save.

**No other call sites in the codebase** (grep verified across `app-mobile/src/` and `app-mobile/app/`).

**Verdict:** swipe history clears in (A) when prefs hash genuinely changes and (B) on every mode transition. **Does NOT clear on (C) collab within-session prefs change** (DEFECT-2) or **(D) no-op solo save** (DEFECT-1).

### 12.2 Q2 — Every call site of `setPreferencesRefreshKey` (CONFIRMED H)

**Three call sites that WRITE:**

**Writer A — Solo prefs save:** [AppHandlers.tsx:501-503](app-mobile/src/components/AppHandlers.tsx#L501)
```typescript
// Preferences refresh key
if (setPreferencesRefreshKey) {
  setPreferencesRefreshKey((prev: number) => prev + 1);
}
```
- **Unconditional** (no hash gate). Fires on every save invocation.

**Writer B — Collab prefs sheet close:** [app/index.tsx:2596-2598](app-mobile/app/index.tsx#L2596)
```typescript
onClose={() => {
  setShowCollabPreferences(false);
  // ORCH-0446B: Bump refreshKey so RecommendationsContext re-reads
  // the updated participant_prefs from DB
  setPreferencesRefreshKey((k: number) => k + 1);
}}
```
- Unconditional on sheet close. Does NOT call `resetDeckHistory`.

**Writer C — Initial declaration:** [appStore.ts:193-199](app-mobile/src/store/appStore.ts#L193) (the action definition itself).

**Reader-only sites:** AppStateManager.tsx:189, 916; DiscoverScreen.tsx:205; app/index.tsx:218 (passed as prop).

**Co-fire analysis:**
- Writer A (solo save) co-fires with Trigger A IF hash changed; otherwise refreshKey rotates alone.
- Writer B (collab close) co-fires with NEITHER trigger — only refreshKey rotates.
- **DESYNC RISK CONFIRMED.**

### 12.3 Q3 — Per-query-key-field clear-trigger mapping (CONFIRMED H)

Query key (from [useDeckCards.ts:59-92](app-mobile/src/hooks/useDeckCards.ts#L59)):
```
['deck-cards', mode, sessionId, lat-rounded, lng-rounded, categories.sort().join(','),
 intents.sort().join(','), travelMode, travelConstraintType, travelConstraintValue,
 datetimePref-normalized, dateOption, batchSeed, excludeCardIds.sort().join(',')]
```

| Query-key field | Source | Triggers `resetDeckHistory`? | Triggers `setPreferencesRefreshKey`? | Wipes `mingla_card_state_*`? | Wipes RQ cache? | Notes |
|----------------|--------|------------------------------|-------------------------------------|------------------------------|-----------------|-------|
| `mode` (solo↔collab) | RecommendationsContext mode state | ✅ Trigger B (unconditional) | ❌ No | ✅ via SwipeableCards.tsx:1006 (mode change) | ✅ invalidate at line 1259 | Full reset path |
| `sessionId` (collab) | resolvedSessionId | ❌ No | ❌ No | ✅ via line 1006 (key includes mode) | ❌ Cache key just changes | Joining different session = different sessionId; old key sits at gcTime |
| `lat-rounded`/`lng-rounded` (rounded to 0.001) | userLocation hook | ❌ No | ❌ No | ❌ No | ❌ No (key changes naturally) | User moves >~100m: new key, new fetch, OLD swipe history applies. **Edge case Q14c — founder steering needed** |
| `categories` (sorted) | dbPreferences | ✅ Trigger A IF hash changes | ✅ Writer A (unconditional) | ✅ via line 1006 on refreshKey rotation | ❌ No explicit invalidate | Hash includes categories → resetDeckHistory fires if changed |
| `intents` (sorted) | dbPreferences | ✅ Trigger A IF hash changes | ✅ Writer A | ✅ via line 1006 | ❌ No explicit | Same as categories |
| `travelMode` | dbPreferences | ✅ Trigger A IF hash changes | ✅ Writer A | ✅ via line 1006 | ❌ No explicit | Same |
| `travelConstraintType`/`Value` | dbPreferences | ✅ Trigger A IF hash changes | ✅ Writer A | ✅ via line 1006 | ❌ No explicit | Same |
| `datetimePref` (ISO) | dbPreferences | ✅ Trigger A IF hash changes | ✅ Writer A | ✅ via line 1006 | ❌ No explicit | Day rollover: see Q8 |
| `dateOption` | dbPreferences | ✅ Trigger A IF hash changes | ✅ Writer A | ✅ via line 1006 | ❌ No explicit | Same |
| `batchSeed` | RecommendationsContext local state | ❌ No | ❌ No | ❌ No | ❌ No (key changes naturally) | Already-broken pagination (cycle-1) — incremented in SwipeableCards.tsx:1050 |
| `excludeCardIds` | Currently always `[]` | ❌ No | ❌ No | ❌ No | ❌ No | Dead under current architecture |

**Verdict:** the prefs-change clear contract is honoured for fields that flow through `dbPreferences` AND are caught by the hash-change gate. Fields outside that path (location-rounding, batchSeed, mode in collab-internal change) bypass the clear.

### 12.4 Q4 — React Query cache eviction on prefs change (CONFIRMED H)

**Solo prefs save handler does NOT call `queryClient.invalidateQueries` or `queryClient.removeQueries` for `deck-cards`.** Verified by direct grep of `AppHandlers.tsx` `handleSavePreferences` body (lines 380-540). The OLD cache entry sits in memory until `gcTime: 24h` ([useDeckCards.ts:226](app-mobile/src/hooks/useDeckCards.ts#L226)).

**Critical edge case A→B→A revert:**
- Save A → query key K(A), entry in RQ cache, `deckPrefsHash = H(A)`, `refreshKey = N`.
- Save B → key K(B), `H(B)`, `refreshKey = N+1`. `resetDeckHistory(H(B))` clears Zustand `sessionSwipedCards`. `mingla_card_state_${mode}_${N}_*` keys wiped at SwipeableCards.tsx:1006-1010. K(A) entry STILL ALIVE in RQ cache (24h gcTime).
- Save A again → key K(A), `H(A)`, `refreshKey = N+2`. `resetDeckHistory(H(A))` fires (`H(A) !== H(B)`) → Zustand cleared again. `mingla_card_state_${mode}_${N+1}_*` keys wiped. **K(A) cache HIT** — instant cards from the original cached entry, no refetch.
- User sees the OLD A deck (cached), with empty filter (refreshKey rotated, fresh `mingla_card_state` empty).
- User can re-swipe through old A cards. ✅ **Contract holds.**

**Stale-data caveat:** if A's cached deck contains cards that have since flipped `is_servable: false`, or new cards have arrived in pool, user sees stale data. Not a contract violation but a data-freshness gap. **Live-fire gap — measure how often A→B→A happens within 24h gcTime in production.**

**Other deck-cards eviction sites (verified):**
- Mode transition: [RecommendationsContext.tsx:1259](app-mobile/src/contexts/RecommendationsContext.tsx#L1259) `invalidateQueries`
- `refreshRecommendations()`: [RecommendationsContext.tsx:1512-1513](app-mobile/src/contexts/RecommendationsContext.tsx#L1512) `invalidateQueries` for both deck-cards + session-deck (legacy)
- `clearRecommendations()` (logout path): [RecommendationsContext.tsx:1520-1521](app-mobile/src/contexts/RecommendationsContext.tsx#L1520) `removeQueries` for both
- Logout: [AppStateManager.tsx:807](app-mobile/src/components/AppStateManager.tsx#L807) `queryClient.clear()` — nuclear, removes everything
- Collab params change (flag-off path): [RecommendationsContext.tsx:1562](app-mobile/src/contexts/RecommendationsContext.tsx#L1562) `invalidateQueries` deck-cards

### 12.5 Q5 — `mingla_card_state_${mode}_${refreshKey}_*` AsyncStorage cleanup (CONFIRMED H)

**Cleaned up explicitly in three sites:**

1. **On mode/refreshKey rotation:** [SwipeableCards.tsx:1003-1011](app-mobile/src/components/SwipeableCards.tsx#L1003)
```typescript
if (
  previousRefreshKeyRef.current !== undefined ||
  previousModeRef.current !== currentMode
) {
  const oldRefreshKey = previousRefreshKeyRef.current;
  const oldMode = previousModeRef.current;
  const oldBaseKey = `mingla_card_state_${oldMode}_${oldRefreshKey}`;
  await AsyncStorage.multiRemove([
    `${oldBaseKey}_index`,
    `${oldBaseKey}_removed`,
  ]);
}
```
**On every refreshKey or mode change**, the OLD keys are removed. NOT orphaned.

2. **On "View Cards Again" handler:** [SwipeableCards.tsx:1714](app-mobile/src/components/SwipeableCards.tsx#L1714)
```typescript
await AsyncStorage.multiRemove([keys.index, keys.removedCards]);
```
Explicit user-initiated wipe of current session's keys.

3. **On logout / user change:** [AppStateManager.tsx:790-806](app-mobile/src/components/AppStateManager.tsx#L790)
```typescript
const allKeys = await AsyncStorage.getAllKeys();
const userScopedKeys = allKeys.filter((key) => {
  if (key.startsWith("mingla_")) return true;
  // ... other prefixes
});
if (userScopedKeys.length > 0) {
  await AsyncStorage.multiRemove(userScopedKeys);
}
```
Prefix-sweep catches `mingla_card_state_*` (starts with `mingla_`).

**Verdict:** no orphaning. Per-prefs-save AsyncStorage cleanup is correct.

**However:** there's a subtle edge case. On refreshKey rotation in line 1003-1011, only the IMMEDIATELY PREVIOUS keys are wiped (`previousRefreshKeyRef.current`). If a user had multiple prefs changes in a session and then logs out without an explicit logout flow, intermediate refreshKey keys could linger. But the prefix-sweep on logout catches them all. **Live-fire gap: confirm the prefix-sweep actually runs on every logout path.**

### 12.6 Q6 — Zustand `sessionSwipedCards` lifecycle through prefs save (CONFIRMED H)

Solo prefs save sequence ([AppHandlers.tsx:494-503](app-mobile/src/components/AppHandlers.tsx#L494)):

1. User taps Save in PreferencesSheet
2. PreferencesSheet's `onSave` callback fires `handleSavePreferences(preferences)`
3. `dbPreferences` constructed from `preferences`
4. `newHashStr = computePrefsHash(dbPreferences)`
5. **IF** `newHashStr !== deckPrefsHash`: `resetDeckHistory(newHashStr)` →
   - `sessionSwipedCards: []`
   - `deckPrefsHash: newHashStr`
6. **ALWAYS:** `setPreferencesRefreshKey((prev) => prev + 1)`
7. `inAppNotificationService.notifyPreferencesUpdated("solo")`
8. Async DB write (with retry)

**`currentCardIndex` is NOT reset by `resetDeckHistory`** ([appStore.ts:211-214](app-mobile/src/store/appStore.ts#L211)):
```typescript
resetDeckHistory: (newPrefsHash) => set({
  sessionSwipedCards: [],
  deckPrefsHash: newPrefsHash,
}),
```

**Effect:** after a hash-changing save, `currentCardIndex` stays at whatever it was (e.g., 7). New deck arrives. SwipeableCards remounts under new `refreshKey` and reads `${baseKey}_index` from AsyncStorage — but that key was just wiped (line 1006), so reads as undefined → resets to 0.

**Verdict:** on hash-change save, the EFFECTIVE `currentCardIndex` resets to 0 via the AsyncStorage wipe path, even though Zustand's `currentCardIndex` field is stale. The two substrates briefly desync but the SwipeableCards is the authoritative consumer.

### 12.7 Q7 — `batchSeed` lifecycle through prefs change (CONFIRMED H)

`batchSeed` lives in `RecommendationsContext` local `useState` ([RecommendationsContext.tsx:174](app-mobile/src/contexts/RecommendationsContext.tsx#L174)). It is NOT persisted (not in Zustand `partialize`).

**Reset triggers:**
- `setBatchSeed(0)` at [RecommendationsContext.tsx:866](app-mobile/src/contexts/RecommendationsContext.tsx#L866) — explicit reset (within mode transition / clear flow)
- `setBatchSeed(0)` at [RecommendationsContext.tsx:1562](app-mobile/src/contexts/RecommendationsContext.tsx#L1562) — collab params change (flag-off only)

**Solo prefs save does NOT explicitly reset batchSeed.** It relies on the natural query-key change to force a refetch. The new fetch lands at whatever batchSeed was. Since batchSeed is dead-code per cycle-1 (server doesn't consume it), this is functionally moot today — but **for Wave 2 cursor pagination, an explicit `setCursor(null)` reset must fire on prefs change**.

### 12.8 Q8 — Day rollover at midnight (INSUFFICIENT EVIDENCE — needs founder decision + live-fire)

`normalizeDateTime` at [cardConverters.ts:16-19](app-mobile/src/utils/cardConverters.ts#L16):
```typescript
export function normalizeDateTime(dt: string): string {
  const d = new Date(dt);
  return Number.isNaN(d.getTime()) ? dt : d.toISOString();
}
```

This converts a datetime string to ISO. Whether the query key changes at midnight depends on whether `datetimePref` is regenerated on each render or held stable from save:

- If `datetimePref` is stored as the literal user-saved ISO timestamp: stays fixed, no midnight crossover.
- If `datetimePref` is regenerated on each render (e.g., resolves "tonight" to the current evening's ISO): would shift at midnight, query key changes, fresh fetch. **No `resetDeckHistory` would fire** because no prefs-save handler ran.

The path from `dateOption: 'today'` to a resolved `datetimePref` was NOT fully traced in this audit. **INSUFFICIENT EVIDENCE.**

**Live-fire test:** save prefs at 11:55pm with dateOption='today'; observe behaviour at 12:05am. Does query key change? Does swipe history persist or clear?

**Founder decision needed (Q14d):** if datetimePref shifts at midnight automatically, should swipe history clear (treating new day as new session) or carry forward (user's "tonight" carries into the early morning hours)?

### 12.9 Q9 — Solo vs collab parity (CONFIRMED H — divergence found)

| Question | Solo behaviour | Collab behaviour | Parity? |
|---------|---------------|-------------------|---------|
| Q1 resetDeckHistory call site | AppHandlers.tsx:495-498 (hash-gated) | RecommendationsContext.tsx:1267 (mode transition only, NOT within-collab prefs change) | **DIVERGENT** |
| Q2 setPreferencesRefreshKey site | AppHandlers.tsx:501-503 | app/index.tsx:2596-2598 (collab close) | DIVERGENT (different sites, both unconditional) |
| Q4 RQ cache eviction on prefs change | No explicit invalidate | Mode transition invalidates; within-collab does NOT (flag-on path) | DIVERGENT |
| Q5 mingla_card_state cleanup | Wipes on refreshKey change | Wipes on refreshKey change | ✅ same |
| Q6 sessionSwipedCards on prefs change | Clears IF hash changes | Does NOT clear on within-collab prefs change | **DIVERGENT** |

**Verdict:** collab within-session prefs changes are **DIVERGENT in a way that breaks the contract for the Review-Cards UI**. DEFECT-2.

### 12.10 Q10 — Cold-start hydration sequence (CONFIRMED H)

Order:
1. App mounts → Zustand `persist` middleware reads `mingla-mobile-storage` from AsyncStorage
2. `onRehydrateStorage` fires: schema version check, sessionSwipedCards default if missing, preferencesRefreshKey default 0 if missing, sets `_hasHydrated: true`
3. PersistQueryClientProvider hydrates from `REACT_QUERY_OFFLINE_CACHE` (after `cacheReady` AsyncStorage size check at app/index.tsx:2772)
4. RecommendationsContext mounts → reads `preferencesRefreshKey` from Zustand
5. SwipeableCards mounts → builds `baseKey = mingla_card_state_${currentMode}_${refreshKey || 0}` ([SwipeableCards.tsx:534](app-mobile/src/components/SwipeableCards.tsx#L534))
6. SwipeableCards reads `${baseKey}_removed` and `${baseKey}_index` from AsyncStorage → restores `removedCards` Set + `currentCardIndex`
7. RecommendationsContext fetches deck via useDeckCards (cache HIT from persister if key matches)

**Match between substrates on cold start:** YES, as long as `preferencesRefreshKey` was correctly persisted at the last save (per ORCH-0504 fix). Zustand's `sessionSwipedCards` and SwipeableCards' `mingla_card_state_${refreshKey}_*` are both keyed off `refreshKey` indirectly (Zustand has session swipes from when refreshKey was N; AsyncStorage keys are scoped to refreshKey N). They stay aligned across cold starts.

### 12.11 Q11 — Logout / clearUserData wipes everything (CONFIRMED H)

[appStore.ts:218-233](app-mobile/src/store/appStore.ts#L218):
```typescript
clearUserData: () =>
  set({
    user: null, isAuthenticated: false, profile: null,
    currentSession: null, availableSessions: [], pendingInvites: [], isInSolo: true,
    currentCardIndex: 0,
    sessionSwipedCards: [],
    deckPrefsHash: '',
    deckSchemaVersion: DECK_SCHEMA_VERSION,
    preferencesRefreshKey: 0,
  }),
```

PLUS [AppStateManager.tsx:790-807](app-mobile/src/components/AppStateManager.tsx#L790) — prefix-sweep `multiRemove` of `mingla_*`, `@mingla*`, `dismissed_cards_*`, etc. PLUS `queryClient.clear()`.

**Verdict:** logout wipes all 3 substrates AND React Query cache. Constitution #6 honoured.

### 12.12 Q12 — `excludeCardIds` interaction with proposed Wave 2 Option B (CONFIRMED H)

**Currently:** `excludeCardIds: []` at all 5 callers. Server dedup off.

**Wave 2 Option B proposes:** populate `excludeCardIds` from solo `removedCards` Set in SwipeableCards.

**Contract preservation under Option B:**
- On prefs change: `mingla_card_state_${refreshKey}_removed` AsyncStorage key wiped at line 1006-1010 → SwipeableCards loads empty `removedCards` Set on next mount → `excludeCardIds: Array.from(removedCards) === []` → server returns full deck (no exclusion).
- ✅ Contract preserved: prefs change → empty exclude list → all cards available.

**Critical edge case to safeguard:** if Option B's implementation reads `excludeCardIds` from Zustand `sessionSwipedCards` instead of SwipeableCards' `removedCards` Set, the contract WOULD BREAK on no-op saves and collab within-session changes (DEFECT-1, DEFECT-2). **MANDATE for Wave 2 SPEC: Option B must source `excludeCardIds` from SwipeableCards' `removedCards` Set, not from Zustand.**

### 12.13 Q13 — Wave 2 mechanism preservation verdict per option (CONFIRMED H)

| Wave 2 Mechanism | Preserves Contract? | Required Safeguard | File:line for the safeguard |
|------------------|---------------------|---------------------|------------------------------|
| **Option A — Cursor pagination** `(p_after_score, p_after_id)` | ✅ if cursor is reset on prefs change | Cursor must be local to RecommendationsContext (like batchSeed today). Reset on Trigger A AND Trigger B. Add a Writer C reset for the collab within-session path (DEFECT-2 fix). | new SPEC requirement |
| **Option A — First-page-only persistence** | ✅ | persister `shouldDehydrateQuery` must check `cards.length > FIRST_PAGE_SIZE` AND only dehydrate first N cards. Or persist only when `cursor === null` (first page). | app/index.tsx:2810-2828 amend |
| **Option B — Populate `excludeCardIds`** | ✅ ONLY if sourced from `removedCards` Set, not Zustand | Source MUST be SwipeableCards' local `removedCards` Set (mode/refreshKey-scoped, contract-aligned). Documented as `I-DECK-DEDUP-SOURCE-MINGLA-CARD-STATE`. | useDeckCards body |
| **Option C — ID-only Zustand manifest** | ⚠️ BREAKS Review-Cards UI | Option C as proposed in cycle-1 strips full Recommendation objects from Zustand. Review feature ([SwipeableCards.tsx:1675, DismissedCardsSheet.tsx:46-52](app-mobile/src/components/SwipeableCards.tsx#L1675)) consumes them. **Must rehydrate at review time from React Query cache** OR keep full objects (defeats the purpose). **REVISE OPTION C: keep full objects, but add throttle to Zustand persist write (not ID-only).** | revised approach |
| **Option D — Per-key AsyncStorage cap** | ✅ | Independent of contract. No interaction. | app/index.tsx amend |
| **DEFECT-1 fix (no-op save desync)** | new requirement | When `setPreferencesRefreshKey` fires, ALSO clear Zustand `sessionSwipedCards` (or refactor: tie Zustand clear to refreshKey rotation in onRehydrateStorage equivalent). | AppHandlers.tsx:494-503 |
| **DEFECT-2 fix (collab within-session)** | new requirement | When collab prefs sheet closes (refreshKey bump), call `resetDeckHistory('')` too. | app/index.tsx:2596-2598 |

### 12.14 Q14 — Edge case verdict matrix (FOUNDER DECISIONS NEEDED)

| Edge case | Current behaviour | Static evidence | Founder decision needed | Risk if mismatch |
|-----------|-------------------|-----------------|--------------------------|------------------|
| **a)** A→B→A revert within 24h | Old A cache hit; swipe history clear; user re-sees old A cards (possibly stale) | Q4 trace, RQ gcTime=24h | Should A's deck be FRESH (refetch) or STALE-OK (cache hit)? Recommend: stale-OK (faster UX) but flag stale-data risk. | Stale `is_servable: false` cards shown |
| **b)** Toggle category OFF then ON within 5s | Hash recomputes → if same hash both times, `resetDeckHistory` does NOT fire on second toggle. refreshKey rotates twice. Net: SwipeableCards filter empty (correct), Zustand sessionSwipedCards cleared after FIRST toggle. | Q1, Q3, Q6 | Should this be a no-op (preserve session) or treated as 2 prefs changes? Recommend: as-is (correct behaviour today). | Low — current behaviour is sane |
| **c)** User physically moves >100m (lat/lng-rounded boundary) | New query key, new fetch, OLD swipe history applies (Zustand + mingla_card_state both unchanged) | Q3 row 3 | Should crossing the rounding boundary clear history? Recommend: NO (preserve session — moving 100m is not "changing prefs"). | Founder must confirm explicitly |
| **d)** Day rollover at midnight | INSUFFICIENT EVIDENCE — depends on whether datetimePref re-resolves | Q8 | Should crossing midnight clear history? Recommend: live-fire first, then decide. | High — affects every overnight user |
| **e)** Travel-mode-only change (no category change) | Hash includes travelMode → resetDeckHistory fires → contract holds | Q3 row 6 | None — already works | None |
| **f)** App backgrounded 18h then resumed (same prefs) | focusManager fires on AppState='active' but deck-cards is NOT in invalidation list. Zustand persists. mingla_card_state persists. Cold cache hit → resume in place | Q10 + cycle-1 §3 Q10 | Should long-resume clear history? Recommend: NO (user expects continuation). 18h is below 24h gcTime. | Low — current behaviour is sane |
| **g)** Schema version bump (DECK_SCHEMA_VERSION) | onRehydrateStorage clears sessionSwipedCards in migration block ([appStore.ts:259-265](app-mobile/src/store/appStore.ts#L259)) | Q11 verified | None — already works. **Verify on next bump.** | None |
| **h)** Logout | clearUserData wipes Zustand; AppStateManager prefix-sweep wipes mingla_card_state; queryClient.clear() wipes RQ | Q11 verified | None — already works | None |

### 12.15 Live-Fire Gaps (Priority-ordered)

1. **Day rollover behaviour (Q8/Q14d):** capture cold-cache → midnight crossing → fresh resume on a real device with `dateOption: 'today'`. Does the query key change? Does swipe history persist or clear?
2. **A→B→A revert frequency in production:** server-log analysis of how often a user changes prefs A→B→A within 24h. Determines whether stale-cache risk warrants explicit `removeQueries` on every prefs save.
3. **DEFECT-1 manifestation:** can no-op saves actually be triggered in production? Does the PreferencesSheet allow tapping Save without changes? UX inspection needed.
4. **DEFECT-2 manifestation:** collab within-session prefs change reproducibility — capture the Review-Cards UI showing stale data after a collab prefs toggle.
5. **Logout prefix-sweep coverage:** verify on real device that all 3 substrates wipe cleanly across 5+ logout paths (sign-out button, token expiry, account-delete, etc.).

### 12.16 Updated Regression Risk Matrix (additions to §5 Option A)

| New Risk | What could break | Severity | Detection | Mitigation |
|----------|------------------|----------|-----------|-----------|
| Cursor not reset on prefs change | After prefs save, new fetch starts at OLD cursor → server skips early scored cards → user sees deck starting partway through | S0 | T-A13: change prefs at cursor>0, assert cursor resets to null and fetch starts at page 1 | `setCursor(null)` called from same code path as `resetDeckHistory` (Trigger A) |
| `excludeCardIds` sourced from Zustand instead of removedCards Set | After no-op save (DEFECT-1), Zustand has 50 IDs but mingla_card_state is empty → server excludes 50 cards but client filter is empty → user sees fewer cards than they should | S1 | T-A14: trigger no-op save, compare server response card count to expected | MANDATE source from removedCards Set (Q13) |
| Stale RQ cache hit on A→B→A revert | User reverts to old prefs, sees deck from 23h ago with stale `is_servable` | S2 | T-A15: simulate A→B→A across 23h, confirm stale cards in deck | Document as known UX trade-off; or add explicit `removeQueries` on prefs save (cost: forces refetch even on minor edits) |
| DEFECT-1 latent in production | No-op save desyncs Zustand sessionSwipedCards from mingla_card_state | S2 | T-A16: tap Save without changing anything; assert Zustand and mingla_card_state agree | Co-fire `resetDeckHistory(deckPrefsHash)` (current hash, no change) when refreshKey rotates without hash change |
| DEFECT-2 latent in production | Collab within-session prefs change leaves stale Review-Cards UI | S2 | T-A17: in collab, toggle category, open Review Cards, observe stale entries | Add `resetDeckHistory('')` to app/index.tsx:2596-2598 onClose handler |

### 12.17 New Founder Steering Questions (additions to §8)

- **Q-21 (DEFECT-1 disposition):** Fix the no-op-save desync as part of Wave 2, or queue as separate ORCH? Recommend: bundle into Wave 2 SPEC (1-line fix in AppHandlers.tsx).
- **Q-22 (DEFECT-2 disposition):** Fix the collab within-session desync as part of Wave 2, or queue as separate ORCH? Recommend: bundle into Wave 2 SPEC (1-line fix in app/index.tsx:2596).
- **Q-23 (Q14a A→B→A stale cache):** Acceptable trade-off (faster revert UX) or unacceptable (force fresh fetch via explicit `removeQueries`)? Recommend: acceptable — measure live-fire frequency first.
- **Q-24 (Q14c location boundary):** Confirm that crossing the lat/lng rounding boundary should NOT clear swipe history. Recommend: confirm.
- **Q-25 (Q14d day rollover):** Defer until live-fire confirms whether datetimePref re-resolves at midnight automatically. Founder decision conditional on that finding.
- **Q-26 (Option C revision):** Cycle-1 Option C (ID-only Zustand manifest) BREAKS the Review-Cards UI. Replace with: keep full Recommendation objects in Zustand, but add THROTTLE on persist write (e.g., 250ms trailing) — preserves Review UI while reducing AsyncStorage write pressure. Confirm replacement direction. Recommend: confirm Option C revision.
- **Q-27 (Wave 2 SPEC scope expansion):** Wave 2 now includes DEFECT-1 + DEFECT-2 fixes + Option C revision in addition to A+B+D. Confirm expanded scope or split. Recommend: bundle in one coordinated SPEC since they share the test matrix.

### 12.18 Acceptance Criteria Verification (per dispatch §"Acceptance Criteria")

1. ✅ Every preference change path traced: Trigger A (solo save) + Trigger B (mode change) + Writer B (collab close) all documented with file:line + code.
2. ✅ Every edge case Q14a-h has CURRENT-BEHAVIOUR verdict with proof + INTENDED-BEHAVIOUR question for founder.
3. ✅ React Query cache eviction path traced — confirmed NO explicit removal on solo prefs save; A→B→A revert risk documented.
4. ✅ `mingla_card_state_*` AsyncStorage cleanup determined — wiped on refreshKey rotation (line 1006-1011), wiped on logout (prefix-sweep at AppStateManager:790-806).
5. ✅ Solo and collab parity verified per Q with explicit DIVERGENT flags on Q1, Q2, Q4, Q6.
6. ✅ Each proposed Wave 2 mechanism has explicit "preserves contract" or "needs safeguard" verdict (table 12.13).
7. ✅ Live-fire gaps explicitly enumerated (12.15).

**SPEC dispatch UNBLOCKED for Wave 2** — provided founder confirms Q-21 through Q-27 and the SPEC explicitly includes:
- DEFECT-1 fix (no-op save desync)
- DEFECT-2 fix (collab within-session desync)
- Option C revision (throttle, not ID-only)
- Cursor reset paired with `resetDeckHistory` (Wave 2 internal contract)
- `excludeCardIds` sourced from `removedCards` Set, NOT Zustand

### 12.19 Honest Investigator Self-Correction

I (the cycle-1 forensics agent) made a wrong claim in §3 Q14 that `sessionSwipedCards` was "functionally redundant" with `removedCards`. That was incorrect. `sessionSwipedCards` is load-bearing for the Review-Cards UI ([SwipeableCards.tsx:1675-1687, 1841, 2107-2116, 2473](app-mobile/src/components/SwipeableCards.tsx#L1675); [DismissedCardsSheet.tsx:46-52](app-mobile/src/components/DismissedCardsSheet.tsx#L46)). Cycle-1 Option C as proposed would have shipped a regression by stripping the data the Review UI consumes. This is now corrected here — Option C must be revised to "throttle Zustand persist writes" not "switch to ID-only manifest."

This correction is also flagged in MASTER_BUG_LIST and must be reflected in the Wave 2 SPEC. **Process learning:** even cycle-1 cycle-2 audits need verification of consequential claims. Memory rule `feedback_forensic_thoroughness.md` saved this from shipping.
