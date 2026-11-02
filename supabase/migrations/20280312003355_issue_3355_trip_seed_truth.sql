-- Issue #3355 P8 — Ari's trip drafts save only facts the owner gave.
--
-- Supersedes the function bodies of the branch's earlier
-- 20280305003355_issue_3355_ari_trip_create_details.sql, which (audit D-17,
-- F-3) filled gaps on the Ari path and changed the Host's create function:
--   * time zone — COALESCE(timezone, 'UTC');
--   * dates     — local midnight in the trip zone for BOTH ends, so a Lagos
--                 trip on 8–10 Jan opened in the Host wizard as 7–9 Jan, and
--                 the end was the start of the last day, not its end;
--   * capacity  — COALESCE(capacity, 1);
--   * a free "Standard" package nobody asked for;
--   * no check that the start is in the future.
--
-- Now:
--   * public.biz_create_trip_draft is restored to its main body (issue #1971)
--     exactly: the Host wizard's create path keeps its placeholder package and
--     behaves as before.
--   * the Ari path (ari_execute_trip_operation 'create_trip') creates through
--     the new public.ari_create_trip_draft, which:
--       - requires a valid IANA time zone   → 'trip_timezone_required' /
--                                              'trip_timezone_invalid';
--       - requires both calendar days       → 'trip_dates_required';
--       - refuses an end before the start   → 'trip_dates_invalid';
--       - refuses a start before today in the trip's zone → 'trip_date_past';
--       - stores the days exactly as the Host app does (calendarDate.ts):
--         start YYYY-MM-DDT00:00:00Z, end YYYY-MM-DDT23:59:59Z, in the master
--         event_dates row and the trip theme's startAt/endAt, with the
--         trip's time zone stored separately on events.timezone;
--       - takes the departure and destination the owner picked on the card
--         (label, city, country, coordinates) into the same theme keys and
--         canonical columns the wizard writes;
--       - creates NO package and has no capacity default: packages come from
--         the owner's answers through manage_trip_tiers.
--   * ari_execute_trip_operation 'update_trip' also takes a refund policy
--     (draft trips only), written through the same draft-graph settings
--     group the wizard's Policy step uses.
--
-- Untouched: biz_apply_trip_draft_graph, biz_publish_trip_command,
-- business_publish_*, biz_publish_*, pg_brand_can_*,
-- biz_require_current_organiser_terms, issue_1931_*.
-- Behaviour is pinned by
-- supabase/migrations/__tests__/issue_3355_trip_seed_truth.implementor.pg17.test.sql.

-- ── The Ari path's trip create ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ari_create_trip_draft(
  p_brand_id uuid,
  p_seed jsonb,
  p_operation_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_begin jsonb;
  v_event public.events%ROWTYPE;
  v_currency char(3);
  v_business_trip jsonb := '{}'::jsonb;
  v_result jsonb;
  v_timezone text;
  v_start date;
  v_end date;
  v_start_at timestamptz;
  v_end_at timestamptz;
  v_place jsonb;
  v_side text;
  v_label text;
BEGIN
  PERFORM public.biz_trip_require_manager(p_brand_id);

  IF jsonb_typeof(COALESCE(p_seed, '{}'::jsonb)) <> 'object'
     OR EXISTS (
       SELECT 1 FROM jsonb_object_keys(COALESCE(p_seed, '{}'::jsonb)) key
        WHERE key <> ALL (ARRAY[
          'title', 'description', 'timezone', 'start_date', 'end_date',
          'departure', 'destination', 'provenance'
        ])
     ) THEN
    RAISE EXCEPTION 'trip_seed_invalid' USING ERRCODE = '22023';
  END IF;

  v_timezone := NULLIF(btrim(p_seed->>'timezone'), '');
  IF v_timezone IS NULL THEN
    RAISE EXCEPTION 'trip_timezone_required' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = v_timezone) THEN
    RAISE EXCEPTION 'trip_timezone_invalid' USING ERRCODE = '22023';
  END IF;
  IF NULLIF(p_seed->>'start_date', '') IS NULL
     OR NULLIF(p_seed->>'end_date', '') IS NULL THEN
    RAISE EXCEPTION 'trip_dates_required' USING ERRCODE = '22023';
  END IF;
  IF p_seed->>'start_date' !~ '^\d{4}-\d{2}-\d{2}$'
     OR p_seed->>'end_date' !~ '^\d{4}-\d{2}-\d{2}$' THEN
    RAISE EXCEPTION 'trip_dates_invalid' USING ERRCODE = '22023';
  END IF;
  BEGIN
    v_start := (p_seed->>'start_date')::date;
    v_end := (p_seed->>'end_date')::date;
  EXCEPTION
    WHEN invalid_datetime_format OR datetime_field_overflow THEN
      RAISE EXCEPTION 'trip_dates_invalid' USING ERRCODE = '22023';
  END;
  IF v_end < v_start THEN
    RAISE EXCEPTION 'trip_dates_invalid' USING ERRCODE = '22023';
  END IF;
  IF v_start < (now() AT TIME ZONE v_timezone)::date THEN
    RAISE EXCEPTION 'trip_date_past' USING ERRCODE = '22023';
  END IF;

  v_begin := public.biz_trip_command_begin(
    p_operation_id, 'create_trip', p_brand_id, NULL, COALESCE(p_seed, '{}'::jsonb));
  IF (v_begin->>'replay')::boolean THEN RETURN v_begin->'result'; END IF;

  -- issue #1014: NULL brand currency stays NULL. Never invent USD.
  SELECT default_currency INTO v_currency
    FROM public.brands WHERE id = p_brand_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'brand_not_found'; END IF;

  -- The Host's calendar-day encoding (calendarDate.ts inputValueToCalendarIso).
  v_start_at := (to_char(v_start, 'YYYY-MM-DD') || 'T00:00:00Z')::timestamptz;
  v_end_at := (to_char(v_end, 'YYYY-MM-DD') || 'T23:59:59Z')::timestamptz;
  v_business_trip := jsonb_build_object(
    'startAt', to_char(v_start, 'YYYY-MM-DD') || 'T00:00:00.000Z',
    'endAt', to_char(v_end, 'YYYY-MM-DD') || 'T23:59:59.000Z'
  );

  -- The places the owner picked on the card, in the wizard's theme keys.
  FOREACH v_side IN ARRAY ARRAY['departure', 'destination'] LOOP
    v_place := p_seed->v_side;
    IF v_place IS NULL OR jsonb_typeof(v_place) = 'null' THEN CONTINUE; END IF;
    v_label := NULLIF(btrim(v_place->>'label'), '');
    IF jsonb_typeof(v_place) <> 'object'
       OR EXISTS (
         SELECT 1 FROM jsonb_object_keys(v_place) key
          WHERE key <> ALL (ARRAY['label', 'city', 'country_code', 'lat', 'lng'])
       )
       OR v_label IS NULL
       OR jsonb_typeof(v_place->'lat') IS DISTINCT FROM 'number'
       OR jsonb_typeof(v_place->'lng') IS DISTINCT FROM 'number'
       OR abs((v_place->>'lat')::numeric) > 90
       OR abs((v_place->>'lng')::numeric) > 180 THEN
      RAISE EXCEPTION 'trip_place_invalid' USING ERRCODE = '22023';
    END IF;
    v_business_trip := v_business_trip || jsonb_build_object(
      v_side || 'LocationText', v_label,
      v_side || 'Lat', (v_place->>'lat')::numeric,
      v_side || 'Lng', (v_place->>'lng')::numeric,
      v_side || 'City', NULLIF(btrim(v_place->>'city'), ''),
      v_side || 'CountryCode', NULLIF(upper(btrim(v_place->>'country_code')), ''),
      v_side || 'CoordinatePrecision', 'exact'
    );
  END LOOP;
  IF p_seed ? 'provenance' THEN
    v_business_trip := v_business_trip || jsonb_build_object('provenance', p_seed->'provenance');
  END IF;

  INSERT INTO public.events(
    brand_id, created_by, title, description, slug, event_type, status,
    visibility, currency, theme, timezone, destination_text, departure_text
  ) VALUES (
    p_brand_id,
    auth.uid(),
    COALESCE(NULLIF(btrim(p_seed->>'title'), ''), 'Untitled trip'),
    NULLIF(p_seed->>'description', ''),
    'draft-' || replace(gen_random_uuid()::text, '-', ''),
    'trip', 'draft', 'draft', v_currency,
    jsonb_build_object('business_trip', v_business_trip),
    v_timezone,
    v_business_trip->>'destinationLocationText',
    v_business_trip->>'departureLocationText'
  ) RETURNING * INTO v_event;

  -- issue #3801: the master event_dates row is the one owner of draft dates.
  INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master)
  VALUES (v_event.id, v_start_at, v_end_at, v_timezone, true);

  -- No ticket_types / trip_pricing_tiers row: packages come from the owner.

  v_result := public.biz_get_trip_draft_graph(v_event.id);
  RETURN public.biz_trip_command_finish(p_operation_id, v_result);
