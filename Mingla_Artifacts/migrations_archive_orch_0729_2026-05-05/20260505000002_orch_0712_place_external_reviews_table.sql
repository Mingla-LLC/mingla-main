-- ORCH-0712 — place_external_reviews table
--
-- Stores reviews fetched from Serper (or future sources) for the 32 anchor places.
-- Fetched on-demand by run-place-intelligence-trial action='fetch_reviews'.
--
-- Spec: Mingla_Artifacts/specs/SPEC_ORCH-0712_TRIAL_INTELLIGENCE.md §3.3

BEGIN;

CREATE TABLE IF NOT EXISTS public.place_external_reviews (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  place_pool_id       UUID NOT NULL REFERENCES public.place_pool(id) ON DELETE CASCADE,
  source              TEXT NOT NULL DEFAULT 'serper' CHECK (source IN ('serper')),
  source_review_id    TEXT NOT NULL,
  review_text         TEXT,
  rating              INTEGER CHECK (rating BETWEEN 1 AND 5),
  posted_at           TIMESTAMPTZ,
  posted_label        TEXT,
  author_name         TEXT,
  author_review_count INTEGER,
  author_photo_count  INTEGER,
  has_media           BOOLEAN NOT NULL DEFAULT false,
  media               JSONB NOT NULL DEFAULT '[]'::jsonb,
  raw                 JSONB,
  fetched_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_place_external_reviews_dedup
  ON public.place_external_reviews (place_pool_id, source, source_review_id);

CREATE INDEX IF NOT EXISTS idx_place_external_reviews_recency
  ON public.place_external_reviews (place_pool_id, posted_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_place_external_reviews_fetched
  ON public.place_external_reviews (place_pool_id, fetched_at DESC);

ALTER TABLE public.place_external_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_all_place_external_reviews" ON public.place_external_reviews;
CREATE POLICY "service_role_all_place_external_reviews"
  ON public.place_external_reviews
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "admin_read_place_external_reviews" ON public.place_external_reviews;
CREATE POLICY "admin_read_place_external_reviews"
  ON public.place_external_reviews
  FOR SELECT
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.admin_users au WHERE au.email = auth.email() AND au.status = 'active'));

COMMENT ON TABLE public.place_external_reviews IS
  'ORCH-0712 — third-party reviews (currently Serper Google Maps reviews) for trial-run anchor places. Dedup via (place_pool_id, source, source_review_id). One row per review with structured fields + raw Serper object preserved.';

COMMIT;
