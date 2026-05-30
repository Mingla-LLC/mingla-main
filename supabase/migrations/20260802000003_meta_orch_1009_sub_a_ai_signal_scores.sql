-- META-ORCH-1009 Sub-A — place_pool.ai_signal_scores JSONB column + GIN index
-- + one-shot backfill from the existing place_intelligence_trial_runs Q2 corpus.
--
-- SPEC: Mingla_Artifacts/specs/SPEC_META-ORCH-1009_SUB_A_AI_SIGNAL_SCORES_SCHEMA.md
-- Constitutional bless: DEC-099 (column pre-authorisation, 2026-05-04)
-- Column name decision: DEC-181 (Gemini-not-Claude lock-in, 2026-05-30)
-- Retracted invariant: I-TRIAL-OUTPUT-NEVER-FEEDS-RANKING
-- New invariants: I-AI-SIGNAL-SCORES-COLUMN-SOLE-OWNER (ACTIVE on merge),
--                 I-AI-SIGNAL-SCORES-SHAPE-CONTRACT (ACTIVE on merge),
--                 I-AI-SIGNAL-SCORES-PROMPT-VERSION-DISCRIMINATED (DRAFT;
--                 ACTIVE on Sub-B ranker landing).
--
-- Live probe (2026-05-30):
--   place_pool.ai_signal_scores column exists?     0 (does not exist)
--   distinct place_pool_id w/ completed q2_response: 2366
--   total completed q2_response rows:                2663
--
-- Postgres 17 GIN jsonb_path_ops chosen over default jsonb_ops per docs:
-- https://www.postgresql.org/docs/17/datatype-json.html#JSON-INDEXING
-- (verified 2026-05-30 — supports ? and @> at materially smaller index
-- size + faster lookup vs the operator family Sub-B does not use).

BEGIN;

-- ─── Column DDL ────────────────────────────────────────────────────────────
ALTER TABLE public.place_pool
  ADD COLUMN ai_signal_scores JSONB;

COMMENT ON COLUMN public.place_pool.ai_signal_scores IS
  'Per-signal Gemini Q2 evaluations keyed by signal_id. Shape:
   {<signal_id>: {score_0_to_100: int, inappropriate_for: bool,
                  reasoning: text, evaluated_at: timestamptz,
                  prompt_version: text, model: text}, ...}.
   Written by run-place-intelligence-trial.processOnePlace on per-place
   Q2 completion (sole writer — I-AI-SIGNAL-SCORES-COLUMN-SOLE-OWNER).
   Read by consumer ranker (Sub-B). Constitutionally blessed by DEC-099
   (renamed claude_signal_evaluations -> ai_signal_scores per
   operator Gemini-not-Claude lock-in 2026-05-30, DEC-181). Replaces
   I-TRIAL-OUTPUT-NEVER-FEEDS-RANKING (RETRACTED at Sub-A close).';

CREATE INDEX idx_place_pool_ai_signal_scores
  ON public.place_pool
  USING gin (ai_signal_scores jsonb_path_ops);

-- ─── One-shot backfill ─────────────────────────────────────────────────────
-- Idempotent: re-running on a fully-backfilled DB produces zero updates because
-- the source rows are immutable and the IS DISTINCT FROM guard short-circuits.
-- Expected effect on prod (2026-05-30): 2,366 place_pool rows updated.

WITH latest_q2_per_place AS (
  SELECT DISTINCT ON (pir.place_pool_id)
    pir.place_pool_id,
    pir.q2_response,
    pir.completed_at,
    pir.prompt_version,
    pir.model
  FROM public.place_intelligence_trial_runs pir
  WHERE pir.status = 'completed'
    AND pir.q2_response IS NOT NULL
    AND pir.q2_response ? 'evaluations'
    AND jsonb_typeof(pir.q2_response -> 'evaluations') = 'array'
    AND jsonb_array_length(pir.q2_response -> 'evaluations') > 0
  ORDER BY pir.place_pool_id, pir.completed_at DESC NULLS LAST
),
sliced AS (
  SELECT
    l.place_pool_id,
    jsonb_object_agg(
      (ev ->> 'signal_id'),
      jsonb_build_object(
        'score_0_to_100',
          GREATEST(0, LEAST(100, ROUND((ev ->> 'score_0_to_100')::numeric)::int)),
        'inappropriate_for', (ev ->> 'inappropriate_for')::boolean,
        'reasoning',         ev ->> 'reasoning',
        'evaluated_at',      COALESCE(
                               to_char(l.completed_at AT TIME ZONE 'UTC',
                                       'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                               '1970-01-01T00:00:00.000Z'
                             ),
        'prompt_version',    COALESCE(l.prompt_version, 'unknown'),
        'model',             COALESCE(l.model, 'gemini-2.5-flash')
      )
    ) AS ai_signal_scores
  FROM latest_q2_per_place l,
       LATERAL jsonb_array_elements(l.q2_response -> 'evaluations') AS ev
  WHERE ev ? 'signal_id'
    AND ev ? 'score_0_to_100'
    AND ev ? 'inappropriate_for'
    AND ev ? 'reasoning'
    AND (ev ->> 'signal_id') <> ''
    AND (ev ->> 'reasoning')  <> ''
  GROUP BY l.place_pool_id
)
UPDATE public.place_pool pp
SET ai_signal_scores = s.ai_signal_scores
FROM sliced s
WHERE pp.id = s.place_pool_id
  AND (pp.ai_signal_scores IS NULL
       OR pp.ai_signal_scores IS DISTINCT FROM s.ai_signal_scores);

-- ─── Self-verify probes (NOTICE on apply log; WARNING on drift > 5%) ───────
DO $$
DECLARE
  v_backfilled_count int;
  v_trial_completed int;
  v_drift float;
BEGIN
  SELECT COUNT(*) INTO v_backfilled_count
    FROM public.place_pool
   WHERE ai_signal_scores IS NOT NULL;

  SELECT COUNT(DISTINCT place_pool_id) INTO v_trial_completed
    FROM public.place_intelligence_trial_runs
   WHERE status = 'completed'
     AND q2_response IS NOT NULL
     AND q2_response ? 'evaluations'
     AND jsonb_typeof(q2_response -> 'evaluations') = 'array'
     AND jsonb_array_length(q2_response -> 'evaluations') > 0;

  RAISE NOTICE '[META-ORCH-1009 Sub-A backfill] place_pool.ai_signal_scores non-null rows: %', v_backfilled_count;
  RAISE NOTICE '[META-ORCH-1009 Sub-A backfill] source trial-runs distinct completed places: %', v_trial_completed;

  IF v_trial_completed > 0 THEN
    v_drift := ABS(v_backfilled_count - v_trial_completed)::float / v_trial_completed;
    IF v_drift > 0.05 THEN
      RAISE WARNING '[META-ORCH-1009 Sub-A backfill] drift > 5%% (backfilled=%, source=%, drift=%.4f)',
        v_backfilled_count, v_trial_completed, v_drift;
    ELSE
      RAISE NOTICE '[META-ORCH-1009 Sub-A backfill] drift OK (=%.4f)', v_drift;
    END IF;
  END IF;
END $$;

COMMIT;
