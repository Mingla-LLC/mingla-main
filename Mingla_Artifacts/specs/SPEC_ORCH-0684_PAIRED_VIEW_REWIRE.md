# SPEC — ORCH-0684 — Paired-Person View: Rewire to Signal-System (Mapper + Combos + Joint-Pair Personalization)

**Owner:** Implementor (single wave). **Cycle:** 1.
**Predecessor:** [reports/INVESTIGATION_ORCH-0684_PAIRED_VIEW_CARDS_NOT_REAL.md](Mingla_Artifacts/reports/INVESTIGATION_ORCH-0684_PAIRED_VIEW_CARDS_NOT_REAL.md) (REVIEW APPROVED).
**Dispatch:** [prompts/SPEC_ORCH-0684_PAIRED_VIEW_REWIRE.md](Mingla_Artifacts/prompts/SPEC_ORCH-0684_PAIRED_VIEW_REWIRE.md).
**Severity:** S0. **Type:** architecture-flaw + regression + data-integrity + ux.

---

## 0 · Pre-flight (implementor MUST verify before writing a single line)

These five gates must PASS before §3 begins. Each is a quick `grep` / `\d` / read. If any fails, halt and report.

| Gate | Verification | Pass criterion |
|------|--------------|----------------|
| **G-PF-1** | `grep -rn "PersonGridCard" app-mobile/src/` | If only matches are PersonHolidayView.tsx import (line 39, no `<PersonGridCard>` JSX) and PersonGridCard.tsx itself → orphan confirmed; safe to delete. If any other JSX usage → preserve file, only remove the dead import in PersonHolidayView. |
| **G-PF-2** | `grep -rn "usePersonHeroCards" app-mobile/src/` | If only matches are usePersonHeroCards.ts itself + holidayCardsService.ts type-only import → orphan confirmed; safe to delete. If any other mount → preserve. |
| **G-PF-3** | `\d saved_card` (Supabase MCP `execute_sql`) | Confirm columns: `(id, profile_id, experience_id TEXT, title, category, image_url, match_score, card_data JSONB, created_at)`. NOTE: table name is **singular** `saved_card`, not plural. |
| **G-PF-4** | `\d user_visits` | Confirm columns: `(id, user_id, experience_id TEXT, card_data JSONB, visited_at, source, created_at)` + paired-RLS policy "Paired users can view visits" exists. |
| **G-PF-5** | `\d pairings` | Confirm `(user_a_id UUID, user_b_id UUID, ...)` with RLS that allows either side to query the other. The new RPC's JOIN to determine "joint" save/visit relies on `(p_user_id, p_person_id)` ordering matching `(user_a_id, user_b_id)` OR the inverse — both directions must be checked in the query. |

Also confirm the absence of `paired_saves` table — pair-shared saves emerge from `saved_card` cross-user reads, not a dedicated table. This is documented honestly in §4.2.

---

## 1 · Executive summary (layman, 8 sentences)

Today the paired-person view (birthday hero + "Your Special Days" + "Upcoming Holidays") loads cards that look real but have no photos, no real names, no combos, and no personalization — because the translator was forked from the deleted `card_pool` shape and never rewired to read the new `place_pool` shape. This spec finishes the migration in one wave: **rewrites the mapper** to read actual `place_pool` fields (RC-1 fix), **brings combos back** with a per-holiday rule table (D-Q1), and **pushes joint-pair history into the database ranking** so a place either user has saved or visited bubbles up — a place you've both saved bubbles up the most (D-Q2 Option B). **Bilateral mode** turns on automatically when both users have enough preference data (D-Q4); the hidden toggle becomes a manual override. Custom holidays continue to use AI-derived sections from `useHolidayCategories` (D-Q3 — unchanged). Three pieces of dead code go away (D-Q5/Q6/Q7 housekeeping). The fix lives in one new database migration + one rewritten edge function + one new shared module + a small mobile prop-plumbing change. Solo Discover singles + the Discover curated deck remain untouched (regression-locked by the test matrix).

---

## 2 · Scope

In scope:
- **Edge function** `supabase/functions/get-person-hero-cards/index.ts` — full rewrite of `mapPoolCardToCard` + new combo branch + auto-bilateral + null-tier handling.
- **Database** new migration `supabase/migrations/20260501000001_orch_0684_person_hero_personalized.sql` — extends `query_person_hero_places_by_signal` to consume `p_user_id` + `p_person_id` and to project `distance_m`.
- **New shared module** `supabase/functions/_shared/personHeroComposition.ts` — the holiday composition rule table + `getCompositionForHolidayKey` resolver.
- **New shared module** `supabase/functions/_shared/curatedComboPlanner.ts` — extracted from `generate-curated-experiences` (extraction approach — see §3.2).
- **Mobile** `app-mobile/src/services/personHeroCardsService.ts` — widen `mode` type.
- **Mobile** `app-mobile/src/hooks/usePairedCards.ts` — plumb `mode`.
- **Mobile** `app-mobile/src/components/PersonHolidayView.tsx` — pass `bilateralMode` to CardRow → usePairedCards.
- **Cleanup** delete `usePersonHeroCards.ts` + `PersonGridCard.tsx` if G-PF-1/G-PF-2 confirm orphan + remove dead imports in `holidayCardsService.ts`.
- **CI** new gate `I-RPC-RETURN-SHAPE-MATCHES-CONSUMER` + `I-PERSON-HERO-RPC-USES-USER-PARAMS` + smoke test for `get-person-hero-cards` cards-have-content.

Non-goals (explicitly out of scope, deferred to ORCH discoveries):
- **D-fu-1:** Cross-surface mapper sweep (saved_card / map cards / board cards). Tracked as ORCH-0684.D-5.
- **D-fu-2:** Consolidating `INTENT_CATEGORY_MAP` + `CATEGORY_SLUG_TO_SIGNAL_ID` across edge fns. Tracked as ORCH-0684.D-6.
- **D-fu-3:** Audit of all `to_jsonb(*)` consumers across migrations. Tracked as ORCH-0684.D-fu.
- **D-fu-4:** Tuning combo composition table beyond the §3.4 starting weights. Telemetry-driven future work.
- **D-fu-5:** Tuning personalization boost weights beyond the §3.3 starting weights. Telemetry-driven future work.
- **D-fu-6:** Time-of-day / day-of-week ranking (Option C territory). Future ORCH-0687 candidate.
- **D-fu-7:** `PersonGridCard` design redesign — either delete (orphan) or leave alone (in-use), no in-between.
- **D-fu-8:** `useHolidayCategories` modification — D-Q3 binds it as-is.
- **D-fu-9:** Discover-cards transformer parity for `derivePriceTier(null)` fix — P3 ride-along, not blocking. Spec writer notes for follow-up.

Assumptions (must hold; if any fails, escalate before coding):
- `place_pool` rows that pass the three-gate filter (per ORCH-0668 + ORCH-0678 contract) DO have populated `name`, `stored_photo_urls`, `primary_type`, `address`, `lat`, `lng`. The bug is downstream translation, not data quality.
- `saved_card.experience_id` and `user_visits.experience_id` post-ORCH-0640 ch06 hold `place_pool.id::TEXT` for new rows. Older rows MAY hold legacy `googlePlaceId` strings. The RPC JOIN handles both via dual-condition matching (see §3.3).
- The combo planner in `generate-curated-experiences` is healthy (per ORCH-0677 closure Grade A) — extraction is mechanical, not redesign.
- ORCH-0668's perf foundation (`LANGUAGE sql STABLE`, deferred `to_jsonb` hydration, ~215 ms p95 at 11-signal Raleigh) holds after personalization JOINs are added. Budget < 500ms p95 must be re-verified.

---

## 3 · Per-layer specification

### 3.1 — User-bound decisions (verbatim from dispatch)

| Decision | Choice | Effect on spec |
|----------|--------|----------------|
| **D-Q1** Combo composition | Holiday-driven mix | §3.4 composition rule table; combo + singles per holiday |
| **D-Q2** Personalization depth | Option B — joint pair history | §3.3 RPC body extends with saved/visited boosts |
| **D-Q3** Custom holiday signals | Keep `useHolidayCategories` AI inference | No change at section-selection layer |
| **D-Q4** Bilateral mode | Default-on when both meet threshold | §3.5 auto-detect logic in edge fn |
| **D-Q5** Null priceTier | Suppress price line | Mapper emits `null`, UI hides price row |
| **D-Q6** PersonGridCard fate | Delete if orphan (G-PF-1) | Conditional delete at §6 step 12 |
| **D-Q7** usePersonHeroCards fate | Delete if orphan (G-PF-2) | Conditional delete at §6 step 12 |

### 3.2 — Combo planner extraction strategy

Spec adopts **dispatch option (b)**: extract the combo planner from `generate-curated-experiences/index.ts` into `supabase/functions/_shared/curatedComboPlanner.ts`. Rationale: avoids edge-fn-to-edge-fn HTTP round-trip and gives a single source of truth for combo composition.

The extracted module exports:

