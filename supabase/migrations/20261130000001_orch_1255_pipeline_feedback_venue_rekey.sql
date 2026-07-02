-- ===========================================================================
-- META-ORCH-1255 [multi-venue first-class creation] — M2: pipeline + feedback
-- re-key to the venue row
-- ---------------------------------------------------------------------------
-- SPEC §4.A.3 (binding, commit b236bfaf9). Investigation F-2: the ONE-pipeline-
-- row-per-brand lock (`brand_place_pipeline_state_brand_unique` + the edge fn's
-- `onConflict:"brand_id"`) means venue #2 CLOBBERS venue #1's pipeline row
-- (R-1). This migration kills the lock structurally:
--   * brand_place_pipeline_state gains venue_id NOT NULL; UNIQUE moves
--     brand_id → venue_id. The R-1 silent overwrite is now IMPOSSIBLE — the
--     conflict target no longer exists. (The edge-fn side of R-1 is killed in
--     run-business-place-authoring-pipeline: onConflict:"venue_id"; CI gate
--     .github/scripts/strict-grep/orch-1255-pipeline-no-brand-onconflict.mjs
--     fails any revert to onConflict:"brand_id".)
--   * venue_claim_feedback gains venue_id NOT NULL (investigation D-3: its
--     place_pool_id existed but was absent from predicates; venue_id is now the
--     keying column). Round grouping moves per-venue.
--
-- Both tables KEEP brand_id NOT NULL — the existing ownership RLS
-- (b.account_id = auth.uid() on pipeline; biz_brand_effective_rank_for_caller
-- >= brand_owner on feedback, F-6) survives VERBATIM and is already
-- multi-row-safe. The M1 brand-match trigger closes the cross-brand splice.
--
-- Assert-empty guards: remote read-only probe 2026-07-02 (MCP execute_sql)
-- returned 0 pipeline rows + 0 feedback rows (F-8). If that has drifted, this
-- migration FAILS LOUDLY instead of corrupting — re-run the F-8 audit.
--
-- Apply via the Supabase Management API from MERGED main at CLOSE.
-- ===========================================================================

BEGIN;

-- Assert-empty guards (F-8: prod counts are 0; fail LOUD if drifted).
DO $$ BEGIN
  IF (SELECT count(*) FROM public.brand_place_pipeline_state) > 0
  THEN RAISE EXCEPTION 'orch1255_precondition: pipeline rows exist — re-run F-8 audit'; END IF;
  IF (SELECT count(*) FROM public.venue_claim_feedback) > 0
  THEN RAISE EXCEPTION 'orch1255_precondition: feedback rows exist — re-run F-8 audit'; END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. Pipeline: one row PER VENUE. Drops THE F-2 lock (brand-unique) and adds
--    the venue-unique in the same statement block. Protective note: R-1 —
--    restoring UNIQUE (brand_id) re-opens the venue-#2-clobbers-venue-#1 bug
--    and fails supabase/migrations/__tests__/orch_1255_ops_venue_not_null.test.sql.
-- ---------------------------------------------------------------------------
ALTER TABLE public.brand_place_pipeline_state
  ADD COLUMN IF NOT EXISTS venue_id uuid REFERENCES public.venue_listings(id) ON DELETE CASCADE;
ALTER TABLE public.brand_place_pipeline_state ALTER COLUMN venue_id SET NOT NULL; -- safe: table empty
ALTER TABLE public.brand_place_pipeline_state
  DROP CONSTRAINT IF EXISTS brand_place_pipeline_state_brand_unique;          -- THE F-2 lock
ALTER TABLE public.brand_place_pipeline_state
  ADD CONSTRAINT brand_place_pipeline_state_venue_unique UNIQUE (venue_id);

COMMENT ON COLUMN public.brand_place_pipeline_state.venue_id IS
  'META-ORCH-1255 M2 (F-2/R-1 kill): the pipeline row is keyed one-per-VENUE. '
  'Do NOT re-add UNIQUE (brand_id) or onConflict:"brand_id" — that is the '
  'silent venue-clobber bug this migration eliminates.';

-- ---------------------------------------------------------------------------
-- 2. Feedback: venue-keyed rows + per-venue round index.
-- ---------------------------------------------------------------------------
ALTER TABLE public.venue_claim_feedback
  ADD COLUMN IF NOT EXISTS venue_id uuid REFERENCES public.venue_listings(id) ON DELETE CASCADE;
ALTER TABLE public.venue_claim_feedback ALTER COLUMN venue_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_vcf_venue_round
  ON public.venue_claim_feedback (venue_id, round DESC, created_at);

COMMENT ON COLUMN public.venue_claim_feedback.venue_id IS
  'META-ORCH-1255 M2: feedback rounds are grouped PER VENUE (was implicitly '
  'per brand). brand_id stays NOT NULL for the F-6 owner-read RLS predicate.';

-- ---------------------------------------------------------------------------
-- 3. Attach the M1 brand-match integrity trigger to both (brand_id, venue_id)
--    tables — brand-X owner cannot point a row at brand-Y's venue.
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_orch1255_pipeline_venue_brand_match ON public.brand_place_pipeline_state;
CREATE TRIGGER trg_orch1255_pipeline_venue_brand_match
  BEFORE INSERT OR UPDATE ON public.brand_place_pipeline_state
  FOR EACH ROW EXECUTE FUNCTION public._orch1255_venue_belongs_to_brand();

DROP TRIGGER IF EXISTS trg_orch1255_feedback_venue_brand_match ON public.venue_claim_feedback;
CREATE TRIGGER trg_orch1255_feedback_venue_brand_match
  BEFORE INSERT OR UPDATE ON public.venue_claim_feedback
  FOR EACH ROW EXECUTE FUNCTION public._orch1255_venue_belongs_to_brand();

-- ---------------------------------------------------------------------------
-- 4. venue_claim_active_feedback — the "current round" helper view (ORCH-1064)
--    grouped max(round) PER BRAND; with N venues per brand that grouping is
--    wrong (venue A's round 3 would hide venue B's round 1). Re-emit grouped
--    PER VENUE. security_invoker=true preserved (caller RLS enforced).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.venue_claim_active_feedback
WITH (security_invoker = true) AS
  SELECT f.*
  FROM public.venue_claim_feedback f
  WHERE f.round = (
    SELECT max(f2.round) FROM public.venue_claim_feedback f2 WHERE f2.venue_id = f.venue_id
  );

COMMENT ON VIEW public.venue_claim_active_feedback IS
  'ORCH-1064 + META-ORCH-1255 M2 — the latest feedback round''s items PER VENUE '
  '(round grouping re-keyed brand→venue). security_invoker so RLS (owner '
  'predicate / admin) is enforced for the caller.';

COMMIT;

NOTIFY pgrst, 'reload schema';
