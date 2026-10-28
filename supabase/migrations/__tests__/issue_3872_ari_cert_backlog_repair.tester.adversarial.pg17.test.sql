-- #3872 adversarial proof: partial, polluted, wrong-mode, disabled-trigger, and
-- mid-apply interference states are refused without changing the database.

\set ON_ERROR_STOP on
\set issue_3872_adv_repair_src `cat "$(git rev-parse --show-toplevel)/supabase/migrations/20280204013872_issue_3872_ari_cert_backlog_repair.sql"`
\set issue_3872_adv_r1_src `cat "$(git rev-parse --show-toplevel)/supabase/migrations/20271216043872_issue_3872_r1_host_operations.sql"`
\set issue_3872_adv_r2_src `cat "$(git rev-parse --show-toplevel)/supabase/migrations/20271229003872_issue_3872_ari_cert_capability_census.sql"`

CREATE TEMP TABLE issue_3872_adv_input (name text PRIMARY KEY, body text NOT NULL);
INSERT INTO issue_3872_adv_input (name, body) VALUES
  ('repair', :'issue_3872_adv_repair_src'),
  ('r1', :'issue_3872_adv_r1_src'),
  ('r2', :'issue_3872_adv_r2_src');

CREATE FUNCTION pg_temp.issue_3872_adv_function_statement(p_src text, p_head text)
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
    RAISE EXCEPTION 'issue_3872_adv_fixture_function_not_unique:%', p_head;
  END IF;
  v_rest := substr(p_src, v_start);
  v_body_open := strpos(v_rest, 'AS $function$');
  v_after_open := substr(v_rest, v_body_open + length('AS $function$'));
  v_body_close := strpos(v_after_open, '$function$;');
  IF v_body_open = 0 OR v_body_close = 0 THEN
    RAISE EXCEPTION 'issue_3872_adv_fixture_function_body_missing:%', p_head;
  END IF;
  RETURN substr(v_rest, 1,
    v_body_open + length('AS $function$') - 1 + v_body_close + length('$function$;') - 1);
END;
$fn$;

CREATE FUNCTION pg_temp.issue_3872_adv_state()
RETURNS jsonb
LANGUAGE sql
STABLE
AS $fn$
  SELECT jsonb_build_object(
    'rows', (
      SELECT jsonb_agg(jsonb_build_array(capability_id, evidence_mode)
                       ORDER BY capability_id)
      FROM public.ari_cert_capability_requirements
    ),
    'finalizer', pg_get_functiondef('public.ari_cert_finalize_run(uuid)'::regprocedure),
    'triggers', (
      SELECT jsonb_agg(jsonb_build_array(t.tgname, pg_get_triggerdef(t.oid), t.tgenabled::text)
                       ORDER BY t.tgname)
      FROM pg_trigger t
      WHERE t.tgrelid = 'public.ari_cert_capability_requirements'::regclass
        AND NOT t.tgisinternal
    )
  );
$fn$;

CREATE FUNCTION pg_temp.issue_3872_adv_repair_statements()
RETURNS text
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_src text := (SELECT body FROM issue_3872_adv_input WHERE name = 'repair');
BEGIN
  IF (SELECT count(*) FROM regexp_matches(v_src, '^BEGIN;$', 'gn')) <> 1
     OR (SELECT count(*) FROM regexp_matches(v_src, '^COMMIT;$', 'gn')) <> 1 THEN
    RAISE EXCEPTION 'issue_3872_adv_repair_not_self_wrapped';
  END IF;
  RETURN regexp_replace(regexp_replace(v_src, '^BEGIN;$', '', 'n'), '^COMMIT;$', '', 'n');
END;
$fn$;

CREATE FUNCTION pg_temp.issue_3872_adv_attempt()
RETURNS text
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_message text;
BEGIN
  BEGIN
    EXECUTE pg_temp.issue_3872_adv_repair_statements();
    RETURN NULL;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    RETURN v_message;
  END;
END;
$fn$;