```ts
// supabase/functions/_shared/curatedComboPlanner.ts
export interface ComboAnchor {
  signalId: string;          // e.g. 'fine_dining'
  filterMin: number;         // signal-score threshold
}

export interface ComboPlanRequest {
  anchors: ComboAnchor[];    // 2-3 anchor categories per holiday composition
  rankSignalId: string;      // signal to rank by within the bbox (often equals anchors[0].signalId)
  lat: number;
  lng: number;
  radiusM: number;
  excludePlaceIds: string[];
  maxCombos: number;         // typically 1 for person-hero, larger for Discover curated
}

export interface PlannedCombo {
  id: string;                          // combo UUID, generated client-side
  cardType: 'curated';
  title: string;                       // human-readable, derived from anchors
  tagline: string | null;
  experienceType: string;              // 'romantic' | 'adventurous' | 'celebration' | etc.
  stops: number;                       // count of stopsData
  stopsData: Array<{                   // each stop hydrated from place_pool
    place_id: string;
    name: string;
    address: string | null;
    stored_photo_urls: string[];
    primary_type: string;
    lat: number;
    lng: number;
    rating: number | null;
    price_level: string | null;
  }>;
  totalPriceMin: number | null;
  totalPriceMax: number | null;
  estimatedDurationMinutes: number | null;
  categories: string[];                // category names per stop
  lat: number | null;                  // first-stop lat
  lng: number | null;                  // first-stop lng
}

export async function planCombos(
  adminClient: SupabaseClient,
  req: ComboPlanRequest,
): Promise<{ combos: PlannedCombo[]; emptyReason: string | null }> {
  // Body extracted verbatim from the working logic in
  // generate-curated-experiences/index.ts. Implementor copies the planner
  // function + its helpers (failedAnchorIds gating from ORCH-0677,
  // reverse-anchor logic, photo-gate filtering). NO behavior change.
}
```

The `generate-curated-experiences` edge fn must be refactored to import from `_shared/curatedComboPlanner` instead of defining the planner inline. Behavior must be byte-identical (regression-locked by test T-19 + T-20 in §7).

### 3.3 — Database: new RPC body for `query_person_hero_places_by_signal`

**Migration file:** `supabase/migrations/20260501000001_orch_0684_person_hero_personalized.sql`

**Full SQL (copy-paste-ready):**

```sql
-- ORCH-0684 — Extend query_person_hero_places_by_signal with joint-pair-history
-- personalization (D-Q2 Option B). Preserves ORCH-0668 perf foundation
-- (LANGUAGE sql STABLE, deferred to_jsonb hydration). Adds JOINs to saved_card +
-- user_visits filtered to (p_user_id, p_person_id) for boost computation.
-- Also projects distance_m so the edge-fn mapper has it (ORCH-0684 RC-1 fix).
--
-- INVARIANTS PRESERVED:
--   I-THREE-GATE-SERVING (DEC-053): is_servable + photo gate enforced verbatim.
--   I-PLACE-ID-CONTRACT: place JSONB carries place_pool.id::TEXT; experience_id
--     JOINs handle dual-shape (place_pool.id::TEXT OR legacy google_place_id).
--   I-POOL-ONLY-SERVING: reads place_pool + place_scores + saved_card +
--     user_visits + pairings. Zero card_pool refs.
--   I-RPC-LANGUAGE-SQL-FOR-HOT-PATH: this function remains LANGUAGE sql STABLE.
--
-- INVARIANTS REGISTERED:
--   I-PERSON-HERO-RPC-USES-USER-PARAMS: function body must reference
--     p_user_id AND p_person_id (not just declare). CI gate at
--     scripts/ci-check-invariants.sh.
--
-- BOOST WEIGHTS (D-Q2 Option B starting values; implementor MUST NOT change
-- without spec amendment):
--   viewer_save_boost  = 0.05   (modest — viewer saw it, may already be familiar)
--   paired_save_boost  = 0.10   (paired user saved it — relevant signal)
--   joint_save_boost   = 0.25   (BOTH saved → strong signal of mutual interest)
--   viewer_visit_boost = 0.05   (viewer visited — context-aware)
--   paired_visit_boost = 0.10   (paired user visited — places they liked)
--   joint_visit_boost  = 0.30   (visited TOGETHER → strongest signal)
-- Rationale: visits > saves (proven engagement), joint > individual (pair
-- relevance), boosts sum max ~0.85 vs base signal_score range typically 0.4-1.0,
-- meaning a perfectly-pair-relevant low-score place can outrank a high-score
-- unfamiliar place — desired behavior per D-Q2.

BEGIN;

CREATE OR REPLACE FUNCTION public.query_person_hero_places_by_signal(
  p_user_id              UUID,
  p_person_id            UUID,
  p_lat                  DOUBLE PRECISION,
  p_lng                  DOUBLE PRECISION,
  p_signal_ids           TEXT[],
  p_exclude_place_ids    UUID[]  DEFAULT '{}'::UUID[],
  p_initial_radius_m     INT     DEFAULT 15000,
  p_max_radius_m         INT     DEFAULT 100000,
  p_per_signal_limit     INT     DEFAULT 3,
  p_total_limit          INT     DEFAULT 9
)
RETURNS TABLE (
  place            JSONB,
  signal_id        TEXT,
  signal_score     NUMERIC,
  total_available  BIGINT,
  distance_m       DOUBLE PRECISION,   -- ORCH-0684: projected for mapper
  personalization_boost NUMERIC,        -- ORCH-0684: surfaced for telemetry
  boost_reasons    TEXT[]               -- ORCH-0684: debug array, e.g. ['joint_save','paired_visit']
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  -- ═══════════════════════════════════════════════════════════════════════
  -- ORCH-0684: pool-only progressive-radius hero RPC with joint-pair
  -- personalization. Three-gate serving preserved verbatim from ORCH-0668.
  -- Personalization is a WHERE-clause-neutral score adjustment — places that
  -- fail the gates never appear, regardless of boost. ORDER BY tiebreaks on
  -- (band_idx ASC, signal_score+boost DESC) so geographic preference still
  -- wins, but within a band the most pair-relevant places rise.
  -- ═══════════════════════════════════════════════════════════════════════
  WITH
  gate_passing AS (
    SELECT
      pp.id AS place_id,
      pp.google_place_id,
      6371000.0 * 2.0 * ASIN(SQRT(
        POWER(SIN(RADIANS(pp.lat - p_lat) / 2.0), 2) +
        COS(RADIANS(p_lat)) * COS(RADIANS(pp.lat)) *
        POWER(SIN(RADIANS(pp.lng - p_lng) / 2.0), 2)
      )) AS distance_m
    FROM public.place_pool pp
    WHERE pp.is_active = true
      AND pp.is_servable = true
      AND pp.stored_photo_urls IS NOT NULL
      AND array_length(pp.stored_photo_urls, 1) > 0
      AND pp.stored_photo_urls <> ARRAY['__backfill_failed__']::text[]
      AND NOT (pp.id = ANY(p_exclude_place_ids))
  ),
  within_max AS (
    SELECT * FROM gate_passing WHERE distance_m <= p_max_radius_m
  ),
  deduped AS (
    SELECT DISTINCT ON (w.place_id)
      w.place_id,
      w.google_place_id,
      w.distance_m,
      ps.signal_id,
      ps.score AS signal_score
    FROM within_max w
    JOIN public.place_scores ps
      ON ps.place_id = w.place_id
     AND ps.signal_id = ANY(p_signal_ids)
    ORDER BY w.place_id, ps.score DESC
  ),
  -- ─── Personalization layer (D-Q2 Option B) ──────────────────────────
  -- saved_card.experience_id is TEXT and may hold either place_pool.id::TEXT
  -- (post-ORCH-0640) or google_place_id (legacy rows). Match both shapes.
  -- p_user_id is the viewer; p_person_id is the paired user.
  saves AS (
    SELECT
      d.place_id,
      BOOL_OR(sc.profile_id = p_user_id)   AS viewer_saved,
      BOOL_OR(sc.profile_id = p_person_id) AS paired_saved
    FROM deduped d
    LEFT JOIN public.saved_card sc
      ON  sc.profile_id IN (p_user_id, p_person_id)
      AND (sc.experience_id = d.place_id::TEXT
           OR sc.experience_id = d.google_place_id)
    GROUP BY d.place_id
  ),
  visits AS (
    SELECT
      d.place_id,
      BOOL_OR(uv.user_id = p_user_id)   AS viewer_visited,
      BOOL_OR(uv.user_id = p_person_id) AS paired_visited
    FROM deduped d
    LEFT JOIN public.user_visits uv
      ON  uv.user_id IN (p_user_id, p_person_id)
      AND (uv.experience_id = d.place_id::TEXT
           OR uv.experience_id = d.google_place_id)
    GROUP BY d.place_id
  ),
  boosted AS (
    SELECT
      d.place_id,
      d.signal_id,
      d.signal_score,
      d.distance_m,
      -- Boost computation per D-Q2 Option B:
      (CASE
         WHEN COALESCE(s.viewer_saved, false) AND COALESCE(s.paired_saved, false) THEN 0.25
         WHEN COALESCE(s.paired_saved, false) THEN 0.10
         WHEN COALESCE(s.viewer_saved, false) THEN 0.05
         ELSE 0.0
       END
       +
       CASE
         WHEN COALESCE(v.viewer_visited, false) AND COALESCE(v.paired_visited, false) THEN 0.30
         WHEN COALESCE(v.paired_visited, false) THEN 0.10
         WHEN COALESCE(v.viewer_visited, false) THEN 0.05
         ELSE 0.0
       END
      ) AS personalization_boost,
      -- Debug array of which boosts fired (telemetry):
      ARRAY_REMOVE(ARRAY[
        CASE WHEN COALESCE(s.viewer_saved, false) AND COALESCE(s.paired_saved, false) THEN 'joint_save' END,
        CASE WHEN COALESCE(s.paired_saved, false) AND NOT COALESCE(s.viewer_saved, false) THEN 'paired_save' END,
        CASE WHEN COALESCE(s.viewer_saved, false) AND NOT COALESCE(s.paired_saved, false) THEN 'viewer_save' END,
        CASE WHEN COALESCE(v.viewer_visited, false) AND COALESCE(v.paired_visited, false) THEN 'joint_visit' END,
        CASE WHEN COALESCE(v.paired_visited, false) AND NOT COALESCE(v.viewer_visited, false) THEN 'paired_visit' END,
        CASE WHEN COALESCE(v.viewer_visited, false) AND NOT COALESCE(v.paired_visited, false) THEN 'viewer_visit' END
      ], NULL) AS boost_reasons
    FROM deduped d
    LEFT JOIN saves s  ON s.place_id = d.place_id
    LEFT JOIN visits v ON v.place_id = d.place_id
  ),
  ranked AS (
    SELECT
      b.place_id,
      b.signal_id,
      b.signal_score,
      b.distance_m,
      b.personalization_boost,
      b.boost_reasons,
      CASE
        WHEN b.distance_m <= LEAST(p_initial_radius_m, p_max_radius_m)::DOUBLE PRECISION       THEN 1
        WHEN b.distance_m <= LEAST((p_initial_radius_m * 3) / 2, p_max_radius_m)::DOUBLE PRECISION THEN 2
        WHEN b.distance_m <= LEAST((p_initial_radius_m * 9) / 4, p_max_radius_m)::DOUBLE PRECISION THEN 3
        WHEN b.distance_m <= LEAST((p_initial_radius_m * 27) / 8, p_max_radius_m)::DOUBLE PRECISION THEN 4
        WHEN b.distance_m <= LEAST((p_initial_radius_m * 81) / 16, p_max_radius_m)::DOUBLE PRECISION THEN 5
        ELSE 6
      END AS band_idx,
      COUNT(*) OVER () AS total_count
    FROM boosted b
  ),
  top_n AS (
    SELECT *
    FROM ranked
    ORDER BY band_idx ASC, (signal_score + personalization_boost) DESC
    LIMIT p_total_limit
  )
  SELECT
    to_jsonb(pp.*) AS place,
    t.signal_id,
    t.signal_score,
    t.total_count                AS total_available,
    t.distance_m,
    t.personalization_boost,
    t.boost_reasons
  FROM top_n t
  JOIN public.place_pool pp ON pp.id = t.place_id
  ORDER BY t.band_idx ASC, (t.signal_score + t.personalization_boost) DESC;
$function$;

REVOKE EXECUTE ON FUNCTION public.query_person_hero_places_by_signal(
  UUID, UUID, DOUBLE PRECISION, DOUBLE PRECISION, TEXT[], UUID[], INT, INT, INT, INT
) FROM public, anon;

GRANT EXECUTE ON FUNCTION public.query_person_hero_places_by_signal(
  UUID, UUID, DOUBLE PRECISION, DOUBLE PRECISION, TEXT[], UUID[], INT, INT, INT, INT
) TO authenticated, service_role;

COMMENT ON FUNCTION public.query_person_hero_places_by_signal IS
  'ORCH-0684 (supersedes ORCH-0668): pool-only progressive-radius hero RPC,
   LANGUAGE sql STABLE, with D-Q2 Option B joint-pair-history personalization.
   Enforces I-THREE-GATE-SERVING. Projects distance_m + personalization_boost +
   boost_reasons for telemetry. Boost weights documented inline; tuning is a
   separate ORCH. See specs/SPEC_ORCH-0684_PAIRED_VIEW_REWIRE.md.';

COMMIT;

-- ROLLBACK: re-apply 20260428000001_orch_0668_person_hero_rpc_sql_rewrite.sql verbatim.
-- That migration is CREATE OR REPLACE and will replace this body. Verify rollback
-- by repeating perf test: 11-signal Raleigh should return < 250 ms with no
-- distance_m/personalization_boost/boost_reasons columns in projection.
```

