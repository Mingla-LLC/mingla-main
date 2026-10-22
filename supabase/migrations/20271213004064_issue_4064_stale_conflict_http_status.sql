-- Issue #4064 — a stale Admin Work-card save or RSVP-draft save must be one
-- ordinary HTTP 409 response, never a retryable transaction failure.
--
-- PostgREST 14 automatically retries SQLSTATE 40001. These two functions used
-- that code for application-level optimistic-concurrency conflicts, so one
-- stale browser save could occupy a database worker forever. The messages are
-- the clients' stable contract; only their SQLSTATE changes to PostgREST's
-- custom HTTP-conflict code PT409.
--
-- Scope is deliberately limited to the two production sources proven in
-- #4064. Other historical 40001 raises are not changed by this migration.
--
BEGIN;

SET LOCAL lock_timeout = '5s';

-- Verbatim from 20271116003980_issue_3980_wave1_work_board.sql, except for
-- 40001 -> PT409 on the stale_write raise.
CREATE OR REPLACE FUNCTION public.ops_card_lock(p_id uuid, p_expected_revision bigint)
RETURNS public.ops_work_cards
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE c public.ops_work_cards;
BEGIN
  SELECT * INTO c FROM public.ops_work_cards w WHERE w.id = p_id AND w.archived_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found: That card is no longer here.' USING ERRCODE = 'P0002'; END IF;
  IF p_expected_revision IS NOT NULL AND c.revision <> p_expected_revision THEN
    RAISE EXCEPTION 'stale_write: This card changed since you opened it. Reload it, then try again.' USING ERRCODE = 'PT409';
  END IF;
  RETURN c;
END;
$$;

