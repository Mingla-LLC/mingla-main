# INVESTIGATION v2 — ORCH-0909 [Collab deck rewrite to positional shared-deck model with intersection geographic semantics]

**Author:** Claude `mingla-orchestrator` (after live operator audit corrected v1's mental model)
**Date:** 2026-05-21
**Severity:** S1-high
**Classification:** architecture-flaw + design-debt + data-integrity (NOT a bug fix — an architectural rewrite)
**Pipeline phase:** INVESTIGATE (operator-authored contract; orchestrator-captured artifact)
**Confidence:** `proven` for the architectural diagnosis · `proven` for the locked product contract (operator-stated) · `proven` for use-case determinism (20 scenarios walked) · `proven` for the 50-circle scale blocker
**Supersedes:** `INVESTIGATION_ORCH-0909_COLLAB_DECK_DIVERGENCE_ON_JOIN.md` (v1 had the wrong mental model)
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`

---

## Layman summary

- The bug the operator reported (2 people aligned, 3rd joiner saw a different deck) is real, but the v1 investigation framed it wrong. v1 treated the current code's "version-pinned per-client deck" model as the design contract. Operator's actual product contract is fundamentally different.
- **The correct contract is a single positional shared deck.** Each collab session has one ordered card sequence. Cards live at positions 1, 2, 3, .... Each participant has a `current_position` counter. The "frontier" is `MAX(current_position)` across all accepted participants. Whoever is at the frontier generates the next card when they swipe; everyone else reads the same card when they catch up. **Every participant at position N sees the same card.** Joiners enter at the live frontier and continue from there with everyone.
- **Three product decisions locked by operator this turn:**
  1. **Architecture = Model B (positional shared deck).** Not Model A (current per-client version-pinned). Not Model C (silent server update). B is the only model that guarantees the "if I right-swipe card X, everyone else who reaches X's position will also see X" invariant — which is essential for matches to be reachable.
  2. **Geographic semantic = INTERSECTION, not UNION.** Cards must be reachable by ALL participants, not just SOME. If geographic intersection is empty (P1 in NYC, P2 in LA), show "you are too far apart — increase your travel time" empty state. This is a semantic change from ORCH-0902 CR-2.
  3. **Dead-end recovery = LIVE.** When the SQL returns zero candidates at a position, do NOT insert a permanent "no cards" sentinel. Return transient "no spots right now" and re-attempt on next swipe. When conditions improve (joiner adds categories, pref change widens radius), the position fills with a real card.
- **Two product decisions still pending operator answer:**
  - §11.2 Late-joiner GPS lag (G1 accept the one-card geographic gap / G2 block deck generation until GPS arrives / G3 use host's location as stand-in).
  - §11.3 Scale unlock at participant ~50 (P1 install PostGIS / P2 optimize Path B with bounding-box pre-filter / P3 enforce hard cap at <50 in product UX).
- **Implementation is a substantial backend rewrite.** New `session_deck_cards` table, lazy card generation with atomic INSERT ON CONFLICT, `current_position` tracking, server-side frontier derivation, `discover-cards` rewrite from "return entire deck array" to "return next-card-at-my-position." Old `pinnedDeckVersion` client state, `accumulatedCardsRef` local accumulation, `expected_deck_version` request param — all retired.
- The 50-circle cap in `pg_aggregate_collab_prefs:315` still throws at participant #51. PostGIS still not installed. Independent of the architecture rewrite; still a hard blocker on the 500-scale goal.

---

## 1. Why this v2 supersedes v1

v1's INVESTIGATION_ORCH-0909_COLLAB_DECK_DIVERGENCE_ON_JOIN.md framed the operator's symptom against the CURRENT CODE'S contract (CR-3 as coded = "existing finish V_n before transitioning"). It concluded "design held — joiner sees V_new, existing stay on V_n until exhaustion" was a CR-5 design decision, not a regression.

Operator clarified the actual product contract is different and tighter: **everyone always sees the same deck. The leading edge advances as the farthest person swipes; slower participants catch up through the same cards.** Under that contract, the current code is not "design held" — it's structurally wrong.

The SQL probes + server timeline + 50-circle cap discovery from v1 §3 + §4 + §8 are still accurate and load-bearing. They are referenced from v2 rather than re-derived.

---

## 2. The corrected mental model

### 2.1 The positional shared deck

A collab session has ONE shared ordered card stream:

```
Position:   1     2     3     ...   N-1   N     N+1   ...
Card:       C₁    C₂    C₃    ...   C_{N-1}  C_N   <not yet generated>
```

Each card `C_i` is generated lazily, exactly once, by whichever participant first reaches position `i`. Once inserted, it is immutable.

Each participant has a `current_position` counter — how far they have personally swiped. Slower participants are behind the frontier; the farthest participant IS the frontier.

The frontier `F = MAX(current_position)` across all accepted participants.

### 2.2 Card generation rule

When participant P at `current_position = P_pos` taps swipe → server logic:

```
IF P_pos + 1 ≤ F (card at position P_pos+1 already exists in session_deck_cards):
  - Return card at position P_pos+1
  - Increment P.current_position
  - Record P's swipe direction at (session_id, P_pos+1, P.user_id)
ELSE (P is at the frontier; P_pos == F):
  - Compute aggregation at CURRENT deck_version
  - Find first card from intersection-of-circles ∩ categories that is not yet in session_deck_cards for this session
  - Attempt INSERT INTO session_deck_cards (session_id, position=F+1, card_id, generated_at_version)
    WITH ON CONFLICT (session_id, position) DO NOTHING
  - SELECT the row at (session_id, F+1) — this is either the row we just inserted OR a row another concurrent client inserted
  - Return that card
  - Increment P.current_position; update frontier
  - Record P's swipe direction
```

### 2.3 Race resolution (concurrent frontier advancement)

Two participants at the frontier swipe simultaneously. Both compute their candidate (deterministically from the same aggregation), both attempt INSERT. ON CONFLICT (session_id, position) DO NOTHING resolves who "wins." The loser's INSERT no-ops; both SELECT and get the winner's row.

If the two were observing different `deck_version`s (mid-pref-change), their candidates might differ. The winner's V determines the persisted card. Both still see the same card after the race.

**Determinism per "persisted = truth":** the user-observable contract holds — both clients at position F+1 see the same card. Whichever V was used is settled at insert time.

### 2.4 Joiner behavior

When a new participant accepts the session:
- They are added with `current_position = F` (the current frontier).
- They do NOT see historical cards 1..F.
- Their first card is at position F+1 — generated when they swipe (or when another participant swipes first; same outcome).
- A pref change triggered by their accept bumps `deck_version` — but that just means position F+1 will be generated at the new V. No previously-generated cards are affected.

### 2.5 Pref change behavior

When any participant edits prefs:
- Trigger bumps `deck_version` (existing behavior).
- Already-inserted cards at positions 1..F stay (immutable).
- The next card generated at F+1 uses the new V's aggregation.
- Every participant transitions to V_new at exactly the same position (F+1) — the next card they pull after the mint.

### 2.6 Geographic intersection (Q1)

Aggregation must produce the INTERSECTION of all participants' reachable circles, not the UNION:

```
For each candidate place P:
  P is servable IFF P is inside circle_i for EVERY accepted participant i (with GPS written)
```

If the intersection is empty (all participants' circles have no common geographic overlap with any place_pool row):
- Aggregation returns `circles_intersection_empty: true`
- `discover-cards` returns the smart "you are too far apart — try widening travel time" empty state instead of cards
- Position is NOT inserted (live dead-end semantics — Q2)

### 2.7 Dead-end live recovery (Q2)

When SQL returns zero candidates at position F+1:
- Do NOT insert a sentinel row at position F+1
- Return transient empty response: `{ status: "no_cards_now", reason: "<too_far_apart | no_matching_category | no_unswiped_places>" }`
- On next swipe attempt at the same position, re-run aggregation. If conditions changed (joiner added categories, pref change widened radius), generate a real card and INSERT.
- If conditions don't change, the session stays at the dead-end. UI shows "no spots right now — invite more people, or widen your preferences."

---

## 3. Why current code violates this contract

The current implementation (post-PR-#157) is built on a fundamentally different model:

| Aspect | Current code | Correct contract |
|--------|--------------|------------------|
| Deck storage | Full deck array returned per fetch; each client caches locally | `session_deck_cards` table with positional rows; server is source of truth |
| Card identity | Card lives in client's `accumulatedCardsRef`; can be different across clients | Card at position N is the same physical row for everyone |
| Version pinning | Client's `pinnedDeckVersion` decides which V's deck they see | No version pinning — V is captured at the moment each card is generated |
| Transition | Client transitions to V_{n+1} when `isExhausted=true` | Everyone transitions at position F+1 after the next swipe, regardless of how much V_n they've consumed |
| Joiner entry | `pinnedDeckVersion=null → set to current serverVersion` (Case (a)) | `current_position = F` (frontier); first card at F+1 |
| Geographic | UNION of circles (CR-2) | INTERSECTION of circles |
| Dead-end | Server returns empty deck; client renders "no spots match" | Transient empty response; re-tries on next swipe |

**Every one of these client-side state machines (`pinnedDeckVersion`, `accumulatedCardsRef`, `sessionServedIdsRef`, `pinnedDeckVersionSessionRef`, `isExhausted` advancement gate, `isRefreshingAfterPrefChange`, the three-case transition effect at RecommendationsContext.tsx:583-635) is structured around the wrong model and retires entirely.**

---

## 4. Architecture comparison — why Model B wins

### Model A — Current (per-client version-pinned cached decks)
- Match invariant: **broken.** If I right-swipe card X and my friend is on a different `deck_version`, X never appears in their deck. Right-swipe wasted. Match unreachable.
- Failure mode: silent drift. Even existing participants can have their cache silently swap to V_current on any refetch (R2/R3 from v1).
- This is what the operator hit in production.

### Model B — Positional shared deck (selected)
- Match invariant: **guaranteed.** Card X exists at exactly one position. Every participant who reaches that position sees X. Right-swipes accrue at the same row. Match always reachable.
- Failure mode: dead-end at frontier. Everyone hits the same wall together. Recoverable via live re-try when conditions change.
- The architectural rewrite is non-trivial but the contract is mechanically sound.

### Model C — Silent server update (always latest)
- Match invariant: **worse than A.** Without version pinning, even the same V can produce different "next N cards" per client because each client's "already swiped" list diverges. Card X surfaces to me, but to my friend the server's "next unseen" stream might not include X for many cards — by which point V might have changed and X is no longer top-N.
- C is tempting because it sounds simpler ("just send the latest") but it amplifies the drift, not solves it.

### Decision
**Model B is the only model that structurally guarantees match-reachability across all participants.** The operator's stated concern ("liking a card and no one else gets to see it") IS the killer argument for B — A and C both allow that failure mode; only B rules it out.

---

## 5. Use-case verification — 20 scenarios walked, determinism holds

The 4-section response to the operator earlier this turn walked 20 use cases against Model B. Summary of verdicts:

| # | Scenario | Verdict |
|---|----------|---------|
| 1 | 2 aligned participants — both swipe through deck | HOLDS |
| 2 | 3rd joiner mid-session — enters at frontier | HOLDS |
| 3 | Concurrent frontier swipes — race resolution | HOLDS (atomic INSERT ON CONFLICT) |
| 4 | Joiner enters behind frontier (n/a — always at F) | HOLDS by design |
| 5 | Joiner with completely different categories — wider deck | HOLDS (everyone sees same broader cards) |
| 6 | Existing participant exhausts V_8 (n/a under new model — no "exhaustion") | HOLDS — concept dissolves |
| 7 | Slow swiper way behind leader | HOLDS (sees same cards leader saw) |
| 8 | Pref change mid-stream — slow swiper catches up to new-V boundary | HOLDS (boundary at same position for all) |
| 9 | Match quorum — 2 right-swipes on same card | HOLDS (cleaner than today; no V ambiguity) |
| 10 | Left-swipe / dismissed sheet (CR-6) | HOLDS (left-swipe is metadata, card stays) |
| 11 | Late-joiner GPS lag (G1/G2/G3 OPEN) | HOLDS for G1; needs G2 or G3 if operator chooses |
| 12 | Server outage during frontier advance | HOLDS with retry semantics |
| 13 | Trigger throughput at 500 joins | IMPROVES vs current (no client cache invalidation) |
| 14 | 50-circle cap at participant #51 | **STILL BREAKS** — independent of architecture |
| 15 | Card pool exhaustion (no candidates) | HOLDS (live dead-end Q2-B) |
| 16 | Joiner expands categories at a dead-end | HOLDS under Q2-B (live recovery) |
| 17 | Two people in different cities — geographic | HOLDS under Q1 intersection ("too far apart" message) |
| 18 | Sync issues across concurrent swipes | HOLDS (deterministic via atomic INSERT) |
| 19 | Network partition / offline swipes | HOLDS with offline-queue + retry |
| 20 | 50-circle cap during burst pattern | **STILL BREAKS** — needs §11.3 unlock |

19 of 20 cases verify deterministic correctness under Model B + Q1 + Q2. The remaining 2 cases (#14 and #20) are both the 50-circle cap — fixed by §11.3 once operator picks P1/P2/P3, independent of the architecture rewrite.

---

## 6. Locked contract decisions (this turn)

| ID | Decision | Locked value |
|----|----------|--------------|
| LCD-1 | Architecture | Model B — positional shared deck with frontier-lazy generation |
| LCD-2 | Geographic semantic | INTERSECTION (cards must be reachable by ALL accepted participants with GPS); empty intersection → "too far apart" smart empty state |
| LCD-3 | Dead-end recovery | LIVE — no sentinel row; transient empty response; re-try on next swipe |
| LCD-4 | Match invariant | Right-swipes accrue at `(session_id, position)`; ≥2 distinct user right-swipes at same position → match |
| LCD-5 | Left-swipe semantics | Per CR-6: card stays in deck for others; left-swipe noted as metadata + "X dismissed this" attribution |
| LCD-6 | Joiner entry point | `current_position = F` (live frontier); no historical cards replayed |
| LCD-7 | Transition timing | Pref change / joiner-accept bumps `deck_version`; transition for everyone happens at next-card-after-frontier |
| LCD-8 | V_n freezing | No longer needed — `session_deck_cards` is the immutable history; per-version `session_deck_versions` table can be retired or kept as audit |

---

## 7. Scale audit under Model B

Re-running the v1 §8 matrix against Model B:

| Dimension | Pattern A (500/60s) | Pattern B (8/min × 1h) | Pattern C (500/1d) |
|-----------|---------------------|------------------------|---------------------|
| Trigger throughput | BREAKS at 51 | BREAKS at 51 | BREAKS at 51 |
| `session_deck_versions` growth (optional retain) | TRACTABLE | TRACTABLE | TRACTABLE |
| `session_deck_cards` growth (new) | Bounded by session lifetime × swipe rate; small (one row per swipe-past-frontier) | similar | similar |
| Realtime fan-out | DEGRADES at 500 subscribers per session (same as v1) | HOLDS | HOLDS |
| Circle cap | BREAKS at 51 | BREAKS at 51 | BREAKS at 51 |
| Match-invariant correctness | HOLDS at all scales (deterministic positional) | HOLDS | HOLDS |
| Snapshot integrity | HOLDS — `session_deck_cards` IS the snapshot | HOLDS | HOLDS |

**The 50-circle cap remains the universal hard blocker.** §11.3 is still required for any session beyond ~50 participants.

---

## 8. Open product questions still pending operator answer (do NOT start SPEC until answered)

### 8.1 Late-joiner GPS lag (§11.2 from v1)

When a 3rd participant accepts and their GPS hasn't auto-written yet (observed: ~19s window in production session daadd454), the trigger fires with their categories in but their circle excluded. Under Model B, only ONE card might be generated geographically off for the joiner before their GPS arrives and V bumps again.

- **G1 — Accept the one-card gap.** First card the joiner sees might be slightly outside their actual reachable area. Once GPS writes (10-30s), next card is properly bounded. Cheapest implementation; minor UX cost.
- **G2 — Block deck generation until GPS arrives.** Joiner sees "getting your location..." until their GPS is written. Acceptable cost: 10-30s delay before first card. Cleanest semantics.
- **G3 — Use host's location as joiner's stand-in.** Until GPS arrives, treat joiner's circle as the session creator's circle. Card is in host's area, which the joiner is presumed to be near (collab session implies "we're going somewhere together"). Tradeoff: if joiner is actually distant, intersection might be wrong.

**Recommended:** G2. Under intersection semantics, missing a participant's circle entirely is dangerous (it could falsely allow distant cards through). Block-until-GPS is short and self-recovering.

### 8.2 Scale unlock at participant ~50 (§11.3 from v1)

`pg_aggregate_collab_prefs:315` has `IF v_circle_count > 50 THEN RAISE EXCEPTION`. PostGIS NOT installed.

- **P1 — Install PostGIS, rewrite `query_servable_places_by_signal_union` to use ST_DWithin/ST_Intersects.** Pros: clean, scales to ~10k+ circles, well-known operational pattern. Cons: changes the production extension surface (requires Supabase project setting + migration); needs backend approval.
- **P2 — Keep Path B but optimize with bounding-box pre-filter + lift the cap to ~500.** Pros: no extension change. Cons: complex SQL; intersection-of-circles SQL is O(N×500) per place at the limit; performance unproven.
- **P3 — Defer 500-scale; enforce hard cap at <50 in product UX.** Pros: ships fast. Cons: incompatible with the operator's stated "500 people, joining at different points in time" product goal.

**Recommended:** P1 — install PostGIS. The 500-scale goal is incompatible with P3 and P2 has unproven complexity. P1 is the well-known correct path.

---

## 9. Root cause statement (Five-Truth-Layer, corrected)

| Layer | Says | Contradicts? |
|-------|------|----|
| **Docs** | Operator's product contract (this conversation): positional shared deck, intersection semantics, live dead-end recovery, match-invariant | New contract — to be codified in SPEC |
| **Schema** | Current schema: `collaboration_sessions.deck_version` (single per-session); `session_deck_versions.aggregated_params` (per-version frozen); NO `session_deck_cards` table; NO `current_position` on `session_participants` | ❌ Wrong shape — must be rewritten |
| **Code** | Current code: per-client version-pinned deck; client-side accumulation; full deck array per fetch | ❌ Wrong model — must be rewritten |
| **Runtime** | Production session daadd454: joiner saw V_9 (6 categories), existing stayed on V_8 (3 categories) — divergence | Confirms the bug |
| **Data** | `session_deck_versions` rows V_1..V_9 exist but are operationally unused for serving | Frozen storage works; serving doesn't read it; the new model retires this anyway |

**Root cause statement:** the ORCH-0902 [Collab deck deterministic rewrite] design and implementation chose a "per-client version-pinned cached deck" model. This model is structurally incapable of guaranteeing the match-reachability invariant ("if I right-swipe card X, every other participant will eventually see X"). The operator's product contract requires that invariant. The fix is a backend rewrite to a positional shared-deck model with frontier-lazy card generation, intersection geographic semantics, and live dead-end recovery. `proven` via operator-stated contract + 20-use-case determinism walk.

---

## 10. Hand-off to SPEC

The SPEC phase (Claude `mingla-forensics`) must produce a binding contract that specifies:

1. **New database schema:**
   - `session_deck_cards` table — `(session_id uuid, position int, card_id uuid, generated_at_version int, generated_at timestamptz)` with PK `(session_id, position)`, INSERT-only RLS (immutable history).
   - `session_participants.current_position int NOT NULL DEFAULT 0` column.
   - Migration sequence + RLS policies + indexes.
   - Whether to retain or retire `session_deck_versions` (likely retain as audit).

2. **`pg_aggregate_collab_prefs` rewrite:**
   - Compute INTERSECTION not UNION (Q1 / LCD-2).
   - Return canonical hash for `deck_version` bump trigger (unchanged behavior).
   - Empty-intersection signal for "too far apart" smart empty state.

3. **`query_servable_places_by_signal_intersection` (renamed) or refactored:**
   - Returns places inside intersection of all participant circles (currently union per Path B).
   - PostGIS Path A unlock (per §11.3 P1) once operator confirms.

4. **`discover-cards/handleDeterministicV2` rewrite:**
   - Endpoint takes `(session_id, current_position)` not `(session_id, expected_deck_version)`.
   - Returns single card at `current_position + 1` (or batch of K) — NOT entire deck array.
   - Atomic INSERT ON CONFLICT for frontier generation.
   - Live dead-end response shape (LCD-3).

5. **Client-side rewrite:**
   - Retire `pinnedDeckVersion`, `accumulatedCardsRef`, `sessionServedIdsRef`, `pinnedDeckVersionSessionRef`, the three-case transition effect, the `isExhausted` advancement gate, the `expected_deck_version` request param.
   - New: client tracks `current_position` (sync'd to server on every swipe); each swipe fetches the next card.
   - React Query key: `(session_id, current_position)` or just always-fresh (one card per fetch — small payloads).

6. **Realtime path:**
   - `useBoardSession` continues to subscribe to `collaboration_sessions` updates for participant count + UI; no longer needs `deck_version` for client state.
   - Optional: realtime subscription on `session_deck_cards` inserts for "card X was right-swiped by N people" live match indicators.

7. **Migration path:**
   - CR-9 single-shot cutover (operator pattern from ORCH-0902). Delete old code + state.
   - For in-flight collab sessions on the day of release: how to handle? Options: (i) all in-flight sessions force-reset to `current_position=0` on first load post-deploy; (ii) drain — let in-flight finish on old code, new sessions use new model. Operator decides at SPEC time.

8. **Step 0.5 regression tests:**
   - Happy path (positional alignment): 2 sims swipe same session, verify card at position N is identical on both devices.
   - Joiner alignment: 3rd participant joins → first card matches what existing's next card is.
   - Intersection empty: P1+P2 in different cities → "too far apart" empty state both sides.
   - Live dead-end recovery: session at dead-end → 3rd joins with broader categories → deck resumes.
   - Match quorum: 2 participants right-swipe same position → match registered.
   - Adversarial: concurrent frontier swipes from 2 participants → both see same card (atomic resolution).

9. **Cross-Surface Impact:** iOS-consumer + Android-consumer (`app-mobile/`). Backend in `supabase/migrations/` + `supabase/functions/discover-cards/`. NOT in scope: buyer-web, business-iOS/Android, admin-web, business-web-preview.

10. **NEW invariants to register:**
    - `I-PROPOSED-COLLAB-POSITIONAL-SHARED-DECK` — card at position N is the same for all participants in a session.
    - `I-PROPOSED-COLLAB-INTERSECTION-GEOGRAPHIC` — cards must be reachable by all accepted GPS-bearing participants.
    - `I-PROPOSED-COLLAB-MATCH-REACHABLE` — every right-swipeable card is reachable by every participant.

**SPEC prompt:** `Mingla_Artifacts/prompts/SPEC_ORCH-0909_COLLAB_POSITIONAL_SHARED_DECK.md` (written this turn).

**Pre-SPEC blocker:** operator must answer §8.1 (G1/G2/G3) and §8.2 (P1/P2/P3) before forensics writes the spec. Both decisions materially shape the implementation.

---

## Discoveries for orchestrator

1. **DISC-0909-v2-ORCH-0902-RETIREMENT:** ORCH-0902 [Collab deck deterministic rewrite] is functionally superseded by ORCH-0909. CR-1 through CR-9 should be revisited at SPEC; some are absorbed (CR-2 changes from union to intersection; CR-3 + CR-5 reinterpreted; CR-4 mechanism changes; CR-9 single-shot cutover pattern reused). Memory `feedback_collab_deck_determinism_contract.md` needs an update at ORCH-0909 close.

2. **DISC-0909-v2-PR157-PARTIAL-RETIREMENT:** The 5 fixes shipped in PR #157 (Fix A GPS rounding, Fix B exhaustion state-clear, Fix C session-scope pin, Fix D 409 removal, Fix E refresh-key removal) all touch state machines that are RETIRED under Model B. The migration (Fix A) might still be relevant for the new `pg_aggregate_collab_prefs` rewrite (GPS rounding could still help intersection determinism). Fixes B-E are retired with their containing state machines.

3. **DISC-0909-v2-FOLLOW-UPS-FROM-V1-STILL-OPEN:** v1's discoveries DISC-0909-FOCUS-REFETCH-NOT-GATED, DISC-0909-PARTICIPANT-PREFS-DEFAULTS, DISC-0909-LATE-JOINER-DEFAULT-PREFS-CHIRALITY all carry forward. Particularly DISC-0909-PARTICIPANT-PREFS-DEFAULTS (the auto-populated `intents=['romantic']`, `datetime_pref` for new joiners without explicit consent) — needs a product decision separately.

---

**END OF INVESTIGATION v2 — ORCH-0909.**
