-- Fix: "column reference 'status' is ambiguous" in card generation RPCs
--
-- Both admin_card_generation_status and admin_card_generation_active declare
-- `status TEXT` in RETURNS TABLE, which shadows `admin_users.status` in the
-- auth check. PostgreSQL raises ERROR 42702 at runtime, silently breaking
-- the admin progress polling.
--
-- Fix: qualify as `admin_users.status` in both auth checks.

-- ─── Fix 1: admin_card_generation_status ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_card_generation_status(p_run_id UUID)
RETURNS TABLE (
  id                   UUID,
  status               TEXT,
  city                 TEXT,
  country              TEXT,
  total_categories     INTEGER,
  completed_categories INTEGER,
  current_category     TEXT,
  total_created        INTEGER,
  total_skipped        INTEGER,
  skipped_no_photos    INTEGER,
  skipped_duplicate    INTEGER,
  skipped_child_venue  INTEGER,
  total_eligible       INTEGER,
  category_results     JSONB,
  error_message        TEXT,
  started_at           TIMESTAMPTZ,
  completed_at         TIMESTAMPTZ
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.admin_users
    WHERE email = auth.email() AND admin_users.status = 'active'
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN QUERY
  SELECT r.id, r.status, r.city, r.country,
         r.total_categories, r.completed_categories, r.current_category,
         r.total_created, r.total_skipped,
         r.skipped_no_photos, r.skipped_duplicate, r.skipped_child_venue,
         r.total_eligible, r.category_results, r.error_message,
         r.started_at, r.completed_at
  FROM public.card_generation_runs r
  WHERE r.id = p_run_id;
END;
$$;

-- ─── Fix 2: admin_card_generation_active ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_card_generation_active(p_city TEXT)
RETURNS TABLE (
  id                   UUID,
  status               TEXT,
  total_categories     INTEGER,
  completed_categories INTEGER,
  current_category     TEXT,
  total_created        INTEGER,
  total_skipped        INTEGER,
  total_eligible       INTEGER,
  category_results     JSONB,
  started_at           TIMESTAMPTZ
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.admin_users
    WHERE email = auth.email() AND admin_users.status = 'active'
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN QUERY
  SELECT r.id, r.status, r.total_categories, r.completed_categories,
         r.current_category, r.total_created, r.total_skipped,
         r.total_eligible, r.category_results, r.started_at
  FROM public.card_generation_runs r
  WHERE r.city = p_city AND r.status = 'running'
  ORDER BY r.started_at DESC
  LIMIT 1;
END;
$$;
