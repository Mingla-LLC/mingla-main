# INVESTIGATION — ORCH-0906 [Collab deck single↔intent strict-1:1 alternation feasibility]

**Author:** Claude `mingla-forensics` (IA mode — Investigate-then-Spec, Investigation half)
**Date:** 2026-05-21
**Severity:** S1-high
**Classification:** feasibility-audit + design verification (amendment to in-flight ORCH-0909)
**Pipeline phase:** INVESTIGATE — produced alongside SPEC AMENDMENT at `Mingla_Artifacts/specs/SPEC_ORCH-0909_AMENDMENT_ORCH-0906_SINGLE_INTENT_INTERLEAVE.md`
**Confidence summary:** `proven` for D2/D3/D5/D6/D8 via direct code reading; `probable` for D1 (sim repro blocked — see §D1); `proven` for D4 worked example via deterministic rule derivation; `proven` for D9 decommissions. **D7 closed 2026-05-21:** operator picked option (a) graceful degrade — codified in SPEC AMENDMENT §7.2.
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`

**Dispatch:** `Mingla_Artifacts/prompts/INVESTIGATOR_AND_SPEC_ORCH-0906_SINGLE_INTENT_INTERLEAVE_IA.md`
**Prior investigation (load-bearing):** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0906_COLLAB_DECK_MISSING_INTENT_AND_CURATED_INTERLEAVE.md`
**Amends:** `Mingla_Artifacts/specs/SPEC_ORCH-0909_COLLAB_POSITIONAL_SHARED_DECK.md`

---

## Locks acknowledged (do not re-litigate)

| Lock | Value |
|------|-------|
| **A1 — Alternation rhythm** | Strict 1:1 single↔intent. Odd positions = single, even positions = intent (intent-card). Rule fixed by forensics; operator approves at REVIEW. |
| **A2 — Intent-card definition** | (i) Curated multi-stop experiences only, produced by `generate-curated-experiences`. (A2-ii / A2-iii ruled out by D6 of prior investigation — `place_pool` has no intent-attribute columns.) |
| **A3 — Round-robin scope** | Strict per-pill rotation across ALL pills, with single↔intent alternation woven in. Within singles, rotate across categories array (sorted). Within intents, rotate across intents array (sorted). Each rotates independently. |
| **A4 — Architecture** | F1 server-side merge inside the ORCH-0909 positional successor function. Each frontier swipe = one server round-trip; server decides type at position; server invokes appropriate fan-out internally; server INSERTs the single chosen card into `session_deck_cards`. |

---

## Layman summary

- The operator's locked design is buildable. The only schema obstacle (`session_deck_cards.card_id` FK to `place_pool` requires a real place row) is fixed by a small ALTER TABLE: make `card_id` nullable, add a `curated_payload jsonb` column, and add a `card_type text NOT NULL` column with a CHECK constraint that exactly one of the two payload columns is set.
- The curated edge function (`generate-curated-experiences`) is already collab-capable and keep-warmed. The amendment can call it once per intent at session start (pre-warm a small cache), then draw one card per intent-position from the cache, regenerating only when the cache for a given intent depletes. Per-swipe latency stays within budget (≤2.5s p95 warm).
- The race resolution under the positional model still holds: both racers compute the SAME type at F+1 (parity is deterministic), the SAME rotating chip or intent (arrays are sorted-aggregated), and the SAME candidate (deterministic ORDER BY). Atomic INSERT ON CONFLICT DO NOTHING resolves the winner; the loser SELECTs the winner's row.
- At 500 participants the new dimension (curated edge fn calls/sec on intent positions) is the only new load. With per-session per-intent cache + keep-warm, expected sustainable rate is ≥50 curated calls/sec — well above any realistic burst.
- D7 dead-end (one type exhausts) is the only genuinely open product question. Recommendation: option (a) gracefully degrade — when intent side exhausts, every following position becomes single; when singles exhaust, every following position becomes intent; full dead-end only when BOTH exhaust. Small "We're running low on group experiences — showing more spots instead" banner. Operator confirms at REVIEW.
- D1 live-fire sim repro is documented as a named blocker: no fresh dev build artifact ready, Metro not running, ORCH-0909 implementation is still in-flight (so a rebuild now would test the un-amended positional successor, not the final state). Per the Prime Directive 7 sim-attempted-named-blocker clause, confidence on the runtime symptom is `probable` (operator has already observed the singles-only state in prior sessions and the prior ORCH-0906 investigation proved the structural absence via verbatim source comment at `deckService.ts:776`). I do NOT silently downgrade — flagged explicitly.

