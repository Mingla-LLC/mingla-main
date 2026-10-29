-- #3720 Completion Wave 5 — executable Product Truth happy path.
-- MINGLA-INVARIANT: I-3720-PRODUCT-TRUTH-FAILS-CLOSED | issue #3720 | Product Truth reports Live only while every required current evidence kind and the capability verification window remain valid.
-- MINGLA-INVARIANT: I-3720-PRODUCT-TRUTH-HUMAN-PROMOTION | issue #3720 | Only an authenticated Admin may change Product Truth claims or evidence, while Support and role-scoped agents remain read-only.
-- MINGLA-INVARIANT: I-3720-PRODUCT-TRUTH-CITED | issue #3720 | Every Feature Guide answer includes current evidence citations and its last successful verification time instead of inventing missing proof.
\set ON_ERROR_STOP on
BEGIN;

ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email_confirmed_at timestamptz;

INSERT INTO auth.users(id,email) VALUES
  ('37200000-0000-4000-8000-000000000501','wave5-admin@test.local'),
  ('37200000-0000-4000-8000-000000000502','wave5-support@test.local'),
  ('37200000-0000-4000-8000-000000000503','wave5-outsider@test.local');
INSERT INTO public.admin_users(email,role,status) VALUES
  ('wave5-admin@test.local','admin','active');
INSERT INTO public.admin_team_members(email,role,status,accepted_at) VALUES
  ('wave5-support@test.local','growth','active',now());
INSERT INTO public.support_staff(user_id,enabled,available,display_name) VALUES
  ('37200000-0000-4000-8000-000000000502',true,true,'Wave Five Support');
UPDATE auth.users
   SET email_confirmed_at = now()
 WHERE id IN (
   '37200000-0000-4000-8000-000000000501',
   '37200000-0000-4000-8000-000000000502'
 );
INSERT INTO public.team_agent_keys(owner_email,agent,key_prefix,key_hash) VALUES
  (
    'wave5-support@test.local','codex',
    left('mgla_c_wwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwww',14),
    encode(sha256(convert_to('mgla_c_wwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwww','UTF8')),'hex')
  );

DO $proof$
DECLARE
  v_admin constant uuid := '37200000-0000-4000-8000-000000000501';
  v_support constant uuid := '37200000-0000-4000-8000-000000000502';
  v_capability uuid;
  v_revision integer;
  v_rows integer;
  v_status text;
  v_last_verified_at timestamptz;
  v_agent jsonb;
  v_agent_digest text := encode(sha256(convert_to(
    'mgla_c_wwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwww','UTF8'
  )),'hex');
  v_denied boolean := false;
