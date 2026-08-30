-- =====================================================================================
-- #2592 implementor proof — Ari certification cannot certify a short evidence set.
--
-- Run AFTER the complete migration chain has been applied to a fresh
-- supabase/postgres:17.4.1.075:
--   psql -v ON_ERROR_STOP=1 -f supabase/migrations/__tests__/issue_2592_ari_cert_denominator.implementor.pg17.test.sql
--
-- The production defect this closes: `public.ari_cert_capability_requirements`
-- carried 117 rows while `docs/contracts/ari-capability-ledger.json` carried 120
-- capabilities, and the deployed finalizer measured evidence against the shorter
-- number. A run could therefore certify as complete while three capabilities had
-- no evidence at all. #1978 adds the three missing requirement rows and forward-
-- replaces `ari_cert_finalize_run` with the 120 denominator; this test is the
-- executable guard that the requirement set and the denominator can never drift
-- apart again, in either direction.
--
-- [TEST-MOD-APPROVED #2830] 132 is the ledger denominator after the twelve
-- approved Website tools. It is not a free constant: the same number is
-- enforced against `docs/contracts/ari-capability-ledger.json` and the tool
-- registry by `.github/scripts/strict-grep/issue-2000-ari-capability-ledger.mjs`
-- ("132 capabilities, 97 registered tools, complete bijection"). Moving the
-- ledger without moving this test turns this file red on purpose.
--
-- All fixtures roll back.
-- =====================================================================================

\set ON_ERROR_STOP on

BEGIN;

DO $test$
DECLARE
  c_ledger_denominator constant integer := 132;
  v_requirement_rows integer;
  v_finalizer_denominator integer;
  v_reported_count integer;
  v_definition text;
  v_run_id uuid;
  v_release_sha constant text := repeat('a', 40);
  v_native constant jsonb := '[
    {"surface":"business_ios_simulator","artifact_id":"issue-2592-ios-sim","runtime_version":"1.1.5","device":"iPhone simulator"},
    {"surface":"business_ios_physical","artifact_id":"issue-2592-ios-phys","runtime_version":"1.1.5","device":"Physical iPhone"},
    {"surface":"business_android","artifact_id":"issue-2592-android","runtime_version":"1.1.5","device":"Pixel 7"}
  ]'::jsonb;
  v_finalized boolean;
  v_message text;
  v_status text;
BEGIN
  -- ---------------------------------------------------------------------------
  -- 1. The requirement set is exactly the ledger denominator — never shorter.
  -- ---------------------------------------------------------------------------
  SELECT count(*) INTO v_requirement_rows
  FROM public.ari_cert_capability_requirements;
  IF v_requirement_rows < c_ledger_denominator THEN
    RAISE EXCEPTION
      'issue_2592_requirement_set_shorter_than_ledger: % rows against a % capability ledger',
      v_requirement_rows, c_ledger_denominator;
  END IF;
  IF v_requirement_rows <> c_ledger_denominator THEN
    RAISE EXCEPTION
      'issue_2592_requirement_set_drifted_from_ledger: % rows against a % capability ledger',
      v_requirement_rows, c_ledger_denominator;
  END IF;

  -- The three capabilities that were missing in production specifically.
  IF (
    SELECT count(*) FROM public.ari_cert_capability_requirements
    WHERE capability_id IN (
      'ari.venue.list_listings',
      'ari.venue.get_listing_status',
      'ari.venue.list_claim_feedback'
    )
  ) <> 3 THEN
    RAISE EXCEPTION 'issue_2592_venue_read_requirements_missing';
  END IF;

  -- ---------------------------------------------------------------------------
  -- 2. The finalizer measures against that SAME number. A requirement row added
  --    without moving the denominator (or the reverse) is exactly the 117-vs-120
  --    shape of the production defect, and must fail here.
  -- ---------------------------------------------------------------------------
  v_definition := pg_get_functiondef(
    'public.ari_cert_finalize_run(uuid)'::regprocedure
  );
  v_finalizer_denominator :=
    (regexp_match(v_definition, 'v_capability_count <> ([0-9]+)'))[1]::integer;
  IF v_finalizer_denominator IS NULL THEN
    RAISE EXCEPTION 'issue_2592_finalizer_has_no_capability_denominator';
  END IF;
  IF v_finalizer_denominator <> v_requirement_rows THEN
    RAISE EXCEPTION
      'issue_2592_finalizer_denominator_drift: finalizer demands % capabilities against a % row requirement set',
      v_finalizer_denominator, v_requirement_rows;
  END IF;

  -- The number the finalizer REPORTS on success must agree as well; a stale
  -- literal there is how a short run reads as a complete one downstream.
  v_reported_count :=
    (regexp_match(v_definition, '''capability_count'', ([0-9]+)'))[1]::integer;
  IF v_reported_count IS DISTINCT FROM v_requirement_rows THEN
    RAISE EXCEPTION
      'issue_2592_finalizer_reports_wrong_capability_count:%', v_reported_count;
  END IF;

  -- ---------------------------------------------------------------------------
  -- 3. Executable: a run whose evidence covers fewer capabilities than the
  --    denominator FAILS CLOSED. It must raise, and the run must not become
  --    terminal.
  -- ---------------------------------------------------------------------------
  SET LOCAL ROLE service_role;
  v_run_id := public.ari_cert_begin_run(
    v_release_sha,
    '{"agent_chat":"v511","agent_confirm_action":"v511"}'::jsonb,
    'issue-2592-web-deployment',
    v_native,
    '{}'::jsonb
  );
  -- Every declared native artifact needs its matching release artifact, so the
  -- run reaches the capability check instead of stopping at the artifact gate.
  PERFORM public.ari_cert_record_release_artifact(
    v_run_id, 'business_ios_simulator', 'issue-2592-ios-sim',
    v_release_sha, repeat('b', 64)
  );
  PERFORM public.ari_cert_record_release_artifact(
    v_run_id, 'business_ios_physical', 'issue-2592-ios-phys',
    v_release_sha, repeat('c', 64)
  );
  PERFORM public.ari_cert_record_release_artifact(
    v_run_id, 'business_android', 'issue-2592-android',
    v_release_sha, repeat('d', 64)
  );
  RESET ROLE;

  v_finalized := false;
  v_message := NULL;
  BEGIN
    PERFORM public.ari_cert_finalize_run(v_run_id);
    v_finalized := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
  END;
  IF v_finalized THEN
    RAISE EXCEPTION
      'issue_2592_short_evidence_set_certified: a run with zero capability evidence passed finalization';
  END IF;
  IF v_message NOT LIKE 'ari_cert_missing_capabilities:%' THEN
    RAISE EXCEPTION
      'issue_2592_short_evidence_set_stopped_for_the_wrong_reason:%', v_message;
  END IF;
  IF v_message <> 'ari_cert_missing_capabilities:0' THEN
    RAISE EXCEPTION
      'issue_2592_capability_count_is_not_measured_from_evidence:%', v_message;
  END IF;

  SELECT status INTO v_status FROM public.ari_cert_runs WHERE id = v_run_id;
  IF v_status = 'passed' THEN
    RAISE EXCEPTION 'issue_2592_run_became_terminal_after_a_failed_finalization';
  END IF;

  RAISE NOTICE
    '#2592 Ari certification denominator: % requirement rows, finalizer demands %, short run refused with "%" — ALL PASSED',
    v_requirement_rows, v_finalizer_denominator, v_message;
END;
$test$;

ROLLBACK;