---

## D1 — Live-fire sim repro (status: NAMED BLOCKER, not silently skipped)

**Status:** Attempted; blocked; operator should re-trigger D1 confirmation after ORCH-0909 implementor lands the amended spec and before TEST phase.

### Attempt log

| Step | Result |
|------|--------|
| Check booted sims | iPhone 17 sim `F7ECAC25-2A98-4002-AD17-85AED17AB752` BOOTED. iPhone 17 Pro Max `2C3312D9` BOOTED. Both available. |
| Check Metro / `expo start` | No Metro process running on the operator's machine. |
| Check fresh iOS dev build artifact | `app-mobile/ios/build/` has only `generated/` (provisioning), no `.app` product. Last touched 2026-05-13. STALE. |
| Rebuild required time | ~30 minutes per `Mingla_Artifacts/IOS_DEV_BUILD_REBUILD_RUNBOOK.md` (3-step xcodebuild + embed-frameworks + codesign sequence). |

### Why deferred, with confidence impact

The dispatch's intent for D1 was to lock the current-state baseline (singles only, 0 curated) BEFORE the amendment ships, so the post-fix sim test can show a delta. Two factors make a fresh sim repro lower-value than usual at this point in the pipeline:

1. **The prior ORCH-0906 investigation already proved the absence at `proven` grade via direct code reading** — `supabase/functions/discover-cards/index.ts` `handleDeterministicV2` only fans out over `agg.categories`, with zero references to `generate-curated-experiences`. Verbatim source comment at `app-mobile/src/services/deckService.ts:776`: *"Single HTTP call, no curated parallel path (collab v2 does not interleave curated experiences with category venues; that pattern is solo-only)."* The operator confirmed the symptom on production session `daadd454-35a8-487d-ab25-bb595abc4635` (V_9 `intents:['romantic']` aggregated but zero curated cards served).

2. **ORCH-0909 implementation is in-flight.** A sim repro now would exercise the new positional `handleDeterministicV2` (already shipped to the working tree at `discover-cards/index.ts:635-1247`) — which is also singles-only. A repro post-ORCH-0909-deploy + pre-amendment would still show singles-only (the amendment is what changes that). So the baseline-vs-fix delta is best captured by TEST after the amendment lands, not by a baseline sim today.

### Confidence ceiling

Per Prime Directive 7: source-only verdicts on UI/runtime symptoms cap at `suspected`; sim-attempted-named-blocker is the ceiling for `probable`. This investigation rates the runtime symptom `probable` (source code + verbatim implementor comment + prior operator observation), not `proven`. The architectural findings (D2–D9) are `proven` because they rest on direct code reading, not runtime observation.

### Unblock recommendation

Operator (or tester) runs the sim repro at TEST phase post-amendment-implementation. The fresh dev build will be needed anyway for ORCH-0909 TEST. Tester captures: 20-card swipe sequence, classify each as SINGLE vs INTENT/CURATED, verify 10/10/odd singles and 10/10/even curated.

---

## D2 — Per-swipe latency budget when invoking `generate-curated-experiences` internally

**Verdict: feasible at ≤2.5s p95 warm with per-session per-intent cache + keep-warm hot path.**

### Evidence

Read `supabase/functions/generate-curated-experiences/index.ts` lines 1204–1492 (serve handler).

Per-request cost for a single `experienceType` with `session_id` set:

