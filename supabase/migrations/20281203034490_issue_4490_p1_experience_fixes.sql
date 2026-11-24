-- #4490 P1 migration 4 — experience creator fixes (spec 01 §6).
--
--   1. Group size: no 50-person cap. ticket_types.group_max is a smallint, so
--      the new ceiling is 32767 (spec asked 100000; widening the column type
--      touches every checkout reader, flagged for review instead).
--   2. Block length: 15-minute steps from 15 minutes to a full day (1440).
--   3. No forced "Standard": a blank price-option name is refused
--      (22023 experience_price_name_required) at every index. Saved rows keep
--      their names. The legacy no-options path is unchanged.
--   4. Shared spots: events.spots_shared (existing rows false, so every live
--      experience keeps per-option counting; new rows true). When on, every
--      option of the experience counts against the same spots. A per_day experience now
--      counts the whole local day, and "Rule A" (one start per day) is gone.
--   5. cover_media_persist_mismatch: publishing with an empty cover URL (a
--      cover video still processing) keeps the server's cover and no longer
--      raises.
--
-- Bodies are the latest definitions (20271122003281, 20271123003281,
-- 20270712001780, and #3645's paid-with-no-priced-option guard from
-- 20280806003645, which this file now runs after) with only the marked #4490
-- changes. Grants are kept by
-- CREATE OR REPLACE. Static SQL. Local stack only until Seth says otherwise.

BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.ticket_types DROP CONSTRAINT ticket_types_price_unit_coherence_check;
ALTER TABLE public.ticket_types
  ADD CONSTRAINT ticket_types_price_unit_coherence_check
  CHECK (
    (
      price_basis = 'person'
      AND block_minutes IS NULL AND min_blocks IS NULL
      AND max_blocks IS NULL AND group_max IS NULL
    )
    OR (
      price_basis = 'group'
      AND group_max IS NOT NULL AND group_max BETWEEN 2 AND 32767
      AND block_minutes IS NULL AND min_blocks IS NULL AND max_blocks IS NULL
    )
    OR (
      price_basis = 'block'
      AND block_minutes IS NOT NULL
      AND block_minutes BETWEEN 15 AND 1440 AND block_minutes % 15 = 0
      AND min_blocks IS NOT NULL AND max_blocks IS NOT NULL
      AND min_blocks >= 1 AND max_blocks >= min_blocks
      AND group_max IS NULL
    )
  );

-- Existing rows take false (per-option counting, as published); every row
-- created after this migration takes true (new experiences share spots,
-- whichever client creates them: Host wizard, Ari, older builds).
ALTER TABLE public.events
  ADD COLUMN spots_shared boolean NOT NULL DEFAULT false;
ALTER TABLE public.events
  ALTER COLUMN spots_shared SET DEFAULT true;
COMMENT ON COLUMN public.events.spots_shared IS
  '#4490: true = every price option of this experience draws from the same spots (no double booking across options). Rows that existed before #4490 were backfilled false (the per-option counting they were published with); new rows default to true. issue_3281_apply_experience_r3_settings accepts spots_shared to change it.';