**Perf budget enforcement:** The implementor MUST capture `EXPLAIN (ANALYZE, BUFFERS)` for an 11-signal Raleigh-class call (`p_user_id` populated, `p_person_id` populated, both with at least one row in `saved_card` + `user_visits`) and include the output in the implementation report. Budget: < 500ms p95 (warm). If exceeded, the implementor halts and proposes either denormalized boost columns on `place_pool` or a cache table — does NOT regress to plpgsql.

### 3.4 — Combo composition rule table

**File:** `supabase/functions/_shared/personHeroComposition.ts`

```ts
// ORCH-0684 D-Q1 — Holiday-driven composition rules for paired-person CardRows.
// Each rule names the combo's anchor signals, the rank signal, the singles
// section bias, and the singles count range. The edge fn looks up the rule by
// holidayKey + isCustomHoliday + (for custom) yearsElapsed.

export interface CompositionRule {
  holidayKey: string;                       // 'birthday' | STANDARD_HOLIDAYS.id | 'custom_default' | 'anniversary_default'
  comboAnchors: string[];                   // signal IDs for the combo planner anchors (1 combo per CardRow)
  comboRankSignal: string;                  // signal to rank combos by within bbox
  comboCount: 0 | 1;                        // 0 = singles-only fallback; 1 = include 1 curated combo
  singlesSectionBias: string[];             // signal IDs to bias singles toward
  singlesMin: number;                       // minimum singles to include (after combo)
  singlesMax: number;                       // maximum singles to include (after combo)
  experienceType: string;                   // labels the combo: 'celebration' | 'romantic' | 'adventurous' | etc.
}

// Standard rules — keyed on holidayKey
export const COMPOSITION_RULES: Record<string, CompositionRule> = {
  birthday: {
    holidayKey: 'birthday',
    comboAnchors: ['play', 'fine_dining', 'drinks'],
    comboRankSignal: 'play',
    comboCount: 1,
    singlesSectionBias: ['icebreakers', 'drinks', 'nature', 'fine_dining', 'play', 'creative_arts', 'movies'],
    singlesMin: 5,
    singlesMax: 8,
    experienceType: 'celebration',
  },
  valentines_day: {
    holidayKey: 'valentines_day',
    comboAnchors: ['fine_dining', 'drinks', 'creative_arts'],
    comboRankSignal: 'fine_dining',
    comboCount: 1,
    singlesSectionBias: ['fine_dining', 'drinks', 'icebreakers', 'flowers'],
    singlesMin: 4,
    singlesMax: 6,
    experienceType: 'romantic',
  },
  mothers_day: {
    holidayKey: 'mothers_day',
    comboAnchors: ['brunch', 'nature'],
    comboRankSignal: 'brunch',
    comboCount: 1,
    singlesSectionBias: ['fine_dining', 'brunch', 'flowers', 'creative_arts'],
    singlesMin: 4,
    singlesMax: 6,
    experienceType: 'celebration',
  },
  fathers_day: {
    holidayKey: 'fathers_day',
    comboAnchors: ['play', 'fine_dining'],
    comboRankSignal: 'play',
    comboCount: 1,
    singlesSectionBias: ['play', 'fine_dining', 'drinks', 'casual_food'],
    singlesMin: 4,
    singlesMax: 6,
    experienceType: 'celebration',
  },
  // For all other STANDARD_HOLIDAYS not listed above, the resolver derives
  // a rule from the holiday's `sections` config in app-mobile/src/constants/holidays.ts
  // (see getCompositionForHolidayKey below).
};

// Default for custom holidays without anniversary semantics
export const CUSTOM_HOLIDAY_DEFAULT: CompositionRule = {
  holidayKey: 'custom_default',
  comboAnchors: [],          // filled at runtime from useHolidayCategories AI sections
  comboRankSignal: '',       // filled at runtime
  comboCount: 1,
  singlesSectionBias: [],    // filled at runtime
  singlesMin: 4,
  singlesMax: 6,
  experienceType: 'curated',
};

// Default for custom holidays with year > 1 (anniversary)
export const ANNIVERSARY_DEFAULT: CompositionRule = {
  holidayKey: 'anniversary_default',
  comboAnchors: ['fine_dining', 'drinks', 'creative_arts'],
  comboRankSignal: 'fine_dining',
  comboCount: 1,
  singlesSectionBias: [],    // filled at runtime from useHolidayCategories AI sections
  singlesMin: 4,
  singlesMax: 6,
  experienceType: 'romantic',
};

// Generic fallback for STANDARD_HOLIDAYS not in COMPOSITION_RULES — derives
// from the holiday's section config. The edge fn passes the resolved sections
// (already an array of signal IDs, after INTENT_CATEGORY_MAP expansion) and
// this returns a composition rule biased toward those sections.
export function deriveCompositionFromSections(
  holidayKey: string,
  sectionSignals: string[],
): CompositionRule {
  if (sectionSignals.length === 0) {
    // Last-resort fallback: mimic DEFAULT_PERSON_SECTIONS.
    return {
      holidayKey,
      comboAnchors: ['fine_dining', 'play'],
      comboRankSignal: 'fine_dining',
      comboCount: 1,
      singlesSectionBias: ['fine_dining', 'play', 'movies', 'drinks', 'nature'],
      singlesMin: 4,
      singlesMax: 6,
      experienceType: 'curated',
    };
  }
  return {
    holidayKey,
    comboAnchors: sectionSignals.slice(0, Math.min(3, sectionSignals.length)),
    comboRankSignal: sectionSignals[0],
    comboCount: 1,
    singlesSectionBias: sectionSignals,
    singlesMin: 4,
    singlesMax: 6,
    experienceType: 'curated',
  };
}

export function getCompositionForHolidayKey(args: {
  holidayKey: string;          // e.g. 'birthday', 'valentines_day', 'custom_<uuid>'
  isCustomHoliday: boolean;
  yearsElapsed?: number;       // for custom holidays — anniversary if > 0
  resolvedSectionSignals: string[];  // signals already resolved from holiday.sections
                                     // (or from useHolidayCategories for custom)
}): CompositionRule {
  // 1. Built-in named rule
  if (COMPOSITION_RULES[args.holidayKey]) {
    return COMPOSITION_RULES[args.holidayKey];
  }
  // 2. Custom holiday — anniversary if yearsElapsed > 0
  if (args.isCustomHoliday && (args.yearsElapsed ?? 0) > 0) {
    return {
      ...ANNIVERSARY_DEFAULT,
      holidayKey: args.holidayKey,
      // Override singles bias from AI inference
      singlesSectionBias: args.resolvedSectionSignals.length > 0
        ? args.resolvedSectionSignals
        : ANNIVERSARY_DEFAULT.singlesSectionBias,
    };
  }
  // 3. Custom holiday — generic
  if (args.isCustomHoliday) {
    return {
      ...CUSTOM_HOLIDAY_DEFAULT,
      holidayKey: args.holidayKey,
      comboAnchors: args.resolvedSectionSignals.slice(0, Math.min(3, args.resolvedSectionSignals.length)),
      comboRankSignal: args.resolvedSectionSignals[0] ?? 'fine_dining',
      singlesSectionBias: args.resolvedSectionSignals,
    };
  }
  // 4. STANDARD_HOLIDAYS not in COMPOSITION_RULES — derive from section config
  return deriveCompositionFromSections(args.holidayKey, args.resolvedSectionSignals);
}

// Empty-state contract: caller MUST emit { emptyReason: 'no_viable_combo' }
// on the response when comboCount > 0 but planCombos returns zero combos,
// per ORCH-0677 emptyReason precedent.
export const COMBO_EMPTY_REASON = 'no_viable_combo' as const;
```

