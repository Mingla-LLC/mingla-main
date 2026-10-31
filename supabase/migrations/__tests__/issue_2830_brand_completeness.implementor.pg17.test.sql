-- MINGLA-INVARIANT: I-2830-CONTEXT-IS-SERVER-TRUTH | issue #2830 | Website setup completeness, provenance and first-draft readiness are computed in Core; plan ticks and clients cannot award completion.
-- MINGLA-INVARIANT: I-2830-NO-DRAFT-BEFORE-SETUP | issue #2830 | Provisioning is refused until the first five plan parts and every required or recommended brand-context field are resolved.
-- MINGLA-INVARIANT: I-2830-PRE-DRAFT-DESIGN | issue #2830 | A revision-safe design choice lives on the shared setup plan before a brand_sites row exists.

\set ON_ERROR_STOP on
BEGIN;

DO $i2830$
DECLARE
  v_owner uuid := '28300000-0000-4000-8000-000000000001';
  v_other uuid := '28300000-0000-4000-8000-000000000002';
  v_admin uuid := '28300000-0000-4000-8000-000000000003';
  v_brand uuid := '28300000-0000-4000-8000-000000000010';
  v_manifest jsonb;
  v_result jsonb;
  v_job_id uuid;
  v_failed boolean;
BEGIN
  INSERT INTO auth.users(id,email) VALUES
    (v_owner,'owner-2830@example.invalid'),
    (v_other,'other-2830@example.invalid'),
    (v_admin,'admin-2830@example.invalid');
  INSERT INTO public.creator_accounts(id,created_at,updated_at)
  VALUES (v_owner,now(),now()),(v_other,now(),now());
  INSERT INTO public.admin_users(email,role,status,accepted_at)
  VALUES ('admin-2830@example.invalid','admin','active',now());
  INSERT INTO public.brands(id,account_id,name,slug,default_currency)
  VALUES (v_brand,v_owner,'North Star','north-star-2830','USD');

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
    brand_id,revision,offerings_selected,story,approved_plan,approved_at,
    approved_by,started_by,updated_by
  ) VALUES (
    v_brand,1,ARRAY[]::text[],
    '{"who":"Curious neighbours","why":"Owner-led gatherings","main_action":"Join the next event"}',
    '{"for":"Curious neighbours","main_action":"Join the next event","look":"Owner choice","pages":"Home · About · Contact","wont_do":"Invent claims"}',
    now(),v_owner,v_owner,v_owner
  );

  -- An incomplete brand has real plan ticks but is not Website-ready.
  v_manifest := public.brand_context_completeness_internal(v_brand);
  IF (v_manifest->>'required_gap_count')::integer < 2
    OR (v_manifest->>'recommended_gap_count')::integer < 5
    OR (v_manifest->>'context_complete')::boolean THEN
    RAISE EXCEPTION 'empty context was awarded completion: %',v_manifest;
  END IF;

  -- Design lives on the plan, creates no site and invalidates older approval.
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_owner)::text,true);
  PERFORM set_config('request.jwt.claim.sub',v_owner::text,true);
  v_result := public.brand_site_plan_save_design(v_brand,1,'voyage','owner',NULL);
  IF v_result->'plan'->>'design_key' <> 'voyage'
    OR (v_result->'plan'->>'revision')::integer <> 2
    OR v_result->'plan'->>'approved_at' IS NOT NULL
    OR EXISTS (SELECT 1 FROM public.brand_sites WHERE brand_id=v_brand) THEN
    RAISE EXCEPTION 'pre-draft design created a site or preserved stale approval: %',v_result;
  END IF;
  v_manifest := public.brand_context_completeness_internal(v_brand);
  IF (SELECT field->>'source_type' FROM jsonb_array_elements(v_manifest->'fields') field
      WHERE field->>'key'='design_key') <> 'owner'
    OR (SELECT field->>'owner_confirmed_at' FROM jsonb_array_elements(v_manifest->'fields') field
        WHERE field->>'key'='design_key') IS NULL THEN
    RAISE EXCEPTION 'design choice lost its owner provenance: %',v_manifest;
  END IF;

  -- Fill canonical values; recommended media are owner-provided HTTPS assets.
  UPDATE public.brands SET
    description='Owner-led gatherings for curious neighbours.',
    contact_email='hello@example.com',contact_phone='+12125550100',
    address='10 Orchard Street',city='Brooklyn',country_code='US',
    social_links='{"website":"https://example.com","instagram":"https://instagram.com/northstar"}',
    profile_photo_url='https://cdn.example.com/logo.png',
    cover_media_url='https://cdn.example.com/cover.jpg',cover_media_type='image',
    theme_color='#EA7825',theme_font='inter',theme_animation='none'
  WHERE id=v_brand;
  UPDATE public.brand_site_plans SET
    approved_plan='{"for":"Curious neighbours","main_action":"Join the next event","look":"Voyage","pages":"Home · About · Contact","wont_do":"Invent claims"}',
    approved_at=now(),approved_by=v_owner,lock_holder=NULL,lock_expires_at=NULL
  WHERE brand_id=v_brand;

  v_manifest := public.brand_context_completeness_internal(v_brand);
  IF NOT (v_manifest->>'context_complete')::boolean
    OR (v_manifest->>'gap_count')::integer <> 0 THEN
    RAISE EXCEPTION 'filled canonical context stayed incomplete: %',v_manifest;
  END IF;
  IF (SELECT field->>'source_ref' FROM jsonb_array_elements(v_manifest->'fields') field
      WHERE field->>'key'='name') IS NULL THEN
    RAISE EXCEPTION 'canonical Mingla value lost its provenance reference: %',v_manifest;
  END IF;

  -- A valid custom link satisfies the public-link field without a social account.
  UPDATE public.brands SET
    social_links='{}'::jsonb,
    custom_links='[{"label":"Book","url":"https://example.com/book"}]'::jsonb
  WHERE id=v_brand;
  v_manifest := public.brand_context_completeness_internal(v_brand);
  IF NOT (v_manifest->>'context_complete')::boolean THEN
    RAISE EXCEPTION 'valid custom link did not satisfy public links: %',v_manifest;
  END IF;
  UPDATE public.brands SET
    social_links='{"website":"https://example.com","instagram":"https://instagram.com/northstar"}'::jsonb,
    custom_links='[]'::jsonb
  WHERE id=v_brand;

  -- Provenance can reopen a present field when public research goes stale.
  INSERT INTO public.brand_context_field_evidence(
    brand_id,field_key,disposition,source_type,source_url,observed_at,updated_by
  ) VALUES (
    v_brand,'social_links','verified','public_research','https://example.com',
    now()-interval '181 days',v_owner
  );
  v_manifest := public.brand_context_completeness_internal(v_brand);
  IF (SELECT field->>'state' FROM jsonb_array_elements(v_manifest->'fields') field
      WHERE field->>'key'='social_links') <> 'stale'
    OR (v_manifest->>'context_complete')::boolean THEN
    RAISE EXCEPTION 'stale research did not reopen the gap: %',v_manifest;
  END IF;

  -- Fix all starts one durable job and reuses it after the gap is resolved.
  v_result := public.ari_start_brand_completeness_job(v_brand);
  v_job_id := (v_result#>>'{job,id}')::uuid;
  IF NOT (v_result#>'{job,pending_step_keys}' ? 'social_links') THEN
    RAISE EXCEPTION 'durable job did not carry the authoritative pending key: %',v_result;
  END IF;
  UPDATE public.brand_context_field_evidence SET observed_at=now(),updated_at=now()
  WHERE brand_id=v_brand AND field_key='social_links';
  v_result := public.ari_start_brand_completeness_job(v_brand);
  IF (v_result#>>'{job,id}')::uuid <> v_job_id
    OR v_result#>>'{job,status}' <> 'completed'
    OR jsonb_array_length(v_result#>'{job,pending_step_keys}') <> 0 THEN
    RAISE EXCEPTION 'Fix all did not resume and finish the same job: %',v_result;
  END IF;

  -- A recommended field may be resolved only by an explicit owner exception.
  UPDATE public.brands SET contact_phone=NULL WHERE id=v_brand;
  INSERT INTO public.brand_context_field_evidence(
    brand_id,field_key,disposition,source_type,observed_at,owner_confirmed_at,
    exception_reason,updated_by
  ) VALUES (
    v_brand,'contact_phone','not_applicable','owner',now(),now(),
    'This brand accepts enquiries by email only.',v_owner
  ) ON CONFLICT (brand_id,field_key) DO UPDATE SET
    disposition='not_applicable',source_type='owner',owner_confirmed_at=now(),
    exception_reason=EXCLUDED.exception_reason,updated_by=v_owner;
  v_manifest := public.brand_context_completeness_internal(v_brand);
  IF NOT (v_manifest->>'context_complete')::boolean
    OR (SELECT field->>'state' FROM jsonb_array_elements(v_manifest->'fields') field
        WHERE field->>'key'='contact_phone') <> 'not_applicable' THEN
    RAISE EXCEPTION 'owner exception did not resolve the recommended field: %',v_manifest;
  END IF;

  -- Provision authorization is the final server gate, not a client promise.
  v_result := public.brand_site_plan_authorize_provision(v_brand);
  IF v_result->>'design_key' <> 'voyage'
    OR NOT (v_result#>>'{context,context_complete}')::boolean THEN
    RAISE EXCEPTION 'complete setup could not authorize provision: %',v_result;
  END IF;

  UPDATE public.brands SET description=NULL WHERE id=v_brand;
  v_failed := false;
  BEGIN
    PERFORM public.brand_site_plan_authorize_provision(v_brand);
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM IN ('sites_plan_not_ready','sites_context_incomplete');
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'incomplete setup authorized a first draft'; END IF;

  -- Cross-tenant reads and direct table access remain closed.
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_other)::text,true);
  PERFORM set_config('request.jwt.claim.sub',v_other::text,true);
  v_failed := false;
  BEGIN PERFORM public.brand_context_completeness(v_brand);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM='sites_forbidden'; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'another owner read brand context'; END IF;
  IF has_table_privilege('authenticated','public.brand_context_field_evidence','SELECT')
    OR has_table_privilege('authenticated','public.brand_site_plans','UPDATE') THEN
    RAISE EXCEPTION 'context or plan tables bypass their RPC boundary';
  END IF;
END;
$i2830$;

ROLLBACK;
