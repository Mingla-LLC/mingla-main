-- ---------------------------------------------------------------------------
-- Issue #3065 — the two draft-autosave RPCs disagreed about what
-- `clientRevision` MEANS, so every RSVP draft autosave in production failed.
--
-- `business_update_event_draft` (event drafts) required the client to send the
-- NEW revision:      p_client_revision <> v_stored_revision + 1  -> reject.
-- `business_update_rsvp_graph` (RSVP drafts) required the client to send the
-- revision the SERVER already held:
--                    v_expected_revision <> v_current_revision   -> reject.
--
-- The client only has one convention. `RsvpCreatorWizard.handleUpdate` bumps
-- `clientRevisionRef` BEFORE queueing the save and
-- `eventDrafts.autosaveServerDraft` sends that bumped value as
-- `__expectedClientRevision`, so the RSVP RPC saw stored+1 and raised
-- `rsvp_revision_conflict` on EVERY call. Proven on production 2026-09-02:
-- `rsvp_domain_operation_receipts` held zero rows with operation='update' for
-- all time, and postgres_logs carried 3,400-4,900 `rsvp_revision_conflict` per
-- minute from a single wedged device (instrumented capture:
-- `expected=40 current=39`, then the client's counter ran away to 98 while the
-- server's stayed frozen, because no save ever landed).
--
-- Neither function had a recovery path: nothing on the client resyncs its
-- counter from the server after a conflict, and the counter is persisted, so a
-- single divergence wedged that draft forever on every device. That trap is
-- NOT RSVP-specific — `business_update_event_draft`'s strict `= stored + 1`
-- carries it too and only escapes it because its saves normally succeed.
--
-- THE ONE RULE, now shared by both functions: reject a writer that is BEHIND
-- the stored revision, and only that.
--   * revision <  stored -> stale writer, reject.
--   * revision =  stored -> replay of a save whose response was lost, accept
--                           (idempotent — same content, same revision).
--   * revision >  stored -> normal forward save, accept and store the client's
--                           value, which also self-heals a runaway counter.
--
-- Idempotent: both are CREATE OR REPLACE of the deployed bodies with only the
-- guard (and the RSVP stored-revision expression) changed.
-- ---------------------------------------------------------------------------

BEGIN;

CREATE OR REPLACE FUNCTION public.business_update_rsvp_graph(p_event_id uuid, p_payload jsonb, p_reason text DEFAULT NULL::text, p_client_request_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
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
    IF v_expected_revision IS NOT NULL AND v_expected_revision<v_current_revision THEN
      RAISE EXCEPTION 'rsvp_revision_conflict' USING ERRCODE='40001';
    END IF;
    v_patch:=v_patch-'__expectedClientRevision';
    v_merged:=jsonb_set(v_draft||v_patch,'{clientRevision}',to_jsonb(COALESCE(v_expected_revision,v_current_revision+1)),true);
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

CREATE OR REPLACE FUNCTION public.business_update_event_draft(p_event_id uuid, p_payload jsonb, p_client_revision integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_event public.events%ROWTYPE;
  v_stored_revision integer;
  v_geo point;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT * INTO v_event FROM public.events WHERE id=p_event_id FOR UPDATE;
  IF NOT FOUND OR v_event.deleted_at IS NOT NULL OR v_event.event_type <> 'event' THEN
    RAISE EXCEPTION 'event_draft_not_found';
  END IF;
  IF v_event.status <> 'draft' THEN RAISE EXCEPTION 'event_draft_not_editable'; END IF;
  IF public.biz_brand_effective_rank(v_event.brand_id,v_uid) < public.biz_role_rank('event_manager') THEN
    RAISE EXCEPTION 'insufficient_event_permission';
  END IF;
  v_stored_revision := COALESCE((v_event.theme#>>'{business_draft,clientRevision}')::integer,0);
  IF p_client_revision IS NULL OR p_client_revision < v_stored_revision THEN
    RAISE EXCEPTION 'stale_client_revision';
  END IF;
  PERFORM public.business_assert_event_visibility(
    p_payload#>'{theme,business_draft,requestedVisibility}'
  );
  IF NULLIF(p_payload->>'location_geo','') IS NOT NULL THEN v_geo := (p_payload->>'location_geo')::point; END IF;
  PERFORM public.assert_cover_media_triplet(NULLIF(p_payload->>'cover_media_url',''),
    NULLIF(p_payload->>'cover_media_type',''),NULLIF(p_payload->>'cover_media_poster_url',''));

  UPDATE public.events SET
    title=COALESCE(NULLIF(btrim(p_payload->>'title'),''),'Untitled draft'),
    description=NULLIF(p_payload->>'description',''), location_text=NULLIF(p_payload->>'location_text',''),
    online_url=NULLIF(p_payload->>'online_url',''), cover_media_url=NULLIF(p_payload->>'cover_media_url',''),
    cover_media_poster_url=NULLIF(p_payload->>'cover_media_poster_url',''), cover_media_type=NULLIF(p_payload->>'cover_media_type',''),
    cover_media_provider=NULLIF(p_payload->>'cover_media_provider',''), cover_media_source_url=NULLIF(p_payload->>'cover_media_source_url',''),
    cover_media_credit=NULLIF(p_payload->>'cover_media_credit',''), cover_media_credit_url=NULLIF(p_payload->>'cover_media_credit_url',''),
    cover_media_alt=NULLIF(p_payload->>'cover_media_alt',''), cover_media_gallery=COALESCE(p_payload->'cover_media_gallery','[]'::jsonb),
    currency=NULLIF(p_payload->>'currency','')::character(3), is_online=COALESCE((p_payload->>'is_online')::boolean,false),
    is_recurring=COALESCE((p_payload->>'is_recurring')::boolean,false), is_multi_date=COALESCE((p_payload->>'is_multi_date')::boolean,false),
    recurrence_rules=p_payload->'recurrence_rules',
    theme=jsonb_set(COALESCE(p_payload->'theme','{}'::jsonb),
      '{business_draft,clientRevision}',to_jsonb(p_client_revision),true),
    visibility='draft', status='draft', timezone=COALESCE(NULLIF(p_payload->>'timezone',''),'UTC'),
    party_types=COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_payload->'party_types','[]'::jsonb))),ARRAY[]::text[]),
    vibe_tags=COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_payload->'vibe_tags','[]'::jsonb))),ARRAY[]::text[]),
    music_genres=COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_payload->'music_genres','[]'::jsonb))),ARRAY[]::text[]),
    city=NULLIF(p_payload->>'city',''), location_geo=v_geo,
    pass_tax=(p_payload->>'pass_tax')::boolean, pass_mingla_fee=(p_payload->>'pass_mingla_fee')::boolean,
    pass_service_fee=(p_payload->>'pass_service_fee')::boolean,
    theme_color_override=NULLIF(p_payload->>'theme_color_override',''), theme_font_override=NULLIF(p_payload->>'theme_font_override',''),
    theme_animation_override=NULLIF(p_payload->>'theme_animation_override',''), updated_at=now()
  WHERE id=p_event_id RETURNING * INTO v_event;
  RETURN jsonb_build_object('event',to_jsonb(v_event),'client_revision',
    p_client_revision);
END;
$function$;

-- Fails-on-revert anchor for
-- `supabase/migrations/__tests__/issue_3065_draft_revision_contract.test.sql`.
-- The CI database is built from EVERY migration file, so a behaviour-only
-- assertion would stay green against the pre-#3065 definitions shipped by
-- 20270530001977 / 20270615003044. The marker is set only by THIS migration.
-- The #3044 reachability substring is preserved deliberately: its own marker
-- test greps this same comment.
COMMENT ON FUNCTION public.business_update_rsvp_graph(uuid,jsonb,text,uuid) IS
  '#3044 db-push-reachable publish of the #1977 RSVP draft graph. Source definition 20270530001977 is version-shadowed by later-applied migrations and cannot be reached by `supabase db push`. #3065 revision-contract: rejects only a writer BEHIND the stored clientRevision.';

COMMENT ON FUNCTION public.business_update_event_draft(uuid,jsonb,integer) IS
  '#3065 revision-contract: rejects only a writer BEHIND the stored clientRevision.';

COMMIT;
