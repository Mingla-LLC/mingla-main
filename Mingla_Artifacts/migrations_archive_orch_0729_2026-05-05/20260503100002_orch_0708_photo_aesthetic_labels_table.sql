-- ORCH-0708 Phase 0 — photo_aesthetic_labels table
--
-- Operator-labeled answer keys for the photo-aesthetic scoring system
-- (Wave 2 Phase 1). Two roles:
--   * anchor (6 rows, one per category) — feeds into Claude system prompt as
--     calibration examples
--   * fixture (30 rows, 10 per city for Raleigh / Cary / Durham) — used as
--     regression tests in the Compare-with-Claude view + golden_fixtures.json
--
-- Single operator (founder, sethogieva@gmail.com). RLS:
--   * service_role: full access (admin UI runs through it)
--   * authenticated admin users: read-only via admin_users gate
--   * everyone else: denied
--
-- Spec: Mingla_Artifacts/reports/SPEC_ORCH-0708_PHOTO_AESTHETIC_SCORING_INTEGRATION.md §24.2
-- Dispatch: Mingla_Artifacts/prompts/IMPL_ORCH-0708_PHASE_0_LABELING_TOOL.md

BEGIN;

CREATE TABLE IF NOT EXISTS public.photo_aesthetic_labels (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  place_pool_id      UUID NOT NULL REFERENCES public.place_pool(id) ON DELETE CASCADE,
  role               TEXT NOT NULL CHECK (role IN ('anchor', 'fixture')),
  label_category     TEXT,
  city               TEXT,
  expected_aggregate JSONB NOT NULL,
  notes              TEXT,
  labeled_by         UUID REFERENCES auth.users(id),
  labeled_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  committed_at       TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Anchors must have a label_category from the fixed 6-element set.
  -- Fixtures must NOT have a label_category (their identity is role + place + city).
  CONSTRAINT chk_anchor_category CHECK (
    (role = 'anchor' AND label_category IN (
      'upscale_steakhouse',
      'sunny_brunch_cafe',
      'neon_dive_bar',
      'adult_venue',
      'average_storefront',
      'cozy_coffee_shop'
    ))
    OR (role = 'fixture' AND label_category IS NULL)
  )
);

-- Only one COMMITTED anchor per category at a time. Drafts (committed_at IS NULL)
-- are unconstrained so the operator can stage a replacement before swapping.
CREATE UNIQUE INDEX IF NOT EXISTS idx_photo_aesthetic_labels_anchor_category_unique
  ON public.photo_aesthetic_labels (label_category)
  WHERE role = 'anchor' AND committed_at IS NOT NULL;

-- Lookup index for the Compare-with-Claude view (filters role+committed).
CREATE INDEX IF NOT EXISTS idx_photo_aesthetic_labels_role_committed
  ON public.photo_aesthetic_labels (role, committed_at)
  WHERE committed_at IS NOT NULL;

-- Lookup index for fixture grid (per-city slot fills).
CREATE INDEX IF NOT EXISTS idx_photo_aesthetic_labels_role_city
  ON public.photo_aesthetic_labels (role, city)
  WHERE role = 'fixture';

-- Updated-at trigger: keep updated_at fresh on every UPDATE.
CREATE OR REPLACE FUNCTION public.tg_photo_aesthetic_labels_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_photo_aesthetic_labels_set_updated_at ON public.photo_aesthetic_labels;
CREATE TRIGGER trg_photo_aesthetic_labels_set_updated_at
  BEFORE UPDATE ON public.photo_aesthetic_labels
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_photo_aesthetic_labels_set_updated_at();

-- ── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.photo_aesthetic_labels ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_all_photo_aesthetic_labels" ON public.photo_aesthetic_labels;
CREATE POLICY "service_role_all_photo_aesthetic_labels"
  ON public.photo_aesthetic_labels
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "admin_read_photo_aesthetic_labels" ON public.photo_aesthetic_labels;
CREATE POLICY "admin_read_photo_aesthetic_labels"
  ON public.photo_aesthetic_labels
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.admin_users au
      WHERE au.email = auth.email() AND au.status = 'active'
    )
  );

DROP POLICY IF EXISTS "admin_write_photo_aesthetic_labels" ON public.photo_aesthetic_labels;
CREATE POLICY "admin_write_photo_aesthetic_labels"
  ON public.photo_aesthetic_labels
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.admin_users au
      WHERE au.email = auth.email() AND au.status = 'active'
    )
  );

DROP POLICY IF EXISTS "admin_update_photo_aesthetic_labels" ON public.photo_aesthetic_labels;
CREATE POLICY "admin_update_photo_aesthetic_labels"
  ON public.photo_aesthetic_labels
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.admin_users au
      WHERE au.email = auth.email() AND au.status = 'active'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.admin_users au
      WHERE au.email = auth.email() AND au.status = 'active'
    )
  );

DROP POLICY IF EXISTS "admin_delete_photo_aesthetic_labels" ON public.photo_aesthetic_labels;
CREATE POLICY "admin_delete_photo_aesthetic_labels"
  ON public.photo_aesthetic_labels
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.admin_users au
      WHERE au.email = auth.email() AND au.status = 'active'
    )
  );

COMMENT ON TABLE public.photo_aesthetic_labels IS
  'ORCH-0708 (Wave 2 Phase 1): operator-labeled answer keys for photo-aesthetic scoring. Anchors (6) feed into Claude system prompt as calibration examples. Fixtures (30, 10 per Raleigh/Cary/Durham) used as regression tests in Compare-with-Claude view + golden_fixtures.json export.';

COMMENT ON COLUMN public.photo_aesthetic_labels.role IS
  'anchor = one of 6 calibration anchors (one per label_category). fixture = one of 30 regression-test places (10 per city).';

COMMENT ON COLUMN public.photo_aesthetic_labels.label_category IS
  'For role=anchor: one of {upscale_steakhouse, sunny_brunch_cafe, neon_dive_bar, adult_venue, average_storefront, cozy_coffee_shop}. NULL for fixtures.';

COMMENT ON COLUMN public.photo_aesthetic_labels.expected_aggregate IS
  'JSON answer key. Same shape as place_pool.photo_aesthetic_data.aggregate. Compared field-by-field against Claude output in the Compare-with-Claude view.';

COMMENT ON COLUMN public.photo_aesthetic_labels.committed_at IS
  'NULL = draft (operator is still editing). Non-null = committed to ground truth. The unique-anchor-per-category index applies only to committed rows.';

COMMIT;
