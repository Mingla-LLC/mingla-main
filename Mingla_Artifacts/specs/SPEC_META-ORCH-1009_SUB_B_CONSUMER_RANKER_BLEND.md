# SPEC — META-ORCH-1009 Sub-B — Consumer ranker blend + `inappropriate_for` veto + reasoning-on-card-back (3 surfaces)

**Mode:** Forensics SPEC (no implementation in this file)
**Worktree:** `~/Desktop/mingla-orchs/META-ORCH-1009-Sub-B-[consumer-ranker-blend-3-surfaces]/` on branch `META-ORCH-1009-Sub-B-consumer-ranker-blend-3-surfaces`
**Branched from main at:** `df54dd437` (Sub-A merge `741076e68` is in the branch lineage)
**Author skill:** Claude `mingla-forensics`
**Date:** 2026-05-30
**Parent META-ORCH:** META-ORCH-1009 — wire Gemini Q2 evaluations into consumer deck ranking
**Sibling sub-dispatches:** Sub-A (schema+backfill — CLOSED `741076e68`), Sub-C (Gemini coverage backfill — operator-driven in parallel), Sub-D (refresh cron), Sub-E (business supply-side — deferred), Sub-F (multi-stop brand-curated — deferred)
**Constitution / Comms acks:**
- COMMS-0003 (ALL) — external-API doc citations required for any new code referencing the AI score shape. Satisfied inline: Gemini 2.5 Flash model name + structured-output contract cited at §3.1 against https://ai.google.dev/gemini-api/docs/models/gemini#gemini-2.5-flash and https://ai.google.dev/gemini-api/docs/structured-output (verified 2026-05-30). No new outbound Gemini call introduced by Sub-B — the AI scores are READ from a column populated by Sub-A's writer. The docs citation discharges the contract because Sub-B's read code asserts the shape produced under the Gemini structured-output contract.
- COMMS-0007 (FYI) — iOS dev-build fmt+expo-video blocker; not in scope for Sub-B but flagged for tester dispatch.

---

## §1 Goal (plain English, one paragraph)

Sub-B turns the AI evaluations Sub-A stored on `place_pool.ai_signal_scores` into a user-felt change: every card the deck shows is now ranked by a blend of the existing rule scorer and Gemini's per-signal AI score, places that Gemini marked `inappropriate_for` a given signal are silently removed (hard veto) for queries against that signal, and the expand-modal on every consumer surface now shows a "Why we picked this for you" line containing Gemini's reasoning text for the dominant signal of the card. This is the moment Mingla decks stop feeling rule-bookish and start feeling AI-curated. The change ships across all THREE deck mount surfaces in app-mobile (Home solo, group-chat collab, paired-friend public-profile) by editing exactly ONE backend code path (`signalScorer.ts`) plus two RPCs (to surface reasoning) plus one shared mobile type (`ExpandedCardData`) plus one shared expand-modal section — surfaces inherit automatically because they all flow through the same `discover-cards` + `generate-curated-experiences` shared pipeline, and the determinism contract for collab is preserved because the AI score read is a pure function of `place_pool` state at score-compute time. Sub-B is the moment the user feels the difference; the rest of META-ORCH-1009 is plumbing around it.

---

## §2 Inputs (file/path inventory by surface + by layer)

All paths verified to exist via `Read` tool. Paths are relative to worktree root.

### §2.1 Backend (shared by all 3 surfaces)

**Architectural truth (critical):** Mingla's deck ranker is a TWO-STAGE pipeline. Stage 1 = OFFLINE — `run-signal-scorer/index.ts` calls `computeScore` from `_shared/signalScorer.ts` for every (place × signal) and UPSERTs the result into `place_scores`. Stage 2 = ONLINE — `discover-cards` and `generate-curated-experiences` call the SQL RPCs `query_servable_places_by_signal` + `query_servable_places_by_signal_intersection` (and the TS helper `fetchSinglesForSignalRank`) which SELECT `place_scores.score` filtered + ordered. Sub-B's blend lives at Stage 1 (write-time, in `signalScorer.computeScore`) so the hot path has ZERO added latency. Reasoning is a separate read path (Stage 2) that returns the per-signal reasoning string from `place_pool.ai_signal_scores->signal_id->>'reasoning'` via extended RPC return columns.