END;
$fn$;

COMMENT ON FUNCTION public.ari_create_trip_draft(uuid, jsonb, uuid) IS
  '#3355 P8: the Ari path''s trip create. Owner facts only: time zone and both calendar days required (no UTC, no past start), days stored like the Host (T00:00:00Z / T23:59:59Z), picked departure/destination, no package and no capacity default. Called only by ari_execute_trip_operation.';

REVOKE ALL ON FUNCTION public.ari_create_trip_draft(uuid, jsonb, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ari_create_trip_draft(uuid, jsonb, uuid)
  TO service_role;

-- ── The confirmed Ari trip dispatcher ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ari_execute_trip_operation(
  p_operation_id uuid,
  p_tool_name text,
  p_args jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_begin jsonb;
  v_result jsonb;
  v_event_id uuid;
  v_status text;
  v_patch jsonb := '{}'::jsonb;
  v_event_patch jsonb := '{}'::jsonb;
  v_seed jsonb := '{}'::jsonb;
BEGIN
  IF p_tool_name IS NULL OR p_tool_name NOT IN (
    'create_trip', 'update_trip', 'manage_trip_days', 'manage_trip_inclusions',
    'manage_trip_tiers', 'manage_trip_traveler_intake', 'publish_trip', 'delete_trip'
  ) THEN
    RAISE EXCEPTION 'unsupported_trip_operation';
  END IF;

  v_begin := public.agent_operation_receipt_begin(p_operation_id, p_tool_name, p_args);
  IF COALESCE((v_begin->>'replay')::boolean, false) THEN RETURN v_begin->'result'; END IF;

  IF p_tool_name = 'create_trip' THEN
    IF p_args ? 'title' THEN v_seed := v_seed || jsonb_build_object('title', p_args->'title'); END IF;
    IF p_args ? 'description' THEN v_seed := v_seed || jsonb_build_object('description', p_args->'description'); END IF;
    IF p_args ? 'provenance' THEN v_seed := v_seed || jsonb_build_object('provenance', p_args->'provenance'); END IF;
    IF p_args ? 'timezone' THEN v_seed := v_seed || jsonb_build_object('timezone', p_args->'timezone'); END IF;
    IF p_args ? 'start_date' THEN v_seed := v_seed || jsonb_build_object('start_date', p_args->'start_date'); END IF;
    IF p_args ? 'end_date' THEN v_seed := v_seed || jsonb_build_object('end_date', p_args->'end_date'); END IF;
    IF p_args ? 'departure' THEN v_seed := v_seed || jsonb_build_object('departure', p_args->'departure'); END IF;
    IF p_args ? 'destination' THEN v_seed := v_seed || jsonb_build_object('destination', p_args->'destination'); END IF;
    v_result := public.ari_create_trip_draft(
      (p_args->>'brand_id')::uuid, v_seed, p_operation_id);
  ELSE
    v_event_id := NULLIF(p_args->>'event_id', '')::uuid;
    IF v_event_id IS NULL THEN RAISE EXCEPTION 'trip_not_found'; END IF;
    IF p_tool_name = 'publish_trip' THEN
      v_result := public.biz_publish_trip_command(
        v_event_id, (p_args->>'expected_updated_at')::timestamptz, p_operation_id);
    ELSIF p_tool_name = 'delete_trip' THEN
      v_result := public.biz_soft_delete_trip(
        v_event_id, (p_args->>'expected_updated_at')::timestamptz, p_operation_id);
    ELSE
      SELECT status INTO v_status FROM public.events
       WHERE id = v_event_id AND event_type = 'trip' AND deleted_at IS NULL;
      IF NOT FOUND THEN RAISE EXCEPTION 'trip_not_found'; END IF;
      IF p_tool_name = 'update_trip' THEN
        IF p_args ? 'title' THEN v_event_patch := v_event_patch || jsonb_build_object('title', p_args->'title'); END IF;
        IF p_args ? 'description' THEN v_event_patch := v_event_patch || jsonb_build_object('description', p_args->'description'); END IF;
        IF v_event_patch <> '{}'::jsonb THEN
          v_patch := jsonb_build_object('event', v_event_patch);
        END IF;
        IF p_args ? 'refund_policy' THEN
          -- #3355 P8: the wizard's Policy step group; drafts only (a live
          -- trip's terms change through the Host's audited edit screen).
          IF v_status <> 'draft' THEN
            RAISE EXCEPTION 'trip_refund_policy_draft_only' USING ERRCODE = '22023';
          END IF;
          v_patch := v_patch || jsonb_build_object(
            'settings', jsonb_build_object('refund_policy', p_args->'refund_policy'));
        END IF;
        IF v_patch = '{}'::jsonb THEN RAISE EXCEPTION 'trip_patch_empty'; END IF;
      ELSIF p_tool_name = 'manage_trip_days' THEN
        v_patch := jsonb_build_object('days', COALESCE(p_args->'items', '[]'::jsonb));
      ELSIF p_tool_name = 'manage_trip_inclusions' THEN
        v_patch := jsonb_build_object('inclusions', COALESCE(p_args->'items', '[]'::jsonb));
      ELSIF p_tool_name = 'manage_trip_tiers' THEN
        v_patch := jsonb_build_object('tiers', COALESCE(p_args->'items', '[]'::jsonb));
      ELSIF p_tool_name = 'manage_trip_traveler_intake' THEN
        v_patch := jsonb_build_object('intake_schemas', COALESCE(p_args->'items', '[]'::jsonb));
      END IF;
      IF v_status = 'draft' THEN
        v_result := public.biz_apply_trip_draft_graph(
          v_event_id, v_patch, (p_args->>'expected_updated_at')::timestamptz, p_operation_id);
      ELSIF v_status IN ('scheduled', 'live') THEN
        v_result := public.biz_update_trip_live_command(
          v_event_id, v_patch, p_args->>'reason',
          (p_args->>'expected_updated_at')::timestamptz, p_operation_id);
      ELSE
        RAISE EXCEPTION 'trip_not_editable';
      END IF;
    END IF;
  END IF;
  RETURN public.agent_operation_receipt_complete(p_operation_id, p_tool_name, p_args, v_result);
END;
$fn$;

COMMENT ON FUNCTION public.ari_execute_trip_operation(uuid, text, jsonb) IS
  '#1971 canonical confirmed trip dispatcher; pending action id is the operation id. #3355 P8: create goes through ari_create_trip_draft (owner facts only, Host calendar-day encoding, no package); update_trip takes a draft refund policy.';

-- ── The Host's create path, restored to its main (#1971) body ──────────────
CREATE OR REPLACE FUNCTION public.biz_create_trip_draft(
  p_brand_id uuid,
  p_seed jsonb,
  p_operation_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_begin jsonb;
  v_event public.events%ROWTYPE;
  v_ticket public.ticket_types%ROWTYPE;
  v_currency char(3);
  v_business_trip jsonb;
  v_result jsonb;
BEGIN
  PERFORM public.biz_trip_require_manager(p_brand_id);

  IF jsonb_typeof(COALESCE(p_seed, '{}'::jsonb)) <> 'object'
     OR EXISTS (
       SELECT 1 FROM jsonb_object_keys(COALESCE(p_seed, '{}'::jsonb)) key
        WHERE key <> ALL (ARRAY['title', 'description', 'timezone', 'business_trip', 'provenance'])
     ) THEN
    RAISE EXCEPTION 'trip_seed_invalid' USING ERRCODE = '22023';
  END IF;

  v_begin := public.biz_trip_command_begin(
    p_operation_id, 'create_trip', p_brand_id, NULL, COALESCE(p_seed, '{}'::jsonb));
  IF (v_begin->>'replay')::boolean THEN RETURN v_begin->'result'; END IF;

  -- issue #1014: NULL brand currency stays NULL. Never invent USD.
  SELECT default_currency INTO v_currency
    FROM public.brands WHERE id = p_brand_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'brand_not_found'; END IF;

  v_business_trip := COALESCE(p_seed->'business_trip', '{}'::jsonb);
  IF jsonb_typeof(v_business_trip) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'trip_seed_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_seed ? 'provenance' THEN
    -- Opaque to this issue: #1753 owns what provenance means.
    v_business_trip := v_business_trip || jsonb_build_object('provenance', p_seed->'provenance');
  END IF;

  INSERT INTO public.events(
    brand_id, created_by, title, description, slug, event_type, status,
    visibility, currency, theme, timezone
  ) VALUES (
    p_brand_id,
    auth.uid(),
    COALESCE(NULLIF(btrim(p_seed->>'title'), ''), 'Untitled trip'),
    NULLIF(p_seed->>'description', ''),
    'draft-' || replace(gen_random_uuid()::text, '-', ''),
    'trip',
    'draft',
    'draft',
    v_currency,
    jsonb_build_object('business_trip', v_business_trip),
    COALESCE(NULLIF(p_seed->>'timezone', ''), 'UTC')
  ) RETURNING * INTO v_event;

  -- The manual wizard's placeholder Standard ticket + its joined pricing tier.
  -- Ari-created drafts must satisfy the same publish prerequisites.
  INSERT INTO public.ticket_types(
    event_id, name, price_cents, currency, quantity_total, is_unlimited,
    is_free, min_purchase_qty, available_online, available_in_person, display_order
  ) VALUES (
    v_event.id, 'Standard', 0, v_currency, 1, false, true, 1, true, false, 0
  ) RETURNING * INTO v_ticket;

  INSERT INTO public.trip_pricing_tiers(event_id, ticket_type_id, tier_name, tier_metadata)
  VALUES (v_event.id, v_ticket.id, 'Standard', '{}'::jsonb);

  v_result := public.biz_get_trip_draft_graph(v_event.id);
  RETURN public.biz_trip_command_finish(p_operation_id, v_result);
END;
$fn$;
