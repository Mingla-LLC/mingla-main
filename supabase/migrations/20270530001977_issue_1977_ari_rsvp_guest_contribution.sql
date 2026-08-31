-- #1977 — canonical RSVP draft/lifecycle, minimized guest/contribution reads,
-- one guest-status effect owner, and contribution source-refund binding.
--
-- MONOTONIC VERSION 20270530001977 — MUST sort after
--   20270521001978 (#1978 120-row cert tip) and
--   20270527002592 (#2592 begin/finalize digest realign).
-- The prior filename 20270510001977 ran before the 120-row tip existed and
-- failed full-chain apply (#1174) on `issue_1977_expected_120_certification_requirements`.
--
-- #1972's shared agent_operation_receipts remains the only Ari confirmation
-- receipt. The domain receipt below is restricted to non-Ari Business clients
-- that provide their own stable request ID; Ari passes NULL to domain owners
-- inside ari_execute_rsvp_operation and completes the shared #1972 receipt in
-- the same transaction.

BEGIN;

CREATE TABLE IF NOT EXISTS public.rsvp_domain_operation_receipts (
  actor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  operation text NOT NULL,
  client_request_id uuid NOT NULL,
  event_id uuid NULL REFERENCES public.events(id) ON DELETE SET NULL,
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (actor_id, operation, client_request_id)
);
ALTER TABLE public.rsvp_domain_operation_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.rsvp_domain_operation_receipts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.rsvp_domain_operation_receipts TO service_role;

COMMENT ON TABLE public.rsvp_domain_operation_receipts IS
  '#1977 RSVP-domain replay receipts. Not an agent pending-action receipt; #1972 owns that generic seam.';

CREATE OR REPLACE FUNCTION public.issue_1977_rsvp_graph(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=public,pg_temp
AS $function$
DECLARE v_event public.events%ROWTYPE; v_brand public.brands%ROWTYPE; v_dates jsonb;
BEGIN
  SELECT * INTO v_event FROM public.events
  WHERE id=p_event_id AND event_type='rsvp' AND deleted_at IS NULL;
  IF NOT FOUND OR auth.uid() IS NULL OR
     public.biz_brand_effective_rank(v_event.brand_id,auth.uid())<public.biz_role_rank('event_manager') THEN
    RAISE EXCEPTION 'rsvp_not_found_or_forbidden' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_brand FROM public.brands WHERE id=v_event.brand_id AND deleted_at IS NULL;
  SELECT COALESCE(jsonb_agg(to_jsonb(d) ORDER BY d.start_at,d.id),'[]'::jsonb)
    INTO v_dates FROM public.event_dates d WHERE d.event_id=p_event_id;
  RETURN jsonb_build_object(
    'event',to_jsonb(v_event),
    'brand',jsonb_build_object('id',v_brand.id,'name',v_brand.name,'slug',v_brand.slug,
      'currency',v_brand.default_currency),
    'eventDates',v_dates,
    'tickets','[]'::jsonb,
    'clientRevision',COALESCE((v_event.theme#>>'{business_draft,clientRevision}')::integer,0)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_1977_current_rsvp_publish_payload(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=public,pg_temp
AS $function$
DECLARE v public.events%ROWTYPE;
BEGIN
  SELECT * INTO v FROM public.events
  WHERE id=p_event_id AND event_type='rsvp' AND status='draft' AND visibility='draft'
    AND deleted_at IS NULL;
  IF NOT FOUND OR auth.uid() IS NULL OR
     public.biz_brand_effective_rank(v.brand_id,auth.uid())<public.biz_role_rank('event_manager') THEN
    RAISE EXCEPTION 'rsvp_not_found_or_forbidden' USING ERRCODE='42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.ticket_types t WHERE t.event_id=p_event_id AND t.deleted_at IS NULL)
     OR EXISTS (SELECT 1 FROM public.event_dates d WHERE d.event_id=p_event_id) THEN
    RAISE EXCEPTION 'rsvp_draft_graph_invalid';
  END IF;
  RETURN jsonb_build_object(
    'title',v.title,'description',v.description,'location_text',v.location_text,
    'online_url',v.online_url,'cover_media_url',v.cover_media_url,
    'cover_media_poster_url',v.cover_media_poster_url,'cover_media_type',v.cover_media_type,
    'cover_media_provider',v.cover_media_provider,'cover_media_source_url',v.cover_media_source_url,
    'cover_media_credit',v.cover_media_credit,'cover_media_credit_url',v.cover_media_credit_url,
    'cover_media_alt',v.cover_media_alt,'cover_media_gallery',COALESCE(v.cover_media_gallery,'[]'::jsonb),
    'currency',v.currency,'is_online',v.is_online,'timezone',v.timezone,'theme',v.theme
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.business_create_rsvp_draft_graph(
  p_brand_id uuid,p_payload jsonb,p_client_request_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,extensions,pg_temp
AS $function$
DECLARE v_actor uuid:=auth.uid(); v_brand public.brands%ROWTYPE; v_event_id uuid;
  v_title text; v_timezone text; v_format text; v_draft jsonb; v_theme jsonb;
  v_hash text; v_prior public.rsvp_domain_operation_receipts%ROWTYPE; v_result jsonb;
  v_currency text; v_suggested integer; v_minimum integer;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT * INTO v_brand FROM public.brands WHERE id=p_brand_id AND deleted_at IS NULL;
  IF NOT FOUND OR public.biz_brand_effective_rank(p_brand_id,v_actor)<public.biz_role_rank('event_manager') THEN
    RAISE EXCEPTION 'rsvp_not_found_or_forbidden' USING ERRCODE='42501';
  END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN
    RAISE EXCEPTION 'rsvp_payload_invalid' USING ERRCODE='22023';
  END IF;
  v_draft:=COALESCE(p_payload#>'{theme,business_draft}','{}'::jsonb)||p_payload;
  v_title:=NULLIF(btrim(COALESCE(p_payload->>'title','')),'');
  v_timezone:=NULLIF(btrim(COALESCE(p_payload->>'timezone',v_draft->>'timezone','')),'');
  v_format:=COALESCE(NULLIF(v_draft->>'format',''),'in_person');
  IF v_title IS NULL OR v_timezone IS NULL OR v_format NOT IN ('in_person','online','hybrid') THEN
    RAISE EXCEPTION 'rsvp_payload_invalid' USING ERRCODE='22023';
  END IF;
  IF COALESCE(jsonb_array_length(COALESCE(v_draft->'tickets','[]'::jsonb)),0)<>0
     OR COALESCE(v_draft->>'isRsvp','true')<>'true' THEN
    RAISE EXCEPTION 'rsvp_ticket_wall' USING ERRCODE='22023';
  END IF;
  v_suggested:=NULLIF(v_draft->>'rsvpContributionSuggestedCents','')::integer;
  v_minimum:=NULLIF(v_draft->>'rsvpContributionMinCents','')::integer;
  IF (v_suggested IS NOT NULL AND v_suggested<=0)
     OR (v_minimum IS NOT NULL AND v_minimum<=0)
     OR (v_suggested IS NOT NULL AND v_minimum IS NOT NULL AND v_suggested<v_minimum) THEN
    RAISE EXCEPTION 'rsvp_contribution_amount_invalid' USING ERRCODE='22023';
  END IF;
  IF COALESCE((v_draft->>'rsvpContributionEnabled')::boolean,false)
     AND NOT public.pg_brand_can_collect(p_brand_id) THEN
    RAISE EXCEPTION 'stripe_charges_disabled' USING ERRCODE='42501';
  END IF;
  v_hash:=encode(extensions.digest(convert_to(p_brand_id::text||':'||p_payload::text,'UTF8'),'sha256'),'hex');
  IF p_client_request_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(v_actor::text||':rsvp_create:'||p_client_request_id::text,0));
    SELECT * INTO v_prior FROM public.rsvp_domain_operation_receipts
      WHERE actor_id=v_actor AND operation='create' AND client_request_id=p_client_request_id;
    IF FOUND THEN
      IF v_prior.request_hash<>v_hash THEN RAISE EXCEPTION 'rsvp_idempotency_hash_mismatch' USING ERRCODE='23505'; END IF;
      RETURN v_prior.result||jsonb_build_object('replayed',true);
    END IF;
  END IF;
  v_event_id:=gen_random_uuid();
  v_currency:=COALESCE(NULLIF(upper(p_payload->>'currency'),''),NULLIF(upper(v_draft->>'currency'),''),v_brand.default_currency);
  v_theme:=jsonb_set(COALESCE(p_payload->'theme','{}'::jsonb),'{business_draft}',
    v_draft||jsonb_build_object(
      'schemaVersion',COALESCE((v_draft->>'schemaVersion')::integer,1),'format',v_format,
      'partyTypes',COALESCE(v_draft->'partyTypes','[]'::jsonb),'vibeTags',COALESCE(v_draft->'vibeTags','[]'::jsonb),
      'musicGenres',COALESCE(v_draft->'musicGenres','[]'::jsonb),'city',v_draft->'city',
      'locationGeo',v_draft->'locationGeo','requestedVisibility',COALESCE(v_draft->>'requestedVisibility','private'),
      'currency',v_currency,'whenMode','single','when',COALESCE(v_draft->'when',jsonb_build_object('date',NULL,'doorsOpen',NULL,'endsAt',NULL,'timezone',v_timezone)),
      'location',COALESCE(v_draft->'location','{}'::jsonb),'tickets','[]'::jsonb,
      'settings',COALESCE(v_draft->'settings',jsonb_build_object('requireApproval',false,'allowTransfers',false,
        'hideRemainingCount',COALESCE((v_draft->>'hideRemainingCount')::boolean,false),'passwordProtected',false,
        'privateGuestList',COALESCE((v_draft->>'privateGuestList')::boolean,false),'inPersonPaymentsEnabled',false)),
      'isRsvp',true,'rsvpCapacity',v_draft->'rsvpCapacity',
      'rsvpAllowPlusOnes',COALESCE((v_draft->>'rsvpAllowPlusOnes')::boolean,false),
      'rsvpPlusOnesMax',COALESCE((v_draft->>'rsvpPlusOnesMax')::integer,0),
      'rsvpWaitlistEnabled',COALESCE((v_draft->>'rsvpWaitlistEnabled')::boolean,false),
      'rsvpApprovalMode',COALESCE(v_draft->>'rsvpApprovalMode','auto'),
      'rsvpDiscoverable',COALESCE((v_draft->>'rsvpDiscoverable')::boolean,false),
      'rsvpContributionEnabled',COALESCE((v_draft->>'rsvpContributionEnabled')::boolean,false),
      'rsvpContributionSuggestedCents',v_suggested,'rsvpContributionMinCents',v_minimum,
      'lastStepReached',COALESCE((v_draft->>'lastStepReached')::integer,0),
      'clientRevision',COALESCE((v_draft->>'clientRevision')::integer,0)
    ),true);
  INSERT INTO public.events(
    id,brand_id,created_by,title,slug,description,location_text,online_url,
    cover_media_url,cover_media_poster_url,cover_media_type,cover_media_provider,
    cover_media_source_url,cover_media_credit,cover_media_credit_url,cover_media_alt,
    cover_media_gallery,currency,is_online,is_recurring,is_multi_date,recurrence_rules,
    theme,visibility,status,timezone,event_type,party_types,vibe_tags,music_genres,city,
    theme_color_override,theme_font_override,theme_animation_override
  ) VALUES(
    v_event_id,p_brand_id,v_actor,v_title,'draft-'||v_event_id::text,
    NULLIF(p_payload->>'description',''),NULLIF(p_payload->>'location_text',''),NULLIF(p_payload->>'online_url',''),
    NULLIF(p_payload->>'cover_media_url',''),NULLIF(p_payload->>'cover_media_poster_url',''),NULLIF(p_payload->>'cover_media_type',''),
    NULLIF(p_payload->>'cover_media_provider',''),NULLIF(p_payload->>'cover_media_source_url',''),NULLIF(p_payload->>'cover_media_credit',''),
    NULLIF(p_payload->>'cover_media_credit_url',''),NULLIF(p_payload->>'cover_media_alt',''),COALESCE(p_payload->'cover_media_gallery','[]'::jsonb),
    v_currency,v_format IN ('online','hybrid'),false,false,NULL,v_theme,'draft','draft',v_timezone,'rsvp',
    ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_draft->'partyTypes','[]'::jsonb))),
    ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_draft->'vibeTags','[]'::jsonb))),
    ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_draft->'musicGenres','[]'::jsonb))),NULLIF(v_draft->>'city',''),
    NULLIF(p_payload->>'theme_color_override',''),NULLIF(p_payload->>'theme_font_override',''),
    NULLIF(p_payload->>'theme_animation_override','')
  );
  v_result:=public.issue_1977_rsvp_graph(v_event_id);
  IF p_client_request_id IS NOT NULL THEN
    INSERT INTO public.rsvp_domain_operation_receipts(actor_id,operation,client_request_id,event_id,request_hash,result)
    VALUES(v_actor,'create',p_client_request_id,v_event_id,v_hash,v_result);
  END IF;
  RETURN v_result||jsonb_build_object('replayed',false);
