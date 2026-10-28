\set ON_ERROR_STOP on

BEGIN;

-- Reapplication must be convergent: the requirement insert and finalizer rewrite
-- may encounter the already-upgraded state but no third state is accepted.
-- #2829 W9b: the tip census is now 20280119132829_issue_2829_ari_cert_capability_census.sql
-- (152 -> 164, on top of this #3872 census); after a full replay the chain is at
-- the tip, so the convergence proof re-applies the TIP census (re-applying this
-- older file on the 164 tip is refused by its own preflight, by design). The
-- #3872 rows and modes below must still be present, unchanged.
\ir ../20280119132829_issue_2829_ari_cert_capability_census.sql
\ir ../20280119132829_issue_2829_ari_cert_capability_census.sql

DO $test$
DECLARE
  v_definition text := pg_get_functiondef('public.ari_cert_finalize_run(uuid)'::regprocedure);
  v_wrong text;
  v_acl text;
BEGIN
  IF (SELECT count(*) FROM public.ari_cert_capability_requirements) <> 164 THEN
    RAISE EXCEPTION 'issue_3872_ari_cert_census_not_164';
  END IF;

  SELECT string_agg(expected.capability_id || ':' || coalesce(actual.evidence_mode, '<missing>'), ', ' ORDER BY expected.capability_id)
    INTO v_wrong
  FROM (VALUES
    ('ari.referrals.list', 'read'),
    ('ari.referrals.create', 'write'),
    ('ari.referrals.invite_promoters', 'write'),
    ('ari.creators.draft_gig_script', 'read')
  ) AS expected(capability_id, evidence_mode)
  LEFT JOIN public.ari_cert_capability_requirements actual
    ON actual.capability_id = expected.capability_id
  WHERE actual.capability_id IS NULL OR actual.evidence_mode <> expected.evidence_mode;
  IF v_wrong IS NOT NULL THEN
    RAISE EXCEPTION 'issue_3872_ari_cert_wrong_modes:%', v_wrong;
  END IF;

  IF (length(v_definition) - length(replace(v_definition, 'v_capability_count <> 164', '')))
       / length('v_capability_count <> 164') <> 1
     OR (length(v_definition) - length(replace(v_definition, '''capability_count'', 164', '')))
       / length('''capability_count'', 164') <> 1
     OR v_definition LIKE '%v_capability_count <> 152%'
     OR v_definition LIKE '%''capability_count'', 152%'
     OR v_definition LIKE '%v_capability_count <> 148%'
     OR v_definition LIKE '%''capability_count'', 148%' THEN
    RAISE EXCEPTION 'issue_3872_ari_cert_finalizer_denominator_not_exact';
  END IF;

  SELECT coalesce(array_to_string(coalesce(proacl, acldefault('f', proowner)), ','), '')
    INTO v_acl
  FROM pg_proc
  WHERE oid = 'public.ari_cert_finalize_run(uuid)'::regprocedure;
  IF v_acl NOT LIKE '%service_role=X/%'
     OR v_acl LIKE '%anon=%'
     OR v_acl LIKE '%authenticated=%'
     OR v_acl LIKE '%PUBLIC=%' THEN
    RAISE EXCEPTION 'issue_3872_ari_cert_finalizer_acl:%', v_acl;
  END IF;

  IF obj_description('public.ari_cert_begin_run(text,jsonb,text,jsonb,jsonb)'::regprocedure, 'pg_proc') NOT LIKE '%164-row%'
     OR obj_description('public.ari_cert_finalize_run(uuid)'::regprocedure, 'pg_proc') NOT LIKE '%164-capability%' THEN
    RAISE EXCEPTION 'issue_3872_ari_cert_comments_not_current';
  END IF;
END;
$test$;

ROLLBACK;

SELECT 'issue_3872_ari_cert_capability_census: PASS' AS result;
