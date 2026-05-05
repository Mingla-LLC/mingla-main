-- Persistent job tracking for AI place validation
CREATE TABLE IF NOT EXISTS ai_validation_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed', 'cancelled')),
  revalidate BOOLEAN NOT NULL DEFAULT false,
  country_filter TEXT,
  city_filter TEXT,
  total_places INTEGER NOT NULL DEFAULT 0,
  processed INTEGER NOT NULL DEFAULT 0,
  approved INTEGER NOT NULL DEFAULT 0,
  rejected INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  continuation_token TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS: only admins can access
ALTER TABLE ai_validation_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_full_access_ai_validation_jobs" ON ai_validation_jobs
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM admin_users
      WHERE email = lower(auth.email())
        AND status = 'active'
    )
  );