### 3.5 — Edge function rewrite

**File:** `supabase/functions/get-person-hero-cards/index.ts`

The full file is 786 lines today. The spec specifies the changes by section; the implementor produces a clean rewrite.

#### 3.5.1 — `mapPoolCardToCard` rewrite (RC-1 fix)

Replace the entire function (lines 79-114) with the following. This reads ACTUAL `place_pool` snake_case Google fields, projects honestly, and never fabricates:

```ts
import { mapPrimaryTypeToMinglaCategory, mapCategoryToSlug } from "../_shared/categoryPlaceTypes.ts";
import { mapPriceLevelToTier } from "../_shared/priceTiers.ts";
// (these helpers must exist or be created — verify in pre-flight)

interface PlacePoolRow {
  id: string;
  google_place_id: string | null;
  name: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  rating: number | null;
  review_count: number | null;
  price_level: string | null;
  opening_hours: { openNow?: boolean } | null;
  website: string | null;
  photos: unknown[] | null;
  stored_photo_urls: string[] | null;
  types: string[] | null;
  primary_type: string | null;
  description: string | null;
}

/**
 * ORCH-0684 RC-1 fix: Maps a place_pool JSONB row (snake_case Google shape)
 * to the mobile Card interface (camelCase). This replaces the legacy
 * mapPoolCardToCard which read deleted card_pool field names.
 *
 * NEVER FABRICATES (Constitution #9):
 *   - priceTier is null when place_pool.price_level is null
 *   - isOpenNow is null when opening_hours.openNow is undefined
 *   - category is "" only as a last-resort signal that primary_type didn't map
 *
 * Mirrors transformServablePlaceToCard's field decisions for cross-surface
 * consistency.
 */
function mapPlacePoolRowToCard(
  raw: PlacePoolRow,
  signalId: string,
  signalScore: number,
  distanceM: number,
): Card {
  const category = raw.primary_type
    ? mapPrimaryTypeToMinglaCategory(raw.primary_type, raw.types ?? [])
    : "";
  const categorySlug = category ? mapCategoryToSlug(category) : "";
  const imageUrl = (raw.stored_photo_urls && raw.stored_photo_urls.length > 0
                    && raw.stored_photo_urls[0] !== "__backfill_failed__")
    ? raw.stored_photo_urls[0]
    : null;
  const priceTier = raw.price_level ? mapPriceLevelToTier(raw.price_level) : null;
  const isOpenNow = (raw.opening_hours && typeof raw.opening_hours.openNow === "boolean")
    ? raw.opening_hours.openNow
    : null;

  return {
    id: raw.id,
    title: raw.name ?? "",          // empty if unknown — never "Unknown"
    category,
    categorySlug,
    imageUrl,
    rating: raw.rating ?? null,
    priceLevel: raw.price_level,
    address: raw.address ?? null,
    googlePlaceId: raw.google_place_id,
    lat: raw.lat,
    lng: raw.lng,
    priceTier,                       // null when unknown — UI hides price line
    description: raw.description ?? null,
    cardType: "single",
    tagline: null,                   // singles do not have a tagline
    stops: 0,
    stopsData: null,
    totalPriceMin: null,
    totalPriceMax: null,
    website: raw.website ?? null,
    estimatedDurationMinutes: null,
    experienceType: null,
    categories: null,
    shoppingList: null,
    // ORCH-0684 telemetry passthrough — not consumed by UI today
    isOpenNow,
    distanceM,
    signalId,
    signalScore,
  };
}
```

The `Card` interface (lines 29-54) must be extended to include the four new optional telemetry fields:

```ts
interface Card {
  // ... existing fields unchanged
  isOpenNow?: boolean | null;
  distanceM?: number;
  signalId?: string;
  signalScore?: number;
}
```

The mobile `HolidayCard` interface in `app-mobile/src/services/holidayCardsService.ts` should mirror these additions (optional, backwards-compatible).

#### 3.5.2 — Combo branch (RC-2 fix per D-Q1)

Replace lines 700-704 with:

```ts
// ORCH-0684 RC-2 fix: holiday-driven combo + singles mix per D-Q1.
// Composition rule lookup → optional curated combo → singles from RPC.

import { getCompositionForHolidayKey, COMBO_EMPTY_REASON } from "../_shared/personHeroComposition.ts";
import { planCombos } from "../_shared/curatedComboPlanner.ts";

const composition = getCompositionForHolidayKey({
  holidayKey,
  isCustomHoliday: !!isCustomHoliday,
  yearsElapsed: isCustomHoliday ? extractYearsElapsedFromHolidayKey(holidayKey) : undefined,
  resolvedSectionSignals: signalIds,   // already resolved upstream
});

// 1. Plan combo if composition.comboCount > 0
let combos: PlannedCombo[] = [];
let comboEmptyReason: string | null = null;
if (composition.comboCount > 0) {
  const radiusBand = { lat: location.latitude, lng: location.longitude, radiusM: maxRadius };
  const planResult = await planCombos(adminClient, {
    anchors: composition.comboAnchors.map((sig) => ({ signalId: sig, filterMin: 0.0 })),
    rankSignalId: composition.comboRankSignal,
    lat: location.latitude,
    lng: location.longitude,
    radiusM: maxRadius,
    excludePlaceIds: excludeUuids,
    maxCombos: composition.comboCount,
  });
  combos = planResult.combos;
  if (combos.length === 0) {
    comboEmptyReason = COMBO_EMPTY_REASON;
  }
}

// 2. Map RPC rows to single cards (new mapper)
const rows = rpcRows ?? [];
const singles: Card[] = rows.map((row) =>
  mapPlacePoolRowToCard(
    row.place as PlacePoolRow,
    row.signal_id,
    Number(row.signal_score),
    Number(row.distance_m),
  ),
);

// 3. Trim singles to composition.singlesMax (after combo)
const trimmedSingles = singles.slice(0, composition.singlesMax);

// 4. Compose final array: combo(s) first, then singles
let cards: Card[] = [
  ...combos.map(comboToCard),    // helper that maps PlannedCombo → Card with cardType:'curated'
  ...trimmedSingles,
];

// 5. Final dedup + price-tier filter (preserve existing logic at 707-735, but
// fix HF-4: cards with priceTier:null must NOT be dropped by priceTierFilter)
if (priceTierFilter && priceTierFilter.length > 0) {
  cards = cards.filter(
    (c) => c.cardType === "curated"
        || c.priceTier === null
        || priceTierFilter!.includes(c.priceTier),
  );
}

// 6. Response shape extension — emptyReason mirrors ORCH-0677 contract
const responseBody: { cards: Card[]; hasMore: boolean; summary?: { emptyReason: string } } = {
  cards,
  hasMore: totalAvailable > singles.length,
};
if (cards.length === 0 || comboEmptyReason) {
  responseBody.summary = {
    emptyReason: cards.length === 0 ? "no_viable_results" : comboEmptyReason!,
  };
}
return new Response(JSON.stringify(responseBody), { ... });
```

