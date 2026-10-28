-- #3872 implementor proof: exact production 145 repairs to 148, repaired 148
-- and chain 164 are idempotent, and the reviewed finalizer is never rewritten.

\set ON_ERROR_STOP on
\set issue_3872_repair_src `cat "$(git rev-parse --show-toplevel)/supabase/migrations/20280204013872_issue_3872_ari_cert_backlog_repair.sql"`
\set issue_3872_r1_src `cat "$(git rev-parse --show-toplevel)/supabase/migrations/20271216043872_issue_3872_r1_host_operations.sql"`

CREATE TEMP TABLE issue_3872_repair_input (name text PRIMARY KEY, body text NOT NULL);
INSERT INTO issue_3872_repair_input (name, body) VALUES
  ('repair', :'issue_3872_repair_src'),
  ('r1', :'issue_3872_r1_src');

CREATE FUNCTION pg_temp.issue_3872_repair_function_statement(p_src text, p_head text)
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
    RAISE EXCEPTION 'issue_3872_repair_fixture_function_not_unique:%', p_head;
  END IF;
  v_rest := substr(p_src, v_start);
  v_body_open := strpos(v_rest, 'AS $function$');
  v_after_open := substr(v_rest, v_body_open + length('AS $function$'));
  v_body_close := strpos(v_after_open, '$function$;');
  IF v_body_open = 0 OR v_body_close = 0 THEN
    RAISE EXCEPTION 'issue_3872_repair_fixture_function_body_missing:%', p_head;
  END IF;
  RETURN substr(v_rest, 1,
    v_body_open + length('AS $function$') - 1 + v_body_close + length('$function$;') - 1);
END;
$fn$;

CREATE FUNCTION pg_temp.issue_3872_repair_state()
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
    'trigger', (
      SELECT jsonb_build_array(pg_get_triggerdef(t.oid), t.tgenabled::text)
      FROM pg_trigger t
      WHERE t.tgrelid = 'public.ari_cert_capability_requirements'::regclass
        AND t.tgname = 'ari_cert_capability_requirements_immutable_trigger'
        AND NOT t.tgisinternal
    )
  );
$fn$;

CREATE TEMP TABLE issue_3872_repair_snap AS
SELECT pg_temp.issue_3872_repair_state() AS chain164;

DO $source_contract$
DECLARE
  v_src text := (SELECT body FROM issue_3872_repair_input WHERE name = 'repair');
  v_ids text[];
BEGIN
  SELECT array_agg(DISTINCT m[1] ORDER BY m[1]) INTO v_ids
  FROM regexp_matches(v_src, '''(ari\.[a-z0-9_.]+)''', 'g') AS m;
  IF v_ids IS DISTINCT FROM ARRAY[
       'ari.analytics.listing_conversion',
       'ari.analytics.reservation_metrics',
       'ari.team.revoke_invitation'
     ]::text[] THEN
    RAISE EXCEPTION 'issue_3872_repair_source_capability_scope:%', v_ids;
  END IF;
  IF v_src ~* 'CREATE\s+OR\s+REPLACE\s+FUNCTION'
     OR v_src ~* 'DISABLE\s+TRIGGER'
     OR v_src ~* 'DELETE\s+FROM\s+public\.ari_cert_capability_requirements'
     OR v_src ~* 'UPDATE\s+public\.ari_cert_capability_requirements' THEN
    RAISE EXCEPTION 'issue_3872_repair_source_contains_forbidden_rewrite';
  END IF;
  IF v_src !~ 'LOCK TABLE public\.ari_cert_capability_requirements[[:space:]]+IN SHARE ROW EXCLUSIVE MODE'
     OR (SELECT count(*) FROM regexp_matches(v_src, '^BEGIN;$', 'gn')) <> 1
     OR (SELECT count(*) FROM regexp_matches(v_src, '^COMMIT;$', 'gn')) <> 1 THEN
    RAISE EXCEPTION 'issue_3872_repair_source_transaction_or_lock_missing';
  END IF;
END;
$source_contract$;

-- Full-chain 164 is a byte-for-byte no-op, including on a second application.
\ir ../20280204013872_issue_3872_ari_cert_backlog_repair.sql
\ir ../20280204013872_issue_3872_ari_cert_backlog_repair.sql
DO $chain_noop$
BEGIN
  IF pg_temp.issue_3872_repair_state()
     IS DISTINCT FROM (SELECT chain164 FROM issue_3872_repair_snap) THEN
    RAISE EXCEPTION 'issue_3872_repair_chain164_not_idempotent';
  END IF;
