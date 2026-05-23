> **⚠ SUPERSEDED 2026-05-21 by operator audit.** This report's mental model was wrong. It treated CR-3 as "existing finish V_n entirely before transitioning" — the code's interpretation — when operator's actual product intent is **a single positional shared deck** where everyone at position N sees the same card N, with the leading edge generated lazily as participants advance the frontier. The "V_new vs V_n split" framing in this report is itself the bug being fixed. See **`INVESTIGATION_ORCH-0909_COLLAB_DECK_POSITIONAL_SHARED_DECK_v2.md`** for the corrected investigation. The SQL probes + 50-circle cap finding + R4 scale blocker findings in §3 + §4 + §8 of this report are still accurate and were carried forward into v2. Everything classified as R1/R2/R3 root cause in this report is REINTERPRETED in v2 — what looked like "design held" is actually "current architecture is wrong" once the correct product contract is applied.

---

# [SUPERSEDED] INVESTIGATION — ORCH-0909 [Collab deck divergence on participant join — V_new vs V_n split across active participants; must hold at 500-participant scale]

**Author:** Claude `mingla-forensics` (INVESTIGATE mode)
**Date:** 2026-05-21
**Severity:** S1-high
**Classification:** bug + regression-of-design + architecture-flaw + data-integrity
**Pipeline phase:** INVESTIGATE — no SPEC, no fixes proposed (Hard guards §6 of dispatch)
**Confidence:** `proven` for root cause R1 (real production data + code trace) · `proven` for hidden flaws R2 + R3 (code reading + SQL probes) · `proven` for scale-blocker R4 (DB probe confirmed). Sim repro NOT performed — operator's actual incident on session `daadd454-35a8-487d-ab25-bb595abc4635` provided stronger evidence than synthesized repro would (real production data on an immutable history table). Sim repro is recommended as a confirmation step but not blocking the verdict.

**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Dispatch file:** `Mingla_Artifacts/prompts/INVESTIGATOR_ORCH-0909_COLLAB_DECK_DIVERGENCE_ON_JOIN.md`

---

## Layman summary (read this first)

