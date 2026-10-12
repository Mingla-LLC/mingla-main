-- Issue #3801 — a trip's dates have one owner while it is a draft.
--
-- WHAT WAS BROKEN. No trip could be published. The wizard saves the dates as
-- startAt / endAt inside `event.business_trip`; `biz_apply_trip_draft_graph`
-- merged that into `events.theme` and wrote `public.event_dates` only for an
-- `event_dates` group, which no client sends. `biz_publish_trip_command` then
-- read the dates from the master `event_dates` row, found none, and overwrote
-- the theme's dates with JSON null before handing the payload to the publish
-- owner, which answered `trip_dates_required`. The wizard reads its dates from
-- the same missing row, so a saved draft also reopened with blank dates.
--
-- WHAT THIS DOES. Three things, nothing else:
--   1. `biz_apply_trip_draft_graph` keeps the master `event_dates` row in step
--      with the dates in the merged business_trip object, in the same
--      transaction as the theme write.
--   2. `biz_publish_trip_command` (5-argument) falls back to the theme's dates
--      when a draft has no master row, instead of nulling them.
--   3. A one-off, idempotent backfill gives every existing draft trip that has
--      a complete pair of theme dates and no master row its master row.
--
-- WHERE EACH BODY CAME FROM. Both are re-emitted verbatim from their latest
-- definition, with only the marked `issue #3801` lines added:
--   public.biz_apply_trip_draft_graph(uuid, jsonb, timestamptz, uuid)
--     <- supabase/migrations/20270509001971_issue_1971_ari_trip_lifecycle.sql
--   public.biz_publish_trip_command(uuid, timestamptz, uuid, bigint, boolean)
--     <- supabase/migrations/20270712001780_issue_1780_wizard_invite_plans.sql
-- Both matched production byte for byte (md5 of prosrc) when this was written.
-- The 3-argument `biz_publish_trip_command` is a one-line wrapper over the
-- 5-argument one and is not touched. `business_publish_trip_draft` and
-- `issue_1719_publish_trip_with_poster` are not touched, so this migration
-- does not depend on any other unapplied migration.
--
-- No table, column, index, policy, constraint or trigger changes.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Atomic draft graph patch — now also the writer of the master date row.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.biz_apply_trip_draft_graph(
  p_event_id uuid,
  p_patch jsonb,
  p_expected_updated_at timestamptz,
  p_operation_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_event public.events%ROWTYPE;
  v_begin jsonb;
  v_result jsonb;
  v_item jsonb;
  v_ticket_type uuid;
  v_currency char(3);
  v_theme jsonb;
  v_business_trip jsonb;
  v_known text[] := ARRAY['event', 'event_dates', 'days', 'inclusions', 'tiers', 'intake_schemas', 'settings'];
  -- issue #3801
  v_dates_touched boolean;
  v_trip_start timestamptz;
  v_trip_end timestamptz;
BEGIN
  SELECT * INTO v_event FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND OR v_event.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'trip_not_found';
  END IF;
  IF v_event.event_type <> 'trip' THEN
    RAISE EXCEPTION 'event_not_a_trip';
  END IF;
  PERFORM public.biz_trip_require_manager(v_event.brand_id);

  v_begin := public.biz_trip_command_begin(
    p_operation_id, 'apply_trip_draft_graph', v_event.brand_id, p_event_id,
    jsonb_build_object('patch', p_patch, 'expected_updated_at', p_expected_updated_at));
  IF (v_begin->>'replay')::boolean THEN RETURN v_begin->'result'; END IF;

  IF v_event.status <> 'draft' THEN RAISE EXCEPTION 'trip_not_draft'; END IF;
  IF p_expected_updated_at IS NULL
     OR v_event.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'trip_revision_conflict' USING ERRCODE = '40001';
  END IF;
  IF jsonb_typeof(COALESCE(p_patch, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'trip_patch_invalid' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_object_keys(COALESCE(p_patch, '{}'::jsonb)) k
     WHERE NOT (k = ANY (v_known))
  ) THEN
    RAISE EXCEPTION 'trip_patch_key_not_allowed' USING ERRCODE = '22023';
  END IF;

  ------------------------------------------------------------------ basics --
  IF p_patch ? 'event' THEN
    IF jsonb_typeof(p_patch->'event') <> 'object' OR EXISTS (
      SELECT 1 FROM jsonb_object_keys(p_patch->'event') key
       WHERE key <> ALL (ARRAY[
         'title', 'description', 'timezone', 'destination_text', 'departure_text',
         'cover_media_url', 'cover_media_poster_url', 'cover_media_type',
         'cover_media_gallery', 'business_trip'])
    ) THEN
      RAISE EXCEPTION 'trip_event_patch_invalid' USING ERRCODE = '22023';
    END IF;

    -- `events.destination_text` / `events.departure_text` are the canonical
    -- columns (ORCH-0950-expanded, ORCH-1016, I-PROPOSED-TRIP-CANONICAL-COLUMNS)
    -- and publish reads them. The theme keys are the authoring input and the
    -- wire format the existing publish/live owners consume. Both are written in
    -- the one statement below, DERIVED FROM THE SAME merged object, so the two
    -- cannot drift and neither input shape can produce a half-written trip.
    v_theme := COALESCE(v_event.theme, '{}'::jsonb);
    v_business_trip := COALESCE(v_theme->'business_trip', '{}'::jsonb);
    IF (p_patch->'event') ? 'business_trip' THEN
      IF jsonb_typeof(p_patch#>'{event,business_trip}') <> 'object' THEN
        RAISE EXCEPTION 'trip_event_patch_invalid' USING ERRCODE = '22023';
      END IF;
      v_business_trip := v_business_trip || (p_patch#>'{event,business_trip}');
    END IF;
    IF (p_patch->'event') ? 'destination_text' THEN
      v_business_trip := v_business_trip
        || jsonb_build_object('destinationLocationText', p_patch#>'{event,destination_text}');
    END IF;
    IF (p_patch->'event') ? 'departure_text' THEN
      v_business_trip := v_business_trip
        || jsonb_build_object('departureLocationText', p_patch#>'{event,departure_text}');
    END IF;
    v_theme := jsonb_set(v_theme, '{business_trip}', v_business_trip, true);

    UPDATE public.events SET
      title = CASE WHEN (p_patch->'event') ? 'title'
                THEN COALESCE(NULLIF(btrim(p_patch#>>'{event,title}'), ''), title) ELSE title END,
      description = CASE WHEN (p_patch->'event') ? 'description'
                THEN NULLIF(p_patch#>>'{event,description}', '') ELSE description END,
      timezone = CASE WHEN (p_patch->'event') ? 'timezone'
                THEN COALESCE(NULLIF(p_patch#>>'{event,timezone}', ''), 'UTC') ELSE timezone END,
      -- Derived from the MERGED business_trip, not from the raw patch key, so a
      -- destinationLocationText nested under `event.business_trip` populates
      -- the canonical column exactly as `event.destination_text` does. This
      -- also heals a legacy row whose theme and column disagree, on the next
      -- patch.
      destination_text = CASE WHEN v_business_trip ? 'destinationLocationText'
                THEN NULLIF(btrim(v_business_trip->>'destinationLocationText'), '') ELSE destination_text END,
      departure_text = CASE WHEN v_business_trip ? 'departureLocationText'
                THEN NULLIF(btrim(v_business_trip->>'departureLocationText'), '') ELSE departure_text END,
      cover_media_url = CASE WHEN (p_patch->'event') ? 'cover_media_url'
                THEN NULLIF(p_patch#>>'{event,cover_media_url}', '') ELSE cover_media_url END,
      cover_media_poster_url = CASE WHEN (p_patch->'event') ? 'cover_media_poster_url'
                THEN NULLIF(p_patch#>>'{event,cover_media_poster_url}', '') ELSE cover_media_poster_url END,
      cover_media_type = CASE WHEN (p_patch->'event') ? 'cover_media_type'
                THEN NULLIF(p_patch#>>'{event,cover_media_type}', '') ELSE cover_media_type END,
      cover_media_gallery = CASE WHEN (p_patch->'event') ? 'cover_media_gallery'
                THEN p_patch#>'{event,cover_media_gallery}' ELSE cover_media_gallery END,
      theme = v_theme,
      updated_at = now()
     WHERE id = p_event_id;

    -- issue #3801 — ONE OWNER FOR DRAFT TRIP DATES: the master event_dates row.
    --
    -- The wizard authors the dates as startAt / endAt inside
    -- `event.business_trip`, and never sends an `event_dates` group. Before
    -- this block the dates therefore reached the theme only, while publish and
    -- every reader (the wizard reload, the Hub list) read the master
    -- event_dates row — which did not exist. Publish refused every trip with
    -- `trip_dates_required` and the wizard reopened with blank dates.
    --
    -- The master row is now derived here, from the SAME merged object the theme
    -- write above just used and in the same transaction, so the two cannot
    -- drift:
    --   * dates touched by this patch and complete (both set, end after start)
    --       -> the master row is replaced with them;
    --   * dates touched and now cleared, half-set or out of order
    --       -> the master row is removed, so no stale row can outvote the
    --          theme at publish (the publish owner then names the real fault);
    --   * dates NOT touched, the theme holds a complete pair, and there is no
    --     master row -> the row is created. This heals a draft saved before
    --     this migration on its next basics save;
    --   * dates NOT touched and a master row exists -> left exactly as it is
    --     (it may have been written through the explicit `event_dates` group).
    -- An explicit `event_dates` group in the same patch keeps its existing
    -- behaviour and wins: this block stands aside and the group below runs.
    IF NOT (p_patch ? 'event_dates') THEN
      v_dates_touched := COALESCE(
        (p_patch#>'{event,business_trip}') ? 'startAt'
        OR (p_patch#>'{event,business_trip}') ? 'endAt', false);
      v_trip_start := NULL;
      v_trip_end := NULL;
      BEGIN
        v_trip_start := NULLIF(btrim(v_business_trip->>'startAt'), '')::timestamptz;
        v_trip_end := NULLIF(btrim(v_business_trip->>'endAt'), '')::timestamptz;
      EXCEPTION
        WHEN invalid_datetime_format OR datetime_field_overflow
             OR invalid_parameter_value OR invalid_text_representation THEN
          -- A date this patch just wrote that is not a date is refused, with
          -- the code the `event_dates` group already uses. Unreadable text
          -- already sitting in an old draft is not this patch's fault and
          -- must not block an unrelated save.
          IF v_dates_touched THEN
            RAISE EXCEPTION 'trip_dates_invalid' USING ERRCODE = '22023';
          END IF;
          v_trip_start := NULL;
          v_trip_end := NULL;
      END;

      IF v_trip_start IS NOT NULL AND v_trip_end IS NOT NULL
         AND v_trip_end > v_trip_start THEN
        IF v_dates_touched OR NOT EXISTS (
          SELECT 1 FROM public.event_dates
           WHERE event_id = p_event_id AND is_master = true
        ) THEN
          DELETE FROM public.event_dates
           WHERE event_id = p_event_id AND is_master = true;
          INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master)
          SELECT p_event_id, v_trip_start, v_trip_end, e.timezone, true
            FROM public.events e
           WHERE e.id = p_event_id;
        END IF;
      ELSIF v_dates_touched THEN
        DELETE FROM public.event_dates
         WHERE event_id = p_event_id AND is_master = true;
      END IF;
    END IF;
  END IF;

  ------------------------------------------------------------------- dates --
  IF p_patch ? 'event_dates' THEN
    IF jsonb_typeof(p_patch->'event_dates') <> 'array' THEN
      RAISE EXCEPTION 'trip_dates_invalid' USING ERRCODE = '22023';
    END IF;
    DELETE FROM public.event_dates WHERE event_id = p_event_id;
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_patch->'event_dates') LOOP
      IF NULLIF(v_item->>'start_at', '') IS NULL THEN
        RAISE EXCEPTION 'trip_dates_invalid' USING ERRCODE = '22023';
      END IF;
      INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master)
      VALUES (
        p_event_id,
        (v_item->>'start_at')::timestamptz,
        NULLIF(v_item->>'end_at', '')::timestamptz,
        COALESCE(NULLIF(v_item->>'timezone', ''), v_event.timezone),
        COALESCE((v_item->>'is_master')::boolean, true)
      );
    END LOOP;
  END IF;

  -------------------------------------------------------------------- days --
  IF p_patch ? 'days' THEN
    IF jsonb_typeof(p_patch->'days') <> 'array'
       OR EXISTS (
         SELECT 1 FROM jsonb_array_elements(p_patch->'days') d
          WHERE jsonb_typeof(d) <> 'object'
             OR COALESCE((d->>'ordinal')::int, 0) < 1
             OR NULLIF(btrim(d->>'title'), '') IS NULL
             OR jsonb_typeof(COALESCE(d->'media', '[]'::jsonb)) <> 'array')
       OR EXISTS (
         SELECT 1 FROM jsonb_array_elements(p_patch->'days') d
          GROUP BY (d->>'ordinal')::int HAVING count(*) > 1)
    THEN
      RAISE EXCEPTION 'trip_days_invalid' USING ERRCODE = '22023';
    END IF;
    DELETE FROM public.trip_days WHERE event_id = p_event_id;
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_patch->'days') LOOP
      INSERT INTO public.trip_days(event_id, ordinal, title, narrative, date, stops, media)
      VALUES (
        p_event_id,
        (v_item->>'ordinal')::smallint,
        v_item->>'title',
        NULLIF(v_item->>'narrative', ''),
        NULLIF(v_item->>'date', '')::date,
        COALESCE(v_item->'stops', '[]'::jsonb),
        COALESCE(v_item->'media', '[]'::jsonb)
      );
    END LOOP;
  END IF;

  -------------------------------------------------------------- inclusions --
  IF p_patch ? 'inclusions' THEN
    IF jsonb_typeof(p_patch->'inclusions') <> 'array'
       OR EXISTS (
         SELECT 1 FROM jsonb_array_elements(p_patch->'inclusions') i
          WHERE COALESCE(i->>'kind', '') NOT IN ('included', 'excluded')
             OR NULLIF(btrim(i->>'item'), '') IS NULL
             OR COALESCE((i->>'ordinal')::int, -1) < 0)
    THEN
      RAISE EXCEPTION 'trip_inclusions_invalid' USING ERRCODE = '22023';
    END IF;
    DELETE FROM public.trip_inclusions WHERE event_id = p_event_id;
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_patch->'inclusions') LOOP
      INSERT INTO public.trip_inclusions(event_id, kind, item, ordinal)
      VALUES (p_event_id, v_item->>'kind', v_item->>'item', (v_item->>'ordinal')::smallint);
    END LOOP;
  END IF;

  ------------------------------------------------------------------- tiers --
  IF p_patch ? 'tiers' THEN
    IF jsonb_typeof(p_patch->'tiers') <> 'array' THEN
      RAISE EXCEPTION 'trip_tiers_invalid' USING ERRCODE = '22023';
    END IF;
    v_currency := v_event.currency;
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_patch->'tiers') LOOP
      v_ticket_type := NULLIF(v_item->>'ticket_type_id', '')::uuid;

      IF COALESCE((v_item->>'deleted')::boolean, false) THEN
        IF v_ticket_type IS NULL THEN RAISE EXCEPTION 'trip_tier_id_required'; END IF;
        IF EXISTS (
          SELECT 1 FROM public.tickets
           WHERE ticket_type_id = v_ticket_type
             AND status IN ('valid', 'used', 'transferred')
        ) THEN
          RAISE EXCEPTION 'tier_delete_with_sales';
        END IF;
        UPDATE public.ticket_types
           SET deleted_at = now(), updated_at = now()
         WHERE id = v_ticket_type AND event_id = p_event_id AND deleted_at IS NULL;
        IF NOT FOUND THEN RAISE EXCEPTION 'trip_tier_not_found'; END IF;
        CONTINUE;
      END IF;

      PERFORM public.biz_validate_trip_installment_schedule(v_item->'tier_metadata');

      IF v_ticket_type IS NULL THEN
        IF NULLIF(btrim(v_item->>'tier_name'), '') IS NULL
           OR COALESCE((v_item->>'price_cents')::int, -1) < 0
           OR COALESCE((v_item->>'capacity')::int, 0) < 1 THEN
          RAISE EXCEPTION 'trip_tier_invalid' USING ERRCODE = '22023';
        END IF;
        IF COALESCE((v_item->>'price_cents')::int, 0) > 0
           AND NOT public.pg_brand_can_collect(v_event.brand_id) THEN
          RAISE EXCEPTION 'stripe_charges_disabled';
        END IF;
        INSERT INTO public.ticket_types(
          event_id, name, price_cents, currency, quantity_total, is_unlimited,
          is_free, min_purchase_qty, available_online, available_in_person, display_order
        ) VALUES (
          p_event_id,
          v_item->>'tier_name',
          COALESCE((v_item->>'price_cents')::int, 0),
          v_currency,
          (v_item->>'capacity')::int,
          false,
          COALESCE((v_item->>'price_cents')::int, 0) = 0,
          1, true, false,
          COALESCE((v_item->>'display_order')::int, 0)
        ) RETURNING id INTO v_ticket_type;
        INSERT INTO public.trip_pricing_tiers(event_id, ticket_type_id, tier_name, tier_metadata)
        VALUES (p_event_id, v_ticket_type, v_item->>'tier_name',
                COALESCE(v_item->'tier_metadata', '{}'::jsonb));
      ELSE
        IF (v_item ? 'price_cents' AND (v_item->>'price_cents')::int < 0)
           OR (v_item ? 'capacity' AND (v_item->>'capacity')::int < 1) THEN
          RAISE EXCEPTION 'trip_tier_invalid' USING ERRCODE = '22023';
        END IF;
        IF COALESCE((v_item->>'price_cents')::int, 0) > 0
           AND NOT public.pg_brand_can_collect(v_event.brand_id) THEN
          RAISE EXCEPTION 'stripe_charges_disabled';
        END IF;
        UPDATE public.ticket_types SET
          name = COALESCE(v_item->>'tier_name', name),
          price_cents = COALESCE((v_item->>'price_cents')::int, price_cents),
          quantity_total = COALESCE((v_item->>'capacity')::int, quantity_total),
          is_free = COALESCE((v_item->>'price_cents')::int, price_cents) = 0,
          updated_at = now()
         WHERE id = v_ticket_type AND event_id = p_event_id AND deleted_at IS NULL;
        IF NOT FOUND THEN RAISE EXCEPTION 'trip_tier_not_found'; END IF;
        UPDATE public.trip_pricing_tiers SET
          tier_name = COALESCE(v_item->>'tier_name', tier_name),
          tier_metadata = COALESCE(v_item->'tier_metadata', tier_metadata)
         WHERE event_id = p_event_id AND ticket_type_id = v_ticket_type;
      END IF;
    END LOOP;
  END IF;

  ----------------------------------------------------------- intake schemas --
  IF p_patch ? 'intake_schemas' THEN
    IF jsonb_typeof(p_patch->'intake_schemas') <> 'array' THEN
      RAISE EXCEPTION 'trip_intake_schemas_invalid' USING ERRCODE = '22023';
    END IF;
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_patch->'intake_schemas') LOOP
      v_ticket_type := NULLIF(v_item->>'ticket_type_id', '')::uuid;
      IF v_ticket_type IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.trip_pricing_tiers
         WHERE event_id = p_event_id AND ticket_type_id = v_ticket_type
      ) THEN
        RAISE EXCEPTION 'trip_intake_schema_unknown_tier';
      END IF;
      IF NOT (v_item ? 'schema') OR jsonb_typeof(v_item->'schema') = 'null' THEN
        DELETE FROM public.trip_intake_schemas
         WHERE event_id = p_event_id AND ticket_type_id = v_ticket_type;
      ELSE
        IF NOT public.validate_trip_intake_schema(v_item->'schema') THEN
          RAISE EXCEPTION 'trip_intake_schema_invalid' USING ERRCODE = '22023';
        END IF;
        INSERT INTO public.trip_intake_schemas(event_id, ticket_type_id, schema, schema_version_id)
        VALUES (p_event_id, v_ticket_type, v_item->'schema',
                NULLIF(v_item#>>'{schema,schema_version_id}', '')::uuid)
        ON CONFLICT (event_id, ticket_type_id) DO UPDATE
          SET schema = EXCLUDED.schema,
              schema_version_id = EXCLUDED.schema_version_id,
              updated_at = now();
      END IF;
    END LOOP;
  END IF;

  ---------------------------------------------------------------- settings --
  IF p_patch ? 'settings' THEN
    IF jsonb_typeof(p_patch->'settings') <> 'object' OR EXISTS (
      SELECT 1 FROM jsonb_object_keys(p_patch->'settings') key
       WHERE key <> ALL (ARRAY[
         'refund_policy', 'booking_deadline', 'bookings_closed',
         'pass_tax', 'pass_mingla_fee', 'pass_service_fee'])
    ) THEN
      RAISE EXCEPTION 'trip_settings_patch_invalid' USING ERRCODE = '22023';
    END IF;
    UPDATE public.events SET
      refund_policy = CASE WHEN (p_patch->'settings') ? 'refund_policy'
                THEN p_patch#>'{settings,refund_policy}' ELSE refund_policy END,
      booking_deadline = CASE WHEN (p_patch->'settings') ? 'booking_deadline'
                THEN NULLIF(p_patch#>>'{settings,booking_deadline}', '')::timestamptz ELSE booking_deadline END,
      bookings_closed = CASE WHEN (p_patch->'settings') ? 'bookings_closed'
                THEN (p_patch#>>'{settings,bookings_closed}')::boolean ELSE bookings_closed END,
      pass_tax = CASE WHEN (p_patch->'settings') ? 'pass_tax'
                THEN (p_patch#>>'{settings,pass_tax}')::boolean ELSE pass_tax END,
      pass_mingla_fee = CASE WHEN (p_patch->'settings') ? 'pass_mingla_fee'
                THEN (p_patch#>>'{settings,pass_mingla_fee}')::boolean ELSE pass_mingla_fee END,
      pass_service_fee = CASE WHEN (p_patch->'settings') ? 'pass_service_fee'
                THEN (p_patch#>>'{settings,pass_service_fee}')::boolean ELSE pass_service_fee END,
      updated_at = now()
     WHERE id = p_event_id;
  END IF;

  -- A sidecar-only patch still advances the graph revision, so the next
  -- compare-and-swap sees a moved target.
  UPDATE public.events SET updated_at = now() WHERE id = p_event_id;

  v_result := public.biz_get_trip_draft_graph(p_event_id);
  RETURN public.biz_trip_command_finish(p_operation_id, v_result);
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 2. Publish — a draft with no master date row publishes from its theme dates.
--    SECURITY DEFINER with search_path=pg_catalog, exactly as defined by #1780:
--    every relation and function below stays schema-qualified.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.biz_publish_trip_command(
  p_event_id uuid,p_expected_updated_at timestamptz,p_operation_id uuid,
  p_invite_selection_revision bigint,p_invite_selection_confirmed boolean
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $fn$
DECLARE
  v_event public.events%ROWTYPE; v_begin jsonb; v_result jsonb; v_start timestamptz;
  v_end timestamptz; v_payload jsonb; v_command_payload jsonb;
BEGIN
  SELECT * INTO v_event FROM public.events WHERE id=p_event_id FOR UPDATE;
  IF NOT FOUND OR v_event.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'trip_not_found'; END IF;
  IF v_event.event_type<>'trip' THEN RAISE EXCEPTION 'event_not_a_trip'; END IF;
  PERFORM public.biz_trip_require_manager(v_event.brand_id);
  v_command_payload:=jsonb_build_object('expected_updated_at',p_expected_updated_at);
  IF p_invite_selection_revision IS NOT NULL OR COALESCE(p_invite_selection_confirmed,false) THEN
    v_command_payload:=v_command_payload||jsonb_build_object(
      'invite_selection_revision',p_invite_selection_revision,
      'invite_selection_confirmed',COALESCE(p_invite_selection_confirmed,false));
  END IF;
  v_begin:=public.biz_trip_command_begin(
    p_operation_id,'publish_trip',v_event.brand_id,p_event_id,v_command_payload);
  IF (v_begin->>'replay')::boolean THEN RETURN v_begin->'result'; END IF;
  IF p_expected_updated_at IS NULL OR v_event.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'trip_revision_conflict' USING ERRCODE='40001';
  END IF;
  SELECT start_at,end_at INTO v_start,v_end FROM public.event_dates
    WHERE event_id=p_event_id AND is_master=true ORDER BY start_at LIMIT 1;
  v_payload:=jsonb_build_object(
    'title',v_event.title,'description',v_event.description,'timezone',v_event.timezone,
    'cover_media_url',v_event.cover_media_url,'cover_media_poster_url',v_event.cover_media_poster_url,
    'cover_media_type',v_event.cover_media_type,'cover_media_provider',v_event.cover_media_provider,
    'cover_media_source_url',v_event.cover_media_source_url,'cover_media_credit',v_event.cover_media_credit,
    'cover_media_credit_url',v_event.cover_media_credit_url,'cover_media_alt',v_event.cover_media_alt,
    'cover_media_gallery',v_event.cover_media_gallery,
    'theme',jsonb_set(COALESCE(v_event.theme,'{}'::jsonb),'{business_trip}',
      COALESCE(v_event.theme->'business_trip','{}'::jsonb)||jsonb_build_object(
        'destinationLocationText',v_event.destination_text,'departureLocationText',v_event.departure_text,
        -- issue #3801: the master event_dates row is the owner. A draft that
        -- has none (saved before the row was kept in step, or seeded with
        -- dates at create) falls back to the dates already stored in its
        -- theme instead of having them overwritten with null. start_at and
        -- end_at are both NOT NULL, so the pair always comes from one source.
        'startAt',COALESCE(to_jsonb(v_start),v_event.theme#>'{business_trip,startAt}'),
        'endAt',COALESCE(to_jsonb(v_end),v_event.theme#>'{business_trip,endAt}')),true));
  v_result:=public.issue_1719_publish_trip_with_poster(p_event_id,v_payload,NULL);
  IF COALESCE((v_result->>'ok')::boolean,true) THEN
    v_result:=v_result||jsonb_build_object(
      'graph',public.biz_get_trip_draft_graph(p_event_id),
      'revision',(SELECT updated_at FROM public.events WHERE id=p_event_id))
      ||private.enqueue_wizard_invites_on_publish_v1(
        p_event_id,p_invite_selection_revision,p_invite_selection_confirmed);
  END IF;
  RETURN public.biz_trip_command_finish(p_operation_id,v_result);
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 3. Grants, restated exactly as the latest definitions leave them.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION
  public.biz_apply_trip_draft_graph(uuid, jsonb, timestamptz, uuid),
  public.biz_publish_trip_command(uuid, timestamptz, uuid, bigint, boolean)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION
  public.biz_apply_trip_draft_graph(uuid, jsonb, timestamptz, uuid),
  public.biz_publish_trip_command(uuid, timestamptz, uuid, bigint, boolean)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Backfill. Every draft trip that already holds a complete pair of dates in
--    its theme and has no master row gets one. Idempotent: a second run finds
--    nothing to do. A draft whose stored text is not a date, or whose end is
--    not after its start, is skipped rather than failing the migration; the
--    publish owner still names that fault when the organiser tries to publish.
--    `events.updated_at` is deliberately not touched, so an open wizard's
--    saved revision stays valid.
-- ---------------------------------------------------------------------------
DO $backfill$
DECLARE
  r record;
  v_start timestamptz;
  v_end timestamptz;
  v_readable boolean;
  v_written integer := 0;
  v_skipped integer := 0;
BEGIN
  FOR r IN
    SELECT e.id, e.timezone,
           NULLIF(btrim(e.theme#>>'{business_trip,startAt}'), '') AS start_text,
           NULLIF(btrim(e.theme#>>'{business_trip,endAt}'), '') AS end_text
      FROM public.events e
     WHERE e.event_type = 'trip'
       AND e.status = 'draft'
       AND e.deleted_at IS NULL
       AND NULLIF(btrim(e.theme#>>'{business_trip,startAt}'), '') IS NOT NULL
       AND NULLIF(btrim(e.theme#>>'{business_trip,endAt}'), '') IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM public.event_dates d
          WHERE d.event_id = e.id AND d.is_master = true)
  LOOP
    v_readable := true;
    BEGIN
      v_start := r.start_text::timestamptz;
      v_end := r.end_text::timestamptz;
    EXCEPTION
      WHEN invalid_datetime_format OR datetime_field_overflow
           OR invalid_parameter_value OR invalid_text_representation THEN
        v_readable := false;
    END;

    IF v_readable AND v_end > v_start THEN
      INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master)
      VALUES (r.id, v_start, v_end, r.timezone, true);
      v_written := v_written + 1;
    ELSE
      v_skipped := v_skipped + 1;
    END IF;
  END LOOP;
  RAISE NOTICE 'issue #3801 backfill: % draft trip(s) given a master date row, % skipped (dates unreadable or out of order)',
    v_written, v_skipped;
END;
$backfill$;

COMMIT;