END;
$chain_noop$;

-- Build the exact audited production shape from the complete chain: remove only
-- the three stranded rows, the four held #3872 rows, and the twelve #4148 rows;
-- install the reviewed 148-capability finalizer byte-for-byte.
BEGIN;
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
DO $install_148_finalizer$
BEGIN
  EXECUTE pg_temp.issue_3872_repair_function_statement(
    (SELECT body FROM issue_3872_repair_input WHERE name = 'r1'),
    'CREATE OR REPLACE FUNCTION public.ari_cert_finalize_run('
  );
END;
$install_148_finalizer$;
COMMIT;

DO $production_fixture$
DECLARE
  v_count integer;
  v_set_digest text;
  v_finalizer_digest text;
BEGIN
  SELECT count(*), encode(extensions.digest(
    string_agg(capability_id || ':' || evidence_mode, E'\n' ORDER BY capability_id),
    'sha256'), 'hex')
  INTO v_count, v_set_digest
  FROM public.ari_cert_capability_requirements;
  SELECT encode(extensions.digest(
    pg_get_functiondef('public.ari_cert_finalize_run(uuid)'::regprocedure),
    'sha256'), 'hex') INTO v_finalizer_digest;
  IF v_count <> 145
     OR v_set_digest <> '579a8266f7a273536cf5309ab5b021c66b2d205ea76f828fc9a9a9045850cdd2'
     OR v_finalizer_digest <> '19932adee95699082a78a6cc8def0bb86d1284f11a81fcc0d10a5a20c3338576' THEN
    RAISE EXCEPTION 'issue_3872_repair_fixture_not_exact:count=% set=% finalizer=%',
      v_count, v_set_digest, v_finalizer_digest;
  END IF;
END;
$production_fixture$;

-- The real file repairs 145 -> 148 and then no-ops at 148.
\ir ../20280204013872_issue_3872_ari_cert_backlog_repair.sql
\ir ../20280204013872_issue_3872_ari_cert_backlog_repair.sql
DO $repaired$
DECLARE
  v_count integer;
  v_set_digest text;
  v_finalizer_digest text;
  v_wrong text;
BEGIN
  SELECT count(*), encode(extensions.digest(
    string_agg(capability_id || ':' || evidence_mode, E'\n' ORDER BY capability_id),
    'sha256'), 'hex')
  INTO v_count, v_set_digest
  FROM public.ari_cert_capability_requirements;
  SELECT encode(extensions.digest(
    pg_get_functiondef('public.ari_cert_finalize_run(uuid)'::regprocedure),
    'sha256'), 'hex') INTO v_finalizer_digest;

  SELECT string_agg(expected.capability_id || ':' || coalesce(actual.evidence_mode, '<missing>'), ', ')
    INTO v_wrong
  FROM (VALUES
    ('ari.team.revoke_invitation', 'write'),
    ('ari.analytics.listing_conversion', 'read'),
    ('ari.analytics.reservation_metrics', 'read')
  ) expected(capability_id, evidence_mode)
  LEFT JOIN public.ari_cert_capability_requirements actual USING (capability_id)
  WHERE actual.capability_id IS NULL OR actual.evidence_mode <> expected.evidence_mode;

  IF v_count <> 148
     OR v_set_digest <> 'a702b1ad490affbfbd9b0a2cd35d94f0dd8900b9ada00f2b57b46ce6355f84a5'
     OR v_finalizer_digest <> '19932adee95699082a78a6cc8def0bb86d1284f11a81fcc0d10a5a20c3338576'
     OR v_wrong IS NOT NULL THEN
    RAISE EXCEPTION 'issue_3872_repair_148_mismatch:count=% set=% finalizer=% wrong=%',
      v_count, v_set_digest, v_finalizer_digest, v_wrong;
  END IF;
END;
$repaired$;

-- Continue through the reviewed held census and #4148 census, then prove the
-- complete chain is byte-for-byte restored.
\ir ../20271229003872_issue_3872_ari_cert_capability_census.sql
\ir ../20280119132829_issue_2829_ari_cert_capability_census.sql
DO $restored$
BEGIN
  IF pg_temp.issue_3872_repair_state()
     IS DISTINCT FROM (SELECT chain164 FROM issue_3872_repair_snap) THEN
    RAISE EXCEPTION 'issue_3872_repair_chain_restore_failed';
  END IF;
END;
$restored$;

SELECT 'issue_3872_ari_cert_backlog_repair implementor: PASS' AS result;
