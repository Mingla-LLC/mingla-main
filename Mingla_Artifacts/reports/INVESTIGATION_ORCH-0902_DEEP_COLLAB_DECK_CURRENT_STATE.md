# DEEP INVESTIGATION — ORCH-0902 [Collab Session Deck Deterministic Rewrite]

**Mode:** INVESTIGATE
**Date:** 2026-05-21
**Investigator:** Claude `mingla-forensics` (executing dispatch from Claude `mingla-orchestrator`)
**Dispatch:** `Mingla_Artifacts/prompts/INVESTIGATOR_SPEC_ORCH-0902_COLLAB_DECK_DETERMINISTIC_REWRITE.md` (PRIVATE_PROMPT_NOT_VERSIONED)
**Locked contract:** [`Mingla_Artifacts/reports/INVESTIGATION_ORCH-0902_COLLAB_DECK_PARITY.md`](INVESTIGATION_ORCH-0902_COLLAB_DECK_PARITY.md) — CR-1..CR-8 (operator-confirmed 2026-05-21)
**Affected Surfaces:** Consumer iOS, Consumer Android (`app-mobile/`) + Supabase backend
**Surfaces explicitly NOT in scope:** business-iOS, business-Android, admin-web, business-web-preview, buyer-web (no collab session surface)
**Scope discipline:** This investigation does NOT propose solutions. It establishes ground truth that SPEC builds on.

---

## 1A — Bird's-Eye Architecture Map

The collab deck subsystem today is **client-aggregated, client-fetched, per-client-anchored**. There is no shared deck stored anywhere on the server. Every participant computes "the same params" independently and trusts deterministic edge-function output to produce "the same deck."

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      COLLABORATION SESSION DECK — TODAY                      │
└─────────────────────────────────────────────────────────────────────────────┘

   PARTICIPANT A's device                       PARTICIPANT B's device
   ─────────────────────                        ─────────────────────
                                                
   PreferencesSheet.tsx                         PreferencesSheet.tsx
       │ user edits prefs                           │ user edits prefs
       ▼                                            ▼
   updateBoardPreferences()  ──── RPC ───►   collaboration_sessions
       (useBoardSession.ts:200)         upsert_participant_prefs
                                          deep-merge JSONB:
                                          { [userIdA]: {...},
                                            [userIdB]: {...} }
                                                        │
                                       Postgres ──────► │ UPDATE row
                                       Realtime                 │
                                                                ▼
                                       ┌──── on collaboration_sessions UPDATE ────┐
                                       │                                          │
                                       ▼                                          ▼
   realtimeService.ts                              realtimeService.ts
   subscribeToBoardSession                         subscribeToBoardSession
       │ onSessionUpdated                              │ onSessionUpdated
       │ extracts participant_prefs JSONB              │ extracts participant_prefs JSONB
       ▼                                                ▼
   useBoardSession.ts                              useBoardSession.ts
   setAllParticipantPreferences(allPrefs)          setAllParticipantPreferences(allPrefs)
       │                                                │
       ▼                                                ▼
   RecommendationsContext.tsx                      RecommendationsContext.tsx
   collabDeckParams = useMemo(                     collabDeckParams = useMemo(
     aggregateCollabPrefs(allPrefs))                 aggregateCollabPrefs(allPrefs))
       │                                                │
       │  ◄── sessionPrefsUtils.ts:48-159 ──► ◄── sessionPrefsUtils.ts:48-159 ──►
       │  CLIENT-SIDE aggregation:                     │
       │   categories UNION (toggle-gated)             │
       │   intents UNION (toggle-gated)                │
       │   travel_mode MOST PERMISSIVE                 │
       │   travel_constraint_value MAX                 │
       │   location MIDPOINT of custom_lat/lng         │
       │     (GPS rows IGNORED in aggregation)         │
       │   dateOption MOST PERMISSIVE                  │
       │   dateWindows UNION                           │
       │   selected_dates UNION                        │
       │                                                │
       ▼                                                ▼
   flagCollabDeck = useDeckCards({                 flagCollabDeck = useDeckCards({
     location: collabParams.location                 location: collabParams.location
       ?? userLocation,        ◄── PER-CLIENT          ?? userLocation,        ◄── PER-CLIENT
                                  GPS FALLBACK                                    GPS FALLBACK
                                  (line 697)                                      (line 697)
     mode: 'collab',                                 mode: 'collab',
     sessionId: resolvedSessionId,                   sessionId: resolvedSessionId,
     categories, intents, travelMode, ...            categories, intents, travelMode, ...
   })                                              })
       │                                                │
       ▼                                                ▼
   useDeckCards.ts                                 useDeckCards.ts
   buildDeckQueryKey(...)                          buildDeckQueryKey(...)
   ['deck-cards', 'collab', sessionId,             ['deck-cards', 'collab', sessionId,
     roundedLat, roundedLng, sortedCategories,        roundedLat, roundedLng, sortedCategories,
     sortedIntents, travelMode, ...]                  sortedIntents, travelMode, ...]
       │                                                │
       │   ⚠ Keys diverge when location ?? userLocation  │
       │     differs between A and B                     │
       ▼                                                ▼
   deckService.fetchDeck({                         deckService.fetchDeck({
     location: <A's resolved location>,              location: <B's resolved location>,
     categories, intents, ...,                       categories, intents, ...,
     dateWindows: [...],                             dateWindows: [...],
     sessionId: '...'                                sessionId: '...'
   })                                              })
       │                                                │
       │ ──── POST discover-cards ──────────────────────│──────────► supabase/functions/discover-cards/index.ts
       │                                                │
       │                                                │  • Validates location !== null (line 644)
       │                                                │  • Resolves category→signal IDs (line 814)
       │                                                │  • Calls query_servable_places_by_signal RPC
       │                                                │  • Filters by Haversine radius, photo gate
       │                                                │  • ORDER BY ps.score DESC, pp.review_count DESC NULLS LAST
       │                                                │  • Round-robin interleaves per-chip
       │                                                │  • IF sessionId present: re-sort by place_id.localeCompare
       │                                                │  • IF sessionId present: matchScore zeroed to 0
       │                                                │
       ▼                                                ▼
   Cards[] for A                                   Cards[] for B
   (deterministic IF A.location == B.location      (deterministic IF B.location == A.location
    AND all other params identical)                  AND all other params identical)

   ─────────── SWIPE PHASE ───────────              ─────────── SWIPE PHASE ───────────
   
   User swipes left/right on SwipeableCards.tsx    User swipes left/right on SwipeableCards.tsx
                                                
   Right swipe → collabSaveCard.ts                 Right swipe → collabSaveCard.ts
       │ → rpc_record_swipe_and_check_match            │ → rpc_record_swipe_and_check_match
       │ ───────► board_user_swipe_states              │ ───────► board_user_swipe_states
       │             INSERT row                        │             INSERT row
       │             swipe_state='swiped_right'        │             swipe_state='swiped_right'
       │                                                │
       │             ┌──────────────────────────────────┐
       │             │ TRIGGER check_mutual_like         │
       │             │ Counts swiped_right per           │
       │             │ (session, experience). IF ≥2 →   │
       │             │ INSERT INTO board_saved_cards    │
       │             │ (the MATCH / Cards tab)          │
       │             └──────────────────────────────────┘
       │                       │
       │  ◄────── realtime: board_saved_cards INSERT ──┐
       │             onCardSaved fires                 │
       │             onMatchPromoted fires             │
       │
   Left swipe → INSERT board_user_swipe_states     Left swipe → INSERT board_user_swipe_states
       │             swipe_state='swiped_left'          │             swipe_state='swiped_left'
       │             (no trigger fires, no match)       │             (no trigger fires)
       │                                                │
       │ Locally: removedCards array in                 │ Locally: removedCards array in
       │ RecommendationsContext +                       │ RecommendationsContext +
       │ AsyncStorage `dismissed_cards_${userId}_       │ AsyncStorage `dismissed_cards_${userId}_
       │ ${currentMode}`                                │ ${currentMode}`
       │                                                │
       ▼                                                ▼
   DismissedCardsSheet                              DismissedCardsSheet
   shows A's local dismissedCards                  shows B's local dismissedCards
   (B's lefts INVISIBLE to A; not queried)         (A's lefts INVISIBLE to B; not queried)

   ─────────── PREF-CHANGE FLOW (TODAY) ───────────
   
   A changes a pref → upsert_participant_prefs RPC → realtime fires → both clients
   re-read session JSONB → setAllParticipantPreferences → collabDeckParams memo recomputes
   → query key changes → React Query refetches IMMEDIATELY → CURRENT CARD VANISHES
   (no V_n exhaustion buffering exists)
