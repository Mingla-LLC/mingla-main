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
DECLARE v_missing int; v_examined int; v_caught int; v_secrets int; v_named int;
BEGIN
  -- ARM 1 (runs anywhere) — the two jobs this migration owns now name the
  -- secret that exists, and no longer name the ones that never did. This is
  -- the structural claim, and it is true on any database including one whose
  -- vault is empty.
  SELECT count(*) INTO v_named FROM cron.job
   WHERE jobname IN ('keep-functions-warm','orch-0875-process-booking-deadlines')
     AND command LIKE '%name = ''service_role_key''%';
  IF v_named <> 2 THEN
    RAISE EXCEPTION 'PROBE FAIL: expected both jobs to name service_role_key, found %', v_named;
  END IF;
  SELECT count(*) INTO v_named FROM cron.job
   WHERE command LIKE '%supabase_anon_key%' OR command LIKE '%supabase_service_role_key%';
  IF v_named <> 0 THEN
    RAISE EXCEPTION 'PROBE FAIL: % cron(s) still name a secret that does not exist', v_named;
  END IF;

  -- ARM 2 (runs anywhere) — THE AUDIT ACTUALLY CATCHES ONE. Scoped to a
  -- canary this probe creates, so it is meaningful whether the vault is
  -- populated or empty. Without this, "0 missing" would be indistinguishable
  -- from a regex matching nothing — the very failure being fixed.
  PERFORM cron.schedule('issue_2891_probe_canary', '0 5 31 2 *', $canary$
    SELECT (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'issue_2891_secret_that_does_not_exist');
  $canary$);
  SELECT count(*) INTO v_caught FROM public.issue_2891_cron_secret_audit()
   WHERE jobname = 'issue_2891_probe_canary';
  PERFORM cron.unschedule('issue_2891_probe_canary');
  IF v_caught <> 1 THEN
    RAISE EXCEPTION 'PROBE FAIL: the audit did not flag a deliberately broken job — it reports zero because it sees nothing';
  END IF;

  -- ARM 3 (production only) — with a populated vault, NOTHING may be missing.
  -- A from-zero CI replay has no project secrets at all, so every reference
  -- is legitimately unresolvable there and this assertion would be false for
  -- reasons that have nothing to do with the fix. The skip is GUARDED on the
  -- vault being provably empty, never on convenience.
  SELECT count(*) INTO v_secrets FROM vault.decrypted_secrets;
  SELECT count(*) INTO v_examined FROM cron.job WHERE command ILIKE '%vault.decrypted_secrets%';
  IF v_secrets = 0 THEN
    RAISE NOTICE 'issue #2891: vault holds no secrets (from-zero replay); % vault-using crons checked structurally only', v_examined;
  ELSE
    SELECT count(*) INTO v_missing FROM public.issue_2891_cron_secret_audit();
    IF v_missing <> 0 THEN
      RAISE EXCEPTION 'PROBE FAIL: % missing secret reference(s) across % vault-using cron jobs', v_missing, v_examined;
    END IF;
    RAISE NOTICE 'issue #2891: 0 missing references across % vault-using cron jobs', v_examined;
  END IF;
END $probe$;

COMMIT;