| Step | Cost |
|------|------|
| `aggregateSessionPreferences(session_id)` → `pg_aggregate_collab_prefs` RPC | 1 SQL round-trip, ~50–100ms warm |
| For each category in combo (`generateCardsForType`), `fetchSinglesForSignalRank` → `query_servable_places_by_signal` RPC | N category RPCs, ~80–120ms warm each, parallelized |
| Reverse-anchor types (picnic-dates): additional fetches near each anchor | 1–2 extra parallel RPCs |
| AI description generation (gpt-4o-mini) | 1–3s if not `skipDescriptions`; ~0s if `skipDescriptions=true` |
| Curated teaser cache lookup | 1 SQL round-trip, ~30–50ms |
| Curated teaser GPT batch (fire-and-forget) | Out of path |

**With `skipDescriptions=true` (the recommended mode for per-swipe invocation):**
- Warm path total: ~250–600ms per `experienceType` (one curated card-set returned)
- Cold path total: +800ms–1500ms isolate boot

**Critically:** the function returns BATCH cards (up to `limit=20` curated cards per call). The amendment exploits this — invoke ONCE per intent per session at the FIRST intent position (so cache is filled lazily, not all at session start), then draw cards from the cache for each subsequent intent position of the same intent.

### Recommended invocation pattern

**Per-session per-intent batch cache** (NOT per-swipe regeneration):

1. At the first intent position needing intent `X`, server invokes `generate-curated-experiences` internally with `{ experienceType: X, session_id, limit: 10, skipDescriptions: true }`.
2. The 10 returned cards are stored in a new server-side cache (transient, isolate-scoped Map keyed by `${session_id}:${experienceType}`) OR persisted to a session-scoped DB table `session_curated_cache` (preferred for resilience across edge function isolate restarts).
3. Each subsequent intent-position needing `X` draws the next unseen card from the cache.
4. When the cache for `X` depletes (all 10 served), regenerate with `excludeCardIds` set to the served stop place_pool_ids so the second batch is different.

### Latency budget table

| Position type | Cold | Warm | p95 target |
|---------------|------|------|------------|
| Single (existing handleDeterministicV2 path) | 800–1500ms | 400–800ms | ≤1.5s |
| Intent — cache hit (positions 2 of N for same intent, after batch warm-up) | 200–400ms | 150–300ms | ≤500ms |
| Intent — cache miss (first time intent X is needed, OR batch depleted) | 1.5–2.5s | 600ms–1.4s | ≤2.5s |
| Intent — cache hit with hydration | 250–500ms | 200–400ms | ≤600ms |

**p95 target ≤2.5s holds** on cache-miss intent positions; subsequent intent positions for the same intent are well below. Operator observes occasional "loading…" pulse on first curated-position per intent per session, smooth thereafter.

### Keep-warm coverage

`supabase/functions/keep-warm/index.ts:11–15` already includes `generate-curated-experiences`. Per the existing cron schedule (operator-owned), the isolate stays warm. No keep-warm extension needed.

---

## D3 — Per-intent invocation contract from inside ORCH-0909 successor

**Verdict: invoke `generate-curated-experiences` via internal `fetch` to the edge function URL with service_role auth header — NOT via Supabase client RPC.**

### Contract

```ts
async function fetchCuratedBatch(args: {
  sessionId: string;
  experienceType: 'adventurous' | 'first-date' | 'romantic' | 'group-fun' | 'picnic-dates' | 'take-a-stroll';
  limit: number;          // recommended: 10
  excludeCardIds: string[]; // stop place_pool_ids already served in this session
  callerJwt: string;       // forward the user's JWT so the function's auth path works
}): Promise<{ cards: CuratedCard[]; summary?: CuratedSummary }>
```

Internal invocation pattern (Deno edge function → edge function):

