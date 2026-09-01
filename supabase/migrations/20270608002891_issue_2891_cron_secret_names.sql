-- ===========================================================================
-- #2891 — two cron jobs have 401'd on every run since they were created.
--
-- THE DEFECT IS ONE WRONG WORD, TWICE.
--
--   'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets
--                  WHERE name = 'supabase_anon_key')
--
-- There is no secret by that name. The subquery returns NULL, and in SQL
-- 'Bearer ' || NULL is NULL — so the header does not come out WRONG, it does
-- not come out AT ALL. jsonb_build_object emits a null value and the edge
-- function answers UNAUTHORIZED_NO_AUTH_HEADER.
--
-- The vault holds exactly two secrets: service_role_key and supabase_url.
--   keep-functions-warm                  wanted 'supabase_anon_key'
--   orch-0875-process-booking-deadlines  wanted 'supabase_service_role_key'
--
-- WHY IT SURVIVED. cron.job_run_details reports 'succeeded' for every run —
-- truthfully. The SQL statement DID succeed: it enqueued a pg_net request. The
-- 401 arrives later in net._http_response, which nothing watches. An all-green
-- cron dashboard is entirely compatible with the work never happening.
--
-- So the rename alone would fix these two and leave the NEXT one just as
-- invisible. issue_2891_cron_secret_audit() closes that: it lists every cron
-- referencing a vault secret that does not exist, which is a query anyone can
-- run instead of an accident anyone must have.
--
-- Only the secret NAME changes. Schedule, URL, body and header casing are
-- reproduced exactly as they are installed today.
-- ===========================================================================

BEGIN;

SELECT cron.schedule('keep-functions-warm', '*/5 * * * *', $cron$
SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1) || '/functions/v1/keep-warm',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
    ),
    body := '{}'::jsonb
  );
$cron$);

SELECT cron.schedule('orch-0875-process-booking-deadlines', '0 * * * *', $cron$
SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url') || '/functions/v1/process-booking-deadlines',
    headers := jsonb_build_object(
      'authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key'),
      'content-type', 'application/json'
    ),
    body := '{}'::jsonb
  )
$cron$);

-- ── the detector ───────────────────────────────────────────────────────────
-- Returns one row per (job, missing secret). Empty is the healthy state, and
-- the row count is the whole answer — no interpretation required.
CREATE OR REPLACE FUNCTION public.issue_2891_cron_secret_audit()
RETURNS TABLE(jobname text, missing_secret text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, cron, vault AS $$
  WITH refs AS (
    SELECT j.jobname::text AS jobname,
           (regexp_matches(j.command, 'name\s*=\s*''([a-zA-Z0-9_]+)''', 'g'))[1] AS secret
      FROM cron.job j
     WHERE j.command ILIKE '%vault.decrypted_secrets%'
  )
  SELECT DISTINCT r.jobname, r.secret
    FROM refs r
    LEFT JOIN vault.decrypted_secrets s ON s.name = r.secret
   WHERE s.name IS NULL
   ORDER BY 1, 2;
$$;

REVOKE ALL ON FUNCTION public.issue_2891_cron_secret_audit() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.issue_2891_cron_secret_audit() IS
  'issue #2891 — every cron referencing a vault secret that does not exist. Empty means healthy. Exists because a missing secret concatenates to NULL and silently drops the auth header, while cron.job_run_details still reports success.';

-- ── probe ──────────────────────────────────────────────────────────────────
DO $probe$
DECLARE v_missing int; v_examined int; v_caught int;
BEGIN
  -- 1. the two named jobs now reference a secret that EXISTS
  SELECT count(*) INTO v_missing FROM public.issue_2891_cron_secret_audit();
  SELECT count(*) INTO v_examined FROM cron.job WHERE command ILIKE '%vault.decrypted_secrets%';
  IF v_examined < 1 THEN
    RAISE EXCEPTION 'PROBE FAIL: no cron references the vault at all — the audit would be vacuous';
  END IF;
  IF v_missing <> 0 THEN
    RAISE EXCEPTION 'PROBE FAIL: % of % vault-using crons still name a missing secret', v_missing, v_examined;
  END IF;
  RAISE NOTICE 'issue #2891: 0 missing secrets across % vault-using cron jobs', v_examined;

  -- 2. THE AUDIT ACTUALLY CATCHES ONE. Without this, "0 missing" is
  --    indistinguishable from a regex that matches nothing — which is exactly
  --    the failure mode this whole migration exists to fix.
  PERFORM cron.schedule('issue_2891_probe_canary', '0 5 31 2 *', $canary$
    SELECT (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'issue_2891_secret_that_does_not_exist');
  $canary$);
  SELECT count(*) INTO v_caught FROM public.issue_2891_cron_secret_audit()
   WHERE jobname = 'issue_2891_probe_canary';
  PERFORM cron.unschedule('issue_2891_probe_canary');
  IF v_caught <> 1 THEN
    RAISE EXCEPTION 'PROBE FAIL: the audit did not flag a deliberately broken job — it reports zero because it sees nothing';
  END IF;
  RAISE NOTICE 'issue #2891: audit correctly flagged the canary, then it was removed';

  -- 3. the canary is gone; the audit must be clean again
  SELECT count(*) INTO v_missing FROM public.issue_2891_cron_secret_audit();
  IF v_missing <> 0 THEN
    RAISE EXCEPTION 'PROBE FAIL: canary survived cleanup, audit reports %', v_missing;
  END IF;
END $probe$;

COMMIT;