-- Verbatim from 20270824003645_issue_3645_rsvp_draft_saves_chip_ins.sql,
-- except for 40001 -> PT409 on the rsvp_revision_conflict raise.
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
  v_keep_cover boolean;  -- applied-cover guard
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
      RAISE EXCEPTION 'rsvp_revision_conflict' USING ERRCODE='PT409';
    END IF;
    -- Applied-cover guard — a cover the server put on this row (a draft_auto
    -- cover-video job finishing after the host closed the sheet) must survive
    -- a save from a client that has not seen it. With `__coverBase` (the
    -- cover the client last received) it is a three-way merge: keep the
    -- stored cover when the client's cover is still its base and the server's
    -- has moved since. A client without the key falls back to: the stored
    -- cover is an applied draft_auto job's video and no save has landed since
    -- that job applied.
    v_keep_cover := (CASE WHEN p_payload ? '__coverBase' THEN
        NULLIF(p_payload->>'cover_media_url','') IS NOT DISTINCT FROM NULLIF(p_payload->>'__coverBase','')
        AND v.cover_media_url IS DISTINCT FROM NULLIF(p_payload->>'__coverBase','')
      ELSE
        v.cover_media_url IS NOT NULL
        AND NULLIF(p_payload->>'cover_media_url','') IS DISTINCT FROM v.cover_media_url
        AND EXISTS (SELECT 1 FROM public.event_cover_video_jobs j
          WHERE j.event_id = p_event_id AND j.target_kind = 'event'
            AND j.apply_mode = 'draft_auto' AND j.status = 'applied'
            AND j.processed_url = v.cover_media_url
            AND j.applied_at >= v.updated_at)
      END);
    v_patch:=v_patch-'__expectedClientRevision'-'__coverBase';
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
    v_theme:=jsonb_set(COALESCE(v.theme,'{}'::jsonb),'{business_draft}',v_merged,true);
    UPDATE public.events SET
      title=COALESCE(NULLIF(btrim(p_payload->>'title'),''),v.title),
      description=CASE WHEN p_payload?'description' THEN NULLIF(p_payload->>'description','') ELSE v.description END,
      location_text=CASE WHEN p_payload?'location_text' THEN NULLIF(p_payload->>'location_text','') ELSE v.location_text END,
      online_url=CASE WHEN p_payload?'online_url' THEN NULLIF(p_payload->>'online_url','') ELSE v.online_url END,
      cover_media_url=CASE WHEN v_keep_cover THEN v.cover_media_url WHEN p_payload?'cover_media_url' THEN NULLIF(p_payload->>'cover_media_url','') ELSE v.cover_media_url END,
      cover_media_poster_url=CASE WHEN v_keep_cover THEN v.cover_media_poster_url WHEN p_payload?'cover_media_poster_url' THEN NULLIF(p_payload->>'cover_media_poster_url','') ELSE v.cover_media_poster_url END,
      cover_media_type=CASE WHEN v_keep_cover THEN v.cover_media_type WHEN p_payload?'cover_media_type' THEN NULLIF(p_payload->>'cover_media_type','') ELSE v.cover_media_type END,
      cover_media_provider=CASE WHEN v_keep_cover THEN v.cover_media_provider WHEN p_payload?'cover_media_provider' THEN NULLIF(p_payload->>'cover_media_provider','') ELSE v.cover_media_provider END,
      cover_media_source_url=CASE WHEN v_keep_cover THEN v.cover_media_source_url WHEN p_payload?'cover_media_source_url' THEN NULLIF(p_payload->>'cover_media_source_url','') ELSE v.cover_media_source_url END,
      cover_media_credit=CASE WHEN v_keep_cover THEN v.cover_media_credit WHEN p_payload?'cover_media_credit' THEN NULLIF(p_payload->>'cover_media_credit','') ELSE v.cover_media_credit END,
      cover_media_credit_url=CASE WHEN v_keep_cover THEN v.cover_media_credit_url WHEN p_payload?'cover_media_credit_url' THEN NULLIF(p_payload->>'cover_media_credit_url','') ELSE v.cover_media_credit_url END,
      cover_media_alt=CASE WHEN v_keep_cover THEN v.cover_media_alt WHEN p_payload?'cover_media_alt' THEN NULLIF(p_payload->>'cover_media_alt','') ELSE v.cover_media_alt END,
      cover_media_gallery=CASE WHEN p_payload?'cover_media_gallery' THEN p_payload->'cover_media_gallery' ELSE v.cover_media_gallery END,
      timezone=COALESCE(NULLIF(p_payload->>'timezone',''),v.timezone),
      is_online=CASE WHEN v_patch?'format' THEN (v_patch->>'format') IN ('online','hybrid') ELSE v.is_online END,
      theme=v_theme,
      party_types=CASE WHEN v_patch?'partyTypes' THEN ARRAY(SELECT jsonb_array_elements_text(v_patch->'partyTypes')) ELSE v.party_types END,
      vibe_tags=CASE WHEN v_patch?'vibeTags' THEN ARRAY(SELECT jsonb_array_elements_text(v_patch->'vibeTags')) ELSE v.vibe_tags END,
      music_genres=CASE WHEN v_patch?'musicGenres' THEN ARRAY(SELECT jsonb_array_elements_text(v_patch->'musicGenres')) ELSE v.music_genres END,
      city=CASE WHEN v_patch?'city' THEN NULLIF(v_patch->>'city','') ELSE v.city END,
      -- Where-step pin: written when the save carries it (the wizard always does;
      -- an explicit null clears it with the address). Absent key keeps the row.
      location_geo=CASE WHEN p_payload?'location_geo' THEN NULLIF(p_payload->>'location_geo','')::point ELSE v.location_geo END,
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
      city=CASE WHEN p_payload?'city' THEN NULLIF(p_payload->>'city','') ELSE city END,
      -- Where-step pin on a published RSVP: a re-picked address sends its
      -- coordinate and precision together; an unrelated edit sends neither.
      location_geo=CASE WHEN p_payload?'location_geo' THEN NULLIF(p_payload->>'location_geo','')::point ELSE location_geo END,
      coordinate_precision=CASE WHEN p_payload?'location_geo' THEN
        CASE WHEN NULLIF(p_payload->>'location_geo','') IS NOT NULL
              AND p_payload->>'coordinate_precision' IN ('exact','approximate')
             THEN p_payload->>'coordinate_precision' END
        ELSE coordinate_precision END,
      cover_media_gallery=CASE WHEN p_payload?'cover_media_gallery' THEN p_payload->'cover_media_gallery' ELSE cover_media_gallery END
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

DO $verify$
DECLARE
  v_ops text;
  v_rsvp text;
BEGIN
  SELECT prosrc INTO v_ops
    FROM pg_catalog.pg_proc
   WHERE oid = 'public.ops_card_lock(uuid, bigint)'::pg_catalog.regprocedure;
  SELECT prosrc INTO v_rsvp
    FROM pg_catalog.pg_proc
   WHERE oid = 'public.business_update_rsvp_graph(uuid, jsonb, text, uuid)'::pg_catalog.regprocedure;

  IF v_ops IS NULL
     OR pg_catalog.strpos(v_ops, 'stale_write: This card changed since you opened it. Reload it, then try again.') = 0
     OR pg_catalog.strpos(v_ops, 'PT409') = 0
     OR pg_catalog.strpos(v_ops, '40001') > 0 THEN
    RAISE EXCEPTION 'issue_4064_verify: ops_card_lock is not the exact PT409 stale-write contract';
  END IF;
  IF v_rsvp IS NULL
     OR pg_catalog.strpos(v_rsvp, 'rsvp_revision_conflict') = 0
     OR pg_catalog.strpos(v_rsvp, 'PT409') = 0
     OR pg_catalog.strpos(v_rsvp, '40001') > 0 THEN
    RAISE EXCEPTION 'issue_4064_verify: business_update_rsvp_graph is not the exact PT409 revision-conflict contract';
  END IF;
END
$verify$;

COMMIT;
