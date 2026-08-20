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

-- #1973 forward-replaces the canonical create owner so stop precision and
-- nullable draft timezone are written by the one graph INSERT path.
CREATE OR REPLACE FUNCTION public.biz_create_experience(
  p_brand_id uuid,
  p_payload  jsonb,
  p_publish  boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_user_id          uuid;
  v_brand            record;
  v_now              timestamptz := now();
  v_title            text;
  v_description      text;
  v_intents          text[];
  v_intent           text;        -- back-compat mirror = v_intents[1]
  v_currency         char(3);
  v_location_mode    text;
  v_pricing_mode     text;
  v_is_free          boolean;
  v_capacity         integer;
  v_whole_price      integer;
  v_resolved_total   integer;
  v_stops            jsonb;
  v_stop_count       integer;
  v_stop             jsonb;
  v_base_slug        text;
  v_final_slug       text;
  v_suffix           integer := 2;
  v_event_id         uuid;
  v_event            public.events%ROWTYPE;
  v_ticket_id        uuid;
  v_shared_place_id     text;
  v_shared_place_addr   text;
  v_shared_city         text;
  v_shared_region       text;
  v_shared_country      text;
  v_shared_lat          double precision;
  v_shared_lng          double precision;
  v_shared_precision    text;
  v_idx              integer;
  v_s_place_id       text;
  v_s_address        text;
  v_s_city           text;
  v_s_region         text;
  v_s_country        text;
  v_s_lat            double precision;
  v_s_lng            double precision;
  v_s_precision      text;
  v_s_images         text[];
  v_s_start          time;
  v_s_price          integer;
  v_when_mode        text;
  v_when             jsonb;
  v_multi_dates      jsonb;
  v_recurrence_rules jsonb;
  v_timezone         text;
  v_date_iso         text;
  v_doors            text;
  v_ends             text;
  v_start            timestamptz;
  v_end              timestamptz;
  v_date_entry       jsonb;
  v_min_start        timestamptz;
  v_is_recurring     boolean;
  v_is_multi_date    boolean;
  v_next_occurrence  timestamptz;
  v_term_kind        text;        -- recurrence termination kind ('count'|'until'|'never')
  v_when_draft       jsonb;       -- raw When inputs persisted for draft round-trip
  v_max_end          timestamptz; -- ORCH-1075: latest end_at across inserted dates
  v_cover            jsonb;
  v_stop_rows        jsonb;
  v_ticket_rows      jsonb;
  v_event_dates_rows jsonb;
BEGIN
  -- 1. Auth + permission --------------------------------------------------
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT id, slug, name, default_currency
  INTO v_brand
  FROM public.brands
  WHERE id = p_brand_id
    AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'brand_not_found';
  END IF;

  IF public.biz_brand_effective_rank(p_brand_id, v_user_id) < public.biz_role_rank('event_manager'::text) THEN
    RAISE EXCEPTION 'insufficient_event_permission';
  END IF;

  -- 2. Validate header ----------------------------------------------------
  v_title := NULLIF(btrim(COALESCE(p_payload->>'title', '')), '');
  IF v_title IS NULL THEN
    RAISE EXCEPTION 'experience_title_required';
  END IF;

  v_description := NULLIF(btrim(COALESCE(p_payload->>'description', '')), '');
  IF p_publish THEN
    IF v_description IS NULL OR char_length(v_description) < 10 OR char_length(v_description) > 500 THEN
      RAISE EXCEPTION 'experience_description_invalid';
    END IF;
  END IF;

  -- multi-intent (unchanged): array, validate each id, >=1 at publish.
  IF jsonb_typeof(p_payload->'experience_intents') = 'array' THEN
    SELECT array_agg(elem ORDER BY ord)
    INTO v_intents
    FROM (
      SELECT DISTINCT ON (btrim(e.value))
             btrim(e.value) AS elem, e.ordinality AS ord
      FROM jsonb_array_elements_text(p_payload->'experience_intents')
        WITH ORDINALITY AS e(value, ordinality)
      WHERE btrim(e.value) <> ''
      ORDER BY btrim(e.value), e.ordinality
    ) d;
  END IF;
  IF v_intents IS NOT NULL
     AND NOT (v_intents <@ ARRAY['adventurous','first-date','romantic','group-fun']::text[]) THEN
    RAISE EXCEPTION 'experience_intent_invalid';
  END IF;
  IF p_publish AND (v_intents IS NULL OR array_length(v_intents, 1) IS NULL) THEN
    RAISE EXCEPTION 'experience_intent_required';
  END IF;
  v_intent := v_intents[1];

  -- I-7 CURRENCY DE-GBP
  v_currency := upper(COALESCE(
    NULLIF(p_payload->>'currency', ''),
    v_brand.default_currency::text,
    'USD'
  ))::char(3);

  IF v_currency <> ALL (
    ARRAY[
      'GBP'::bpchar, 'USD'::bpchar, 'CAD'::bpchar, 'CHF'::bpchar, 'EUR'::bpchar,
      'BGN'::bpchar, 'CZK'::bpchar, 'DKK'::bpchar, 'HUF'::bpchar, 'ISK'::bpchar,
      'NOK'::bpchar, 'PLN'::bpchar, 'RON'::bpchar, 'SEK'::bpchar, 'AUD'::bpchar,
      'NZD'::bpchar, 'SGD'::bpchar, 'HKD'::bpchar, 'JPY'::bpchar
    ]
  ) THEN
    RAISE EXCEPTION 'event_currency_unsupported';
  END IF;

  -- 3. Validate modes -----------------------------------------------------
  v_location_mode := COALESCE(NULLIF(p_payload->>'location_mode', ''), 'single');
  v_pricing_mode  := COALESCE(NULLIF(p_payload->>'pricing_mode', ''), 'whole');
  IF v_location_mode NOT IN ('single','per_stop') OR v_pricing_mode NOT IN ('whole','per_stop') THEN
    RAISE EXCEPTION 'invalid_mode';
  END IF;

  v_is_free  := COALESCE((p_payload->>'is_free')::boolean, false);
  v_capacity := NULLIF(p_payload->>'capacity', '')::integer;
  v_whole_price := COALESCE(NULLIF(p_payload->>'whole_price_cents', '')::integer, 0);

  v_stops := COALESCE(p_payload->'stops', '[]'::jsonb);
  IF jsonb_typeof(v_stops) IS DISTINCT FROM 'array' THEN
    v_stops := '[]'::jsonb;
  END IF;
  v_stop_count := jsonb_array_length(v_stops);

  -- 4. Validate stops -----------------------------------------------------
  IF p_publish THEN
    IF v_stop_count < 2 OR v_stop_count > 5 THEN
      RAISE EXCEPTION 'experience_stop_count_invalid';
    END IF;
  ELSE
    IF v_stop_count > 5 THEN
      RAISE EXCEPTION 'experience_stop_count_invalid';
    END IF;
  END IF;

  FOR v_stop IN SELECT value FROM jsonb_array_elements(v_stops)
  LOOP
    IF p_publish AND NULLIF(btrim(COALESCE(v_stop->>'place_name', '')), '') IS NULL THEN
      RAISE EXCEPTION 'stop_name_required';
    END IF;
    IF p_publish AND NULLIF(btrim(COALESCE(v_stop->>'ai_description', '')), '') IS NULL THEN
      RAISE EXCEPTION 'stop_description_required';
    END IF;
    IF (v_stop->'image_urls') IS NOT NULL
       AND jsonb_typeof(v_stop->'image_urls') = 'array'
       AND jsonb_array_length(v_stop->'image_urls') > 5 THEN
      RAISE EXCEPTION 'stop_too_many_images';
    END IF;
    IF COALESCE((v_stop->>'price_cents')::integer, 0) < 0 THEN
      RAISE EXCEPTION 'experience_price_invalid';
    END IF;
    IF NULLIF(v_stop->>'coordinate_precision', '') IS NOT NULL
       AND NULLIF(v_stop->>'coordinate_precision', '') NOT IN ('exact', 'approximate') THEN
      RAISE EXCEPTION 'experience_coordinate_precision_invalid';
    END IF;
  END LOOP;

  IF p_publish THEN
    IF v_location_mode = 'single' THEN
      IF NULLIF(v_stops->0->>'place_id', '') IS NULL
         OR (v_stops->0->>'lat') IS NULL
         OR (v_stops->0->>'lng') IS NULL THEN
        RAISE EXCEPTION 'stop_address_unvalidated';
      END IF;
    ELSE
      FOR v_stop IN SELECT value FROM jsonb_array_elements(v_stops)
      LOOP
        IF NULLIF(v_stop->>'place_id', '') IS NULL
           OR (v_stop->>'lat') IS NULL
           OR (v_stop->>'lng') IS NULL THEN
          RAISE EXCEPTION 'stop_address_unvalidated';
        END IF;
      END LOOP;
    END IF;
  END IF;

  -- 5. Resolve the ONE price (I-1 spine) ----------------------------------
  v_resolved_total :=
    CASE
      WHEN v_is_free THEN 0
      WHEN v_pricing_mode = 'whole' THEN v_whole_price
      ELSE (
        SELECT COALESCE(sum(COALESCE((s->>'price_cents')::integer, 0)), 0)
        FROM jsonb_array_elements(v_stops) s
      )
    END;

  IF (NOT v_is_free) AND v_pricing_mode = 'whole' AND p_publish AND v_resolved_total <= 0 THEN
    RAISE EXCEPTION 'experience_price_invalid';
  END IF;

  IF v_location_mode = 'single' AND v_stop_count > 0 THEN
    v_shared_place_id   := NULLIF(v_stops->0->>'place_id', '');
    v_shared_place_addr := NULLIF(v_stops->0->>'address', '');
    v_shared_city       := NULLIF(v_stops->0->>'city', '');
    v_shared_region     := NULLIF(v_stops->0->>'region', '');
    v_shared_country    := NULLIF(v_stops->0->>'country_code', '');
    v_shared_lat        := NULLIF(v_stops->0->>'lat', '')::double precision;
    v_shared_lng        := NULLIF(v_stops->0->>'lng', '')::double precision;
    v_shared_precision  := NULLIF(v_stops->0->>'coordinate_precision', '');
  END IF;

  -- 6. Resolve the date model --------------------------------------------
  v_when_mode := COALESCE(NULLIF(p_payload->>'whenMode', ''), 'single');
  v_when := p_payload->'when';
  v_multi_dates := p_payload->'multiDates';
  v_recurrence_rules := p_payload->'recurrence_rules';
  v_timezone := NULLIF(p_payload->>'timezone', '');
  IF p_publish AND v_timezone IS NULL THEN
    RAISE EXCEPTION 'experience_timezone_required';
  END IF;
  IF v_timezone IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM pg_timezone_names WHERE name = v_timezone
  ) THEN
    RAISE EXCEPTION 'experience_timezone_invalid';
  END IF;
  v_is_recurring  := (v_when_mode = 'recurring');
  v_is_multi_date := (v_when_mode = 'multi_date');
  v_term_kind := NULLIF(v_recurrence_rules->'termination'->>'kind', '');

  IF p_publish AND v_when_mode NOT IN ('single','multi_date','recurring') THEN
    RAISE EXCEPTION 'event_date_required';
  END IF;

  -- BUG 1 FIX — capture the RAW When inputs so a DRAFT round-trips its
  -- date/time/recurrence/multi selection (event_dates stays publish-only).
  v_when_draft := jsonb_strip_nulls(jsonb_build_object(
    'whenMode',  v_when_mode,
    'when',      v_when,
    'multiDates', v_multi_dates,
    'recurrence_rules', v_recurrence_rules,
    'timezone',  v_timezone
  ));


  -- ORCH-1075 paid-publish integrity guards (experience publish path) -----
  -- Mirror the checkout-session readiness predicate + reject past-dated paid
  -- publishes BEFORE the events row goes live. Guards fire on PAID publish only
  -- (resolved total > 0); drafts (p_publish=false) and FREE offerings are exempt.
  --   Stripe charges_enabled: https://docs.stripe.com/api/accounts/object
  --   Finish onboarding:      https://docs.stripe.com/connect/onboarding.md
  IF p_publish AND NOT v_is_free AND v_resolved_total > 0 THEN
    -- Guard A: Stripe readiness (identical to ticket-checkout-create).
    IF NOT public.pg_brand_can_collect(v_brand.id) THEN
      -- TRANSITIONAL wire alias; remove only under cleanup issue #1922:
      -- https://github.com/Mingla-LLC/mingla-main/issues/1922
      RAISE EXCEPTION 'stripe_charges_disabled';
    END IF;
    -- Guard B: latest occurrence must still be in the future. v_max_end = MAX
    -- end_at across the date(s) about to be materialised (Q4: a paid offering
    -- with ANY future occurrence is NOT past).
    v_max_end := NULL;
    IF v_when_mode IN ('single','recurring') THEN
      v_date_iso := NULLIF(v_when->>'date', '');
      IF v_date_iso IS NOT NULL THEN
        v_doors := COALESCE(NULLIF(v_when->>'doorsOpen', ''), '00:00');
        v_ends  := COALESCE(NULLIF(v_when->>'endsAt', ''), v_doors);
        v_start := (v_date_iso || ' ' || v_doors || ':00')::timestamp AT TIME ZONE v_timezone;
        v_end   := (v_date_iso || ' ' || v_ends  || ':00')::timestamp AT TIME ZONE v_timezone;
        IF v_end <= v_start THEN
          v_end := v_end + INTERVAL '1 day';
        END IF;
        v_max_end := v_end;
      END IF;
    ELSIF v_when_mode = 'multi_date'
          AND v_multi_dates IS NOT NULL
          AND jsonb_typeof(v_multi_dates) = 'array' THEN
      FOR v_date_entry IN SELECT value FROM jsonb_array_elements(v_multi_dates)
      LOOP
        v_date_iso := NULLIF(v_date_entry->>'date', '');
        IF v_date_iso IS NULL THEN CONTINUE; END IF;
        v_doors := COALESCE(NULLIF(v_date_entry->>'startTime', ''), '00:00');
        v_ends  := COALESCE(NULLIF(v_date_entry->>'endTime', ''), v_doors);
        v_start := (v_date_iso || ' ' || v_doors || ':00')::timestamp AT TIME ZONE v_timezone;
        v_end   := (v_date_iso || ' ' || v_ends  || ':00')::timestamp AT TIME ZONE v_timezone;
        IF v_end <= v_start THEN
          v_end := v_end + INTERVAL '1 day';
        END IF;
        v_max_end := GREATEST(v_max_end, v_end);
      END LOOP;
    END IF;
    IF v_max_end IS NULL OR v_max_end <= v_now THEN
      RAISE EXCEPTION 'offering_date_past';
    END IF;
  END IF;

  -- 7. Build the slug -----------------------------------------------------
  v_base_slug := lower(regexp_replace(v_title, '[^a-zA-Z0-9]+', '-', 'g'));
  v_base_slug := regexp_replace(v_base_slug, '(^-+|-+$)', '', 'g');
  IF v_base_slug = '' THEN
    v_base_slug := 'experience';
  END IF;
  v_final_slug := v_base_slug;
  WHILE EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.brand_id = p_brand_id
      AND e.deleted_at IS NULL
      AND lower(e.slug) = lower(v_final_slug)
  ) LOOP
    v_final_slug := v_base_slug || '-' || v_suffix::text;
    v_suffix := v_suffix + 1;
  END LOOP;

  -- BUG 3 FIX — cover patch (absent key = NULL on create).
  v_cover := COALESCE(p_payload->'cover', '{}'::jsonb);

  -- 8. INSERT the events row ----------------------------------------------
  INSERT INTO public.events (
    brand_id, created_by, event_type, title, slug, description,
    status, visibility, published_at, currency, timezone,
    pass_tax, pass_mingla_fee, pass_service_fee,
    location_mode, pricing_mode, experience_intent, experience_intents, whole_price_cents,
    is_recurring, is_multi_date, recurrence_rules,
    cover_media_url, cover_media_type, cover_media_provider,
    cover_media_source_url, cover_media_credit, cover_media_credit_url, cover_media_alt,
    theme, created_at, updated_at
  ) VALUES (
    p_brand_id, v_user_id, 'experience', v_title, v_final_slug, v_description,
    CASE WHEN p_publish THEN 'scheduled' ELSE 'draft' END,
    CASE WHEN p_publish THEN 'public' ELSE 'draft' END,
    CASE WHEN p_publish THEN v_now ELSE NULL END,
    v_currency, v_timezone,
    CASE WHEN (p_payload ? 'pass_tax') THEN (p_payload->>'pass_tax')::boolean ELSE NULL END,
    CASE WHEN (p_payload ? 'pass_mingla_fee') THEN (p_payload->>'pass_mingla_fee')::boolean ELSE NULL END,
    CASE WHEN (p_payload ? 'pass_service_fee') THEN (p_payload->>'pass_service_fee')::boolean ELSE NULL END,
    v_location_mode, v_pricing_mode, v_intent, v_intents,
    CASE WHEN v_pricing_mode = 'whole' THEN v_resolved_total ELSE NULL END,
    v_is_recurring, v_is_multi_date, v_recurrence_rules,
    NULLIF(v_cover->>'coverMediaUrl', ''),
    NULLIF(v_cover->>'coverMediaType', ''),
    NULLIF(v_cover->>'coverMediaProvider', ''),
    NULLIF(v_cover->>'coverMediaSourceUrl', ''),
    NULLIF(v_cover->>'coverMediaCredit', ''),
    NULLIF(v_cover->>'coverMediaCreditUrl', ''),
    NULLIF(v_cover->>'coverMediaAlt', ''),
    jsonb_build_object(
      'experience_meta', jsonb_build_object(
        'venue_text', COALESCE(NULLIF(v_stops->0->>'address', ''), ''),
        'tier_name', 'Standard',
        'when_draft', v_when_draft
      )
    ),
    v_now, v_now
  )
  RETURNING id INTO v_event_id;

  -- 9. INSERT experience_stops --------------------------------------------
  v_idx := 0;
  FOR v_stop IN SELECT value FROM jsonb_array_elements(v_stops)
  LOOP
    IF v_location_mode = 'single' THEN
      v_s_place_id := v_shared_place_id;
      v_s_address  := v_shared_place_addr;
      v_s_city     := v_shared_city;
      v_s_region   := v_shared_region;
      v_s_country  := v_shared_country;
      v_s_lat      := v_shared_lat;
      v_s_lng      := v_shared_lng;
      v_s_precision := v_shared_precision;
    ELSE
      v_s_place_id := NULLIF(v_stop->>'place_id', '');
      v_s_address  := NULLIF(v_stop->>'address', '');
      v_s_city     := NULLIF(v_stop->>'city', '');
      v_s_region   := NULLIF(v_stop->>'region', '');
      v_s_country  := NULLIF(v_stop->>'country_code', '');
      v_s_lat      := NULLIF(v_stop->>'lat', '')::double precision;
      v_s_lng      := NULLIF(v_stop->>'lng', '')::double precision;
      v_s_precision := NULLIF(v_stop->>'coordinate_precision', '');
    END IF;

    IF v_s_precision IS NOT NULL
       AND v_s_precision NOT IN ('exact', 'approximate') THEN
      RAISE EXCEPTION 'experience_coordinate_precision_invalid';
    END IF;

    v_s_images := COALESCE(
      (SELECT array_agg(value::text)
       FROM jsonb_array_elements_text(
         CASE WHEN jsonb_typeof(v_stop->'image_urls') = 'array'
              THEN v_stop->'image_urls' ELSE '[]'::jsonb END)),
      ARRAY[]::text[]
    );
    v_s_start := NULLIF(v_stop->>'start_time', '')::time;
    v_s_price := CASE WHEN v_pricing_mode = 'whole' THEN 0
                      ELSE COALESCE((v_stop->>'price_cents')::integer, 0) END;

    INSERT INTO public.experience_stops (
      event_id, stop_order, place_id, place_name, address,
      city, region, country_code, lat, lng,
      image_urls, start_time, price_cents, ai_description,
      coordinate_precision
    ) VALUES (
      v_event_id,
      COALESCE((v_stop->>'stop_order')::integer, v_idx),
      v_s_place_id,
      btrim(v_stop->>'place_name'),
      COALESCE(v_s_address, ''),
      v_s_city, v_s_region, v_s_country, v_s_lat, v_s_lng,
      v_s_images, v_s_start, v_s_price,
      COALESCE(NULLIF(btrim(v_stop->>'ai_description'), ''), ''),
      v_s_precision
    );
    v_idx := v_idx + 1;
  END LOOP;

  -- 10. INSERT the ONE ticket_types row (NEVER N) — I-1 spine -------------
  INSERT INTO public.ticket_types (
    event_id, name, description, price_cents, currency,
    quantity_total, is_unlimited, is_free,
    min_purchase_qty, max_purchase_qty,
    is_hidden, is_disabled, requires_approval, allow_transfers,
    password_protected, available_online, available_in_person,
    waitlist_enabled, display_order
  ) VALUES (
    v_event_id, 'Standard', NULL, v_resolved_total, v_currency,
    CASE WHEN v_capacity IS NULL OR v_capacity <= 0 THEN NULL ELSE v_capacity END,
    (v_capacity IS NULL OR v_capacity <= 0),
    (v_resolved_total = 0),
    1, NULL,
    false, false, false, true,
    false, true, true,
    false, 0
  )
  RETURNING id INTO v_ticket_id;

  -- 11. Materialise event_dates (PUBLISH only — I-4) ----------------------
  IF p_publish THEN
    IF v_when_mode IN ('single','recurring') THEN
      v_date_iso := NULLIF(v_when->>'date', '');
      IF v_date_iso IS NULL THEN
        RAISE EXCEPTION 'event_date_required';
      END IF;
      v_doors := COALESCE(NULLIF(v_when->>'doorsOpen', ''), '00:00');
      v_ends  := COALESCE(NULLIF(v_when->>'endsAt', ''), v_doors);
      v_start := (v_date_iso || ' ' || v_doors || ':00')::timestamp AT TIME ZONE v_timezone;
      v_end   := (v_date_iso || ' ' || v_ends  || ':00')::timestamp AT TIME ZONE v_timezone;
      IF v_end <= v_start THEN
        v_end := v_end + INTERVAL '1 day';
      END IF;
      -- FEATURE never-ends: a 'never' rule materialises EXACTLY the master
      -- (first) occurrence — the rule carries the repeat, the engine needs >=1
      -- future date. Same single-master shape as the prior recurring path.
      INSERT INTO public.event_dates (event_id, start_at, end_at, timezone, is_master)
      VALUES (v_event_id, v_start, v_end, v_timezone, true);
      v_next_occurrence := v_start;

    ELSIF v_when_mode = 'multi_date' THEN
      IF v_multi_dates IS NULL
         OR jsonb_typeof(v_multi_dates) IS DISTINCT FROM 'array'
         OR jsonb_array_length(v_multi_dates) = 0 THEN
        RAISE EXCEPTION 'event_date_required';
      END IF;

      SELECT min(
        (entry->>'date' || ' ' || COALESCE(NULLIF(entry->>'startTime', ''), '00:00') || ':00')::timestamp
          AT TIME ZONE v_timezone
      )
      INTO v_min_start
      FROM jsonb_array_elements(v_multi_dates) entry
      WHERE NULLIF(entry->>'date', '') IS NOT NULL;

      IF v_min_start IS NULL THEN
        RAISE EXCEPTION 'event_date_required';
      END IF;

      FOR v_date_entry IN SELECT value FROM jsonb_array_elements(v_multi_dates)
      LOOP
        v_date_iso := NULLIF(v_date_entry->>'date', '');
        IF v_date_iso IS NULL THEN
          RAISE EXCEPTION 'event_date_required';
        END IF;
        v_doors := COALESCE(NULLIF(v_date_entry->>'startTime', ''), '00:00');
        v_ends  := COALESCE(NULLIF(v_date_entry->>'endTime', ''), v_doors);
        v_start := (v_date_iso || ' ' || v_doors || ':00')::timestamp AT TIME ZONE v_timezone;
        v_end   := (v_date_iso || ' ' || v_ends  || ':00')::timestamp AT TIME ZONE v_timezone;
        IF v_end <= v_start THEN
          v_end := v_end + INTERVAL '1 day';
        END IF;
        INSERT INTO public.event_dates (event_id, start_at, end_at, timezone, is_master)
        VALUES (v_event_id, v_start, v_end, v_timezone, v_start = v_min_start);
      END LOOP;
      v_next_occurrence := v_min_start;
    END IF;

    IF v_next_occurrence IS NOT NULL THEN
      UPDATE public.events
      SET theme = jsonb_set(
            COALESCE(theme, '{}'::jsonb),
            '{experience_meta,next_occurrence_at}',
            to_jsonb(to_char(v_next_occurrence AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
            true
          ),
          updated_at = v_now
      WHERE id = v_event_id;
    END IF;
  END IF;

  -- 12. Build the return payload ------------------------------------------
  SELECT * INTO v_event FROM public.events WHERE id = v_event_id;

  SELECT COALESCE(jsonb_agg(to_jsonb(es) ORDER BY es.stop_order), '[]'::jsonb)
  INTO v_stop_rows
  FROM public.experience_stops es
  WHERE es.event_id = v_event_id;

  SELECT COALESCE(jsonb_agg(to_jsonb(tt) ORDER BY tt.display_order), '[]'::jsonb)
  INTO v_ticket_rows
  FROM public.ticket_types tt
  WHERE tt.event_id = v_event_id
    AND tt.deleted_at IS NULL;

  SELECT COALESCE(jsonb_agg(to_jsonb(ed) ORDER BY ed.start_at), '[]'::jsonb)
  INTO v_event_dates_rows
  FROM public.event_dates ed
  WHERE ed.event_id = v_event_id;

  RETURN jsonb_build_object(
    'event', to_jsonb(v_event),
    'brand', jsonb_build_object('id', v_brand.id, 'slug', v_brand.slug, 'name', v_brand.name),
    'stops', v_stop_rows,
    'ticket', (v_ticket_rows->0),
    'tickets', v_ticket_rows,
    'eventDates', v_event_dates_rows
  );
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'slug_taken';
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
    IF NULLIF(btrim(v_payload->>'timezone'), '') IS NULL THEN
      UPDATE public.events
      SET timezone = NULL,
          theme = theme #- '{experience_meta,when_draft,timezone}',
          updated_at = now()
      WHERE id = p_event_id AND status = 'draft' AND event_type = 'experience';
    END IF;
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
        p_args - ARRAY['event_id','expected_revision','edit_reason'],
        'update',
        NULLIF(p_args->>'expected_revision', '')::timestamptz,
        NULLIF(p_args->>'edit_reason', '')
      );
    WHEN 'manage_experience_stops' THEN
      v_result := public.business_apply_experience_action(
        v_event_id,
        jsonb_build_object(
          'stops',COALESCE(p_args->'stops','[]'::jsonb),
          'experience_intents',COALESCE(p_args->'experience_intents','[]'::jsonb)
        ),
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
REVOKE ALL ON FUNCTION public.biz_create_experience(uuid,jsonb,boolean) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.business_create_experience_graph(uuid,jsonb) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.business_apply_experience_action(uuid,jsonb,text,timestamptz,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.business_discard_experience_draft(uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.business_unpublish_experience_to_draft(uuid,timestamptz) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.ari_execute_experience_operation(uuid,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.issue_1973_read_experience_graph(uuid) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.issue_1973_create_snap_proposals(uuid,jsonb) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.issue_1973_current_experience_payload(uuid) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.biz_create_experience(uuid,jsonb,boolean) TO authenticated,service_role;
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
