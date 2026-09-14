-- [TEST-MOD-APPROVED #1982] X3 expected abort moves with tip census 137→138.
-- =====================================================================================
-- #3055 adversarial proof — the backlog repair refuses a state it does not own, and
-- leaves it exactly as it found it.
--
-- Run AFTER the complete migration chain on supabase/postgres:17.4.1.075, from the
-- repository checkout (it reads repo files through `git rev-parse`):
--   psql -v ON_ERROR_STOP=1 -f supabase/migrations/__tests__/issue_3055_ari_cert_backlog_repair.adversarial.pg17.test.sql
--
-- Each X-case builds an unexpected starting state, applies the repair, and requires
--   (1) it aborts with the NAMED exception for that state,
--   (2) the requirement set, the three certification functions and the immutability
--       trigger are byte-for-byte what they were before the attempt, and
--   (3) where the trigger was armed before, a DELETE is still refused afterwards.
--
--   X1  chain state, ari.rsvp.update present with the wrong evidence_mode
--   X2  production state plus a stray capability row no migration accounts for
--   X3  chain state plus the same stray row
--   X4  production state with #1980's rows hand-applied (a half-applied backlog)
--   X5  chain-shaped rows under production-shaped functions
--   X6  immutability trigger disabled before the repair runs
--   X7  something outside the repair writes to the set mid-apply: the pre-flight
--       passes, the writes land, the POST-flight refuses, and every write rolls back
--   X8  X7 against the REAL migration file (\ir, its own BEGIN/COMMIT, committed
--       fixture): proves the file's self-wrapped transaction — not this test's —
--       is what undoes the writes. Restores the chain and proves it.
--
-- X1-X7 run the repair's statements through EXECUTE inside one transaction that
-- rolls back (the file's own BEGIN/COMMIT lines are removed and counted first);
-- X8 runs the file itself.
-- =====================================================================================

\set ON_ERROR_STOP on
\set issue_3055_repair_src `cat "$(git rev-parse --show-toplevel)/supabase/migrations/20270630003055_issue_3055_ari_cert_backlog_repair.sql"`
\set issue_3055_sites_src `cat "$(git rev-parse --show-toplevel)/supabase/migrations/20270609002830_issue_2830_mingla_sites_foundation.sql"`

CREATE TEMP TABLE issue_3055_adv_input (name text PRIMARY KEY, body text NOT NULL);
INSERT INTO issue_3055_adv_input (name, body) VALUES
  ('repair', :'issue_3055_repair_src'),
  ('sites_2830', :'issue_3055_sites_src');

CREATE TEMP TABLE issue_3055_adv_snap (label text PRIMARY KEY, snap jsonb NOT NULL);

-- What an aborted repair must leave untouched.
CREATE FUNCTION pg_temp.issue_3055_adv_state()
RETURNS jsonb
LANGUAGE sql
AS $fn$
  SELECT jsonb_build_object(
    'rows', (
      SELECT md5(coalesce(string_agg(r.capability_id || '=' || r.evidence_mode, E'\n'
                                     ORDER BY r.capability_id COLLATE "C"), ''))
      FROM public.ari_cert_capability_requirements r),
    'row_count', (SELECT count(*) FROM public.ari_cert_capability_requirements),
    'functions', (
      SELECT jsonb_object_agg(f.sig, CASE WHEN p.oid IS NULL THEN NULL ELSE jsonb_build_object(
               'prosrc_md5', md5(p.prosrc), 'config', p.proconfig, 'acl', p.proacl::text,
               'comment', obj_description(p.oid, 'pg_proc')) END)
      FROM (VALUES
        ('private.ari_cert_requirements_set_digest_v1()'),
        ('public.ari_cert_begin_run(text,jsonb,text,jsonb,jsonb)'),
        ('public.ari_cert_finalize_run(uuid)')
      ) f(sig)
      LEFT JOIN pg_proc p ON p.oid = to_regprocedure(f.sig)),
    'triggers', (
      SELECT coalesce(jsonb_agg(jsonb_build_array(t.tgname, pg_get_triggerdef(t.oid), t.tgenabled::text)
                                ORDER BY t.tgname), '[]'::jsonb)
      FROM pg_trigger t
      WHERE t.tgrelid = 'public.ari_cert_capability_requirements'::regclass AND NOT t.tgisinternal)
  );
$fn$;

-- The repair's statements without its own BEGIN;/COMMIT; lines, which must exist
-- exactly once each — the X8 case depends on them.
CREATE FUNCTION pg_temp.issue_3055_adv_repair_statements()
RETURNS text
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_src text := (SELECT body FROM issue_3055_adv_input WHERE name = 'repair');
  v_begins integer;
  v_commits integer;
BEGIN
  SELECT count(*) INTO v_begins FROM regexp_matches(v_src, '^BEGIN;$', 'gn');
  SELECT count(*) INTO v_commits FROM regexp_matches(v_src, '^COMMIT;$', 'gn');
  IF v_begins <> 1 OR v_commits <> 1 THEN
    RAISE EXCEPTION 'T-3055-X0: repair must self-wrap in exactly one BEGIN;/COMMIT; (found % / %)', v_begins, v_commits;
  END IF;
  RETURN regexp_replace(regexp_replace(v_src, '^BEGIN;$', '', 'n'), '^COMMIT;$', '', 'n');
END;
$fn$;

-- Apply the repair; return the exception message, or NULL if it did NOT abort.
CREATE FUNCTION pg_temp.issue_3055_adv_attempt()
RETURNS text
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_statements text := pg_temp.issue_3055_adv_repair_statements();
  v_message text;
BEGIN
  BEGIN
    EXECUTE v_statements;
    RETURN NULL;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    RETURN v_message;
  END;
END;
$fn$;

CREATE FUNCTION pg_temp.issue_3055_adv_delete_is_refused()
RETURNS boolean
LANGUAGE plpgsql
AS $fn$
BEGIN
  BEGIN
    DELETE FROM public.ari_cert_capability_requirements
    WHERE capability_id = (SELECT min(capability_id) FROM public.ari_cert_capability_requirements);
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    RETURN true;
  END;
  RAISE EXCEPTION 'T-3055-X: a DELETE on the requirement set succeeded — immutability trigger not in force';
END;
$fn$;

-- Run one case: attempt, require the named abort, require an unchanged state.
CREATE FUNCTION pg_temp.issue_3055_adv_expect_abort(p_case text, p_expected_prefix text, p_trigger_armed boolean)
RETURNS void
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_before jsonb := pg_temp.issue_3055_adv_state();
  v_message text := pg_temp.issue_3055_adv_attempt();
  v_after jsonb := pg_temp.issue_3055_adv_state();
BEGIN
  IF v_message IS NULL THEN
    RAISE EXCEPTION '%: the repair did NOT abort on an unexpected starting state', p_case;
  END IF;
  IF left(v_message, length(p_expected_prefix)) <> p_expected_prefix THEN
    RAISE EXCEPTION '%: aborted for the wrong reason — expected "%…", got "%"', p_case, p_expected_prefix, v_message;
  END IF;
  IF v_after IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION '%: the aborted repair changed state — before % after %', p_case, v_before, v_after;
  END IF;
  IF p_trigger_armed THEN
    PERFORM pg_temp.issue_3055_adv_delete_is_refused();
  END IF;
  RAISE NOTICE '% PASS: refused with "%"; state unchanged%', p_case, v_message,
    CASE WHEN p_trigger_armed THEN '; DELETE still refused' ELSE '' END;
END;
$fn$;

CREATE FUNCTION pg_temp.issue_3055_adv_function_statement(p_src text, p_head text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $fn$
DECLARE
  v_start integer := strpos(p_src, p_head);
  v_rest text;
  v_body_open integer;
  v_after_open text;
  v_body_close integer;
BEGIN
  IF v_start = 0 OR strpos(substr(p_src, v_start + length(p_head)), p_head) > 0 THEN
    RAISE EXCEPTION 'T-3055-X fixture: "%" not declared exactly once', p_head;
  END IF;
  v_rest := substr(p_src, v_start);
  v_body_open := strpos(v_rest, 'AS $function$');
  v_after_open := substr(v_rest, v_body_open + length('AS $function$'));
  v_body_close := strpos(v_after_open, '$function$;');
  IF v_body_open = 0 OR v_body_close = 0 THEN
    RAISE EXCEPTION 'T-3055-X fixture: "%" has no $function$ body', p_head;
  END IF;
  RETURN substr(v_rest, 1, v_body_open + length('AS $function$') - 1 + v_body_close + length('$function$;') - 1);
END;
$fn$;

-- Production's function shape: no helper, #2830's begin/finalize statements.
CREATE FUNCTION pg_temp.issue_3055_adv_production_functions()
RETURNS void
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_sites text := (SELECT body FROM issue_3055_adv_input WHERE name = 'sites_2830');
BEGIN
  DROP FUNCTION private.ari_cert_requirements_set_digest_v1();
  EXECUTE pg_temp.issue_3055_adv_function_statement(v_sites, 'CREATE OR REPLACE FUNCTION public.ari_cert_begin_run(');
  EXECUTE pg_temp.issue_3055_adv_function_statement(v_sites, 'CREATE OR REPLACE FUNCTION public.ari_cert_finalize_run(');
END;
$fn$;

-- Production's requirement rows.
CREATE FUNCTION pg_temp.issue_3055_adv_production_rows()
RETURNS void
LANGUAGE plpgsql
AS $fn$
BEGIN
  ALTER TABLE public.ari_cert_capability_requirements
    DISABLE TRIGGER ari_cert_capability_requirements_immutable_trigger;
  DELETE FROM public.ari_cert_capability_requirements
  WHERE capability_id IN ('ari.rsvp.update', 'ari.marketing.update_draft', 'ari.marketing.delete_draft',
                          'ari.growth.read_report', 'ari.order.refund_preview', 'ari.installment.list',
                          'ari.team.revoke_invitation');
  INSERT INTO public.ari_cert_capability_requirements (capability_id, evidence_mode)
  VALUES ('ari.guests.set_approval', 'write');
  UPDATE public.ari_cert_capability_requirements SET evidence_mode = 'unsupported'
  WHERE capability_id = 'ari.rsvp.contribution_settings';
  ALTER TABLE public.ari_cert_capability_requirements
    ENABLE TRIGGER ari_cert_capability_requirements_immutable_trigger;
END;
$fn$;

-- Mid-apply interference: when the repair inserts ari.rsvp.update, a stray row
-- lands too. Nothing in the pre-flight can see it coming.
CREATE FUNCTION pg_temp.issue_3055_adv_interfere()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF NEW.capability_id = 'ari.rsvp.update' THEN
    INSERT INTO public.ari_cert_capability_requirements (capability_id, evidence_mode)
    VALUES ('ari.stray.written_mid_apply', 'write');
  END IF;
  RETURN NULL;
END;
$fn$;

SELECT set_config('issue_3055_adv.chain', pg_temp.issue_3055_adv_state()::text, false);

-- =====================================================================================
-- X1-X7, in one transaction that rolls back. Each case its own savepoint.
-- =====================================================================================
BEGIN;

SAVEPOINT x1;
ALTER TABLE public.ari_cert_capability_requirements DISABLE TRIGGER ari_cert_capability_requirements_immutable_trigger;
UPDATE public.ari_cert_capability_requirements SET evidence_mode = 'read' WHERE capability_id = 'ari.rsvp.update';
ALTER TABLE public.ari_cert_capability_requirements ENABLE TRIGGER ari_cert_capability_requirements_immutable_trigger;
SELECT pg_temp.issue_3055_adv_expect_abort('T-3055-X1',
  'issue_3055_preflight_unexpected_requirement_row: ari.rsvp.update (#1977) evidence_mode=read, expected ABSENT (production) or write (chain)',
  true);
ROLLBACK TO SAVEPOINT x1;

SAVEPOINT x2;
SELECT pg_temp.issue_3055_adv_production_rows();
SELECT pg_temp.issue_3055_adv_production_functions();
INSERT INTO public.ari_cert_capability_requirements (capability_id, evidence_mode) VALUES ('ari.stray.unknown_capability', 'write');
SELECT pg_temp.issue_3055_adv_expect_abort('T-3055-X2',
  'issue_3055_preflight_requirements_disagree_with_live_finalizer: 133 requirement rows but ari_cert_finalize_run demands 132 capabilities',
  true);
ROLLBACK TO SAVEPOINT x2;

SAVEPOINT x3;
INSERT INTO public.ari_cert_capability_requirements (capability_id, evidence_mode) VALUES ('ari.stray.unknown_capability', 'read');
SELECT pg_temp.issue_3055_adv_expect_abort('T-3055-X3',
  'issue_3055_preflight_requirements_disagree_with_live_finalizer: 139 requirement rows but ari_cert_finalize_run demands 138 capabilities',
  true);
ROLLBACK TO SAVEPOINT x3;

SAVEPOINT x4;
SELECT pg_temp.issue_3055_adv_production_rows();
SELECT pg_temp.issue_3055_adv_production_functions();
INSERT INTO public.ari_cert_capability_requirements (capability_id, evidence_mode)
VALUES ('ari.marketing.update_draft', 'write'), ('ari.marketing.delete_draft', 'write'), ('ari.growth.read_report', 'read');
SELECT pg_temp.issue_3055_adv_expect_abort('T-3055-X4',
  'issue_3055_preflight_partially_applied_backlog:',
  true);
ROLLBACK TO SAVEPOINT x4;

SAVEPOINT x5;
SELECT pg_temp.issue_3055_adv_production_functions();
SELECT pg_temp.issue_3055_adv_expect_abort('T-3055-X5',
  'issue_3055_preflight_functions_disagree_with_rows: rows are chain-shaped but helper_present=false',
  true);
ROLLBACK TO SAVEPOINT x5;

SAVEPOINT x6;
ALTER TABLE public.ari_cert_capability_requirements DISABLE TRIGGER ari_cert_capability_requirements_immutable_trigger;
SELECT pg_temp.issue_3055_adv_expect_abort('T-3055-X6',
  'issue_3055_preflight_immutability_trigger_unexpected: present=1 enabled=D',
  false);
ROLLBACK TO SAVEPOINT x6;

SAVEPOINT x7;
SELECT pg_temp.issue_3055_adv_production_rows();
SELECT pg_temp.issue_3055_adv_production_functions();
CREATE TRIGGER issue_3055_adv_interference
AFTER INSERT ON public.ari_cert_capability_requirements
FOR EACH ROW EXECUTE FUNCTION pg_temp.issue_3055_adv_interfere();
SELECT pg_temp.issue_3055_adv_expect_abort('T-3055-X7',
  'issue_3055_postflight_net_delta_mismatch: baseline=132 final=138 moved=6 expected=5 (starting shape production)',
  true);
ROLLBACK TO SAVEPOINT x7;

ROLLBACK;

DO $x_rolled_back$
BEGIN
  IF pg_temp.issue_3055_adv_state()::text IS DISTINCT FROM current_setting('issue_3055_adv.chain') THEN
    RAISE EXCEPTION 'T-3055-X1..X7: the rolled-back cases left residue on the chain';
  END IF;
END;
$x_rolled_back$;

-- =====================================================================================
-- X8 — the REAL file, committed fixture. Its own transaction must undo its writes.
-- =====================================================================================
BEGIN;
SELECT pg_temp.issue_3055_adv_production_rows();
SELECT pg_temp.issue_3055_adv_production_functions();
CREATE TRIGGER issue_3055_adv_interference
AFTER INSERT ON public.ari_cert_capability_requirements
FOR EACH ROW EXECUTE FUNCTION pg_temp.issue_3055_adv_interfere();
COMMIT;
SELECT set_config('issue_3055_adv.x8_before', pg_temp.issue_3055_adv_state()::text, false);

\echo 'T-3055-X8: the ERROR lines that follow are EXPECTED — the real repair file must abort at its post-flight and roll itself back.'
\set ON_ERROR_STOP off
\ir ../20270630003055_issue_3055_ari_cert_backlog_repair.sql
\set ON_ERROR_STOP on
SELECT set_config('issue_3055_adv.x8_error', :'LAST_ERROR_MESSAGE', false);

DO $x8$
DECLARE
  v_error text := current_setting('issue_3055_adv.x8_error');
  v_before text := current_setting('issue_3055_adv.x8_before');
  v_after text := pg_temp.issue_3055_adv_state()::text;
BEGIN
  IF left(v_error, length('issue_3055_postflight_net_delta_mismatch: baseline=132 final=138 moved=6 expected=5'))
     <> 'issue_3055_postflight_net_delta_mismatch: baseline=132 final=138 moved=6 expected=5' THEN
    RAISE EXCEPTION 'T-3055-X8: the real file did not abort at its post-flight — last error "%"', v_error;
  END IF;
  IF v_after IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION 'T-3055-X8: the real file''s writes survived its abort — before % after %', v_before, v_after;
  END IF;
  IF (SELECT count(*) FROM public.ari_cert_capability_requirements WHERE capability_id = 'ari.guests.set_approval') <> 1
     OR to_regprocedure('private.ari_cert_requirements_set_digest_v1()') IS NOT NULL THEN
    RAISE EXCEPTION 'T-3055-X8: production state not intact after the aborted apply';
  END IF;
  PERFORM pg_temp.issue_3055_adv_delete_is_refused();
  RAISE NOTICE 'T-3055-X8 PASS: real file aborted with "%"; its DELETE/UPDATE/INSERTs, trigger drop and function replacement all rolled back; DELETE still refused', v_error;
END;
$x8$;

-- Restore: remove the interference, then the repair itself converges the fixture
-- back onto the chain. Prove it.
BEGIN;
DROP TRIGGER issue_3055_adv_interference ON public.ari_cert_capability_requirements;
COMMIT;
\ir ../20270630003055_issue_3055_ari_cert_backlog_repair.sql
-- [TEST-MOD-APPROVED #1982] Tip census after #3055 is #1982 (137→138).
\ir ../20270703001982_issue_1982_ari_cert_capability_census.sql

DO $restored$
BEGIN
  IF pg_temp.issue_3055_adv_state()::text IS DISTINCT FROM current_setting('issue_3055_adv.chain') THEN
    RAISE EXCEPTION 'T-3055-X8: restoring the chain failed — % vs %', pg_temp.issue_3055_adv_state(), current_setting('issue_3055_adv.chain');
  END IF;
  RAISE NOTICE '#3055 adversarial: X1-X8 refused with named exceptions, no residue, chain restored — ALL PASSED';
END;
$restored$;
