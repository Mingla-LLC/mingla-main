-- ORCH-0708 Phase 1 — photo_aesthetic_batches table
--
-- Per-batch state for a photo_aesthetic_runs row. Each batch contains up to
-- batch_size place_pool_ids and one Anthropic Batch API call (or N synchronous
-- calls when use_batch_api=false).
--
-- Spec: §3.3

BEGIN;

CREATE TABLE IF NOT EXISTS public.photo_aesthetic_batches (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id      UUID NOT NULL REFERENCES public.photo_aesthetic_runs(id) ON DELETE CASCADE,
  batch_index INTEGER NOT NULL,
  place_pool_ids UUID[] NOT NULL,
  place_count INTEGER NOT NULL,

  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'completed', 'failed', 'skipped')),

  succeeded INTEGER NOT NULL DEFAULT 0,
  failed    INTEGER NOT NULL DEFAULT 0,
  skipped   INTEGER NOT NULL DEFAULT 0,

  -- Anthropic Batch API integration (optional path)
  anthropic_batch_id TEXT,
  anthropic_status   TEXT,
  results_url        TEXT,

  cost_usd NUMERIC(10, 6) NOT NULL DEFAULT 0,

  error_message TEXT,
  failed_places JSONB NOT NULL DEFAULT '[]'::jsonb,
  started_at    TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_photo_aesthetic_batches_run_index
  ON public.photo_aesthetic_batches (run_id, batch_index);
CREATE INDEX IF NOT EXISTS idx_photo_aesthetic_batches_run_status
  ON public.photo_aesthetic_batches (run_id, status);
CREATE INDEX IF NOT EXISTS idx_photo_aesthetic_batches_anthropic
  ON public.photo_aesthetic_batches (anthropic_batch_id)
  WHERE anthropic_batch_id IS NOT NULL;

ALTER TABLE public.photo_aesthetic_batches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_all_photo_aesthetic_batches" ON public.photo_aesthetic_batches;
CREATE POLICY "service_role_all_photo_aesthetic_batches"
  ON public.photo_aesthetic_batches
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "admin_read_photo_aesthetic_batches" ON public.photo_aesthetic_batches;
CREATE POLICY "admin_read_photo_aesthetic_batches"
  ON public.photo_aesthetic_batches
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.admin_users au
      WHERE au.email = auth.email() AND au.status = 'active'
    )
  );

COMMENT ON TABLE public.photo_aesthetic_batches IS
  'ORCH-0708 (Wave 2 Phase 1): per-batch state for photo_aesthetic_runs. Contains up to run.batch_size place_pool_ids. When use_batch_api=true, anthropic_batch_id holds the Anthropic Batch API id. When use_batch_api=false, the batch is processed synchronously via N per-place vision calls.';

COMMIT;
