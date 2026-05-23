# SPEC AMENDMENT — ORCH-0906 [Single↔intent strict-1:1 alternation with per-pill round-robin, server-side merge] — AMENDS ORCH-0909 [Collab deck positional shared-deck rewrite]

**Author:** Claude `mingla-forensics` (IA mode — Spec half)
**Date:** 2026-05-21
**Phase:** SPEC AMENDMENT (binding contract; the ORCH-0909 implementor consumes this file ALONGSIDE the parent spec)
**Severity:** S1-high
**Classification:** missing-feature + design-debt + parity-regression-fix
**Status:** READY FOR IMPLEMENT — all five product decisions LOCKED (A1/A2/A3/A4 + D7=graceful-degrade per operator 2026-05-21).
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`

**Companion investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0906_SINGLE_INTENT_INTERLEAVE_FEASIBILITY.md`
**Parent spec (still binding):** `Mingla_Artifacts/specs/SPEC_ORCH-0909_COLLAB_POSITIONAL_SHARED_DECK.md`
**Prior code-trace investigation (load-bearing):** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0906_COLLAB_DECK_MISSING_INTENT_AND_CURATED_INTERLEAVE.md`

---

## 1. Amendment summary

The parent ORCH-0909 spec rewrites the collab deck to a positional shared-deck model serving SINGLE cards only (one place per position from `place_pool` via signal RPCs over the participant-circle intersection). This amendment extends that model with a SECOND card type — CURATED multi-stop experiences from `generate-curated-experiences` — and weaves the two types into a strict 1:1 alternation across positions, with per-pill round-robin rotation within each type.

**Effect on the parent spec:**

| Parent section | Change |
|----------------|--------|
| §3.1 `session_deck_cards` table | Schema delta — add `card_type` + `curated_payload` columns; make `card_id` nullable; add CHECK constraint |
| §3 (new) | New `session_curated_cache` table for per-session per-intent batch persistence |
| §4.1 `pg_aggregate_collab_prefs` | NO change — intents already returned in the canonical jsonb (`agg.intents`) |
| §4.2 `query_servable_places_by_signal_intersection` | NO change |
| §5.1.3 `handleDeterministicV2` handler logic | EXTENDED — new step inserted between "TARGET position computed" and "fan-out chip RPCs" to decide TYPE (single vs curated) and dispatch to the appropriate branch |
| §5 (new) | New `_shared/mixedTypeInterleave.ts` helper for type+pill rotation logic |
| `generate-curated-experiences` | Extended request schema: optional `excludePlacePoolIds: string[]` |
| §6.x Client layer | NO change — `<DeckCard>` component already routes by `card.cardType` (solo path renders curated already) |
| §8 Success Criteria | 5 new SCs (SC-14 through SC-18) |
| §9 Invariants | 2 new invariants registered |
| §10 Test plan | 4 new regression tests (T-IMP-10, T-IMP-11, T-ADV-09, T-ADV-10) |
| §11 Implementation order | 4 new steps inserted between parent §11 step 3 and step 6 |
| §13 Decommission flags | 2 additional decommissions (deckService.ts:776 comment + strengthen feedback_solo_collab_parity.md to bidirectional) |

---

## 2. Locked decisions (quote verbatim from dispatch)

> **A1 — Alternation rhythm:** Strict 1:1 single↔intent. Card 1 = single, card 2 = intent (curated), card 3 = single, card 4 = intent, …
>
> **A2 — Intent-card definition:** (i) Curated multi-stop experiences only, produced by `generate-curated-experiences`.
>
> **A3 — Round-robin scope:** Strict per-pill rotation across ALL pills, with single↔intent alternation woven in. Within singles, rotate across all category chips; within intents, rotate across all intent pills; alternate the two streams 1:1.
>
> **A4 — Architecture:** F1 server-side merge inside the ORCH-0909 positional successor function. Each frontier-advance swipe is one server round-trip; server decides which type at this position; server invokes the appropriate fan-out internally; server INSERTs the single chosen card into `session_deck_cards`.

**Forensics-pinned sub-rule** (operator approves at REVIEW): odd positions = SINGLE, even positions = CURATED. (Picks the natural "deck opens with a place" flow.)

**D7 — LOCKED 2026-05-21 by operator:** Graceful degrade (option a). When one type's pool exhausts, every following position serves the surviving type with a small banner. Full dead-end only fires when BOTH types exhaust. See §7.2 for the implementor's exact behavior.

---

## 3. DB layer delta

### 3.1 ALTER TABLE `public.session_deck_cards`

Append to the parent migration `supabase/migrations/20260628000000_orch_0909_positional_shared_deck.sql` BEFORE the `CREATE INDEX` line (so the column is present before the index that may eventually include `card_type`):

```sql
-- ORCH-0906 amendment: support mixed-type (single + curated) deck rows.
-- Single rows: card_id IS NOT NULL (FK to place_pool), curated_payload IS NULL.
-- Curated rows: card_id IS NULL, curated_payload IS NOT NULL (full hydrated curated card jsonb).
ALTER TABLE public.session_deck_cards
  ALTER COLUMN card_id DROP NOT NULL;

