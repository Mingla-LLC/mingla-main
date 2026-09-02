-- #3044 — make the #1977 RSVP draft graph reachable by `supabase db push`.
--
-- WHAT WAS BROKEN
-- `mingla-business/src/services/eventDrafts.ts` calls three RSVP draft RPCs
-- (business_create_rsvp_draft_graph / business_update_rsvp_graph /
-- business_discard_rsvp_draft). All three are authored in
-- `20270530001977_issue_1977_ari_rsvp_guest_contribution.sql`, and NONE of them
-- exists in production. This is a REACHABILITY defect, not an authoring one:
--
--   1. `20270530001977` was added to git on 2026-08-31 (110a80488, PR #2636),
--      by which time `20270531002694` … `20270614002986` were already applied.
--      Its version therefore sorts BELOW the remote head, so a plain
--      `supabase db push --linked` will not apply it.
--   2. `--include-all` is not a safe workaround here. It would also sweep in
--      the two unrelated unapplied #2060 migrations (`20270529002060`,
--      `20270610002060`) — exactly the ordered-chain hazard COMMS-0160 warns
--      about.
--   3. Even with `--include-all`, `20270530001977` would ABORT. Its tail guard
--      requires exactly 120 rows in `ari_cert_capability_requirements`;
--      production holds 132, and the migration's own DELETE(1)+INSERT(1) keeps
--      it at 132, so it raises
--      `issue_1977_expected_120_certification_requirements:132`.
--
-- WHAT THIS DOES
-- Re-publishes ONLY the objects the `eventDrafts.ts` RSVP draft lifecycle needs,
-- at a version a plain `db push` reaches. Every definition below is a VERBATIM
-- copy of the #1977 source, so the two migrations are order-independent: each is
-- CREATE OR REPLACE / CREATE TABLE IF NOT EXISTS, and applying them in either
-- order (or both) yields byte-identical objects.
--
-- DELIBERATELY NOT INCLUDED — these belong to #1977's own repair, not to #3044:
--   issue_1977_current_rsvp_publish_payload, business_publish_rsvp_graph,
--   business_list_rsvp_roster, business_set_rsvp_guest_status,
--   business_list_rsvp_contributions, biz_prepare_rsvp_contribution_refund,
--   issue_1977_agent_rsvp_payload, ari_execute_rsvp_operation, and the whole
--   ari_cert_capability_requirements block (the guard above).
--
-- MONOTONIC VERSION 20270615003044 — strictly greater than the max local
-- version (20270614002986), the production remote head (20270614002986), and
-- the max version across every sibling worktree (20270614002987).
--
-- Dependencies verified present in production by read-only probe on 2026-09-02:
--   biz_brand_effective_rank, biz_role_rank, pg_brand_can_collect,
--   biz_update_live_rsvp, business_discard_event_draft, extensions.digest
--   (pgcrypto), and all 14 `events` columns written below.

BEGIN;

-- ---------------------------------------------------------------------------
-- Idempotency receipts (verbatim from 20270530001977 L18-L33).
-- Required by all three RPCs' p_client_request_id replay path.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- Shared graph projection (verbatim from 20270530001977 L35-L60).
-- This is the multi-table return `eventFromRsvpGraph()` consumes: event + brand
-- + eventDates + tickets + clientRevision.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- #3044 root cause: this is the RPC eventDrafts.createServerDraft calls.
-- Verbatim from 20270530001977 L92-L194.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- Autosave owner (verbatim from 20270530001977 L196-L305). Without it a created
-- RSVP draft cannot be SAVED, and a cover video picked during creation never
-- persists (the #3040 path-1 consequence named in issue #3044).
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- Discard owner (verbatim from 20270530001977 L345-L378).
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- Privileges — verbatim from 20270530001977 L726/728/729/731 + L742/743/744/746,
-- which is the same `FROM PUBLIC, anon` → `TO authenticated, service_role` shape
-- business_create_event_draft uses (20270422001972 L833-L836). A freshly created
-- function carries a default EXECUTE grant to PUBLIC, which anon and
-- authenticated both inherit; the REVOKE strips it and the GRANT re-adds only
-- the two roles that need it. anon must never reach a draft writer.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.issue_1977_rsvp_graph(uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.business_create_rsvp_draft_graph(uuid,jsonb,uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.business_update_rsvp_graph(uuid,jsonb,text,uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.business_discard_rsvp_draft(uuid,uuid) FROM PUBLIC,anon;

GRANT EXECUTE ON FUNCTION public.issue_1977_rsvp_graph(uuid) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.business_create_rsvp_draft_graph(uuid,jsonb,uuid) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.business_update_rsvp_graph(uuid,jsonb,text,uuid) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.business_discard_rsvp_draft(uuid,uuid) TO authenticated,service_role;

-- ---------------------------------------------------------------------------
-- #3044 reachability marker. This COMMENT exists ONLY on the db-push-reachable
-- publish; 20270530001977 sets no function comments. The #3044 contract test
-- asserts it, so deleting this migration turns that test red even though the
-- shadowed #1977 definition would still satisfy a behaviour-only assertion in a
-- CI database built from every migration file.
-- ---------------------------------------------------------------------------
COMMENT ON FUNCTION public.business_create_rsvp_draft_graph(uuid,jsonb,uuid) IS
  '#3044 db-push-reachable publish of the #1977 RSVP draft graph. Source definition 20270530001977 is version-shadowed by later-applied migrations and cannot be reached by `supabase db push`.';
COMMENT ON FUNCTION public.business_update_rsvp_graph(uuid,jsonb,text,uuid) IS
  '#3044 db-push-reachable publish of the #1977 RSVP draft graph. Source definition 20270530001977 is version-shadowed by later-applied migrations and cannot be reached by `supabase db push`.';
COMMENT ON FUNCTION public.business_discard_rsvp_draft(uuid,uuid) IS
  '#3044 db-push-reachable publish of the #1977 RSVP draft graph. Source definition 20270530001977 is version-shadowed by later-applied migrations and cannot be reached by `supabase db push`.';

COMMIT;
