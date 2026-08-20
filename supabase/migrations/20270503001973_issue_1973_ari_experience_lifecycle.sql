-- Issue #1973: canonical experience graph/lifecycle owner shared by Ari and Business.
-- This consumes the #1972 operation-receipt primitive without duplicating it.
BEGIN;

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
DECLARE v_created jsonb; v_event_id uuid;
BEGIN
  IF p_payload ?| ARRAY['status','visibility','published_at','deleted_at','event_type','brand_id'] THEN
    RAISE EXCEPTION 'experience_lifecycle_fields_forbidden';
  END IF;
  IF p_payload->'cover' IS NOT NULL AND p_payload->'cover' <> '{}'::jsonb THEN
    RAISE EXCEPTION 'experience_media_reference_required';
  END IF;
  v_created := public.biz_create_experience(p_brand_id,p_payload,false);
  v_event_id := (v_created->'event'->>'id')::uuid;
  IF v_event_id IS NULL THEN RAISE EXCEPTION 'experience_create_readback_failed'; END IF;
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
  SELECT min(start_at) INTO v_first_start FROM public.event_dates WHERE event_id=p_event_id;
  IF v_first_start IS NULL OR v_first_start <= now() THEN RAISE EXCEPTION 'experience_not_unpublishable'; END IF;
  IF EXISTS (SELECT 1 FROM public.orders o WHERE o.event_id=p_event_id)
     OR EXISTS (SELECT 1 FROM public.tickets t JOIN public.ticket_types tt ON tt.id=t.ticket_type_id WHERE tt.event_id=p_event_id)
     OR EXISTS (SELECT 1 FROM public.event_rsvps r WHERE r.event_id=p_event_id)
     OR EXISTS (SELECT 1 FROM public.waitlist_entries w WHERE w.event_id=p_event_id) THEN
    RAISE EXCEPTION 'experience_has_buyer_dependencies';
  END IF;
  DELETE FROM public.event_dates WHERE event_id=p_event_id;
  UPDATE public.events SET status='draft',visibility='draft',published_at=NULL,updated_at=now()
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
REVOKE ALL ON FUNCTION public.issue_1973_current_experience_payload(uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.issue_1973_agent_experience_payload(jsonb) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.business_create_experience_graph(uuid,jsonb) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.business_apply_experience_action(uuid,jsonb,text,timestamptz,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.business_discard_experience_draft(uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.business_unpublish_experience_to_draft(uuid,timestamptz) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.ari_execute_experience_operation(uuid,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.issue_1973_read_experience_graph(uuid) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.issue_1973_current_experience_payload(uuid) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.business_create_experience_graph(uuid,jsonb) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.business_apply_experience_action(uuid,jsonb,text,timestamptz,text) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.business_discard_experience_draft(uuid) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.business_unpublish_experience_to_draft(uuid,timestamptz) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ari_execute_experience_operation(uuid,text,jsonb) TO authenticated,service_role;

COMMENT ON FUNCTION public.business_apply_experience_action(uuid,jsonb,text,timestamptz,text) IS
  '#1973 canonical experience action adapter consumed by the #1972 exact-once receipt wrapper.';

COMMIT;