CREATE FUNCTION pg_temp.issue_3872_adv_expect_abort(p_case text, p_prefix text)
RETURNS void
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_before jsonb := pg_temp.issue_3872_adv_state();
  v_message text := pg_temp.issue_3872_adv_attempt();
  v_after jsonb := pg_temp.issue_3872_adv_state();
BEGIN
  IF v_message IS NULL OR left(v_message, length(p_prefix)) <> p_prefix THEN
    RAISE EXCEPTION '%: expected abort "%", got "%"', p_case, p_prefix, v_message;
  END IF;
  IF v_after IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION '%: aborted repair changed state', p_case;
  END IF;
  RAISE NOTICE '% PASS: %', p_case, v_message;
END;
$fn$;

CREATE FUNCTION pg_temp.issue_3872_adv_base145()
RETURNS void
LANGUAGE plpgsql
AS $fn$
BEGIN
  ALTER TABLE public.ari_cert_capability_requirements
    DISABLE TRIGGER ari_cert_capability_requirements_immutable_trigger;
  DELETE FROM public.ari_cert_capability_requirements
  WHERE capability_id IN (
    'ari.team.revoke_invitation',
    'ari.analytics.listing_conversion',
    'ari.analytics.reservation_metrics',
    'ari.referrals.list',
    'ari.referrals.create',
    'ari.referrals.invite_promoters',
    'ari.creators.draft_gig_script',
    'ari.sites.read_plan',
    'ari.sites.list_designs',
    'ari.sites.read_block_catalog',
    'ari.sites.read_tokens',
    'ari.sites.run_design_checks',
    'ari.sites.save_plan_answers',
    'ari.sites.create_draft',
    'ari.sites.propose_variant',
    'ari.sites.propose_copy',
    'ari.sites.propose_collection_entry',
    'ari.sites.confirm_review',
    'ari.sites.propose_trip_guide'
  );
  ALTER TABLE public.ari_cert_capability_requirements
    ENABLE TRIGGER ari_cert_capability_requirements_immutable_trigger;
  EXECUTE pg_temp.issue_3872_adv_function_statement(
    (SELECT body FROM issue_3872_adv_input WHERE name = 'r1'),
    'CREATE OR REPLACE FUNCTION public.ari_cert_finalize_run('
  );
END;
$fn$;

CREATE FUNCTION pg_temp.issue_3872_adv_add_targets(p_limit integer)
RETURNS void
LANGUAGE plpgsql
AS $fn$
BEGIN
  INSERT INTO public.ari_cert_capability_requirements (capability_id, evidence_mode)
  SELECT capability_id, evidence_mode
  FROM (VALUES
    (1, 'ari.team.revoke_invitation', 'write'),
    (2, 'ari.analytics.listing_conversion', 'read'),
    (3, 'ari.analytics.reservation_metrics', 'read')
  ) rows(ordinal, capability_id, evidence_mode)
  WHERE ordinal <= p_limit;
END;
$fn$;

CREATE FUNCTION pg_temp.issue_3872_adv_make152()
RETURNS void
LANGUAGE plpgsql
AS $fn$
BEGIN
  PERFORM pg_temp.issue_3872_adv_add_targets(3);
  INSERT INTO public.ari_cert_capability_requirements (capability_id, evidence_mode)
  VALUES
    ('ari.referrals.list', 'read'),
    ('ari.referrals.create', 'write'),
    ('ari.referrals.invite_promoters', 'write'),
    ('ari.creators.draft_gig_script', 'read');
  EXECUTE pg_temp.issue_3872_adv_function_statement(
    (SELECT body FROM issue_3872_adv_input WHERE name = 'r2'),
    'CREATE OR REPLACE FUNCTION public.ari_cert_finalize_run('
  );
END;
$fn$;

CREATE FUNCTION pg_temp.issue_3872_adv_interfere()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF NEW.capability_id = 'ari.team.revoke_invitation' THEN
    INSERT INTO public.ari_cert_capability_requirements (capability_id, evidence_mode)
    VALUES ('ari.stray.mid_apply', 'write');
  END IF;
  RETURN NULL;
