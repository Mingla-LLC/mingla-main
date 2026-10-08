-- #3660 Phase 5 — non-cleanup delete and non-expired cleanup still refuse.
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
VALUES (
  '00000000-3660-4000-8000-000000000401',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'issue3660-snap-adv@example.test', now(), now()
) ON CONFLICT (id) DO NOTHING;

-- Fresh (not expired) snapshot.
INSERT INTO public.admin_source_refund_query_snapshots (
  id, admin_user_id, normalized_filters, normalized_filter_hash,
  page_size, item_count, created_at, expires_at
) VALUES (
  '00000000-3660-4000-8000-000000000410',
  '00000000-3660-4000-8000-000000000401',
  '{}'::jsonb,
  repeat('b', 64),
  10,
  0,
  statement_timestamp(),
  statement_timestamp() + interval '15 minutes'
);

DO $$
BEGIN
  BEGIN
    DELETE FROM public.admin_source_refund_query_snapshots
    WHERE id = '00000000-3660-4000-8000-000000000410';
    RAISE EXCEPTION 'ISSUE-3660 adv: delete without cleanup GUC must fail';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM IS DISTINCT FROM 'immutable_snapshot' THEN
      RAISE;
    END IF;
  END;

  -- Cleanup must not delete non-expired rows.
  PERFORM public.cleanup_admin_source_refund_query_snapshots(500);
  IF NOT EXISTS (
    SELECT 1 FROM public.admin_source_refund_query_snapshots
    WHERE id = '00000000-3660-4000-8000-000000000410'
  ) THEN
    RAISE EXCEPTION 'ISSUE-3660 adv: non-expired snapshot was cleaned';
  END IF;

  -- NULL p_limit must not become unbounded LIMIT NULL.
  BEGIN
    PERFORM public.cleanup_admin_source_refund_query_snapshots(NULL);
    RAISE EXCEPTION 'ISSUE-3660 adv: NULL p_limit must fail';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM IS DISTINCT FROM 'invalid_limit' THEN
      RAISE;
    END IF;
  END;

  -- JWT service_role arm: login role is neither postgres nor service_role.
  -- CREATE/DROP ROLE are non-transactional — revoke grants before drop.
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'issue_3660_snap_jwt') THEN
      EXECUTE 'REVOKE ALL ON FUNCTION public.cleanup_admin_source_refund_query_snapshots(integer) FROM issue_3660_snap_jwt';
      EXECUTE format('REVOKE issue_3660_snap_jwt FROM %I', session_user);
      EXECUTE 'DROP ROLE issue_3660_snap_jwt';
    END IF;
    EXECUTE 'CREATE ROLE issue_3660_snap_jwt NOINHERIT';
    GRANT EXECUTE ON FUNCTION public.cleanup_admin_source_refund_query_snapshots(integer)
      TO issue_3660_snap_jwt;
    EXECUTE format('GRANT issue_3660_snap_jwt TO %I', session_user);
    PERFORM set_config('request.jwt.claim.role', 'service_role', true);
    EXECUTE 'SET LOCAL ROLE issue_3660_snap_jwt';
    PERFORM public.cleanup_admin_source_refund_query_snapshots(500);
    RESET ROLE;
    PERFORM set_config('request.jwt.claim.role', '', true);
    EXECUTE 'REVOKE ALL ON FUNCTION public.cleanup_admin_source_refund_query_snapshots(integer) FROM issue_3660_snap_jwt';
    EXECUTE format('REVOKE issue_3660_snap_jwt FROM %I', session_user);
    EXECUTE 'DROP ROLE issue_3660_snap_jwt';
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'issue_3660_snap_jwt') THEN
      EXECUTE 'REVOKE ALL ON FUNCTION public.cleanup_admin_source_refund_query_snapshots(integer) FROM issue_3660_snap_jwt';
      BEGIN
        EXECUTE format('REVOKE issue_3660_snap_jwt FROM %I', session_user);
      EXCEPTION WHEN OTHERS THEN
        NULL;
      END;
      EXECUTE 'DROP ROLE issue_3660_snap_jwt';
    END IF;
    RAISE;
  END;

  RAISE NOTICE 'ISSUE-3660 snapshot cleanup adversarial OK';
END $$;

ROLLBACK;
