-- Issue #1644 — Stage 0 storage guardrail: measurement RPC.
--
-- Supabase Storage is at ~78.21 GiB of a 100 GiB quota and the spend cap is
-- ARMED, so crossing the quota triggers a Fair-Use restriction that can put the
-- database into READ-ONLY mode org-wide rather than simply costing money. The
-- realistic path to that outcome is a re-run of the place-photo/collage
-- backfill, which was measured at 29.3 GiB/week and would exhaust the 21.79 GiB
-- of headroom in about five days.
--
-- The backfill edge functions refuse to start above a ceiling (85 GiB by
-- default, overridable via the STORAGE_BACKFILL_MAX_BYTES env var). They need a
-- way to read total storage usage, but `storage.objects` is NOT exposed through
-- PostgREST, so a `public` SECURITY DEFINER wrapper is the only route.
--
-- COST: the sum cannot be indexed — the size lives inside the `metadata` jsonb
-- column — so this is a full parallel seq scan of `storage.objects`
-- (420,010 rows / ~214 MiB of buffers; measured cold 854 ms, warm 118 ms on
-- production 2026-08-05). Callers memoise the result for 60 s and only invoke
-- it once they know there is real work to do, so the every-10-minute
-- `kick_pending_thumb_backfill` empty-queue tick never reaches it.
--
-- SECURITY: service_role ONLY. This is operational telemetry about the whole
-- project's storage footprint; anon/authenticated have no business reading it,
-- so it never needs an entry in
-- supabase/security/anon_executable_definer_allowlist.txt (ORCH-1392 gate).

CREATE OR REPLACE FUNCTION public.issue_1644_storage_total_bytes()
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
  SELECT COALESCE(SUM((o.metadata ->> 'size')::bigint), 0)::bigint
  FROM storage.objects o;
$function$;

REVOKE ALL ON FUNCTION public.issue_1644_storage_total_bytes() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.issue_1644_storage_total_bytes() FROM anon;
REVOKE ALL ON FUNCTION public.issue_1644_storage_total_bytes() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.issue_1644_storage_total_bytes() TO service_role;

COMMENT ON FUNCTION public.issue_1644_storage_total_bytes() IS
  'Issue #1644 storage guardrail: total bytes across storage.objects, summed from '
  'metadata->>''size''. Read by the place-photo / place-collage backfill edge functions, '
  'which refuse to start above the STORAGE_BACKFILL_MAX_BYTES ceiling (default 85 GiB) '
  'because the 100 GiB quota is spend-capped and an overage can force the database '
  'read-only. service_role only. Full seq scan — callers memoise for 60s.';