ALTER TABLE public.session_deck_cards
  ADD COLUMN IF NOT EXISTS card_type text NOT NULL DEFAULT 'single'
    CHECK (card_type IN ('single', 'curated'));

ALTER TABLE public.session_deck_cards
  ADD COLUMN IF NOT EXISTS curated_payload jsonb NULL;

-- Exactly one of card_id / curated_payload must be set per row.
ALTER TABLE public.session_deck_cards
  DROP CONSTRAINT IF EXISTS sdc_exactly_one_payload;
ALTER TABLE public.session_deck_cards
  ADD CONSTRAINT sdc_exactly_one_payload CHECK (
    (card_type = 'single'   AND card_id IS NOT NULL AND curated_payload IS NULL)
    OR
    (card_type = 'curated'  AND card_id IS NULL     AND curated_payload IS NOT NULL)
  );

-- Optional: pill / intent label for analytics + match-quorum joins (curated cards
-- need a stable identifier — use the synthetic card id from the curated payload).
ALTER TABLE public.session_deck_cards
  ADD COLUMN IF NOT EXISTS pill_label text NULL;

COMMENT ON COLUMN public.session_deck_cards.card_type IS
  'ORCH-0906: one of {single, curated}. Single rows hydrate from place_pool via card_id. Curated rows store the full hydrated curated card jsonb (synthetic id, stops array, taglines, descriptions) because curated experiences are not persisted entities.';

COMMENT ON COLUMN public.session_deck_cards.curated_payload IS
  'ORCH-0906: the full curated card object returned by generate-curated-experiences. Schema matches CuratedExperienceCard wire shape. Read-only after insert (positional immutability invariant).';

COMMENT ON COLUMN public.session_deck_cards.pill_label IS
  'ORCH-0906: the pill that drove this position. For single rows = category chip (brunch, fine_dining, ...). For curated rows = intent pill (romantic, group-fun, ...). Used for analytics and rotation-debugging; not load-bearing.';
```

### 3.2 NEW table `public.session_curated_cache`

For batch persistence across Deno isolate restarts within the same session (D2 + D7 of investigation):

```sql
CREATE TABLE IF NOT EXISTS public.session_curated_cache (
  session_id uuid NOT NULL REFERENCES public.collaboration_sessions(id) ON DELETE CASCADE,
  experience_type text NOT NULL CHECK (experience_type IN (
    'adventurous', 'first-date', 'romantic', 'group-fun', 'picnic-dates', 'take-a-stroll'
  )),
  batch_index int NOT NULL DEFAULT 0 CHECK (batch_index >= 0),
  cards jsonb NOT NULL,                  -- array of CuratedExperienceCard
  served_card_ids text[] NOT NULL DEFAULT '{}',  -- synthetic ids drawn from this batch
  generated_at_version int NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, experience_type, batch_index)
);

ALTER TABLE public.session_curated_cache ENABLE ROW LEVEL SECURITY;

-- Service-role only; no end-user access.
DROP POLICY IF EXISTS scc_service_only ON public.session_curated_cache;
CREATE POLICY scc_service_only ON public.session_curated_cache
  FOR ALL
  USING (auth.role() = 'service_role' OR current_user = 'postgres')
  WITH CHECK (auth.role() = 'service_role' OR current_user = 'postgres');

CREATE INDEX IF NOT EXISTS idx_scc_session_intent
  ON public.session_curated_cache (session_id, experience_type, batch_index DESC);