A helper `comboToCard(combo: PlannedCombo): Card` must be defined to map the planner output to the mobile Card shape with `cardType: "curated"`, `stopsData` populated, `tagline` derived from anchors, `experienceType` from composition rule.

A helper `extractYearsElapsedFromHolidayKey(key: string): number` parses `custom_<uuid>` keys against the customHolidays array (which the edge fn must also receive — see §3.6). For non-custom keys, returns 0.

#### 3.5.3 — Auto-bilateral mode detection (D-Q4)

Add to the personalization block (around lines 200-210), BEFORE the existing bilateral/custom/shuffle/default branches:

```ts
// ORCH-0684 D-Q4: Auto-bilateral mode detection.
// When mode === "default" and BOTH users have ≥10 swipe-equivalents in
// user_preference_learning, automatically promote to bilateral mode.
// User can force individual mode by sending mode === "individual".
let effectiveMode = mode ?? "default";
if (effectiveMode === "default" && usingPairedUser) {
  const PREF_THRESHOLD = 10;
  const [{ count: viewerCount }, { count: pairedCount }] = await Promise.all([
    adminClient.from("user_preference_learning")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("confidence", 0.15),
    adminClient.from("user_preference_learning")
      .select("id", { count: "exact", head: true })
      .eq("user_id", pairedUserId)
      .gte("confidence", 0.15),
  ]);
  if ((viewerCount ?? 0) >= PREF_THRESHOLD && (pairedCount ?? 0) >= PREF_THRESHOLD) {
    effectiveMode = "bilateral";
    console.log(`[get-person-hero-cards] auto-bilateral active for pair (${userId}, ${pairedUserId}) — viewer=${viewerCount}, paired=${pairedCount}`);
  }
}

const isBilateralMode = effectiveMode === "bilateral";
const isShuffleMode = effectiveMode === "shuffle";
// (rest of branches use effectiveMode instead of mode)
```

#### 3.5.4 — Request body widening (CF-3 fix)

Update `RequestBody` interface (line 16-27):

```ts
interface RequestBody {
  personId?: string;
  pairedUserId?: string;
  viewerUserId?: string;
  holidayKey: string;
  categorySlugs: string[];
  curatedExperienceType: string | null;
  location: { latitude: number; longitude: number };
  // ORCH-0684 D-Q4: widened from "default"|"shuffle"|"bilateral" to add explicit "individual"
  mode?: "default" | "shuffle" | "bilateral" | "individual";
  isCustomHoliday?: boolean;
  yearsElapsed?: number;          // ORCH-0684: passed by mobile for anniversary detection
  excludeCardIds?: string[];
}
```

#### 3.5.5 — Comment cleanup (Constitution #8)

- Delete line 75 docstring's `card_pool` reference; replace with the new docstring above.
- Delete the comment at line 725 (`// Pool-only: serve what card_pool RPC returned. No place_pool fallback.`) — outdated truth.
- Update line 738 comment to remove the implicit acknowledgment that the rename was incomplete (it now is).

### 3.6 — Mobile changes

#### 3.6.1 — `app-mobile/src/services/personHeroCardsService.ts`

Widen the `mode` parameter type and add `bilateralMode` plumbing:

```ts
export async function fetchPersonHeroCards(params: {
  pairedUserId: string;
  holidayKey: string;
  categorySlugs: string[];
  curatedExperienceType: string | null;
  location: { latitude: number; longitude: number };
  mode?: "default" | "shuffle" | "bilateral" | "individual";   // ORCH-0684: widened
  isCustomHoliday?: boolean;
  yearsElapsed?: number;                                        // ORCH-0684: new
  excludeCardIds?: string[];
}): Promise<HolidayCardsResponse> {
  // ... body unchanged except body.mode and body.yearsElapsed pass-through
}
```

#### 3.6.2 — `app-mobile/src/hooks/usePairedCards.ts`

Add `mode` and `isCustomHoliday` + `yearsElapsed` to `UsePairedCardsParams` and pass through:

```ts
interface UsePairedCardsParams {
  pairedUserId: string;
  holidayKey: string;
  location: { latitude: number; longitude: number };
  sections: HolidayCardSection[];
  excludeCardIds?: string[];
  mode?: "default" | "individual" | "bilateral";   // ORCH-0684: explicit user override
  isCustomHoliday?: boolean;                       // ORCH-0684
  yearsElapsed?: number;                           // ORCH-0684
}
```

The query key must include `mode` so individual/bilateral cache separately:

```ts
queryKey: params
  ? personCardKeys.paired(params.pairedUserId, params.holidayKey, locKey, params.mode ?? "default")
  : personCardKeys.all,
```

`personCardKeys.paired` factory in `queryKeys.ts` must be updated to accept the mode parameter (additive, backwards-compatible — old call sites passing 3 args still work via `mode = "default"` default).

#### 3.6.3 — `app-mobile/src/components/PersonHolidayView.tsx`

Plumb `bilateralMode` from PersonHolidayView state through CardRow → usePairedCards:

```tsx
// In PersonHolidayView (around line 704):
const [bilateralMode, setBilateralMode] = useState<"individual" | "bilateral" | "default">("default");

// Translate state → service mode:
//   "default" (auto-decide in edge fn) — used when user hasn't touched the toggle
//   "individual" (force off) — used when user explicitly chose individual
//   "bilateral" (force on) — used when user explicitly chose bilateral
```