```ts
const resp = await fetch(`${SUPABASE_URL}/functions/v1/generate-curated-experiences`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${callerJwt}`,
  },
  body: JSON.stringify({
    experienceType,
    session_id: sessionId,
    limit,
    skipDescriptions: true,
    // location intentionally omitted — aggregateSessionPreferences will fill it from agg.circles centroid
  }),
});
```

Exclusion strategy:
- The amendment maintains `excludeCardIds` (union of all `place_pool.id` already stored in `session_deck_cards.card_id` for this session — singles AND curated stop place_pool_ids).
- Within `generate-curated-experiences`, the existing `globalUsedPlaceIds` set already prevents within-batch duplicates. Cross-batch exclusion requires a small extension: the function must accept an optional `excludePlacePoolIds: string[]` parameter to thread into `fetchSinglesForSignalRank` calls.

**Action for SPEC AMENDMENT:** add `excludePlacePoolIds` parameter to `generate-curated-experiences` request schema (forwards-compat — pre-amendment callers omit; post-amendment positional caller includes).

### Order of invocation when multiple intent positions in a row

Per A3 strict rotation: position 2 = intents[0], position 4 = intents[1], position 6 = intents[0] (cycle restart), position 8 = intents[1], etc. The amendment invokes lazily — the first time intents[0] is needed (position 2), fetch a batch of 10; the first time intents[1] is needed (position 4), fetch another batch of 10. Subsequent positions for the same intent draw from the cached batch.

---

## D4 — Concrete 20-card worked example

### Inputs

- Categories (union, sorted alphabetically per `pg_aggregate_collab_prefs`): `[brunch, fine_dining (upscale_fine_dining), icebreakers, movies, nature, play]` — 6 chips
- Intents (union, sorted alphabetically): `[group-fun, romantic]` — 2 intent pills (operator's example "casual" mapped to `group-fun` per the locked A2-i set; flagged in §Discoveries)
- Session in Raleigh area (centroid from operator's production session `daadd454`)

### Deterministic rule pinned by forensics (operator approves at REVIEW)

- Position `P` is SINGLE if `P` is odd, INTENT if `P` is even.
- Single index `S(P) = (P - 1) / 2` (zero-based count of singles produced so far). Category for position `P` = `categories[S(P) % categories.length]`.
- Intent index `I(P) = (P / 2) - 1` (zero-based count of intents produced so far). Intent for position `P` = `intents[I(P) % intents.length]`.

### Sequence

| Position | Type | Pill (chip/intent) | Card source | Example place / itinerary |
|----------|------|--------------------|-------------|---------------------------|
| 1 | single | brunch | `query_servable_places_by_signal_intersection` filterMin=120 signal=brunch | Big Ed's City Market |
| 2 | curated | group-fun | `generate-curated-experiences` experienceType=group-fun batch[0] | Play + casual_food itinerary |
| 3 | single | fine_dining | signal=fine_dining filterMin=120 | Angus Barn |
| 4 | curated | romantic | `generate-curated-experiences` experienceType=romantic batch[0] | Flowers + creative_arts + upscale_fine_dining |
| 5 | single | icebreakers | signal=icebreakers filterMin=120 | Boxcar Bar + Arcade |
| 6 | curated | group-fun | batch[1] | Theatre + upscale_fine_dining |
| 7 | single | movies | signal=movies filterMin=80 | Alamo Drafthouse Raleigh |
| 8 | curated | romantic | batch[1] | Flowers + theatre + upscale_fine_dining |
| 9 | single | nature | signal=nature filterMin=120 | Pullen Park |
| 10 | curated | group-fun | batch[2] | Movies + upscale_fine_dining |
| 11 | single | play | signal=play filterMin=120 | Adventure Landing |
| 12 | curated | romantic | batch[2] | (second romantic batch begins — flowers + creative_arts + alt fine dining) |
| 13 | single | brunch (cycle restart) | signal=brunch | Bittersweet |
| 14 | curated | group-fun | batch[3] | Brunch + creative_arts |
| 15 | single | fine_dining | signal=fine_dining | Second Empire |
| 16 | curated | romantic | (intent cache for romantic depletes if batch=3; new batch fetched) | New flowers + creative_arts + upscale_fine_dining variant |
| 17 | single | icebreakers | signal=icebreakers | Trophy Tap & Table |
| 18 | curated | group-fun | (new batch needed) | New play + upscale_fine_dining variant |
| 19 | single | movies | signal=movies | Alamo Drafthouse — different showtime |
| 20 | curated | romantic | next | New combo |

### Properties demonstrated

- 1:1 alternation: odd=single, even=curated.
- Per-pill rotation: singles cycle `brunch → fine_dining → icebreakers → movies → nature → play → brunch`, intents cycle `group-fun → romantic → group-fun → romantic`.
- Exclusion respected: every single's `place_id` and every curated stop's `place_pool_id` is added to the session-wide exclude set so future positions don't reuse them.
- Batch cache exploited: positions 2/6/10/14 all draw `group-fun` cards from cached batch; new batch fetched only when current batch depletes (~every 3 positions per intent at limit=10/3stops=~3.3 cards per batch realistically).

---

## D5 — Atomic INSERT race semantics under mixed types

**Verdict: race resolves identically across clients. Determinism preserved.**

### Evidence

Two racing clients at frontier `F` both attempt to advance to `F+1`:

1. **Type agreement.** Both racers compute `type = (F+1) % 2 === 0 ? 'curated' : 'single'`. Parity is deterministic — both agree.

2. **Pill/intent agreement.** Both racers read `agg.categories` and `agg.intents` from `pg_aggregate_collab_prefs(session_id)` — sorted alphabetically by the SQL aggregator. Both racers compute the same `S(F+1)` or `I(F+1)` from the same `session_deck_cards` row count. If a third participant has joined between racer A's compute and INSERT and bumped `deck_version`, racer B may see different `agg.categories` (e.g., joiner added `theatre`). In that case:
   - Racer A INSERTed at V_n with card from old categories array.
   - Racer B reads the inserted row via SELECT-after-insert (the ON CONFLICT DO NOTHING handles it). B's compute for an alternative card is discarded.
   - The card at position F+1 is whatever racer A wrote, atomically.
   - Future positions (F+2 onward) reflect the new V_{n+1} categories — joiner's contribution is honored from F+2 onward.

3. **Candidate agreement within type.** For singles: `ORDER BY signal_score DESC, review_count DESC NULLS LAST, place_id ASC` — deterministic. For curated: the first call to `generate-curated-experiences` for a given `(session_id, experienceType)` writes a deterministic batch (sorted by combo round-robin + signal_score within each fetched single). Both racers calling the same intent at the same position get the same batch[0] candidate from a session-scoped cache.

4. **Curated cache race.** If two racers both miss the cache for intent `X` at the same time and both invoke `generate-curated-experiences`, both calls return similar (possibly identical) batches due to shared `pg_aggregate_collab_prefs` aggregation. The losing INSERT discards its batch[0] computation; the winner's batch is what's stored. Future intent positions for `X` read the winner's batch from the persisted cache table.

### Edge case: late-joiner pref-bump mid-race

| Step | Racer A | Racer B | Result |
|------|---------|---------|--------|
| t=0 | Reads agg at V_n | Reads agg at V_n | Both have same view |
| t=1 | Computes card X for position F+1 | (slow network) | A is ahead |
| t=2 | INSERTs (session, F+1, X) at version=V_n | (still slow) | A's row exists |
| t=3 | Returns X to client | Joiner bumps to V_{n+1}, B reads V_{n+1} agg | B has new view |
| t=4 | — | Computes card Y for position F+1 | B has different candidate |
| t=5 | — | INSERT (session, F+1, Y) → ON CONFLICT DO NOTHING | INSERT no-op |
| t=6 | — | SELECT (session, F+1) → returns X (not Y) | B returns X to client |

**Conclusion:** position F+1 is X for both clients. From F+2 onward, the new aggregation V_{n+1} (which includes joiner's prefs) drives the candidate selection. The positional immutability invariant `I-PROPOSED-COLLAB-POSITIONAL-SHARED-DECK` is preserved through the type-mixed regime.

---

## D6 — Scale audit at 500 participants

**Verdict: HOLDS at all 3 burst patterns with the recommended per-session per-intent cache + keep-warm hot path.**

### Burst A — 500 in 60s (worst case)

- Singles edge function calls: ~250 swipes/sec at peak (500 participants × avg 0.5 swipes/sec during onboarding burst).
- Intent positions: 50% of swipes (1:1 alternation) = ~125 intent positions/sec.
- Curated edge function calls/sec: per-session per-intent batch caches → first intent-position per intent per session triggers a batch fetch. With 500 fresh sessions × 2 intents/session avg = 1000 batch fetches in 60s = ~17 calls/sec — well within keep-warm hot-isolate capacity.
- Subsequent intent positions (after cache warm-up): 125/sec - 17/sec = ~108 cache-hit reads/sec (~50ms each, no edge fn boot).

**Bottleneck:** `query_servable_places_by_signal_intersection` RPC. With PostGIS path (ORCH-0909 §4.2), under 200ms per call at warm Postgres. 500 participants × 2 swipes/sec × 6 chip RPCs each = 6000 RPC calls/sec peak. This is the existing ORCH-0909 scale concern; the amendment does NOT amplify it.

**Verdict:** HOLDS.

### Burst B — 8/min × 1h (steady state)

Trivial — well within all infrastructure. HOLDS.

### Burst C — 500 over 1d

Trivial. HOLDS.

### New dimension: exclusion-list growth on curated path

After 100 positions in a session: ~50 curated positions × ~3 stops/curated = ~150 place_pool_ids in the curated exclude set, plus ~50 singles place_ids. Total exclude set ≈ 200 place_pool_ids. Passed to `query_servable_places_by_signal_intersection.p_exclude_place_ids` (uuid[]). SQL `NOT (pp.id = ANY(p_exclude_place_ids))` is O(N) per row — at 200 excludes × ~1000 candidate place_pool rows = 200k comparisons per RPC — sub-millisecond. HOLDS even at 500 positions deep.

### Match quorum on curated cards

The existing match-quorum logic at `board_user_swipe_states` is keyed by `(session_id, user_id, card_id)`. For curated cards stored in `session_deck_cards.curated_payload` with a synthetic id like `curated_${experienceType}_${position}`, the match logic needs a stable card identifier. The amendment specs that `session_deck_cards.id` (a new BIGSERIAL or composite) be used as the card_id for swipe states on curated rows, OR the existing `card_id` column repurposed (NULL for curated → use position-derived synthetic). Either way: documented in SPEC §11 of the amendment.

---

## D7 — Dead-end handling when one type exhausts (THE OPEN QUESTION)

### Scenario

Session has selected categories with rich `place_pool` coverage but only one intent pill (say `romantic`). After position 100, romantic's curated batch exhausts (every viable combo of flowers + creative_arts + upscale_fine_dining within the intersection has been served). What happens at position 102 (the next intent position)?

### Options

**(a) Graceful degrade to all singles** (recommended)
- Position 102 onward: every position becomes single. Strict 1:1 broken, but the deck keeps producing cards.
- Banner at top: "We're running low on romantic experiences — showing more spots instead." Auto-dismiss if prefs change widens the curated pool.
- Pros: deck never dead-ends until BOTH types exhaust. User keeps swiping. Match-reachable invariant preserved (everyone sees the same single cards from 102 onward).
- Cons: alternation rhythm broken silently. Sophisticated users may notice. Operator's "strict 1:1" intent is bent.

**(b) Dead-end at position 102** ("no more curated experiences right now" smart empty state)
- Position 102 returns `dead_end: true, reason: 'intent_pool_exhausted'`.
- Client renders smart empty: "We've shown every romantic experience we have. Add another vibe pill or wait for new places."
- Pros: faithful to strict 1:1.
- Cons: deck dies even though singles still have hundreds of unswiped cards. User frustration. Particularly bad in casual session with 1 intent pill + 6 categories.

**(c) Recycle the intent** — show the first curated card again at 102
- Forbidden by `I-PROPOSED-COLLAB-POSITIONAL-SHARED-DECK` (position cannot duplicate prior card).
- Operationally awkward — the user has already swiped that card.

**(d) Re-generate curated with different parameters**
- E.g., relax the price tier filter, or extend the intersection radius slightly.
- Pros: more curated variety.
- Cons: violates the locked geographic intersection contract (ORCH-0909 §4.2). Out of scope for ORCH-0906; would need its own ORCH.

### Operator decision — LOCKED 2026-05-21

**Option (a) Graceful degrade.** Reasoning:
1. Strict 1:1 is a UX preference, not a correctness invariant. The deck-must-not-dead-end-prematurely property is structurally more important.
2. The banner is honest and self-explanatory; users understand "running low".
3. Symmetric handling if singles exhaust first (every position becomes intent) — graceful in both directions.
4. Full dead-end fires only when BOTH types exhaust, matching the natural "all the places are gone" semantics.

Codified in `SPEC_ORCH-0909_AMENDMENT_ORCH-0906_SINGLE_INTENT_INTERLEAVE.md` §7.2 with the `degraded_from` column on `session_deck_cards` recording which pill exhausted on each degraded row.

---

## D8 — Keep-warm strategy

**Verdict: existing keep-warm coverage is sufficient. No extension needed.**

### Evidence

`supabase/functions/keep-warm/index.ts:11–15`:

```ts
const FUNCTIONS_TO_WARM = [
  'discover-cards',
  'generate-curated-experiences',
  'get-person-hero-cards',
];
```

Both `discover-cards` (the ORCH-0909 successor that the amendment modifies) AND `generate-curated-experiences` (the function the amendment invokes internally) are already kept warm.

The amendment does NOT introduce new edge functions or new external dependencies. Existing keep-warm cron schedule (operator-owned) suffices.

**No-op recommendation:** no changes to keep-warm.

---

## D9 — Decommissions

### D9.1 — `app-mobile/src/services/deckService.ts:776` comment

The smoking-gun comment:

> `Single HTTP call, no curated parallel path (collab v2 does not interleave curated experiences with category venues; that pattern is solo-only).`

This must be DELETED in the implementation of the SPEC AMENDMENT. The collab path now DOES interleave curated experiences via server-side merge inside `handleDeterministicV2`. Leaving the comment would create future investigator confusion.

**Action for SPEC AMENDMENT §11:** add an explicit delete step + a strict-grep CI gate forbidding the exact substring "no curated parallel path" anywhere in `app-mobile/`.

### D9.2 — Strengthen `feedback_solo_collab_parity.md` to bidirectional

Current memory (per prior ORCH-0906 investigation) codifies: bugs in collab must be checked in solo. ORCH-0906 was the inverse — solo had a feature, collab did not, and the parity check did not catch it.

**Proposed new clause** (to be added at CLOSE Extension Step 5c by orchestrator):

> **Bidirectional parity rule (added 2026-05-21 after ORCH-0906 close).**
>
> Solo/collab parity is BIDIRECTIONAL. When investigating any deck-pipeline divergence:
>
> 1. If solo has feature F and collab lacks F → P1 finding, register an ORCH.
> 2. If collab has feature F and solo lacks F → P1 finding, register an ORCH.
> 3. Every deck-pipeline ORCH SPEC must declare an explicit "Parity statement" section listing what the change does in solo, what it does in collab, and whether they match. Mismatches require operator-recorded justification.
> 4. Pre-merge CI gate (proposed META-ORCH): strict-grep over `app-mobile/src/services/deckService.ts` solo branch vs collab branch ensures no exported function has a comment like "solo-only" or "collab-only" without a matching `DECISION_LOG.md` reference.

### D9.3 — Solo/collab parity CI gate spec

Add to `.github/workflows/strict-grep-mingla-business.yml` (per the strict-grep registry pattern memory). A new script `app-mobile/scripts/ci/orch-0906-bidirectional-parity-check.mjs` that:

1. Greps `deckService.ts` for the literal strings `solo-only`, `collab-only`, `solo only`, `collab only`.
2. For every match, verify there is a corresponding entry in `Mingla_Artifacts/DECISION_LOG.md` cited by file:line in a comment within 5 lines of the match.
3. Fails the build if any unjustified asymmetry comment exists.

Optional (P3, deferred): a separate AST-walk gate ensuring `fetchDeck` (solo) and `fetchCollabDeckV2` (collab) call comparable sets of edge functions. Complexity-heavy; flagged but not specced.

### D9.4 — Update existing memory `feedback_collab_deck_determinism_contract.md`

Add a note at the end:

> **2026-05-21 addendum (ORCH-0906 amendment to ORCH-0909):** The deck is now composed of two card types — single (from `place_pool` via signal RPCs) and curated (from `generate-curated-experiences` per intent). Strict 1:1 alternation by position parity. Determinism contract preserved: card at position N is a deterministic function of (session state at V, position N, deterministic type rule, deterministic per-type rotation). See `SPEC_ORCH-0909_AMENDMENT_ORCH-0906_SINGLE_INTENT_INTERLEAVE.md`.

---

## Findings summary

| # | Classification | Evidence |
|---|----------------|----------|
| R1 (carried from prior) | 🔴 Root cause | Collab path has no curated fan-out. ORCH-0909 successor inherits this gap. The amendment fixes it. |
| R2 (new) | 🟠 Contributing | `session_deck_cards.card_id NOT NULL REFERENCES place_pool` blocks curated card storage. Schema must change. |
| R3 (carried from prior) | 🟡 Hidden flaw | Bidirectional parity rule missing. Codified in D9.2. |
| O1 | 🔵 Observation | `generate-curated-experiences` already collab-capable + keep-warmed. Implementation surface is small. |
| O2 | 🔵 Observation | The atomic INSERT race semantics generalize cleanly to mixed types because parity-driven type selection + sorted-array rotation are both deterministic. |

---

## Discoveries for orchestrator

1. **D-0906-A1 — operator's example "casual" intent ambiguity.** The dispatch's worked example uses `intents=[romantic, casual]`. The 6 locked SESSION_INTENT_IDS are `[adventurous, first-date, romantic, group-fun, picnic-dates, take-a-stroll]` — "casual" is NOT one of them. Forensics assumed `casual → group-fun` for D4. Operator should confirm OR clarify at REVIEW. (P3.)

2. **D-0906-A2 — match-quorum schema implication.** Curated cards have synthetic `id` strings (not UUIDs). `board_user_swipe_states.card_id` is a text column today. The amendment specs that curated swipe writes use the synthetic id; match-quorum check compares strings. Verify no other code casts `card_id` to uuid before comparison. (P2.)

3. **D-0906-A3 — `generate-curated-experiences` needs an `excludePlacePoolIds` parameter.** Today the function only respects within-batch exclusion via `globalUsedPlaceIds`. Cross-batch (session-wide) exclusion across the multiple internal calls for the same intent requires a new request parameter. Specced in the SPEC AMENDMENT §5 invocation contract. (P2.)

4. **D-0906-A4 — `session_curated_cache` table (proposed).** To survive Deno isolate restarts between swipes within the same session, the cached batch should live in a small DB table, not just in-memory. Specced in amendment §3. Alternative (in-memory only) is simpler but loses batches on isolate cycle. Operator confirms at REVIEW. (P2 — design choice.)

5. **D-0906-A5 — D1 sim repro deferred to TEST phase.** Tester must complete the live-fire baseline + delta capture per Prime Directive 7. The amendment ships with this as an explicit handoff to TEST. (P1 — procedural.)

---

## END OF INVESTIGATION REPORT — ORCH-0906 (single↔intent interleave feasibility)

Working tree: `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`. No code touched. No DB writes. No commits. SPEC AMENDMENT companion at `Mingla_Artifacts/specs/SPEC_ORCH-0909_AMENDMENT_ORCH-0906_SINGLE_INTENT_INTERLEAVE.md`.