END;
$fn$;

BEGIN;

SAVEPOINT x1;
SELECT pg_temp.issue_3872_adv_base145();
SELECT pg_temp.issue_3872_adv_add_targets(1);
SELECT pg_temp.issue_3872_adv_expect_abort('T-3872-X1 partial146', 'issue_3872_repair_unexpected_start:');
ROLLBACK TO SAVEPOINT x1;

SAVEPOINT x2;
SELECT pg_temp.issue_3872_adv_base145();
SELECT pg_temp.issue_3872_adv_add_targets(2);
SELECT pg_temp.issue_3872_adv_expect_abort('T-3872-X2 partial147', 'issue_3872_repair_unexpected_start:');
ROLLBACK TO SAVEPOINT x2;

SAVEPOINT x3;
SELECT pg_temp.issue_3872_adv_base145();
SELECT pg_temp.issue_3872_adv_add_targets(3);
INSERT INTO public.ari_cert_capability_requirements VALUES ('ari.stray.after_repair', 'read');
SELECT pg_temp.issue_3872_adv_expect_abort('T-3872-X3 polluted149', 'issue_3872_repair_unexpected_start:');
ROLLBACK TO SAVEPOINT x3;

SAVEPOINT x4;
SELECT pg_temp.issue_3872_adv_base145();
INSERT INTO public.ari_cert_capability_requirements VALUES ('ari.team.revoke_invitation', 'read');
SELECT pg_temp.issue_3872_adv_expect_abort('T-3872-X4 wrong-mode', 'issue_3872_repair_unexpected_start:');
ROLLBACK TO SAVEPOINT x4;

SAVEPOINT x5;
SELECT pg_temp.issue_3872_adv_base145();
INSERT INTO public.ari_cert_capability_requirements VALUES ('ari.stray.unknown', 'write');
SELECT pg_temp.issue_3872_adv_expect_abort('T-3872-X5 extra-row', 'issue_3872_repair_unexpected_start:');
ROLLBACK TO SAVEPOINT x5;

SAVEPOINT x6;
SELECT pg_temp.issue_3872_adv_base145();
SELECT pg_temp.issue_3872_adv_make152();
SELECT pg_temp.issue_3872_adv_expect_abort('T-3872-X6 held152', 'issue_3872_repair_unexpected_start:');
ROLLBACK TO SAVEPOINT x6;

SAVEPOINT x7;
SELECT pg_temp.issue_3872_adv_base145();
SELECT pg_temp.issue_3872_adv_make152();
INSERT INTO public.ari_cert_capability_requirements VALUES ('ari.stray.after_held', 'write');
SELECT pg_temp.issue_3872_adv_expect_abort('T-3872-X7 held153', 'issue_3872_repair_unexpected_start:');
ROLLBACK TO SAVEPOINT x7;

SAVEPOINT x8;
SELECT pg_temp.issue_3872_adv_base145();
ALTER TABLE public.ari_cert_capability_requirements
  DISABLE TRIGGER ari_cert_capability_requirements_immutable_trigger;
SELECT pg_temp.issue_3872_adv_expect_abort('T-3872-X8 disabled-trigger', 'issue_3872_repair_immutability_trigger_unexpected:');
ROLLBACK TO SAVEPOINT x8;

SAVEPOINT x9;
SELECT pg_temp.issue_3872_adv_base145();
CREATE TRIGGER issue_3872_adv_interference
AFTER INSERT ON public.ari_cert_capability_requirements
FOR EACH ROW EXECUTE FUNCTION pg_temp.issue_3872_adv_interfere();
SELECT pg_temp.issue_3872_adv_expect_abort('T-3872-X9 mid-apply-interference', 'issue_3872_repair_postcondition:');
ROLLBACK TO SAVEPOINT x9;

ROLLBACK;

SELECT 'issue_3872_ari_cert_backlog_repair adversarial: PASS' AS result;
