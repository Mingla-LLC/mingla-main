-- ============================================================================
-- AI Validation Page: tables, indexes, RLS, and 8 RPC functions
-- ============================================================================

-- ── Extend ai_validation_jobs ────────────────────────────────────────────────

ALTER TABLE ai_validation_jobs
  ADD COLUMN IF NOT EXISTS scope TEXT,
  ADD COLUMN IF NOT EXISTS stage TEXT,
  ADD COLUMN IF NOT EXISTS reclassified INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS low_confidence INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cost_usd REAL NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS estimated_cost_usd REAL NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS category_filter TEXT,
  ADD COLUMN IF NOT EXISTS country_filter TEXT,
  ADD COLUMN IF NOT EXISTS city_filter TEXT,
  ADD COLUMN IF NOT EXISTS dry_run BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS batch_size INTEGER NOT NULL DEFAULT 25,
  ADD COLUMN IF NOT EXISTS total_batches INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS completed_batches INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS failed_batches INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS skipped_batches INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS triggered_by UUID;

-- Add constraints (only if column was just added — idempotent via DO block)
DO $$ BEGIN
  ALTER TABLE ai_validation_jobs
    ADD CONSTRAINT chk_avj_scope
    CHECK (scope IS NULL OR scope IN ('unvalidated','all','category','location'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ai_validation_jobs
    ADD CONSTRAINT chk_avj_stage
    CHECK (stage IS NULL OR stage IN ('export','filter','search','website','classify','write','summary','complete'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_avj_status
  ON ai_validation_jobs(status)
  WHERE status IN ('ready','running','paused');

-- ── ai_validation_batches ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ai_validation_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES ai_validation_jobs(id) ON DELETE CASCADE,
  batch_index INTEGER NOT NULL,
  place_pool_ids UUID[] NOT NULL,
  place_count INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','running','completed','failed','skipped')),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  accepted INTEGER NOT NULL DEFAULT 0,
  rejected INTEGER NOT NULL DEFAULT 0,
  reclassified INTEGER NOT NULL DEFAULT 0,
  low_confidence INTEGER NOT NULL DEFAULT 0,
  failed_places INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE ai_validation_batches ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_avb_run_id ON ai_validation_batches(run_id);
CREATE INDEX IF NOT EXISTS idx_avb_run_status ON ai_validation_batches(run_id, status);

DO $$ BEGIN
  CREATE POLICY admin_full_access_ai_validation_batches ON ai_validation_batches
    FOR ALL USING (
      EXISTS (
        SELECT 1 FROM admin_users
        WHERE email = lower(auth.email()) AND status = 'active'
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── ai_validation_results ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ai_validation_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES ai_validation_jobs(id) ON DELETE CASCADE,
  batch_id UUID REFERENCES ai_validation_batches(id) ON DELETE SET NULL,
  place_id UUID NOT NULL REFERENCES place_pool(id) ON DELETE CASCADE,
  decision TEXT NOT NULL CHECK (decision IN ('accept','reject','reclassify')),
  previous_categories TEXT[],
  new_categories TEXT[],
  primary_identity TEXT,
  confidence TEXT CHECK (confidence IN ('high','medium','low')),
  reason TEXT,
  evidence TEXT,
  stage_resolved INTEGER,
  website_verified BOOLEAN NOT NULL DEFAULT false,
  search_results JSONB,
  cost_usd REAL NOT NULL DEFAULT 0,
  overridden BOOLEAN NOT NULL DEFAULT false,
  override_decision TEXT CHECK (override_decision IS NULL OR override_decision IN ('accept','reject','reclassify')),
  override_categories TEXT[],
  override_reason TEXT,
  overridden_by UUID,
  overridden_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE ai_validation_results ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_avr_job_id ON ai_validation_results(job_id);
CREATE INDEX IF NOT EXISTS idx_avr_place_id ON ai_validation_results(place_id);
CREATE INDEX IF NOT EXISTS idx_avr_decision ON ai_validation_results(decision);
CREATE INDEX IF NOT EXISTS idx_avr_confidence ON ai_validation_results(confidence);
CREATE INDEX IF NOT EXISTS idx_avr_review_queue
  ON ai_validation_results(job_id, created_at DESC)
  WHERE confidence = 'low' OR decision = 'reclassify' OR overridden = true;
CREATE INDEX IF NOT EXISTS idx_avr_job_decision
  ON ai_validation_results(job_id, decision, created_at DESC);

DO $$ BEGIN
  CREATE POLICY admin_full_access_ai_validation_results ON ai_validation_results
    FOR ALL USING (
      EXISTS (
        SELECT 1 FROM admin_users
        WHERE email = lower(auth.email()) AND status = 'active'
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── RPC 1: admin_ai_validation_overview ──────────────────────────────────────

CREATE OR REPLACE FUNCTION admin_ai_validation_overview()
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE result JSON;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM admin_users WHERE email = lower(auth.email()) AND status = 'active') THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  SELECT json_build_object(
    'total_active',  COUNT(*) FILTER (WHERE is_active = true),
    'validated',     COUNT(*) FILTER (WHERE is_active = true AND ai_validated_at IS NOT NULL),
    'unvalidated',   COUNT(*) FILTER (WHERE is_active = true AND ai_validated_at IS NULL),
    'approved',      COUNT(*) FILTER (WHERE is_active = true AND ai_approved = true),
    'rejected',      COUNT(*) FILTER (WHERE is_active = true AND ai_approved = false)
  ) INTO result FROM place_pool;

  RETURN result;
END; $$;

-- ── RPC 2: admin_ai_category_health ──────────────────────────────────────────

CREATE OR REPLACE FUNCTION admin_ai_category_health()
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE result JSON; latest_job_id UUID;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM admin_users WHERE email = lower(auth.email()) AND status = 'active') THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  SELECT id INTO latest_job_id FROM ai_validation_jobs
  WHERE status = 'completed' ORDER BY completed_at DESC NULLS LAST LIMIT 1;

  SELECT json_agg(row_to_json(t)) INTO result FROM (
    SELECT cat.category, cat.total, cat.validated, cat.pct_validated,
           COALESCE(rej.rejected_last_run, 0) AS rejected_last_run
    FROM (
      SELECT unnest(ai_categories) AS category,
             COUNT(*) AS total,
             COUNT(*) FILTER (WHERE ai_validated_at IS NOT NULL) AS validated,
             ROUND(COUNT(*) FILTER (WHERE ai_validated_at IS NOT NULL) * 100.0 / NULLIF(COUNT(*), 0), 1) AS pct_validated
      FROM place_pool WHERE is_active = true AND ai_categories IS NOT NULL
      GROUP BY unnest(ai_categories)
    ) cat
    LEFT JOIN (
      SELECT unnest(new_categories) AS category, COUNT(*) AS rejected_last_run
      FROM ai_validation_results WHERE job_id = latest_job_id AND decision = 'reject'
      GROUP BY unnest(new_categories)
    ) rej ON rej.category = cat.category
    ORDER BY cat.category
  ) t;

  RETURN COALESCE(result, '[]'::json);
END; $$;

-- ── RPC 3: admin_ai_validation_preview ───────────────────────────────────────

CREATE OR REPLACE FUNCTION admin_ai_validation_preview(
  p_scope TEXT DEFAULT 'unvalidated',
  p_category TEXT DEFAULT NULL,
  p_country TEXT DEFAULT NULL,
  p_city TEXT DEFAULT NULL,
  p_revalidate BOOLEAN DEFAULT false
) RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  place_count INTEGER; est_search_cost REAL; est_gpt_cost REAL; est_total REAL; est_minutes REAL;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM admin_users WHERE email = lower(auth.email()) AND status = 'active') THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  SELECT COUNT(*) INTO place_count FROM place_pool
  WHERE is_active = true
    AND (p_scope = 'all' OR p_revalidate = true OR ai_validated_at IS NULL)
    AND (p_category IS NULL OR ai_categories @> ARRAY[p_category])
    AND (p_country IS NULL OR country ILIKE '%' || p_country || '%')
    AND (p_city IS NULL OR city ILIKE '%' || p_city || '%');

  est_search_cost := place_count * 0.85 * 0.0004;
  est_gpt_cost    := place_count * 0.85 * 0.0003;
  est_total       := (est_search_cost + est_gpt_cost) * 1.15;
  est_minutes     := CEIL(place_count / 25.0) * 0.75;

  RETURN json_build_object(
    'places_to_process', place_count,
    'estimated_cost_usd', ROUND(est_total::numeric, 2),
    'estimated_minutes',  ROUND(est_minutes::numeric, 0),
    'breakdown', json_build_object(
      'serper_cost',      ROUND(est_search_cost::numeric, 4),
      'gpt_cost',         ROUND(est_gpt_cost::numeric, 4),
      'contingency_pct',  15
    )
  );
END; $$;

-- ── RPC 4: admin_ai_recent_runs ──────────────────────────────────────────────

CREATE OR REPLACE FUNCTION admin_ai_recent_runs(p_limit INTEGER DEFAULT 10)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE result JSON;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM admin_users WHERE email = lower(auth.email()) AND status = 'active') THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  SELECT json_agg(row_to_json(t)) INTO result FROM (
    SELECT id, scope, status, category_filter, country_filter, city_filter,
           dry_run, total_places, processed, approved, rejected, reclassified,
           low_confidence, failed, cost_usd, total_batches, completed_batches,
           failed_batches, created_at, started_at, completed_at
    FROM ai_validation_jobs ORDER BY created_at DESC LIMIT p_limit
  ) t;

  RETURN COALESCE(result, '[]'::json);
END; $$;

-- ── RPC 5: admin_ai_run_results ──────────────────────────────────────────────

CREATE OR REPLACE FUNCTION admin_ai_run_results(
  p_job_id UUID DEFAULT NULL,
  p_decision TEXT DEFAULT NULL,
  p_category TEXT DEFAULT NULL,
  p_confidence TEXT DEFAULT NULL,
  p_search TEXT DEFAULT NULL,
  p_page INTEGER DEFAULT 1,
  p_page_size INTEGER DEFAULT 50
) RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE total_count INTEGER; result JSON; v_offset INTEGER; v_job UUID;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM admin_users WHERE email = lower(auth.email()) AND status = 'active') THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  IF p_job_id IS NULL THEN
    SELECT id INTO v_job FROM ai_validation_jobs WHERE status = 'completed'
    ORDER BY completed_at DESC NULLS LAST LIMIT 1;
  ELSE v_job := p_job_id; END IF;

  IF v_job IS NULL THEN
    RETURN json_build_object('results', '[]'::json, 'total_count', 0, 'page', p_page, 'page_size', p_page_size);
  END IF;

  v_offset := (p_page - 1) * p_page_size;

  SELECT COUNT(*) INTO total_count FROM ai_validation_results r
  JOIN place_pool p ON p.id = r.place_id
  WHERE r.job_id = v_job
    AND (p_decision IS NULL OR r.decision = p_decision)
    AND (p_category IS NULL OR r.new_categories @> ARRAY[p_category])
    AND (p_confidence IS NULL OR r.confidence = p_confidence)
    AND (p_search IS NULL OR p.name ILIKE '%' || p_search || '%');

  SELECT json_agg(row_to_json(t)) INTO result FROM (
    SELECT r.id, r.place_id, p.name AS place_name, p.address AS place_address,
           r.decision, r.previous_categories, r.new_categories, r.primary_identity,
           r.confidence, r.reason, r.evidence, r.stage_resolved, r.website_verified,
           r.overridden, r.override_decision, r.override_categories,
           r.override_reason, r.overridden_at, r.created_at
    FROM ai_validation_results r JOIN place_pool p ON p.id = r.place_id
    WHERE r.job_id = v_job
      AND (p_decision IS NULL OR r.decision = p_decision)
      AND (p_category IS NULL OR r.new_categories @> ARRAY[p_category])
      AND (p_confidence IS NULL OR r.confidence = p_confidence)
      AND (p_search IS NULL OR p.name ILIKE '%' || p_search || '%')
    ORDER BY r.created_at DESC OFFSET v_offset LIMIT p_page_size
  ) t;

  RETURN json_build_object('results', COALESCE(result, '[]'::json), 'total_count', total_count, 'page', p_page, 'page_size', p_page_size);
END; $$;

-- ── RPC 6: admin_ai_review_queue ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION admin_ai_review_queue(
  p_job_id UUID DEFAULT NULL,
  p_filter TEXT DEFAULT 'all',
  p_page INTEGER DEFAULT 1,
  p_page_size INTEGER DEFAULT 20
) RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  total_count INTEGER; low_conf_count INTEGER; reclass_count INTEGER;
  override_count INTEGER; result JSON; v_offset INTEGER; v_job UUID;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM admin_users WHERE email = lower(auth.email()) AND status = 'active') THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  IF p_job_id IS NULL THEN
    SELECT id INTO v_job FROM ai_validation_jobs WHERE status IN ('completed','running')
    ORDER BY created_at DESC LIMIT 1;
  ELSE v_job := p_job_id; END IF;

  IF v_job IS NULL THEN
    RETURN json_build_object('items','[]'::json,'total_count',0,'low_confidence',0,'reclassified',0,'overridden',0,'page',p_page,'page_size',p_page_size);
  END IF;

  v_offset := (p_page - 1) * p_page_size;

  SELECT COUNT(*) FILTER (WHERE confidence='low' AND NOT overridden),
         COUNT(*) FILTER (WHERE decision='reclassify' AND NOT overridden),
         COUNT(*) FILTER (WHERE overridden = true)
  INTO low_conf_count, reclass_count, override_count
  FROM ai_validation_results WHERE job_id = v_job
    AND (confidence='low' OR decision='reclassify' OR overridden = true);

  SELECT COUNT(*) INTO total_count FROM ai_validation_results
  WHERE job_id = v_job AND (
    (p_filter='all' AND (confidence='low' OR decision='reclassify' OR overridden=true))
    OR (p_filter='low_confidence' AND confidence='low' AND NOT overridden)
    OR (p_filter='reclassified' AND decision='reclassify' AND NOT overridden)
    OR (p_filter='overridden' AND overridden=true)
  );

  SELECT json_agg(row_to_json(t)) INTO result FROM (
    SELECT r.id, r.place_id, p.name AS place_name, p.address AS place_address,
           r.decision, r.previous_categories, r.new_categories, r.primary_identity,
           r.confidence, r.reason, r.evidence, r.overridden, r.override_decision,
           r.override_categories, r.override_reason, r.overridden_at, r.created_at
    FROM ai_validation_results r JOIN place_pool p ON p.id = r.place_id
    WHERE r.job_id = v_job AND (
      (p_filter='all' AND (r.confidence='low' OR r.decision='reclassify' OR r.overridden=true))
      OR (p_filter='low_confidence' AND r.confidence='low' AND NOT r.overridden)
      OR (p_filter='reclassified' AND r.decision='reclassify' AND NOT r.overridden)
      OR (p_filter='overridden' AND r.overridden=true)
    )
    ORDER BY r.created_at DESC OFFSET v_offset LIMIT p_page_size
  ) t;

  RETURN json_build_object('items',COALESCE(result,'[]'::json),'total_count',total_count,
    'low_confidence',low_conf_count,'reclassified',reclass_count,'overridden',override_count,
    'page',p_page,'page_size',p_page_size);
END; $$;

-- ── RPC 7: admin_ai_override_place ───────────────────────────────────────────

CREATE OR REPLACE FUNCTION admin_ai_override_place(
  p_result_id UUID,
  p_decision TEXT,
  p_categories TEXT[] DEFAULT NULL,
  p_reason TEXT DEFAULT NULL
) RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_place_id UUID; v_user_id UUID; v_new_approved BOOLEAN;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM admin_users WHERE email = lower(auth.email()) AND status = 'active') THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  IF p_decision NOT IN ('accept','reject','reclassify') THEN
    RAISE EXCEPTION 'Invalid decision: %', p_decision;
  END IF;

  SELECT place_id INTO v_place_id FROM ai_validation_results WHERE id = p_result_id;
  IF v_place_id IS NULL THEN RAISE EXCEPTION 'Result not found: %', p_result_id; END IF;

  v_user_id := auth.uid();

  UPDATE ai_validation_results SET
    overridden = true, override_decision = p_decision,
    override_categories = p_categories, override_reason = p_reason,
    overridden_by = v_user_id, overridden_at = now()
  WHERE id = p_result_id;

  v_new_approved := (p_decision = 'accept') OR (p_decision = 'reclassify' AND p_categories IS NOT NULL AND array_length(p_categories, 1) > 0);

  UPDATE place_pool SET
    ai_approved = v_new_approved,
    ai_categories = COALESCE(p_categories, ARRAY[]::TEXT[]),
    ai_reason = COALESCE(p_reason, 'Admin override'),
    ai_validated_at = now()
  WHERE id = v_place_id;

  RETURN json_build_object('success', true, 'place_id', v_place_id);
END; $$;

-- ── RPC 8: admin_ai_run_status ───────────────────────────────────────────────

CREATE OR REPLACE FUNCTION admin_ai_run_status(p_job_id UUID)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE run_data JSON; batch_data JSON;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM admin_users WHERE email = lower(auth.email()) AND status = 'active') THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  SELECT row_to_json(t) INTO run_data FROM (
    SELECT id, scope, status, stage, dry_run, category_filter, country_filter, city_filter,
           total_places, processed, approved, rejected, reclassified, low_confidence, failed,
           cost_usd, batch_size, total_batches, completed_batches, failed_batches,
           skipped_batches, created_at, started_at, completed_at
    FROM ai_validation_jobs WHERE id = p_job_id
  ) t;

  IF run_data IS NULL THEN RAISE EXCEPTION 'Run not found: %', p_job_id; END IF;

  SELECT json_agg(row_to_json(t)) INTO batch_data FROM (
    SELECT id, batch_index, status, place_count, accepted, rejected,
           reclassified, low_confidence, failed_places, started_at, completed_at, error_message
    FROM ai_validation_batches WHERE run_id = p_job_id ORDER BY batch_index
  ) t;

  RETURN json_build_object('run', run_data, 'batches', COALESCE(batch_data, '[]'::json));
END; $$;
