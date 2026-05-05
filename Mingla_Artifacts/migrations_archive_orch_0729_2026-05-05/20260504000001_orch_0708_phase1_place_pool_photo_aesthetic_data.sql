-- ORCH-0708 Phase 1 — place_pool.photo_aesthetic_data column
--
-- Stores the structured photo-aesthetic score from Claude Haiku 4.5 vision.
-- Owned EXCLUSIVELY by the score-place-photo-aesthetics edge function.
-- Bouncer, signal scorer, admin-seed-places, and backfill-place-photos must
-- NOT write this column (carved out per spec §3.4).
--
-- Spec: Mingla_Artifacts/reports/SPEC_ORCH-0708_PHOTO_AESTHETIC_SCORING_INTEGRATION.md §3.1
-- Dispatch: Mingla_Artifacts/prompts/IMPL_ORCH-0708_PHASE_1_PHOTO_AESTHETIC_SCORER.md
-- Invariants: I-PHOTO-AESTHETIC-DATA-SOLE-OWNER, I-PHOTO-AESTHETIC-CACHE-FINGERPRINT

BEGIN;

ALTER TABLE public.place_pool
  ADD COLUMN IF NOT EXISTS photo_aesthetic_data JSONB DEFAULT NULL;

COMMENT ON COLUMN public.place_pool.photo_aesthetic_data IS
  'ORCH-0708 (Wave 2 Phase 1): structured photo-aesthetic data from Claude vision. Owned EXCLUSIVELY by score-place-photo-aesthetics edge function. Bouncer, signal scorer, admin-seed-places, backfill-place-photos MUST NOT write this column. I-PHOTO-AESTHETIC-DATA-SOLE-OWNER. Schema: { photos_fingerprint: text, scored_at: timestamptz, model: text, model_version: text, per_photo: [...], aggregate: { aesthetic_score, lighting, composition, subject_clarity, primary_subject, vibe_tags[], appropriate_for[], inappropriate_for[], safety_flags[], photo_quality_notes }, cost_usd: numeric }.';

-- Partial index for "places that need scoring" lookups by the edge function.
-- WHERE photo_aesthetic_data IS NULL AND is_servable = true AND is_active = true
-- is the dominant filter in create_run.
CREATE INDEX IF NOT EXISTS idx_place_pool_photo_aesthetic_unscored
  ON public.place_pool ((1))
  WHERE photo_aesthetic_data IS NULL
    AND is_servable = true
    AND is_active = true;

COMMIT;