END;
$function$;

CREATE OR REPLACE FUNCTION public.business_update_rsvp_graph(
  p_event_id uuid,p_payload jsonb,p_reason text DEFAULT NULL,p_client_request_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,extensions,pg_temp
AS $function$
DECLARE v_actor uuid:=auth.uid(); v public.events%ROWTYPE; v_draft jsonb; v_patch jsonb; v_merged jsonb;
  v_theme jsonb; v_result jsonb; v_hash text; v_prior public.rsvp_domain_operation_receipts%ROWTYPE;
  v_live_payload jsonb; v_update_result jsonb; v_current_revision integer; v_expected_revision integer;
  v_suggested integer; v_minimum integer;
BEGIN
  IF v_actor IS NULL OR p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN
    RAISE EXCEPTION 'rsvp_payload_invalid' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v FROM public.events WHERE id=p_event_id AND event_type='rsvp' AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND OR public.biz_brand_effective_rank(v.brand_id,v_actor)<public.biz_role_rank('event_manager') THEN
    RAISE EXCEPTION 'rsvp_not_found_or_forbidden' USING ERRCODE='42501';
  END IF;
  v_hash:=encode(extensions.digest(convert_to(p_event_id::text||':'||p_payload::text||':'||COALESCE(p_reason,''),'UTF8'),'sha256'),'hex');
  IF p_client_request_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(v_actor::text||':rsvp_update:'||p_client_request_id::text,0));
    SELECT * INTO v_prior FROM public.rsvp_domain_operation_receipts
      WHERE actor_id=v_actor AND operation='update' AND client_request_id=p_client_request_id;
    IF FOUND THEN
      IF v_prior.request_hash<>v_hash THEN RAISE EXCEPTION 'rsvp_idempotency_hash_mismatch' USING ERRCODE='23505'; END IF;
      RETURN v_prior.result||jsonb_build_object('replayed',true);
    END IF;
  END IF;
  IF v.status='draft' AND v.visibility='draft' THEN
    IF EXISTS(SELECT 1 FROM public.event_dates d WHERE d.event_id=p_event_id)
       OR EXISTS(SELECT 1 FROM public.ticket_types t WHERE t.event_id=p_event_id AND t.deleted_at IS NULL) THEN
      RAISE EXCEPTION 'rsvp_draft_graph_invalid';
    END IF;
    v_draft:=COALESCE(v.theme#>'{business_draft}','{}'::jsonb);
    v_patch:=COALESCE(p_payload#>'{theme,business_draft}','{}'::jsonb)||p_payload;
    v_current_revision:=COALESCE((v_draft->>'clientRevision')::integer,0);
    v_expected_revision:=NULLIF(p_payload->>'__expectedClientRevision','')::integer;
    IF v_expected_revision IS NOT NULL AND v_expected_revision<>v_current_revision THEN
      RAISE EXCEPTION 'rsvp_revision_conflict' USING ERRCODE='40001';
    END IF;
    v_patch:=v_patch-'__expectedClientRevision';
    v_merged:=jsonb_set(v_draft||v_patch,'{clientRevision}',to_jsonb(v_current_revision+1),true);
    IF v_patch?'when' THEN v_merged:=jsonb_set(v_merged,'{when}',COALESCE(v_draft->'when','{}'::jsonb)||(v_patch->'when'),true); END IF;
    IF v_patch?'settings' THEN v_merged:=jsonb_set(v_merged,'{settings}',COALESCE(v_draft->'settings','{}'::jsonb)||(v_patch->'settings'),true); END IF;
    IF COALESCE(jsonb_array_length(COALESCE(v_merged->'tickets','[]'::jsonb)),0)<>0
       OR COALESCE((v_merged->>'isRsvp')::boolean,true)<>true THEN
      RAISE EXCEPTION 'rsvp_ticket_wall' USING ERRCODE='22023';
    END IF;
    v_suggested:=NULLIF(v_merged->>'rsvpContributionSuggestedCents','')::integer;
    v_minimum:=NULLIF(v_merged->>'rsvpContributionMinCents','')::integer;
    IF (v_suggested IS NOT NULL AND v_suggested<=0)
       OR (v_minimum IS NOT NULL AND v_minimum<=0)
       OR (v_suggested IS NOT NULL AND v_minimum IS NOT NULL AND v_suggested<v_minimum) THEN
      RAISE EXCEPTION 'rsvp_contribution_amount_invalid' USING ERRCODE='22023';
    END IF;
    IF COALESCE((v_merged->>'rsvpContributionEnabled')::boolean,false)
       AND NOT public.pg_brand_can_collect(v.brand_id) THEN
      RAISE EXCEPTION 'stripe_charges_disabled' USING ERRCODE='42501';
    END IF;
    v_theme:=jsonb_set(COALESCE(v.theme,'{}'::jsonb),'{business_draft}',v_merged,true);
    UPDATE public.events SET
      title=COALESCE(NULLIF(btrim(p_payload->>'title'),''),v.title),
      description=CASE WHEN p_payload?'description' THEN NULLIF(p_payload->>'description','') ELSE v.description END,
      location_text=CASE WHEN p_payload?'location_text' THEN NULLIF(p_payload->>'location_text','') ELSE v.location_text END,
      online_url=CASE WHEN p_payload?'online_url' THEN NULLIF(p_payload->>'online_url','') ELSE v.online_url END,
      cover_media_url=CASE WHEN p_payload?'cover_media_url' THEN NULLIF(p_payload->>'cover_media_url','') ELSE v.cover_media_url END,
      cover_media_poster_url=CASE WHEN p_payload?'cover_media_poster_url' THEN NULLIF(p_payload->>'cover_media_poster_url','') ELSE v.cover_media_poster_url END,
      cover_media_type=CASE WHEN p_payload?'cover_media_type' THEN NULLIF(p_payload->>'cover_media_type','') ELSE v.cover_media_type END,
      cover_media_provider=CASE WHEN p_payload?'cover_media_provider' THEN NULLIF(p_payload->>'cover_media_provider','') ELSE v.cover_media_provider END,
      cover_media_source_url=CASE WHEN p_payload?'cover_media_source_url' THEN NULLIF(p_payload->>'cover_media_source_url','') ELSE v.cover_media_source_url END,
      cover_media_credit=CASE WHEN p_payload?'cover_media_credit' THEN NULLIF(p_payload->>'cover_media_credit','') ELSE v.cover_media_credit END,
      cover_media_credit_url=CASE WHEN p_payload?'cover_media_credit_url' THEN NULLIF(p_payload->>'cover_media_credit_url','') ELSE v.cover_media_credit_url END,
      cover_media_alt=CASE WHEN p_payload?'cover_media_alt' THEN NULLIF(p_payload->>'cover_media_alt','') ELSE v.cover_media_alt END,
      cover_media_gallery=CASE WHEN p_payload?'cover_media_gallery' THEN p_payload->'cover_media_gallery' ELSE v.cover_media_gallery END,
      timezone=COALESCE(NULLIF(p_payload->>'timezone',''),v.timezone),
      is_online=CASE WHEN v_patch?'format' THEN (v_patch->>'format') IN ('online','hybrid') ELSE v.is_online END,
      theme=v_theme,
      party_types=CASE WHEN v_patch?'partyTypes' THEN ARRAY(SELECT jsonb_array_elements_text(v_patch->'partyTypes')) ELSE v.party_types END,
      vibe_tags=CASE WHEN v_patch?'vibeTags' THEN ARRAY(SELECT jsonb_array_elements_text(v_patch->'vibeTags')) ELSE v.vibe_tags END,
      music_genres=CASE WHEN v_patch?'musicGenres' THEN ARRAY(SELECT jsonb_array_elements_text(v_patch->'musicGenres')) ELSE v.music_genres END,
      city=CASE WHEN v_patch?'city' THEN NULLIF(v_patch->>'city','') ELSE v.city END,
      theme_color_override=CASE WHEN p_payload?'theme_color_override' THEN NULLIF(p_payload->>'theme_color_override','') ELSE v.theme_color_override END,
      theme_font_override=CASE WHEN p_payload?'theme_font_override' THEN NULLIF(p_payload->>'theme_font_override','') ELSE v.theme_font_override END,
      theme_animation_override=CASE WHEN p_payload?'theme_animation_override' THEN NULLIF(p_payload->>'theme_animation_override','') ELSE v.theme_animation_override END,
      currency=COALESCE(NULLIF(upper(COALESCE(p_payload->>'currency',v_patch->>'currency')),''),v.currency),updated_at=now()
    WHERE id=p_event_id;
  ELSE
    IF length(btrim(COALESCE(p_reason,''))) NOT BETWEEN 10 AND 200 THEN
      RAISE EXCEPTION 'rsvp_edit_reason_invalid' USING ERRCODE='22023';
    END IF;
    v_live_payload:=p_payload||jsonb_build_object('title',COALESCE(NULLIF(p_payload->>'title',''),v.title));
    v_update_result:=public.biz_update_live_rsvp(p_event_id,v_live_payload,p_reason);
    UPDATE public.events SET
      party_types=CASE WHEN p_payload?'partyTypes' THEN ARRAY(SELECT jsonb_array_elements_text(p_payload->'partyTypes')) ELSE party_types END,
      vibe_tags=CASE WHEN p_payload?'vibeTags' THEN ARRAY(SELECT jsonb_array_elements_text(p_payload->'vibeTags')) ELSE vibe_tags END,
      music_genres=CASE WHEN p_payload?'musicGenres' THEN ARRAY(SELECT jsonb_array_elements_text(p_payload->'musicGenres')) ELSE music_genres END,
      city=CASE WHEN p_payload?'city' THEN NULLIF(p_payload->>'city','') ELSE city END
    WHERE id=p_event_id;
  END IF;
  v_result:=public.issue_1977_rsvp_graph(p_event_id);
  IF v_update_result IS NOT NULL THEN
    v_result:=v_result||jsonb_build_object('updateResult',v_update_result);
  END IF;
  IF p_client_request_id IS NOT NULL THEN
    INSERT INTO public.rsvp_domain_operation_receipts(actor_id,operation,client_request_id,event_id,request_hash,result)
    VALUES(v_actor,'update',p_client_request_id,p_event_id,v_hash,v_result);
  END IF;
  RETURN v_result||jsonb_build_object('replayed',false);
END;
$function$;

CREATE OR REPLACE FUNCTION public.business_publish_rsvp_graph(
  p_event_id uuid,p_client_request_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,extensions,pg_temp
AS $function$
DECLARE v_actor uuid:=auth.uid(); v_payload jsonb; v_result jsonb; v_hash text;
  v_prior public.rsvp_domain_operation_receipts%ROWTYPE; v_revision integer; v_event public.events%ROWTYPE;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT * INTO v_event FROM public.events WHERE id=p_event_id AND event_type='rsvp';
  IF NOT FOUND OR public.biz_brand_effective_rank(v_event.brand_id,v_actor)<public.biz_role_rank('event_manager') THEN
    RAISE EXCEPTION 'rsvp_not_found_or_forbidden' USING ERRCODE='42501';
  END IF;
  v_hash:=encode(extensions.digest(convert_to(p_event_id::text,'UTF8'),'sha256'),'hex');
  IF p_client_request_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(v_actor::text||':rsvp_publish:'||p_client_request_id::text,0));
    SELECT * INTO v_prior FROM public.rsvp_domain_operation_receipts
      WHERE actor_id=v_actor AND operation='publish' AND client_request_id=p_client_request_id;
    IF FOUND THEN
      IF v_prior.request_hash<>v_hash OR v_prior.event_id IS DISTINCT FROM p_event_id THEN
        RAISE EXCEPTION 'rsvp_idempotency_hash_mismatch' USING ERRCODE='23505';
      END IF;
      RETURN v_prior.result||jsonb_build_object('replayed',true);
    END IF;
  END IF;
  v_payload:=public.issue_1977_current_rsvp_publish_payload(p_event_id);
  v_revision:=COALESCE((v_payload#>>'{theme,business_draft,clientRevision}')::integer,0);
  PERFORM public.business_publish_rsvp_draft(p_event_id,v_payload,v_revision);
  v_result:=public.issue_1977_rsvp_graph(p_event_id);
  IF p_client_request_id IS NOT NULL THEN
    INSERT INTO public.rsvp_domain_operation_receipts(actor_id,operation,client_request_id,event_id,request_hash,result)
    VALUES(v_actor,'publish',p_client_request_id,p_event_id,v_hash,v_result);
  END IF;
  RETURN v_result||jsonb_build_object('replayed',false);
END;
$function$;

CREATE OR REPLACE FUNCTION public.business_discard_rsvp_draft(p_event_id uuid,p_client_request_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions,pg_temp AS $function$
DECLARE v_actor uuid:=auth.uid(); v public.events%ROWTYPE; v_result jsonb; v_hash text;
  v_prior public.rsvp_domain_operation_receipts%ROWTYPE;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT * INTO v FROM public.events WHERE id=p_event_id AND event_type='rsvp';
  IF NOT FOUND OR public.biz_brand_effective_rank(v.brand_id,v_actor)<public.biz_role_rank('event_manager') THEN
    RAISE EXCEPTION 'rsvp_not_found_or_forbidden' USING ERRCODE='42501';
  END IF;
  v_hash:=encode(extensions.digest(convert_to(p_event_id::text,'UTF8'),'sha256'),'hex');
  IF p_client_request_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(v_actor::text||':rsvp_discard:'||p_client_request_id::text,0));
    SELECT * INTO v_prior FROM public.rsvp_domain_operation_receipts
      WHERE actor_id=v_actor AND operation='discard' AND client_request_id=p_client_request_id;
    IF FOUND THEN
      IF v_prior.request_hash<>v_hash OR v_prior.event_id IS DISTINCT FROM p_event_id THEN
        RAISE EXCEPTION 'rsvp_idempotency_hash_mismatch' USING ERRCODE='23505';
      END IF;
      RETURN v_prior.result||jsonb_build_object('replayed',true);
    END IF;
  END IF;
  SELECT * INTO v FROM public.events WHERE id=p_event_id AND event_type='rsvp' AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND OR v.status<>'draft' OR v.visibility<>'draft' THEN
    RAISE EXCEPTION 'rsvp_not_found_or_forbidden' USING ERRCODE='42501';
  END IF;
  v_result:=public.business_discard_event_draft(p_event_id);
  IF p_client_request_id IS NOT NULL THEN
    INSERT INTO public.rsvp_domain_operation_receipts(actor_id,operation,client_request_id,event_id,request_hash,result)
    VALUES(v_actor,'discard',p_client_request_id,p_event_id,v_hash,v_result);
  END IF;
  RETURN v_result||jsonb_build_object('replayed',false);
END;
$function$;

CREATE OR REPLACE FUNCTION public.business_list_rsvp_roster(
  p_event_id uuid,p_search text DEFAULT NULL,p_cursor jsonb DEFAULT NULL,p_limit integer DEFAULT 50
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $function$
DECLARE v_event public.events%ROWTYPE; v_search text; v_watermark bigint; v_rows jsonb; v_summary jsonb;
  v_cursor_created timestamptz; v_cursor_id uuid; v_last jsonb;
BEGIN
  SELECT * INTO v_event FROM public.events WHERE id=p_event_id AND event_type='rsvp' AND deleted_at IS NULL;
  IF NOT FOUND OR auth.uid() IS NULL OR
     public.biz_brand_effective_rank(v_event.brand_id,auth.uid())<public.biz_role_rank('event_manager') THEN
    RAISE EXCEPTION 'rsvp_not_found_or_forbidden' USING ERRCODE='42501';
  END IF;
  IF p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'rsvp_roster_limit_invalid' USING ERRCODE='22023'; END IF;
  v_search:=lower(btrim(COALESCE(p_search,'')));
  IF length(v_search)>120 OR v_search~E'[\\x00-\\x1F\\x7F]' THEN RAISE EXCEPTION 'rsvp_roster_search_invalid' USING ERRCODE='22023'; END IF;
  SELECT COALESCE(max(id),0) INTO v_watermark FROM public.guest_roster_change_events WHERE event_id=p_event_id;
  IF p_cursor IS NOT NULL THEN
    IF (p_cursor->>'watermark')::bigint<>v_watermark THEN RAISE EXCEPTION 'rsvp_roster_stale' USING ERRCODE='40001'; END IF;
    v_cursor_created:=(p_cursor->>'createdAt')::timestamptz; v_cursor_id:=(p_cursor->>'rsvpId')::uuid;
  END IF;
  WITH projected AS (
    SELECT r.id,r.created_at,
      COALESCE(NULLIF(btrim(p.display_name),''),NULLIF(btrim(r.guest_name),''),'Unnamed RSVP') display_name,
      r.rsvp_status,r.approval_status,1+r.plus_count party_size,
      (r.checked_in_at IS NOT NULL OR EXISTS(SELECT 1 FROM public.event_rsvp_guests g WHERE g.rsvp_id=r.id AND g.checked_in_at IS NOT NULL)) checked_in
    FROM public.event_rsvps r LEFT JOIN public.profiles p ON p.id=r.user_id
    WHERE r.event_id=p_event_id
      AND (v_search='' OR strpos(lower(COALESCE(NULLIF(btrim(p.display_name),''),NULLIF(btrim(r.guest_name),''),'Unnamed RSVP')),v_search)>0)
      AND (p_cursor IS NULL OR (r.created_at,r.id)>(v_cursor_created,v_cursor_id))
    ORDER BY r.created_at,r.id LIMIT p_limit
  ), safe_rows AS (
    SELECT jsonb_build_object('rosterKey','rsvp:'||id::text,'displayName',display_name,
      'attendanceStatus',rsvp_status,'approvalStatus',approval_status,'partySize',party_size,
      'checkedIn',checked_in,'canApprove',(rsvp_status IN ('going','waitlisted') AND approval_status IN ('pending','denied')),
      'canDeny',(rsvp_status IN ('going','waitlisted') AND approval_status IN ('pending','approved')),
      'createdAt',created_at) row_data FROM projected
  ) SELECT COALESCE(jsonb_agg(row_data ORDER BY row_data->>'createdAt',row_data->>'rosterKey'),'[]'::jsonb)
    INTO v_rows FROM safe_rows;
  SELECT jsonb_build_object('all',count(*),'pending',count(*) FILTER(WHERE approval_status='pending'),
    'goingPeople',COALESCE(sum(1+plus_count) FILTER(WHERE rsvp_status='going' AND approval_status='approved'),0),
    'checkedIn',count(*) FILTER(WHERE checked_in_at IS NOT NULL),'watermark',v_watermark)
    INTO v_summary FROM public.event_rsvps WHERE event_id=p_event_id;
  IF jsonb_array_length(v_rows)>0 THEN v_last:=v_rows->(jsonb_array_length(v_rows)-1); END IF;
  RETURN jsonb_build_object('rows',v_rows,'summary',v_summary,'watermark',v_watermark,
    'nextCursor',CASE WHEN jsonb_array_length(v_rows)=p_limit THEN jsonb_build_object(
      'createdAt',v_last->>'createdAt','rsvpId',substring(v_last->>'rosterKey' from 6),'watermark',v_watermark) ELSE NULL END);
END;
$function$;

CREATE OR REPLACE FUNCTION public.business_set_rsvp_guest_status(
  p_event_id uuid,p_decision text,p_scope text,p_roster_keys text[] DEFAULT NULL,
  p_expected_watermark bigint DEFAULT NULL,p_client_request_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions,pg_temp AS $function$
DECLARE v_actor uuid:=auth.uid(); v_event public.events%ROWTYPE; v_ids uuid[]; v_id uuid; v_row public.event_rsvps%ROWTYPE;
  v_target text; v_confirmed integer; v_requested integer; v_free integer; v_applied integer:=0;
  v_unchanged integer:=0; v_skipped integer:=0; v_results jsonb:='[]'::jsonb; v_pending integer; v_going integer;
  v_watermark bigint; v_hash text; v_prior public.rsvp_domain_operation_receipts%ROWTYPE; v_result jsonb;
BEGIN
  SELECT * INTO v_event FROM public.events WHERE id=p_event_id AND event_type='rsvp' AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND OR v_actor IS NULL OR
     public.biz_brand_effective_rank(v_event.brand_id,v_actor)<public.biz_role_rank('event_manager') THEN
    RAISE EXCEPTION 'rsvp_not_found_or_forbidden' USING ERRCODE='42501';
  END IF;
  IF p_decision NOT IN ('approve','deny') OR p_scope NOT IN ('selected','all_pending') THEN
    RAISE EXCEPTION 'rsvp_guest_action_invalid' USING ERRCODE='22023';
  END IF;
  v_target:=CASE p_decision WHEN 'approve' THEN 'approved' ELSE 'denied' END;
  IF p_scope='selected' THEN
    IF p_roster_keys IS NULL OR cardinality(p_roster_keys) NOT BETWEEN 1 AND 100
       OR cardinality(p_roster_keys)<>cardinality(ARRAY(SELECT DISTINCT unnest(p_roster_keys)))
       OR EXISTS(SELECT 1 FROM unnest(p_roster_keys) k WHERE k!~'^rsvp:[0-9a-f-]{36}$') THEN
      RAISE EXCEPTION 'rsvp_guest_selection_invalid' USING ERRCODE='22023';
    END IF;
    SELECT array_agg(substring(k from 6)::uuid ORDER BY substring(k from 6)::uuid) INTO v_ids FROM unnest(p_roster_keys) k;
  ELSE
    IF p_roster_keys IS NOT NULL THEN RAISE EXCEPTION 'rsvp_guest_selection_invalid' USING ERRCODE='22023'; END IF;
    v_ids:='{}'::uuid[];
  END IF;
  v_hash:=encode(extensions.digest(convert_to(p_event_id::text||':'||p_decision||':'||p_scope||':'||
    COALESCE(to_jsonb(p_roster_keys)::text,'null')||':'||COALESCE(p_expected_watermark::text,'null'),'UTF8'),'sha256'),'hex');
  IF p_client_request_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(v_actor::text||':rsvp_guest_status:'||p_client_request_id::text,0));
    SELECT * INTO v_prior FROM public.rsvp_domain_operation_receipts
      WHERE actor_id=v_actor AND operation='guest_status' AND client_request_id=p_client_request_id;
    IF FOUND THEN
      IF v_prior.request_hash<>v_hash OR v_prior.event_id IS DISTINCT FROM p_event_id THEN
        RAISE EXCEPTION 'rsvp_idempotency_hash_mismatch' USING ERRCODE='23505';
      END IF;
      RETURN v_prior.result||jsonb_build_object('replayed',true);
    END IF;
  END IF;
  SELECT COALESCE(max(id),0) INTO v_watermark FROM public.guest_roster_change_events WHERE event_id=p_event_id;
  IF p_expected_watermark IS NOT NULL AND p_expected_watermark<>v_watermark THEN
    RAISE EXCEPTION 'rsvp_roster_stale' USING ERRCODE='40001';
  END IF;
  IF p_scope='all_pending' THEN
    SELECT array_agg(id ORDER BY created_at,id) INTO v_ids FROM public.event_rsvps
      WHERE event_id=p_event_id AND approval_status='pending';
    v_ids:=COALESCE(v_ids,'{}'::uuid[]);
  END IF;
  PERFORM 1 FROM public.event_rsvps WHERE id=ANY(v_ids) ORDER BY id FOR UPDATE;
  IF p_scope='selected' AND (SELECT count(*) FROM public.event_rsvps WHERE id=ANY(v_ids) AND event_id=p_event_id)<>cardinality(v_ids) THEN
    RAISE EXCEPTION 'rsvp_guest_selection_stale' USING ERRCODE='40001';
  END IF;
  IF p_scope='selected' AND EXISTS(SELECT 1 FROM public.event_rsvps WHERE id=ANY(v_ids) AND
      (event_id<>p_event_id OR rsvp_status NOT IN ('going','waitlisted') OR approval_status NOT IN ('pending','approved','denied'))) THEN
    RAISE EXCEPTION 'rsvp_guest_selection_stale' USING ERRCODE='40001';
  END IF;
  SELECT COALESCE(sum(1+plus_count),0) INTO v_confirmed FROM public.event_rsvps
    WHERE event_id=p_event_id AND rsvp_status='going' AND approval_status='approved'
      AND NOT(id=ANY(v_ids));
  IF p_decision='approve' AND p_scope='selected' AND v_event.rsvp_capacity IS NOT NULL THEN
    SELECT COALESCE(sum(1+plus_count),0) INTO v_requested FROM public.event_rsvps WHERE id=ANY(v_ids);
    IF v_confirmed+v_requested>v_event.rsvp_capacity THEN RAISE EXCEPTION 'rsvp_capacity_full' USING ERRCODE='23514'; END IF;
  END IF;
  v_free:=CASE WHEN v_event.rsvp_capacity IS NULL THEN NULL ELSE v_event.rsvp_capacity-v_confirmed END;
  FOREACH v_id IN ARRAY v_ids LOOP
    SELECT * INTO v_row FROM public.event_rsvps WHERE id=v_id;
    IF p_decision='approve' AND p_scope='all_pending' AND v_free IS NOT NULL AND 1+v_row.plus_count>v_free THEN
      v_skipped:=v_skipped+1; v_results:=v_results||jsonb_build_array(jsonb_build_object('rosterKey','rsvp:'||v_id,'outcome','skipped_for_capacity')); CONTINUE;
    END IF;
    IF v_row.approval_status=v_target THEN
      v_unchanged:=v_unchanged+1; v_results:=v_results||jsonb_build_array(jsonb_build_object('rosterKey','rsvp:'||v_id,'outcome','unchanged')); CONTINUE;
    END IF;
    IF p_decision='approve' THEN
      UPDATE public.event_rsvps SET approval_status='approved',rsvp_status=CASE WHEN rsvp_status='waitlisted' THEN 'going' ELSE rsvp_status END WHERE id=v_id;
      IF (SELECT rsvp_status FROM public.event_rsvps WHERE id=v_id)='going' THEN PERFORM public.enqueue_rsvp_pass(v_id,NULL); END IF;
      IF v_free IS NOT NULL THEN v_free:=v_free-(1+v_row.plus_count); END IF;
    ELSE
      UPDATE public.event_rsvps SET approval_status='denied' WHERE id=v_id;
      INSERT INTO public.rsvp_notifications(event_id,rsvp_id,channel,recipient,status,template_key,payload,idempotency_key,attempt_count)
      VALUES(p_event_id,v_id,NULL,NULL,'pending',CASE WHEN v_row.approval_status='approved' THEN 'rsvp_removed' ELSE 'rsvp_denied' END,
        jsonb_build_object('rsvp_id',v_id,'event_id',p_event_id),
        'rsvp_approval:'||v_id::text||':'||v_row.approval_status||':denied',0) ON CONFLICT(idempotency_key) DO NOTHING;
    END IF;
    v_applied:=v_applied+1; v_results:=v_results||jsonb_build_array(jsonb_build_object(
      'rosterKey','rsvp:'||v_id,'outcome','applied','approvalStatus',v_target,
      'wasRemoved',(p_decision='deny' AND v_row.approval_status='approved')));
  END LOOP;
  SELECT count(*) FILTER(WHERE approval_status='pending'),
    COALESCE(sum(1+plus_count) FILTER(WHERE rsvp_status='going' AND approval_status='approved'),0)
    INTO v_pending,v_going FROM public.event_rsvps WHERE event_id=p_event_id;
  SELECT COALESCE(max(id),0) INTO v_watermark FROM public.guest_roster_change_events WHERE event_id=p_event_id;
  v_result:=jsonb_build_object('requestedCount',cardinality(v_ids),'appliedCount',v_applied,'unchangedCount',v_unchanged,
    'skippedForCapacity',v_skipped,'outcomes',v_results,'pendingRemaining',v_pending,'goingPersonCount',v_going,'watermark',v_watermark);
  IF p_client_request_id IS NOT NULL THEN
    INSERT INTO public.rsvp_domain_operation_receipts(actor_id,operation,client_request_id,event_id,request_hash,result)
    VALUES(v_actor,'guest_status',p_client_request_id,p_event_id,v_hash,v_result);
  END IF;
  RETURN v_result||jsonb_build_object('replayed',false);
END;
$function$;

CREATE OR REPLACE FUNCTION public.host_set_rsvp_status(p_rsvp_id uuid,p_status text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $function$
DECLARE v_event_id uuid; v_result jsonb; v_previous text;
BEGIN
  SELECT event_id,approval_status INTO v_event_id,v_previous FROM public.event_rsvps WHERE id=p_rsvp_id;
  IF v_event_id IS NULL THEN RAISE EXCEPTION 'rsvp_not_found'; END IF;
  v_result:=public.business_set_rsvp_guest_status(v_event_id,
    CASE p_status WHEN 'approved' THEN 'approve' WHEN 'denied' THEN 'deny' ELSE p_status END,
    'selected',ARRAY['rsvp:'||p_rsvp_id::text],NULL,NULL);
  RETURN jsonb_build_object('ok',true,'rsvpId',p_rsvp_id,'approvalStatus',p_status,
    'wasRemoved',(v_previous='approved' AND p_status='denied'),
    'pendingCountRemaining',v_result->'pendingRemaining','goingCountRemaining',v_result->'goingPersonCount');
END;
$function$;

CREATE OR REPLACE FUNCTION public.host_bulk_approve_rsvps(p_event_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $function$
DECLARE v_result jsonb;
BEGIN
  v_result:=public.business_set_rsvp_guest_status(p_event_id,'approve','all_pending',NULL,NULL,NULL);
  RETURN jsonb_build_object('approvedCount',v_result->'appliedCount','skippedForCapacity',v_result->'skippedForCapacity');
END;
$function$;

CREATE OR REPLACE FUNCTION public.biz_guest_roster_set_rsvp_approval(
  p_event_id uuid,p_roster_key text,p_decision text,p_client_request_id uuid
) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $function$
  SELECT public.business_set_rsvp_guest_status(p_event_id,p_decision,'selected',ARRAY[p_roster_key],NULL,p_client_request_id)
$function$;

CREATE OR REPLACE FUNCTION public.business_list_rsvp_contributions(
  p_event_id uuid,p_status text DEFAULT NULL,p_cursor jsonb DEFAULT NULL,p_limit integer DEFAULT 50
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $function$
DECLARE v_event public.events%ROWTYPE; v_created timestamptz; v_id uuid; v_rows jsonb; v_last jsonb;
BEGIN
  SELECT * INTO v_event FROM public.events WHERE id=p_event_id AND event_type='rsvp' AND deleted_at IS NULL;
  IF NOT FOUND OR auth.uid() IS NULL OR
     public.biz_brand_effective_rank(v_event.brand_id,auth.uid())<public.biz_role_rank('finance_manager') THEN
    RAISE EXCEPTION 'rsvp_not_found_or_forbidden' USING ERRCODE='42501';
  END IF;
  IF p_status IS NOT NULL AND p_status NOT IN ('paid','partially_refunded','refunded') OR p_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'rsvp_contribution_filter_invalid' USING ERRCODE='22023';
  END IF;
  IF p_cursor IS NOT NULL THEN v_created:=(p_cursor->>'createdAt')::timestamptz; v_id:=(p_cursor->>'contributionId')::uuid; END IF;
  WITH page AS (
    SELECT c.*,COALESCE(NULLIF(btrim(p.display_name),''),NULLIF(btrim(c.guest_name),''),'Unnamed contribution') display_label,
      GREATEST(0,c.amount_cents-c.application_fee_amount_cents-c.refunded_amount_cents) discretionary_cents,
      GREATEST(0,c.buyer_total_cents-c.refunded_amount_cents) cancellation_cents,
      sr.financial_state refund_state
    FROM public.event_rsvp_contributions c LEFT JOIN public.profiles p ON p.id=c.user_id
    LEFT JOIN LATERAL(SELECT financial_state FROM public.source_refunds s
      WHERE s.source_type='rsvp_contribution' AND s.source_id=c.id ORDER BY s.requested_at DESC LIMIT 1) sr ON true
    WHERE c.event_id=p_event_id AND (p_status IS NULL OR c.status=p_status)
      AND (p_cursor IS NULL OR (c.created_at,c.id)>(v_created,v_id))
    ORDER BY c.created_at,c.id LIMIT p_limit
  ) SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'contributionId',id,'displayLabel',display_label,'currency',upper(currency),
    'buyerTotalCents',buyer_total_cents,'refundable',jsonb_build_object('discretionaryCents',discretionary_cents,'cancellationCents',cancellation_cents),
    'contributionState',status,'refundState',refund_state,'createdAt',created_at
  ) ORDER BY created_at,id),'[]'::jsonb) INTO v_rows FROM page;
  IF jsonb_array_length(v_rows)>0 THEN v_last:=v_rows->(jsonb_array_length(v_rows)-1); END IF;
  RETURN jsonb_build_object('rows',v_rows,'nextCursor',CASE WHEN jsonb_array_length(v_rows)=p_limit THEN jsonb_build_object(
    'createdAt',v_last->>'createdAt','contributionId',v_last->>'contributionId') ELSE NULL END);
END;
$function$;

DROP FUNCTION IF EXISTS public.biz_prepare_rsvp_contribution_refund(uuid,text,text,text);
CREATE OR REPLACE FUNCTION public.biz_prepare_rsvp_contribution_refund(
  p_event_id uuid,p_contribution_id uuid,p_mode text,p_reason text,p_client_idempotency_key text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $function$
DECLARE v_uid uuid:=auth.uid(); v_c public.event_rsvp_contributions%ROWTYPE; v_event public.events%ROWTYPE;
  v_refund public.source_refunds%ROWTYPE; v_requested integer; v_fee integer; v_provider_ref text; v_account text;
BEGIN
  SELECT * INTO v_event FROM public.events WHERE id=p_event_id AND event_type='rsvp' AND deleted_at IS NULL;
  SELECT * INTO v_c FROM public.event_rsvp_contributions WHERE id=p_contribution_id AND event_id=p_event_id;
  IF v_uid IS NULL OR NOT FOUND OR v_event.id IS NULL OR
     public.biz_brand_effective_rank(v_event.brand_id,v_uid)<public.biz_role_rank('finance_manager') THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501';
  END IF;
  IF p_mode NOT IN ('discretionary','cancellation') OR length(btrim(COALESCE(p_reason,'')))<3
     OR NULLIF(btrim(COALESCE(p_client_idempotency_key,'')),'') IS NULL THEN
    RAISE EXCEPTION 'refund_request_invalid' USING ERRCODE='22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('rsvp_contribution:'||v_c.id::text,0));
  SELECT * INTO v_c FROM public.event_rsvp_contributions WHERE id=p_contribution_id AND event_id=p_event_id FOR UPDATE;
  IF p_mode='cancellation' AND v_event.status<>'cancelled' THEN RAISE EXCEPTION 'event_not_cancelled'; END IF;
  SELECT * INTO v_refund FROM public.source_refunds WHERE source_type='rsvp_contribution' AND source_id=v_c.id
    AND refund_kind=CASE WHEN p_mode='cancellation' THEN 'event_cancel' ELSE 'rsvp_discretionary' END;
  IF FOUND THEN RETURN public.issue_1221_source_refund_summary(v_refund); END IF;
  v_requested:=CASE WHEN p_mode='cancellation' THEN v_c.buyer_total_cents-v_c.refunded_amount_cents
    ELSE GREATEST(0,v_c.amount_cents-v_c.application_fee_amount_cents-v_c.refunded_amount_cents) END;
  v_fee:=CASE WHEN p_mode='cancellation' THEN LEAST(v_requested,v_c.application_fee_amount_cents) ELSE 0 END;
  IF v_requested<=0 THEN RAISE EXCEPTION 'nothing_to_refund'; END IF;
  v_provider_ref:=COALESCE(v_c.stripe_charge_id,v_c.stripe_payment_intent_id);
  SELECT stripe_connect_id INTO v_account FROM public.brands WHERE id=v_c.brand_id;
  INSERT INTO public.source_refunds(source_type,source_id,subject_id,brand_id,event_id,refund_kind,
    requested_by_type,requested_by_user_id,reason,provider,currency,original_charge_cents,buyer_refund_requested_cents,
    original_application_fee_cents,fee_reversal_required_cents,fee_state,fee_leg_kind,financial_state,
    organizer_refund_liability_cents,platform_fee_absorption_cents,provider_payment_reference,provider_account_reference,idempotency_key)
  VALUES('rsvp_contribution',v_c.id,v_c.id,v_c.brand_id,v_c.event_id,
    CASE WHEN p_mode='cancellation' THEN 'event_cancel' ELSE 'rsvp_discretionary' END,'brand_staff',v_uid,btrim(p_reason),
    v_c.provider,upper(v_c.currency),v_c.buyer_total_cents,v_requested,v_c.application_fee_amount_cents,v_fee,
    CASE WHEN v_fee=0 THEN 'not_required' WHEN v_c.provider='stripe' THEN 'needs_attention' ELSE 'queued' END,
    CASE WHEN v_fee=0 THEN 'not_required' WHEN v_c.provider='stripe' THEN 'stripe_application_fee_refund' ELSE 'paystack_ledger_allocation' END,
    CASE WHEN v_fee>0 AND v_c.provider='stripe' THEN 'needs_attention' ELSE 'pending' END,v_requested-v_fee,v_fee,
    v_provider_ref,v_account,'rsvp:'||v_c.id||':'||p_mode||':'||p_client_idempotency_key) RETURNING * INTO v_refund;
  INSERT INTO public.source_refund_ledger_allocations(refund_id,allocation_type,amount_cents,currency,provider,state,idempotency_key)
  VALUES(v_refund.id,'buyer_refund',v_requested,v_refund.currency,v_refund.provider,'prepared','source-refund-allocation:buyer:'||v_refund.id);
  IF v_requested-v_fee>0 THEN INSERT INTO public.source_refund_ledger_allocations(refund_id,allocation_type,amount_cents,currency,provider,state,idempotency_key)
    VALUES(v_refund.id,'organizer_refund_liability',v_requested-v_fee,v_refund.currency,v_refund.provider,'prepared','source-refund-allocation:organizer:'||v_refund.id); END IF;
  IF v_fee>0 THEN INSERT INTO public.source_refund_ledger_allocations(refund_id,allocation_type,amount_cents,currency,provider,state,idempotency_key)
    VALUES(v_refund.id,'platform_application_fee_reversal',v_fee,v_refund.currency,v_refund.provider,'prepared','source-refund-allocation:platform:'||v_refund.id); END IF;
  INSERT INTO public.source_refund_events(refund_id,event_key,event_type,to_state,actor_type,safe_reason_code)
  VALUES(v_refund.id,'requested:'||v_refund.id,'requested','queued','brand_staff','rsvp_refund_requested');
  RETURN public.issue_1221_source_refund_summary(v_refund);
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_1977_agent_rsvp_payload(p_args jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=public,pg_temp AS $function$
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'title',p_args->'title','description',p_args->'description',
    'timezone',p_args->'timezone','format',p_args->'format',
    'location_text',p_args->'location_text','online_url',p_args->'online_url',
    'city',p_args->'city','partyTypes',p_args->'party_types',
    'vibeTags',p_args->'vibe_tags','musicGenres',p_args->'music_genres',
    'requestedVisibility',p_args->'requested_visibility',
    'rsvpCapacity',p_args->'capacity',
    'rsvpAllowPlusOnes',p_args->'allow_plus_ones',
    'rsvpPlusOnesMax',p_args->'plus_ones_max',
    'rsvpWaitlistEnabled',p_args->'waitlist_enabled',
    'rsvpApprovalMode',p_args->'approval_mode',
    'rsvpDiscoverable',p_args->'discoverable',
    'privateGuestList',p_args->'private_guest_list',
    'hideRemainingCount',p_args->'hide_remaining_count',
    'hideAddressUntilTicket',p_args->'hide_address_until_rsvp',
    'rsvpContributionEnabled',p_args->'contribution_enabled',
    'rsvpContributionSuggestedCents',p_args->'suggested_cents',
    'rsvpContributionMinCents',p_args->'minimum_cents',
    'when',CASE WHEN p_args ? 'date' OR p_args ? 'doors_open' OR p_args ? 'ends_at'
      THEN jsonb_strip_nulls(jsonb_build_object(
        'date',p_args->'date','doorsOpen',p_args->'doors_open',
        'endsAt',p_args->'ends_at','timezone',p_args->'timezone'))
      ELSE NULL END,
    'is_online',CASE WHEN p_args->>'format' IN('online','hybrid') THEN 'true'::jsonb
      WHEN p_args ? 'format' THEN 'false'::jsonb ELSE NULL END
  ))
$function$;

CREATE OR REPLACE FUNCTION public.ari_execute_rsvp_operation(
  p_operation_id uuid,p_tool_name text,p_args jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $function$
DECLARE v_begin jsonb; v_result jsonb; v_event_id uuid; v_payload jsonb;
BEGIN
  IF p_tool_name NOT IN(
    'create_rsvp','update_rsvp','publish_rsvp',
    'update_rsvp_contribution_settings','set_rsvp_guest_status',
    'refund_rsvp_contribution'
  ) THEN RAISE EXCEPTION 'unsupported_rsvp_operation';END IF;
  v_begin:=public.agent_operation_receipt_begin(p_operation_id,p_tool_name,p_args);
  IF COALESCE((v_begin->>'replay')::boolean,false) THEN RETURN v_begin->'result';END IF;
  v_event_id:=NULLIF(p_args->>'event_id','')::uuid;
  CASE p_tool_name
    WHEN 'create_rsvp' THEN
      v_payload:=public.issue_1977_agent_rsvp_payload(p_args);
      v_result:=public.business_create_rsvp_draft_graph(
        (p_args->>'brand_id')::uuid,v_payload,NULL);
    WHEN 'update_rsvp' THEN
      v_payload:=public.issue_1977_agent_rsvp_payload(p_args);
      v_result:=public.business_update_rsvp_graph(
        v_event_id,v_payload,NULLIF(p_args->>'reason',''),NULL);
    WHEN 'update_rsvp_contribution_settings' THEN
      v_payload:=public.issue_1977_agent_rsvp_payload(p_args);
      v_result:=public.business_update_rsvp_graph(
        v_event_id,v_payload,NULLIF(p_args->>'reason',''),NULL);
    WHEN 'publish_rsvp' THEN
      v_result:=public.business_publish_rsvp_graph(v_event_id,NULL);
    WHEN 'set_rsvp_guest_status' THEN
      v_result:=public.business_set_rsvp_guest_status(
        v_event_id,p_args->>'decision',p_args->>'scope',
        CASE WHEN p_args ? 'roster_keys' THEN
          ARRAY(SELECT jsonb_array_elements_text(p_args->'roster_keys'))
        ELSE NULL END,
        NULLIF(p_args->>'roster_watermark','')::bigint,NULL);
    WHEN 'refund_rsvp_contribution' THEN
      v_result:=public.biz_prepare_rsvp_contribution_refund(
        v_event_id,(p_args->>'contribution_id')::uuid,p_args->>'mode',
        p_args->>'reason',p_operation_id::text);
  END CASE;
  RETURN public.agent_operation_receipt_complete(
    p_operation_id,p_tool_name,p_args,v_result);
END;
$function$;

REVOKE ALL ON FUNCTION public.issue_1977_rsvp_graph(uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.issue_1977_current_rsvp_publish_payload(uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.business_create_rsvp_draft_graph(uuid,jsonb,uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.business_update_rsvp_graph(uuid,jsonb,text,uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.business_publish_rsvp_graph(uuid,uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.business_discard_rsvp_draft(uuid,uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.business_list_rsvp_roster(uuid,text,jsonb,integer) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.business_set_rsvp_guest_status(uuid,text,text,text[],bigint,uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.business_list_rsvp_contributions(uuid,text,jsonb,integer) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.host_set_rsvp_status(uuid,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.host_bulk_approve_rsvps(uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.biz_guest_roster_set_rsvp_approval(uuid,text,text,uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.biz_prepare_rsvp_contribution_refund(uuid,uuid,text,text,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.issue_1977_agent_rsvp_payload(jsonb) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.ari_execute_rsvp_operation(uuid,text,jsonb) FROM PUBLIC,anon;

GRANT EXECUTE ON FUNCTION public.issue_1977_rsvp_graph(uuid) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.business_create_rsvp_draft_graph(uuid,jsonb,uuid) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.business_update_rsvp_graph(uuid,jsonb,text,uuid) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.business_publish_rsvp_graph(uuid,uuid) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.business_discard_rsvp_draft(uuid,uuid) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.business_list_rsvp_roster(uuid,text,jsonb,integer) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.business_set_rsvp_guest_status(uuid,text,text,text[],bigint,uuid) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.business_list_rsvp_contributions(uuid,text,jsonb,integer) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.host_set_rsvp_status(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.host_bulk_approve_rsvps(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.biz_guest_roster_set_rsvp_approval(uuid,text,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.biz_prepare_rsvp_contribution_refund(uuid,uuid,text,text,text) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ari_execute_rsvp_operation(uuid,text,jsonb) TO authenticated,service_role;

-- #1977 certification requirements (120-row tip / #2592 digest be0add47…).
-- Do NOT replace ari_cert_begin_run / ari_cert_finalize_run in this PR — those
-- two functions already agree on be0add47… with capability_count 120. This
-- migration only:
--   1. retires the duplicate ari.guests.set_approval requirement in favour of
--      set_rsvp_guest_status's selected scope (ledger + tools match);
--   2. inserts ari.rsvp.update (write) so the requirement set stays at 120;
--   3. promotes ari.rsvp.contribution_settings from unsupported → write.
-- Net row count stays 120. Digests on begin/finalize are intentionally left
-- alone (see issue #1977 / COMMS-0160 / #2592).

DROP TRIGGER IF EXISTS ari_cert_capability_requirements_immutable_trigger
  ON public.ari_cert_capability_requirements;

DELETE FROM public.ari_cert_capability_requirements
WHERE capability_id = 'ari.guests.set_approval';

UPDATE public.ari_cert_capability_requirements
SET evidence_mode = 'write'
WHERE capability_id = 'ari.rsvp.contribution_settings'
  AND evidence_mode IN ('unsupported', 'read');

INSERT INTO public.ari_cert_capability_requirements (capability_id, evidence_mode)
VALUES ('ari.rsvp.update', 'write')
ON CONFLICT (capability_id) DO UPDATE
SET evidence_mode = EXCLUDED.evidence_mode;

CREATE TRIGGER ari_cert_capability_requirements_immutable_trigger
BEFORE UPDATE OR DELETE ON public.ari_cert_capability_requirements
FOR EACH ROW EXECUTE FUNCTION public.ari_cert_evidence_immutable();

DO $cert_requirements$
DECLARE v_count integer;
BEGIN
  SELECT count(*) INTO v_count FROM public.ari_cert_capability_requirements;
  IF v_count <> 120 THEN
    RAISE EXCEPTION 'issue_1977_expected_120_certification_requirements:%', v_count;
  END IF;
  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('ari.rsvp.update', 'write'),
      ('ari.rsvp.contribution_settings', 'write')
    ) expected(capability_id, evidence_mode)
    LEFT JOIN public.ari_cert_capability_requirements actual
      USING (capability_id, evidence_mode)
    WHERE actual.capability_id IS NULL
  ) OR EXISTS (
    SELECT 1 FROM public.ari_cert_capability_requirements
    WHERE capability_id = 'ari.guests.set_approval'
  ) THEN
    RAISE EXCEPTION 'issue_1977_certification_requirement_drift';
  END IF;
END;
$cert_requirements$;

COMMIT;