COMMENT ON TABLE public.session_curated_cache IS
  'ORCH-0906: per-session per-intent batch cache. A batch is a set of curated cards generated once and drawn from across multiple intent positions in the same session. When served_card_ids covers cards.length, server fetches a new batch with the union of served_card_ids place_pool stop ids as excludes. Lifecycle: ON DELETE CASCADE follows the session.';
```

---

## 4. `pg_aggregate_collab_prefs` delta

**NO change.** The aggregator already exposes `agg.intents` (sorted, union of accepted participants' intent picks) and `agg.categories` (sorted, union of accepted participants' chip picks). Both are deterministic and consumed by the new mixed-type interleave helper as-is.

---

## 5. `generate-curated-experiences` invocation contract

### 5.1 Request schema extension

Append optional parameter `excludePlacePoolIds: string[]` to the function's request body. The function threads this through `fetchSinglesForSignalRank` calls in `generateCardsForType`. Forwards-compatible — pre-amendment callers (solo path) omit the field.

In `supabase/functions/generate-curated-experiences/index.ts` at the body destructure (line ~1216):

```ts
let {
  experienceType = 'adventurous',
  location,
  budgetMin = 0,
  budgetMax = 150,
  travelMode = 'walking',
  travelConstraintValue = 30,
  datetimePref,
  skipDescriptions = false,
  limit = 20,
  session_id,
  batchSeed = 0,
  excludePlacePoolIds = [],   // NEW (ORCH-0906)
} = body;
```

Implementor passes `excludePlacePoolIds` into `generateCardsForType` (new last argument). `generateCardsForType` threads it into every `fetchForCombo` call's `excludePlaceIds` parameter on `fetchSinglesForSignalRank`. The helper already supports an exclude list — verify by grep.

### 5.2 Internal invocation from `discover-cards/handleDeterministicV2`

A new private function inside `discover-cards/index.ts`:

```ts
/**
 * ORCH-0906: invoke generate-curated-experiences edge function internally,
 * forwarding the user's JWT so the session-aware path resolves correctly.
 */