```

### Five key structural facts to remember

1. **No server-side deck snapshot.** No `session_decks` table is currently in use (a row at `realtimeService.ts:615-627` listens for INSERT events on `session_decks` but the table was deleted in ORCH-0446 — this is dead code in the subscription manager).
2. **No `deck_version` concept.** Each client trusts deterministic edge-function output. There is no server-side cache key, no version, no broadcast primitive for "everyone refetch now."
3. **Client-side aggregation is the only contract.** `aggregateCollabPrefs()` runs in each client's `RecommendationsContext` memo. Two clients must compute identical output from identical JSONB input for parity to hold.
4. **Location is the sole per-client variable that breaks parity.** Every other input (`categories`, `intents`, `travelMode`, `travelConstraintValue`, `dateWindows`, `selectedDates`, `datetimePref`) is derived deterministically from the shared `participant_prefs` JSONB. Location alone has the `?? userLocation` per-client fallback at `RecommendationsContext.tsx:697`.
5. **Swipe storage already exists.** `board_user_swipe_states` is a real production table with `(session_id, experience_id, user_id, swipe_state, swiped_at, card_data)` rows for BOTH right and left swipes. The check_mutual_like trigger fires on right swipes; left swipes are persisted but unused beyond the local UI.

---

## 1B — Inventory of Every Participating Component

| # | Name | Kind | Location | Role in current flow | Status under new contract |
|---|------|------|----------|---------------------|---------------------------|
| 1 | `collaboration_sessions` | Table | migration `20260505000000_baseline_squash_orch_0729.sql:7951-7978` | Holds `participant_prefs` JSONB, session metadata, status | **MODIFIED** — add `deck_version` int, `deck_params_hash` text, optional `last_deck_minted_at` timestamptz |
| 2 | `session_participants` | Table | same file `:9658-9683` | One row per participant; `has_accepted` gate | **UNCHANGED** |
| 3 | `board_user_swipe_states` | Table | same file (referenced lines 3700+) | One row per (session, experience, user); stores both left + right swipes + card_data | **REUSED** — becomes the data source for visible-but-not-binding dismissal sheet (CR-6) |
| 4 | `board_saved_cards` | Table | same file `:7614-7632` | Match destinations (≥2 right-swipes promotes here via trigger) | **UNCHANGED** (CR-8 preserves match quorum) |
| 5 | `participant_prefs` (column) | jsonb | `collaboration_sessions.participant_prefs` | Deep-merged `{ [user_id]: {...prefs} }` shape | **MODIFIED** — `custom_lat/lng` semantics change: any participant's location enters the union, GPS no longer ignored |
| 6 | `upsert_participant_prefs(uuid, uuid, jsonb)` | RPC | same file `:6676-6698` | Deep-merge a single participant's prefs into the JSONB column | **MODIFIED** — adds trigger that bumps `deck_version` if params_hash changes |
| 7 | `rpc_record_swipe_and_check_match(...)` | RPC | same file `:6249-6379` | Records swipe, fires check_mutual_like trigger for right-swipes | **UNCHANGED** (already records left swipes too) |
| 8 | `check_mutual_like` | Trigger function | same file `:3700-3873` | Counts swiped_right per (session, experience); promotes to `board_saved_cards` at ≥2 | **UNCHANGED** (CR-8 preserves match quorum) |
| 9 | `query_servable_places_by_signal(...)` | RPC | same file `:5905-5955` | Returns scored places within Haversine radius of one anchor lat/lng | **EXTENDED OR REPLACED** — must support union-of-circles (multi-anchor) or be called per-participant and unioned |
| 10 | `discover-cards` | Edge fn | `supabase/functions/discover-cards/index.ts:604-1050` | Accepts location/categories/etc., returns deterministic card list | **MODIFIED** — accepts `session_id` as primary input; reads aggregation server-side; returns `deck_version` |
| 11 | `aggregateCollabPrefs(rows)` | Function | `app-mobile/src/utils/sessionPrefsUtils.ts:48-159` | Client-side aggregation: UNION/MAX/MOST PERMISSIVE/midpoint | **RETIRED** — moved server-side as `pg_aggregate_collab_prefs(session_id)` |
| 12 | `collabDeckParams` memo | React memo | `app-mobile/src/contexts/RecommendationsContext.tsx:545-566` | Computes aggregated params for the hook | **RETIRED** — client no longer aggregates |
| 13 | `flagCollabDeck` hook call | Hook call | `app-mobile/src/contexts/RecommendationsContext.tsx:693-716` | Calls `useDeckCards` with collab params + `?? userLocation` fallback | **MODIFIED** — passes only `sessionId` (no location); fallback eliminated |
| 14 | `buildDeckQueryKey(...)` | Function | `app-mobile/src/hooks/useDeckCards.ts:59-92` | Builds React Query key from all params | **MODIFIED** — for collab mode, key becomes `['deck-cards', 'collab', sessionId, deck_version]` |
| 15 | `useDeckCards` | Hook | same file `:149-235` | React Query wrapper, staleTime Infinity, gcTime 24h | **MODIFIED** — query key shape change cascades here |
| 16 | `deckService.fetchDeck(...)` | Service | `app-mobile/src/services/deckService.ts:347-733` | Orchestrates singles + curated fetch, 15s timeout | **MODIFIED** — collab mode sends `{ session_id }` only, gets back `{ cards, deck_version }` |
| 17 | `RecommendationsContext` | Context | `app-mobile/src/contexts/RecommendationsContext.tsx` | Owns deck state machine, accumulated cards, dismissed cards | **MODIFIED** — adds V_n + V_pending buffer state; transitions on last-V_n-card swipe |
| 18 | `useBoardSession` | Hook | `app-mobile/src/hooks/useBoardSession.ts:50-401` | Loads session, subscribes realtime, propagates participant_prefs | **MODIFIED** — listens for `deck_version` changes; does NOT immediately invalidate React Query (buffer instead) |
| 19 | `realtimeService.subscribeToBoardSession` | Service | `app-mobile/src/services/realtimeService.ts:306-662` | 13 distinct postgres_changes subscriptions on `board_session:{sessionId}` channel | **MODIFIED** — `onSessionUpdated` payload now carries `deck_version`; existing `session_decks` INSERT listener (dead code) deleted |
| 20 | `onParticipantJoined` callback | Callback | `app-mobile/src/hooks/useBoardSession.ts:335-356` | Invalidates legacy `['session-deck', sessionId]` query key, reloads session | **MODIFIED** — invalidation removed; deck_version bump in DB does the work |
| 21 | `accumulatedCardsRef` + `removedCards` state | State | `app-mobile/src/contexts/RecommendationsContext.tsx:268, 321, 827-847` | Local per-participant swipe state | **MODIFIED** — `removedCards` source switches from AsyncStorage to `board_user_swipe_states` query for collab mode |
| 22 | AsyncStorage key `dismissed_cards_${userId}_${currentMode}` | Storage | `RecommendationsContext.tsx:325-338, 827-839` | Local-only dismissed cards persistence | **RETAINED FOR SOLO**, **RETIRED FOR COLLAB** |
| 23 | `DismissedCardsSheet` | Component | `app-mobile/src/components/DismissedCardsSheet.tsx` | Renders `dismissedCards: Recommendation[]` prop | **MODIFIED** — for collab, list is server-sourced from `board_user_swipe_states` with `action='swiped_left'`, attributed by participant name |
| 24 | `SwipeableCards.tsx` | Component | `app-mobile/src/components/SwipeableCards.tsx` | Gesture handler, calls collabSaveCard on right, removes locally on left | **MODIFIED** — left swipe in collab now writes to `board_user_swipe_states` via RPC; gates V_n→V_{n+1} transition |
| 25 | `collabSaveCard()` helper | Helper | `app-mobile/src/components/helpers/collabSaveCard.ts` | Calls rpc_record_swipe_and_check_match for right swipes | **EXTENDED** — also called for left swipes (visible-but-not-binding model) |
| 26 | `deckStateRegistry` | Context state | `app-mobile/src/contexts/deckStateRegistry.ts` | Per-context (solo/collab/sessionId) state preservation | **MODIFIED** — entry holds (deck_version, cursor_position, V_pending) per session |
| 27 | `WAITING_FOR_PARTICIPANTS` UI state | DeckUIState | `RecommendationsContext.tsx:1657-1667` | Renders when collab + `acceptedCount < 2` | **UNCHANGED** (CR-8 preserves session-start threshold) |
| 28 | Channel `board_session:{sessionId}` | Realtime channel | `realtimeService.ts:307` | 13 event types | **EXTENDED** — `collaboration_sessions` UPDATE payload now carries new `deck_version`/`deck_params_hash` columns |
| 29 | `categoryPlaceTypes.ts` `DISPLAY_TO_SLUG` | Const map | (canonical 10-slug taxonomy) | Canonical category slugs | **UNCHANGED** |
| 30 | `match_telemetry_events` table | Table | migration baseline | Telemetry on match decisions | **UNCHANGED** |
| 31 | Dead code: `session_decks` table listener | Realtime sub | `realtimeService.ts:615-627` | Listens for INSERT on a table that no longer exists | **DELETED** (cleanup; ORCH-0446 already removed the table) |
| 32 | Dead code: `['session-deck', sessionId]` query key | React Query key | `useBoardSession.ts:353` | Invalidated on participant join, but the key has no producer left after ORCH-0446 | **DELETED** (cleanup) |

---

## 1C — Per-CR Violation Map

### CR-1 — Deterministic shared deck per session state
**Target behavior:** For every participant P in session S at time T, deck function returns the same ordered card list. Deck is a pure function of session state, never of per-participant state.

**Current state:** Each client independently computes aggregation, builds the React Query key, and fetches `discover-cards`. Determinism is *intended* via shared `participant_prefs` JSONB + deterministic edge function (collab sort by `place_id.localeCompare`, [`discover-cards/index.ts:1000-1004`](supabase/functions/discover-cards/index.ts#L1000-L1004)), but breaks when client-side aggregated `location` is null and falls back to per-client GPS at [`RecommendationsContext.tsx:697`](app-mobile/src/contexts/RecommendationsContext.tsx#L697).

**Violations:**
- `app-mobile/src/contexts/RecommendationsContext.tsx:697` — `location: collabDeckParams?.location ?? userLocation` — per-client GPS fallback is the explicit determinism leak.
- `app-mobile/src/utils/sessionPrefsUtils.ts:130-132` — aggregation filters `rows.filter(r => r.custom_lat != null && r.custom_lng != null)`, silently dropping participants who only have GPS (most users, given GPS is the default).
- `app-mobile/src/utils/sessionPrefsUtils.ts:142` — comment says "midpoint of all participants' GPS coordinates" but code reads `custom_lat/lng` — misleading comment will keep future maintainers from finding this.
- `app-mobile/src/hooks/useDeckCards.ts:159-176` — query key construction includes `roundedLat`/`roundedLng` from `params.location`; if `location` differs between clients (due to fallback), keys diverge and cache entries split.
- No `deck_version` discriminant — no server-owned cache key that all clients reference.

**Blast radius:** Affects every active collab session whose participants have not all set custom pins. Compounds with CR-2 (location model is wrong) and CR-3 (no version means pref-changes immediately invalidate the cache mid-swipe).

---

### CR-2 — Location as union of per-participant reachable circles
**Target behavior:** Each participant has a personal reachable circle from `(location, travel_mode, travel_constraint_value)`. The deck pool is the union of every circle. Venue qualifies if reachable by ≥1 participant. Per-participant mode + time feed personal circles only; no session-level winner.

**Current state:** Aggregation picks ONE winning travel_mode (MOST PERMISSIVE rank: driving > transit > biking > walking) and ONE winning travel_constraint_value (MAX), then queries from ONE midpoint anchor. Participants with shorter time / weaker modes are silently overridden.

**Violations:**
- `app-mobile/src/utils/sessionPrefsUtils.ts:96-98` — `travelMode = rows.map(r => r.travel_mode || 'walking').sort((a,b) => (MODE_RANK[b] ?? 0) - (MODE_RANK[a] ?? 0))[0]` — most-permissive winner. Retires under CR-2.
- `app-mobile/src/utils/sessionPrefsUtils.ts:101-103` — `travelConstraintValue = Math.max(...rows.map(r => r.travel_constraint_value ?? 30))` — MAX winner. Retires under CR-2.
- `app-mobile/src/utils/sessionPrefsUtils.ts:130-140` — single midpoint location. Retires under CR-2.
- `supabase/functions/discover-cards/index.ts:889-901` — RPC `query_servable_places_by_signal` is called with one `p_lat`, `p_lng`, `p_radius_m`. There is no multi-anchor / union-of-circles RPC today.
- `supabase/migrations/20260505000000_baseline_squash_orch_0729.sql:5945-5951` — the Haversine clause in the RPC filters against ONE anchor only.

**Blast radius:** Requires either (a) a new SQL function that accepts an array of `(lat, lng, radius_m)` tuples and filters `WHERE ANY(circle)` via `OR` clauses or PostGIS `ST_DWithin`, or (b) per-participant per-chip RPC calls fanned out from the edge function and merged. Option (a) is cleaner if PostGIS is available; option (b) works without PostGIS but multiplies RPC call count by N participants.

---

### CR-3 — Pref-change cutover: full V_n exhaustion before V_{n+1}
**Target behavior:** A pref change at moment T does not update any participant's deck mid-session. Each participant continues swiping V_n to its final card. Only after swiping the last V_n card does the next swipe show V_{n+1} card #1.

**Current state:** Pref changes propagate immediately via realtime → `setAllParticipantPreferences` → `collabDeckParams` memo recomputes → React Query key changes → cache miss → refetch. The user's current card vanishes mid-view.

**Violations:**
- `app-mobile/src/hooks/useBoardSession.ts:317-334` — `onSessionUpdated` extracts new `participant_prefs` and calls `setAllParticipantPreferences(allPrefs)` synchronously. No buffering, no exhaustion gate.
- `app-mobile/src/hooks/useBoardSession.ts:395-403` — `onPreferencesChanged` reloads the session and triggers identical recompute path.
- `app-mobile/src/contexts/RecommendationsContext.tsx:545-566` — `collabDeckParams` memo depends on `allParticipantPrefs`; any new array reference triggers recompute. No memo retention of "V_n params" alongside "V_pending params."
- `app-mobile/src/hooks/useDeckCards.ts:159-176` — query key includes every aggregated param; immediate recomputation flips the key, evicting the in-flight deck.
- `app-mobile/src/hooks/useBoardSession.ts:200-264` — `updatePreferences()` also calls `loadSession(sessionId)` after the RPC succeeds (line 264) as a "backup" — accelerates the same yank.
- No `deck_version` field exists on `collaboration_sessions` to broadcast "a new version is available; buffer it."

**Blast radius:** Implementor must introduce: (a) a server-side trigger that increments `deck_version` only when `params_hash` changes; (b) client-side state machine that holds `currentDeckVersion` AND `pendingDeckVersion`; (c) transition logic gated on `accumulatedCardsRef.current.length === 0` AND `cardIndex === lastCardIndex` (i.e., last V_n card has been swiped). Touches `RecommendationsContext`, `useBoardSession`, `useDeckCards`, possibly `deckStateRegistry`.

---

### CR-4 — Resume rule
**Target behavior:** A user who stops mid-V_n and comes back later resumes V_n at their cursor position. They owe themselves the rest of V_n before any pref change kicks in for them.

**Current state:** `deckStateRegistry` does preserve `accumulatedCards` per context across solo/collab transitions ([`RecommendationsContext.tsx:419-448`](app-mobile/src/contexts/RecommendationsContext.tsx#L419-L448)), but does NOT track `deck_version` (because no deck_version exists). On rejoin, if the realtime `onSessionUpdated` fires with new prefs, `collabDeckParams` memo recomputes, query key changes, and the cached V_n is evicted from React Query (gcTime is 24h, but the key changes break the lookup).

**Violations:**
- `app-mobile/src/contexts/deckStateRegistry.ts` (full file) — does not persist `deck_version`. Cannot guarantee resume on V_n vs V_{n+1}.
- `app-mobile/src/contexts/RecommendationsContext.tsx:419-448` — context-change effect saves `accumulatedCards` but not a version pin. On restore, the live `allParticipantPrefs` is used for aggregation, not the version snapshot the user was on.

**Blast radius:** Implementor must extend `deckStateRegistry` entry to `{ deck_version, accumulatedCards, cursor_position, V_pending }`. On rejoin, hook restores `deck_version` and skips the realtime pref-change re-aggregation until V_n is exhausted.

---

### CR-5 — Late-join rule
**Target behavior:** A new participant joining mints V_new (their prefs change the union). Existing participants still finish V_n before transitioning to V_new. Late joiner starts on V_new from card #1.

**Current state:** When a participant joins, `realtimeService` fires `onParticipantJoined` → `useBoardSession.ts:335-356` calls `queryClient.invalidateQueries({ queryKey: ['session-deck', sessionId] })` AND `loadSession(sessionId)`. The first invalidation targets a stale dead query key (ORCH-0446 deleted that table), and the second reloads session JSONB, propagating new `participant_prefs` immediately. Existing participants' decks refetch mid-swipe (CR-3 violation cascade), and the late joiner sees the same just-refetched deck. There is no buffer.

**Violations:**
- `app-mobile/src/hooks/useBoardSession.ts:351-355` — direct invalidation + reload on participant join, no version negotiation.
- `app-mobile/src/contexts/RecommendationsContext.tsx:545-566` — `collabDeckParams` recomputes immediately when a new row is added to `allParticipantPreferences`.
- No server-side trigger that increments `deck_version` on participant join (since `deck_version` doesn't exist).

**Blast radius:** Solved by the same `deck_version` mechanism as CR-3. Late join is just another "params hash changed" event from the union's perspective.

---

### CR-6 — Dismissed-cards sheet: visible-but-not-binding
**Target behavior:** Each user's dismissed sheet contains all left-swipes by ANY participant in the session, attributed by name ("Sarah passed on this"). A left-swipe does NOT remove the card from any other participant's deck (the card stays). A left-swipe does NOT prevent the card from reaching the ≥2 right-swipes match quorum.

**Current state:** Dismissed sheet is per-participant local state from AsyncStorage. No cross-participant visibility. The data source `dismissedCards` is sourced from `RecommendationsContext.dismissedCards` array which lives in memory + AsyncStorage (per-mode + per-user key).

**Violations:**
- `app-mobile/src/contexts/RecommendationsContext.tsx:325-338, 827-847` — dismissed cards live in AsyncStorage under `dismissed_cards_${user.id}_${currentMode}` — purely local-only.
- `app-mobile/src/components/DismissedCardsSheet.tsx:22-31` — accepts `dismissedCards: Recommendation[]` prop with no attribution data (no `swiped_by_user_id`, no `swiped_by_name`).
- `app-mobile/src/components/SwipeableCards.tsx:1918-1921, 2541-2544` — passes local `dismissedCards` to the sheet (the same per-participant local list).
- `app-mobile/src/components/helpers/collabSaveCard.ts` — only called for right swipes; left swipes are NOT written to `board_user_swipe_states` via the client path. (However: the table CAN store left swipes; `rpc_record_swipe_and_check_match` accepts `p_swipe_direction='left'` and writes `swipe_state='swiped_left'` — current client just doesn't call it for lefts.)

**Blast radius:** Smallest of all CRs. Server schema (board_user_swipe_states with swipe_state='swiped_left') already supports it. Implementor extends `collabSaveCard.ts` to also record left swipes; adds a query for left swipes filtered by session; updates `DismissedCardsSheet` to render attribution. Subscribe to `board_user_swipe_states` INSERT events on the existing realtime channel for cross-participant visibility.

---

### CR-7 — Retired aggregation rules
**Target behavior:** Retire `travel_mode` MOST PERMISSIVE / `travel_constraint_value` MAX / `custom_lat,lng` midpoint / per-participant GPS fallback / misleading comment.

**Current state:** All five are live:

**Violations (these are the things to delete or replace):**
- `app-mobile/src/utils/sessionPrefsUtils.ts:96-98` — `travelMode` MOST PERMISSIVE.
- `app-mobile/src/utils/sessionPrefsUtils.ts:101-103` — `travelConstraintValue` MAX.
- `app-mobile/src/utils/sessionPrefsUtils.ts:130-140` — `custom_lat/lng` midpoint.
- `app-mobile/src/contexts/RecommendationsContext.tsx:697` — per-participant GPS fallback.
- `app-mobile/src/utils/sessionPrefsUtils.ts:142` — misleading comment "midpoint of all participants' GPS coordinates."

**Blast radius:** All five disappear in the same change. The function `aggregateCollabPrefs` is replaced wholesale (or moved to SQL); the RecommendationsContext hook params slim down to `{ sessionId }`.

---

### CR-8 — Pre-existing ≥2 thresholds preserved (NOT changed)
**Target behavior:** Two existing rules remain unchanged: (1) session-start threshold (≥2 accepted participants before deck mints); (2) match quorum (≥2 right-swipes to promote to board_saved_cards).

**Current state:** Both rules are live and well-tested:
- Session-start threshold: `app-mobile/src/contexts/RecommendationsContext.tsx:1657-1667` (`acceptedCount < 2` → WAITING_FOR_PARTICIPANTS state).
- Match quorum: `supabase/migrations/20260505000000_baseline_squash_orch_0729.sql:3700-3873` (`check_mutual_like` trigger counts swiped_right, promotes at ≥2).

**Violations:** None. CR-8 is "preserve, don't change." The SPEC must NOT touch either rule.

**Compatibility with new model:**
- Session-start threshold composes cleanly: V_1 only mints when ≥2 participants accepted. The new server-side aggregation function must produce `deck_version = 0` (or "no deck yet") until threshold crossed; deck_version = 1 only after.
- Match quorum composes cleanly: left swipes are written to `board_user_swipe_states` per the visible-but-not-binding model (CR-6), but only `swiped_right` rows feed the check_mutual_like trigger. The trigger logic does not change.

---

## 1D — Edge-Case Behavior Matrix

For each case: **TODAY** = what current code does. **CONTRACT** = what CR-1..CR-8 require. **DELTA** = what must change.

| # | Scenario | TODAY | CONTRACT | DELTA |
|---|----------|-------|----------|-------|
| 1 | Same city, both on GPS (no custom pin) | Aggregation `location=null`, each client falls back to own GPS, decks differ by anchor | Each GPS feeds a personal circle, union covers both, single deck served | Remove `?? userLocation` fallback; pass `sessionId` only; server unions both circles |
| 2 | Same city, both set custom pins | Aggregation midpoint of 2 pins, both fetch from midpoint, identical deck | Each pin feeds a personal circle, union of two circles, single deck served | Same union mechanism; midpoint logic deleted |
| 3 | Different cities (NYC + LA), both on GPS | Each client GPS-anchored, two totally different decks | Union of two huge circles centered on each city, single deck mixed across both | Same union mechanism; deck contains venues from both cities |
| 4 | Different cities, both pinned | Aggregation midpoint somewhere in PA, garbage deck for both | Same as case 3 — two-city union | Same union mechanism |
| 5 | One pinned + one on GPS | Aggregation reads only the pin (GPS ignored). Both clients fetch from pin. GPS participant's reachability ignored. | Each location (pin OR GPS) enters the union. GPS participant honored. | Aggregation must read GPS as fallback per-participant, not silently drop |
| 6 | No participant has location at all (GPS denied, no pin) | `location=null`; fallback to per-client `userLocation` (which may also be null) → no deck; edge function returns 400 | Open product question (1E §Q-1) — block or fallback? | Operator decision required |
| 7 | Late join with same prefs | `onParticipantJoined` → invalidate query → reload session → all decks refetch immediately, early joiners lose position | New participant changes union (their location enters); `deck_version` bumps; existing buffer V_new; transition on V_n exhaustion | Add deck_version + buffer state machine |
| 8 | Late join with different prefs | Same as case 7 but params actually change | Same mechanism | Same |
| 9 | Participant leaves mid-V1 | `onParticipantLeft` fires; their row removed from `participants` array; `allParticipantPreferences` reload removes their prefs → `collabDeckParams` recomputes (smaller union) → query key changes → refetch | Their leaving changes union; `deck_version` bumps; existing participants buffer and transition on V_n exhaustion | Same deck_version mechanism |
| 10 | Participant disconnects (does NOT leave) | Their `participant_prefs` row stays; deck is unchanged | Same — disconnection != leave | No change |
| 11 | One participant changes prefs mid-V1 | Immediate refetch, current card vanishes, deck restarts at index 0 | Server mints V_{n+1}; clients buffer; each transitions on V_n exhaustion | Core CR-3 mechanism |
| 12 | Multiple participants change prefs during V1 | Each change triggers immediate refetch; UI thrash | Server keeps `deck_version` monotonic; intermediate V_{n+1}, V_{n+2} coalesce; each client lands on V_latest at the moment of transition | Server-side deck_version must be `>` checked, not `=`, by client; React Query key uses deck_version |
| 13 | V_n exhausted exactly when pref-change-flurry settles | Currently: no V_n exhaustion concept, this scenario doesn't exist | Client transitions to V_latest as known at the moment of last-V_n-swipe | State machine must read `pendingDeckVersion` at transition time |
| 14 | Re-entry mid-V_n | `accumulatedCards` restored from `deckStateRegistry`; React Query cache may serve same key if params identical; otherwise refetch | `deck_version` pinned; restore V_n exactly; ignore intervening pref changes until V_n exhausted | Add `deck_version` to deckStateRegistry entry |
| 15 | Two participants simultaneously right-swipe same card (match quorum) | RPC `rpc_record_swipe_and_check_match` is atomic with advisory lock; check_mutual_like trigger serialized; deterministic match | Unchanged (CR-8) | None |
| 16 | A left-swipes card X, B then right-swipes card X | Today: B can still right-swipe; if 1 more right-swipe arrives, match promotes. A's left swipe doesn't appear in B's sheet. | A's left swipe shows in B's dismissed sheet attributed ("A passed"). Card stays in B's deck. B's right swipe still counts toward quorum. | Add left-swipe write path in `collabSaveCard.ts`; subscribe to swipe-state INSERT events; DismissedCardsSheet renders attribution |
| 17 | A left-swipes card X, B left-swipes card X, C right-swipes card X | Today: A and B don't see each other's lefts; C's right alone doesn't trigger match | A and B see each other's lefts attributed in their sheets; C's right alone doesn't trigger match (need ≥2 rights, still); card stays in C's deck (and in A's + B's after their lefts — but since they swiped, they don't see it again unless they look at the dismissed sheet) | Same as case 16, multi-participant |
| 18 | A right-swipes card X (match telemetry), then changes prefs, then V_n exhausted | A is alone in match attempt; quorum not met; pref change buffered as V_pending; A finishes V_n; A transitions to V_{n+1} (which may or may not include card X depending on new union) | Same flow; if card X is still in V_{n+1} due to union covering its location, A will see it again and can right-swipe again — match telemetry tolerates this (current schema). | Make sure match logic is idempotent across deck versions. Already is (check_mutual_like uses `(session_id, experience_id)` unique key on board_saved_cards). |
| 19 | All participants on GPS, but all in the same building | Today: per-client GPS fallback; each anchors slightly differently; deck differs at edges | Personal circles tiny + overlap; union ≈ small area; single deck served | Same union mechanism |
| 20 | 50 participants in one city | Today: midpoint of N pins (if any pinned), per-client GPS fallback for the rest → high divergence | 50 circles unioned; covers entire metro; single deck server-rendered once per `deck_version` | Server-side aggregation; cache key `(session_id, deck_version)`; identical deck served to all 50 |
| 21 | 100 participants spanning continents | Today: midpoint of N pins (often empty ocean); per-client GPS fallback → 100 different decks | 100 disjoint circles unioned; deck contains venues from every region; same deck for all 100 | Same union mechanism; performance considerations: union may have 100 OR clauses or PostGIS multi-polygon |
| 22 | `dateOption` UNION composes with V_n exhaustion | Today: `dateWindows` UNION is computed and passed to edge fn; immediate refetch on pref change | When date prefs change, `deck_version` bumps; V_n persists until exhausted; V_{n+1} reflects new union | Same deck_version mechanism applies |
| 23 | A pinned in NYC + B is in LA on GPS + B's GPS is unavailable | A's pin enters union; B has no location → open question (Q-1); current code: aggregation reads only A's pin, B sees A's NYC deck (via aggregation result); fallback at line 697 is null because aggregation produced a value | Q-1: do we permit B to join without location? Default proposal: B sees deck centered on the rest of the union (in this case, A's NYC); show banner "you're not contributing a location to the session" | Operator decision; small UI affordance |

---

## 1E — Open Product Questions (operator decision required)

These are surfaced by the current investigation and the SPEC will propose defaults in §2F. Operator must accept or override before SPEC is finalized.

**Q-1 — Participant with no usable location at all (GPS denied + no pin set).** Three options:
- (a) Block them from contributing to the deck — they can view but can't influence union; banner explains.
- (b) Fallback to their last-known location (cached in `app-mobile` AsyncStorage from prior solo session).
- (c) Block them from joining the session entirely until they grant GPS or drop a pin.

**Q-2 — Anchor mutability.** Operator's contract says location is participant-driven (each participant's location enters union). The system does NOT have a session-host-controlled "session anchor." Should the host be allowed to *exclude* a participant's location from the union (e.g., "Marcus is in another city; ignore his circle for this session")? Today, no such control exists.

**Q-3 — Multi-day `selected_dates` UNION semantics under V_n exhaustion.** Today: if A picks Saturday and B picks Sunday, `selected_dates` UNION = ['Saturday', 'Sunday']; cards from both days appear interleaved. Under the new model, this still works, but: when V_n exhausts and a new participant added Sunday → does the *new* deck recompute the union including their day? Default: yes, treat as any other pref change.

**Q-4 — Match quorum during deck-version transition.** If A right-swipes card X in V_n, then prefs change and V_{n+1} drops card X (union shrinks), then B never sees card X — does A's swipe still count toward quorum if B happens to be re-shown card X in V_{n+2} after another change? Today: yes, because `board_user_swipe_states` is per-(session, experience), version-agnostic. Recommended: preserve this behavior — swipes are session-scoped, not version-scoped.

**Q-5 — V_n exhaustion when a participant has dismissed many cards.** Under visible-but-not-binding (CR-6), card X may be in V_n's ordered list, but participant A has already left-swiped it (their own past left). Does A see it again? Two options:
- (a) Cards A has already swiped (left or right) are filtered from A's *displayed* V_n list. They still exist in V_n for B and C.
- (b) Per-participant exclusion is done client-side; the deck V_n is the same shared list, but each participant locally hides cards they've already swiped.

Default proposal: (b). The deck V_n list is the determinism contract; per-participant filtering is a presentation layer concern.

**Q-6 — Performance ceiling for union-of-circles.** At N=100 participants spread globally, the union has 100 circles. The SQL filter becomes 100 OR clauses (or one PostGIS multi-polygon). Need to confirm PostGIS availability or accept the OR-clause performance hit. Suggested investigation: SPEC should propose PostGIS if available; if not, propose a per-participant per-chip fan-out from the edge function with server-side merge.

**Q-7 — Migration path for in-flight sessions.** When this ships, sessions already running on the old code path will have legacy decks. Three options:
- (a) Force-restart all in-flight sessions (their V_old is discarded on next pref change).
- (b) Soft-cutover: old code path continues serving old sessions; new path serves sessions created after the cutover; eventually all old sessions drain.
- (c) Hard-cutover: shipping the new code instantly invalidates old behavior; all participants see V_1 from the new model.

Default proposal: (b) soft-cutover, gated by a `collaboration_sessions.deck_model_version` column.

---

## 1F — Confidence Per Finding

| Finding | Confidence | Why |
|---------|-----------|-----|
| Deck is per-client fetched, no server snapshot | **High** | Schema lacks `session_decks` table; `discover-cards` is stateless; ORCH-0446 deleted the prior snapshot table |
| Aggregation reads custom_lat/lng only, ignores GPS | **High** | Direct read of `sessionPrefsUtils.ts:130-132` |
| Fallback to per-client GPS at line 697 is the determinism leak | **High** | Direct read + threading through `useDeckCards` to `fetchDeck` |
| `discover-cards` ORDER BY is deterministic (signal_score DESC, review_count DESC NULLS LAST, then place_id.localeCompare in collab mode) | **High** | `discover-cards/index.ts:1000-1004` + `query_servable_places_by_signal:5953` |
| `board_user_swipe_states` already stores left swipes | **High** | `rpc_record_swipe_and_check_match` accepts `p_swipe_direction='left'` and writes `swipe_state='swiped_left'`; trigger check_mutual_like only fires for swiped_right (line 3714 guard) |
| `check_mutual_like` trigger uses advisory lock + idempotent ON CONFLICT | **High** | Lines 3700-3873; comment cites ORCH-0558 v3 |
| ≥2 accepted participants threshold lives in `RecommendationsContext.tsx:1657-1667` | **High** | Direct read |
| Realtime sub on `board_session:{sessionId}` has 13 distinct event types | **High** | `realtimeService.ts:306-662` |
| Dead code: `session_decks` table INSERT listener + `['session-deck', sessionId]` query key | **High** | `realtimeService.ts:615-627` + `useBoardSession.ts:353`; ORCH-0446 comment in onDeckRegenerated confirms |
| AsyncStorage key `dismissed_cards_${userId}_${currentMode}` is the dismissed sheet data source | **High** | `RecommendationsContext.tsx:325-338, 827-847` |
| Pref change today triggers immediate refetch and mid-card UI yank | **High** | Trace from `upsert_participant_prefs` → realtime → `setAllParticipantPreferences` → `collabDeckParams` memo → React Query key change → refetch |
| Late join invalidates legacy stale query key + reloads session | **High** | `useBoardSession.ts:351-355`; the invalidation is structurally moot (key has no producer) but the reload is the actual trigger |
| No `deck_version` field anywhere in schema | **High** | Direct schema search across migrations |
| `query_servable_places_by_signal` accepts a single anchor lat/lng | **High** | Migration lines 5905-5955 |
| PostGIS availability | **Low** | Did not run `\dx` / `SELECT * FROM pg_extension`; SPEC must verify before assuming |
| Performance behavior of 100-circle union | **Low** | Not benchmarked; theoretical only |
| Behavior of `deckStateRegistry` across cold start (full app restart) | **Medium** | Source-read; not live-fire tested |
| Whether `onDeckRegenerated` is truly never fired (table deleted) | **Medium** | Comment claims ORCH-0446 deleted the table; not verified against active migrations |

Live-fire of described scenarios was NOT performed for this investigation per dispatch §"Hard guards" item 7 (Phase 1 deliverable is source-level; live-fire would be appropriate for a tester verification of the eventual implementation). All claims about runtime behavior are source-traced.

---

## Cross-references

- **Locked contract:** [`Mingla_Artifacts/reports/INVESTIGATION_ORCH-0902_COLLAB_DECK_PARITY.md`](INVESTIGATION_ORCH-0902_COLLAB_DECK_PARITY.md) — CR-1..CR-8 (the contract this investigation maps against)
- **SPEC** (produced alongside this report): [`Mingla_Artifacts/specs/SPEC_ORCH-0902_COLLAB_DECK_DETERMINISTIC_REWRITE.md`](../specs/SPEC_ORCH-0902_COLLAB_DECK_DETERMINISTIC_REWRITE.md)
- **Durable memory:** `~/.claude/projects/-Users-sethogieva-Desktop-mingla-main/memory/feedback_collab_deck_determinism_contract.md`

---

### Layman summary of the report

- **Today's collab deck is per-client computed.** Each participant independently aggregates everyone's preferences and fetches their own copy of the deck. There is no shared server-side deck object.
- **One line breaks parity.** `RecommendationsContext.tsx:697` does `collabDeckParams?.location ?? userLocation` — when the aggregated location is null (which happens whenever no participant has set a custom pin), each participant silently falls back to their own GPS, generating different decks.
- **Aggregation only reads custom pins.** `sessionPrefsUtils.ts:130-132` filters to rows where `custom_lat/lng` are set, ignoring GPS users entirely. The comment one line above says it reads GPS — the comment lies.
- **Travel mode + time use a single winner.** Today's aggregation picks the most permissive mode and the longest time, then anchors at one midpoint. Participants with shorter/weaker reachability are silently overridden.
- **No version primitive exists.** `collaboration_sessions` has no `deck_version` column. There is no way for the server to say "everyone refresh now" except by changing the params themselves and trusting clients to recompute identically.
- **Pref changes yank the current card.** The realtime path is: prefs change → JSONB updates → realtime fires → all clients re-read → memo recomputes → React Query key changes → cache miss → refetch. Current card vanishes mid-view. No exhaustion buffer.
- **Late-join is a sledgehammer.** When a new participant joins, the code invalidates a legacy (and structurally moot) query key AND reloads the session, causing all existing participants' decks to refetch immediately.
- **Left swipes are already persisted on the server, just unused.** The `board_user_swipe_states` table accepts `swipe_state='swiped_left'` rows via existing RPC; the client just doesn't call it for lefts today. The visible-but-not-binding dismissal model (CR-6) is essentially "start calling this RPC for lefts and query the table per session."
- **Match quorum (CR-8) is well-built and untouched.** The `check_mutual_like` trigger uses an advisory lock + idempotent INSERT ON CONFLICT. The ≥2 right-swipes rule composes cleanly with the new model.
- **Two pieces of dead code should be cleaned up.** `realtimeService.ts:615-627` listens for INSERT on a deleted table; `useBoardSession.ts:353` invalidates a query key with no producer.
- **The `discover-cards` edge function is already mostly deterministic.** Collab mode sorts by `place_id.localeCompare` and zeroes match scores. The only non-determinism is what the *client* sends as input.
- **Seven open product questions** were surfaced: missing-location policy, anchor mutability, multi-day union behavior under transitions, match quorum across versions, per-participant dismissal filtering, PostGIS availability, and migration path for in-flight sessions.
- **The contract requires changes in 7 places:** new `deck_version` + `deck_params_hash` columns, server-side aggregation function, modified `discover-cards` to accept `session_id` only, retired client-side aggregation, deck_version-aware client state machine for V_n exhaustion buffering, extended `collabSaveCard` for left swipes, and an updated `DismissedCardsSheet` with attribution.
- **Surfaces affected:** Consumer iOS + Consumer Android only (collab session is consumer-app-only). No business / admin / buyer-web impact.
- **All findings cite file paths and line numbers; confidence levels are stated.** Source-only reasoning was bounded by the dispatch (Phase 1 is investigation, not live-fire). Implementation testing will require simulator parity per the operator's standing rule.