CREATE OR REPLACE FUNCTION public.issue_3281_apply_experience_price_options(
  p_event_id uuid,
  p_currency text,
  p_pricing_mode text,
  p_legacy_total_cents integer,
  p_capacity integer,
  p_price_options jsonb,
  p_has_sales boolean DEFAULT false
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_opt jsonb;
  v_idx integer := 0;
  v_name text;
  v_price integer;
  v_basis text;
  v_block smallint;
  v_min smallint;
  v_max smallint;
  v_group smallint;
  v_block_in integer;
  v_group_in integer;
  v_cap integer;
  v_hidden boolean;
  v_id uuid;
  v_existing uuid;
  v_first uuid;
  v_count integer;
  v_keep uuid[] := '{}'::uuid[];
  v_sold integer;
  v_old public.ticket_types%ROWTYPE;
  v_online boolean;
BEGIN
  -- Absent / empty / non-array
  IF p_price_options IS NULL
     OR jsonb_typeof(p_price_options) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_price_options) = 0 THEN
    IF p_has_sales THEN
      RAISE EXCEPTION 'price_change_with_sales';
    END IF;
    -- No options key material → legacy single Standard rewrite (create/publish).
    UPDATE public.ticket_types
       SET deleted_at = now()
     WHERE event_id = p_event_id AND deleted_at IS NULL;
    INSERT INTO public.ticket_types (
      event_id, name, description, price_cents, currency,
      quantity_total, is_unlimited, is_free,
      min_purchase_qty, max_purchase_qty,
      is_hidden, is_disabled, requires_approval, allow_transfers,
      password_protected, available_online, available_in_person,
      waitlist_enabled, display_order, price_basis
    ) VALUES (
      p_event_id, 'Standard', NULL, p_legacy_total_cents, p_currency,
      CASE WHEN p_capacity IS NULL OR p_capacity <= 0 THEN NULL ELSE p_capacity END,
      (p_capacity IS NULL OR p_capacity <= 0),
      (p_legacy_total_cents = 0),
      1, NULL,
      false, false, false, true,
      false, true, true,
      false, 0, 'person'
    )
    RETURNING id INTO v_first;
    RETURN v_first;
  END IF;

  v_count := jsonb_array_length(p_price_options);
  IF v_count > 20 THEN
    RAISE EXCEPTION 'experience_price_invalid';
  END IF;
  -- Reject is_free / zero legacy total with a positive-priced option (paid guards
  -- in create/publish key off legacy total; options must not bypass them).
  IF p_legacy_total_cents <= 0 AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_price_options) o
     WHERE COALESCE((o.value->>'price_cents')::integer, 0) > 0
  ) THEN
    RAISE EXCEPTION 'experience_price_invalid';
  END IF;
  -- issue #3645 bundle 2C: the mirror of the rule above. A paid whole-price
  -- experience (positive total) whose options are all 0 has no price: it
  -- would sell free without the host choosing free. Per-stop takes its
  -- price from the stops, so it is not checked here.
  IF p_pricing_mode = 'whole' AND p_legacy_total_cents > 0 AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_price_options) o
     WHERE COALESCE((o.value->>'price_cents')::integer, 0) > 0
  ) THEN
    RAISE EXCEPTION 'experience_price_invalid'
      USING DETAIL = 'issue_3645_2c: paid with no priced option';
  END IF;

  FOR v_opt IN SELECT value FROM jsonb_array_elements(p_price_options)
  LOOP
    -- #4490: every option is named by the host; nothing is called "Standard"
    -- or "Option N" on their behalf (rows saved before keep their names).
    v_name := NULLIF(btrim(COALESCE(v_opt->>'name', '')), '');
    IF v_name IS NULL THEN
      RAISE EXCEPTION 'experience_price_name_required' USING ERRCODE = '22023';
    END IF;
    v_price := COALESCE((v_opt->>'price_cents')::integer, 0);
    IF v_price < 0 THEN RAISE EXCEPTION 'experience_price_invalid'; END IF;
    v_basis := COALESCE(NULLIF(btrim(v_opt->>'price_basis'), ''), 'person');
    IF v_basis NOT IN ('person', 'group', 'block') THEN
      RAISE EXCEPTION 'experience_price_invalid';
    END IF;
    IF v_basis <> 'person' AND p_pricing_mode = 'per_stop' THEN
      RAISE EXCEPTION 'experience_price_invalid';
    END IF;
    -- #4490: read the unit sizes as integers first so an oversize value is a
    -- price error, never a smallint overflow.
    v_block_in := NULLIF(v_opt->>'block_minutes', '')::integer;
    v_min := NULLIF(v_opt->>'min_blocks', '')::smallint;
    v_max := NULLIF(v_opt->>'max_blocks', '')::smallint;
    v_group_in := NULLIF(v_opt->>'group_max', '')::integer;
    v_block := CASE WHEN v_block_in BETWEEN 15 AND 1440 THEN v_block_in::smallint END;
    v_group := CASE WHEN v_group_in BETWEEN 2 AND 32767 THEN v_group_in::smallint END;
    IF v_basis = 'person' THEN
      v_block := NULL; v_min := NULL; v_max := NULL; v_group := NULL;
    ELSIF v_basis = 'group' THEN
      -- #4490: no 50-person cap (group_max is a smallint column: 2..32767).
      IF v_group IS NULL OR v_group < 2 THEN
        RAISE EXCEPTION 'experience_price_invalid';
      END IF;
      v_block := NULL; v_min := NULL; v_max := NULL;
    ELSE
      -- #4490: blocks of 15 minutes up to a full day.
      IF v_block IS NULL OR v_block NOT BETWEEN 15 AND 1440 OR v_block % 15 <> 0 THEN
        RAISE EXCEPTION 'experience_price_invalid';
      END IF;
      IF v_min IS NULL OR v_max IS NULL OR v_min < 1 OR v_max < v_min THEN
        RAISE EXCEPTION 'experience_price_invalid';
      END IF;
      v_group := NULL;
    END IF;
    -- Shared experience capacity owns option caps (wizard Total spots).
    v_cap := p_capacity;
    v_hidden := COALESCE((v_opt->>'is_hidden')::boolean, false);
    -- Unit-aware checkout (#3281 2c, 20271121003281) is live: every basis
    -- (person, group, block) is bookable online and in person.
    v_online := true;

    v_existing := NULLIF(v_opt->>'id', '')::uuid;
    IF v_existing IS NOT NULL THEN
      SELECT * INTO v_old FROM public.ticket_types
       WHERE id = v_existing AND event_id = p_event_id AND deleted_at IS NULL;
      IF FOUND THEN
        SELECT count(*)::integer INTO v_sold
          FROM public.tickets t
         WHERE t.ticket_type_id = v_existing
           AND t.status NOT IN ('void', 'refunded');
        IF p_has_sales OR v_sold > 0 THEN
          IF v_old.price_cents IS DISTINCT FROM v_price
             OR v_old.price_basis IS DISTINCT FROM v_basis
             OR v_old.block_minutes IS DISTINCT FROM v_block
             OR v_old.min_blocks IS DISTINCT FROM v_min
             OR v_old.max_blocks IS DISTINCT FROM v_max
             OR v_old.group_max IS DISTINCT FROM v_group THEN
            RAISE EXCEPTION 'price_change_with_sales';
          END IF;
          -- Sold rows: hide / display_order / capacity only.
          UPDATE public.ticket_types SET
            name = v_name,
            is_hidden = v_hidden,
            display_order = v_idx,
            quantity_total = CASE WHEN v_cap IS NULL OR v_cap <= 0 THEN NULL ELSE v_cap END,
            is_unlimited = (v_cap IS NULL OR v_cap <= 0),
            updated_at = now()
          WHERE id = v_existing;
        ELSE
          UPDATE public.ticket_types SET
            name = v_name,
            price_cents = v_price,
            currency = p_currency,
            quantity_total = CASE WHEN v_cap IS NULL OR v_cap <= 0 THEN NULL ELSE v_cap END,
            is_unlimited = (v_cap IS NULL OR v_cap <= 0),
            is_free = (v_price = 0),
            is_hidden = v_hidden,
            display_order = v_idx,
            price_basis = v_basis,
            block_minutes = v_block,
            min_blocks = v_min,
            max_blocks = v_max,
            group_max = v_group,
            available_online = v_online,
            available_in_person = v_online,
            updated_at = now()
          WHERE id = v_existing;
        END IF;
        v_id := v_existing;
      ELSE
        v_existing := NULL;
      END IF;
    END IF;

    IF v_existing IS NULL THEN
      IF p_has_sales AND v_price IS DISTINCT FROM 0 AND false THEN
        NULL; -- new options allowed with sales (additive)
      END IF;
      INSERT INTO public.ticket_types (
        event_id, name, description, price_cents, currency,
        quantity_total, is_unlimited, is_free,
        min_purchase_qty, max_purchase_qty,
        is_hidden, is_disabled, requires_approval, allow_transfers,
        password_protected, available_online, available_in_person,
        waitlist_enabled, display_order,
        price_basis, block_minutes, min_blocks, max_blocks, group_max
      ) VALUES (
        p_event_id, v_name, NULLIF(btrim(COALESCE(v_opt->>'description','')), ''),
        v_price, p_currency,
        CASE WHEN v_cap IS NULL OR v_cap <= 0 THEN NULL ELSE v_cap END,
        (v_cap IS NULL OR v_cap <= 0),
        (v_price = 0),
        1, NULL,
        v_hidden, false, false, true,
        false, v_online, v_online,
        false, v_idx,
        v_basis, v_block, v_min, v_max, v_group
      )
      RETURNING id INTO v_id;
    END IF;

    v_keep := array_append(v_keep, v_id);
    IF v_first IS NULL THEN v_first := v_id; END IF;
    v_idx := v_idx + 1;
  END LOOP;

  -- Soft-delete options dropped from the payload (never when they have sales).
  FOR v_old IN
    SELECT * FROM public.ticket_types
     WHERE event_id = p_event_id AND deleted_at IS NULL
       AND NOT (id = ANY (v_keep))
  LOOP
    SELECT count(*)::integer INTO v_sold
      FROM public.tickets t
     WHERE t.ticket_type_id = v_old.id
       AND t.status NOT IN ('void', 'refunded');
    IF v_sold > 0 OR p_has_sales THEN
      RAISE EXCEPTION 'price_change_with_sales';
    END IF;
    UPDATE public.ticket_types SET deleted_at = now(), updated_at = now()
     WHERE id = v_old.id;
  END LOOP;

  IF v_first IS NULL THEN
    RAISE EXCEPTION 'experience_price_invalid';
  END IF;
  RETURN v_first;
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_3281_ticket_type_slot_taken(
  p_ticket_type_id uuid,
  p_event_date_id uuid,
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_exclude_session_id uuid DEFAULT NULL
) RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  -- #4490: which price options share the spots, and over what range.
  --   spots_shared: every ticket type of the event counts (no double booking
  --     across options); otherwise this option alone (unchanged).
  --   capacity_scope = per_day: the whole local day of p_start_at counts;
  --     otherwise the [p_start_at, p_end_at) window (unchanged).
  WITH target AS (
    SELECT tt.event_id,
           COALESCE(e.spots_shared, false) AS shared,
           COALESCE(e.capacity_scope, 'total') = 'per_day' AS per_day,
           COALESCE(NULLIF(btrim(e.timezone), ''), 'UTC') AS tz
      FROM public.ticket_types tt
      LEFT JOIN public.events e ON e.id = tt.event_id
     WHERE tt.id = p_ticket_type_id
  ),
  types AS (
    SELECT x.id
      FROM target t
      JOIN public.ticket_types x ON x.event_id = t.event_id
     WHERE t.shared
    UNION
    SELECT p_ticket_type_id
  ),
  range AS (
    SELECT
      CASE WHEN t.per_day
        THEN (date_trunc('day', p_start_at AT TIME ZONE t.tz)) AT TIME ZONE t.tz
        ELSE p_start_at END AS r_start,
      CASE WHEN t.per_day
        THEN (date_trunc('day', p_start_at AT TIME ZONE t.tz) + interval '1 day') AT TIME ZONE t.tz
        ELSE p_end_at END AS r_end
      FROM target t
    UNION ALL
    SELECT p_start_at, p_end_at WHERE NOT EXISTS (SELECT 1 FROM target)
  )
  SELECT COALESCE((
    SELECT COALESCE(SUM(oli.quantity), 0)::integer
      FROM public.orders o
      JOIN public.order_line_items oli ON oli.order_id = o.id
      CROSS JOIN range r
     WHERE oli.ticket_type_id IN (SELECT id FROM types)
       AND o.payment_status IN ('paid', 'partially_paid', 'partial_refund')
       AND o.booked_start_at IS NOT NULL
       AND (p_event_date_id IS NULL OR o.event_date_id IS NULL OR o.event_date_id = p_event_date_id)
       AND o.booked_start_at < r.r_end
       AND COALESCE(o.booked_end_at, o.booked_start_at + interval '30 minutes') > r.r_start
  ), 0)
  + COALESCE((
    SELECT COALESCE(SUM(i.quantity), 0)::integer
      FROM public.ticket_checkout_sessions s
      JOIN public.ticket_checkout_session_items i ON i.checkout_session_id = s.id
      CROSS JOIN range r
     WHERE i.ticket_type_id IN (SELECT id FROM types)
       AND s.expires_at > now()
       AND s.status IN (
         'pending_free',
         'requires_payment',
         'processing_payment',
         'awaiting_web_redirect'
       )
       AND s.order_id IS NULL
       AND s.revoked_at IS NULL
       AND (p_exclude_session_id IS NULL OR s.id <> p_exclude_session_id)
       AND s.booked_start_at IS NOT NULL
       AND s.booked_start_at < r.r_end
       AND COALESCE(s.booked_end_at, s.booked_start_at + interval '30 minutes') > r.r_start
  ), 0);
$function$;

CREATE OR REPLACE FUNCTION public.issue_3281_apply_experience_r3_settings(
  p_event_id uuid,
  p_payload jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_scope text;
  v_spacing integer;
  v_notice integer;
  v_prev_scope text;
  v_prev_spacing integer;
  v_prev_notice integer;
  v_stop jsonb;
  v_order integer;
  v_offset integer;
  v_shared boolean;
BEGIN
  IF p_payload IS NULL THEN
    RETURN;
  END IF;

  SELECT COALESCE(capacity_scope, 'total'),
         COALESCE(booking_spacing_minutes, 30),
         COALESCE(min_notice_minutes, 120)
    INTO v_prev_scope, v_prev_spacing, v_prev_notice
    FROM public.events
   WHERE id = p_event_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Absent keys keep the persisted value so older Host clients cannot reset R3.
  IF (p_payload ? 'capacity_scope') OR (p_payload ? 'capacityScope') THEN
    v_scope := COALESCE(
      NULLIF(p_payload->>'capacity_scope', ''),
      NULLIF(p_payload->>'capacityScope', ''),
      v_prev_scope,
      'total'
    );
  ELSE
    v_scope := COALESCE(v_prev_scope, 'total');
  END IF;
  IF v_scope NOT IN ('total', 'per_day', 'per_start') THEN
    RAISE EXCEPTION 'capacity_scope_invalid';
  END IF;

  IF (p_payload ? 'booking_spacing_minutes')
     OR (p_payload ? 'bookingSpacingMinutes')
     OR (p_payload ? 'spacingMinutes') THEN
    v_spacing := COALESCE(
      NULLIF(p_payload->>'booking_spacing_minutes', '')::integer,
      NULLIF(p_payload->>'bookingSpacingMinutes', '')::integer,
      NULLIF(p_payload->>'spacingMinutes', '')::integer,
      v_prev_spacing,
      30
    );
  ELSE
    v_spacing := COALESCE(v_prev_spacing, 30);
  END IF;
  IF v_spacing NOT IN (15, 30, 60, 120) THEN
    RAISE EXCEPTION 'booking_spacing_invalid';
  END IF;

  IF (p_payload ? 'min_notice_minutes') OR (p_payload ? 'minNoticeMinutes') THEN
    v_notice := COALESCE(
      NULLIF(p_payload->>'min_notice_minutes', '')::integer,
      NULLIF(p_payload->>'minNoticeMinutes', '')::integer,
      v_prev_notice,
      120
    );
  ELSE
    v_notice := COALESCE(v_prev_notice, 120);
  END IF;
  IF v_notice < 0 OR v_notice > 10080 THEN
    RAISE EXCEPTION 'min_notice_invalid';
  END IF;

  -- #4490: Rule A (per_day needed one start per day) is gone. Per-day spots
  -- now count every booking on that local day (issue_3281_ticket_type_slot_taken).

  -- #4490: spots shared across price options. Absent keys keep the stored
  -- value, so older Host clients never flip an existing experience.
  IF (p_payload ? 'spots_shared') OR (p_payload ? 'spotsShared') THEN
    v_shared := COALESCE(
      (p_payload->>'spots_shared')::boolean,
      (p_payload->>'spotsShared')::boolean
    );
  END IF;

  UPDATE public.events SET
    capacity_scope = v_scope,
    booking_spacing_minutes = v_spacing::smallint,
    min_notice_minutes = v_notice,
    spots_shared = COALESCE(v_shared, spots_shared),
    updated_at = now()
  WHERE id = p_event_id;

  IF p_payload ? 'stops' AND jsonb_typeof(p_payload->'stops') = 'array' THEN
    FOR v_stop IN SELECT * FROM jsonb_array_elements(p_payload->'stops')
    LOOP
      v_order := COALESCE((v_stop->>'stop_order')::integer, (v_stop->>'stopOrder')::integer);
      IF v_order IS NULL THEN
        CONTINUE;
      END IF;
      -- Only rewrite offsets when the stop object carries the key (title-only
      -- updates that include a stop snapshot without offsets must not NULL them).
      IF (v_stop ? 'start_offset_minutes') OR (v_stop ? 'startOffsetMinutes') THEN
        v_offset := COALESCE(
          NULLIF(v_stop->>'start_offset_minutes', '')::integer,
          NULLIF(v_stop->>'startOffsetMinutes', '')::integer
        );
        UPDATE public.experience_stops
           SET start_offset_minutes = v_offset
         WHERE event_id = p_event_id AND stop_order = v_order;
      END IF;
    END LOOP;
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_1719_publish_experience_with_poster(
  p_event_id uuid,p_payload jsonb,p_publish boolean DEFAULT false
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $fn$
DECLARE v_result jsonb;v_cover jsonb;v_url text;v_type text;v_poster text;v_has_cover boolean;
  v_payload jsonb;v_invite_revision bigint;v_invite_confirmed boolean;
BEGIN
  IF private.issue_1780_payload_has_forbidden_invite_tail(p_payload) THEN
    RAISE EXCEPTION 'wizard_invite_payload_forbidden' USING ERRCODE='22023';
  END IF;
  v_invite_revision:=NULLIF(p_payload->>'invite_selection_revision','')::bigint;
  v_invite_confirmed:=COALESCE((p_payload->>'invite_selection_confirmed')::boolean,false);
  v_payload:=p_payload-ARRAY['invite_selection_revision','invite_selection_confirmed'];
  v_has_cover:=v_payload ? 'cover';
  IF NOT v_has_cover THEN
    v_result:=public.biz_publish_experience(p_event_id,v_payload,p_publish);
  ELSE
    v_cover:=COALESCE(v_payload->'cover','{}'::jsonb);
    v_url:=NULLIF(v_cover->>'coverMediaUrl','');v_type:=NULLIF(v_cover->>'coverMediaType','');
    IF v_url IS NULL THEN
      -- #4490: no cover URL from the client (a cover video still processing, or
      -- none chosen). biz_publish_experience keeps the server's cover in that
      -- case, so there is no poster to write and nothing to compare.
      v_result:=public.biz_publish_experience(p_event_id,v_payload,p_publish);
    ELSE
      v_poster:=COALESCE(NULLIF(v_cover->>'coverMediaPosterUrl',''),CASE WHEN v_type='image' THEN v_url END);
      PERFORM public.assert_cover_media_triplet(v_url,v_type,v_poster);
      v_result:=public.biz_publish_experience(p_event_id,v_payload,p_publish);
      UPDATE public.events SET cover_media_poster_url=v_poster WHERE id=p_event_id
        AND cover_media_url IS NOT DISTINCT FROM v_url AND cover_media_type IS NOT DISTINCT FROM v_type;
      IF NOT FOUND THEN RAISE EXCEPTION 'cover_media_persist_mismatch';END IF;
    END IF;
  END IF;
  IF p_publish THEN
    v_result:=v_result||private.enqueue_wizard_invites_on_publish_v1(p_event_id,v_invite_revision,v_invite_confirmed);
  END IF;
  RETURN v_result;
END;$fn$;

COMMIT;

-- Reverse (local use only; forward-fix in production): re-apply the
-- 20271120003281 coherence CHECK (only if no row exceeds it), DROP COLUMN
-- events.spots_shared, and re-apply the 20271122003281 / 20271123003281 /
-- 20270712001780 bodies.
