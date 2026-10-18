-- #3720 Completion Wave 5 — independent fail-closed and authority proof.
\set ON_ERROR_STOP on
BEGIN;

ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email_confirmed_at timestamptz;

DO $proof$
DECLARE
  v_outsider constant uuid := '37200000-0000-4000-8000-000000000599';
  v_denied boolean := false;
  v_capability uuid;
  v_agent jsonb;
  v_agent_digest text := encode(sha256(convert_to(
    'mgla_c_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx','UTF8'
  )),'hex');
BEGIN
  INSERT INTO auth.users(id,email) VALUES(v_outsider,'wave5-adversary@test.local');
  UPDATE auth.users SET email_confirmed_at=now() WHERE id=v_outsider;
  INSERT INTO public.admin_team_members(email,role,status,accepted_at) VALUES
    ('wave5-adversary@test.local','growth','revoked',now());
  INSERT INTO public.team_agent_keys(owner_email,agent,key_prefix,key_hash) VALUES (
    'wave5-adversary@test.local','codex',
    left('mgla_c_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',14),v_agent_digest
  );
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub',v_outsider::text,true);
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  BEGIN
    PERFORM 1 FROM public.issue_3720_list_feature_guide(NULL);
  EXCEPTION WHEN insufficient_privilege THEN v_denied:=true; END;
  RESET ROLE;
  IF NOT v_denied THEN RAISE EXCEPTION 'outsider_read_product_truth'; END IF;

  SET LOCAL ROLE service_role;
  v_agent := public.team_agent_product_truth_call(
    v_agent_digest,'mcp:tools/list','{}'::jsonb,'wave5-adversary/1.0'
  );
  IF v_agent->>'auth' IS DISTINCT FROM 'invalid' OR v_agent ? 'me' THEN
    RAISE EXCEPTION 'outsider_agent_tool_was_offered';
  END IF;
  v_agent := public.team_agent_product_truth_call(
    v_agent_digest,'find_capabilities','{}'::jsonb,'wave5-adversary/1.0'
  );
  IF v_agent->>'auth' IS DISTINCT FROM 'invalid'
     OR v_agent ? 'result'
     OR v_agent::text ~ 'official-brand-groups|support_wording|evidence_url' THEN
    RAISE EXCEPTION 'outsider_agent_read_product_truth:%', v_agent;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.team_agent_calls
     WHERE owner_email='wave5-adversary@test.local'
       AND tool='find_capabilities' AND outcome='ok'
  ) THEN
    RAISE EXCEPTION 'outsider_agent_query_audited_as_success';
  END IF;
  RESET ROLE;

  SET LOCAL ROLE service_role;
  INSERT INTO public.product_capabilities(
    capability_key,title,outcome_summary,who_can_use,surfaces,how_to,limitations,
    support_wording,claimed_status,required_evidence_kinds,verification_due_at
  ) VALUES (
    'adversarial-missing-proof','Adversarial missing proof',
    'A Live claim without its required evidence must never be displayed as Live.',
    ARRAY['Support'],ARRAY['Admin'],'Search for the capability in the Feature Guide.',
    'The required source proof is deliberately absent.',
    'This capability is not verified and Support must not claim that it is live.',
    'live',ARRAY['source'],now()+interval '30 days'
  ) RETURNING id INTO v_capability;
  IF public.issue_3720_feature_guide_effective_status(v_capability) <> 'Needs review' THEN
    RAISE EXCEPTION 'live_claim_without_proof_was_live';
  END IF;

  INSERT INTO public.product_capability_evidence(
    capability_id,evidence_kind,evidence_url,verdict,details,observed_at,expires_at
  ) VALUES (
    v_capability,'source','https://github.com/Mingla-LLC/mingla-main/blob/test/source.ts',
    'verified','Expired source proof.',now()-interval '2 days',now()-interval '1 day'
  );
  IF public.issue_3720_feature_guide_effective_status(v_capability) <> 'Needs review' THEN
    RAISE EXCEPTION 'expired_proof_was_live';
  END IF;

  UPDATE public.product_capability_evidence
     SET verdict='conflict',expires_at=NULL
   WHERE capability_id=v_capability AND is_current;
  IF public.issue_3720_feature_guide_effective_status(v_capability) <> 'Needs review' THEN
    RAISE EXCEPTION 'conflicting_proof_was_live';
  END IF;

  IF has_table_privilege('anon','public.product_capabilities','SELECT')
     OR has_table_privilege('authenticated','public.product_capabilities','SELECT')
     OR has_table_privilege('authenticated','public.product_capability_evidence','INSERT')
     OR has_table_privilege('authenticated','public.product_truth_audit','UPDATE') THEN
    RAISE EXCEPTION 'product_truth_relation_acl_open';
  END IF;
  IF has_function_privilege('anon','public.issue_3720_list_feature_guide(text)','EXECUTE')
     OR has_function_privilege('authenticated','public.issue_3720_feature_guide_effective_status(uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'product_truth_function_acl_open';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.proname LIKE 'issue_3720_%feature%'
       AND p.prosrc ~* 'openai|anthropic|gemini|embedding|vector[_-]?store'
  ) THEN
    RAISE EXCEPTION 'product_truth_contains_model_service';
  END IF;
  RESET ROLE;
END;
$proof$;
ROLLBACK;