When CardRow mounts, pass `bilateralMode` (or "default" if user hasn't interacted with the toggle):

```tsx
<CardRow
  pairedUserId={pairedUserId} holidayKey="birthday"
  sections={DEFAULT_PERSON_SECTIONS} location={location}
  fallbackCards={fallbackCards} onCardPress={onCardPress}
  travelMode={travelMode}
  excludeCardIds={[]}
  enabled={true}
  mode={bilateralMode}                          // ORCH-0684
  isCustomHoliday={false}
  onCardsLoaded={...}
/>
```

CardRow accepts `mode` + `isCustomHoliday` + `yearsElapsed` props and passes them to `usePairedCards`.

CompactCard (lines 247-334) must HIDE the price line when `priceRange === null` (D-Q5):

```tsx
{priceRange ? (
  <Text style={[styles.compactCardPrice, isCurated && styles.compactCardPriceCurated]}>
    {priceRange}
  </Text>
) : null}    {/* ORCH-0684 D-Q5: never render fabricated default */}
```

#### 3.6.4 — Cleanup

- If G-PF-1 confirms PersonGridCard.tsx orphan: `rm app-mobile/src/components/PersonGridCard.tsx` + remove import line in PersonHolidayView.tsx (line 39).
- If G-PF-2 confirms usePersonHeroCards.ts orphan: `rm app-mobile/src/hooks/usePersonHeroCards.ts`.
- `holidayCardsService.ts` (lines 1-13): delete the `supabase, supabaseUrl` re-imports per HF-2 / Constitution #8 (file's own ORCH-0573 backlog comment confirms intent).

### 3.7 — CI gates (regression prevention)

Append to `scripts/ci-check-invariants.sh`:

```bash
# ─── ORCH-0684: I-PERSON-HERO-RPC-USES-USER-PARAMS ────────────────────────
# query_person_hero_places_by_signal must reference both p_user_id and
# p_person_id in its body (not just declare). Catches future regressions
# where the personalization JOINs are accidentally removed.
echo "[invariants] Checking I-PERSON-HERO-RPC-USES-USER-PARAMS..."
PERSON_HERO_RPC_FILE=$(ls supabase/migrations/*orch_0684_person_hero_personalized.sql 2>/dev/null | tail -1)
if [ -z "$PERSON_HERO_RPC_FILE" ]; then
  echo "  WARN: ORCH-0684 migration file not found — gate inactive"
else
  # Body must reference p_user_id outside the parameter declaration
  USER_ID_REFS=$(grep -c "p_user_id" "$PERSON_HERO_RPC_FILE" || true)
  PERSON_ID_REFS=$(grep -c "p_person_id" "$PERSON_HERO_RPC_FILE" || true)
  # ≥3 references each: declaration + at least 2 body uses (saves+visits JOINs)
  if [ "$USER_ID_REFS" -lt 3 ] || [ "$PERSON_ID_REFS" -lt 3 ]; then
    echo "  FAIL: $PERSON_HERO_RPC_FILE has $USER_ID_REFS p_user_id refs and $PERSON_ID_REFS p_person_id refs (need ≥3 each)"
    EXIT_CODE=1
  else
    echo "  PASS"
  fi
fi

# ─── ORCH-0684: I-RPC-RETURN-SHAPE-MATCHES-CONSUMER ───────────────────────
# get-person-hero-cards mapper must read fields that exist on place_pool.
# Static check: the mapper must NOT reference legacy card_pool field names.
echo "[invariants] Checking I-RPC-RETURN-SHAPE-MATCHES-CONSUMER..."
MAPPER_FILE="supabase/functions/get-person-hero-cards/index.ts"
GHOST_REFS=$(grep -E "raw\.(title|image_url|category_slug|price_tier|price_tiers|tagline|total_price_min|total_price_max|estimated_duration_minutes|experience_type|shopping_list|card_type)" "$MAPPER_FILE" || true)
if [ -n "$GHOST_REFS" ]; then
  echo "  FAIL: $MAPPER_FILE reads card_pool ghost fields:"
  echo "$GHOST_REFS"
  EXIT_CODE=1
else
  echo "  PASS"
fi
```

Append to `INVARIANT_REGISTRY.md` two new blocks: `I-PERSON-HERO-RPC-USES-USER-PARAMS` + `I-RPC-RETURN-SHAPE-MATCHES-CONSUMER` with full text + CI gate references.

### 3.8 — CI smoke test for cards-have-content (D-8 meta-discovery)

New file `supabase/functions/get-person-hero-cards/_smoke.test.ts` (Deno test, runs in CI):

```ts
import { assertEquals, assertNotEquals } from "https://deno.land/std/testing/asserts.ts";

Deno.test("get-person-hero-cards returns cards with real content (no Unknown/null defaults)", async () => {
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const TEST_USER_JWT = Deno.env.get("CI_TEST_USER_JWT")!;
  const TEST_PAIRED_UUID = Deno.env.get("CI_TEST_PAIRED_UUID")!;

  const res = await fetch(`${SUPABASE_URL}/functions/v1/get-person-hero-cards`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${TEST_USER_JWT}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      pairedUserId: TEST_PAIRED_UUID,
      holidayKey: "birthday",
      categorySlugs: ["romantic", "play", "upscale_fine_dining"],
      curatedExperienceType: "romantic",
      location: { latitude: 35.7796, longitude: -78.6382 },
      mode: "default",
      excludeCardIds: [],
    }),
  });
  assertEquals(res.status, 200, "expected 200 OK");
  const body = await res.json();
  for (const card of body.cards) {
    assertNotEquals(card.title, "Unknown", `card ${card.id} has title 'Unknown' — mapper regression`);
    assertNotEquals(card.title, "", `card ${card.id} has empty title — place_pool.name was null`);
    assertNotEquals(card.imageUrl, null, `card ${card.id} has imageUrl=null — stored_photo_urls was empty/sentinel`);
    assertNotEquals(card.category, "", `card ${card.id} has empty category — primary_type didn't map`);
  }
});
```

Wired into `scripts/ci-check-invariants.sh` via the same deno-skip-graceful pattern established in ORCH-0677.

---

## 4 · Success criteria (numbered, observable, testable)

| # | Success criterion | How verified |
|---|-------------------|--------------|
| **SC-1** | After deploy, every card returned by `get-person-hero-cards` for a valid (user, paired, holiday) tuple has `title === place_pool.name` (verbatim, not "Unknown"). | T-01 + T-02 + T-03; CI smoke test §3.8 |
| **SC-2** | Every card has `imageUrl` pointing to a non-null URL drawn from `place_pool.stored_photo_urls[0]` (and never `__backfill_failed__`). | T-01 + T-04; CI smoke test |
| **SC-3** | Every card has `category` resolved from `primary_type` via `mapPrimaryTypeToMinglaCategory` to one of the 13 canonical Mingla categories. | T-05 |
| **SC-4** | Every card has `priceTier` either `null` (when `place_pool.price_level IS NULL`) OR one of `{chill, comfy, bougie, lavish}`. **Never defaults to "chill" when price unknown.** | T-06 |
| **SC-5** | Every card has `isOpenNow` either `true`, `false`, or `null` (when `opening_hours.openNow` undefined). **Never fabricates `true`.** | T-07 (Constitution #9) |
| **SC-6** | UI: when a card's `priceTier === null`, the price line in CompactCard is NOT rendered. | T-08 device |
| **SC-7** | When `composition.comboCount > 0` and combo planner returns ≥1 combo, the response's `cards[]` includes at least 1 card with `cardType === "curated"` populated with `stopsData`, `experienceType`, `tagline`. | T-09 + T-10 |
| **SC-8** | When combo planner returns zero combos, response carries `summary.emptyReason === "no_viable_combo"` and singles still serve. | T-11 |
| **SC-9** | When holidayKey === "birthday", composition rule = `COMPOSITION_RULES.birthday` → response includes 1 combo with `experienceType === "celebration"` + 5-8 singles biased toward birthday signal IDs. | T-12 |
| **SC-10** | When holidayKey === "valentines_day", composition rule = `COMPOSITION_RULES.valentines_day` → response includes 1 combo with `experienceType === "romantic"` + 4-6 singles biased toward `[fine_dining, drinks, icebreakers, flowers]`. | T-13 |
| **SC-11** | Custom holiday with `yearsElapsed > 0` → ANNIVERSARY_DEFAULT rule applied → 1 romantic combo + 4-6 AI-biased singles. | T-14 |
| **SC-12** | Custom holiday with `yearsElapsed === 0` → CUSTOM_HOLIDAY_DEFAULT rule applied with `comboAnchors` derived from AI-resolved sections. | T-15 |
| **SC-13** | Two viewers (user A, user A') querying same paired person + same holiday + same location, where user A has saved 5 places in pair + user A' has saved 0, return DIFFERENT card orderings. The places A saved appear earlier in the response when other gates equal. | T-16 |
| **SC-14** | Negative control: two viewers with identical (empty) preference profiles return IDENTICAL card orderings — no synthetic personalization from absent data. | T-17 |
| **SC-15** | `query_person_hero_places_by_signal` body references `p_user_id` AND `p_person_id` ≥3 times each. CI gate `I-PERSON-HERO-RPC-USES-USER-PARAMS` PASSes. | T-18 (CI gate) |
| **SC-16** | `mapPlacePoolRowToCard` does NOT contain references to `raw.title`, `raw.image_url`, `raw.category`, `raw.tagline`, `raw.price_tier`, `raw.stops`, `raw.experience_type`, `raw.total_price_min/max`, `raw.estimated_duration_minutes`, `raw.shopping_list`, `raw.categories`, `raw.card_type`. CI gate `I-RPC-RETURN-SHAPE-MATCHES-CONSUMER` PASSes. | T-19 (CI gate) |
| **SC-17** | RPC perf budget: `EXPLAIN ANALYZE` of an 11-signal Raleigh call with both user IDs populated and both saves+visits cohorts non-empty → execution time < 500 ms. | T-20 |
| **SC-18** | When `mode === "default"` and BOTH users have ≥10 confident `user_preference_learning` rows, the edge fn auto-promotes to bilateral and logs `auto-bilateral active for pair`. When threshold not met, stays default. | T-21 |
| **SC-19** | When `mode === "individual"` is sent explicitly, edge fn does NOT auto-promote even if both users meet threshold. | T-22 |
| **SC-20** | Solo Discover singles deck (calling `discover-cards`) returns cards with identical shape to before deploy — no regression from this spec's changes. Sanity check verified against pre-deploy capture. | T-23 (regression-lock) |
| **SC-21** | Discover curated deck (calling `generate-curated-experiences`) returns combos identical to before deploy — combo planner extraction is byte-equivalent behavior. | T-24 (regression-lock) |
| **SC-22** | If G-PF-1 confirmed orphan: `PersonGridCard.tsx` no longer exists in repo + import removed from PersonHolidayView. If G-PF-2 confirmed orphan: `usePersonHeroCards.ts` no longer exists in repo. `holidayCardsService.ts` no longer imports `supabase, supabaseUrl`. | T-25 |

---

## 5 · Invariants

### Preserved (must continue to hold after this change)

| Invariant | How preserved |
|-----------|---------------|
| **I-THREE-GATE-SERVING (DEC-053)** | RPC body §3.3 retains `is_servable=true AND stored_photo_urls IS NOT NULL AND array_length > 0 AND ≠ '__backfill_failed__'` verbatim. |
| **I-PLACE-ID-CONTRACT** | RPC continues to return `place_pool.id::TEXT` in the JSONB; new mapper reads `raw.id` directly. saved_card/user_visits JOINs handle dual-shape (place_pool.id::TEXT OR legacy google_place_id) for backwards compatibility. |
| **I-POOL-ONLY-SERVING** | RPC reads only `place_pool + place_scores + saved_card + user_visits + pairings` (none touch card_pool). |
| **I-RPC-LANGUAGE-SQL-FOR-HOT-PATH** | RPC remains `LANGUAGE sql STABLE`. CI gate from ORCH-0677 enforces. |
| **I-CURATED-FAILED-ANCHOR-IS-USED (ORCH-0677)** | Combo planner extraction copies the `failedAnchorIds` mechanism verbatim. T-21 regression-locks. |
| **I-CURATED-EMPTY-IS-EXPLICIT-VERDICT (ORCH-0677)** | New `summary.emptyReason: 'no_viable_combo'` mirrors the contract. |
| **Constitution #2** | The new RPC is sole authority for "what places win." Mobile must NOT re-rank in the hook. |
| **Constitution #3** | Edge fn surfaces `summary.emptyReason` in all empty paths. Personalization JOIN failures degrade gracefully with logging. |
| **Constitution #8** | Three orphan files deleted (D-Q6/Q7 + HF-2). `card_pool` ghost-field reads removed. |
| **Constitution #9** | Mapper emits `null` for unknown `priceTier`/`isOpenNow` — never fabricates defaults. UI hides null price line. |

### Newly registered (this spec creates)

| Invariant | Description | CI gate |
|-----------|-------------|---------|
| **I-PERSON-HERO-RPC-USES-USER-PARAMS** | `query_person_hero_places_by_signal` body must reference both `p_user_id` and `p_person_id` ≥3 times each (declaration + ≥2 body uses for saves+visits JOINs). Reverting to a personalization-blind body re-introduces RC-3. | §3.7 bash gate |
| **I-RPC-RETURN-SHAPE-MATCHES-CONSUMER** | Edge fn mappers reading `to_jsonb(*)` blobs must NOT reference field names that don't exist on the source schema. Specifically blocks the 12 ghost `card_pool` field reads. | §3.7 bash gate |
| **I-PERSON-HERO-CARDS-HAVE-CONTENT** | CI smoke test §3.8 invokes the edge fn at known-good Raleigh location and asserts every card has non-empty title + non-null imageUrl + non-empty category. Catches ANY future mapper regression that defaults essential fields. | §3.8 deno test |

---

## 6 · Implementation order

Numbered. Each step lists exact files. Implementor follows verbatim.

1. **§0 pre-flight gates G-PF-1..G-PF-5.** Halt if any fails. Capture results in implementation report §0.
2. **Create new shared module `supabase/functions/_shared/personHeroComposition.ts`** with §3.4 contents verbatim.
3. **Extract combo planner from `generate-curated-experiences/index.ts` to `supabase/functions/_shared/curatedComboPlanner.ts`** per §3.2. Refactor `generate-curated-experiences` to import from the shared module. Behavior must be byte-identical (regression-locked by T-21).
4. **Verify shared helpers exist:** `mapPrimaryTypeToMinglaCategory`, `mapCategoryToSlug`, `mapPriceLevelToTier`. If any missing, create them (reuse existing logic from `discover-cards/_shared/transformServablePlaceToCard.ts` if present; otherwise extract from current edge-fn `derivePriceTier` for tiers).
5. **Write new migration `supabase/migrations/20260501000001_orch_0684_person_hero_personalized.sql`** with §3.3 SQL verbatim.
6. **Apply migration via `supabase db push` (or MCP `apply_migration`).** Capture `pg_get_functiondef` output to verify byte-match.
7. **Capture perf baseline:** run `EXPLAIN (ANALYZE, BUFFERS)` for 11-signal Raleigh call with both user IDs + both saves/visits cohorts non-empty. Confirm < 500 ms. If failure, halt + propose alternative per §3.3 perf-budget clause.
8. **Rewrite `supabase/functions/get-person-hero-cards/index.ts`** per §3.5 (mapper, combo branch, auto-bilateral, request body widening, comment cleanup).
9. **Deno test `bouncer.test.ts`-style** unit tests for `mapPlacePoolRowToCard` covering: happy path, null fields, sentinel photo, unknown primary_type, null price_level. File `supabase/functions/get-person-hero-cards/mapper.test.ts`.
10. **Deploy edge fn** `get-person-hero-cards` via `supabase functions deploy get-person-hero-cards --project-ref gqnoajqerqhnvulmnyvv`.
11. **Deploy edge fn** `generate-curated-experiences` (combo planner extraction) via the same command.
12. **Mobile changes** §3.6: widen service mode type, plumb mode through hook + component, hide null priceTier in CompactCard, conditional cleanup deletions per G-PF-1/G-PF-2.
13. **Append CI gates** §3.7 to `scripts/ci-check-invariants.sh`.
14. **Add CI smoke test** §3.8 file + register in CI runner.
15. **Append two invariants** to `Mingla_Artifacts/INVARIANT_REGISTRY.md`.
16. **Run `tsc --noEmit`** in `app-mobile/` — confirm zero NEW errors (pre-existing errors per ORCH-0680 baseline acceptable).
17. **Run negative-control inject** for both new CI gates: temporarily reintroduce `raw.title` in mapper → gate fires; temporarily delete `p_user_id` reference from RPC → gate fires. Revert + re-run silent.
18. **Two commits drafted** (§9). No Co-Authored-By per `feedback_no_coauthored_by.md`.

---

## 7 · Test plan (≥24 cases)

| # | Test | Scenario | Input | Expected | Layer |
|---|------|----------|-------|----------|-------|
| **T-01** | Birthday hero — title + photo | Raleigh, real paired-user, real birthday set | curl get-person-hero-cards `{holidayKey:"birthday", ...}` | All cards have `title === place_pool.name` (curl + DB cross-check); all have `imageUrl !== null` | Edge + DB |
| **T-02** | Custom holiday — title + photo | Same user, custom holiday | curl `{holidayKey:"custom_<uuid>", isCustomHoliday:true}` | Same as T-01 | Edge |
| **T-03** | Standard holiday — title + photo | Same user, valentines_day | curl `{holidayKey:"valentines_day"}` | Same as T-01 | Edge |
| **T-04** | Photo gate enforcement | Inject a place_pool row with `stored_photo_urls = ARRAY['__backfill_failed__']` near Raleigh | Run RPC | Sentinel place must NOT appear in results | DB |
| **T-05** | Category mapping | curl call returning ≥5 cards | Each card | `category` is one of the 13 Mingla canonical categories | Edge |
| **T-06** | priceTier null path | Find a place_pool row with `price_level IS NULL` and force it into results | curl | Card has `priceTier: null` (NOT "chill") | Edge mapper |
| **T-07** | isOpenNow null path | Find place_pool row with `opening_hours` lacking `openNow` field | curl | Card has `isOpenNow: null` (NOT `true`) | Edge mapper |
| **T-08** | UI hides null price | Mobile device, mock card with `priceTier: null` | Render PersonHolidayView | Price line NOT shown in CompactCard | Component |
| **T-09** | Combo present (birthday) | curl `{holidayKey:"birthday"}` at Raleigh | Response | At least 1 card with `cardType === "curated"`, `stopsData.length >= 2`, `experienceType === "celebration"` | Edge + planner |
| **T-10** | Combo present (valentines) | curl `{holidayKey:"valentines_day"}` | Response | 1 card with `experienceType === "romantic"`, anchors include `fine_dining` + `drinks` | Edge + planner |
| **T-11** | Combo empty fallback | curl with composition that has zero viable combos in sparse rural location | Response | `cards[]` contains singles only; `summary.emptyReason === "no_viable_combo"` | Edge |
| **T-12** | Birthday composition rule | curl `{holidayKey:"birthday"}` | 1 combo + 5-8 singles; singles biased toward [icebreakers, drinks, nature, fine_dining, play, creative_arts, movies] | Edge + composition |
| **T-13** | Valentine's composition rule | curl `{holidayKey:"valentines_day"}` | 1 combo + 4-6 singles; singles biased toward [fine_dining, drinks, icebreakers, flowers] | Edge + composition |
| **T-14** | Anniversary detection | Custom holiday with year=2024 (yearsElapsed=2) | curl `{holidayKey:"custom_<id>", isCustomHoliday:true, yearsElapsed:2}` | ANNIVERSARY_DEFAULT applied: `experienceType === "romantic"` | Edge + composition |
| **T-15** | Custom-generic detection | Custom holiday with year=2026 (yearsElapsed=0) | curl `{holidayKey:"custom_<id>", isCustomHoliday:true, yearsElapsed:0}` | CUSTOM_HOLIDAY_DEFAULT applied with comboAnchors derived from resolvedSectionSignals | Edge + composition |
| **T-16** | Joint-pair personalization positive | Setup: user A saves 3 specific Raleigh places (place_pool.id::TEXT in saved_card.experience_id); user A' saves 0 in pair. Same paired user, same holiday | Two curl calls (one as A, one as A') | A's response orders the 3 saved places earlier than A' does (within band) | DB + RPC |
| **T-17** | Personalization negative control | Both users empty `user_preference_learning` + empty `saved_card`/`user_visits` | Two curl calls | IDENTICAL card orderings — no synthetic boost | DB + RPC |
| **T-18** | CI gate — RPC uses user params | `bash scripts/ci-check-invariants.sh` after deploy | Gate output | `I-PERSON-HERO-RPC-USES-USER-PARAMS  PASS` | CI |
| **T-19** | CI gate — mapper field shape | Same | Gate output | `I-RPC-RETURN-SHAPE-MATCHES-CONSUMER  PASS` | CI |
| **T-20** | RPC perf budget | `EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM query_person_hero_places_by_signal('<uuidA>','<uuidB>', 35.7796, -78.6382, ARRAY['romantic','play','fine_dining','drinks','nature','icebreakers','creative_arts','casual_food','movies','flowers','brunch']::text[], '{}'::uuid[], 15000, 100000, 3, 9)` (warm cache) | Execution Time | < 500 ms | DB |
| **T-21** | Auto-bilateral fires | Both users have ≥10 confident `user_preference_learning` rows | curl `mode:"default"` | Edge fn log: `auto-bilateral active for pair`. Bilateral preference blending visible in `blendedCategories` log | Edge |
| **T-22** | Explicit individual blocks auto-bilateral | Same setup as T-21 | curl `mode:"individual"` | Edge fn log shows individual mode (no auto-bilateral); response uses default-mode pref blending only | Edge |
| **T-23** | Solo Discover regression-lock | Pre-deploy: capture 5 cards from `discover-cards` at Raleigh with chips=[Romantic, Drinks]. Post-deploy: same call. | Diff | IDENTICAL card IDs + ordering (no regression from extraction) | Cross-edge |
| **T-24** | Discover curated regression-lock | Pre-deploy: capture curated combos from `generate-curated-experiences` at Umstead with intent=picnic. Post-deploy: same. | Diff | IDENTICAL combo IDs + stopsData (planner extraction byte-equivalent) | Cross-edge |
| **T-25** | Cleanup verification | After deploy | `find app-mobile/src -name "PersonGridCard.tsx" -o -name "usePersonHeroCards.ts"` | Empty (if G-PF gates passed orphan); grep for `supabase, supabaseUrl` import in `holidayCardsService.ts` returns nothing | Mobile |

---

## 8 · Deploy order

```bash
# Step 1: apply DB migration
supabase db push --project-ref gqnoajqerqhnvulmnyvv

