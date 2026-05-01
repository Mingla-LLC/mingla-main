-- Cycle B1 Phase 0 — Business schema RLS foundation (no business tables yet).
-- Pure helpers used by policies in later phases. IMMUTABLE rank for role checks.

CREATE OR REPLACE FUNCTION public.biz_role_rank(p_role text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public, pg_temp
AS $$
  SELECT CASE trim(lower(coalesce(p_role, '')))
    WHEN 'scanner' THEN 10
    WHEN 'marketing_manager' THEN 20
    WHEN 'finance_manager' THEN 30
    WHEN 'event_manager' THEN 40
    WHEN 'brand_admin' THEN 50
    WHEN 'account_owner' THEN 60
    ELSE 0
  END;
$$;

COMMENT ON FUNCTION public.biz_role_rank(text) IS
  'Cycle B1: numeric rank for brand_team_members.role comparisons (higher = more privilege).';