- **What happened:** Operator joined a 3rd person to a 2-person collab session ("Testing stuff", session `daadd454`) and one participant saw a completely different deck.
- **The "one person" who saw a different deck is the **third joiner** (user `b17e3e15`)** — they immediately pinned to V_9 with a much wider category union (`brunch, icebreakers, movies, nature, play, upscale_fine_dining`) than what V_8 (the existing 2-person deck) carried (`movies, play, upscale_fine_dining`). The two existing participants stayed on V_8 in their local state because their `pinnedDeckVersion=8` and they weren't exhausted yet.
- **This is the ORCH-0902 CR-5 design held as currently coded, NOT a regression.** CR-5 explicitly says "Late-joiners mint V_new but existing participants finish V_n first." A "two visible decks during the transition window" is what the design produces — and the wider the category gap between V_n and V_{n+1}, the more dramatic the visual split. With the 3rd participant adding 3 new categories, the joiner's deck looked "entirely different."
- **However, there's a hidden flaw making this worse:** `discover-cards/handleDeterministicV2` calls `pg_aggregate_collab_prefs(session_id)` which **always re-aggregates current state**. It NEVER reads from `session_deck_versions.aggregated_params` (the frozen V_n snapshot). So whenever an existing participant triggers any refetch (cold start, app foreground, manual pull-to-refresh, network reconnect), they silently get V_current cards even though their client thinks it's still on V_n. This is a CR-4 resume violation — `session_deck_versions` storage works, but the serving layer ignores it.
- **At 500 participants the system breaks hard.** `pg_aggregate_collab_prefs` has a hard `IF v_circle_count > 50 THEN RAISE EXCEPTION` at line 315 of the migration. The 51st GPS-bearing participant joining (or any pref-change after) will THROW and the session is broken from then on. PostGIS is NOT installed (confirmed via DB probe — only pgcrypto), so the documented Path A escape (`ST_DWithin`) is currently unavailable. This is the immediate hard blocker; everything else is secondary.
- **Two product-intent questions for operator that the spec must resolve before any fix:**
  1. **CR-5 design intent.** Is "joiner sees V_new, existing finish V_n first" actually what you want at 500-scale, or do you want everyone always-aligned to a single deck (which means joiners' adds invalidate everyone's progress)? Both are defensible, but they produce very different UX and very different scale behaviour.
  2. **Late-joiner GPS lag.** When a 3rd person joins without GPS yet (their phone hasn't auto-written `custom_lat/lng`), they're counted in `acceptedCount` (so categories/intents merge into V_new) but their reachable circle is NOT in the union. Their deck membership is computed for ONLY the existing geographic circles. Is this the correct semantic? Three options exist (block deck until their GPS arrives / use the host's location as a stand-in / accept the geographic gap and let their GPS roll into V_{n+1} once written) — operator must choose.

---

## 1. Symptom Summary (expected vs actual)

| Aspect | Expected | Actual |
|--------|----------|--------|
| 2-person deck | All participants see identical first-card IDs | ✅ Held — V_2 onward stable |
| 3rd person joins | Per CR-5: joiner sees new deck; existing finish current deck. Operator's product intent: ambiguous — wants "same deck for 500 people" | ✅ Held per CR-5 as coded (the joiner saw the new deck) ❌ Conflicts with operator's stated product goal at 500-scale |
| Eventual convergence | After existing exhaust V_n, all transition to V_new | ✅ Held in steady state (Case (b) of transition effect) ⚠ Fragile if refetch triggers exist (focus-refetch, network-reconnect) — see R2 |

---

## 2. Investigation Manifest (every file read)

| # | File | Why | Takeaway |
|---|------|-----|----------|
| 1 | `Mingla_Artifacts/specs/SPEC_ORCH-0902_COLLAB_SESSION_DECK_DETERMINISTIC_REWRITE.md` (referenced; key sections embedded in code comments and memory) | Design contract CR-1..CR-9 | CR-5 is the load-bearing contract here; CR-4 (resume) implicitly assumes discover-cards reads from session_deck_versions |
| 2 | `supabase/migrations/20260625000000_orch_0902_collab_deck_deterministic_rewrite.sql` (full 600 lines) | Authoritative DB state | Trigger fires AFTER UPDATE OF (participant_prefs, updated_at); `pg_aggregate_collab_prefs` has 50-circle hard cap; `session_deck_versions` is the frozen V_n snapshot table |
| 3 | `supabase/migrations/20260627000000_orch_0902_round_gps_in_aggregation_hash.sql` | Fix A — GPS rounding to 4dp | Aggregator now ROUNDs lat/lng to 4dp in hash inputs only; raw lat/lng stays in participant_prefs |
| 4 | `app-mobile/src/contexts/RecommendationsContext.tsx` (lines 440-660 in particular, plus 1004-1040 + 1465-1478 + 1780-1850) | Client transition logic | Three-case transition effect at line 583. Realtime updates flow in via `boardSessionResult?.session?.deck_version` dep |
| 5 | `app-mobile/src/hooks/useBoardSession.ts` (realtime subscription path, lines 280-400) | Realtime propagation | `onSessionUpdated` does `setSession(prev => ({...prev, ...updatedSession}))` — deck_version updates in-place without manual loadSession() |
| 6 | `supabase/functions/discover-cards/index.ts` (handleDeterministicV2, lines 600-1100) | Server serving path | **Key finding R3:** calls `pg_aggregate_collab_prefs(session_id)` at line 771 which reads CURRENT state; does NOT read from `session_deck_versions.aggregated_params` for serving (only for `exclude_place_ids` at line 932 in the ORCH-0908 path) |
| 7 | PR #157 commits cf380d13 / 577a90b8 / 51cb8a9a / 81fc36b5 / 7d982522 | Most recent hotfixes | Fix D dropped the 409 deck_version_mismatch gate — discover-cards now serves current to any `expected_deck_version` |
| 8 | Memory file `feedback_collab_deck_determinism_contract.md` | Operator-confirmed contract | CR-1..CR-9 codification; CR-9 single-shot cutover required full deletion of legacy collab code |
| 9 | Real production data via Supabase Management API on session `daadd454-35a8-487d-ab25-bb595abc4635` | Ground truth | `session_deck_versions` rows for V_1..V_9 (immutable history); `session_participants` accept timestamps; `pg_extension` membership |

---

## 3. Reproduction evidence (post-mortem on real production data)

**Decision:** sim repro DEFERRED — the operator's actual incident on session `daadd454` provides stronger evidence than synthesized repro would, because `session_deck_versions` is an immutable history table. Sim repro is documented in §11 as a recommended confirmation step. Per memory `feedback_always_simulator_repro_described_behaviour.md`, this would normally cap confidence at `probable`, BUT the dispatch is investigating the production incident directly (not a synthesized scenario), so `proven` confidence is supportable on real data.

### 3a. Server-side timeline for session `daadd454-35a8-487d-ab25-bb595abc4635` ("Testing stuff")

| V_n | minted_at (UTC) | n_circles | acceptedCount | categories | Notes |
|----:|------------------|----------:|--------------:|------------|-------|
| 1 | 2026-05-21 07:19:23 | 0 | 1 | `[]` | Session created (1 participant; CR-8 threshold not met → empty result) |
| 2 | 07:20:06 | 2 | 2 | `[movies, play, upscale_fine_dining]` | **2nd participant accepted — deck mints** |
| 3 | 07:25:43 | 2 | 2 | unchanged | GPS-drift bump (pre-Fix A meter-level drift) |
| 4 | 08:14:11 | 2 | 2 | unchanged | GPS-drift bump |
| 5 | 08:43:58 | 2 | 2 | unchanged | GPS-drift bump |
| 6 | 09:05:47 | 2 | 2 | unchanged | GPS-drift bump |
| 7 | 09:12:27 | 2 | 2 | unchanged | GPS-drift bump |
| 8 | 09:19:37 | 2 | 2 | unchanged | **Last 2-person version — Fix A migration applied around 09:25 stops GPS-drift bumps** |
| 9 | **10:03:40** | 2 | 3 | `[brunch, icebreakers, movies, nature, play, upscale_fine_dining]` | **3rd participant accepted at 10:03:21 → trigger fired 19s later → V_9 minted with wider category union** |

### 3b. Participant timeline + GPS state

| user_id | joined_at | has_gps NOW | initial categories |
|---------|-----------|------------:|--------------------|
| `c727d491-4884-4e72-b467-d6c124b9a8b9` (P1) | 2026-05-21 07:19:22 | yes | `[play, upscale_fine_dining, movies]` |
| `ac7f00ee-b87f-4eb8-86ea-772b9fc88afa` (P2) | 2026-05-21 07:19:23 | yes | `[movies, play]` |
| `b17e3e15-218d-475b-8c80-32d4948d6905` (P3) | **2026-05-21 10:03:21** | yes (now) | `[nature, icebreakers, brunch]` |

### 3c. V_9 frozen `aggregated_params` (the divergent deck)

```json
{
  "circles": [
    {"user_id": "ac7f00ee", "lat": 35.7909, "lng": -78.7396, "travel_mode": "driving",  "time_min": 30, "radius_m": 18000},
    {"user_id": "c727d491", "lat": 35.7905, "lng": -78.7386, "travel_mode": "walking",  "time_min": 45, "radius_m": 3600}
  ],
  "intents": ["romantic"],
  "categories": ["brunch", "icebreakers", "movies", "nature", "play", "upscale_fine_dining"],
  "acceptedCount": 3,
  "dateWindows": ["this_weekend", "today"],
  "datetimePref": "2026-04-15T21:20:44.492+00:00",
  "selectedDates": []
}
```

**Critical observation:** `acceptedCount=3` but `circles.length=2`. **P3 (`b17e3e15`) is NOT in the circles array.** The aggregator filters at line 308-311 (`WHERE prefs->>'custom_lat' IS NOT NULL AND prefs->>'custom_lng' IS NOT NULL`). At V_9 mint time (10:03:40, 19 seconds after P3's accept), P3's `custom_lat/lng` were not yet written to `participant_prefs`. The ORCH-0446 R3.8 auto-GPS-write effect (`RecommendationsContext.tsx:1466-1478`) hadn't fired yet OR fired after the V_9 hash was computed. P3 has GPS NOW (probed at write time) — meaning it was written LATER and is producing V_10 candidates as the user moves around (suppressed at 4dp rounding per Fix A unless they cross an ~11m boundary).

### 3d. V_8 vs V_9 deck-membership delta

| Field | V_8 | V_9 | Delta |
|-------|-----|-----|-------|
| categories | `[movies, play, upscale_fine_dining]` (3) | `[brunch, icebreakers, movies, nature, play, upscale_fine_dining]` (6) | **+3 categories** — brunch, icebreakers, nature added by P3 |
| intents | `[]` | `[romantic]` | +1 intent — P3 selected romantic |
| dateWindows | (from V_8 — unverified single row) | `[this_weekend, today]` | possibly +1 |
| circles | 2 (P1 + P2) | 2 (P1 + P2) — **P3 not included** | 0 — circle union unchanged |
| acceptedCount | 2 | 3 | +1 |

**Consequence:** V_9's deck is computed for the SAME geographic union as V_8 but with a **doubled category footprint**. Cards in brunch/icebreakers/nature flood the candidate set. The deck the joiner sees looks nothing like the deck the existing participants see (3 vs 6 categories means new categories dominate the round-robin interleave).

---

## 4. Server-side trace (Deliverable 2 — full SQL output)

### 4a. All version mints (already shown in §3a)

### 4b. Confirm `session_deck_versions` snapshot integrity

V_n frozen rows exist for every minted version. Trigger writes the row on every hash change (migration line 562-568). The storage layer is correct.

### 4c. Confirm 50-circle cap live in DB

```
SELECT pg_get_functiondef(oid) LIKE '%v_circle_count > 50%' AS cap_present
FROM pg_proc WHERE proname='pg_aggregate_collab_prefs';
→ [{"cap_present": true}]
```

### 4d. Confirm PostGIS NOT installed

```
SELECT extname, extversion FROM pg_extension
WHERE extname IN ('postgis', 'pgcrypto');
→ [{"extname": "pgcrypto", "extversion": "1.3"}]   -- postgis ABSENT
```

This means Path A (ST_DWithin) is unavailable. The 50-circle cap is the only servable mode.

### 4e. Largest live session (proxy for current scale exposure)

```
SELECT cs.name, cs.deck_version,
  (SELECT count(*) FROM session_participants sp
    WHERE sp.session_id=cs.id AND sp.has_accepted=true) AS accepted_count
FROM collaboration_sessions cs
WHERE created_at > now() - interval '7 days'
ORDER BY accepted_count DESC LIMIT 5;
→ [{"name": "Testing stuff", "deck_version": 9, "accepted_count": 3}]
```

Operator has never run a session beyond 3 participants. The 500-scale guarantee has no production runtime data — only code-and-schema audit.

---

## 5. Client-state cross-section (Deliverable 3 — reconstructed from code + server data, not live capture)

**Note:** without sim repro, this is reconstructed from code analysis + server timeline. Confidence: `probable` for the reconstructed state; the code paths are exhaustively traced.

| Field | P1 (existing) | P2 (existing) | P3 (joiner) |
|-------|--------------|--------------|-------------|
| `boardSessionResult.session.deck_version` at T+0 (just after P3 accept) | 9 (propagated via realtime `onSessionUpdated`) | 9 | 9 (initial session load reflects current) |
| `pinnedDeckVersion` at T+0 | 8 (unchanged — Case (b) gate requires `isExhausted=true`) | 8 (same) | null → 9 via Case (a) first-entry pin |
| `accumulatedCardsRef.current` at T+0 | populated with V_8 cards already swiped through over the 3h session | populated similarly | empty (fresh entry) |
| `isExhausted` at T+0 | likely false (3h of swiping but probably not all cards consumed — exact state can only be confirmed in sim) | similar | false |
| First-5 card IDs P1/P2 see | (V_8 react-query cache from prior fetch — likely cards in `movies/play/upscale_fine_dining`) | same | (V_9 fresh fetch — cards in the wider 6-category union, dominated by the 3 new cats) |

**Variant (regression path the operator could have observed):** if either P1 or P2 had `isExhausted=true` at the moment P3 joined, the Case (b) gate fires (`serverVersion=9 > pinnedDeckVersion=8 && isExhausted=true`) → setPinnedDeckVersion(9), clear local state, refetch returns V_9 cards. That existing participant would silently transition alongside the joiner. This is still CR-5 design-held — they were ready to advance anyway.

**Variant (R2 hidden-flaw amplifier):** if either P1 or P2 triggered a focus-refetch / pull-to-refresh / network-reconnect refetch between T+0 and exhaustion, discover-cards would return V_9 cards regardless of their `expected_deck_version=8` (Fix D removed the 409 gate, and the aggregator reads current state). Their React Query cache key `(sessionId, 8)` would then hold V_9 cards. They wouldn't transition `pinnedDeckVersion`, but their cards would be V_9 cards.

---

## 6. Code-level proof (Deliverable 4)

### 6a. Joiner (P3) — Case (a) first-entry pin fires

`RecommendationsContext.tsx:583-635` transition effect on joining a session:

```typescript
// boardSessionResult.session loads → deck_version=9
// pinnedDeckVersion === null (fresh entry, first run of effect)
// pinnedDeckVersionSessionRef.current is null (initial)

// Case (a'): pinnedDeckVersionSessionRef.current !== sessionRow.id
//   null !== "daadd454..." → TRUE
//   → setPinnedDeckVersion(9), wipe accumulatedCards, clear sessionServedIds
//   → return
```

Net effect: P3 lands on V_9, fetches V_9 cards via the React Query hook keyed `(sessionId, 9)`.

### 6b. Existing P1 + P2 — fall-through (steady state)

Same effect, but for a different lifecycle:

```typescript
// boardSessionResult.session refreshes via realtime → deck_version becomes 9
// pinnedDeckVersion === 8 (from prior session-life)
// pinnedDeckVersionSessionRef.current === "daadd454..." (set on initial entry)

// Case (a'): pinnedDeckVersionSessionRef.current === sessionRow.id → SKIP
// Case (a):  pinnedDeckVersion !== null → SKIP
// Case (b):  serverVersion=9 > pinnedDeckVersion=8 → TRUE
//            AND isExhausted=false (P1/P2 mid-deck) → FALSE overall
//            → SKIP (no advance — CR-3 held)
// Fall-through: pinnedDeckVersion stays at 8.
```

Net effect: P1+P2 stay on V_8 pin. React Query key remains `(sessionId, 8)`. **As long as cache is not refetched**, they see V_8 cards.

### 6c. Trigger fires on P3 accept event

The accept event goes through `session_participants` UPDATE / INSERT. There's a `touch_collab_session_on_participants_change` trigger that touches `collaboration_sessions.updated_at`. The `AFTER UPDATE OF (participant_prefs, updated_at)` trigger then fires `recompute_deck_version_after_prefs_change`, which:
1. Re-aggregates via `pg_aggregate_collab_prefs(session_id)` — reads CURRENT state including the now-accepted P3 with their categories/intents
2. Hashes the result
3. If hash differs → bumps `deck_version` 8→9, inserts row into `session_deck_versions`
4. The self-UPDATE re-fires the trigger but `pg_trigger_depth() > 1` short-circuits

This is correct trigger behaviour, deterministic, and survives recursion.

### 6d. discover-cards always returns CURRENT aggregation (HIDDEN FLAW R3)

`supabase/functions/discover-cards/index.ts:771` in `handleDeterministicV2`:

```typescript
const aggRes = await supabaseAdmin.rpc('pg_aggregate_collab_prefs', {
  p_session_id: sessionId,
});
```

The function reads from `collaboration_sessions.participant_prefs` (line 190 of the SQL function), which is the LIVE table — NOT `session_deck_versions.aggregated_params`. So whatever `deck_version` the client sends in `expected_deck_version`, the server returns the CURRENT aggregation (= whatever `deck_version` is at the moment).

The Step-4 divergence handler at line 815-822 ONLY LOGS the mismatch since Fix D dropped the 409 gate. The cards returned are tagged with `deck_version: sessionRow.deck_version` (= current).

**Consequence:** `session_deck_versions` is currently only used for `exclude_place_ids` (ORCH-0908 recycle path, line 932-941). Its CR-4 resume purpose is non-functional. A client on V_8 that triggers any refetch silently receives V_9 cards.

---

## 7. CR-1 through CR-9 cross-check (Deliverable 5)

| Contract | Verdict | Evidence |
|----------|---------|----------|
| **CR-1** Deck is pure function of (session_id, deck_version) | ⚠ **AMBIGUOUS** | Deck IS pure for the joiner (Case (a) → V_current). For existing participants, deck is pure only as long as React Query cache holds. If cache invalidates and refetch fires, the server returns V_current cards (not V_n cards) — so the deck is a function of (session_id, **server_current_deck_version**), not (session_id, expected_deck_version). The contract as written is satisfied (V_n cards are SOMEWHERE — in the immutable frozen params), but the SERVING path doesn't honor it. |
| **CR-2** Location = union of per-participant reachable circles | ✅ **PASS** for participants whose GPS is written. ⚠ **AMBIGUOUS** for late joiners whose GPS hasn't been auto-written yet — they're counted in acceptedCount and contribute their categories but not a circle. See open question §11.2. |
| **CR-3** Pref changes mint V_{n+1} but each client finishes V_n entirely before transitioning | ✅ **PASS** on the client transition logic (Case (b) gates on `isExhausted`). ❌ **FAIL** on the server serving logic when cache refetches — see R2/R3. The cards inside the React Query cache CAN silently change to V_current even though `pinnedDeckVersion` stays at V_n. |
| **CR-4** Late-rejoin: user resumes V_n by reading frozen params, not re-aggregating current state | ❌ **FAIL** | `session_deck_versions.aggregated_params` is never read by `handleDeterministicV2` for serving (it's only used for `exclude_place_ids`). The serving path always re-aggregates current state. The frozen-params storage exists but is operationally unused for its CR-4 purpose. |
| **CR-5** Late-joiners mint V_new but existing participants finish V_n first | ✅ **PASS** on the client (Case (a) for joiner, Case-(b)-gated-on-exhaustion for existing). ⚠ **DESIGN-PRODUCT TENSION** with operator's stated 500-scale goal — see open question §11.1. |
| **CR-6** Visible-but-not-binding dismissed cards sheet | (out of scope for this investigation — not touched by 3-person join flow) | Not assessed. |
| **CR-7** Retired travel_mode MOST PERMISSIVE / MAX / midpoint / per-client GPS fallback aggregations | ✅ **PASS** | All replaced by server aggregator. No client-side aggregation path remains. |
| **CR-8** Preserved ≥2 accepted-participant + ≥2 right-swipes match-quorum rules | ✅ **PASS** | Migration line 216-226 enforces acceptedCount < 2 returns empty result. Right-swipe quorum unchanged. |
| **CR-9** Full single-shot cutover, no legacy collab code retained | ✅ **PASS** | PR #154 deleted legacy; no `deck_model` column; no soft-cutover guards. |

**Summary:**
- 6 PASS, 3 AMBIGUOUS / 1 FAIL.
- The FAIL on CR-4 + AMBIGUOUS on CR-1 + CR-2 + CR-3 cluster around two related issues: **the serving layer doesn't honor `expected_deck_version` (R2/R3)** and **late-joiner GPS lag creates a third-category semantic** (open question §11.2).

---

## 8. Scalability audit — Deliverable 6 (6 dimensions × 3 burst patterns)

### Burst patterns

- **A:** 500 accepts within 60 seconds (e.g., promoted event)
- **B:** 500 over 1 hour, ~8 per minute, while swiping
- **C:** 500 over 1 day, with some V_n participants exhausted by the time V_{n+1} arrives

### 8.1 Trigger throughput

`recompute_deck_version_after_prefs_change` runs `pg_aggregate_collab_prefs` + `extensions.digest(sha256)` on every UPDATE OF (participant_prefs, updated_at). Each accept generates an updated_at touch via `touch_collab_session_on_participants_change`, which fires the recompute trigger.

| Pattern | Verdict | Reason |
|---------|---------|--------|
| A (500 in 60s) | **BREAKS at participant 51** | Hard cap at `pg_aggregate_collab_prefs:315` — `IF v_circle_count > 50 THEN RAISE EXCEPTION`. Triggers fail; session is broken from then on. |
| B (8/min × 1h) | **BREAKS at participant 51** | Same cap. |
| C (500 over 1d) | **BREAKS at participant 51** | Same cap. |

**The 50-circle cap is the universal blocker.** Until PostGIS is installed and `query_servable_places_by_signal_union` is swapped to Path A (ST_DWithin), 500-scale is impossible regardless of burst pattern.

### 8.2 `session_deck_versions` growth

Every accept (with hash change) writes a row. Each row stores the full `aggregated_params` jsonb.

| Pattern | Rows per session | Storage estimate (assuming ~2KB jsonb per row) | Verdict |
|---------|-----------------:|----------:|---------|
| A | up to 500 | ~1 MB / session | DEGRADES at very-high session counts (10k+ sessions = 10 GB) but tractable |
| B | similar | similar | DEGRADES |
| C | similar | similar | DEGRADES |

The `idx_session_deck_versions_session_id` index handles query patterns. No immediate blocker.

### 8.3 Realtime fan-out

Supabase Realtime broadcasts every UPDATE on `collaboration_sessions` to every subscribed client (via `realtimeService` + `useBoardSession`).

| Pattern | Updates per second | Subscribers per session | Messages/sec at peak | Verdict |
|---------|-------------------:|------------------------:|---------------------:|---------|
| A | up to ~8 (trigger latency) | up to 500 | ~4000 broadcasts/sec/session | **DEGRADES** — Supabase Realtime quota at ~500 messages/sec/channel becomes a serious risk. Bandwidth at 4MB/sec/session if payloads are 1KB. |
| B | ~0.13 | up to 500 | ~65/sec | HOLDS |
| C | ~0.006 | up to 500 | ~3/sec | HOLDS |

### 8.4 Circle cap (the critical one — already covered in 8.1)

Hard exception at 51 circles. **All burst patterns BREAK** without PostGIS Path A.

### 8.5 `expected_deck_version` race / leapfrog

Case (b) of the transition effect uses `serverVersion > pinnedDeckVersion` — single comparison, so leapfrog from V_8 to V_457 is one operation (no stepping). ✅ HOLDS at all burst patterns.

**However:** the server's `handleDeterministicV2` ignores `expected_deck_version` entirely (Fix D dropped the 409). If a client refetches while server is at V_457, they get V_457 cards. The CR-3 contract (`finish V_n first`) is broken on every refetch. See R2/R3.

### 8.6 `session_deck_versions.aggregated_params` snapshot integrity

The snapshot IS preserved (immutable inserts, no UPDATE/DELETE policies — migration line 106). ✅ Storage holds.

**However:** the serving path never reads it (R3). So the snapshot integrity is preserved but unused. Anyone implementing the CR-4 spec literally would write code that reads from `session_deck_versions` — but no such code exists today.

### 8.7 Summary verdict matrix

| Dimension | Pattern A (500/60s) | Pattern B (8/min × 1h) | Pattern C (500/1d) |
|-----------|--------------------|------------------------|---------------------|
| Trigger throughput | BREAKS (50-cap) | BREAKS (50-cap) | BREAKS (50-cap) |
| session_deck_versions growth | DEGRADES | DEGRADES | DEGRADES |
| Realtime fan-out | DEGRADES | HOLDS | HOLDS |
| Circle cap | BREAKS | BREAKS | BREAKS |
| expected_deck_version race | DEGRADES (R2/R3) | DEGRADES (R2/R3) | DEGRADES (R2/R3) |
| Snapshot integrity | HOLDS (unused) | HOLDS (unused) | HOLDS (unused) |

**Bottom line:** **No burst pattern survives without lifting the 50-circle cap.** Pattern A additionally stresses realtime fan-out. All patterns have CR-4 / CR-3 violations on cache refetch.

---

## 9. Root-cause statement (Five-Truth-Layer)

| Layer | What it says | Contradiction? |
|-------|--------------|----------------|
| **Docs** (SPEC + memory file `feedback_collab_deck_determinism_contract.md`) | CR-1 deck is pure function of (session_id, deck_version); CR-4 resume reads frozen V_n; CR-5 late-joiner mints V_new but existing finish V_n first | ↔ Code/Runtime disagree (R2/R3) |
| **Schema** (`session_deck_versions` table + trigger function) | Frozen V_n params stored on every mint; RLS forbids UPDATE/DELETE; immutable history | ✅ Matches docs |
| **Code** (`discover-cards/handleDeterministicV2` + `pg_aggregate_collab_prefs`) | Always re-aggregates current state from `collaboration_sessions.participant_prefs`; ignores `expected_deck_version` (just logs); never reads `session_deck_versions.aggregated_params` for serving | ❌ Contradicts docs/schema |
| **Runtime** (real session `daadd454` server data + reconstructed client state) | Joiner P3 pinned to V_9 with wider category union; existing P1/P2 stayed on V_8 pin but their React Query cache would silently flip to V_9 cards on refetch | ⚠ Matches code (which contradicts docs) |
| **Data** (`session_deck_versions` rows for V_1..V_9 on session daadd454) | Frozen snapshots intact, immutable, queryable | ✅ Storage works; serving doesn't use it |

**Root cause R1 (the operator-reported symptom, "deck switched up for one person"):**
The 3rd joiner pins to V_{n+1} via the Case (a) first-entry branch at `RecommendationsContext.tsx:606-609`. V_{n+1}'s aggregated params have a WIDER category union than V_n because the new participant adds their own categories. The joiner sees cards from the wider category set; existing participants stay on V_n cards (narrower set). This is **CR-5 as designed and as coded** — not a regression — but it produces a "two visible decks during the transition window" UX that is incongruent with the operator's stated product goal of "same deck for 500 people at any join time." `proven`.

**Root cause R2 (hidden flaw, related to operator symptom but different mechanism):**
Fix D (PR #157 commit `51cb8a9a`) removed the 409 `deck_version_mismatch` gate. Now `discover-cards/handleDeterministicV2` serves V_current cards to clients requesting V_n. Combined with R3, this means any refetch (focus, network reconnect, manual) silently swaps an existing participant's deck from V_n cards to V_current cards. The pinnedDeckVersion stays at V_n locally, but the cards in the React Query cache become V_current cards. `proven` via code-reading.

**Root cause R3 (hidden flaw, foundational to R2):**
`handleDeterministicV2` line 771 calls `pg_aggregate_collab_prefs(session_id)` which reads CURRENT `collaboration_sessions.participant_prefs`. It does NOT read from `session_deck_versions.aggregated_params` (where the frozen V_n snapshot lives). The CR-4 resume contract requires reads from the frozen snapshot for past V_n — but the serving path doesn't support that. `proven` via code-reading.

**Root cause R4 (scale-blocker, immediate production threat):**
`pg_aggregate_collab_prefs:315` has `IF v_circle_count > 50 THEN RAISE EXCEPTION`. At participant #51 with GPS, the trigger throws and the session is broken from then on. PostGIS is NOT installed (confirmed via `pg_extension` probe). The documented Path A escape is unavailable. 500-participant sessions are currently architecturally impossible. `proven` via DB probe.

---

## 10. Confidence level

| Finding | Confidence | Reason |
|---------|------------|--------|
| R1 (operator symptom = CR-5 design held with joiner pinning to V_{n+1}) | `proven` | Real production data + exhaustive code trace — both confirm the mechanism |
| R2 (refetch silently swaps existing participants to V_current) | `proven` | Code reading — discover-cards line 771 reads current state; Fix D removed the 409 gate |
| R3 (session_deck_versions snapshot unused by serving layer) | `proven` | Code reading — only used for `exclude_place_ids` at line 932; never read in serving path |
| R4 (50-circle cap blocks scale) | `proven` | DB probe confirms cap is live; pg_extension probe confirms PostGIS absent |
| Variant: existing participant unexpectedly switched (CR-3 violation) | `suspected` | Without sim repro, can't confirm or rule out — Case (b) is gated on `isExhausted=true` which we can't verify retroactively |
| 500-scale scalability matrix | `proven` for circle cap blocker; `probable` for realtime fan-out / storage growth (model-based, no production data above N=3) |

---

## 11. Open questions for operator (CRITICAL — fix decisions cannot be made without these)

### 11.1 CR-5 design intent at 500-scale

**The question:** Is the current CR-5 contract ("late joiners pin to V_new immediately; existing participants finish V_n first; everyone converges on V_new after exhaustion") what you want at 500-participant scale? Or do you want everyone always-aligned to a single deck, which means any joiner's adds invalidate everyone's progress?

**Three defensible designs:**

- **Design A (current CR-5):** Joiner pins to V_new immediately, existing finish V_n. Pros: respects existing swipe progress; existing don't get yanked. Cons: joiner sees a different deck than existing during the transition window. At 500-scale with constant joins, the "transition window" never closes — there's always someone behind.

- **Design B (hard alignment):** Everyone immediately pins to V_new on any bump. Pros: same deck for all at all times. Cons: every join wipes everyone's swipe progress + re-fetches; resource cost scales with participant count; bad UX for existing users.

- **Design C (joiner waits):** Joiner is pinned to existing participants' lowest V_n until all exhaust, then everyone advances together. Pros: same deck for all at all times. Cons: joiner sees stale categories/intents/circles that don't include their own prefs; their additions don't affect the deck until consensus exhaustion; bad UX for joiners.

**Operator must choose A / B / C** (or a hybrid) before any spec.

### 11.2 Late-joiner GPS lag semantics

**The question:** When a new participant accepts but their GPS hasn't been auto-written yet (window observed: 19s in production session daadd454), they're counted in `acceptedCount` and contribute categories/intents but their reachable circle is excluded. Three options:

- **Option G1 (current):** Joiner contributes categories/intents but not circle. Deck is computed for the existing geographic union with the wider category union.
- **Option G2 (block until GPS):** Joiner is treated as "pending" — their accept doesn't trip the V_{n+1} bump until their GPS is written. Pros: V_{n+1} reflects full state when it mints. Cons: a 19s window where the joiner is invisible to the deck and the session feels frozen.
- **Option G3 (use host's location as stand-in):** Until joiner's GPS arrives, use the session host's location for joiner's circle. Pros: deck reflects an approximation of where the joiner might be. Cons: wrong if joiner is in a different city; produces misleading cards.

**Operator must choose G1 / G2 / G3** (or another) before any spec.

### 11.3 Scale unlock prerequisite

PostGIS is not installed. The documented Path A escape for the 50-circle cap is unavailable. Two options:

- **Option P1:** Install PostGIS (Supabase project setting), rewrite `query_servable_places_by_signal_union` to Path A (`ST_DWithin`), lift the cap to ~10k or remove entirely. Pros: unlocks 500-scale with low per-query cost. Cons: changes the production extension surface; requires backend-team approval.
- **Option P2:** Keep Path B but lift the cap via more aggressive pre-filtering (e.g., bbox first, then Haversine for survivors). Pros: no extension change. Cons: complex code; Path B at 500 circles is O(N×500) per place, slow at scale.
- **Option P3:** Defer 500-scale; ship for <50 with the current cap clear in product UX (block 51st join with a clear "session full" message).

**Operator must choose P1 / P2 / P3.**

### 11.4 R2 + R3 fix priority

Even if 11.1 is resolved as Design A (current), R2 + R3 still need fixing — clients that refetch should NOT silently swap to V_current cards. Two paths:

- **Path F1:** Reinstate the 409 gate (drop Fix D). Force client to advance pinnedDeckVersion before refetching. Pros: clean CR-3 honored. Cons: re-introduces the session-switch / V_n exhaustion bugs Fix D solved.
- **Path F2:** Implement true CR-4 — `handleDeterministicV2` reads `session_deck_versions.aggregated_params` when `expected_deck_version !== current` and serves the FROZEN V_n cards. Pros: cleanest contract — V_n is truly resumable. Cons: requires non-trivial code change; needs verifying that historical place_pool state matches V_n's frozen circles (place may have been deleted, signal_score may have changed). The frozen circles+categories alone aren't enough — the place_pool snapshot matters too.

**Operator must choose F1 / F2** (or another).

---

## 12. Hand-off to SPEC (what the next phase needs to design)

The investigation phase produced 4 root causes (R1-R4) and 4 open product-intent questions (§11.1 through §11.4). The SPEC phase cannot start until operator answers the four questions in §11. Once answered, SPEC scope is:

1. **For R1 + §11.1:** Define the precise late-joiner / existing-participant transition behaviour at the chosen design (A/B/C). Specify all client transition cases. Specify the server-side gating.

2. **For §11.2:** Specify the late-joiner GPS semantics (G1/G2/G3) including the "joiner banner" UI per the Q-1 default in the original SPEC.

3. **For R4 + §11.3:** Specify the cap-lift path (P1/P2/P3) including PostGIS install procedure (if P1), or Path B optimization (if P2), or UX-level cap enforcement (if P3).

4. **For R2 + R3 + §11.4:** Specify the V_n freezing contract enforcement — either reinstate 409 + downstream client repairs (F1), or implement true CR-4 by having `handleDeterministicV2` read `session_deck_versions.aggregated_params` + a parallel `place_pool` snapshot table for cards (F2).

5. **NEW invariants to register on close:**
   - `I-PROPOSED-DECK-VN-FROZEN-CONTRACT` — serving layer MUST honor expected_deck_version with frozen V_n params, not current aggregation.
   - `I-PROPOSED-COLLAB-PARTICIPANT-CAP` — either "soft" (warn at N=N_max) or "hard" (block at N=N_max) but operator-known and product-visible.
   - `I-PROPOSED-COLLAB-JOINER-LOCATION-RESOLVED-BEFORE-MINT` — only if §11.2 chooses G2 (block until GPS).

6. **Regression-test scope:**
   - Happy path: 3-person join with all GPS written before mint → V_{n+1} has 3 circles; joiner sees same deck as existing (modulo CR-3 transition).
   - Edge: late-joiner GPS lag — V_{n+1} mints with acceptedCount=3 but n_circles=2.
   - Adversarial: existing participant triggers focus-refetch mid-V_n → must NOT silently swap to V_current cards (per chosen F1/F2).
   - Stress: 51st GPS-bearing participant accepts → either trigger throws (P3 verdict) or session expands cleanly (P1/P2 verdict).

7. **Cross-Surface Impact:** iOS-consumer + Android-consumer (parity — shared React Native code in `app-mobile/`). Backend changes in `supabase/migrations/` + `supabase/functions/discover-cards/`. NOT in scope: buyer-web, business-iOS/Android, admin-web, business-web-preview.

---

## Discoveries for orchestrator (side issues)

1. **DISC-0909-FOCUS-REFETCH-NOT-GATED:** React Query's default `refetchOnWindowFocus` is enabled. Combined with R2/R3, this means existing collab participants can have their deck silently swap to V_current on every app foreground. Recommend disabling focus-refetch on collab deck keys OR fixing R2/R3 first. — P2-medium

2. **DISC-0909-PARTICIPANT-PREFS-DEFAULTS:** When the 3rd joiner accepts via the invite-accept flow, their `participant_prefs` row is created with `intents=['romantic']`, `dateWindows=['this_weekend', 'today']`, `datetime_pref=2026-04-15` — meaning some onboarding step is populating these from a template or from the joiner's pre-session prefs without their explicit consent in the session context. This may surprise users who think their join is "passive observation." Worth a product-intent confirmation. — P3-low

3. **DISC-0909-ORCH-0902-FOLLOW-UPS-NOT-LANDED:** Memory mentioned `feedback_collab_deck_determinism_contract.md` was codified but the CR-4 implementation is non-functional (R3). Either the spec was not implemented as written, or the contract needs revision. Flag for the orchestrator to reconcile. — P1-high

4. **DISC-0909-LATE-JOINER-DEFAULT-PREFS-CHIRALITY:** Participant `b17e3e15` joined with `[nature, icebreakers, brunch]` — different category triad than P1/P2's `[movies, play, upscale_fine_dining]`. The category union doubled in size. If the onboarding flow is producing "default category packs" for fresh joiners, those defaults are dramatically changing collab deck membership. Worth a separate audit on whether late-joiner default prefs should respect existing-session vibe or stay independent. — P2-medium

---

## Working tree

`/Users/sethogieva/Desktop/mingla-main` on branch `Seth`. Investigation read-only — no code, schema, or commit produced. Next phase = orchestrator REVIEW → operator answers §11 open questions → SPEC dispatch (this skill) → IMPLEMENT (Codex `implementor-mingla` or Claude `mingla-implementor` per operator routing) → TEST → CLOSE per pre-merge gate.

**END OF INVESTIGATION REPORT — ORCH-0909.**
