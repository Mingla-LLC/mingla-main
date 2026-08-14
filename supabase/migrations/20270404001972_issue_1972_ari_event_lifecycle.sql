-- Issue #1972 / #424 Pass 4 B1 — canonical event lifecycle + Ari exactly-once.
-- APPLY SURGICALLY: linked migration history is drifted (COMMS-0034).
BEGIN;

-- Pending proposals and execution transitions are Edge-server state, not a
-- user-writable table. Existing un-attested work is expired during rollout so
-- a row forged before this migration cannot be promoted afterward.
ALTER TABLE public.agent_pending_actions
  ADD COLUMN IF NOT EXISTS server_proposed_at timestamptz,
  ADD COLUMN IF NOT EXISTS execution_attested_at timestamptz;
UPDATE public.agent_pending_actions SET status='expired'
WHERE status IN('pending','executing') AND server_proposed_at IS NULL;
REVOKE INSERT,UPDATE,DELETE ON public.agent_pending_actions FROM authenticated;
GRANT SELECT ON public.agent_pending_actions TO authenticated;
GRANT ALL ON public.agent_pending_actions TO service_role;

-- ---------------------------------------------------------------------------
-- 1. Generic confirmed-operation receipts (shared with later Ari domains).
-- ---------------------------------------------------------------------------
CREATE TABLE public.agent_operation_receipts (
  operation_id uuid PRIMARY KEY
    REFERENCES public.agent_pending_actions(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tool_name text NOT NULL CHECK (length(btrim(tool_name)) BETWEEN 1 AND 100),
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  result jsonb NOT NULL,
  completed_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.agent_operation_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_operation_receipts FORCE ROW LEVEL SECURITY;
CREATE POLICY agent_operation_receipts_owner_read
  ON public.agent_operation_receipts FOR SELECT TO authenticated
  USING (user_id = auth.uid());
REVOKE ALL ON TABLE public.agent_operation_receipts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.agent_operation_receipts TO authenticated;
GRANT ALL ON TABLE public.agent_operation_receipts TO service_role;

CREATE OR REPLACE FUNCTION public.agent_operation_receipt_begin(
  p_operation_id uuid,
  p_tool_name text,
  p_args jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_pending public.agent_pending_actions%ROWTYPE;
  v_receipt public.agent_operation_receipts%ROWTYPE;
  v_hash text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF p_operation_id IS NULL OR NULLIF(btrim(p_tool_name), '') IS NULL OR p_args IS NULL THEN
    RAISE EXCEPTION 'invalid_operation_receipt_request';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_operation_id::text, 1972));
  SELECT * INTO v_pending FROM public.agent_pending_actions
   WHERE id = p_operation_id FOR UPDATE;
  IF NOT FOUND OR v_pending.user_id <> v_uid THEN
    RAISE EXCEPTION 'operation_not_found';
  END IF;
  IF v_pending.status <> 'executing' OR v_pending.server_proposed_at IS NULL
     OR v_pending.execution_attested_at IS NULL THEN
    RAISE EXCEPTION 'operation_not_executing';
  END IF;
  IF v_pending.tool_name <> p_tool_name OR v_pending.tool_args IS DISTINCT FROM p_args THEN
    RAISE EXCEPTION 'operation_binding_mismatch';
  END IF;

  v_hash := encode(extensions.digest(
    convert_to(p_tool_name || ':' || p_args::text, 'UTF8'), 'sha256'
  ), 'hex');
  SELECT * INTO v_receipt FROM public.agent_operation_receipts
   WHERE operation_id = p_operation_id;
  IF FOUND THEN
    IF v_receipt.user_id <> v_uid OR v_receipt.tool_name <> p_tool_name
       OR v_receipt.request_hash <> v_hash THEN
      RAISE EXCEPTION 'idempotency_conflict';
    END IF;
    RETURN jsonb_build_object('replay', true, 'result', v_receipt.result,
      'request_hash', v_hash);
  END IF;

  -- Transaction-local proof: complete cannot be called as a separate RPC to
  -- fabricate a receipt. Domain wrappers call begin -> mutate -> complete in
  -- one database transaction.
  PERFORM set_config('mingla.agent_operation_id', p_operation_id::text, true);
  PERFORM set_config('mingla.agent_operation_hash', v_hash, true);
  RETURN jsonb_build_object('replay', false, 'request_hash', v_hash);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.agent_operation_receipt_complete(
  p_operation_id uuid,
  p_tool_name text,
  p_args jsonb,
  p_result jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_pending public.agent_pending_actions%ROWTYPE;
  v_hash text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  v_hash := encode(extensions.digest(
    convert_to(p_tool_name || ':' || p_args::text, 'UTF8'), 'sha256'
  ), 'hex');
  IF current_setting('mingla.agent_operation_id', true) IS DISTINCT FROM p_operation_id::text
     OR current_setting('mingla.agent_operation_hash', true) IS DISTINCT FROM v_hash THEN
    RAISE EXCEPTION 'operation_receipt_transaction_required';
  END IF;
  SELECT * INTO v_pending FROM public.agent_pending_actions
   WHERE id = p_operation_id FOR UPDATE;
  IF NOT FOUND OR v_pending.user_id <> v_uid OR v_pending.status <> 'executing'
     OR v_pending.server_proposed_at IS NULL OR v_pending.execution_attested_at IS NULL
     OR v_pending.tool_name <> p_tool_name OR v_pending.tool_args IS DISTINCT FROM p_args THEN
    RAISE EXCEPTION 'operation_binding_mismatch';
  END IF;

  INSERT INTO public.agent_operation_receipts(
    operation_id, user_id, tool_name, request_hash, result
  ) VALUES (p_operation_id, v_uid, p_tool_name, v_hash, COALESCE(p_result, 'null'::jsonb));
  RETURN p_result;
END;
$fn$;

REVOKE ALL ON FUNCTION public.agent_operation_receipt_begin(uuid,text,jsonb),
  public.agent_operation_receipt_complete(uuid,text,jsonb,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.agent_operation_receipt_begin(uuid,text,jsonb),
  public.agent_operation_receipt_complete(uuid,text,jsonb,jsonb) TO authenticated, service_role;

CREATE TABLE public.event_cover_selections(
  selection_ref text PRIMARY KEY CHECK(length(selection_ref) BETWEEN 8 AND 128),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  media_url text,
  media_type text,
  poster_url text,
  provider text,
  source_url text,
  credit text,
  credit_url text,
  alt text,
  expires_at timestamptz NOT NULL DEFAULT now()+interval '30 minutes',
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.event_cover_selections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_cover_selections FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.event_cover_selections FROM PUBLIC,anon,authenticated;
GRANT ALL ON TABLE public.event_cover_selections TO service_role;

CREATE OR REPLACE FUNCTION public.business_register_event_cover_selection(
  p_event_id uuid,p_selection_ref text,p_url text,p_type text,p_poster_url text,
  p_provider text DEFAULT NULL,p_source_url text DEFAULT NULL,p_credit text DEFAULT NULL,
  p_credit_url text DEFAULT NULL,p_alt text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_uid uuid:=auth.uid();v_brand_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated';END IF;
  IF length(COALESCE(p_selection_ref,'')) NOT BETWEEN 8 AND 128 THEN RAISE EXCEPTION 'cover_selection_invalid';END IF;
  SELECT brand_id INTO v_brand_id FROM public.events WHERE id=p_event_id AND event_type='event' AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'event_not_found';END IF;
  IF public.biz_brand_effective_rank(v_brand_id,v_uid)<public.biz_role_rank('event_manager') THEN RAISE EXCEPTION 'insufficient_event_permission';END IF;
  PERFORM public.assert_cover_media_triplet(NULLIF(p_url,''),NULLIF(p_type,''),NULLIF(p_poster_url,''));
  INSERT INTO public.event_cover_selections(selection_ref,user_id,event_id,media_url,media_type,poster_url,provider,source_url,credit,credit_url,alt)
  VALUES(p_selection_ref,v_uid,p_event_id,NULLIF(p_url,''),NULLIF(p_type,''),NULLIF(p_poster_url,''),NULLIF(p_provider,''),NULLIF(p_source_url,''),NULLIF(p_credit,''),NULLIF(p_credit_url,''),NULLIF(p_alt,''));
  RETURN jsonb_build_object('selection_ref',p_selection_ref,'event_id',p_event_id,'expires_at',now()+interval '30 minutes');
END;$fn$;
REVOKE ALL ON FUNCTION public.business_register_event_cover_selection(uuid,text,text,text,text,text,text,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.business_register_event_cover_selection(uuid,text,text,text,text,text,text,text,text,text) TO authenticated,service_role;

-- ---------------------------------------------------------------------------
-- 2. Rebuild the complete editable draft payload from canonical live rows.
--    No orders, attendees, payments, scans, PII, or audit history are copied.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.business_event_draft_payload_from_graph(
  p_event_id uuid
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_event public.events%ROWTYPE;
  v_business jsonb;
  v_tickets jsonb;
  v_dates jsonb;
  v_when_mode text;
  v_when jsonb;
  v_multi jsonb;
BEGIN
  SELECT * INTO v_event FROM public.events
   WHERE id = p_event_id AND deleted_at IS NULL;
  IF NOT FOUND OR v_event.event_type <> 'event' THEN
    RAISE EXCEPTION 'event_not_found';
  END IF;
  IF public.biz_brand_effective_rank(v_event.brand_id, auth.uid())
       < public.biz_role_rank('scanner') THEN
    RAISE EXCEPTION 'insufficient_event_permission';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', tt.id::text,
    'name', tt.name,
    'description', tt.description,
    'priceGbp', CASE WHEN tt.price_cents IS NULL THEN NULL ELSE tt.price_cents / 100.0 END,
    'currency', btrim(tt.currency::text),
    'capacity', tt.quantity_total,
    'isFree', tt.is_free,
    'isUnlimited', tt.is_unlimited,
    'visibility', CASE WHEN tt.is_disabled THEN 'disabled' WHEN tt.is_hidden THEN 'hidden' ELSE 'public' END,
    'displayOrder', tt.display_order,
    'approvalRequired', tt.requires_approval,
    'passwordProtected', tt.password_protected,
    'passwordConfigured', tt.password_hash IS NOT NULL,
    'password', NULL,
    'waitlistEnabled', tt.waitlist_enabled,
    'minPurchaseQty', tt.min_purchase_qty,
    'maxPurchaseQty', tt.max_purchase_qty,
    'allowTransfers', tt.allow_transfers,
    'saleStartAt', tt.sale_start_at,
    'saleEndAt', tt.sale_end_at,
    'availableAt', CASE WHEN tt.available_online AND tt.available_in_person THEN 'both'
      WHEN tt.available_online THEN 'online' ELSE 'door' END
  ) ORDER BY tt.display_order, tt.created_at), '[]'::jsonb)
  INTO v_tickets FROM public.ticket_types tt
  WHERE tt.event_id = p_event_id AND tt.deleted_at IS NULL;
  IF v_event.status='draft' THEN
    v_tickets:=COALESCE(v_event.theme#>'{business_draft,tickets}',v_tickets);
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'date', to_char(ed.start_at AT TIME ZONE v_event.timezone, 'YYYY-MM-DD'),
    'startTime', to_char(ed.start_at AT TIME ZONE v_event.timezone, 'HH24:MI'),
    'endTime', to_char(ed.end_at AT TIME ZONE v_event.timezone, 'HH24:MI')
  ) ORDER BY ed.start_at), '[]'::jsonb)
  INTO v_dates FROM public.event_dates ed WHERE ed.event_id = p_event_id;

  v_when_mode := CASE WHEN v_event.is_multi_date THEN 'multi_date'
    WHEN v_event.is_recurring THEN 'recurring' ELSE 'single' END;
  SELECT jsonb_build_object(
    'date', to_char(ed.start_at AT TIME ZONE v_event.timezone, 'YYYY-MM-DD'),
    'doorsOpen', to_char(ed.start_at AT TIME ZONE v_event.timezone, 'HH24:MI'),
    'endsAt', to_char(ed.end_at AT TIME ZONE v_event.timezone, 'HH24:MI'),
    'timezone', v_event.timezone
  ) INTO v_when FROM public.event_dates ed
  WHERE ed.event_id = p_event_id AND ed.is_master ORDER BY ed.start_at LIMIT 1;
  v_multi := CASE WHEN v_when_mode = 'multi_date' THEN v_dates ELSE NULL END;

  v_business := COALESCE(v_event.theme->'business_draft', v_event.theme->'business_event', '{}'::jsonb)
    || jsonb_build_object(
      'schemaVersion', 1,
      'legacyLocalDraftId', NULL,
      'format', CASE WHEN v_event.is_online THEN 'online' ELSE 'in_person' END,
      'partyTypes', to_jsonb(COALESCE(v_event.party_types, ARRAY[]::text[])),
      'vibeTags', to_jsonb(COALESCE(v_event.vibe_tags, ARRAY[]::text[])),
      'musicGenres', to_jsonb(COALESCE(v_event.music_genres, ARRAY[]::text[])),
      'city', v_event.city,
      'locationGeo', CASE WHEN v_event.location_geo IS NULL THEN NULL ELSE
        jsonb_build_object('lng', (v_event.location_geo)[0], 'lat', (v_event.location_geo)[1]) END,
      'requestedVisibility', CASE v_event.visibility WHEN 'hidden' THEN 'unlisted'
        WHEN 'private' THEN 'private' ELSE 'public' END,
      'coverHue', COALESCE((v_event.theme->>'coverHue')::numeric, 25),
      'coverProvider', jsonb_build_object(
        'provider', v_event.cover_media_provider,
        'sourceUrl', v_event.cover_media_source_url,
        'credit', v_event.cover_media_credit,
        'creditUrl', v_event.cover_media_credit_url,
        'alt', v_event.cover_media_alt),
      'currency', btrim(v_event.currency::text),
      'whenMode', v_when_mode,
      'when', v_when,
      'recurrenceRule', v_event.recurrence_rules,
      'multiDates', v_multi,
      'location', jsonb_build_object('venueName', v_event.location_text, 'address', NULL),
      'tickets', v_tickets,
      'lastStepReached', 6,
      'clientRevision', COALESCE((COALESCE(v_event.theme->'business_draft','{}'::jsonb)->>'clientRevision')::integer, 0)
    );

  RETURN to_jsonb(v_event) || jsonb_build_object(
    'theme', (COALESCE(v_event.theme, '{}'::jsonb) - 'business_event' - 'business_draft')
      || jsonb_build_object('business_draft', v_business),
    'visibility', 'draft', 'status', 'draft'
  );
END;
$fn$;
REVOKE ALL ON FUNCTION public.business_event_draft_payload_from_graph(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.business_event_draft_payload_from_graph(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.business_list_events_for_ari(
  p_brand_ids uuid[],
  p_limit integer DEFAULT 20
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
  SELECT COALESCE(jsonb_agg(row_payload ORDER BY updated_at DESC),'[]'::jsonb)
  FROM (
    SELECT e.updated_at, jsonb_build_object(
      'id',e.id,'brand_id',e.brand_id,'event_type',e.event_type,'title',e.title,
      'status',e.status,'visibility',e.visibility,'timezone',e.timezone,'city',e.city,
      'location_text',e.location_text,'is_online',e.is_online,'online_url',e.online_url,
      'cover',jsonb_build_object('url',e.cover_media_url,'poster_url',e.cover_media_poster_url,'type',e.cover_media_type),
      'when',CASE WHEN e.status='draft' THEN COALESCE(e.theme#>'{business_draft,when}','null'::jsonb)
        ELSE dates.rows END,
      'when_mode',CASE WHEN e.status='draft' THEN COALESCE(e.theme#>>'{business_draft,whenMode}','single')
        WHEN e.is_multi_date THEN 'multi_date' WHEN e.is_recurring THEN 'recurring' ELSE 'single' END,
      'tickets',jsonb_build_object('count',tickets.tier_count,'capacity',tickets.capacity,'free',tickets.all_free),
      'client_revision',COALESCE((e.theme#>>'{business_draft,clientRevision}')::integer,0),
      'updated_at',e.updated_at
    ) AS row_payload
    FROM public.events e
    LEFT JOIN LATERAL (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('start_at',ed.start_at,'end_at',ed.end_at,'is_master',ed.is_master) ORDER BY ed.start_at),'[]'::jsonb) rows
      FROM public.event_dates ed WHERE ed.event_id=e.id
    ) dates ON true
    LEFT JOIN LATERAL (
      SELECT count(*)::integer tier_count,sum(tt.quantity_total)::integer capacity,bool_and(tt.is_free) all_free
      FROM public.ticket_types tt WHERE tt.event_id=e.id AND tt.deleted_at IS NULL
    ) tickets ON true
    WHERE e.brand_id=ANY(COALESCE(p_brand_ids,ARRAY[]::uuid[])) AND e.event_type='event' AND e.deleted_at IS NULL
      AND public.biz_brand_effective_rank(e.brand_id,auth.uid())>=public.biz_role_rank('scanner')
    ORDER BY e.updated_at DESC LIMIT LEAST(GREATEST(COALESCE(p_limit,20),1),50)
  ) scoped;
$fn$;
REVOKE ALL ON FUNCTION public.business_list_events_for_ari(uuid[],integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.business_list_events_for_ari(uuid[],integer) TO authenticated,service_role;

-- ---------------------------------------------------------------------------
-- 3. Canonical manual + Ari draft owners.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.business_create_event_draft(
  p_brand_id uuid,
  p_payload jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_event public.events%ROWTYPE;
  v_title text;
  v_slug text;
  v_geo point;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF public.biz_brand_effective_rank(p_brand_id, v_uid) < public.biz_role_rank('event_manager') THEN
    RAISE EXCEPTION 'insufficient_event_permission';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.brands WHERE id=p_brand_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'brand_not_found';
  END IF;
  v_title := COALESCE(NULLIF(btrim(p_payload->>'title'), ''), 'Untitled draft');
  v_slug := 'draft-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 16);
  IF NULLIF(p_payload->>'location_geo','') IS NOT NULL THEN
    v_geo := (p_payload->>'location_geo')::point;
  END IF;
  PERFORM public.assert_cover_media_triplet(
    NULLIF(p_payload->>'cover_media_url',''), NULLIF(p_payload->>'cover_media_type',''),
    NULLIF(p_payload->>'cover_media_poster_url',''));

  INSERT INTO public.events(
    brand_id, created_by, event_type, title, slug, description, location_text,
    online_url, cover_media_url, cover_media_poster_url, cover_media_type,
    cover_media_provider, cover_media_source_url, cover_media_credit,
    cover_media_credit_url, cover_media_alt, cover_media_gallery, currency,
    is_online, is_recurring, is_multi_date, recurrence_rules, theme,
    visibility, status, timezone, party_types, vibe_tags, music_genres, city,
    location_geo, pass_tax, pass_mingla_fee, pass_service_fee,
    theme_color_override, theme_font_override, theme_animation_override
  ) VALUES (
    p_brand_id, v_uid, 'event', v_title, v_slug,
    NULLIF(p_payload->>'description',''), NULLIF(p_payload->>'location_text',''),
    NULLIF(p_payload->>'online_url',''), NULLIF(p_payload->>'cover_media_url',''),
    NULLIF(p_payload->>'cover_media_poster_url',''), NULLIF(p_payload->>'cover_media_type',''),
    NULLIF(p_payload->>'cover_media_provider',''), NULLIF(p_payload->>'cover_media_source_url',''),
    NULLIF(p_payload->>'cover_media_credit',''), NULLIF(p_payload->>'cover_media_credit_url',''),
    NULLIF(p_payload->>'cover_media_alt',''), COALESCE(p_payload->'cover_media_gallery','[]'::jsonb),
    NULLIF(p_payload->>'currency','')::character(3), COALESCE((p_payload->>'is_online')::boolean,false),
    COALESCE((p_payload->>'is_recurring')::boolean,false), COALESCE((p_payload->>'is_multi_date')::boolean,false),
    p_payload->'recurrence_rules', COALESCE(p_payload->'theme','{}'::jsonb), 'draft', 'draft',
    COALESCE(NULLIF(p_payload->>'timezone',''),'UTC'),
    COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_payload->'party_types','[]'::jsonb))),ARRAY[]::text[]),
    COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_payload->'vibe_tags','[]'::jsonb))),ARRAY[]::text[]),
    COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_payload->'music_genres','[]'::jsonb))),ARRAY[]::text[]),
    NULLIF(p_payload->>'city',''), v_geo,
    (p_payload->>'pass_tax')::boolean, (p_payload->>'pass_mingla_fee')::boolean,
    (p_payload->>'pass_service_fee')::boolean, NULLIF(p_payload->>'theme_color_override',''),
    NULLIF(p_payload->>'theme_font_override',''), NULLIF(p_payload->>'theme_animation_override','')
  ) RETURNING * INTO v_event;
  RETURN jsonb_build_object('event', to_jsonb(v_event), 'client_revision',
    COALESCE((p_payload#>>'{theme,business_draft,clientRevision}')::integer,0));
END;
$fn$;

CREATE OR REPLACE FUNCTION public.business_update_event_draft(
  p_event_id uuid,
  p_payload jsonb,
  p_client_revision integer DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
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
  IF p_client_revision IS NOT NULL AND p_client_revision < v_stored_revision THEN
    RAISE EXCEPTION 'stale_client_revision';
  END IF;
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
    recurrence_rules=p_payload->'recurrence_rules', theme=COALESCE(p_payload->'theme','{}'::jsonb),
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
    COALESCE((p_payload#>>'{theme,business_draft,clientRevision}')::integer,p_client_revision,v_stored_revision));
END;
$fn$;

REVOKE ALL ON FUNCTION public.business_create_event_draft(uuid,jsonb),
  public.business_update_event_draft(uuid,jsonb,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.business_create_event_draft(uuid,jsonb),
  public.business_update_event_draft(uuid,jsonb,integer) TO authenticated, service_role;

-- One durable owner for the fields exposed by EditPublishedScreen that were
-- previously acknowledged only in Zustand. Specialized when/taxonomy/cover/
-- theme/pricing owners remain authoritative and are invoked separately.
CREATE OR REPLACE FUNCTION public.business_update_live_event(
  p_event_id uuid,
  p_patch jsonb,
  p_reason text,
  p_client_revision integer DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE
  v_uid uuid:=auth.uid();
  v_event public.events%ROWTYPE;
  v_ticket jsonb;
  v_ticket_id uuid;
  v_sold integer;
  v_seen uuid[]:=ARRAY[]::uuid[];
  v_settings jsonb;
  v_tickets jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated';END IF;
  IF length(btrim(COALESCE(p_reason,''))) NOT BETWEEN 10 AND 200 THEN RAISE EXCEPTION 'invalid_edit_reason';END IF;
  SELECT * INTO v_event FROM public.events WHERE id=p_event_id FOR UPDATE;
  IF NOT FOUND OR v_event.deleted_at IS NOT NULL OR v_event.event_type<>'event' THEN RAISE EXCEPTION 'event_not_found';END IF;
  IF v_event.status NOT IN('scheduled','live') THEN RAISE EXCEPTION 'event_not_editable_status';END IF;
  IF public.biz_brand_effective_rank(v_event.brand_id,v_uid)<public.biz_role_rank('event_manager') THEN RAISE EXCEPTION 'insufficient_event_permission';END IF;

  v_settings:=COALESCE(v_event.theme#>'{business_event,settings}','{}'::jsonb);
  IF p_patch ? 'hideAddressUntilTicket' THEN v_settings:=jsonb_set(v_settings,'{hideAddressUntilTicket}',p_patch->'hideAddressUntilTicket',true);END IF;
  IF p_patch ? 'requireApproval' THEN v_settings:=jsonb_set(v_settings,'{requireApproval}',p_patch->'requireApproval',true);END IF;
  IF p_patch ? 'allowTransfers' THEN v_settings:=jsonb_set(v_settings,'{allowTransfers}',p_patch->'allowTransfers',true);END IF;
  IF p_patch ? 'passwordProtected' THEN v_settings:=jsonb_set(v_settings,'{passwordProtected}',p_patch->'passwordProtected',true);END IF;
  IF p_patch ? 'inPersonPaymentsEnabled' THEN v_settings:=jsonb_set(v_settings,'{inPersonPaymentsEnabled}',p_patch->'inPersonPaymentsEnabled',true);END IF;

  UPDATE public.events SET
    title=CASE WHEN p_patch ? 'name' THEN NULLIF(btrim(p_patch->>'name'),'') ELSE title END,
    description=CASE WHEN p_patch ? 'description' THEN NULLIF(p_patch->>'description','') ELSE description END,
    location_text=CASE WHEN p_patch ? 'address' THEN NULLIF(p_patch->>'address','') WHEN p_patch ? 'venueName' THEN NULLIF(p_patch->>'venueName','') ELSE location_text END,
    online_url=CASE WHEN p_patch ? 'onlineUrl' THEN NULLIF(p_patch->>'onlineUrl','') ELSE online_url END,
    is_online=CASE WHEN p_patch ? 'format' THEN p_patch->>'format'='online' ELSE is_online END,
    visibility=CASE WHEN p_patch ? 'visibility' THEN CASE p_patch->>'visibility' WHEN 'unlisted' THEN 'hidden' WHEN 'private' THEN 'private' ELSE 'public' END ELSE visibility END,
    theme=jsonb_set(
      jsonb_set(COALESCE(theme,'{}'::jsonb),'{business_event,settings}',v_settings,true),
      '{coverHue}',COALESCE(p_patch->'coverHue',theme->'coverHue','25'::jsonb),true),
    updated_at=now()
  WHERE id=p_event_id RETURNING * INTO v_event;

  IF p_patch ? 'tickets' THEN
    IF jsonb_typeof(p_patch->'tickets') IS DISTINCT FROM 'array' OR jsonb_array_length(p_patch->'tickets')=0 THEN RAISE EXCEPTION 'event_ticket_required';END IF;
    FOR v_ticket IN SELECT value FROM jsonb_array_elements(p_patch->'tickets') LOOP
      v_ticket_id:=CASE WHEN COALESCE(v_ticket->>'id','')~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN (v_ticket->>'id')::uuid ELSE gen_random_uuid() END;
      SELECT count(*) INTO v_sold FROM public.tickets WHERE ticket_type_id=v_ticket_id AND status NOT IN('void','refunded');
      IF EXISTS(SELECT 1 FROM public.ticket_types WHERE id=v_ticket_id AND event_id=p_event_id AND deleted_at IS NULL) THEN
        IF v_sold>0 AND EXISTS(SELECT 1 FROM public.ticket_types tt WHERE tt.id=v_ticket_id AND (tt.price_cents IS DISTINCT FROM round(COALESCE((v_ticket->>'priceGbp')::numeric,0)*100)::integer OR COALESCE((v_ticket->>'capacity')::integer,tt.quantity_total)<v_sold)) THEN RAISE EXCEPTION 'ticket_change_with_sales';END IF;
        UPDATE public.ticket_types SET
          name=COALESCE(NULLIF(btrim(v_ticket->>'name'),''),name), description=NULLIF(v_ticket->>'description',''),
          price_cents=round(COALESCE((v_ticket->>'priceGbp')::numeric,0)*100)::integer,
          quantity_total=CASE WHEN COALESCE((v_ticket->>'isUnlimited')::boolean,false) THEN NULL ELSE (v_ticket->>'capacity')::integer END,
          is_unlimited=COALESCE((v_ticket->>'isUnlimited')::boolean,false),is_free=COALESCE((v_ticket->>'isFree')::boolean,false),
          is_hidden=COALESCE(v_ticket->>'visibility','public')='hidden',is_disabled=COALESCE(v_ticket->>'visibility','public')='disabled',
          requires_approval=COALESCE((v_ticket->>'approvalRequired')::boolean,false),allow_transfers=COALESCE((v_ticket->>'allowTransfers')::boolean,true),
          password_protected=COALESCE((v_ticket->>'passwordProtected')::boolean,false),waitlist_enabled=COALESCE((v_ticket->>'waitlistEnabled')::boolean,false),
          min_purchase_qty=COALESCE((v_ticket->>'minPurchaseQty')::integer,1),max_purchase_qty=NULLIF(v_ticket->>'maxPurchaseQty','')::integer,
          sale_start_at=NULLIF(v_ticket->>'saleStartAt','')::timestamptz,sale_end_at=NULLIF(v_ticket->>'saleEndAt','')::timestamptz,
          available_online=COALESCE(v_ticket->>'availableAt','both') IN('online','both'),available_in_person=COALESCE(v_ticket->>'availableAt','both') IN('door','both'),
          display_order=COALESCE((v_ticket->>'displayOrder')::integer,0),updated_at=now()
        WHERE id=v_ticket_id;
      ELSE
        INSERT INTO public.ticket_types(id,event_id,name,description,price_cents,currency,quantity_total,is_unlimited,is_free,is_hidden,is_disabled,
          requires_approval,allow_transfers,password_protected,waitlist_enabled,min_purchase_qty,max_purchase_qty,sale_start_at,sale_end_at,
          available_online,available_in_person,display_order)
        VALUES(v_ticket_id,p_event_id,COALESCE(NULLIF(btrim(v_ticket->>'name'),''),'Ticket'),NULLIF(v_ticket->>'description',''),
          round(COALESCE((v_ticket->>'priceGbp')::numeric,0)*100)::integer,v_event.currency,
          CASE WHEN COALESCE((v_ticket->>'isUnlimited')::boolean,false) THEN NULL ELSE (v_ticket->>'capacity')::integer END,
          COALESCE((v_ticket->>'isUnlimited')::boolean,false),COALESCE((v_ticket->>'isFree')::boolean,false),
          COALESCE(v_ticket->>'visibility','public')='hidden',COALESCE(v_ticket->>'visibility','public')='disabled',
          COALESCE((v_ticket->>'approvalRequired')::boolean,false),COALESCE((v_ticket->>'allowTransfers')::boolean,true),
          COALESCE((v_ticket->>'passwordProtected')::boolean,false),COALESCE((v_ticket->>'waitlistEnabled')::boolean,false),
          COALESCE((v_ticket->>'minPurchaseQty')::integer,1),NULLIF(v_ticket->>'maxPurchaseQty','')::integer,
          NULLIF(v_ticket->>'saleStartAt','')::timestamptz,NULLIF(v_ticket->>'saleEndAt','')::timestamptz,
          COALESCE(v_ticket->>'availableAt','both') IN('online','both'),COALESCE(v_ticket->>'availableAt','both') IN('door','both'),
          COALESCE((v_ticket->>'displayOrder')::integer,0));
      END IF;
      v_seen:=array_append(v_seen,v_ticket_id);
    END LOOP;
    IF EXISTS(SELECT 1 FROM public.ticket_types tt JOIN public.tickets t ON t.ticket_type_id=tt.id WHERE tt.event_id=p_event_id AND tt.deleted_at IS NULL AND NOT(tt.id=ANY(v_seen)) AND t.status NOT IN('void','refunded')) THEN RAISE EXCEPTION 'ticket_delete_with_sales';END IF;
    UPDATE public.ticket_types SET deleted_at=now(),is_disabled=true,updated_at=now() WHERE event_id=p_event_id AND deleted_at IS NULL AND NOT(id=ANY(v_seen));
  END IF;

  IF p_patch ? 'privateGuestList' OR p_patch ? 'hideRemainingCount' THEN
    PERFORM public.biz_set_event_guest_privacy(p_event_id,
      COALESCE((p_patch->>'privateGuestList')::boolean,(v_settings->>'privateGuestList')::boolean,false),
      COALESCE((p_patch->>'hideRemainingCount')::boolean,(v_settings->>'hideRemainingCount')::boolean,false));
    SELECT * INTO v_event FROM public.events WHERE id=p_event_id;
  END IF;
  SELECT COALESCE(jsonb_agg(to_jsonb(tt) ORDER BY tt.display_order,tt.created_at),'[]'::jsonb) INTO v_tickets FROM public.ticket_types tt WHERE tt.event_id=p_event_id AND tt.deleted_at IS NULL;
  RETURN jsonb_build_object('event',to_jsonb(v_event),'tickets',v_tickets,'client_revision',p_client_revision);
END;$fn$;
REVOKE ALL ON FUNCTION public.business_update_live_event(uuid,jsonb,text,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.business_update_live_event(uuid,jsonb,text,integer) TO authenticated,service_role;

-- ---------------------------------------------------------------------------
-- 4. Unpublish / duplicate / cover owners.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.business_unpublish_event_to_draft(p_event_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_uid uuid:=auth.uid();v_event public.events%ROWTYPE;v_payload jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated';END IF;
  SELECT * INTO v_event FROM public.events WHERE id=p_event_id FOR UPDATE;
  IF NOT FOUND OR v_event.deleted_at IS NOT NULL OR v_event.event_type<>'event' THEN RAISE EXCEPTION 'event_not_found';END IF;
  IF v_event.status<>'scheduled' THEN RAISE EXCEPTION 'event_not_unpublishable';END IF;
  IF public.biz_brand_effective_rank(v_event.brand_id,v_uid)<public.biz_role_rank('event_manager') THEN RAISE EXCEPTION 'insufficient_event_permission';END IF;
  IF NOT EXISTS(SELECT 1 FROM public.event_dates WHERE event_id=p_event_id AND start_at>now()) THEN RAISE EXCEPTION 'event_not_future';END IF;
  IF EXISTS(SELECT 1 FROM public.orders WHERE event_id=p_event_id AND payment_status IN('paid','partial_refund'))
    OR EXISTS(SELECT 1 FROM public.tickets WHERE event_id=p_event_id)
    OR EXISTS(SELECT 1 FROM public.event_rsvps WHERE event_id=p_event_id)
    OR EXISTS(SELECT 1 FROM public.event_rsvp_contributions WHERE event_id=p_event_id)
  THEN RAISE EXCEPTION 'event_has_dependencies';END IF;
  v_payload:=public.business_event_draft_payload_from_graph(p_event_id);
  PERFORM set_config('mingla.business_publish_event_draft','on',true);
  UPDATE public.events SET status='draft',visibility='draft',published_at=NULL,
    show_on_discover=false,show_in_swipeable_deck=false,theme=v_payload->'theme',updated_at=now()
  WHERE id=p_event_id RETURNING * INTO v_event;
  DELETE FROM public.event_dates WHERE event_id=p_event_id;
  RETURN jsonb_build_object('event',to_jsonb(v_event),'client_revision',
    COALESCE((v_payload#>>'{theme,business_draft,clientRevision}')::integer,0));
END;$fn$;

CREATE OR REPLACE FUNCTION public.business_duplicate_event_as_draft(p_event_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_uid uuid:=auth.uid();v_src public.events%ROWTYPE;v_new public.events%ROWTYPE;v_payload jsonb;v_title text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated';END IF;
  SELECT * INTO v_src FROM public.events WHERE id=p_event_id AND deleted_at IS NULL FOR SHARE;
  IF NOT FOUND OR v_src.event_type<>'event' THEN RAISE EXCEPTION 'event_not_found';END IF;
  IF public.biz_brand_effective_rank(v_src.brand_id,v_uid)<public.biz_role_rank('event_manager') THEN RAISE EXCEPTION 'insufficient_event_permission';END IF;
  v_payload:=public.business_event_draft_payload_from_graph(p_event_id);
  v_title:=left(v_src.title||' (copy)',120);
  INSERT INTO public.events(brand_id,created_by,event_type,title,slug,description,location_text,location_geo,online_url,is_online,
    is_recurring,is_multi_date,recurrence_rules,cover_media_url,cover_media_poster_url,cover_media_type,cover_media_provider,
    cover_media_source_url,cover_media_credit,cover_media_credit_url,cover_media_alt,cover_media_gallery,theme,currency,
    visibility,status,timezone,party_types,vibe_tags,music_genres,city,pass_tax,pass_mingla_fee,pass_service_fee,
    theme_color_override,theme_font_override,theme_animation_override)
  VALUES(v_src.brand_id,v_uid,'event',v_title,'draft-'||substr(replace(gen_random_uuid()::text,'-',''),1,16),v_src.description,
    v_src.location_text,v_src.location_geo,v_src.online_url,v_src.is_online,v_src.is_recurring,v_src.is_multi_date,v_src.recurrence_rules,
    v_src.cover_media_url,v_src.cover_media_poster_url,v_src.cover_media_type,v_src.cover_media_provider,v_src.cover_media_source_url,
    v_src.cover_media_credit,v_src.cover_media_credit_url,v_src.cover_media_alt,v_src.cover_media_gallery,
    jsonb_set(v_payload->'theme','{business_draft,clientRevision}','0'::jsonb,true),v_src.currency,'draft','draft',v_src.timezone,
    v_src.party_types,v_src.vibe_tags,v_src.music_genres,v_src.city,v_src.pass_tax,v_src.pass_mingla_fee,v_src.pass_service_fee,
    v_src.theme_color_override,v_src.theme_font_override,v_src.theme_animation_override)
  RETURNING * INTO v_new;
  RETURN jsonb_build_object('event',to_jsonb(v_new),'client_revision',0);
END;$fn$;

CREATE OR REPLACE FUNCTION public.business_set_event_cover_media(
  p_event_id uuid,p_selection_ref text,p_url text,p_type text,p_poster_url text,
  p_provider text DEFAULT NULL,p_source_url text DEFAULT NULL,p_credit text DEFAULT NULL,
  p_credit_url text DEFAULT NULL,p_alt text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_uid uuid:=auth.uid();v_event public.events%ROWTYPE;v_selection public.event_cover_selections%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated';END IF;
  IF p_selection_ref IS NULL THEN RAISE EXCEPTION 'cover_selection_required';END IF;
  SELECT * INTO v_event FROM public.events WHERE id=p_event_id FOR UPDATE;
  IF NOT FOUND OR v_event.deleted_at IS NOT NULL OR v_event.event_type<>'event' THEN RAISE EXCEPTION 'event_not_found';END IF;
  IF public.biz_brand_effective_rank(v_event.brand_id,v_uid)<public.biz_role_rank('event_manager') THEN RAISE EXCEPTION 'insufficient_event_permission';END IF;
  SELECT * INTO v_selection FROM public.event_cover_selections
  WHERE selection_ref=p_selection_ref AND user_id=v_uid AND event_id=p_event_id
    AND consumed_at IS NULL AND expires_at>now() FOR UPDATE;
  IF NOT FOUND OR v_selection.media_url IS DISTINCT FROM NULLIF(p_url,'')
    OR v_selection.media_type IS DISTINCT FROM NULLIF(p_type,'')
    OR v_selection.poster_url IS DISTINCT FROM NULLIF(p_poster_url,'')
    OR v_selection.provider IS DISTINCT FROM NULLIF(p_provider,'')
    OR v_selection.source_url IS DISTINCT FROM NULLIF(p_source_url,'')
    OR v_selection.credit IS DISTINCT FROM NULLIF(p_credit,'')
    OR v_selection.credit_url IS DISTINCT FROM NULLIF(p_credit_url,'')
    OR v_selection.alt IS DISTINCT FROM NULLIF(p_alt,'')
  THEN RAISE EXCEPTION 'cover_selection_unverified';END IF;
  PERFORM public.assert_cover_media_triplet(NULLIF(p_url,''),NULLIF(p_type,''),NULLIF(p_poster_url,''));
  UPDATE public.events SET cover_media_url=NULLIF(p_url,''),cover_media_type=NULLIF(p_type,''),
    cover_media_poster_url=NULLIF(p_poster_url,''),cover_media_provider=NULLIF(p_provider,''),
    cover_media_source_url=NULLIF(p_source_url,''),cover_media_credit=NULLIF(p_credit,''),
    cover_media_credit_url=NULLIF(p_credit_url,''),cover_media_alt=NULLIF(p_alt,''),updated_at=now()
  WHERE id=p_event_id RETURNING * INTO v_event;
  UPDATE public.event_cover_selections SET consumed_at=now() WHERE selection_ref=p_selection_ref;
  RETURN jsonb_build_object('event',to_jsonb(v_event),'selection_ref',p_selection_ref);
END;$fn$;

REVOKE ALL ON FUNCTION public.business_unpublish_event_to_draft(uuid),
  public.business_duplicate_event_as_draft(uuid),
  public.business_set_event_cover_media(uuid,text,text,text,text,text,text,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.business_unpublish_event_to_draft(uuid),
  public.business_duplicate_event_as_draft(uuid),
  public.business_set_event_cover_media(uuid,text,text,text,text,text,text,text,text,text) TO authenticated,service_role;

-- ---------------------------------------------------------------------------
-- 5. Cancellation opens the refund run in the same transaction. The edge
--    fan-out remains a latency optimisation; cron now always has work to scan.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.business_cancel_event_with_refund_run(p_event_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_result jsonb;v_prepare jsonb;
BEGIN
  v_result:=public.business_cancel_event(p_event_id);
  v_prepare:=public.cancel_event_refund_prepare(p_event_id,now());
  RETURN v_result||jsonb_build_object('refund_run',v_prepare);
END;$fn$;
REVOKE ALL ON FUNCTION public.business_cancel_event_with_refund_run(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.business_cancel_event_with_refund_run(uuid) TO authenticated,service_role;

-- ---------------------------------------------------------------------------
-- 6. One transactional Ari event dispatcher: receipt + domain mutation.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ari_execute_event_operation(
  p_operation_id uuid,p_tool_name text,p_args jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE
  v_begin jsonb;
  v_result jsonb;
  v_event_id uuid;
  v_payload jsonb;
  v_business jsonb;
  v_timezone text;
  v_start timestamptz;
  v_end timestamptz;
  v_revision integer;
  v_event_status text;
BEGIN
  IF p_tool_name NOT IN('create_event','update_event','publish_event','unpublish_event','cancel_event',
    'end_event_sales','duplicate_event','patch_event_when','set_event_cover','set_event_guest_privacy','discard_event_draft')
  THEN RAISE EXCEPTION 'unsupported_event_operation';END IF;
  v_begin:=public.agent_operation_receipt_begin(p_operation_id,p_tool_name,p_args);
  IF COALESCE((v_begin->>'replay')::boolean,false) THEN RETURN v_begin->'result';END IF;
  v_event_id:=NULLIF(p_args->>'event_id','')::uuid;
  CASE p_tool_name
    WHEN 'create_event' THEN
      v_timezone:=COALESCE(NULLIF(p_args->>'timezone',''),'UTC');
      v_start:=(p_args->>'start_at')::timestamptz;
      v_end:=COALESCE(NULLIF(p_args->>'end_at','')::timestamptz,v_start+interval '2 hours');
      IF v_start<=now() OR v_end<=v_start THEN RAISE EXCEPTION 'event_date_invalid';END IF;
      v_business:=jsonb_build_object(
        'schemaVersion',1,'legacyLocalDraftId',NULL,
        'format',CASE WHEN COALESCE((p_args->>'is_online')::boolean,false) THEN 'online' ELSE 'in_person' END,
        'partyTypes',COALESCE(p_args->'party_types','[]'::jsonb),
        'vibeTags',COALESCE(p_args->'vibe_tags','[]'::jsonb),
        'musicGenres',COALESCE(p_args->'music_genres','[]'::jsonb),
        'city',p_args->'city','locationGeo',NULL,
        'requestedVisibility',COALESCE(NULLIF(p_args->>'visibility',''),'public'),
        'coverHue',25,'coverProvider',jsonb_build_object(
          'provider',p_args->'cover_media_provider','sourceUrl',p_args->'cover_media_source_url',
          'credit',p_args->'cover_media_credit','creditUrl',p_args->'cover_media_credit_url','alt',p_args->'cover_media_alt'),
        'currency',p_args->'currency','whenMode','single',
        'when',jsonb_build_object('date',to_char(v_start AT TIME ZONE v_timezone,'YYYY-MM-DD'),
          'doorsOpen',to_char(v_start AT TIME ZONE v_timezone,'HH24:MI'),
          'endsAt',to_char(v_end AT TIME ZONE v_timezone,'HH24:MI'),'timezone',v_timezone),
        'recurrenceRule',NULL,'multiDates',NULL,
        'location',jsonb_build_object('venueName',p_args->'location_text','address',NULL),
        'hideAddressUntilTicket',false,'tickets',COALESCE(p_args->'tickets','[]'::jsonb),
        'settings',jsonb_build_object('requireApproval',false,'allowTransfers',true,
          'hideRemainingCount',false,'passwordProtected',false,'privateGuestList',false,
          'inPersonPaymentsEnabled',false),
        'isRsvp',false,'rsvpCapacity',NULL,'rsvpAllowPlusOnes',false,'rsvpPlusOnesMax',0,
        'rsvpWaitlistEnabled',false,'rsvpApprovalMode','auto','rsvpDiscoverable',false,
        'rsvpContributionEnabled',false,'rsvpContributionSuggestedCents',NULL,
        'rsvpContributionMinCents',NULL,'lastStepReached',0,'clientRevision',0);
      v_payload:=jsonb_build_object(
        'title',p_args->>'title','description',p_args->'description','location_text',p_args->'location_text',
        'online_url',p_args->'online_url','is_online',COALESCE(p_args->'is_online','false'::jsonb),
        'is_recurring',false,'is_multi_date',false,'timezone',v_timezone,
        'cover_media_url',p_args->'cover_media_url','cover_media_type',p_args->'cover_media_type',
        'cover_media_poster_url',p_args->'cover_media_poster_url','cover_media_provider',p_args->'cover_media_provider',
        'cover_media_source_url',p_args->'cover_media_source_url','cover_media_credit',p_args->'cover_media_credit',
        'cover_media_credit_url',p_args->'cover_media_credit_url','cover_media_alt',p_args->'cover_media_alt',
        'currency',p_args->'currency','party_types',COALESCE(p_args->'party_types','[]'::jsonb),
        'vibe_tags',COALESCE(p_args->'vibe_tags','[]'::jsonb),'music_genres',COALESCE(p_args->'music_genres','[]'::jsonb),
        'city',p_args->'city','theme',jsonb_build_object('coverHue',25,'business_draft',v_business));
      v_result:=public.business_create_event_draft((p_args->>'brand_id')::uuid,v_payload);
    WHEN 'update_event' THEN
      SELECT status INTO v_event_status FROM public.events WHERE id=v_event_id AND event_type='event' AND deleted_at IS NULL;
      IF NOT FOUND THEN RAISE EXCEPTION 'event_not_found';END IF;
      IF v_event_status='draft' THEN
        v_payload:=public.business_event_draft_payload_from_graph(v_event_id);
        v_business:=COALESCE(v_payload#>'{theme,business_draft}','{}'::jsonb);
        v_revision:=COALESCE(NULLIF(p_args->>'client_revision','')::integer,
          COALESCE((v_business->>'clientRevision')::integer,0)+1);
        IF p_args ? 'title' THEN v_payload:=jsonb_set(v_payload,'{title}',p_args->'title',true);END IF;
        IF p_args ? 'description' THEN v_payload:=jsonb_set(v_payload,'{description}',p_args->'description',true);END IF;
        IF p_args ? 'location_text' THEN
          v_payload:=jsonb_set(v_payload,'{location_text}',p_args->'location_text',true);
          v_business:=jsonb_set(v_business,'{location,venueName}',p_args->'location_text',true);
        END IF;
        IF p_args ? 'is_online' THEN v_payload:=jsonb_set(v_payload,'{is_online}',p_args->'is_online',true);END IF;
        IF p_args ? 'online_url' THEN v_payload:=jsonb_set(v_payload,'{online_url}',p_args->'online_url',true);END IF;
        IF p_args ? 'visibility' THEN v_business:=jsonb_set(v_business,'{requestedVisibility}',p_args->'visibility',true);END IF;
        IF p_args ? 'start_at' THEN
          v_timezone:=COALESCE(NULLIF(p_args->>'timezone',''),v_payload->>'timezone','UTC');
          v_start:=(p_args->>'start_at')::timestamptz;
          v_end:=COALESCE(NULLIF(p_args->>'end_at','')::timestamptz,v_start+interval '2 hours');
          IF v_start<=now() OR v_end<=v_start THEN RAISE EXCEPTION 'event_date_invalid';END IF;
          v_business:=jsonb_set(v_business,'{whenMode}','"single"'::jsonb,true);
          v_business:=jsonb_set(v_business,'{when}',jsonb_build_object(
            'date',to_char(v_start AT TIME ZONE v_timezone,'YYYY-MM-DD'),
            'doorsOpen',to_char(v_start AT TIME ZONE v_timezone,'HH24:MI'),
            'endsAt',to_char(v_end AT TIME ZONE v_timezone,'HH24:MI'),'timezone',v_timezone),true);
          v_payload:=jsonb_set(v_payload,'{timezone}',to_jsonb(v_timezone),true);
        END IF;
        v_business:=jsonb_set(v_business,'{clientRevision}',to_jsonb(v_revision),true);
        v_payload:=jsonb_set(v_payload,'{theme,business_draft}',v_business,true);
        v_result:=public.business_update_event_draft(v_event_id,v_payload,v_revision);
      ELSE
        IF p_args ? 'start_at' OR p_args ? 'end_at' OR p_args ? 'timezone' THEN RAISE EXCEPTION 'live_schedule_requires_patch_event_when';END IF;
        v_business:='{}'::jsonb;
        IF p_args ? 'title' THEN v_business:=v_business||jsonb_build_object('name',p_args->'title');END IF;
        IF p_args ? 'description' THEN v_business:=v_business||jsonb_build_object('description',p_args->'description');END IF;
        IF p_args ? 'location_text' THEN v_business:=v_business||jsonb_build_object('address',p_args->'location_text');END IF;
        IF p_args ? 'online_url' THEN v_business:=v_business||jsonb_build_object('onlineUrl',p_args->'online_url');END IF;
        IF p_args ? 'is_online' THEN v_business:=v_business||jsonb_build_object('format',CASE WHEN (p_args->>'is_online')::boolean THEN 'online' ELSE 'in_person' END);END IF;
        IF p_args ? 'visibility' THEN v_business:=v_business||jsonb_build_object('visibility',p_args->'visibility');END IF;
        v_result:=public.business_update_live_event(v_event_id,v_business,p_args->>'reason',NULLIF(p_args->>'client_revision','')::integer);
      END IF;
    WHEN 'publish_event' THEN
      v_payload:=public.business_event_draft_payload_from_graph(v_event_id);
      v_result:=public.issue_1719_publish_event_with_poster(v_event_id,v_payload,
        COALESCE(NULLIF(p_args->>'client_revision','')::integer,(v_payload#>>'{theme,business_draft,clientRevision}')::integer));
    WHEN 'unpublish_event' THEN v_result:=public.business_unpublish_event_to_draft(v_event_id);
    WHEN 'cancel_event' THEN v_result:=public.business_cancel_event_with_refund_run(v_event_id);
    WHEN 'end_event_sales' THEN v_result:=public.business_end_event_ticket_sales(v_event_id);
    WHEN 'duplicate_event' THEN v_result:=public.business_duplicate_event_as_draft(v_event_id);
    WHEN 'patch_event_when' THEN v_result:=public.business_patch_event_when(v_event_id,p_args->'when_payload',p_args->>'reason',NULLIF(p_args->>'client_revision','')::integer);
    WHEN 'set_event_cover' THEN v_result:=public.business_set_event_cover_media(v_event_id,p_args->>'selection_ref',
      p_args->>'cover_media_url',p_args->>'cover_media_type',p_args->>'cover_media_poster_url',p_args->>'cover_media_provider',
      p_args->>'cover_media_source_url',p_args->>'cover_media_credit',p_args->>'cover_media_credit_url',p_args->>'cover_media_alt');
    WHEN 'set_event_guest_privacy' THEN v_result:=public.biz_set_event_guest_privacy(v_event_id,
      (p_args->>'private_guest_list')::boolean,(p_args->>'hide_remaining_count')::boolean);
    WHEN 'discard_event_draft' THEN v_result:=public.business_discard_event_draft(v_event_id);
  END CASE;
  RETURN public.agent_operation_receipt_complete(p_operation_id,p_tool_name,p_args,v_result);
END;$fn$;

REVOKE ALL ON FUNCTION public.ari_execute_event_operation(uuid,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.ari_execute_event_operation(uuid,text,jsonb) TO authenticated,service_role;

-- The historical patch-when function was accidentally executable by anon in
-- deployed schema. Restate the intended grants for all lifecycle owners.
REVOKE EXECUTE ON FUNCTION public.business_patch_event_when(uuid,jsonb,text,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.business_patch_event_when(uuid,jsonb,text,integer) TO authenticated,service_role;

COMMENT ON TABLE public.agent_operation_receipts IS '#1972 shared exactly-once receipt; result commits atomically with its domain mutation.';
COMMENT ON FUNCTION public.ari_execute_event_operation(uuid,text,jsonb) IS '#1972 canonical confirmed event dispatcher; pending action id is the operation id.';

COMMIT;
NOTIFY pgrst, 'reload schema';
