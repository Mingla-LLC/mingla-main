-- Issue #1973: canonical experience graph/lifecycle owner shared by Ari and Business.
-- This consumes the #1972 operation-receipt primitive without duplicating it.
BEGIN;

-- Draft experiences are allowed to preserve an unknown timezone. The existing
-- default remains in place for every legacy writer; #1973 explicitly writes
-- NULL only for its own draft create path. Published rows still require a zone.
ALTER TABLE public.events ALTER COLUMN timezone DROP NOT NULL;
ALTER TABLE public.events
  ADD CONSTRAINT issue_1973_published_experience_timezone_required
  CHECK (
    event_type <> 'experience'
    OR status = 'draft'
    OR NULLIF(btrim(timezone), '') IS NOT NULL
  );

CREATE OR REPLACE FUNCTION public.issue_1973_create_snap_proposals(
  p_brand_id uuid,
  p_tool_args jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_count integer;
  v_rows jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF jsonb_typeof(p_tool_args) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'snap_proposals_invalid';
  END IF;
  v_count := jsonb_array_length(p_tool_args);
  IF v_count < 1 OR v_count > 50 THEN
    RAISE EXCEPTION 'snap_proposal_count_invalid';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.brands b
    WHERE b.id = p_brand_id AND b.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'brand_not_found';
  END IF;
  IF public.biz_brand_effective_rank(p_brand_id, v_uid)
     < public.biz_role_rank('event_manager') THEN
    RAISE EXCEPTION 'insufficient_event_permission';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_tool_args) proposal(args)
    WHERE jsonb_typeof(args) IS DISTINCT FROM 'object'
       OR args->>'brand_id' IS DISTINCT FROM p_brand_id::text
       OR NULLIF(btrim(args->>'title'), '') IS NULL
       OR args ?| ARRAY['user_id','conversation_id','source','status','expires_at']
  ) THEN
    RAISE EXCEPTION 'snap_proposals_invalid';
  END IF;

  WITH inserted AS (
    INSERT INTO public.agent_pending_actions (
      user_id,
      conversation_id,
      source,
      related_brand_id,
      tool_name,
      tool_args,
      status,
      server_proposed_at,
      expires_at
    )
    SELECT
      v_uid,
      NULL,
      'hub_experience',
      p_brand_id,
      'create_experience',
      proposal.args,
      'pending',
      now(),
      now() + interval '7 days'
    FROM jsonb_array_elements(p_tool_args) WITH ORDINALITY proposal(args, ordinal)
    ORDER BY proposal.ordinal
    RETURNING id, tool_name, tool_args, expires_at
  )
  SELECT jsonb_agg(jsonb_build_object(
    'id', id,
    'tool_name', tool_name,
    'tool_args', tool_args,
    'expires_at', expires_at
  )) INTO v_rows
  FROM inserted;

  IF jsonb_array_length(COALESCE(v_rows, '[]'::jsonb)) <> v_count THEN
    RAISE EXCEPTION 'snap_proposal_insert_incomplete';
  END IF;
  RETURN v_rows;
END;
$$;