async function fetchCuratedBatchInternal(args: {
  sessionId: string;
  experienceType: 'adventurous' | 'first-date' | 'romantic' | 'group-fun' | 'picnic-dates' | 'take-a-stroll';
  limit: number;
  excludePlacePoolIds: string[];
  callerJwt: string;
}): Promise<{ cards: any[]; summary?: { emptyReason: string; candidateAnchorCount: number; failedAnchorCount: number } }> {
  const resp = await fetch(`${SUPABASE_URL}/functions/v1/generate-curated-experiences`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${args.callerJwt}`,
    },
    body: JSON.stringify({
      experienceType: args.experienceType,
      session_id: args.sessionId,
      limit: args.limit,
      skipDescriptions: true,        // intent positions must stay under 2.5s p95
      excludePlacePoolIds: args.excludePlacePoolIds,
    }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`generate-curated-experiences returned ${resp.status}: ${text.slice(0, 200)}`);
  }
  const json = await resp.json();
  return { cards: json.cards ?? [], summary: json.summary };
}
```

### 5.3 Cache hit/miss flow

```
1. Read latest batch row for (sessionId, experienceType) ORDER BY batch_index DESC LIMIT 1.
2. If row exists AND served_card_ids.length < (row.cards as jsonb_array_length):
   - Pick the next unserved card from row.cards (first one whose id is not in served_card_ids).
   - Append its id to served_card_ids (UPDATE row).
   - Return the card.
3. Else (no batch row OR batch fully drained):
   - Build excludePlacePoolIds = union of all stop place_pool_ids from prior batches of this (session, experienceType) AND any place_pool ids stored as singles in this session.
   - Call fetchCuratedBatchInternal with limit=10.
   - If returned cards.length === 0 (summary.emptyReason set): proceed to D7 dead-end handling (§6.4 below).
   - INSERT new row into session_curated_cache with batch_index = (prev_max + 1).
   - Pick cards[0]. Append its id to served_card_ids. Return.
```

---

## 6. Mixed-type interleave helper

### 6.1 New file `supabase/functions/_shared/mixedTypeInterleave.ts`

```ts
/**
 * ORCH-0906 — single↔intent mixed-type interleave logic.
 *
 * Pure function: given the position to compute + the aggregated session prefs,
 * returns the deterministic (type, pill) for that position. The caller dispatches
 * to the appropriate fan-out path (singles intersection RPC or curated edge fn).
 *
 * Deterministic across racing clients — same (P, categories, intents) → same output.
 */

export interface MixedTypeDecision {
  type: 'single' | 'curated';
  pill: string;             // category chip slug (single) OR intent slug (curated)
  singleIndex?: number;     // for single: which position in the categories rotation
  intentIndex?: number;     // for curated: which position in the intents rotation
}

export function decideTypeAndPill(args: {
  position: number;          // 1-based; the position whose card we are about to mint
  categories: string[];      // sorted (from pg_aggregate_collab_prefs)
  intents: string[];         // sorted
}): MixedTypeDecision | null {
  const { position, categories, intents } = args;
  if (position < 1) return null;

  // ORCH-0906 A1: odd = single, even = curated.
  const isCurated = position % 2 === 0;

  if (isCurated) {
    if (intents.length === 0) {
      // Locked design says every session has at least 1 intent at this point —
      // but defensive: if not, the caller falls back to single (D7 graceful degrade).
      return null;
    }
    const intentIndex = (position / 2 - 1);              // 0-based count of curated positions produced so far
    const pill = intents[intentIndex % intents.length];  // strict A3 rotation
    return { type: 'curated', pill, intentIndex };
  } else {
    if (categories.length === 0) {
      // No categories selected; D7 graceful degrade — caller treats as curated-only deck.
      return null;
    }
    const singleIndex = (position - 1) / 2;              // 0-based count of singles produced so far
    const pill = categories[singleIndex % categories.length];
    return { type: 'single', pill, singleIndex };
  }
}
```

### 6.2 Why this helper, not extending `roundRobinByChip`

`roundRobinByChip` is a batch-output helper (returns N cards from M buckets). This decision logic is positional (one position → one (type, pill) pair). Different abstraction; cleaner as a separate file. Both ship in `_shared/` and both are referenced from `discover-cards/index.ts`.

---

## 7. Edge function logic delta

Modify `supabase/functions/discover-cards/index.ts` `handleDeterministicV2` (positional successor). Insert the following BETWEEN step 5 (CHECK if position already exists in `session_deck_cards`) and step 6 (current chip RPC fan-out logic):

```
5a. Compute target type + pill via mixedTypeInterleave.decideTypeAndPill({
      position: targetPosition,
      categories: agg.categories,
      intents: agg.intents,
    }).

5b. If decision is null (both arrays empty after quorum met — should not happen,
    but defensive): return dead_end reason='no_matching_candidates'.

5c. If decision.type === 'curated':
    → branch to handleCuratedPosition(targetPosition, decision.pill, ...).
    → return its Response (success or dead_end).

5d. Else (decision.type === 'single'):
    → existing chip fan-out logic continues, BUT restricted to a single chip:
      canonicalCategories = [decision.pill]  (not the full agg.categories array)
      chipTargets = [CATEGORY_TO_SIGNAL[decision.pill]]
    → existing intersection RPC, scoring, interleave (trivially 1-bucket
      round-robin), exclude-already-served, pick top unseen.
    → continue with existing INSERT + read-back + successResponse.
```

### 7.1 New helper `handleCuratedPosition`

```ts
async function handleCuratedPosition(args: {
  supabaseAdmin: any;
  sessionId: string;
  userId: string;
  targetPosition: number;
  experienceType: string;     // the intent pill (must be in SESSION_INTENT_IDS)
  sessionRow: { deck_version: number; deck_params_hash: string | null };
  acceptedCount: number;
  pendingGpsUserIds: string[];
  callerJwt: string;
  t0: number;
}): Promise<Response> {
  // 1. Read latest cache row for (sessionId, experienceType).
  // 2. If hit + not drained: pick next unserved card. UPDATE served_card_ids.
  // 3. If miss / drained: assemble excludePlacePoolIds from:
  //    - All prior session_curated_cache rows for this (sessionId, experienceType) →
  //      collect every stop place_pool_id from cards[i].stops[j].placePoolId.
  //    - All session_deck_cards rows for this sessionId where card_type='single' →
  //      collect card_id.
  // 4. Invoke fetchCuratedBatchInternal(experienceType, limit=10, exclude=..., jwt).
  // 5. If returned cards.length === 0:
  //    - D7 dead-end handling. See §6.4 below.
  // 6. INSERT new session_curated_cache row with batch_index = (max + 1).
  // 7. Pick cards[0]; record its synthetic id in served_card_ids.
  // 8. INSERT into session_deck_cards (session_id, position=targetPosition,
  //    card_id=NULL, card_type='curated', curated_payload=picked_card_jsonb,
  //    pill_label=experienceType, generated_at_version=sessionRow.deck_version)
  //    ON CONFLICT (session_id, position) DO NOTHING.
  // 9. SELECT-after-insert to get the winning row (may be ours, may be racer's).
  // 10. UPDATE session_participants.current_position = targetPosition (only if
  //     current_position < targetPosition — same as singles path).
  // 11. Return success response with curated card payload.
}
```

### 7.2 D7 dead-end handling — LOCKED to graceful degrade

Per operator 2026-05-21: graceful degrade. Implementor codes EXACTLY this; do not stake out alternates.

**On curated exhaustion** (`handleCuratedPosition` returns zero candidates after a fresh `generate-curated-experiences` invocation with the full session-wide exclude set):

1. Compute the next single-pill via `categories[(count_of_single_rows_so_far) % categories.length]` — i.e., advance the singles rotation by one even though this position would normally be curated.
2. Run the single branch (§7 step 5d) restricted to that pill.
3. INSERT into `session_deck_cards` with `card_type='single'`, `pill_label=<the single chip used>`, and a new column `degraded_from text NULL` set to the intent that exhausted (e.g., `'romantic'`).
4. Response carries `degraded_from_intent: true, exhausted_intent: '<intent>'` so the client renders the banner: **"We're running low on `<exhausted_intent_label>` experiences — showing more spots instead."**

**On singles exhaustion** (symmetric): advance the intent rotation, run curated branch, set `degraded_from='<exhausted_category>'`, response carries `degraded_from_single: true`.

**Only when BOTH types exhaust:** return `dead_end: true, reason: 'all_pools_exhausted'` (smart empty state on client).

**Schema implication (append to §3.1):**

```sql
ALTER TABLE public.session_deck_cards
  ADD COLUMN IF NOT EXISTS degraded_from text NULL;

COMMENT ON COLUMN public.session_deck_cards.degraded_from IS
  'ORCH-0906 D7 graceful-degrade marker. NULL on normal rows. On a row where one type''s pool exhausted and we served the other type instead, this is the slug of the exhausted pill (intent slug if a single replaced a curated, category slug if a curated replaced a single). Drives the client banner copy.';
```

Invariant `I-PROPOSED-COLLAB-DECK-SINGLE-INTENT-1-1` (§10) explicitly permits `card_type` to deviate from parity ONLY when `degraded_from IS NOT NULL` — auditors verify by reading rows.

### 7.3 JWT forwarding

`handleDeterministicV2` already extracts the bearer JWT from `req.headers.get('Authorization')`. Pass it into `handleCuratedPosition` so `fetchCuratedBatchInternal` can forward it. The forwarded JWT lets `generate-curated-experiences` resolve the user's session aggregation correctly.

### 7.4 Hydration delta in `handleDeterministicV2.successResponse`

The existing `hydrateCard(cardId)` reads from `place_pool` for singles. Add a sibling path for curated:

```ts
// In successResponse, replace the hydrateCard step with:
async function hydrateCardFromRow(row: { card_id: string | null; card_type: string; curated_payload: any | null }): Promise<any | null> {
  if (row.card_type === 'curated' && row.curated_payload) {
    return row.curated_payload;
  }
  if (row.card_type === 'single' && row.card_id) {
    return await hydrateSingleFromPlacePool(row.card_id);  // existing logic refactored
  }
  return null;
}
```

The `existingCardRes` query at line 913 must SELECT the new columns: `card_id, card_type, curated_payload, generated_at_version`.

---

## 8. Client layer delta

**NO change required.** Verification:

1. Solo deck already renders BOTH card types via `card.cardType === 'curated' ? <CuratedCard /> : <PlaceCard />` (verify in `app-mobile/src/components/SwipeableCards.tsx` — solo's `useDeckCards` already merges singles + curated and the renderer handles both).
2. Collab deck client (post-ORCH-0909) receives cards as one-at-a-time via positional fetches. The returned `card` object is either a `PlaceCard` (when `card_type='single'`) or a `CuratedExperienceCard` (when `card_type='curated'`). The mobile `<DeckCard>` component routes on `card.cardType` and renders correctly.
3. Match-quorum write path uses `card.id` regardless of type — for single it's `place_pool.id`, for curated it's the synthetic `curated_${experienceType}_...` string. `board_user_swipe_states.card_id` is a text column today; no migration needed there.

**Verification step for implementor:** before implementing, grep `app-mobile/src/components/` for `cardType === 'curated'` and `<CuratedCard` — confirm the renderer exists. If it does not exist for the collab path (i.e., collab uses a different deck component that doesn't branch), add a parity finding to the implementation report and extend the renderer.

---

## 9. Success Criteria delta

Add the following to parent §8:

| # | Criterion | Observable how |
|---|-----------|----------------|
| **SC-14** | **Strict 1:1 alternation observable.** In any collab session with ≥1 intent pill + ≥1 category pill selected, positions 1..20 alternate single/curated exactly (odd=single, even=curated). | Tester: read `session_deck_cards` ORDER BY position for a fresh 20-swipe session; verify `card_type` is `single` for odd positions and `curated` for even positions. |
| **SC-15** | **Strict per-pill rotation observable across 18+ positions.** With 6 categories × 2 intents, by position 18 every category and every intent has been served at least once (and at most 3 times for categories, 5 times for intents). | Tester: read `pill_label` ORDER BY position; assert the rotation pattern matches D4's worked example. |
| **SC-16** | **Graceful degrade on single-type exhaustion (D7-LOCKED option a).** When `generate-curated-experiences` returns zero candidates for the rotation's current intent, the position is filled with the next single from the categories rotation; the row carries `degraded_from=<intent_slug>`; the response carries `degraded_from_intent: true`; the client banner reads "We're running low on `<intent_label>` experiences — showing more spots instead." Symmetric for singles exhaustion. Full `dead_end: true, reason: 'all_pools_exhausted'` fires only when BOTH types exhaust. | Tester: stub curated to empty; swipe past intent position; verify row `card_type='single'` + `degraded_from='<intent>'` + client banner visible. Then stub singles to empty too; verify dead-end. |
| **SC-17** | **Curated edge fn p95 latency ≤2.5s per intent-position cache miss; ≤500ms per cache hit.** | Tester: log timestamps client-side over 30 intent positions; compute p50/p95; assert thresholds. |
| **SC-18** | **Race resolution identical across clients at intent positions.** Two participants at frontier simultaneously swiping into an intent position both receive responses; both contain the SAME curated card (same synthetic id, same stops array). | Tester: Promise.all() two simultaneous swipe calls; compare returned `card.id` for the curated row. |

---

## 10. Invariants delta

Add the following NEW invariants to parent §9.3:

| ID | Description |
|----|-------------|
| `I-PROPOSED-COLLAB-DECK-SINGLE-INTENT-1-1` | The card at `(session_id, position=P)` has `card_type='single'` iff P is odd, and `card_type='curated'` iff P is even, UNLESS dead-end graceful-degrade (D7 option a) fired — in which case the row carries `card_type` of the surviving type and a `pill_label` indicating the degrade. The implementor MUST persist the actual served type in the row; auditors verify SC-14 by reading rows, not by recomputing parity. |
| `I-PROPOSED-COLLAB-DECK-PER-PILL-ROUND-ROBIN` | For any session with categories `C` and intents `I`, the sequence of `card_type='single'` rows ORDER BY position has `pill_label` cycling deterministically through `C` (modulo `|C|`); the sequence of `card_type='curated'` rows ORDER BY position has `pill_label` cycling deterministically through `I` (modulo `|I|`). Both modulos count only NON-DEGRADED rows for that type — a row that fell through D7 option (a) is excluded from its target type's cycle count. |

---

## 11. Step 0.5 regression test delta

Add to parent §10.1 (implementor happy-path):

| Test | Scenario | Verifies |
|------|----------|----------|
| T-IMP-10 | **20-card worked example replication.** With seeded categories=[brunch, fine_dining, icebreakers, movies, nature, play] + intents=[group-fun, romantic] on a Raleigh-area test session, swipe 20 positions; assert `session_deck_cards` ORDER BY position matches D4's table (allowing place_pool drift on single rows but enforcing pill_label sequence + card_type sequence exactly). | SC-14, SC-15 |
| T-IMP-11 | **Race resolution at intent position.** Promise.all() two `discover-cards` invocations with the same `(session_id, current_position)`. Assert both return the SAME `card.id` AND SAME `position`. Assert exactly ONE `session_deck_cards` row exists for that position. | SC-18 |

Add to parent §10.2 (tester adversarial):

| Test | Adversarial angle | Verifies |
|------|--------------------|----------|
| T-ADV-09 | **Graceful degrade when curated pool exhausts.** Stub `generate-curated-experiences` to return empty `{cards:[], summary:{emptyReason:'pool_empty'}}`. Swipe an intent position. Assert: response has `degraded_from_intent: true, exhausted_intent: '<slug>'`; `session_deck_cards` row has `card_type='single'` AND `degraded_from='<intent_slug>'`. Then deplete singles too; assert `dead_end:true, reason:'all_pools_exhausted'`. | SC-16 |
| T-ADV-10 | **Curated edge fn timeout / 5xx.** Stub `generate-curated-experiences` to hang past 5s OR return 500. Verify `handleCuratedPosition` returns `pipeline_error` (HTTP 500) cleanly without leaving an inconsistent row in `session_curated_cache`. Verify subsequent retry succeeds when the stub returns to normal. | error path |

All four tests must include a `fails-on-revert verified at <commit-hash>` line in the implementation report.

---

## 12. Implementation order delta

Parent §11 lists 12 steps. The amendment inserts 4 new steps AFTER parent step 3 (edge function rewrite) and BEFORE parent step 6 (tests):

| Parent step | Status | Notes |
|-------------|--------|-------|
| 1. PostGIS pre-flight | unchanged | — |
| 2. DB migration file | EXTENDED | Append §3.1 (`ALTER TABLE session_deck_cards`) and §3.2 (`CREATE TABLE session_curated_cache`) to the same migration file as the parent positional rewrite. |
| 3. Edge function rewrite | EXTENDED | Modify `handleDeterministicV2` per §7 above. Modify `generate-curated-experiences` per §5.1. Add new `_shared/mixedTypeInterleave.ts` per §6. |
| **NEW 3a.** | **New file** | Create `_shared/mixedTypeInterleave.ts`. |
| **NEW 3b.** | **Extend curated fn** | Add `excludePlacePoolIds` parameter handling in `generate-curated-experiences`. |
| **NEW 3c.** | **Inject branch** | In `handleDeterministicV2`, insert the `decideTypeAndPill` + curated branch + single-pill restriction per §7. |
| **NEW 3d.** | **Hydration** | Add `hydrateCardFromRow` switching on `card_type`; ensure SELECT includes the new columns. |
| 4. Client retirement | unchanged | — |
| 5. Client re-implementation | unchanged + verification | Verify `<DeckCard>` renders both types in collab (§8 above). |
| 6. Tests | EXTENDED | Add T-IMP-10, T-IMP-11, T-ADV-09, T-ADV-10 per §11 above. |
| 7. CI gates | EXTENDED | Add strict-grep gates per §13 below. |
| 8. Implementation report | EXTENDED | Cite amendment SC-14..SC-18 verification in addition to parent SC-01..SC-13. |

---

## 13. Decommission flags for CLOSE Extension Step 5a-5h

Append to parent §13:

### 13.1 Delete `deckService.ts:776` "solo-only" comment

The comment must be physically deleted from `app-mobile/src/services/deckService.ts:776` as part of step 4 (Client retirement). The implementor's report must cite the file:line of the deletion.

### 13.2 Strict-grep CI gate forbidding the resurrection

Add to `.github/workflows/strict-grep-mingla-business.yml` a new job calling a new script `app-mobile/scripts/ci/orch-0906-no-resurrected-solo-only-comment-check.mjs`:

```js
// Fails if any source file in app-mobile/src/services or app-mobile/src/contexts
// contains the literal substring "no curated parallel path" or "that pattern is solo-only".
```

### 13.3 Strengthen `feedback_solo_collab_parity.md` to bidirectional (Step 5c)

Per investigation §D9.2. Operator (or orchestrator at CLOSE Extension Step 5c) appends the "Bidirectional parity rule" clause. Memory status flips from current "solo→collab one-way" to "bidirectional, both directions are findings".

### 13.4 New invariants registered in `INVARIANT_REGISTRY.md` (Step 5e)

Add `I-PROPOSED-COLLAB-DECK-SINGLE-INTENT-1-1` and `I-PROPOSED-COLLAB-DECK-PER-PILL-ROUND-ROBIN` (§10 above) with ORCH-0906 citation.

### 13.5 DECISION_LOG.md entries (Step 5f)

```
DEC-2026-05-21-ORCH-0906 — Collab deck extended to mixed single+curated card types via strict 1:1 alternation.
Rationale: operator-locked product intent (A1/A2/A3/A4) — singles alone is a parity regression from solo;
curated experiences belong in collab.

DEC-2026-05-21-CURATED-IN-COLLAB-VIA-SERVER-MERGE — Architecture F1 (server-side merge inside ORCH-0909
positional successor) chosen over F2 (client parallel fetch) and F3 (new unified function). F1 preserves the
positional immutability + race-determinism invariants of ORCH-0909.

DEC-2026-05-21-D7-DEAD-END — Graceful degrade (option a). Operator-locked 2026-05-21. When one type
exhausts, the next position is filled by the surviving type; banner notifies user. Full dead-end fires
only when BOTH types exhaust. session_deck_cards.degraded_from column records which pill exhausted.
```

---

## 14. Cross-Surface Impact (re-stated under §2.5 of parent)

| Surface | In scope? | Change |
|---------|-----------|--------|
| Consumer iOS | YES | Receives both single and curated card payloads from the same positional endpoint; existing renderer handles both. |
| Consumer Android | YES | Same as iOS (shared RN code). |
| Backend | YES | Schema delta (§3), edge function delta (§5, §7), new shared helper (§6). |
| Buyer/anonymous Web | NO | No collab feature. |
| Business iOS/Android/Web | NO | No collab feature. |
| Admin Web | NO | No consumer deck UI. |

Parity is automatic via shared RN code. Per-surface SCs are NOT split. Tester must still exercise iOS Simulator + Android Emulator per `feedback_tester_canonical_and_platform_parity.md`.

---

## 15. Discoveries

1. **DISC-0906-EXAMPLE-PILLS-ARE-ILLUSTRATIVE** (closed — operator clarified 2026-05-21): the dispatch's worked-example intents (`[romantic, casual]`) were illustrative. Real sessions return whatever pills users actually selected from the 6 locked SESSION_INTENT_IDS. "Casual" in the example mapped to `group-fun`. The amendment's logic is general — `decideTypeAndPill` reads `agg.categories` and `agg.intents` straight from `pg_aggregate_collab_prefs`, no hardcoded pill assumptions.

2. **DISC-0906-MATCH-QUORUM-CARD-ID-TYPE** (P2): curated cards carry synthetic string ids like `curated_romantic_1747...`. `board_user_swipe_states.card_id` accepts text — verified. No further work, but flagged for the implementor to triple-check no consumer code casts to uuid.

3. **DISC-0906-PILL-LABEL-NULLABLE** (P3): for single rows during the ORCH-0909 baseline pre-amendment, existing rows have `pill_label IS NULL`. Backfill not required (positional deck cards are immutable; backfilling pill_label would only help analytics). Implementor confirms whether backfill is in scope; default = leave NULL on legacy rows.

4. **DISC-0906-CURATED-MATCH-ON-POSITION-NOT-CARDID** (P2): two participants right-swiping the SAME curated card at the SAME position do match. But two participants right-swiping the SAME experienceType across DIFFERENT positions (e.g., A swipes romantic at position 2, B swipes romantic at position 6 — different concrete itineraries) do NOT match. This is correct per `I-PROPOSED-COLLAB-MATCH-REACHABLE` (match is per-card not per-pill). Document in match-quorum tests so this is explicit.

5. **DISC-0906-SESSION-CURATED-CACHE-CLEANUP** (P3): if a session is abandoned, `session_curated_cache` rows stay until `collaboration_sessions` is deleted (ON DELETE CASCADE). No periodic cleanup needed; the table is bounded by session count × intent count × batch count.

---

## END OF SPEC AMENDMENT — ORCH-0906 (single↔intent strict-1:1 alternation, amends ORCH-0909)

**Implementor: read this file ALONGSIDE the parent `SPEC_ORCH-0909_COLLAB_POSITIONAL_SHARED_DECK.md`.** Both are binding. Where the parent and this amendment disagree, the amendment wins for the topics it covers (mixed-type deck composition, curated invocation, decommissions); the parent wins everywhere else (positional model fundamentals, intersection geographic semantic, atomic accept, single-shot cutover, etc.).

Working tree: `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`.
