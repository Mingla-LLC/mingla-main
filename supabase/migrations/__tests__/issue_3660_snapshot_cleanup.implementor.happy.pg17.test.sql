-- #3660 Phase 5 — expired snapshot cleanup succeeds under cleanup GUC.
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
VALUES (
  '00000000-3660-4000-8000-000000000301',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'issue3660-snap@example.test', now(), now()
) ON CONFLICT (id) DO NOTHING;

INSERT INTO public.admin_source_refund_query_snapshots (
  id, admin_user_id, normalized_filters, normalized_filter_hash,
  page_size, item_count, created_at, expires_at
) VALUES (
  '00000000-3660-4000-8000-000000000310',
  '00000000-3660-4000-8000-000000000301',
  '{}'::jsonb,
  repeat('a', 64),
  10,
  1,
  statement_timestamp() - interval '20 minutes',
  statement_timestamp() - interval '5 minutes'
);

INSERT INTO public.admin_source_refund_query_snapshot_items (
  snapshot_id, ordinal, item_kind, item_id, safe_summary
) VALUES (
  '00000000-3660-4000-8000-000000000310',
  0,
  'refund_operation',
  '00000000-3660-4000-8000-000000000311',
  '{}'::jsonb
);

DO $$
DECLARE
  v_result jsonb;
  v_left integer;
  v_items_left integer;
BEGIN
  v_result := public.cleanup_admin_source_refund_query_snapshots(500);
  IF (v_result->>'deleted_snapshots')::integer IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'ISSUE-3660 cleanup: expected deleted_snapshots = 1, got %', v_result;
  END IF;
  IF (v_result->>'deleted_items')::integer IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'ISSUE-3660 cleanup: expected deleted_items = 1, got %', v_result;
  END IF;
  SELECT count(*) INTO v_left
  FROM public.admin_source_refund_query_snapshots
  WHERE id = '00000000-3660-4000-8000-000000000310';
  IF v_left <> 0 THEN
    RAISE EXCEPTION 'ISSUE-3660 cleanup: snapshot still present';
  END IF;
  SELECT count(*) INTO v_items_left
  FROM public.admin_source_refund_query_snapshot_items
  WHERE snapshot_id = '00000000-3660-4000-8000-000000000310';
  IF v_items_left <> 0 THEN
    RAISE EXCEPTION 'ISSUE-3660 cleanup: snapshot items still present';
  END IF;
  RAISE NOTICE 'ISSUE-3660 snapshot cleanup happy OK %', v_result;
END $$;

ROLLBACK;
