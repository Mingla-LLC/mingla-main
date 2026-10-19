-- Issue #3720 — tighten roadmap card column access.
-- Signed-in clients keep reading published roadmap cards through the existing
-- row policy, but the staff-only internal_note column is no longer selectable
-- by the authenticated role. Mingla Admin reads cards, including the note,
-- through issue_3720_admin_list_roadmap_cards(), which returns the note only
-- to an active Admin.
-- INVARIANT: {"id":"I-3720-ROADMAP-INTERNAL-NOTE-ADMIN-ONLY","rule":"The authenticated role holds column-level SELECT on every community_roadmap_cards column except internal_note; internal_note is readable only through a SECURITY DEFINER read that checks is_admin_user()."}

BEGIN;
SET LOCAL lock_timeout = '10s';

DO $foundation$
BEGIN
  IF to_regclass('public.community_roadmap_cards') IS NULL
     OR to_regprocedure('public.is_admin_user()') IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_policy
        WHERE polrelid = 'public.community_roadmap_cards'::regclass
          AND polname = 'community_roadmap_cards_host_read'
     ) THEN
    RAISE EXCEPTION 'issue3720_roadmap_column_access_foundation_missing';
  END IF;
END;
$foundation$;

REVOKE SELECT ON TABLE public.community_roadmap_cards FROM PUBLIC, anon, authenticated;

DO $grant$
DECLARE
  v_columns text;
BEGIN
  SELECT string_agg(format('%I', a.attname), ', ' ORDER BY a.attnum)
    INTO v_columns
    FROM pg_catalog.pg_attribute a
   WHERE a.attrelid = 'public.community_roadmap_cards'::regclass
     AND a.attnum > 0
     AND NOT a.attisdropped
     AND a.attname <> 'internal_note';
  EXECUTE format(
    'GRANT SELECT (%s) ON TABLE public.community_roadmap_cards TO authenticated',
    v_columns
  );
END;
$grant$;

CREATE OR REPLACE FUNCTION public.issue_3720_admin_list_roadmap_cards()
RETURNS TABLE (
  id uuid,
  public_title text,
  public_body text,
  internal_note text,
  lane text,
  status text,
  sort_order integer,
  shipped_at timestamptz,
  target_label text,
  idea_count integer,
  avengers_item_id uuid,
  source_signal_id uuid,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT c.id, c.public_title, c.public_body, c.internal_note, c.lane, c.status,
         c.sort_order, c.shipped_at, c.target_label, c.idea_count,
         c.avengers_item_id, c.source_signal_id, c.created_at, c.updated_at
    FROM public.community_roadmap_cards c
   ORDER BY c.sort_order, c.id;
END;
$$;

REVOKE ALL ON FUNCTION public.issue_3720_admin_list_roadmap_cards() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_3720_admin_list_roadmap_cards() TO authenticated, service_role;

DO $postcheck$
BEGIN
  IF has_column_privilege('authenticated', 'public.community_roadmap_cards', 'internal_note', 'SELECT')
     OR has_table_privilege('authenticated', 'public.community_roadmap_cards', 'SELECT')
     OR has_column_privilege('anon', 'public.community_roadmap_cards', 'internal_note', 'SELECT')
     OR NOT has_column_privilege('authenticated', 'public.community_roadmap_cards', 'public_title', 'SELECT')
     OR NOT has_column_privilege('authenticated', 'public.community_roadmap_cards', 'status', 'SELECT')
     OR NOT has_column_privilege('service_role', 'public.community_roadmap_cards', 'internal_note', 'SELECT')
     OR has_function_privilege('anon', 'public.issue_3720_admin_list_roadmap_cards()', 'EXECUTE') THEN
    RAISE EXCEPTION 'issue3720_roadmap_column_access_not_applied';
  END IF;
END;
$postcheck$;

COMMIT;