CREATE OR REPLACE FUNCTION public.issue_1973_read_experience_graph(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_event public.events%ROWTYPE;
  v_brand jsonb;
  v_stops jsonb;
  v_ticket jsonb;
  v_dates jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT * INTO v_event FROM public.events WHERE id=p_event_id;
  IF NOT FOUND OR v_event.deleted_at IS NOT NULL OR v_event.event_type <> 'experience' THEN
    RAISE EXCEPTION 'experience_not_found';
  END IF;
  IF public.biz_brand_effective_rank(v_event.brand_id,v_uid) < public.biz_role_rank('event_manager') THEN
    RAISE EXCEPTION 'insufficient_event_permission';
  END IF;

  SELECT jsonb_build_object('id',b.id,'name',b.name,'slug',b.slug)
    INTO v_brand FROM public.brands b WHERE b.id=v_event.brand_id AND b.deleted_at IS NULL;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id',s.id,'stop_order',s.stop_order,'place_id',s.place_id,
      'place_name',s.place_name,'address',s.address,'city',s.city,'region',s.region,
      'country_code',s.country_code,'lat',s.lat,'lng',s.lng,
      'coordinate_precision',s.coordinate_precision,'image_urls',s.image_urls,
      'start_time',s.start_time,'price_cents',s.price_cents,'ai_description',s.ai_description
    ) ORDER BY s.stop_order),'[]'::jsonb)
    INTO v_stops FROM public.experience_stops s WHERE s.event_id=p_event_id;
  SELECT to_jsonb(t) - 'password_hash'
    INTO v_ticket FROM public.ticket_types t
   WHERE t.event_id=p_event_id AND t.deleted_at IS NULL
   ORDER BY t.display_order,t.created_at LIMIT 1;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id',d.id,'start_at',d.start_at,'end_at',d.end_at,'timezone',d.timezone,'is_master',d.is_master
    ) ORDER BY d.start_at),'[]'::jsonb)
    INTO v_dates FROM public.event_dates d WHERE d.event_id=p_event_id;

  RETURN jsonb_build_object(
    'event',jsonb_build_object(
      'id',v_event.id,'brand_id',v_event.brand_id,'event_type',v_event.event_type,
      'title',v_event.title,'description',v_event.description,'slug',v_event.slug,
      'status',v_event.status,'visibility',v_event.visibility,'published_at',v_event.published_at,
      'deleted_at',v_event.deleted_at,'currency',v_event.currency,'timezone',v_event.timezone,
      'location_mode',v_event.location_mode,'pricing_mode',v_event.pricing_mode,
      'whole_price_cents',v_event.whole_price_cents,'experience_intent',v_event.experience_intent,
      'experience_intents',v_event.experience_intents,'is_recurring',v_event.is_recurring,
      'is_multi_date',v_event.is_multi_date,'recurrence_rules',v_event.recurrence_rules,
      'cover_media_url',v_event.cover_media_url,'cover_media_type',v_event.cover_media_type,
      'cover_media_poster_url',v_event.cover_media_poster_url,
      'theme',v_event.theme,'revision',v_event.updated_at
    ),
    'brand',v_brand,'stops',v_stops,'ticket',v_ticket,'dates',v_dates
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.issue_1973_current_experience_payload(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_event public.events%ROWTYPE;
  v_stops jsonb;
  v_ticket public.ticket_types%ROWTYPE;
  v_when jsonb;
BEGIN
  SELECT * INTO v_event FROM public.events WHERE id=p_event_id AND deleted_at IS NULL;
  IF NOT FOUND OR v_event.event_type <> 'experience' THEN RAISE EXCEPTION 'experience_not_found'; END IF;
  IF public.biz_brand_effective_rank(v_event.brand_id,auth.uid()) < public.biz_role_rank('event_manager') THEN
    RAISE EXCEPTION 'insufficient_event_permission';
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'stop_order',s.stop_order,'place_id',s.place_id,'place_name',s.place_name,
      'address',s.address,'city',s.city,'region',s.region,'country_code',s.country_code,
      'lat',s.lat,'lng',s.lng,'coordinate_precision',s.coordinate_precision,
      'image_urls',s.image_urls,'start_time',s.start_time,'price_cents',s.price_cents,
      'ai_description',s.ai_description
    ) ORDER BY s.stop_order),'[]'::jsonb)
    INTO v_stops FROM public.experience_stops s WHERE s.event_id=p_event_id;
  SELECT * INTO v_ticket FROM public.ticket_types
   WHERE event_id=p_event_id AND deleted_at IS NULL ORDER BY display_order,created_at LIMIT 1;
  v_when := COALESCE(v_event.theme->'experience_meta'->'when_draft','{}'::jsonb);
  RETURN jsonb_build_object(
    'title',v_event.title,'description',v_event.description,
    'experience_intents',COALESCE(to_jsonb(v_event.experience_intents),'[]'::jsonb),
    'currency',v_event.currency,'location_mode',v_event.location_mode,
    'pricing_mode',v_event.pricing_mode,'whole_price_cents',v_event.whole_price_cents,
    'is_free',COALESCE(v_ticket.is_free,v_event.whole_price_cents=0),
    'capacity',CASE WHEN v_ticket.is_unlimited THEN NULL ELSE v_ticket.quantity_total END,
    'pass_tax',v_event.pass_tax,'pass_mingla_fee',v_event.pass_mingla_fee,
    'pass_service_fee',v_event.pass_service_fee,'stops',v_stops,
    'whenMode',COALESCE(v_when->>'whenMode',CASE WHEN v_event.is_recurring THEN 'recurring' WHEN v_event.is_multi_date THEN 'multi_date' ELSE 'single' END),
    'when',v_when->'when','multiDates',v_when->'multiDates',
    'recurrence_rules',COALESCE(v_when->'recurrence_rules',v_event.recurrence_rules),
    'timezone',COALESCE(v_when->>'timezone',v_event.timezone),
    'cover',jsonb_build_object(
      'coverMediaUrl',v_event.cover_media_url,'coverMediaPosterUrl',v_event.cover_media_poster_url,
      'coverMediaType',v_event.cover_media_type,'coverMediaProvider',v_event.cover_media_provider,
      'coverMediaSourceUrl',v_event.cover_media_source_url,'coverMediaCredit',v_event.cover_media_credit,
      'coverMediaCreditUrl',v_event.cover_media_credit_url,'coverMediaAlt',v_event.cover_media_alt,
      'coverGallery',COALESCE(v_event.cover_media_gallery,'[]'::jsonb)
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.issue_1973_agent_experience_payload(
  p_args jsonb
) RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_raw_tags jsonb := CASE
    WHEN jsonb_typeof(p_args->'experience_intents')='array'
      THEN p_args->'experience_intents'
    ELSE COALESCE(p_args->'intent_tags','[]'::jsonb)
  END;
  v_tag jsonb;
  v_norm text;
  v_mapped text;
  v_matched text[] := '{}'::text[];
  v_intents jsonb;
  v_stop jsonb;
  v_stops jsonb := '[]'::jsonb;
  v_stop_count integer := 0;
  v_stop_total integer := 0;
  v_price integer;
  v_suggested_mid integer;
BEGIN
  IF jsonb_typeof(v_raw_tags)='array' THEN
    FOR v_tag IN SELECT value FROM jsonb_array_elements(v_raw_tags) LOOP
      IF jsonb_typeof(v_tag)<>'string' THEN CONTINUE; END IF;
      v_norm := regexp_replace(lower(btrim(v_tag#>>'{}')), '\s+', '_', 'g');
      v_mapped := CASE
        WHEN replace(v_norm,'_','-') IN(
          'adventurous','first-date','romantic','group-fun'
        ) THEN replace(v_norm,'_','-')
        WHEN v_norm IN('group_activity','friends_chill','family_friendly')
          THEN 'group-fun'
        WHEN v_norm='date_night_active' THEN 'romantic'
        WHEN v_norm='solo_exploration' THEN 'adventurous'
        WHEN v_norm ~ '(romantic|date_night|date-night|couple|intimate|candlelit|tasting_menu|wine_pairing|anniversary)'
          THEN 'romantic'
        WHEN v_norm ~ '(first_date|first-date|casual_date|meet|icebreaker)'
          THEN 'first-date'
        WHEN v_norm ~ '(adventur|explore|thrill|outdoor|active|solo|discover)'
          THEN 'adventurous'
        WHEN v_norm ~ '(group|friends|family|party|social|shareable|bottomless|brunch|happy_hour|crew|team)'
          THEN 'group-fun'
        ELSE NULL
      END;
      IF v_mapped IS NOT NULL AND NOT (v_mapped=ANY(v_matched)) THEN
        v_matched := array_append(v_matched,v_mapped);
      END IF;
    END LOOP;
  END IF;
  SELECT COALESCE(jsonb_agg(value),'[]'::jsonb) INTO v_intents
  FROM unnest(ARRAY['adventurous','first-date','romantic','group-fun']) value
  WHERE value=ANY(v_matched);

  IF jsonb_typeof(p_args->'stops')='array' THEN
    FOR v_stop IN SELECT value FROM jsonb_array_elements(p_args->'stops') LOOP
      IF v_stop_count>=5 THEN RAISE EXCEPTION 'experience_stop_limit_exceeded'; END IF;
      v_price := CASE WHEN jsonb_typeof(v_stop->'price_cents')='number'
        THEN greatest(0,round((v_stop->>'price_cents')::numeric)::integer)
        ELSE 0 END;
      v_stops := v_stops || jsonb_build_array(jsonb_build_object(
        'stop_order',v_stop_count,
        'place_name',COALESCE(NULLIF(v_stop->>'place_name',''),v_stop->>'name'),
        'ai_description',COALESCE(v_stop->>'ai_description',v_stop->>'description'),
        'address',COALESCE(v_stop->>'address',''),
        'city',v_stop->'city',
        'region',v_stop->'region',
        'country_code',v_stop->'country_code',
        'place_id',v_stop->'place_id',
        'lat',v_stop->'lat',
        'lng',v_stop->'lng',
        'coordinate_precision',v_stop->'coordinate_precision',
        'start_time',v_stop->'start_time',
        'price_cents',v_price,
        'image_urls',CASE WHEN jsonb_typeof(v_stop->'image_urls')='array'
          THEN v_stop->'image_urls' ELSE '[]'::jsonb END
      ));
      v_stop_count := v_stop_count+1;
      v_stop_total := v_stop_total+v_price;
    END LOOP;
  END IF;

  IF jsonb_typeof(p_args->'suggested_price_min_cents')='number'
     AND jsonb_typeof(p_args->'suggested_price_max_cents')='number' THEN
    v_suggested_mid := round(
      ((p_args->>'suggested_price_min_cents')::numeric+
       (p_args->>'suggested_price_max_cents')::numeric)/2
    )::integer;
  END IF;

  RETURN jsonb_build_object(
    'title',btrim(p_args->>'title'),
    'description',btrim(p_args->>'narrative'),
    'experience_intents',v_intents,
    'stops',v_stops,
    'location_mode',COALESCE(
      NULLIF(p_args->>'location_mode',''),
      CASE WHEN v_stop_count>0 THEN 'per_stop' ELSE 'single' END
    ),
    'pricing_mode',COALESCE(
      NULLIF(p_args->>'pricing_mode',''),
      CASE WHEN v_stop_count>0 THEN 'per_stop' ELSE 'whole' END
    ),
    'whole_price_cents',CASE
      WHEN jsonb_typeof(p_args->'whole_price_cents')='number'
        THEN (p_args->>'whole_price_cents')::integer
      ELSE v_suggested_mid
    END,
    'is_free',CASE
      WHEN jsonb_typeof(p_args->'is_free')='boolean'
        THEN (p_args->>'is_free')::boolean
      WHEN v_stop_count>0 THEN v_stop_total=0
      ELSE COALESCE(v_suggested_mid,0)=0
    END,
    'capacity',COALESCE(p_args->'capacity',p_args->'capacity_max','null'::jsonb),
    'currency',COALESCE(p_args->'currency','null'::jsonb),
    'timezone',COALESCE(p_args->'timezone','null'::jsonb),
    'whenMode',COALESCE(NULLIF(p_args->>'whenMode',''),'single'),
    'when',COALESCE(p_args->'when','null'::jsonb),
    'multiDates',COALESCE(p_args->'multiDates','null'::jsonb),
    'recurrence_rules',COALESCE(p_args->'recurrence_rules','null'::jsonb),
    'cover',COALESCE(p_args->'cover','{}'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.business_create_experience_graph(p_brand_id uuid,p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_created jsonb; v_event_id uuid; v_timezone text;
BEGIN
  IF p_payload ?| ARRAY['status','visibility','published_at','deleted_at','event_type','brand_id'] THEN
    RAISE EXCEPTION 'experience_lifecycle_fields_forbidden';
  END IF;
  IF p_payload->'cover' IS NOT NULL AND p_payload->'cover' <> '{}'::jsonb THEN
    RAISE EXCEPTION 'experience_media_reference_required';
  END IF;
  v_timezone := NULLIF(btrim(p_payload->>'timezone'), '');
  IF v_timezone IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM pg_timezone_names WHERE name = v_timezone
  ) THEN
    RAISE EXCEPTION 'experience_timezone_invalid';
  END IF;
  v_created := public.biz_create_experience(p_brand_id,p_payload,false);
  v_event_id := (v_created->'event'->>'id')::uuid;
  IF v_event_id IS NULL THEN RAISE EXCEPTION 'experience_create_readback_failed'; END IF;
  IF v_timezone IS NULL THEN
    UPDATE public.events
    SET timezone = NULL,
        theme = theme #- '{experience_meta,when_draft,timezone}',
        updated_at = now()
    WHERE id = v_event_id AND status = 'draft' AND event_type = 'experience';
  END IF;
  RETURN public.issue_1973_read_experience_graph(v_event_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.business_apply_experience_action(
  p_event_id uuid,p_patch jsonb,p_action text,
  p_expected_revision timestamptz DEFAULT NULL,p_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_event public.events%ROWTYPE;
  v_payload jsonb;
  v_result jsonb;
  v_stop jsonb;
  v_url text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF p_action NOT IN ('update','manage_stops','publish') THEN RAISE EXCEPTION 'experience_action_invalid'; END IF;
  IF COALESCE(jsonb_typeof(p_patch),'object') <> 'object' THEN RAISE EXCEPTION 'experience_patch_invalid'; END IF;
  IF COALESCE(p_patch,'{}'::jsonb) ?| ARRAY['status','visibility','published_at','deleted_at','event_type','brand_id','id','slug'] THEN
    RAISE EXCEPTION 'experience_lifecycle_fields_forbidden';
  END IF;
  SELECT * INTO v_event FROM public.events WHERE id=p_event_id FOR UPDATE;
  IF NOT FOUND OR v_event.deleted_at IS NOT NULL OR v_event.event_type <> 'experience' THEN RAISE EXCEPTION 'experience_not_found'; END IF;
  IF public.biz_brand_effective_rank(v_event.brand_id,auth.uid()) < public.biz_role_rank('event_manager') THEN
    RAISE EXCEPTION 'insufficient_event_permission';
  END IF;
  IF p_expected_revision IS NOT NULL AND v_event.updated_at IS DISTINCT FROM p_expected_revision THEN
    RAISE EXCEPTION 'stale_experience_revision';
  END IF;
  IF v_event.status IN ('ended','cancelled') THEN RAISE EXCEPTION 'experience_not_editable'; END IF;
  IF p_action='publish' AND v_event.status <> 'draft' THEN RAISE EXCEPTION 'experience_not_publishable'; END IF;
  IF v_event.status IN ('scheduled','live') AND (p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 10 AND 200) THEN
    RAISE EXCEPTION 'experience_edit_reason_required';
  END IF;

  -- Ari can retain an already-persisted stop image but cannot author a URL.
  IF p_patch ? 'stops' THEN
    IF jsonb_typeof(p_patch->'stops') <> 'array' OR jsonb_array_length(p_patch->'stops') > 5 THEN
      RAISE EXCEPTION 'experience_stop_count_invalid';
    END IF;
    FOR v_stop IN SELECT value FROM jsonb_array_elements(p_patch->'stops') LOOP
      IF jsonb_typeof(COALESCE(v_stop->'image_urls','[]'::jsonb)) <> 'array'
         OR jsonb_array_length(COALESCE(v_stop->'image_urls','[]'::jsonb)) > 5 THEN
        RAISE EXCEPTION 'stop_too_many_images';
      END IF;
      FOR v_url IN SELECT value #>> '{}' FROM jsonb_array_elements(COALESCE(v_stop->'image_urls','[]'::jsonb)) LOOP
        IF NOT EXISTS (
          SELECT 1 FROM public.experience_stops prior
          WHERE prior.event_id=p_event_id AND v_url=ANY(COALESCE(prior.image_urls,'{}'::text[]))
        ) THEN RAISE EXCEPTION 'experience_media_reference_required'; END IF;
      END LOOP;
    END LOOP;
  END IF;
  IF p_patch ? 'cover' AND p_patch->'cover' IS DISTINCT FROM public.issue_1973_current_experience_payload(p_event_id)->'cover' THEN
    RAISE EXCEPTION 'experience_media_reference_required';
  END IF;

  v_payload := public.issue_1973_current_experience_payload(p_event_id) || COALESCE(p_patch,'{}'::jsonb);
  IF NULLIF(btrim(v_payload->>'timezone'), '') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM pg_timezone_names WHERE name = NULLIF(btrim(v_payload->>'timezone'), '')
  ) THEN
    RAISE EXCEPTION 'experience_timezone_invalid';
  END IF;
  IF p_action = 'publish' AND NULLIF(btrim(v_payload->>'timezone'), '') IS NULL THEN
    RAISE EXCEPTION 'experience_timezone_required';
  END IF;
  IF v_event.status='draft' THEN
    v_result := public.issue_1719_publish_experience_with_poster(p_event_id,v_payload,p_action='publish');
  ELSE
    v_result := public.biz_update_live_experience(p_event_id,v_payload,p_reason);
    IF NOT COALESCE((v_result->>'ok')::boolean,false) THEN RETURN v_result; END IF;
    -- Repair the two lossless round-trip omissions in the current live owner.
    UPDATE public.experience_stops s SET coordinate_precision=x.precision
      FROM (
        SELECT (value->>'stop_order')::integer AS stop_order,
               NULLIF(value->>'coordinate_precision','') AS precision
        FROM jsonb_array_elements(COALESCE(v_payload->'stops','[]'::jsonb))
      ) x WHERE s.event_id=p_event_id AND s.stop_order=x.stop_order;
    UPDATE public.events SET theme=jsonb_set(
      COALESCE(theme,'{}'::jsonb),'{experience_meta,when_draft}',
      jsonb_build_object('whenMode',v_payload->>'whenMode','when',v_payload->'when',
        'multiDates',v_payload->'multiDates','recurrence_rules',v_payload->'recurrence_rules',
        'timezone',v_payload->>'timezone'),true)
      WHERE id=p_event_id;
  END IF;
  RETURN public.issue_1973_read_experience_graph(p_event_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.business_discard_experience_draft(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_event public.events%ROWTYPE; v_result jsonb;
BEGIN
  SELECT * INTO v_event FROM public.events WHERE id=p_event_id FOR UPDATE;
  IF NOT FOUND OR v_event.deleted_at IS NOT NULL OR v_event.event_type <> 'experience' OR v_event.status <> 'draft' THEN
    RAISE EXCEPTION 'experience_not_discardable';
  END IF;
  v_result := public.business_discard_event_draft(p_event_id);
  RETURN jsonb_build_object('event_id',p_event_id,'brand_id',v_event.brand_id,
    'title',v_event.title,'status','discarded','deleted_at',v_result->'deleted_at');
END;
$$;

CREATE OR REPLACE FUNCTION public.business_unpublish_experience_to_draft(
  p_event_id uuid,p_expected_revision timestamptz DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_event public.events%ROWTYPE; v_first_start timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT * INTO v_event FROM public.events WHERE id=p_event_id FOR UPDATE;
  IF NOT FOUND OR v_event.deleted_at IS NOT NULL OR v_event.event_type <> 'experience' THEN RAISE EXCEPTION 'experience_not_found'; END IF;
  IF public.biz_brand_effective_rank(v_event.brand_id,auth.uid()) < public.biz_role_rank('event_manager') THEN
    RAISE EXCEPTION 'insufficient_event_permission';
  END IF;
  IF p_expected_revision IS NOT NULL AND v_event.updated_at IS DISTINCT FROM p_expected_revision THEN RAISE EXCEPTION 'stale_experience_revision'; END IF;
  IF v_event.status <> 'scheduled' THEN RAISE EXCEPTION 'experience_not_unpublishable'; END IF;
  PERFORM 1 FROM public.event_dates WHERE event_id=p_event_id FOR UPDATE;
  SELECT min(start_at) INTO v_first_start FROM public.event_dates WHERE event_id=p_event_id;
  IF v_first_start IS NULL OR v_first_start <= now() THEN RAISE EXCEPTION 'experience_not_unpublishable'; END IF;
  IF EXISTS (SELECT 1 FROM public.orders o WHERE o.event_id=p_event_id)
     OR EXISTS (SELECT 1 FROM public.tickets t WHERE t.event_id=p_event_id)
     OR EXISTS (SELECT 1 FROM public.scan_events s WHERE s.event_id=p_event_id)
     OR EXISTS (SELECT 1 FROM public.event_rsvps r WHERE r.event_id=p_event_id)
     OR EXISTS (
       SELECT 1 FROM public.event_rsvp_guests g
       JOIN public.event_rsvps r ON r.id=g.rsvp_id
       WHERE r.event_id=p_event_id
     )
     OR EXISTS (SELECT 1 FROM public.event_rsvp_contributions c WHERE c.event_id=p_event_id)
     OR EXISTS (SELECT 1 FROM public.waitlist_entries w WHERE w.event_id=p_event_id)
     OR EXISTS (SELECT 1 FROM public.attendance_claim_deliveries d WHERE d.event_id=p_event_id) THEN
    RAISE EXCEPTION 'experience_has_buyer_dependencies';
  END IF;
  DELETE FROM public.event_dates WHERE event_id=p_event_id;
  UPDATE public.events SET status='draft',visibility='draft',published_at=NULL,
    show_on_discover=false,show_in_swipeable_deck=false,updated_at=now()
    WHERE id=p_event_id;
  RETURN public.issue_1973_read_experience_graph(p_event_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.ari_execute_experience_operation(
  p_operation_id uuid,
  p_tool_name text,
  p_args jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_begin jsonb;
  v_result jsonb;
  v_event_id uuid;
BEGIN
  IF p_tool_name NOT IN (
    'create_experience',
    'publish_experience',
    'update_experience',
    'manage_experience_stops',
    'unpublish_experience',
    'delete_experience'
  ) THEN
    RAISE EXCEPTION 'unsupported_experience_operation';
  END IF;

  v_begin := public.agent_operation_receipt_begin(
    p_operation_id,
    p_tool_name,
    p_args
  );
  IF COALESCE((v_begin->>'replay')::boolean, false) THEN
    RETURN v_begin->'result';
  END IF;

  v_event_id := NULLIF(p_args->>'event_id', '')::uuid;
  CASE p_tool_name
    WHEN 'create_experience' THEN
      v_result := public.business_create_experience_graph(
        NULLIF(p_args->>'brand_id', '')::uuid,
        public.issue_1973_agent_experience_payload(p_args)
      );
    WHEN 'publish_experience' THEN
      v_result := public.business_apply_experience_action(
        v_event_id,
        COALESCE(p_args->'patch', '{}'::jsonb),
        'publish',
        NULLIF(p_args->>'expected_revision', '')::timestamptz,
        NULL
      );
    WHEN 'update_experience' THEN
      v_result := public.business_apply_experience_action(
        v_event_id,
        COALESCE(p_args->'patch', '{}'::jsonb),
        'update',
        NULLIF(p_args->>'expected_revision', '')::timestamptz,
        NULLIF(p_args->>'edit_reason', '')
      );
    WHEN 'manage_experience_stops' THEN
      v_result := public.business_apply_experience_action(
        v_event_id,
        COALESCE(p_args->'patch', '{}'::jsonb),
        'manage_stops',
        NULLIF(p_args->>'expected_revision', '')::timestamptz,
        NULLIF(p_args->>'edit_reason', '')
      );
    WHEN 'unpublish_experience' THEN
      v_result := public.business_unpublish_experience_to_draft(
        v_event_id,
        NULLIF(p_args->>'expected_revision', '')::timestamptz
      );
    WHEN 'delete_experience' THEN
      v_result := public.business_discard_experience_draft(v_event_id);
  END CASE;

  RETURN public.agent_operation_receipt_complete(
    p_operation_id,
    p_tool_name,
    p_args,
    v_result
  );
END;
$$;

REVOKE ALL ON FUNCTION public.issue_1973_read_experience_graph(uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.issue_1973_create_snap_proposals(uuid,jsonb) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.issue_1973_current_experience_payload(uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.issue_1973_agent_experience_payload(jsonb) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.business_create_experience_graph(uuid,jsonb) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.business_apply_experience_action(uuid,jsonb,text,timestamptz,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.business_discard_experience_draft(uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.business_unpublish_experience_to_draft(uuid,timestamptz) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.ari_execute_experience_operation(uuid,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.issue_1973_read_experience_graph(uuid) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.issue_1973_create_snap_proposals(uuid,jsonb) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.issue_1973_current_experience_payload(uuid) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.business_create_experience_graph(uuid,jsonb) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.business_apply_experience_action(uuid,jsonb,text,timestamptz,text) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.business_discard_experience_draft(uuid) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.business_unpublish_experience_to_draft(uuid,timestamptz) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ari_execute_experience_operation(uuid,text,jsonb) TO authenticated,service_role;

COMMENT ON FUNCTION public.business_apply_experience_action(uuid,jsonb,text,timestamptz,text) IS
  '#1973 canonical experience action adapter consumed by the #1972 exact-once receipt wrapper.';


-- #1973 adds the 117th canonical capability after the deployed #2060
-- certification foundation. Extend the requirement set and forward-replace the
-- finalizer so a 116-row evidence set can no longer certify the current ledger.
INSERT INTO public.ari_cert_capability_requirements (capability_id, evidence_mode)
VALUES ('ari.experience.unpublish', 'write')
ON CONFLICT (capability_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.ari_cert_finalize_run(p_run_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_run public.ari_cert_runs%ROWTYPE;
  v_capability_count integer;
  v_failed_count integer;
  v_artifact_count integer;
  v_residue_count integer;
  v_missing_matrix_count integer;
  v_unknown_count integer;
  v_invalid_digest_count integer;
  v_unverified_provenance_count integer;
  v_invalid_native_count integer;
  v_evidence_set_digest text;
  v_artifact_set_digest text;
  v_capability_set_digest text;
  v_native_artifact_set_digest text;
  v_cleanup_digest text;
  v_rollback_digest text;
  v_run_manifest_digest text;
  v_attestation_key text;
  v_attestation_key_id text;
  v_attestation_payload bytea;
  v_attestation_signature text;
BEGIN
  SELECT * INTO v_run FROM public.ari_cert_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ari_cert_run_not_found' USING ERRCODE = 'P0002'; END IF;
  SELECT count(DISTINCT capability_id), count(*) FILTER (WHERE outcome <> 'passed')
    INTO v_capability_count, v_failed_count
  FROM public.ari_cert_evidence WHERE run_id = p_run_id;
  SELECT count(DISTINCT artifact_type) INTO v_artifact_count
  FROM public.ari_cert_release_artifacts
  WHERE run_id = p_run_id AND release_sha = v_run.release_sha;
  SELECT count(*) INTO v_residue_count FROM public.ari_cert_fixtures
  WHERE run_id = p_run_id AND cleanup_state <> 'removed';

  SELECT count(*) INTO v_unknown_count
  FROM public.ari_cert_evidence e
  LEFT JOIN public.ari_cert_capability_requirements r
    ON r.capability_id = e.capability_id
  WHERE e.run_id = p_run_id AND r.capability_id IS NULL;

  WITH expected AS (
    SELECT
      r.capability_id,
      scenario,
      target.surface,
      target.artifact_type,
      role_case,
      CASE WHEN role_case = 'outsider' THEN 'outsider_tenant' ELSE 'owner_tenant' END AS tenant_case
    FROM public.ari_cert_capability_requirements r
    CROSS JOIN LATERAL unnest(public.ari_cert_required_scenarios(r.evidence_mode)) AS scenario
    CROSS JOIN (VALUES
      ('business_ios', 'business_ios_simulator'),
      ('business_ios', 'business_ios_physical'),
      ('business_android', 'business_android'),
      ('business_web', 'business_web')
    ) AS target(surface, artifact_type)
    CROSS JOIN unnest(ARRAY['owner','applicable_member','below_threshold','revoked','outsider']::text[]) AS role_case
  )
  SELECT count(*) INTO v_missing_matrix_count
  FROM expected x
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.ari_cert_evidence e
    JOIN public.ari_cert_release_artifacts a
      ON a.run_id = e.run_id
     AND a.artifact_type = e.artifact_type
     AND a.artifact_id = e.artifact_id
     AND a.release_sha = v_run.release_sha
    WHERE e.run_id = p_run_id
      AND e.capability_id = x.capability_id
      AND e.scenario = x.scenario
      AND e.surface = x.surface
      AND e.artifact_type = x.artifact_type
      AND e.role_case = x.role_case
      AND e.tenant_case = x.tenant_case
      AND e.outcome = 'passed'
      AND e.operation_id IS NOT NULL
      AND e.request_id IS NOT NULL
      AND e.client_turn_id IS NOT NULL
      AND e.execution_id IS NOT NULL
      AND NULLIF(btrim(e.canonical_readback_reference), '') IS NOT NULL
      AND jsonb_typeof(e.safe_evidence) = 'object'
      AND e.safe_evidence ?& ARRAY['receipt_id','readback_digest','telemetry_event_id']
      AND (SELECT count(*) FROM jsonb_object_keys(e.safe_evidence)) = 3
      AND (e.safe_evidence ->> 'receipt_id') ~* '^[0-9a-f-]{36}$'
      AND (e.safe_evidence ->> 'telemetry_event_id') ~* '^[0-9a-f-]{36}$'
      AND (e.safe_evidence ->> 'readback_digest') ~ '^[0-9a-f]{64}$'
  );

  SELECT count(*) INTO v_invalid_digest_count
  FROM public.ari_cert_evidence e
  WHERE e.run_id = p_run_id
    AND e.evidence_digest <> private.ari_cert_digest_v1('scenario-evidence', ARRAY[
      e.run_id::text,
      e.capability_id,
      e.scenario,
      e.surface,
      e.tenant_case,
      e.role_case,
      e.operation_id::text,
      e.request_id::text,
      e.client_turn_id::text,
      e.execution_id::text,
      e.artifact_type,
      e.artifact_id,
      e.canonical_readback_reference,
      e.outcome,
      e.safe_evidence ->> 'receipt_id',
      e.safe_evidence ->> 'readback_digest',
      e.safe_evidence ->> 'telemetry_event_id'
    ]);

  SELECT count(*) INTO v_unverified_provenance_count
  FROM public.ari_cert_evidence e
  WHERE e.run_id = p_run_id
    AND NOT EXISTS (
      SELECT 1
      FROM private.ari_cert_verified_provenance p
      WHERE p.run_id = e.run_id
        AND p.capability_id = e.capability_id
        AND p.surface = e.surface
        AND p.tenant_case = e.tenant_case
        AND p.role_case = e.role_case
        AND p.scenario = e.scenario
        AND p.operation_id = e.operation_id
        AND p.request_id = e.request_id
        AND p.client_turn_id = e.client_turn_id
        AND p.execution_id = e.execution_id
        AND p.canonical_readback_reference = e.canonical_readback_reference
        AND p.artifact_type = e.artifact_type
        AND p.artifact_id = e.artifact_id
        AND p.receipt_id = (e.safe_evidence ->> 'receipt_id')::uuid
        AND p.readback_digest = e.safe_evidence ->> 'readback_digest'
        AND p.telemetry_event_id = (e.safe_evidence ->> 'telemetry_event_id')::uuid
    );

  SELECT count(*) INTO v_invalid_native_count
  FROM jsonb_array_elements(v_run.native_artifacts) item
  LEFT JOIN public.ari_cert_release_artifacts artifact
    ON artifact.run_id = p_run_id
   AND artifact.artifact_type = item ->> 'surface'
   AND artifact.artifact_id = item ->> 'artifact_id'
   AND artifact.release_sha = v_run.release_sha
  WHERE artifact.id IS NULL;

  IF NOT private.ari_cert_native_artifacts_valid(v_run.native_artifacts)
     OR v_invalid_native_count <> 0 THEN
    RAISE EXCEPTION 'ari_cert_invalid_native_artifacts' USING ERRCODE = '22023';
  END IF;
  IF v_capability_count <> 117 THEN RAISE EXCEPTION 'ari_cert_missing_capabilities:%', v_capability_count; END IF;
  IF v_run.requirements_digest <> '5e06801c4afe20600517a53d228b58e0b776a1e59b4e6b6fd123a77b778ba4aa' THEN
    RAISE EXCEPTION 'ari_cert_requirements_digest_mismatch';
  END IF;
  IF v_unknown_count <> 0 THEN RAISE EXCEPTION 'ari_cert_unknown_capabilities:%', v_unknown_count; END IF;
  IF v_missing_matrix_count <> 0 THEN RAISE EXCEPTION 'ari_cert_missing_matrix_evidence:%', v_missing_matrix_count; END IF;
  IF v_invalid_digest_count <> 0 THEN RAISE EXCEPTION 'ari_cert_invalid_evidence_digest:%', v_invalid_digest_count; END IF;
  IF v_unverified_provenance_count <> 0 THEN RAISE EXCEPTION 'ari_cert_unverified_provenance:%', v_unverified_provenance_count; END IF;
  IF v_failed_count <> 0 THEN RAISE EXCEPTION 'ari_cert_nonpassing_evidence:%', v_failed_count; END IF;
  IF v_artifact_count <> 7 THEN RAISE EXCEPTION 'ari_cert_release_artifact_mismatch:%', v_artifact_count; END IF;
  IF v_residue_count <> 0 THEN RAISE EXCEPTION 'ari_cert_fixture_residue:%', v_residue_count; END IF;
  IF v_run.tester_verdict <> 'PASS' OR v_run.cleanup_manifest_digest IS NULL
     OR v_run.rollback_rehearsed_at IS NULL
     OR NULLIF(btrim(v_run.prior_compatible_pair), '') IS NULL
     OR v_run.stranded_operation_count IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'ari_cert_test_or_rollback_incomplete';
  END IF;

  v_attestation_key := current_setting('app.settings.ari_certification_attestation_key', true);
  v_attestation_key_id := current_setting('app.settings.ari_certification_attestation_key_id', true);
  IF length(coalesce(v_attestation_key, '')) < 32
     OR coalesce(v_attestation_key_id, '') !~ '^[a-zA-Z0-9_.:-]{1,64}$' THEN
    RAISE EXCEPTION 'ari_cert_server_attestation_not_configured';
  END IF;
  SELECT private.ari_cert_digest_v1(
    'evidence-set',
    coalesce(array_agg(
      evidence_digest ORDER BY capability_id, surface, artifact_type, scenario, role_case
    ), ARRAY[]::text[])
  )
  INTO v_evidence_set_digest
  FROM public.ari_cert_evidence WHERE run_id = p_run_id;

  SELECT private.ari_cert_digest_v1(
    'artifact-set',
    coalesce(array_agg(private.ari_cert_digest_v1('release-artifact', ARRAY[
      artifact_type, artifact_id, release_sha, sha256
    ]) ORDER BY artifact_type), ARRAY[]::text[])
  )
  INTO v_artifact_set_digest
  FROM public.ari_cert_release_artifacts WHERE run_id = p_run_id;

  WITH per_capability AS (
    SELECT e.capability_id, private.ari_cert_digest_v1(
      'capability-evidence',
      ARRAY[
        p_run_id::text,
        e.capability_id,
        CASE r.evidence_mode
          WHEN 'guided_handoff' THEN 'guided_handoff'
          WHEN 'unsupported' THEN 'unsupported'
          ELSE 'verified'
        END,
        'business_android', 'business_ios', 'business_web'
      ] || ARRAY(
        SELECT required_scenario
        FROM unnest(public.ari_cert_required_scenarios(r.evidence_mode)) required_scenario
        ORDER BY required_scenario
      ) || ARRAY[
        CASE WHEN r.evidence_mode IN ('guided_handoff','unsupported')
          THEN NULL ELSE min(e.canonical_readback_reference) END,
        'owner|applicable_member|below_threshold|revoked|outsider'
      ] || array_agg(
        e.evidence_digest ORDER BY e.surface, e.artifact_type, e.scenario, e.role_case
      )
    ) AS capability_digest
    FROM public.ari_cert_evidence e
    JOIN public.ari_cert_capability_requirements r
      ON r.capability_id = e.capability_id
    WHERE e.run_id = p_run_id
    GROUP BY e.capability_id, r.evidence_mode
  ), flattened AS (
    SELECT capability_id, value, ordinal
    FROM per_capability
    CROSS JOIN LATERAL unnest(ARRAY[capability_id, capability_digest])
      WITH ORDINALITY AS item(value, ordinal)
  )
  SELECT private.ari_cert_digest_v1(
    'capability-set',
    array_agg(value ORDER BY capability_id, ordinal)
  )
  INTO v_capability_set_digest
  FROM flattened;

  SELECT private.ari_cert_digest_v1(
    'native-artifact-set',
    array_agg(private.ari_cert_digest_v1('native-artifact', ARRAY[
      item ->> 'surface', item ->> 'artifact_id',
      item ->> 'runtime_version', item ->> 'device'
    ]) ORDER BY item ->> 'surface')
  )
  INTO v_native_artifact_set_digest
  FROM jsonb_array_elements(v_run.native_artifacts) item;

  v_cleanup_digest := private.ari_cert_digest_v1(
    'cleanup', ARRAY['true', v_run.cleanup_manifest_digest]
  );
  v_rollback_digest := private.ari_cert_digest_v1(
    'rollback', ARRAY['true', v_run.prior_compatible_pair, v_run.stranded_operation_count::text]
  );
  v_run_manifest_digest := private.ari_cert_digest_v1('run-manifest', ARRAY[
    v_run.function_versions ->> 'agent_chat',
    v_run.function_versions ->> 'agent_confirm_action',
    v_run.web_deployment_id,
    v_run.tester_verdict,
    v_native_artifact_set_digest,
    v_capability_set_digest,
    v_cleanup_digest,
    v_rollback_digest
  ]);
  v_attestation_payload := private.ari_cert_canonical_tuple_v1('attestation', ARRAY[
    v_attestation_key_id,
    p_run_id::text,
    v_run.release_sha,
    v_run.requirements_digest,
    v_evidence_set_digest,
    v_artifact_set_digest,
    v_capability_set_digest,
    v_native_artifact_set_digest,
    v_cleanup_digest,
    v_rollback_digest,
    v_run_manifest_digest
  ]);
  v_attestation_signature := encode(extensions.hmac(
    v_attestation_payload,
    convert_to(v_attestation_key, 'UTF8'),
    'sha256'
  ), 'hex');

  INSERT INTO private.ari_cert_finalize_authorizations (run_id, transaction_id)
  VALUES (p_run_id, txid_current())
  ON CONFLICT (run_id) DO UPDATE SET transaction_id = EXCLUDED.transaction_id;

  UPDATE public.ari_cert_runs
  SET status = 'passed', cleanup_verified_at = now(), finished_at = now(),
      attestation_key_id = v_attestation_key_id,
      evidence_set_digest = v_evidence_set_digest,
      artifact_set_digest = v_artifact_set_digest,
      capability_set_digest = v_capability_set_digest,
      native_artifact_set_digest = v_native_artifact_set_digest,
      cleanup_digest = v_cleanup_digest,
      rollback_digest = v_rollback_digest,
      run_manifest_digest = v_run_manifest_digest,
      attestation_signature = v_attestation_signature
  WHERE id = p_run_id;
  RETURN jsonb_build_object(
    'run_id', p_run_id,
    'status', 'passed',
    'capability_count', 117,
    'server_attestation', jsonb_build_object(
      'algorithm', 'HMAC-SHA256',
      'canonicalization', 'ARI-CERT-TUPLE-V1',
      'key_id', v_attestation_key_id,
      'evidence_set_digest', v_evidence_set_digest,
      'artifact_set_digest', v_artifact_set_digest,
      'capability_set_digest', v_capability_set_digest,
      'native_artifact_set_digest', v_native_artifact_set_digest,
      'cleanup_digest', v_cleanup_digest,
      'rollback_digest', v_rollback_digest,
      'run_manifest_digest', v_run_manifest_digest,
      'signature', v_attestation_signature
    )
  );
END;
$function$;


COMMIT;
