-- ORCH-0712 — place_pool.photo_collage_url + photo_collage_fingerprint
--
-- Owned EXCLUSIVELY by run-place-intelligence-trial action='compose_collage'.
-- Same I-FIELD-MASK-SINGLE-OWNER carve-out pattern as photo_aesthetic_data.
-- admin-seed-places, bouncer, signal scorer MUST NOT write these columns.
-- I-COLLAGE-SOLE-OWNER (DRAFT, ACTIVE on ORCH-0712 CLOSE).
--
-- Also creates the place-collages Storage bucket (public, 10MB limit).
--
-- Spec: Mingla_Artifacts/specs/SPEC_ORCH-0712_TRIAL_INTELLIGENCE.md §3.5 + §3.6

BEGIN;

ALTER TABLE public.place_pool
  ADD COLUMN IF NOT EXISTS photo_collage_url TEXT DEFAULT NULL;

ALTER TABLE public.place_pool
  ADD COLUMN IF NOT EXISTS photo_collage_fingerprint TEXT DEFAULT NULL;

COMMENT ON COLUMN public.place_pool.photo_collage_url IS
  'ORCH-0712 — public URL of composed photo grid for this place (in place-collages bucket). Owned EXCLUSIVELY by run-place-intelligence-trial edge function compose_collage action. admin-seed-places, bouncer, signal scorer MUST NOT write this column. I-COLLAGE-SOLE-OWNER.';

COMMENT ON COLUMN public.place_pool.photo_collage_fingerprint IS
  'ORCH-0712 — sha256 of the source photo URLs that built the cached collage. If photos rotate, fingerprint mismatch triggers re-compose. Owned by run-place-intelligence-trial.';

CREATE INDEX IF NOT EXISTS idx_place_pool_has_collage
  ON public.place_pool ((1)) WHERE photo_collage_url IS NOT NULL;

-- Create place-collages Storage bucket (public, 10MB limit)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('place-collages', 'place-collages', true, 10485760, ARRAY['image/png', 'image/jpeg'])
ON CONFLICT (id) DO NOTHING;

COMMIT;
