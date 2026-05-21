# INVESTIGATION — ORCH-0902 [Collab Session Deck Parity Across All Participants]

**Date:** 2026-05-21
**Investigator:** Claude `mingla-orchestrator` (delegated investigation; operator's "take over" request)
**Scope:** Consumer iOS + Consumer Android (`app-mobile/`)
**Surfaces explicitly NOT in scope:** business-iOS, business-Android, admin-web, business-web-preview, buyer-web (collab sessions are consumer-app only)
**Verdict:** **NOT THE CASE.** Participants in a collab session do **not** reliably see the same deck. Multiple silent-failure paths produce per-participant divergence.

---

## TL;DR (layman terms)

When two or more people join a collab session, the app does **not** generate one shared deck and stream it to everyone. Each participant **independently re-computes their own deck** from a shared set of *parameters* (aggregated category preferences, travel mode, dates, and one location point). The intent is: same parameters → same card pool → same deck.

The intent breaks in five specific ways:

1. **No participant set a custom location → each participant silently uses their OWN GPS as the deck anchor.** Two people in the same room with phones a block apart get two different decks. Two people in different cities get **completely different city decks** and nobody is warned.
2. **One participant set a custom location, others didn't → the deck is centered on that one person's pin.** The others' GPS positions are ignored entirely.
3. **All participants set custom locations spanning different cities → the deck is centered on the *midpoint* of those points.** For NYC + LA participants that's somewhere in Pennsylvania, producing an empty/garbage card pool nobody asked for.
4. **Different time of entry → the late joiner starts at card 0; the early joiner is at card 20.** They are looking at different cards at the same wall-clock moment. There is no shared swipe-position cursor.
5. **No shared swipe history → if Participant A swipes left on a card, Participant B still sees that same card.** Each participant's swipe state is local-only.

There is also no realtime "deck broadcast." When parameters change, each client re-fetches independently. The pool is deterministic, so *in theory* both fetch the same list — but item #1 above means their location parameters silently diverge before the fetch even fires.

**The single most dangerous gap is #1**, because it fails silently with no error UI. Two friends planning a date can be staring at completely different decks for the entire session and never know.

---

## How the deck actually works today

### Architecture
- **No shared deck table.** There is no `session_decks`, `collab_session_cards`, or equivalent storage. Decks are not persisted.
- **Per-participant fetch.** Each client calls the `discover-cards` Supabase edge function independently.
- **Determinism by parameter alignment.** The contract is: identical params in → identical card pool out. There is no server-side "session anchor" concept.

### Files in the chain
| Layer | File | Lines |
|-------|------|-------|
| Aggregation | [app-mobile/src/utils/sessionPrefsUtils.ts:48-159](app-mobile/src/utils/sessionPrefsUtils.ts#L48-L159) | `aggregateCollabPrefs()` |
| Param resolution + fallback | [app-mobile/src/contexts/RecommendationsContext.tsx:693-716](app-mobile/src/contexts/RecommendationsContext.tsx#L693-L716) | collab hook instantiation |
| React Query hook | [app-mobile/src/hooks/useDeckCards.ts:149-235](app-mobile/src/hooks/useDeckCards.ts#L149-L235) | location → query key → fetch |
| Deck fetch | [app-mobile/src/services/deckService.ts:347-733](app-mobile/src/services/deckService.ts#L347-L733) | `fetchDeck()` |
| Edge function | [supabase/functions/discover-cards/index.ts:620-1050](supabase/functions/discover-cards/index.ts#L620-L1050) | location validation @ 644 |
| Realtime preference sync | [app-mobile/src/hooks/useBoardSession.ts:310-400](app-mobile/src/hooks/useBoardSession.ts#L310-L400) | `subscribeToBoardSession` |
| Schema | `supabase/migrations/20260505000000_baseline_squash_orch_0729.sql:7289+` | `collaboration_sessions.participant_prefs` JSONB |

### The aggregation rule (the load-bearing logic)
[sessionPrefsUtils.ts:129-140](app-mobile/src/utils/sessionPrefsUtils.ts#L129-L140):

```typescript
// Location: midpoint of all participants' GPS coordinates (R3.6)
const coords = rows
  .filter(r => r.custom_lat != null && r.custom_lng != null)
  .map(r => ({ lat: r.custom_lat!, lng: r.custom_lng! }));

let location: { lat: number; lng: number } | null = null;
if (coords.length > 0) {
  location = {
    lat: coords.reduce((s, c) => s + c.lat, 0) / coords.length,
    lng: coords.reduce((s, c) => s + c.lng, 0) / coords.length,
  };
}
```

The comment on line 129 says "midpoint of all participants' GPS coordinates" — **but the code does not read GPS**. It reads `custom_lat / custom_lng`, the manually-set pin location. Participants whose location is "use my GPS" are filtered out of the aggregation entirely.

### The silent fallback
[RecommendationsContext.tsx:696-697](app-mobile/src/contexts/RecommendationsContext.tsx#L696-L697):

```typescript
location: isCollaborationMode
  ? (collabDeckParams?.location ?? userLocation)
  : null,
```

When `collabDeckParams.location` is `null` (no participant set a custom location), the hook falls back to **the current participant's own GPS** (`userLocation`). This fallback is per-participant: Participant A falls back to A's GPS, Participant B falls back to B's GPS. They both get a deck, but the decks are anchored on different points.

There is no error, no warning, no "are you in the same city?" gate. The session just runs with diverged decks.

---

## Per-edge-case verdict

| Case | Outcome | Verdict |
|------|---------|---------|
| **(a) Same city, both used GPS (no custom pin)** | Each fetches from their own GPS. Card pools overlap heavily but ordering and radius-edge inclusion can differ. | **PARTIAL** — looks fine on the surface, decks drift at the edges |
| **(b) Same city, both set custom pins** | Aggregation midpoint computed; both fetch same midpoint → same deck. Works. | **HANDLED** |
| **(c) Different cities, both used GPS** | Each fetches from their own GPS. **Completely different city decks.** No warning. | **NOT HANDLED — silent failure** |
| **(d) Different cities, both set custom pins** | Midpoint computed in geographic dead zone (NYC + LA → Pennsylvania). Card pool is garbage for both. | **NOT HANDLED — produces wrong-city deck** |
| **(e) One set custom pin, other on GPS** | Only the custom pin counts. Other participant's GPS is ignored. Deck centered on the one pin. | **PARTIAL — silently disenfranchises GPS participant** |
| **(f) Different locations within same city (Brooklyn vs Manhattan, both pinned)** | Single midpoint location. Travel constraint takes the MAX of participants' limits (more permissive). Card filtering uses one center + one radius, not per-participant overlap. | **PARTIAL — radius from midpoint may exclude cards near each participant** |
| **(g) Different time of entry** | Late joiner gets the deck computed from current aggregated params (likely same pool if params stable), but starts at card 0. Early joiner is at card N. No shared cursor. Realtime invalidation does refire deck on `onParticipantJoined` ([useBoardSession.ts:353](app-mobile/src/hooks/useBoardSession.ts#L353)) — so early joiner's deck **restarts** when late joiner arrives. | **NOT HANDLED — late join disrupts early joiner's progress** |
| **(h) Leave + rejoin** | Same params → same pool (cached if available). Swipe state restored from local AsyncStorage via `deckStateRegistry`. | **PARTIAL** — works for the rejoiner; other participants don't see what the rejoiner had swiped |
| **(i) Solo → collab transition** | Solo deck saved to registry, new fresh-fetched collab deck loaded. No card-continuity. | **HANDLED (by design — fresh deck)** |
| **(j) Each participant swipes independently** | Per-participant `removedCards` in-memory. No shared "rejected by anyone" set. Same card can be presented to every participant separately. | **NOT HANDLED — no shared swipe state** |

---

## Critical gaps (ranked)

1. **[P0 — silent cross-city failure]** Two participants in different cities, both on GPS (the default), each see their own city's deck with no warning. (Case c.)
2. **[P0 — silent cross-city failure with custom pins]** Two participants in different cities, both with custom pins, get a deck centered on the geographic midpoint (often outside any served city). (Case d.)
3. **[P1 — no shared swipe progress]** A swipes left on a place; B still sees it. No "we've collectively rejected this" set. (Case j.)
4. **[P1 — late-join disrupts the in-progress deck]** When B joins late, the realtime callback invalidates A's query, causing A's deck to refetch and lose position. (Case g.)
5. **[P1 — partial-pin disenfranchisement]** If one participant pins and the other relies on GPS, only the pinner's location counts. (Case e.)
6. **[P2 — radius from midpoint asymmetric]** In same-city wide-spread cases, the single-midpoint single-radius filter under-serves both participants. (Case f.)
7. **[P2 — misleading code comment]** `sessionPrefsUtils.ts:129` says "midpoint of all participants' GPS coordinates" but the code uses `custom_lat/lng` only. Future readers will trust the comment and miss the bug.
8. **[P3 — no UI surfacing of location-mismatch]** No "you and your friend are in different cities — pick one" picker, no "no shared location set" warning.

---

## Truth-layer cross-check

| Layer | What it says |
|-------|-------------|
| **Docs / comment** | "midpoint of all participants' GPS coordinates" (sessionPrefsUtils.ts:129) |
| **Code** | Uses `custom_lat / custom_lng`, NOT GPS |
| **Schema** | `participant_prefs` JSONB has both `use_gps_location` boolean and `custom_lat/lng` — both exist but aggregation only reads custom |
| **Runtime** | When no custom set, aggregation returns `location: null`; hook falls back to `userLocation` (this participant's GPS) per [RecommendationsContext.tsx:697](app-mobile/src/contexts/RecommendationsContext.tsx#L697) |
| **Data** | Each participant's `removedCards` lives in their local Zustand/AsyncStorage — never written back to the session JSONB |

Layers disagree. Comment claims GPS-midpoint; code does custom-only; client falls back to per-participant GPS; nothing produces a true "session anchor."

---

## Confidence per finding

| Finding | Confidence | Why |
|---------|-----------|-----|
| Decks are per-participant, not shared-stored | High | No `session_decks` table in schema; deckService.fetchDeck called from each client |
| Aggregation reads custom_lat/lng only | High | Direct read of sessionPrefsUtils.ts:130-132 |
| Fallback to per-participant GPS | High | Direct read of RecommendationsContext.tsx:697 + useDeckCards param threading |
| Edge function requires location | High | discover-cards/index.ts:644-649 |
| Late-join invalidates early joiner's deck | High | useBoardSession.ts:353 explicit `queryClient.invalidateQueries({ queryKey: ['session-deck', sessionId] })` |
| Per-participant swipe state | High | RecommendationsContext.tsx:191-192 + appStore in-memory; no write-back to participant_prefs |
| Midpoint produces geographic dead zone for far cities | High | Simple geometry from sessionPrefsUtils.ts:136-139 |
| No "session anchor" concept in schema | High | participant_prefs JSONB has per-participant custom_lat/lng, no session-level lat/lng column |
| Travel constraint MAX is correct behavior | Medium | sessionPrefsUtils.ts:101-103 takes MAX; whether MAX vs MIN is "right" depends on UX intent |
| No UI surfaces mismatched-location warning | Medium | Did not exhaustively search every collab UI surface |

---

## Recommended next steps (orchestrator's call)

This is an investigation, not a spec. The fix surface is non-trivial — it affects schema (do we need a `session_anchor_lat/lng`?), UX (location-mismatch warning?), aggregation (replace midpoint with a chosen anchor?), and realtime (broadcast a session-level deck position cursor?). That belongs in SPEC, not here.

Suggested SPEC scope for ORCH-0902:
1. **Session anchor location** — one canonical lat/lng for the session, set explicitly at session creation (or by the session host) and frozen. All participants fetch from this anchor, regardless of their own GPS.
2. **Location-mismatch UX gate** — if a participant's GPS is >50km from the session anchor, surface a clear "you're far from the session location — using {anchor city}" badge.
3. **Shared swipe history** — write swipe outcomes to a `session_swipes` table (or to participant_prefs); aggregate excludeCardIds across all participants before each fetch.
4. **Shared deck cursor (optional)** — broadcast position so the session has a sense of "we're at card 23 together," or accept divergent positions as intentional.
5. **Late-join behavior** — explicit decision: do we restart the deck for everyone when someone joins, or do we let late joiners catch up?
6. **Remove misleading comment** at sessionPrefsUtils.ts:129.

Decide which of (1)–(5) are in scope before dispatching SPEC.

---

## Confirmed Design Direction (operator-approved 2026-05-21)

The following rules are CONFIRMED by the operator and are the contract any SPEC for ORCH-0902 must honor. Recorded so future sessions don't re-derive.

### CR-1 — Determinism contract
> For every participant P in session S at wall-clock time T, the deck function returns the same ordered card list. The deck is a pure function of session state, not per-participant state.

### CR-2 — Location model: union of per-participant reachable areas
Each participant has a personal reachable circle computed from their `location + travel_mode + travel_constraint_value` (location is custom pin if set, else GPS). The deck pool is the **union** of every participant's circle. A venue qualifies if reachable by ≥1 participant. The current `travel_mode` MOST-PERMISSIVE and `travel_constraint_value` MAX aggregations are RETIRED in favor of per-participant circles unioned. Filter layers (`categories`, `intents`, `dates`) remain union-based, toggle-gated as today.

### CR-3 — Pref-change cutover: full V1 exhaustion before V2
A pref change at moment T does NOT update the deck mid-session for anyone. Each participant continues swiping the deck that existed at moment T (call it V_n) all the way through its final card. ONLY AFTER swiping the last card of V_n does that participant's next swipe show V_{n+1} card #1. No card is yanked mid-view. No swipe progress is lost. V_{n+1} is minted server-side immediately at T and cached by deck_version; each client converges on it independently on its own personal V_n-exhaustion moment.

Intermediate pref changes coalesce — V_latest at the moment of transition is what each client lands on; intermediate V_{n+1}, V_{n+2}, … never become visible if more changes happen before exhaustion.

### CR-4 — Resume rule
A user who stops mid-V_n and comes back later resumes V_n at their cursor position. They owe themselves the rest of V_n before any pref change kicks in for them.

### CR-5 — Late-join rule
A new participant joining mints V_new (their prefs change the union). Existing participants still finish their current V_n before transitioning to V_new. The late joiner starts on V_new from card #1.

### CR-6 — Dismissed-cards (swiped-left) sheet: visible-but-not-binding
Each user's dismissed sheet is a chronological record of cards left-swiped from the shared deck. History persists across deck-version transitions: V_n left-swipes stay in the sheet after the user transitions to V_{n+1}.

**Operator-confirmed 2026-05-21: Model 2 (visible-but-not-binding) dismissal.**
- Left-swipes from any participant appear in **every** participant's dismissed sheet, attributed by name ("Sarah passed on this").
- A left-swipe does NOT remove the card from any other participant's swipe deck.
- A left-swipe does NOT prevent the card from reaching the ≥2 right-swipes match quorum (CR-8) — passes are social signal, not vetoes.

### CR-7 — Retired aggregation rules under this model
- `travel_mode` MOST PERMISSIVE → retired (per-participant feeds personal circle)
- `travel_constraint_value` MAX → retired (per-participant feeds personal circle)
- `custom_lat/lng` midpoint → retired (each location enters its own circle in the union)
- `RecommendationsContext.tsx:697` per-participant GPS fallback → retired (each participant's location is read directly into the circle; no fallback drift)
- Comment at `sessionPrefsUtils.ts:129` ("midpoint of all participants' GPS coordinates") → delete/replace with union-of-reachable-areas semantics

### CR-8 — Existing thresholds preserved (NOT changed by this contract)
Two pre-existing ≥2 rules continue unchanged under the new model:

1. **Session-start threshold** — [`RecommendationsContext.tsx:1662-1666`](app-mobile/src/contexts/RecommendationsContext.tsx#L1662-L1666): a session needs ≥2 accepted participants before any swipe deck is minted. Below threshold, UI is `WAITING_FOR_PARTICIPANTS`.
2. **Match (save) quorum** — [`collabSaveCard.ts:11`](app-mobile/src/components/helpers/collabSaveCard.ts#L11): a card requires ≥2 right-swipes within the session to be promoted to `board_saved_cards` (the "Cards tab" / saved-matches view). Single-likes show `Liked — waiting for others`.

These are independent of CR-1…CR-7. The new contract does NOT change the swipe-deck admission rule (no likes required — any union-eligible venue is in the deck) or alter match-quorum logic.

---

## Follow-up artifacts (2026-05-21 deep dispatch return)

- **Deep current-state investigation:** [`Mingla_Artifacts/reports/INVESTIGATION_ORCH-0902_DEEP_COLLAB_DECK_CURRENT_STATE.md`](INVESTIGATION_ORCH-0902_DEEP_COLLAB_DECK_CURRENT_STATE.md) — bird's-eye architecture map, inventory of 32 participating components, per-CR violation map (CR-1..CR-8), edge-case behavior matrix (23 scenarios), open product questions, confidence per finding.
- **Spec for the rewrite:** [`Mingla_Artifacts/specs/SPEC_ORCH-0902_COLLAB_DECK_DETERMINISTIC_REWRITE.md`](../specs/SPEC_ORCH-0902_COLLAB_DECK_DETERMINISTIC_REWRITE.md) — layered change list (schema/RPC/edge function/client/realtime/migration), per-CR success criteria, five new invariants, six required test cases, rollback plan, and proposed defaults for four open product questions.

## CR-9 — Full cutover, no legacy collab code retained (operator-confirmed 2026-05-21)

The migration is single-shot: every collab session moves to the new deterministic system on ship. Legacy collab code paths (`aggregateCollabPrefs`, `?? userLocation` fallback at `RecommendationsContext.tsx:697`, legacy collab body acceptance in `discover-cards`, the `session_decks` INSERT listener, the `['session-deck', sessionId]` dead query key, and `onDeckRegenerated`) are DELETED in the same commit as the rewrite. No `deck_model` soft-cutover column exists. Rollback is a single `git revert <merge-sha>` if TEST FAILS.

**Why:** Operator directive 2026-05-21 — "Everyone should be forced to the new system, all decks updated. I want the old system deleted once we finish and conclude it's a pass." This supersedes the SPEC's original §2A.23 / §2E / §2F Q-7 soft-cutover plan.

**How to apply:** The Final Operator Decisions section at the top of the SPEC is authoritative — implementor reads that section first and overrides any inline references to `deck_model` or soft-cutover throughout the rest of the SPEC.

## Final Operator Decisions on the four open SPEC questions (2026-05-21)

| Question | Decision |
|----------|----------|
| Q-1 — no-location participant policy | ACCEPTED AS PROPOSED: allow join, banner, no contribution to union |
| Q-6 — PostGIS verification | ACCEPTED AS PROPOSED: implementor verifies day-one; PostGIS path preferred, Haversine+50-participant cap fallback |
| Q-7 — migration path | OVERRIDDEN: full single-shot cutover, old code deleted in same PR upon TEST PASS, no `deck_model` flag |
| Q-A — resume across deck versions | ACCEPTED AS PROPOSED: persist per-version params history in new `session_deck_versions` table |