BEGIN
  UPDATE public.product_capabilities
     SET verification_due_at = now() + interval '90 days'
   WHERE capability_key IN (
     'official-brand-groups',
     'brand-files-and-guides',
     'product-inbox-avengers'
   );

  SET LOCAL ROLE service_role;
  -- [TEST-MOD-APPROVED #4179] The reconciliation revises the two brand-guide
  -- entries and deliberately invalidates their old evidence. Their claimed
  -- Live state remains intact, but effective truth must fail closed until the
  -- revised wording has fresh proof. The unchanged product inbox stays Live.
  IF (SELECT count(*) FROM public.product_capabilities
       WHERE capability_key IN ('official-brand-groups', 'brand-files-and-guides', 'product-inbox-avengers')
         AND claimed_status = 'live') <> 3 THEN
    RAISE EXCEPTION 'seeded_live_claims_missing';
  END IF;
  IF (SELECT public.issue_3720_feature_guide_effective_status(id)
        FROM public.product_capabilities
       WHERE capability_key = 'product-inbox-avengers') <> 'Live' THEN
    RAISE EXCEPTION 'unchanged_seeded_capability_not_live';
  END IF;
  IF (SELECT count(*) FROM public.product_capabilities
       WHERE capability_key IN ('official-brand-groups', 'brand-files-and-guides')
         AND public.issue_3720_feature_guide_effective_status(id) = 'Needs review') <> 2 THEN
    RAISE EXCEPTION 'revised_seeded_capabilities_did_not_fail_closed';
  END IF;
  RESET ROLE;

  SET LOCAL ROLE service_role;
  v_agent := public.team_agent_product_truth_call(
    v_agent_digest,'mcp:tools/list','{}'::jsonb,'wave5-test/1.0'
  );
  IF v_agent #>> '{me,feature_guide}' <> 'true' THEN
    RAISE EXCEPTION 'support_agent_tool_not_offered';
  END IF;
  v_agent := public.team_agent_product_truth_call(
    v_agent_digest,'find_capabilities',
    '{"query":"Brand groups","limit":5}'::jsonb,'wave5-test/1.0'
  );
  v_rows := jsonb_array_length(v_agent #> '{result,capabilities}');
  IF v_agent->>'ok' <> 'true'
     OR v_rows < 2
     OR EXISTS (
       SELECT 1
         FROM jsonb_array_elements(v_agent #> '{result,capabilities}') item
        WHERE item->>'effective_status' <> 'Needs review'
     )
     OR NOT ('official-brand-groups' = ANY (
       SELECT item->>'capability_key'
         FROM jsonb_array_elements(v_agent #> '{result,capabilities}') item
     ))
     OR NOT ('brand-files-and-guides' = ANY (
       SELECT item->>'capability_key'
         FROM jsonb_array_elements(v_agent #> '{result,capabilities}') item
     )) THEN
    RAISE EXCEPTION 'support_agent_fail_closed_query_failed:%', v_agent;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.team_agent_calls
     WHERE tool='find_capabilities' AND owner_email='wave5-support@test.local'
       AND outcome='ok' AND items=v_rows
  ) THEN
    RAISE EXCEPTION 'support_agent_query_not_audited';
  END IF;
  RESET ROLE;

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub',v_admin::text,true);
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  v_capability := public.issue_3720_save_feature_capability(
    'verified-test-capability', 0, 'Verified test capability',
    'Support can answer this question from reviewed evidence instead of memory.',
    ARRAY['Mingla Support'], ARRAY['Mingla Admin'],
    'Open the Feature Guide, search for the capability, and read the cited evidence.',
    'This test capability is available only while its verification window is current.',
    'This capability is verified only when every required citation is current.',
    'live', ARRAY['source','test'], now()+interval '30 days'
  );
  SELECT effective_status INTO v_status
    FROM public.issue_3720_list_feature_guide('verified-test-capability')
   WHERE capability_id = v_capability;
  IF v_status <> 'Needs review' THEN
    RAISE EXCEPTION 'missing_evidence_did_not_fail_closed';
  END IF;

  v_revision := 1;
  v_revision := public.issue_3720_record_feature_evidence(
    v_capability,v_revision,'source',
    'https://github.com/Mingla-LLC/mingla-main/blob/test/source.ts',
    'verified','Merged source is present.',now(),now()+interval '30 days'
  );
  SELECT effective_status INTO v_status
    FROM public.issue_3720_list_feature_guide('verified-test-capability')
   WHERE capability_id = v_capability;
  IF v_status <> 'Needs review' THEN
    RAISE EXCEPTION 'partial_evidence_did_not_fail_closed';
  END IF;
  v_revision := public.issue_3720_record_feature_evidence(
    v_capability,v_revision,'test',
    'https://github.com/Mingla-LLC/mingla-main/actions/runs/123',
    'verified','Required regression test passed.',now(),now()+interval '30 days'
  );
  SELECT effective_status, last_verified_at INTO v_status, v_last_verified_at
    FROM public.issue_3720_list_feature_guide('verified-test-capability')
   WHERE capability_id = v_capability;
  IF v_status <> 'Live' THEN
    RAISE EXCEPTION 'complete_current_evidence_not_live';
  END IF;
  IF v_last_verified_at IS NULL THEN
    RAISE EXCEPTION 'last_verification_not_recorded';
  END IF;
  SELECT count(*) INTO v_rows
    FROM public.issue_3720_list_feature_guide('verified test');
  IF v_rows <> 1 THEN RAISE EXCEPTION 'admin_search_did_not_find_capability'; END IF;
  RESET ROLE;

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub',v_support::text,true);
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  SELECT count(*) INTO v_rows
    FROM public.issue_3720_list_feature_guide('verified test') g
   WHERE g.effective_status='Live'
     AND jsonb_array_length(g.evidence)=2
     AND g.last_verified_at IS NOT NULL;
  IF v_rows <> 1 THEN RAISE EXCEPTION 'support_cited_answer_missing'; END IF;
  BEGIN
    PERFORM public.issue_3720_save_feature_capability(
      'support-cannot-promote',0,'Support cannot promote',
      'A Support user cannot create or promote Product Truth records.',
      ARRAY['Support'],ARRAY['Admin'],'This write must be refused by the server.',
      'There is no client-side bypass.','This wording must never be saved.',
      'live',ARRAY['source'],now()+interval '1 day');
  EXCEPTION WHEN insufficient_privilege THEN v_denied:=true; END;
  IF NOT v_denied THEN RAISE EXCEPTION 'support_promoted_capability'; END IF;
  RESET ROLE;
END;
$proof$;
ROLLBACK;