# Step 2: verify migration body via MCP execute_sql
#   SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname = 'query_person_hero_places_by_signal';
# Compare byte-identical to migration source.

# Step 3: capture perf baseline (T-20)
#   EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM query_person_hero_places_by_signal(...)
# Confirm < 500ms p95. If FAIL → halt, escalate per §3.3 perf-budget clause.

# Step 4: deploy edge functions (parallel)
cd supabase/functions
supabase functions deploy get-person-hero-cards --project-ref gqnoajqerqhnvulmnyvv
supabase functions deploy generate-curated-experiences --project-ref gqnoajqerqhnvulmnyvv
cd ../..

# Step 5: smoke test the edge fn
#   curl as in T-01 with a real JWT + paired uuid. Confirm SC-1..SC-7.

# Step 6: EAS Update mobile (iOS first, then Android — separate invocations per
# memory rule feedback_eas_update_no_web.md)
cd app-mobile
eas update --branch production --platform ios --message "ORCH-0684: paired-person view rewire (real cards + combos + joint-pair personalization)"
eas update --branch production --platform android --message "ORCH-0684: paired-person view rewire (real cards + combos + joint-pair personalization)"
cd ..

# Step 7: founder smoke at known paired-user / known holiday on Raleigh device.
# Confirm SC-1, SC-6, SC-7, SC-9 visually.