**Files (EDIT):**
- `supabase/functions/_shared/signalScorer.ts` — EDIT: add `aiSignalScores` + `signalId` + `expectedPromptVersion` + `aiBlendWeight` to the `computeScore` input contract; implement blend + veto + prompt-version discriminator. ~60 lines added.
- `supabase/functions/run-signal-scorer/index.ts` — EDIT: extend SELECT to include `ai_signal_scores` jsonb; pass per-place AI scores + the signal id + the `expectedPromptVersion` (read from `signal_definition_versions.config.expected_prompt_version`) + the `aiBlendWeight` (read from same config) into `computeScore`. Handle `vetoed=true` → set `score = null` (so existing `WHERE ps.score >= p_filter_min` filters it out). ~30 lines changed.
- `supabase/functions/_shared/signalScorer.ts` — NEW `EXPECTED_PROMPT_VERSION` constant export (single source of truth; defaults to `'v4'` per Sub-A's backfill probe; overridable per-signal via `signal_definition_versions.config.expected_prompt_version`).
- `supabase/functions/discover-cards/index.ts` — EDIT: `transformServablePlaceToCard` adds `ai_reasoning_by_signal: Record<string, string>` to the card payload (reads from the new RPC return column). ~15 lines changed.
- `supabase/functions/generate-curated-experiences/index.ts` — EDIT: `buildCardStop` adds `aiReasoningBySignal: Record<string, string>` per stop (reads from the extended `fetchSinglesForSignalRank` row). ~10 lines changed.
- `supabase/functions/_shared/signalRankFetch.ts` — EDIT: extend `SignalRankResult` interface + the underlying RPC call to surface the new `ai_reasoning` jsonb column. ~10 lines changed.

**Migrations (NEW):**
- `supabase/migrations/<TIMESTAMP>_meta_orch_1009_sub_b_rpcs_with_reasoning.sql` — REPLACE both `query_servable_places_by_signal` and `query_servable_places_by_signal_intersection` to return TWO additional columns: `ai_reasoning jsonb` (the full `ai_signal_scores->signal_id` object, or NULL if absent or prompt-version-mismatched) AND `ai_score_raw numeric` (debug column = the AI's `score_0_to_100`, for admin inspector visibility). Plus EXTEND `signal_definition_versions.config` JSONB shape via a CHECK comment (no DDL — the column is already JSONB) and add two NEW config keys `expected_prompt_version` (default `'v4'`) + `ai_blend_weight` (default `0.6`); see §3.1 for exact JSONB additions. NO column-level migration needed — `place_scores` keeps its existing shape because the blended value lives in the existing `score` numeric column. Estimated size: ~100 lines (two RPC bodies preserved verbatim from the baseline migration with two extra SELECT columns + one COMMENT update).

**Tests (NEW):**
- `supabase/functions/_shared/__tests__/signalScorer.blend.test.ts` — NEW: 6 deno tests covering the blend formula + veto + version-discriminator (see §4.1).
- `supabase/functions/discover-cards/__tests__/ai_reasoning_passthrough.test.ts` — NEW: 1 deno test asserting `ai_reasoning_by_signal` appears in the card payload.
- `supabase/functions/generate-curated-experiences/__tests__/ai_reasoning_passthrough.test.ts` — NEW: 1 deno test asserting `aiReasoningBySignal` appears on each stop.
- `supabase/migrations/__tests__/meta_orch_1009_sub_b_rpc_reasoning_return.test.sql` — NEW: post-apply probe asserting the two RPCs return the new columns + spot-check one place with populated `ai_signal_scores` returns a non-null `ai_reasoning`.

### §2.2 Consumer mobile (per surface)

**Shared (all 3 surfaces inherit):**
- `app-mobile/src/types/expandedCardTypes.ts` — EDIT: add OPTIONAL field `aiReasoningBySignal?: Record<string, string>` to `ExpandedCardData` (signal_id → reasoning text). Single discriminated union — applies to all surfaces. ~3 lines added.
- `app-mobile/src/services/deckService.ts` — EDIT: `unifiedCardToRecommendation` reads `card.ai_reasoning_by_signal` and passes through unchanged to the `Recommendation` shape via a NEW `aiReasoningBySignal?: Record<string, string>` field on the `Recommendation` type. ~10 lines changed.
- `app-mobile/src/types/recommendation.ts` — EDIT: add OPTIONAL `aiReasoningBySignal?: Record<string, string>` to `Recommendation`. ~2 lines added.
- `app-mobile/src/components/ExpandedCardModal.tsx` — EDIT: new "Why we picked this for you" section that renders `card.aiReasoningBySignal[dominantSignal]` when present. Single shared modal — every surface gets it. The "dominantSignal" is `card.tags[0]` if present else the first key of `aiReasoningBySignal`; SPEC pins the resolution algorithm at §3.3. ~40 lines added.

**Home solo surface:**
- `app-mobile/src/components/SwipeableCards.tsx` — NO CODE CHANGE. The card payload flows through `RecommendationsContext` → `<ExpandedCardModal>` unchanged; the new field rides through automatically.

**Collab surface (group chat):**
- `app-mobile/src/components/connections/CollabDeckSheet.tsx` — NO CODE CHANGE. Mounts the same `<ExpandedCardModal>`. The collab determinism contract `[[collab-deck-determinism-contract]]` is preserved BY DESIGN because the AI score read is a pure function of `place_pool.ai_signal_scores` state at score-compute time, NOT at request time (the blend happens in `place_scores.score` which is already part of the deterministic input set per session V_n).

**Paired-friend public-profile surface:**
- `app-mobile/src/components/utils/holidayCardToExpandedCardData.ts` — EDIT: ADD passthrough of `aiReasoningBySignal` from `HolidayCard` (when the source `HolidayCard` was populated by `discover-cards` or `generate-curated-experiences`) to the returned `ExpandedCardData`. ~3 lines added.
- `app-mobile/src/services/holidayCardsService.ts` — EDIT: add OPTIONAL `aiReasoningBySignal?: Record<string, string>` to the `HolidayCard` interface so the mapper above type-checks. ~2 lines added.
- `app-mobile/src/components/PersonHolidayView.tsx` — NO CODE CHANGE. Inherits via the mapper.

### §2.3 Invariant registry (EDIT)

- `Mingla_Artifacts/INVARIANT_REGISTRY.md` — flip 2 DRAFT → ACTIVE, ADD 1 NEW. Verbatim bodies in §3.4.

### §2.4 Decision log (EDIT)

- `Mingla_Artifacts/DECISION_LOG.md` — append `DEC-182` (max existing DEC-181 per the Sub-A close artifact) recording the blend weight default `0.6` (sourced from research §6 and operator Q3 recommendation), the veto-via-NULL-score storage choice, the prompt-version discriminator at `'v4'`, and the shared-expand-modal reasoning surface choice. Pointer to META-ORCH-1009 Sub-B close.

### §2.5 Reference reads (no edits — context only)

- `Mingla_Artifacts/specs/SPEC_META-ORCH-1009_SUB_A_AI_SIGNAL_SCORES_SCHEMA.md` §3.1 — column shape contract Sub-B reads.
- `Mingla_Artifacts/research/RESEARCH_EXPERIENCE_PIPELINE_TO_CONSUMER_DECK.md` §5 Option A + §6 matching contract + §9 Q5 (reasoning lives in expand-modal at v1).
- `Mingla_Artifacts/INVARIANT_REGISTRY.md` `I-AI-SIGNAL-SCORES-COLUMN-SOLE-OWNER` (ACTIVE) + `I-AI-SIGNAL-SCORES-SHAPE-CONTRACT` (ACTIVE) — what Sub-B is allowed to assume.
- `Mingla_Artifacts/INVARIANT_REGISTRY.md` `I-AI-SIGNAL-SCORES-PROMPT-VERSION-DISCRIMINATED` (DRAFT) — flips to ACTIVE on Sub-B close (Sub-A pre-staged the body; Sub-B is the enforcement surface).
- `Mingla_Artifacts/COMMS_LEDGER.md` COMMS-0003 — external-API docs citation contract.

### §2.6 Live DB probes performed during spec write (Supabase Management API, 2026-05-30)

- `place_pool.ai_signal_scores` shape — confirmed on 3 sample rows (Kanki Japanese, ZENSHI Sushi, Wilson's Eatery). Top-level keyed by signal_id; per-signal value has exact 6 keys `{score_0_to_100, inappropriate_for, reasoning, evaluated_at, prompt_version, model}` per Sub-A shape contract. All 3 samples have `prompt_version: 'v4'` + `model: 'gemini-2.5-flash'`. Reasoning text is 100–250 chars typical, single sentence, human-readable.
- `signal_definition_versions` columns — confirmed: `id uuid, signal_id text, version_label text, config jsonb, created_at timestamptz, created_by uuid, notes text`. **No `expected_prompt_version` or `ai_blend_weight` key exists today in any `config` JSONB.** Sub-B adds them via a one-line UPDATE per signal (idempotent; default applied in code if absent). NO COLUMN MIGRATION NEEDED.
- Sample `signal_definition_versions.config` (movies v1.10.0) — confirmed shape `{cap, scale, clamp_min, min_rating, min_reviews, bypass_rating, field_weights, text_patterns}`. Adding `expected_prompt_version: 'v4'` and `ai_blend_weight: 0.6` as new sibling keys is non-breaking — `signalScorer.computeScore` reads only the existing keys today.
- The two consumer-read RPCs `query_servable_places_by_signal` (baseline migration line 5905) + `query_servable_places_by_signal_intersection` (ORCH-0909 migration line 274) are SECURITY DEFINER SQL functions returning 19 columns including `signal_score numeric` (from `place_scores.score`) + `signal_contributions jsonb` (from `place_scores.contributions`). Adding two columns is backward-compatible because TS-side callers spread the row; existing fields stay in the same positions.

---

## §3 Contracts per work item

### §3.1 signalScorer.ts blend formula (LOCKED 🔒)

**New TypeScript contract for `computeScore`:**

```typescript
// EXPORTED CONSTANT — Authority for I-AI-SIGNAL-SCORES-PROMPT-VERSION-DISCRIMINATED
export const DEFAULT_EXPECTED_PROMPT_VERSION = 'v4';
// EXPORTED CONSTANT — Authority for the blend-weight default if config omits it
export const DEFAULT_AI_BLEND_WEIGHT = 0.6;

// EXPORTED CONSTANT — `place_scores.score` rule-side normalization divisor.
// Existing rule scorer clamps to [0, 200] (see `cap` in every signal_definitions.config).
// Normalization brings the rule score onto the 0–100 scale the AI uses so the blend is meaningful.
export const RULE_SCORE_MAX_NORMALIZED = 200;

// EXTEND PlaceForScoring with the AI input
export interface PlaceForScoring {
  // ... existing fields unchanged ...
  // NEW: full AI evaluations JSONB from place_pool.ai_signal_scores (or null/undefined if not evaluated).
  // Shape pinned by I-AI-SIGNAL-SCORES-SHAPE-CONTRACT.
  ai_signal_scores?: Record<string, {
    score_0_to_100: number;
    inappropriate_for: boolean;
    reasoning: string;
    evaluated_at: string;
    prompt_version: string;
    model: string;
  }> | null;
}

// EXTEND SignalConfig
export interface SignalConfig {
  // ... existing fields unchanged ...
  // NEW OPTIONAL: per-signal-version expected prompt; if absent, ranker uses DEFAULT_EXPECTED_PROMPT_VERSION.
  expected_prompt_version?: string;
  // NEW OPTIONAL: per-signal-version blend weight 0.0–1.0; if absent, ranker uses DEFAULT_AI_BLEND_WEIGHT.
  // 0.0 = rule-only (no AI), 1.0 = AI-only (no rule). Operator's recommendation per research §9 Q3:
  // default 0.6 (favor AI); set lower for facet-tight signals (flowers, groceries) where the rule
  // book is precise; set higher for vibe signals (romantic, scenic) where AI judgment beats regex.
  ai_blend_weight?: number;
}

// EXTEND ScoreResult to surface the veto + AI input that fed the final score (debugging + downstream RPC)
export interface ScoreResult {
  score: number | null; // NEW: null = vetoed (filtered out of deck downstream by `WHERE score >= filter_min`)
  contributions: Record<string, number | string>;
  // NEW (optional, set only when AI present + version-matched + non-veto):
  ai_blended?: {
    ai_score_0_to_100: number;
    rule_score_normalized: number;
    weight_used: number;
    prompt_version: string;
  };
  // NEW (optional, set only when veto fired):
  vetoed?: {
    reason: 'inappropriate_for';
    ai_reasoning: string;
  };
}

// EXTEND computeScore signature — third argument is NEW
export function computeScore(
  place: PlaceForScoring,
  config: SignalConfig,
  signalId: string, // NEW: needed to look up place.ai_signal_scores[signalId]
): ScoreResult {
  // 1. Existing rule eligibility gates run first (min_rating, min_reviews) — UNCHANGED.
  //    If ineligible, return {score: 0, contributions: {_ineligible: 0, _reason: ...}} — UNCHANGED.

  // 2. Existing rule score computation runs — UNCHANGED, produces `ruleScore` in [0, config.cap].

  // 3. NEW: Apply AI blend + veto.
  const aiEntry = place.ai_signal_scores?.[signalId] ?? null;
  const expectedVersion = config.expected_prompt_version ?? DEFAULT_EXPECTED_PROMPT_VERSION;

  // Version discriminator (I-AI-SIGNAL-SCORES-PROMPT-VERSION-DISCRIMINATED):
  // Mismatch → ignore AI entirely, return rule score alone.
  if (!aiEntry || aiEntry.prompt_version !== expectedVersion) {
    return { score: ruleScore, contributions }; // unchanged rule-only path
  }

  // Hard veto (research §9 Q4 — operator chose hard veto, not soft penalty):
  // Veto → return null score; downstream RPC filter `WHERE score >= filter_min` drops it.
  // The contributions log the veto so the admin inspector can see why.
  if (aiEntry.inappropriate_for === true) {
    return {
      score: null,
      contributions: { ...contributions, _ai_vetoed: 1, _ai_reasoning: aiEntry.reasoning.slice(0, 200) },
      vetoed: { reason: 'inappropriate_for', ai_reasoning: aiEntry.reasoning },
    };
  }

  // Blend: weight on the AI side, (1 - weight) on the rule side.
  const w = Math.max(0, Math.min(1, config.ai_blend_weight ?? DEFAULT_AI_BLEND_WEIGHT));
  const ruleNormalized = (ruleScore / RULE_SCORE_MAX_NORMALIZED) * 100; // 0..100 scale
  const blendedNormalized = (1 - w) * ruleNormalized + w * aiEntry.score_0_to_100; // 0..100
  // Rescale back to the existing rule-scale [0, 200] so downstream filter_min thresholds (100, 120) keep working
  // WITHOUT a coordinated re-tuning of every CATEGORY_TO_SIGNAL.filterMin value in discover-cards. This is a
  // LOAD-BEARING choice — see §7 Decision 1.
  const blended = (blendedNormalized / 100) * RULE_SCORE_MAX_NORMALIZED;

  return {
    score: blended,
    contributions: { ...contributions, _ai_blended: 1, _ai_weight: w, _ai_score: aiEntry.score_0_to_100 },
    ai_blended: {
      ai_score_0_to_100: aiEntry.score_0_to_100,
      rule_score_normalized: ruleNormalized,
      weight_used: w,
      prompt_version: aiEntry.prompt_version,
    },
  };
}
```

**Backward compatibility (LOCKED 🔒):**
- Existing tests in `supabase/functions/_shared/__tests__/scorer.test.ts` MUST still pass. They call `computeScore(place, config)` with TWO args. Sub-B's new signature has THREE — the implementor MUST make the third arg OPTIONAL OR update the call site in `run-signal-scorer/index.ts` to pass it AND update the existing tests to pass `'<signal_id>'` as the third arg. Recommended: make `signalId` REQUIRED + update the existing 1 caller + ~20 existing tests in one mechanical pass. The added test coverage is worth the call-site update.
- Existing `place_scores.score` numeric column accepts NULL — verified in baseline schema. Veto-via-NULL is a non-breaking change because `WHERE ps.score >= p_filter_min` already excludes NULLs.

### §3.2 run-signal-scorer/index.ts wiring (LOCKED 🔒)

- EXTEND `SELECT_FIELDS` constant to include `, ai_signal_scores` (one line).
- EXTEND the `for (const place of data ...)` loop to compute the blended score using the NEW three-arg `computeScore(place, config, signalId)`.
- When `result.score === null` (vetoed), write `score: null` to the UPSERT chunk. Implementor MUST verify the supabase-js client serializes JS `null` as SQL `NULL` (it does — verified against [supabase-js v2 docs](https://supabase.com/docs/reference/javascript/upsert) 2026-05-30 — `null` becomes SQL NULL).
- The `bucketize` helper MUST short-circuit on `result.score === null` (do not increment any bucket; a vetoed place isn't ineligible — it's deliberately excluded).
- Add a new `vetoed_count` field to `ScorerSummary` so admins can see how many places Gemini vetoed per signal. The dashboard surface for this is OUT OF SCOPE (Sub-D admin re-eval button territory); the count is logged + returned in the API response only.
- NEW: When a signal definition is freshly upgraded to a new `prompt_version` (operator promotes Q2 prompt v4 → v5), the existing `run-signal-scorer` invocation auto-recomputes blended scores for every place whose `ai_signal_scores[signalId].prompt_version` matches the new expected version. NO additional ORCH-Sub needed.

### §3.3 discover-cards.ts + generate-curated-experiences.ts + RPC return shape (LOCKED 🔒)

**RPC change (verbatim SQL in the new migration):**

```sql
-- REPLACE both query_servable_places_by_signal and query_servable_places_by_signal_intersection.
-- The change: add TWO columns to the RETURNS TABLE and to the SELECT list.
-- Everything else preserved verbatim from baseline migration line 5905 / ORCH-0909 line 274.

-- query_servable_places_by_signal:
CREATE OR REPLACE FUNCTION public.query_servable_places_by_signal(
  -- ... existing 7 params unchanged ...
) RETURNS TABLE(
  -- ... existing 19 columns unchanged, in same order ...
  signal_score numeric,
  signal_contributions jsonb,
  -- NEW (META-ORCH-1009 Sub-B):
  ai_reasoning jsonb,    -- = pp.ai_signal_scores -> p_signal_id (full 6-key per-signal object), or NULL
  ai_score_raw numeric   -- = (pp.ai_signal_scores -> p_signal_id ->> 'score_0_to_100')::numeric, or NULL
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    -- ... existing 19 columns unchanged ...
    ps.score AS signal_score,
    ps.contributions AS signal_contributions,
    -- NEW: surface the per-signal AI evaluation slice so consumer-mobile can render reasoning.
    -- NULL when the place wasn't evaluated OR prompt_version drift (the prompt-version discriminator
    -- gate is enforced one level up by signalScorer.computeScore; if it produced a non-NULL blended
    -- score, then the entry was version-matched. We still emit the raw entry here for admin visibility.)
    pp.ai_signal_scores -> p_signal_id AS ai_reasoning,
    NULLIF((pp.ai_signal_scores -> p_signal_id ->> 'score_0_to_100'), '')::numeric AS ai_score_raw
  FROM public.place_pool pp
  JOIN public.place_scores ps ON ps.place_id = pp.id AND ps.signal_id = p_signal_id
  WHERE pp.is_servable = true
    AND pp.is_active = true
    AND ps.score >= p_filter_min   -- vetoed places have ps.score = NULL → automatically excluded
    AND pp.stored_photo_urls IS NOT NULL
    AND array_length(pp.stored_photo_urls, 1) > 0
    AND NOT (
      array_length(pp.stored_photo_urls, 1) = 1
      AND pp.stored_photo_urls[1] = '__backfill_failed__'
    )
    AND (
      6371000.0 * 2.0 * ASIN(SQRT(
        POWER(SIN(RADIANS(pp.lat - p_lat) / 2.0), 2) +
        COS(RADIANS(p_lat)) * COS(RADIANS(pp.lat)) *
        POWER(SIN(RADIANS(pp.lng - p_lng) / 2.0), 2)
      ))
    ) <= p_radius_m
    AND NOT (pp.id = ANY(p_exclude_place_ids))
  ORDER BY ps.score DESC, pp.review_count DESC NULLS LAST
  LIMIT p_limit;
$$;

-- query_servable_places_by_signal_intersection: identical pattern. Add the SAME two columns
-- in the SAME positions to its RETURNS TABLE + SELECT. PostGIS WITH-CTE body preserved verbatim.

-- UPDATE the COMMENT on both functions to mention Sub-B + the two new columns.
```

**TS-side card-payload contract (LOCKED 🔒):**

The card shape extends with ONE new field on both single + curated payloads:

```typescript
// discover-cards/index.ts → transformServablePlaceToCard return value adds:
ai_reasoning_by_signal: row.ai_reasoning ? { [signalId]: row.ai_reasoning.reasoning } : undefined,
// signalId is in scope as `task.signalId` in the rpcTasks loop. The Record is keyed by signalId
// so when a card is scored on multiple signals (multi-chip user selection), the union map carries
// reasoning for each signal the card surfaced under.

// Mobile-side Recommendation type adds:
aiReasoningBySignal?: Record<string, string>; // signal_id → reasoning text
```

**Dominant-signal resolution in ExpandedCardModal (LOCKED 🔒):**

```typescript
// In ExpandedCardModal.tsx — the new "Why we picked this for you" section.
function pickDominantReasoning(card: ExpandedCardData): string | null {
  if (!card.aiReasoningBySignal) return null;
  const keys = Object.keys(card.aiReasoningBySignal);
  if (keys.length === 0) return null;
  // Prefer the signal that matches card.category (deck routes category → signal_id via
  // CATEGORY_TO_SIGNAL in discover-cards). If category-to-signal mapping is ambiguous or
  // category not in the map, fall back to the first key (alphabetical determinism).
  // Operator's recommendation per §7 Decision 4: shared component, single resolution rule.
  const categoryToSignal = card.tags?.[0]; // tags[0] is placeType per unifiedCardToRecommendation
  if (categoryToSignal && card.aiReasoningBySignal[categoryToSignal]) {
    return card.aiReasoningBySignal[categoryToSignal];
  }
  return card.aiReasoningBySignal[keys[0]] ?? null;
}
```

**Render (LOCKED 🔒 copy, 🎨 OPEN visual treatment for Sub-B designer pass):**

- Section title: `"Why we picked this for you"` (verbatim, no i18n yet — i18n in a follow-up locale ORCH).
- Section body: the reasoning string from `pickDominantReasoning(card)`, truncated to 200 chars + ellipsis if longer; full text in a tooltip on long-press.
- Position: BELOW the existing hero section, ABOVE the "Highlights" tags section.
- Visual: 🎨 OPEN — implementor uses neutral text styling matching existing modal body copy until designer dispatch lands a richer treatment.
- When `pickDominantReasoning(card)` returns `null`: section NOT rendered (no empty state).

### §3.4 Invariant registry (LOCKED 🔒 — verbatim bodies)

**Flip 1: `I-AI-SIGNAL-SCORES-PROMPT-VERSION-DISCRIMINATED` DRAFT → ACTIVE.**

Edit `INVARIANT_REGISTRY.md` lines 53–69. Replace the `**Status:** DRAFT. Flips to ACTIVE on Sub-B's ranker landing ...` line with:

```
**Status:** ACTIVE post META-ORCH-1009 Sub-B CLOSE 2026-05-30.
```

Replace the `**Authority (to be set on Sub-B close):**` line with:

```
**Authority:** `supabase/functions/_shared/signalScorer.ts` — `computeScore` function, lines XXX–YYY (the `if (!aiEntry || aiEntry.prompt_version !== expectedVersion)` guard); single source-of-truth constant `DEFAULT_EXPECTED_PROMPT_VERSION` exported from the same file. Per-signal override lives in `signal_definition_versions.config.expected_prompt_version` JSONB.
```

Replace the `**Enforcement (gates to be set on Sub-B close):**` block with:

```
**Enforcement:**
1. Deno unit test `supabase/functions/_shared/__tests__/signalScorer.blend.test.ts` Test 4: feeds `ai_signal_scores[signalId].prompt_version = 'v3'` with `config.expected_prompt_version = 'v4'`; asserts the AI score is ignored and the result equals the rule-only score.
2. Deno unit test Test 6: feeds `ai_signal_scores[signalId].prompt_version = 'v4'` with `config.expected_prompt_version` ABSENT; asserts default constant is used and AI score IS blended.
3. RPC SQL probe `meta_orch_1009_sub_b_rpc_reasoning_return.test.sql`: confirms the column returns the raw `ai_signal_scores -> signal_id` entry — the version discriminator runs ABOVE this column in signalScorer.computeScore, so this column is intentionally permissive (admin visibility of even-mismatched entries is useful for re-eval triage).
```

**Flip 2: NEW invariant `I-CONSUMER-READS-AI-SIGNAL-SCORES-NOT-TRIAL-TABLE` ACTIVE.**

Add as a sibling to the three Sub-A invariants under the `## ACTIVE (post META-ORCH-1009 Sub-A CLOSE)` section. (Sub-A intended this invariant per the orchestrator brief but did not write the body — Sub-B writes it here verbatim.) Body:

```
### I-CONSUMER-READS-AI-SIGNAL-SCORES-NOT-TRIAL-TABLE (ACTIVE post META-ORCH-1009 Sub-B CLOSE 2026-05-30)

**Statement:** Production consumer-ranker code paths — `supabase/functions/_shared/signalScorer.ts`, `supabase/functions/run-signal-scorer/index.ts`, `supabase/functions/discover-cards/index.ts`, `supabase/functions/generate-curated-experiences/index.ts`, `supabase/functions/_shared/signalRankFetch.ts`, and the SQL RPCs `query_servable_places_by_signal` + `query_servable_places_by_signal_intersection` — MUST read AI signal evaluations EXCLUSIVELY from `place_pool.ai_signal_scores`. Direct reads of `place_intelligence_trial_runs` from any production code path (consumer mobile, admin-callable consumer-facing RPC, signal scorer) are FORBIDDEN. Reads of `place_intelligence_trial_runs` from admin tooling (admin dashboard, trial-run inspector, re-eval button) are PERMITTED.

**Rationale:** `place_intelligence_trial_runs` is research-grade (no production contract on schema or freshness). `place_pool.ai_signal_scores` is the single production-blessed surface per DEC-099 + DEC-181. Bypassing the column would defeat the shape contract (I-AI-SIGNAL-SCORES-SHAPE-CONTRACT), the sole-writer contract (I-AI-SIGNAL-SCORES-COLUMN-SOLE-OWNER), and the prompt-version discriminator (I-AI-SIGNAL-SCORES-PROMPT-VERSION-DISCRIMINATED) by reading a schema with no such gates.

**Authority:** This invariant. Code reviewers + the strict-grep gate below.

**Enforcement:**
1. NEW strict-grep CI script `.github/scripts/strict-grep/meta-orch-1009-consumer-trial-isolation.mjs`: fails CI if any file under `supabase/functions/_shared/`, `supabase/functions/discover-cards/`, `supabase/functions/generate-curated-experiences/`, or `supabase/functions/run-signal-scorer/` contains the literal string `place_intelligence_trial_runs`. Registered in `.github/workflows/strict-grep-mingla-business.yml` (or the equivalent consumer-side strict-grep workflow if one exists separately).
2. PR review checklist item: any new consumer edge function that wants AI scores reads from `place_pool.ai_signal_scores` via the existing helper pattern.

**Test that catches a regression:** the strict-grep gate fires on any PR that imports trial table access into a consumer file. Plus a one-time SQL audit script run at Sub-B close documenting ZERO production reads of the trial table (recorded in close report).

**Established:** 2026-05-30 by META-ORCH-1009 Sub-B CLOSE.

**Related invariants:** I-AI-SIGNAL-SCORES-COLUMN-SOLE-OWNER · I-AI-SIGNAL-SCORES-SHAPE-CONTRACT · I-AI-SIGNAL-SCORES-PROMPT-VERSION-DISCRIMINATED · I-TRIAL-OUTPUT-NEVER-FEEDS-RANKING (RETRACTED).
```

**NEW invariant: `I-COLLAB-DECK-DETERMINISM-PRESERVED-UNDER-AI-BLEND` ACTIVE.**

Add immediately after the consumer-reads invariant above. Body:

```
### I-COLLAB-DECK-DETERMINISM-PRESERVED-UNDER-AI-BLEND (ACTIVE post META-ORCH-1009 Sub-B CLOSE 2026-05-30)

**Statement:** The introduction of `place_pool.ai_signal_scores` reads + blending + veto into the consumer ranker (Sub-B) preserves the collab-deck determinism contract `[[collab-deck-determinism-contract]]`. Specifically: the AI score for a given (place, signal) is a pure function of `place_pool.ai_signal_scores[signal_id]` at the time `run-signal-scorer` computes the blended `place_scores.score`. The blended score is then read by `query_servable_places_by_signal_intersection` (collab RPC) and produces an identical ordering for two requests in the same session V_n that observe the same `place_scores.score` set + the same `session_deck_cards` exclusion set + the same circles intersection. The blend MUST NOT introduce request-time randomness or request-time reads from `place_pool.ai_signal_scores` (those reads happen only at offline `run-signal-scorer` time).

**Rationale:** The deck-determinism contract requires that within a session version V_n, every participant sees the same card at the same position. The blended score lives in `place_scores.score` (offline-computed); the request-time RPC reads ONLY `place_scores.score` to ORDER BY — the AI score is never read at request time for ranking. The new `ai_reasoning` jsonb column returned by the RPC is INFORMATIONAL (rendered in expand-modal) and does NOT influence card ordering — it carries identical content for identical input rows, so it is also a pure function.

**Authority:** This invariant. Sub-B's signalScorer.computeScore (which writes the blend offline) + the unchanged collab RPC ordering clause `ORDER BY ps.score DESC, pp.review_count DESC NULLS LAST, pp.id ASC`.

**Enforcement:**
1. Deno test `supabase/functions/discover-cards/__tests__/collab_determinism_under_ai_blend.test.ts`: spins up a fake session, fixes `place_scores.score` + `session_deck_cards`, calls the positional shared-deck path twice, asserts identical card_id sequence.
2. Code review: any change to `signalScorer.computeScore` or to the collab RPC must mention this invariant.
3. Existing collab determinism Deno tests (the `orch_0909_adversarial.test.ts` family) continue to pass — Sub-B's change to `signalScorer` does not touch the RPC ordering clause.

**Test that catches a regression:** the new collab-determinism test above fails if the implementor accidentally pushes the AI read into the request-time RPC.

**Established:** 2026-05-30 by META-ORCH-1009 Sub-B CLOSE.

**Related invariants:** I-CONSUMER-READS-AI-SIGNAL-SCORES-NOT-TRIAL-TABLE · I-AI-SIGNAL-SCORES-COLUMN-SOLE-OWNER · `[[collab-deck-determinism-contract]]` memory rule.
```

### §3.5 Performance (LOCKED 🔒)

- **Offline blend cost.** `run-signal-scorer` already reads ~14,412 places × 16 signals = ~230K computeScore calls per full re-score. The added work per call is: (a) one JSONB key lookup `place.ai_signal_scores?.[signalId]`, (b) one string compare `aiEntry.prompt_version !== expectedVersion`, (c) one boolean check `aiEntry.inappropriate_for === true`, (d) two arithmetic ops for the blend. Estimated added CPU per call: <1µs. Estimated added wall time for a full sweep: <250 ms — negligible against the current ~10-minute full-sweep cost dominated by DB I/O.
- **Online RPC cost.** Adding two columns to the RPC return increases the row payload by ~250 bytes per row (typical reasoning is 100–250 chars) × ~50 rows per query = ~12 KB per response. Negligible against today's ~80 KB typical response. JSONB `->` and `->>` are O(1) on the indexed shape (GIN with `jsonb_path_ops` per Sub-A); per-row added time <10 µs.
- **Mobile-side cost.** One extra string per card in the React Query cache. Negligible.
- **Acceptance threshold:** SLA target is +50 ms p95 deck-fetch latency budget; expected actual added latency <5 ms p95. Implementor MUST run a micro-bench on the staging branch comparing pre-Sub-B vs post-Sub-B p95 deck latency over 100 sequential fetches per surface; if the regression exceeds +50 ms p95, the implementor MUST either materialize the reasoning into `place_scores.contributions` (then drop the RPC column read) OR cache the JSONB lookup in a session-scoped Deno isolate map.

---

## §4 Acceptance tests per work item

### §4.1 signalScorer Deno tests (6 tests, NEW file)

`supabase/functions/_shared/__tests__/signalScorer.blend.test.ts`:

1. **Test 1 — AI present + version-matched + blend.** `aiEntry = {score_0_to_100: 80, prompt_version: 'v4', ...}`, `ruleScore = 100` (rule_normalized = 50), `weight = 0.6`. Expected blended-normalized = `0.4 * 50 + 0.6 * 80 = 68`; expected rescaled = `136`. Assert returned `score === 136` ± 0.01, `ai_blended.weight_used === 0.6`.
2. **Test 2 — AI present + version-matched + veto.** `aiEntry = {inappropriate_for: true, reasoning: "wrong vibe", prompt_version: 'v4', ...}`. Assert returned `score === null`, `vetoed.reason === 'inappropriate_for'`, `vetoed.ai_reasoning === "wrong vibe"`.
3. **Test 3 — AI absent (null `ai_signal_scores`).** Assert returned `score === ruleScore` (unchanged), no `ai_blended` field.
4. **Test 4 — AI present + prompt_version mismatch.** `aiEntry.prompt_version = 'v3'`, `config.expected_prompt_version = 'v4'`. Assert returned `score === ruleScore`, no `ai_blended` field (this is the I-AI-SIGNAL-SCORES-PROMPT-VERSION-DISCRIMINATED enforcement test).
5. **Test 5 — `ai_blend_weight = 0` (rule-only override).** `aiEntry` present + version-matched, `config.ai_blend_weight = 0`. Assert returned `score === ruleScore` (rescaled rule_normalized, since (1-0)*rule_normalized + 0*ai = rule_normalized).
6. **Test 6 — `expected_prompt_version` absent → default used.** `config.expected_prompt_version` undefined, `aiEntry.prompt_version = 'v4'` (the default). Assert AI IS blended.

### §4.2 discover-cards + generate-curated-experiences passthrough tests (2 tests, NEW files)

- `discover-cards/__tests__/ai_reasoning_passthrough.test.ts`: mock the RPC to return one row with `ai_reasoning = {reasoning: "test reasoning", score_0_to_100: 80, ...}` for `signal_id = 'romantic'`. Call `transformServablePlaceToCard`. Assert the returned card has `ai_reasoning_by_signal.romantic === "test reasoning"`.
- `generate-curated-experiences/__tests__/ai_reasoning_passthrough.test.ts`: same pattern via `fetchSinglesForSignalRank` mock + `buildCardStop`. Assert the returned stop has `aiReasoningBySignal.romantic === "test reasoning"`.

### §4.3 Migration probe (NEW SQL file)

`supabase/migrations/__tests__/meta_orch_1009_sub_b_rpc_reasoning_return.test.sql`:

```sql
-- Probe 1: confirm both RPCs return the two new columns.
SELECT column_name FROM information_schema._pg_expandarray(...);  -- or pg_get_function_result + parse
-- assert 'ai_reasoning' AND 'ai_score_raw' in the result column list of both functions.

-- Probe 2: pick a place known to have ai_signal_scores populated (e.g. Kanki Japanese, id 67986dd6-...).
-- Call the RPC for signal_id='romantic'. Assert the returned row has ai_reasoning IS NOT NULL
-- and ai_reasoning->>'reasoning' starts with the expected substring 'The communal hibachi tables'
-- (or any non-empty string — the substring match is a regression guard).
```

### §4.4 Per-surface acceptance tests (3 surfaces, Maestro flows)

The 3-surface coverage requirement maps to 3 separate Maestro flow specs. Each lives under `tooling/maestro/META-ORCH-1009/`. Implementor writes the YAML; tester executes.

- **Surface 1 — Home solo:** `META-ORCH-1009_S1_home_solo_reasoning_renders.yaml`
  - Launch app, navigate to Home swipeable deck, ensure at least 1 card is loaded.
  - Tap card to expand → assert text contains "Why we picked this for you".
  - Assert the body section is non-empty (>10 chars).
  - SUCCESS criterion: above two assertions pass on iOS sim AND Android emu.

- **Surface 2 — Collab (group chat):** `META-ORCH-1009_S2_collab_reasoning_renders.yaml`
  - Pre-condition: a test session with ≥2 accepted participants + GPS-resolved circles in a city with full Gemini coverage (e.g. Raleigh — pick a known evaluated `place_pool.id`).
  - Open the group chat → tap the collab-deck → expand the first card.
  - Assert "Why we picked this for you" + reasoning body present, identical to what the Home surface renders for the same place (cross-surface visual parity).
  - SUCCESS criterion: above assertions + the visual match.
  - **Determinism sub-test (Deno):** in `discover-cards/__tests__/collab_determinism_under_ai_blend.test.ts`, fix a session state + place_scores set, call the positional RPC twice, assert identical card_id sequence (I-COLLAB-DECK-DETERMINISM-PRESERVED-UNDER-AI-BLEND enforcement).

- **Surface 3 — Paired-friend public profile:** `META-ORCH-1009_S3_friend_profile_reasoning_renders.yaml`
  - Pre-condition: logged-in user has at least one paired friend (use a fixture).
  - Navigate to `ViewFriendProfileScreen` → scroll to the `PersonHolidayView` card grid → tap a holiday card → modal opens.
  - Assert "Why we picked this for you" + reasoning body present in the modal.
  - SUCCESS criterion: assertions pass; verifies the `holidayCardToExpandedCardData` mapper carries `aiReasoningBySignal` through (the only change on this surface).

### §4.5 Performance micro-bench (NEW gate)

Implementor runs `tooling/bench/META-ORCH-1009-deck-latency.mjs` (NEW file, ~50 lines):
- 100 sequential fetches against staging discover-cards for a known category.
- Reports p50, p95, p99 latency.
- Run pre-Sub-B (against `main`) and post-Sub-B (against branch). Compare.
- Acceptance: p95 regression ≤ +50 ms.

---

## §5 Invariants (summary — full bodies in §3.4)

| ID | Status before Sub-B | Status after Sub-B | Authority |
|---|---|---|---|
| `I-AI-SIGNAL-SCORES-PROMPT-VERSION-DISCRIMINATED` | DRAFT | ACTIVE | `signalScorer.ts` `computeScore` |
| `I-CONSUMER-READS-AI-SIGNAL-SCORES-NOT-TRIAL-TABLE` | NOT YET WRITTEN (Sub-A flagged) | ACTIVE (NEW) | Strict-grep CI gate + all 5 consumer files |
| `I-COLLAB-DECK-DETERMINISM-PRESERVED-UNDER-AI-BLEND` | NOT YET WRITTEN | ACTIVE (NEW) | Deno test + unchanged collab RPC ordering |

---

## §6 Out of scope

- **Multi-stop brand-curated experiences** (Sub-F — operator deferred per META-ORCH-1009 INTAKE).
- **Business-app supply-side** (Sub-E — separate dispatch).
- **Refresh cron + admin re-eval button** (Sub-D — separate dispatch).
- **Sub-C Gemini coverage backfill** — operator-driven in parallel; Sub-B works on whatever coverage is current at deploy time. The blend gracefully degrades to rule-only when AI is absent.
- **Embeddings / semantic intent matching** (research §5 Option C — gated behind Sub-B + 2–4 weeks of swipe telemetry per research §9 Q1).
- **Two-tower personalization** (research §5 Option D — way later).
- **Pre-rendered curated card inventory** (research §5 Option E — operationally orthogonal).
- **Any new external API calls** — Sub-B is pure DB-read.
- **Schema migrations on `place_pool` or `place_scores`** — Sub-B only edits two RPCs; no column-level DDL.
- **Localization of "Why we picked this for you"** — English-only at v1; follow-up locale ORCH owns translation.
- **Visual/design polish of the reasoning section** — neutral styling at implementor pass; designer-skill dispatch can refine later.
- **Surfacing the `inappropriate_for` veto count to admins** — number tracked in `run-signal-scorer` summary log but no admin UI; Sub-D territory.
- **Photo-aesthetic / NIMA improvements** (research §7) — separate ORCH if pursued.
- **Re-tuning per-signal `filterMin` thresholds** in `CATEGORY_TO_SIGNAL` (`discover-cards`) — preserving the existing thresholds is a LOAD-BEARING choice (see §7 Decision 1).

---

## §7 Decisions (judgment calls — operator-flag if any need review)

### Decision 1 — Blend at write-time (offline `run-signal-scorer`), not at request-time.
**Choice:** Blend lives in `signalScorer.computeScore` which `run-signal-scorer` calls offline; the blended value is stored in `place_scores.score`. Request-time RPCs continue to ORDER BY the stored score with NO blend logic at the hot path.
**Why:** (a) Zero hot-path latency added. (b) Preserves the collab determinism contract trivially (the RPC is unchanged). (c) Preserves the existing `CATEGORY_TO_SIGNAL.filterMin` thresholds — by re-scaling the blended-normalized value back to the original [0, 200] rule-scale, the existing 100/120/80 filterMin values keep working without coordinated re-tuning. (d) Veto-via-NULL piggybacks on the existing `WHERE ps.score >= p_filter_min` filter — zero RPC change for vetoes.
**Risk:** `run-signal-scorer` must be re-run after a Gemini Q2 coverage bump (Sub-C) to materialize the new AI scores into `place_scores`. Sub-D will own the cron that does this; until Sub-D ships, operator triggers `run-signal-scorer` manually after Sub-C completes.
**Flag for operator:** confirm OK with the staleness window between Sub-B merge + the first manual `run-signal-scorer` re-sweep (≤24h typically). Alternative would be to compute the blend at RPC time inside SQL (CASE expression on `ai_signal_scores ->> 'prompt_version'`) — rejected because it requires hot-path JSONB key lookups + breaks the existing filterMin thresholds.

### Decision 2 — Card payload shape: per-signal map (`Record<string, string>`), not single-string.
**Choice:** `ai_reasoning_by_signal: Record<string, string>` keyed by signal_id.
**Why:** Multi-chip user selection means a single card can surface under multiple signals. The expand-modal can render whichever signal the user tapped under (or the dominant one — see §3.3 algorithm). Future Sub can expose multiple reasonings if product wants to show "matches you for both romantic AND scenic".
**Flag for operator:** OK to ship as Record<string,string>? Alternative: single string. Recommendation: Record.

### Decision 3 — Veto semantics: NULL `place_scores.score`, not `-Infinity` or a separate boolean column.
**Choice:** Vetoed (place, signal) gets `place_scores.score = NULL`.
**Why:** (a) Existing RPC filter `WHERE ps.score >= p_filter_min` already excludes NULLs (PG NULL semantics). (b) No DDL needed. (c) Re-running `run-signal-scorer` after Gemini re-eval naturally restores the score if the veto reverses. (d) Admin inspector can still see the veto via `contributions._ai_vetoed: 1`.
**Risk:** A future query that SELECTs `place_scores.score` without the `>= filter_min` filter will see NULLs. NEW invariant could pin this; not adding one in Sub-B (premature).
**Flag for operator:** OK.

### Decision 4 — `ai_blend_weight` + `expected_prompt_version` storage: `signal_definition_versions.config` JSONB.
**Choice:** Two new JSONB keys on the existing config column. NO migration.
**Why:** Already JSONB. Per-signal-version means a v1.10.0 movies signal can have weight 0.4 while v1.4.0 brunch has 0.6 — operator can A/B-tune per-signal. Defaults applied in code if absent (`DEFAULT_AI_BLEND_WEIGHT = 0.6`, `DEFAULT_EXPECTED_PROMPT_VERSION = 'v4'`).
**Risk:** Schema-less. Mitigated by the SignalConfig TS interface + the new Deno tests.
**Flag for operator:** OK.

### Decision 5 — Per-surface reasoning rendering: shared `ExpandedCardModal` component.
**Choice:** Single shared modal renders reasoning identically on all 3 surfaces.
**Why:** Operator's North Star plus DRY. `[[collab-deck-lives-in-group-chat]]` already mandates Home is solo-only + collab is the second mount; ORCH-0997 reuses the same modal for the friend profile per `ViewFriendProfileScreen.tsx:817`. One change covers three surfaces.
**Flag for operator:** OK.

### Decision 6 — Render reasoning at v1 in expand-modal only (not on card front).
**Choice:** Per research §9 Q5 recommendation (i).
**Why:** Subtle launch. Validate read-rate via card-expand telemetry. Promote to card front later if data justifies.
**Flag for operator:** OK.

### Decision 7 — Backward-compat with existing scorer.test.ts: REQUIRED signalId arg + update existing tests.
**Choice:** Make the new third arg `signalId` REQUIRED. Update all ~20 existing scorer tests + the one production call site (`run-signal-scorer`).
**Why:** Optional arg risks silent bypass of the blend if someone forgets to pass it. Mechanical update is cheap; type system catches all call sites at compile time.
**Flag for operator:** OK.

### Decision 8 — Friend-profile carry-through for `aiReasoningBySignal` requires `HolidayCard` extension.
**Choice:** Add `aiReasoningBySignal?: Record<string, string>` to `HolidayCard` in `holidayCardsService.ts`.
**Why:** Friend profile fetches via `holidayCardsService`, which today doesn't pass through deck-shape fields. Implementor confirms the upstream `holiday-cards-list` (or equivalent) edge fn populates `aiReasoningBySignal` IF the source pipeline is `discover-cards` (most paired-friend cards). If the friend-profile cards come from a separate pipeline that doesn't yet call `discover-cards`, this becomes a Sub-F-like gap (flag for operator; the gap doesn't block Sub-B because the field is optional + missing reasoning silently degrades to "section not rendered").
**Flag for operator:** confirm during implementor pass whether `holiday-cards-list` is `discover-cards`-fed or independent. If independent, queue a follow-up Sub to extend it.

---

## §8 Completion gates

A Sub-B PR is shippable when ALL of the following are green:

1. All 6 new signalScorer Deno tests + all 2 new RPC-passthrough Deno tests + 1 new collab-determinism Deno test PASS.
2. All EXISTING `scorer.test.ts` tests PASS (with the call-site update to pass `signalId`).
3. The migration probe SQL returns the expected 2 new columns + 1 non-null reasoning row.
4. `npm test` (mobile jest) passes — the `ExpandedCardModal` reasoning section + the `holidayCardToExpandedCardData` carry-through have regression tests added (implementor pass).
5. The 3 Maestro flows pass on at least iOS sim AND Android emu for surfaces 1 + 2 + 3.
6. Performance micro-bench: p95 deck fetch regression ≤ +50 ms.
7. NEW strict-grep CI gate `meta-orch-1009-consumer-trial-isolation.mjs` is registered + green.
8. INVARIANT_REGISTRY.md edits: 1 DRAFT → ACTIVE flip + 2 NEW invariants ADDED (text per §3.4).
9. DEC-182 appended.
10. WORLD_MAP.md entry under `## META-ORCH-1009 Sub-B CLOSE` with all the above evidence + the close stanza.

---

## §9 Exhibits

### Exhibit A — Live `place_pool.ai_signal_scores` sample (Kanki Japanese, place_pool.id = `67986dd6-0b01-4f45-a23d-f69660204f96`)

(15 of 16 signals shown; abbreviated to 1 entry for spec readability — full 16-signal payload in the live DB probe.)

```json
{
  "romantic": {
    "model": "gemini-2.5-flash",
    "reasoning": "The communal hibachi tables and family-friendly atmosphere, often used for celebrations with children, are generally not conducive to an intimate or romantic date night.",
    "evaluated_at": "2026-05-08T08:09:50.856Z",
    "prompt_version": "v4",
    "score_0_to_100": 25,
    "inappropriate_for": false
  }
}
```

This row confirms: 6-key shape, prompt_version='v4', model='gemini-2.5-flash', reasoning is human-readable 1-sentence prose.

### Exhibit B — Veto-fires-cleanly example (ZENSHI Sushi, place_pool.id = `57648fc2-8fe1-4c90-89f3-227aa75dfb91`)

```json
{
  "movies": {
    "model": "gemini-2.5-flash",
    "reasoning": "This establishment is a sushi restaurant, not a cinema or movie-related venue.",
    "evaluated_at": "2026-05-06T17:31:30.300Z",
    "prompt_version": "v4",
    "score_0_to_100": 0,
    "inappropriate_for": true
  }
}
```

Post-Sub-B, when `run-signal-scorer` re-sweeps for `signal_id='movies'`, ZENSHI gets `place_scores.score = NULL` for `movies` and disappears from the Movies chip + the Movies & Theatre composite — even though it likely passes the existing rule filter (sushi restaurant doesn't match movie regex but the rule scorer might still produce a non-zero score from `serves_dinner`/`serves_lunch`/etc.).

---

**End of SPEC.**
