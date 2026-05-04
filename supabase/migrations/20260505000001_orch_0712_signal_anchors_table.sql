-- ORCH-0712 — signal_anchors table
--
-- 2 anchor places per Mingla signal × 16 signals = 32 rows max committed.
-- Operator picks via admin UI; candidate filter = place_scores.score >= threshold.
--
-- Spec: Mingla_Artifacts/specs/SPEC_ORCH-0712_TRIAL_INTELLIGENCE.md §3.2
-- Different from photo_aesthetic_labels (Phase 0) — that's per-category for the
-- photo-aesthetic system; this is per-signal for the trial run.

BEGIN;

CREATE TABLE IF NOT EXISTS public.signal_anchors (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id     TEXT NOT NULL CHECK (signal_id IN (
    'brunch','casual_food','creative_arts','drinks','fine_dining','flowers',
    'groceries','icebreakers','lively','movies','nature','picnic_friendly',
    'play','romantic','scenic','theatre'
  )),
  anchor_index  INTEGER NOT NULL CHECK (anchor_index IN (1, 2)),
  place_pool_id UUID NOT NULL REFERENCES public.place_pool(id) ON DELETE CASCADE,
  notes         TEXT,
  labeled_by    UUID REFERENCES auth.users(id),
  labeled_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  committed_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Only one COMMITTED anchor per (signal_id, anchor_index). Drafts unconstrained.
CREATE UNIQUE INDEX IF NOT EXISTS idx_signal_anchors_unique
  ON public.signal_anchors (signal_id, anchor_index)
  WHERE committed_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_signal_anchors_signal
  ON public.signal_anchors (signal_id);

CREATE OR REPLACE FUNCTION public.tg_signal_anchors_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_signal_anchors_set_updated_at ON public.signal_anchors;
CREATE TRIGGER trg_signal_anchors_set_updated_at
  BEFORE UPDATE ON public.signal_anchors
  FOR EACH ROW EXECUTE FUNCTION public.tg_signal_anchors_set_updated_at();

ALTER TABLE public.signal_anchors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_all_signal_anchors" ON public.signal_anchors;
CREATE POLICY "service_role_all_signal_anchors"
  ON public.signal_anchors
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "admin_all_signal_anchors" ON public.signal_anchors;
CREATE POLICY "admin_all_signal_anchors"
  ON public.signal_anchors
  FOR ALL
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.admin_users au WHERE au.email = auth.email() AND au.status = 'active'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.admin_users au WHERE au.email = auth.email() AND au.status = 'active'));

COMMENT ON TABLE public.signal_anchors IS
  'ORCH-0712 — operator-picked anchor places, 2 per Mingla signal x 16 signals = 32 max committed. Candidate filter: place_scores.score >= threshold for that signal. Used by run-place-intelligence-trial edge function as the input set for Claude trial.';

COMMIT;
