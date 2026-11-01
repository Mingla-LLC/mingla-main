-- MINGLA-INVARIANT: I-ARI-RECEIPT-BINDS-CONFIRMED-ARGS | issue #2830 | Every receipt-backed Ari SQL dispatcher passes the owner-confirmed proposal args (including why and cites) to agent_operation_receipt_begin unchanged, and refuses any value that differs from what the owner confirmed.
--
-- Regression for 20280222002830: the 20280216002830 definition rebuilt a
-- six-key copy of the proposal, so every confirmed update_brand_context that
-- carried the readable why and cites failed with operation_binding_mismatch.
-- Reverting the function to that definition makes the happy path below fail.

\set ON_ERROR_STOP on
BEGIN;

DO $i2830rb$
DECLARE
  v_owner uuid := '28300000-0000-4000-8000-0000000000b1';
  v_admin uuid := '28300000-0000-4000-8000-0000000000b3';
  v_brand uuid := '28300000-0000-4000-8000-0000000000b0';
  v_conversation uuid := '28300000-0000-4000-8000-0000000000b2';
  v_operation_ok uuid := gen_random_uuid();
  v_operation_tampered uuid := gen_random_uuid();
  v_context_revision text;
  v_args jsonb;
  v_result jsonb;
  v_replay jsonb;
  v_failed boolean;
  v_error text;
BEGIN
  INSERT INTO auth.users(id,email) VALUES
    (v_owner,'owner-2830rb@example.invalid'),
    (v_admin,'admin-2830rb@example.invalid');
  INSERT INTO public.creator_accounts(id,created_at,updated_at)
  VALUES (v_owner,now(),now());
  INSERT INTO public.admin_users(email,role,status,accepted_at)
  VALUES ('admin-2830rb@example.invalid','admin','active',now());
  INSERT INTO public.brands(id,account_id,name,slug,default_currency)
  VALUES (v_brand,v_owner,'Receipt Lantern','receipt-lantern-2830','USD');
  INSERT INTO public.agent_conversations(id,user_id,brand_id)
  VALUES (v_conversation,v_owner,v_brand);

  DELETE FROM public.brand_site_service_config;
  INSERT INTO public.brand_site_service_config(
    config_key,cms_origin,public_runtime_origin,public_host_suffix,
    configured_by,configured_at,updated_by,updated_at
  ) VALUES (
    'sites_v1','https://studio.sites.usemingla.com',
    'https://www.sites.usemingla.com','sites.usemingla.com',
    v_admin,now(),v_admin,now()
  );
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_admin)::text,true);
  PERFORM set_config('request.jwt.claim.sub',v_admin::text,true);
  PERFORM public.brand_site_admin_grant(v_brand,'rollout',NULL);

  INSERT INTO public.brand_site_plans(
    brand_id,revision,offerings_selected,story,started_by,updated_by
  ) VALUES (
    v_brand,1,ARRAY[]::text[],
    '{"who":"Curious neighbours","why":"Owner-led gatherings","main_action":"Join the next event"}',
    v_owner,v_owner
  );

  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_owner)::text,true);
  PERFORM set_config('request.jwt.claim.sub',v_owner::text,true);
  v_context_revision := public.brand_context_completeness_internal(v_brand)->>'context_revision';

  -- Happy path: the confirmed proposal carries why + cites exactly as Ari
  -- proposes it; the save must succeed and write the confirmed value.
  v_args := jsonb_build_object(
    'brand_id',v_brand,'expected_plan_revision',1,
    'expected_context_revision',v_context_revision,
    'patch',jsonb_build_object('contact_phone','+12125550123'),
    'exceptions','[]'::jsonb,
    'evidence','{"source_type":"owner"}'::jsonb,
    'why','You gave me this number for buyers to call.',
    'cites',jsonb_build_array(jsonb_build_object(
      'kind','brand','id',v_brand::text,'label','Receipt Lantern')));
  INSERT INTO public.agent_pending_actions(
    id,user_id,conversation_id,tool_name,tool_args,status,source,related_brand_id,
    server_proposed_at,execution_attested_at
  ) VALUES (
    v_operation_ok,v_owner,v_conversation,'update_brand_context',v_args,
    'executing','ari',v_brand,now(),now()
  );
  BEGIN
    v_result := public.ari_update_brand_context(
      v_operation_ok,v_brand,1,v_context_revision,
      jsonb_build_object('contact_phone','+12125550123'),'[]'::jsonb,
      '{"source_type":"owner"}'::jsonb);
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'confirmed update_brand_context with why/cites was refused: %',SQLERRM;
  END;
  IF (v_result->>'plan_revision')::integer <> 2
    OR (SELECT contact_phone FROM public.brands WHERE id=v_brand) <> '+12125550123'
    OR NOT EXISTS (
      SELECT 1 FROM public.agent_operation_receipts
      WHERE operation_id=v_operation_ok AND tool_name='update_brand_context') THEN
    RAISE EXCEPTION 'confirmed brand-context save did not write and receipt: %',v_result;
  END IF;
  v_replay := public.ari_update_brand_context(
    v_operation_ok,v_brand,1,v_context_revision,
    jsonb_build_object('contact_phone','+12125550123'),'[]'::jsonb,
    '{"source_type":"owner"}'::jsonb);
  IF v_replay IS DISTINCT FROM v_result THEN
    RAISE EXCEPTION 'confirmed brand-context save did not replay its receipt';
  END IF;

  -- Tampered: the owner confirmed one number; the call tries to write another.
  v_context_revision := public.brand_context_completeness_internal(v_brand)->>'context_revision';
  v_args := jsonb_build_object(
    'brand_id',v_brand,'expected_plan_revision',2,
    'expected_context_revision',v_context_revision,
    'patch',jsonb_build_object('contact_phone','+12125550188'),
    'exceptions','[]'::jsonb,
    'evidence','{"source_type":"owner"}'::jsonb,
    'why','You asked me to change the number.',
    'cites','[]'::jsonb);
  INSERT INTO public.agent_pending_actions(
    id,user_id,conversation_id,tool_name,tool_args,status,source,related_brand_id,
    server_proposed_at,execution_attested_at
  ) VALUES (
    v_operation_tampered,v_owner,v_conversation,'update_brand_context',v_args,
    'executing','ari',v_brand,now(),now()
  );
  v_failed := false;
  BEGIN
    PERFORM public.ari_update_brand_context(
      v_operation_tampered,v_brand,2,v_context_revision,
      jsonb_build_object('contact_phone','+19995550000'),'[]'::jsonb,
      '{"source_type":"owner"}'::jsonb);
  EXCEPTION WHEN OTHERS THEN
    v_error := SQLERRM;
    v_failed := v_error = 'operation_binding_mismatch';
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'a value the owner never confirmed was not refused (error=%)',v_error;
  END IF;
  IF (SELECT contact_phone FROM public.brands WHERE id=v_brand) <> '+12125550123'
    OR EXISTS (SELECT 1 FROM public.agent_operation_receipts
      WHERE operation_id=v_operation_tampered) THEN
    RAISE EXCEPTION 'tampered brand-context save changed data or wrote a receipt';
  END IF;
END;
$i2830rb$;

ROLLBACK;