# Step 8: tester dispatch with §7 matrix.
```

---

## 9 · Commit message templates (no Co-Authored-By)

### Backend commit (migration + edge fn + shared modules)

```
feat(person-hero): ORCH-0684 — finish signal-system migration on paired view

Rewire the paired-person view to read place_pool field shapes (RC-1),
add holiday-driven combo + singles mix (RC-2 / D-Q1), and rank with
joint-pair history boosts in the RPC (RC-3 / D-Q2 Option B).

- migrations: 20260501000001_orch_0684_person_hero_personalized.sql
  extends query_person_hero_places_by_signal with saved_card + user_visits
  JOINs filtered to (p_user_id, p_person_id); projects distance_m +
  personalization_boost + boost_reasons; preserves LANGUAGE sql STABLE
  and three-gate serving (I-THREE-GATE-SERVING / I-POOL-ONLY-SERVING)
- get-person-hero-cards: rewrite mapPoolCardToCard → mapPlacePoolRowToCard
  reading actual place_pool fields (name, stored_photo_urls, primary_type,
  opening_hours.openNow, price_level via mapPriceLevelToTier — null when
  unknown, never fabricates "chill"); add curated-combo branch via new
  composition rule table; auto-bilateral mode detection; widen request
  body mode type to include "individual"
- _shared/personHeroComposition.ts: new — holiday composition rules for
  birthday / valentines_day / mothers_day / fathers_day / anniversary /
  custom-generic / generic-fallback
- _shared/curatedComboPlanner.ts: new — extracted from
  generate-curated-experiences for shared use; behavior byte-equivalent
- generate-curated-experiences: refactored to import combo planner from
  shared module (regression-locked by T-24)
- ci: 2 new invariants (I-PERSON-HERO-RPC-USES-USER-PARAMS,
  I-RPC-RETURN-SHAPE-MATCHES-CONSUMER) + 1 deno smoke test
  (I-PERSON-HERO-CARDS-HAVE-CONTENT) — catches future regressions

Closes ORCH-0684 backend half. Mobile commit follows.
```

### Mobile commit (service + hook + component cleanup)

```
feat(paired-view): ORCH-0684 — surface real cards + combos + bilateral toggle

- personHeroCardsService: widen mode type to
  "default" | "shuffle" | "bilateral" | "individual"; add yearsElapsed
- usePairedCards: plumb mode + isCustomHoliday + yearsElapsed; query key
  includes mode for cache separation
- PersonHolidayView: pass bilateralMode through to CardRow; CompactCard
  hides price line when priceRange === null (D-Q5 — no fabricated "chill")
- holidayCardsService: drop unused supabase/supabaseUrl re-imports
  (HF-2 cleanup, ORCH-0573 backlog item)
- delete app-mobile/src/components/PersonGridCard.tsx (orphan, G-PF-1)
- delete app-mobile/src/hooks/usePersonHeroCards.ts (orphan, G-PF-2)

Closes ORCH-0684 mobile half. Requires backend commit deployed first.
```

---

## 10 · Discoveries for orchestrator (register at CLOSE)

| ID | Title | Severity | Notes |
|----|-------|----------|-------|
| **ORCH-0684.D-5** | Cross-surface mapper sweep (saved_card / map cards / board cards) | P3 | 30-min grep + read pass; verify each consumer matches its RPC's projection. Bundle similar fixes if found. |
| **ORCH-0684.D-6** | Consolidate `INTENT_CATEGORY_MAP` + `CATEGORY_SLUG_TO_SIGNAL_ID` to shared module | P3 | Currently duplicated across 3 edge fns — drift risk. ~1hr extraction. |
| **ORCH-0684.D-fu** | Audit all `to_jsonb(*)` consumers across migrations | P3 | `grep -rn "to_jsonb" supabase/migrations/` and cross-check each consumer. Catches the next "ghost field reads" bug class before it ships. |
| **ORCH-0684.D-8** | Visual-smoke gate for all RPC-touching closures (process improvement) | P3 | ORCH-0668 closed Grade A on perf-only QA and missed the mapper bug. Recommend adding "captured cards display real content" smoke to QA template for any RPC-touching change. Mirror this spec's CI smoke (§3.8) for other surfaces. |
| **ORCH-0684.D-fu-2** | Boost-weight tuning ORCH | P4 | Once telemetry rolls in (3-7 days post-launch), evaluate whether the §3.3 starting weights produce desired ordering. Spec a tuning ORCH with empirical evidence. |
| **ORCH-0684.D-fu-3** | Combo composition table tuning | P4 | Same as above — evaluate whether per-holiday compositions feel right; expand to all STANDARD_HOLIDAYS not currently in COMPOSITION_RULES if telemetry shows derived rules fall short. |

---

## 11 · Confidence

**Overall: HIGH.**

- All 4 user-bound decisions integrated verbatim with no interpretation gaps.
- Schema verified live (pre-flight gates G-PF-3/G-PF-4/G-PF-5).
- RPC body is copy-paste-ready SQL; perf budget enforced; preserves ORCH-0668 foundation.
- Combo extraction approach (option b) avoids HTTP round-trip and gives single source of truth.
- Test matrix covers happy + error + edge + regression-lock for both adjacent surfaces.
- CI gates (3 new) structurally prevent recurrence of all three RC classes.
- Cleanup is conditional on pre-flight to avoid breaking unknown consumers.

**Single uncertainty:** the precise behavior of `experience_id` matching across legacy + post-migration shapes — the dual-condition JOIN handles both, but the implementor should sample query results during T-16 to confirm both legacy + new rows match. If discrepancies appear, the spec scope can absorb a one-line clarification without re-spec.

The implementor can begin without further questions.
