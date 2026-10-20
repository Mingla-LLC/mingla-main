-- issue #3281 Round 2 — one stop is a whole experience; price options on ticket_types.
--
-- 2a: stop gate is 1..5 (was 2..5) on create/publish/live-edit.
-- 2b: additive ticket_types columns (price_basis / block / group) + price_options
--     payload on host RPCs. Absent price_options keeps today's single Standard row.
-- Flag / OTAs: none. Legacy clients that send no price_options stay byte-identical.
--
-- BEFORE MERGE: apply this migration on production (Seth's migration chat).
-- Re-emits biz_create_experience + biz_publish_experience (from #3645 currency
-- source), biz_update_live_experience (from #3281 1c), and Ari payload helpers
-- (from #1973) so stop-count and options share one function body.
-- Invariants live on structural/happy SQL tests (ordinary migrations are
-- not allowed as invariant-declaration owners).

BEGIN;

-- ---------------------------------------------------------------------------
-- 2b columns on ticket_types (defaults preserve person-priced legacy rows)
-- ---------------------------------------------------------------------------
ALTER TABLE public.ticket_types
  ADD COLUMN IF NOT EXISTS price_basis text NOT NULL DEFAULT 'person',
  ADD COLUMN IF NOT EXISTS block_minutes smallint,
  ADD COLUMN IF NOT EXISTS min_blocks smallint,
  ADD COLUMN IF NOT EXISTS max_blocks smallint,
  ADD COLUMN IF NOT EXISTS group_max smallint;

DO $chk$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'ticket_types_price_basis_check'
       AND conrelid = 'public.ticket_types'::regclass
  ) THEN
    ALTER TABLE public.ticket_types
      ADD CONSTRAINT ticket_types_price_basis_check
      CHECK (price_basis IN ('person', 'group', 'block'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'ticket_types_price_unit_coherence_check'
       AND conrelid = 'public.ticket_types'::regclass
  ) THEN
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
          AND group_max IS NOT NULL AND group_max BETWEEN 2 AND 50
          AND block_minutes IS NULL AND min_blocks IS NULL AND max_blocks IS NULL
        )
        OR (
          price_basis = 'block'
          AND block_minutes IS NOT NULL
          AND block_minutes IN (15, 30, 45, 60)
          AND min_blocks IS NOT NULL AND max_blocks IS NOT NULL
          AND min_blocks >= 1 AND max_blocks >= min_blocks
          AND group_max IS NULL
        )
      );
  END IF;
END
$chk$;

COMMENT ON COLUMN public.ticket_types.price_basis IS
  'issue #3281 R2: person | group | block. Legacy rows default person.';
COMMENT ON COLUMN public.ticket_types.block_minutes IS
  'issue #3281 R2: block length when price_basis=block (15/30/45/60).';
COMMENT ON COLUMN public.ticket_types.min_blocks IS
  'issue #3281 R2: shortest hire in blocks when price_basis=block.';
COMMENT ON COLUMN public.ticket_types.max_blocks IS
  'issue #3281 R2: longest hire in blocks when price_basis=block.';
COMMENT ON COLUMN public.ticket_types.group_max IS
  'issue #3281 R2: max party size when price_basis=group (2..50).';


-- ---------------------------------------------------------------------------
-- 2b helper: apply price_options (or legacy single Standard) onto ticket_types
-- ---------------------------------------------------------------------------
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

  FOR v_opt IN SELECT value FROM jsonb_array_elements(p_price_options)
  LOOP
    v_name := NULLIF(btrim(COALESCE(v_opt->>'name', '')), '');
    IF v_name IS NULL THEN
      v_name := CASE WHEN v_idx = 0 THEN 'Standard' ELSE 'Option ' || (v_idx + 1)::text END;
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
    v_block := NULLIF(v_opt->>'block_minutes', '')::smallint;
    v_min := NULLIF(v_opt->>'min_blocks', '')::smallint;
    v_max := NULLIF(v_opt->>'max_blocks', '')::smallint;
    v_group := NULLIF(v_opt->>'group_max', '')::smallint;
    IF v_basis = 'person' THEN
      v_block := NULL; v_min := NULL; v_max := NULL; v_group := NULL;
    ELSIF v_basis = 'group' THEN
      IF v_group IS NULL OR v_group < 2 OR v_group > 50 THEN
        RAISE EXCEPTION 'experience_price_invalid';
      END IF;
      v_block := NULL; v_min := NULL; v_max := NULL;
    ELSE
      IF v_block IS NULL OR v_block NOT IN (15, 30, 45, 60) THEN
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
    -- Until unit-aware checkout (#3281 2c), group/block stay non-bookable online.
    v_online := (v_basis = 'person');

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

REVOKE ALL ON FUNCTION public.issue_3281_apply_experience_price_options(
  uuid, text, text, integer, integer, jsonb, boolean
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3281_apply_experience_price_options(
  uuid, text, text, integer, integer, jsonb, boolean
) TO service_role;

-- ---------------------------------------------------------------------------
-- Re-emit biz_create_experience (2a stop gate 1..5)
-- ---------------------------------------------------------------------------
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

  -- issue #3645: public.supported_brand_currencies owns the list; this
  -- function asks the shared helper and carries no list of its own.
  IF v_currency IS NOT NULL
     AND NOT public.is_supported_offering_currency(v_currency::text) THEN
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
    IF v_stop_count < 1 OR v_stop_count > 5 THEN
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
    -- issue #3645: Organiser Terms 1.0 before a paid experience is created
    -- already published (draft saves and free publishes skip), the same
    -- requirement biz_publish_experience carries.
    PERFORM public.biz_require_current_organiser_terms(v_brand.id);
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

  -- issue #3645: declare a moneyless publish to tg_require_event_brand_currency
  -- (transaction-scoped flag), the way business_publish_event_draft does for a
  -- free event, so a free experience publishes on a brand with no currency yet.
  -- Moneyless = the one ticket resolves to 0 AND no stop that is stored with its
  -- own price carries a positive one. A paid experience never sets it.
  IF p_publish
     AND v_resolved_total <= 0
     AND NOT (
       v_pricing_mode = 'per_stop'
       AND EXISTS (
         SELECT 1
         FROM jsonb_array_elements(v_stops) AS s
         WHERE COALESCE((s->>'price_cents')::integer, 0) > 0
       )
     ) THEN
    PERFORM set_config('mingla.publish_free_only', 'on', true);
  END IF;

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

  -- 10. Ticket types — legacy Standard OR price_options (#3281 R2) --------
  v_ticket_id := public.issue_3281_apply_experience_price_options(
    v_event_id,
    v_currency,
    v_pricing_mode,
    v_resolved_total,
    v_capacity,
    p_payload->'price_options',
    false
  );

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

-- ---------------------------------------------------------------------------
-- Re-emit biz_publish_experience (2a stop gate 1..5)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.biz_publish_experience(p_event_id uuid, p_payload jsonb, p_publish boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id          uuid;
  v_brand            record;
  v_existing         public.events%ROWTYPE;
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
  v_event            public.events%ROWTYPE;
  v_ticket_id        uuid;
  v_had_published    boolean;
  v_shared_place_id     text;
  v_shared_place_addr   text;
  v_shared_city         text;
  v_shared_region       text;
  v_shared_country      text;
  v_shared_lat          double precision;
  v_shared_lng          double precision;
  v_shared_precision    text;          -- issue #1363 G1
  v_idx              integer;
  v_s_place_id       text;
  v_s_address        text;
  v_s_city           text;
  v_s_region         text;
  v_s_country        text;
  v_s_lat            double precision;
  v_s_lng            double precision;
  v_s_precision      text;          -- issue #1363 G1
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
  v_term_kind        text;
  v_when_draft       jsonb;
  v_cover            jsonb;
  v_cover_media_gallery jsonb;  -- issue #868 (additive, independent)
  v_has_cover        boolean;
  v_max_end          timestamptz; -- ORCH-1075: latest end_at across materialised dates
  v_stop_rows        jsonb;
  v_ticket_rows      jsonb;
  v_event_dates_rows jsonb;
BEGIN
  -- 1. Auth ---------------------------------------------------------------
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- 2. Load the existing row + assert it's an editable experience --------
  SELECT * INTO v_existing
  FROM public.events
  WHERE id = p_event_id
    AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'experience_not_found';
  END IF;

  IF v_existing.event_type <> 'experience' THEN
    RAISE EXCEPTION 'event_not_an_experience';
  END IF;

  IF public.biz_brand_effective_rank(v_existing.brand_id, v_user_id)
       < public.biz_role_rank('event_manager'::text) THEN
    RAISE EXCEPTION 'insufficient_event_permission';
  END IF;

  SELECT id, slug, name, default_currency
  INTO v_brand
  FROM public.brands
  WHERE id = v_existing.brand_id
    AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'brand_not_found';
  END IF;

  v_had_published := v_existing.published_at IS NOT NULL;

  -- 3. Validate header ----------------------------------------------------
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

  -- multi-intent (unchanged): payload array, else default to stored array.
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
  ELSIF NOT (p_payload ? 'experience_intents') THEN
    v_intents := v_existing.experience_intents;
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
    NULLIF(v_existing.currency, '')::text,
    v_brand.default_currency::text,
    'USD'
  ))::char(3);

  -- issue #3645: public.supported_brand_currencies owns the list; this
  -- function asks the shared helper and carries no list of its own.
  IF v_currency IS NOT NULL
     AND NOT public.is_supported_offering_currency(v_currency::text) THEN
    RAISE EXCEPTION 'event_currency_unsupported';
  END IF;

  -- 4. Validate modes -----------------------------------------------------
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

  -- 5. Validate stops -----------------------------------------------------
  IF p_publish THEN
    IF v_stop_count < 1 OR v_stop_count > 5 THEN
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
  END LOOP;

  IF p_publish THEN
    IF v_location_mode = 'single' THEN
      -- issue #1363 G1: require a REAL COORDINATE (lat + lng) ONLY. The Mapbox
      -- place_id non-null requirement is dropped — free text yields a real
      -- approximate coordinate with a null place_id. Location coverage is still
      -- guaranteed by lat/lng.
      IF (v_stops->0->>'lat') IS NULL
         OR (v_stops->0->>'lng') IS NULL THEN
        RAISE EXCEPTION 'stop_address_unvalidated';
      END IF;
    ELSE
      FOR v_stop IN SELECT value FROM jsonb_array_elements(v_stops)
      LOOP
        -- issue #1363 G1: lat + lng only (drop the place_id requirement).
        IF (v_stop->>'lat') IS NULL
           OR (v_stop->>'lng') IS NULL THEN
          RAISE EXCEPTION 'stop_address_unvalidated';
        END IF;
      END LOOP;
    END IF;
  END IF;

  -- 6. Resolve the ONE price (I-1 spine) ----------------------------------
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
    v_shared_precision  := NULLIF(v_stops->0->>'coordinate_precision', '');  -- issue #1363 G1
  END IF;

  -- 7. Resolve the date model --------------------------------------------
  v_when_mode := COALESCE(NULLIF(p_payload->>'whenMode', ''), 'single');
  v_when := p_payload->'when';
  v_multi_dates := p_payload->'multiDates';
  v_recurrence_rules := p_payload->'recurrence_rules';
  v_timezone := COALESCE(NULLIF(p_payload->>'timezone', ''), NULLIF(v_existing.timezone, ''), 'UTC');
  v_is_recurring  := (v_when_mode = 'recurring');
  v_is_multi_date := (v_when_mode = 'multi_date');
  v_term_kind := NULLIF(v_recurrence_rules->'termination'->>'kind', '');

  IF p_publish AND v_when_mode NOT IN ('single','multi_date','recurring') THEN
    RAISE EXCEPTION 'event_date_required';
  END IF;

  -- BUG 1 FIX — capture the RAW When inputs so a DRAFT round-trips its
  -- date/time/recurrence/multi selection.
  v_when_draft := jsonb_strip_nulls(jsonb_build_object(
    'whenMode',  v_when_mode,
    'when',      v_when,
    'multiDates', v_multi_dates,
    'recurrence_rules', v_recurrence_rules,
    'timezone',  v_timezone
  ));


  -- ORCH-1075 paid-publish integrity guards (experience publish path) -----
  -- See pg_brand_can_collect() + migration header. PAID publish only; FREE and
  -- draft (p_publish=false) saves are exempt.
  --   Stripe charges_enabled: https://docs.stripe.com/api/accounts/object
  --   Finish onboarding:      https://docs.stripe.com/connect/onboarding.md
  IF p_publish AND NOT v_is_free AND v_resolved_total > 0 THEN
    -- #3645 PR11d — Organiser Terms 1.0 before paid experience publish
    -- (draft saves / free publishes skip).
    PERFORM public.biz_require_current_organiser_terms(v_brand.id);
    IF NOT public.pg_brand_can_collect(v_brand.id) THEN
      -- TRANSITIONAL wire alias; remove only under cleanup issue #1922:
      -- https://github.com/Mingla-LLC/mingla-main/issues/1922
      RAISE EXCEPTION 'stripe_charges_disabled';
    END IF;
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

  -- issue #3645: declare a moneyless publish to tg_require_event_brand_currency
  -- (transaction-scoped flag), the way business_publish_event_draft does for a
  -- free event, so a free experience publishes on a brand with no currency yet.
  -- Moneyless = the one ticket resolves to 0 AND no stop that is stored with its
  -- own price carries a positive one. A paid experience never sets it.
  IF p_publish
     AND v_resolved_total <= 0
     AND NOT (
       v_pricing_mode = 'per_stop'
       AND EXISTS (
         SELECT 1
         FROM jsonb_array_elements(v_stops) AS s
         WHERE COALESCE((s->>'price_cents')::integer, 0) > 0
       )
     ) THEN
    PERFORM set_config('mingla.publish_free_only', 'on', true);
  END IF;

  -- BUG 3 FIX — cover patch. A cover is applied ONLY when the payload carries a
  -- non-empty coverMediaUrl. This preserves a video cover that the CoverPicker
  -- already wrote directly to the row via the draft_auto webhook (the wizard's
  -- cover state may not yet hold the processed URL when Save/Publish fires).
  v_cover := COALESCE(p_payload->'cover', '{}'::jsonb);
  -- issue #868 — ADDITIVE + INDEPENDENT extra-photos gallery (camelCase key on
  -- the cover object, mirroring coverMediaUrl/etc). Default [] = single cover.
  v_cover_media_gallery := COALESCE(v_cover->'coverGallery', '[]'::jsonb);
  v_has_cover := NULLIF(v_cover->>'coverMediaUrl', '') IS NOT NULL;

  -- 8. UPDATE the events row ----------------------------------------------
  UPDATE public.events SET
    title             = v_title,
    description       = v_description,
    currency          = v_currency,
    timezone          = v_timezone,
    location_mode     = v_location_mode,
    pricing_mode      = v_pricing_mode,
    experience_intent = v_intent,
    experience_intents = v_intents,
    whole_price_cents = CASE WHEN v_pricing_mode = 'whole' THEN v_resolved_total ELSE NULL END,
    is_recurring      = v_is_recurring,
    is_multi_date     = v_is_multi_date,
    recurrence_rules  = v_recurrence_rules,
    cover_media_url        = CASE WHEN v_has_cover THEN NULLIF(v_cover->>'coverMediaUrl', '')        ELSE cover_media_url END,
    cover_media_type       = CASE WHEN v_has_cover THEN NULLIF(v_cover->>'coverMediaType', '')       ELSE cover_media_type END,
    cover_media_provider   = CASE WHEN v_has_cover THEN NULLIF(v_cover->>'coverMediaProvider', '')   ELSE cover_media_provider END,
    cover_media_source_url = CASE WHEN v_has_cover THEN NULLIF(v_cover->>'coverMediaSourceUrl', '')  ELSE cover_media_source_url END,
    cover_media_credit     = CASE WHEN v_has_cover THEN NULLIF(v_cover->>'coverMediaCredit', '')     ELSE cover_media_credit END,
    cover_media_credit_url = CASE WHEN v_has_cover THEN NULLIF(v_cover->>'coverMediaCreditUrl', '')  ELSE cover_media_credit_url END,
    cover_media_alt        = CASE WHEN v_has_cover THEN NULLIF(v_cover->>'coverMediaAlt', '')        ELSE cover_media_alt END,
    cover_media_gallery    = v_cover_media_gallery,  -- issue #868 (independent; not gated on v_has_cover)
    pass_tax          = CASE WHEN (p_payload ? 'pass_tax') THEN (p_payload->>'pass_tax')::boolean ELSE pass_tax END,
    pass_mingla_fee   = CASE WHEN (p_payload ? 'pass_mingla_fee') THEN (p_payload->>'pass_mingla_fee')::boolean ELSE pass_mingla_fee END,
    pass_service_fee  = CASE WHEN (p_payload ? 'pass_service_fee') THEN (p_payload->>'pass_service_fee')::boolean ELSE pass_service_fee END,
    -- BUG 5 ROOT CAUSE — the status flip to scheduled/public is DEFERRED to a
    -- second UPDATE in step 11.5, AFTER event_dates is materialised. The
    -- biz_enforce_event_has_master_date trigger (ORCH-0792) fires on the
    -- status transition into scheduled/live and requires a master event_date to
    -- ALREADY exist; flipping status here (before materialisation) raised
    -- event_must_have_master_date on EVERY experience publish — the silent
    -- failure the operator hit. Keep status/visibility/published_at UNCHANGED
    -- in this UPDATE.
    theme             = jsonb_set(
                          jsonb_set(
                            COALESCE(theme, '{}'::jsonb),
                            '{experience_meta,venue_text}',
                            to_jsonb(COALESCE(NULLIF(v_stops->0->>'address', ''), '')),
                            true
                          ),
                          '{experience_meta,when_draft}',
                          v_when_draft,
                          true
                        ),
    updated_at        = v_now
  WHERE id = p_event_id;

  -- 9. REPLACE experience_stops ------------------------------------------
  DELETE FROM public.experience_stops WHERE event_id = p_event_id;

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
      v_s_precision := v_shared_precision;                                 -- issue #1363 G1
    ELSE
      v_s_place_id := NULLIF(v_stop->>'place_id', '');
      v_s_address  := NULLIF(v_stop->>'address', '');
      v_s_city     := NULLIF(v_stop->>'city', '');
      v_s_region   := NULLIF(v_stop->>'region', '');
      v_s_country  := NULLIF(v_stop->>'country_code', '');
      v_s_lat      := NULLIF(v_stop->>'lat', '')::double precision;
      v_s_lng      := NULLIF(v_stop->>'lng', '')::double precision;
      v_s_precision := NULLIF(v_stop->>'coordinate_precision', '');        -- issue #1363 G1
    END IF;

    -- issue #1363 G1: normalize precision — empty/blank/unrecognised → NULL so
    -- the coordinate_precision CHECK only ever sees 'exact' | 'approximate' | NULL
    -- (a stale client sending a bad value can never break publish).
    IF v_s_precision IS NOT NULL
       AND v_s_precision NOT IN ('exact', 'approximate') THEN
      v_s_precision := NULL;
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
      coordinate_precision                                    -- issue #1363 G1
    ) VALUES (
      p_event_id,
      COALESCE((v_stop->>'stop_order')::integer, v_idx),
      v_s_place_id,
      btrim(v_stop->>'place_name'),
      COALESCE(v_s_address, ''),
      v_s_city, v_s_region, v_s_country, v_s_lat, v_s_lng,
      v_s_images, v_s_start, v_s_price,
      COALESCE(NULLIF(btrim(v_stop->>'ai_description'), ''), ''),
      v_s_precision                                           -- issue #1363 G1
    );
    v_idx := v_idx + 1;
  END LOOP;

  -- 10. Ticket types — legacy Standard OR price_options (#3281 R2) --------
  v_ticket_id := public.issue_3281_apply_experience_price_options(
    p_event_id,
    v_currency,
    v_pricing_mode,
    v_resolved_total,
    v_capacity,
    p_payload->'price_options',
    false
  );

  -- 11. Materialise event_dates (PUBLISH only — I-4) ----------------------
  IF p_publish THEN
    DELETE FROM public.event_dates WHERE event_id = p_event_id;

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
      -- FEATURE never-ends: 'never' rule materialises EXACTLY the master
      -- (first) occurrence — rule carries the repeat, engine needs >=1 date.
      INSERT INTO public.event_dates (event_id, start_at, end_at, timezone, is_master)
      VALUES (p_event_id, v_start, v_end, v_timezone, true);

      -- ORCH-1138 Leg 3 (§4.6) — RECURRENCE MATERIALISATION. The master row is
      -- inserted above; for a `recurring` rule, expand the 2nd..Nth bookable
      -- occurrences into real event_dates rows (bounded 52-cap, OQ-1; NO cron) so
      -- the buyer can reserve every occurrence (not just the first). single-mode
      -- and never-without-a-daily-preset stay master-only. I-4 preserved (publish-
      -- time materialisation). Self-contained expander; no checkout change.
      IF v_when_mode = 'recurring' AND v_recurrence_rules IS NOT NULL THEN
        PERFORM public.pg_expand_experience_recurrence(
          p_event_id, v_start, v_end, v_recurrence_rules, v_timezone
        );

        -- ORCH-1153 WS1 publish-time DRAIN GUARD (I-PROPOSED-1153-NO-DRAIN).
        -- A recurring publish must never land in a zero-future-occurrence state
        -- (the casualty class). If, after materialisation, the experience has no
        -- future event_dates AND the rule is NOT count-exhausted / until-expired,
        -- the master was anchored in the past with a non-productive rule → block
        -- the publish (mirrors the ORCH-1075 paid-publish guard). count/until
        -- rules whose window has legitimately closed are EXEMPT (a finite series
        -- that has ended is allowed to publish read-only).
        IF NOT EXISTS (
              SELECT 1 FROM public.event_dates ed
              WHERE ed.event_id = p_event_id AND ed.start_at > v_now
            )
           AND NOT public.pg_recurrence_is_terminated(v_recurrence_rules, p_event_id, v_now)
        THEN
          RAISE EXCEPTION 'recurring_experience_has_no_future_occurrences';
        END IF;
      END IF;
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
        VALUES (p_event_id, v_start, v_end, v_timezone, v_start = v_min_start);
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
      WHERE id = p_event_id;
    END IF;

    -- 11.5 DEFERRED status flip (BUG 5 ROOT CAUSE). Now that the master
    -- event_date exists, promote the row to scheduled/public — the
    -- biz_enforce_event_has_master_date trigger (ORCH-0792) now passes. Doing
    -- this AFTER materialisation is what makes experience publish succeed.
    UPDATE public.events
    SET status       = 'scheduled',
        visibility   = 'public',
        published_at = COALESCE(published_at, v_now),
        updated_at   = v_now
    WHERE id = p_event_id;
  END IF;

  -- 12. Build the return payload -------------------------------------------
  SELECT * INTO v_event FROM public.events WHERE id = p_event_id;

  SELECT COALESCE(jsonb_agg(to_jsonb(es) ORDER BY es.stop_order), '[]'::jsonb)
  INTO v_stop_rows
  FROM public.experience_stops es
  WHERE es.event_id = p_event_id;

  SELECT COALESCE(jsonb_agg(to_jsonb(tt) ORDER BY tt.display_order), '[]'::jsonb)
  INTO v_ticket_rows
  FROM public.ticket_types tt
  WHERE tt.event_id = p_event_id
    AND tt.deleted_at IS NULL;

  SELECT COALESCE(jsonb_agg(to_jsonb(ed) ORDER BY ed.start_at), '[]'::jsonb)
  INTO v_event_dates_rows
  FROM public.event_dates ed
  WHERE ed.event_id = p_event_id;

  RETURN jsonb_build_object(
    'event', to_jsonb(v_event),
    'brand', jsonb_build_object('id', v_brand.id, 'slug', v_brand.slug, 'name', v_brand.name),
    'stops', v_stop_rows,
    'ticket', (v_ticket_rows->0),
    'tickets', v_ticket_rows,
    'eventDates', v_event_dates_rows
  );
END;
$function$
;

-- ---------------------------------------------------------------------------
-- Re-emit biz_update_live_experience (2a stop gate 1..5)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.biz_update_live_experience(p_event_id uuid, p_payload jsonb, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  -- issue #3827 buyer email [H0 notice-declare]
  v_notice jsonb;
  v_user_id          uuid;
  v_existing         public.events%ROWTYPE;
  v_brand            record;
  v_now              timestamptz := now();
  v_trimmed_reason   text;
  v_total_sold       int;
  -- header / modes
  v_title            text;
  v_description      text;
  v_intents          text[];
  v_intent           text;
  v_currency         char(3);
  v_location_mode    text;
  v_pricing_mode     text;
  v_is_free          boolean;
  v_capacity         integer;
  v_whole_price      integer;
  v_resolved_total   integer;
  v_old_resolved     integer;
  -- stops
  v_stops            jsonb;
  v_stop_count       integer;
  v_stop             jsonb;
  v_existing_stop_keys text[];
  v_new_stop_keys    text[];
  v_dropped_stops    text[];
  -- single-mode shared place
  v_shared_place_id     text;
  v_shared_place_addr   text;
  v_shared_city         text;
  v_shared_region       text;
  v_shared_country      text;
  v_shared_lat          double precision;
  v_shared_lng          double precision;
  v_idx              integer;
  v_s_place_id       text;
  v_s_address        text;
  v_s_city           text;
  v_s_region         text;
  v_s_country        text;
  v_s_lat            double precision;
  v_s_lng            double precision;
  v_s_images         text[];
  v_s_start          time;
  v_s_price          integer;
  -- dates
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
  v_new_date_starts  timestamptz[];
  v_old_date_starts  timestamptz[];
  v_old_date_ends    timestamptz[];
  v_new_date_ends    timestamptz[];
  v_max_end          timestamptz; -- ORCH-1075: latest end_at across edited dates
  v_dates_changed    boolean := false;
  -- audit
  v_severity         text;
  v_changed_keys     text[];
  v_log_id           uuid;
  v_affected_order_ids uuid[];
  -- return
  v_event            public.events%ROWTYPE;
  v_stop_rows        jsonb;
  v_ticket_rows      jsonb;
  v_event_dates_rows jsonb;
  -- issue #3281 1c — reconcile-in-place scratch
  v_stop_id          uuid;
  v_keep_stop_orders integer[] := '{}'::integer[];
  v_stop_order       integer;
  v_date_id          uuid;
  v_keep_date_ids    uuid[] := '{}'::uuid[];
  v_hold             text;
  v_master_id        uuid;
  v_existing_master_start timestamptz;
  v_existing_master_end   timestamptz;
  v_seed_unchanged   boolean := false;
BEGIN
  -- ---------- 1. Auth + reason ----------
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  v_trimmed_reason := btrim(COALESCE(p_reason, ''));
  IF v_trimmed_reason = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_edit_reason');
  END IF;
  IF char_length(v_trimmed_reason) < 10 OR char_length(v_trimmed_reason) > 200 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_edit_reason');
  END IF;

  -- ---------- 2. Load + permission + status gate ----------
  SELECT * INTO v_existing
  FROM public.events
  WHERE id = p_event_id
    AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'experience_not_found';
  END IF;

  IF v_existing.event_type <> 'experience' THEN
    RAISE EXCEPTION 'event_not_an_experience'
      USING HINT = 'biz_update_live_experience only handles event_type=experience rows.';
  END IF;

  IF v_existing.status NOT IN ('scheduled', 'live') THEN
    -- Draft edits NEVER route here; non-live statuses are rejected so the live
    -- guards can never trip a draft.
    RETURN jsonb_build_object('ok', false, 'reason', 'experience_not_editable_status');
  END IF;

  IF public.biz_brand_effective_rank(v_existing.brand_id, v_user_id)
       < public.biz_role_rank('event_manager'::text) THEN
    RAISE EXCEPTION 'insufficient_event_permission';
  END IF;

  SELECT id, slug, name, default_currency
  INTO v_brand
  FROM public.brands
  WHERE id = v_existing.brand_id
    AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'brand_not_found';
  END IF;

  -- ---------- 3. Sold-count context ----------
  v_total_sold := public.biz_experience_sold_count(p_event_id);

  -- ---------- 4. Parse payload (mirror biz_publish_experience) ----------
  v_title := NULLIF(btrim(COALESCE(p_payload->>'title', '')), '');
  IF v_title IS NULL THEN
    RAISE EXCEPTION 'experience_title_required';
  END IF;
  v_description := NULLIF(btrim(COALESCE(p_payload->>'description', '')), '');
  IF v_description IS NULL OR char_length(v_description) < 10 OR char_length(v_description) > 500 THEN
    RAISE EXCEPTION 'experience_description_invalid';
  END IF;

  -- META-ORCH-1059 Sub-E FIX (live-edit dropped the vibe): persist curated
  -- experience_intents on edit, mirroring biz_publish_experience. The wizard
  -- sends p_payload->'experience_intents' (1-4 of the 4 brand ids); validate +
  -- require >=1 so a live/published experience stays deck-eligible. Key absent
  -- => leave existing intents unchanged.
  IF jsonb_typeof(p_payload->'experience_intents') = 'array' THEN
    SELECT array_agg(DISTINCT btrim(elem))
      INTO v_intents
      FROM jsonb_array_elements_text(p_payload->'experience_intents') AS elem
     WHERE btrim(elem) <> '';
  ELSIF p_payload ? 'experience_intent'
        AND NULLIF(btrim(p_payload->>'experience_intent'), '') IS NOT NULL THEN
    v_intents := ARRAY[btrim(p_payload->>'experience_intent')];
  ELSE
    v_intents := v_existing.experience_intents;
  END IF;
  IF v_intents IS NOT NULL
     AND NOT (v_intents <@ ARRAY['adventurous','first-date','romantic','group-fun']::text[]) THEN
    RAISE EXCEPTION 'experience_intent_invalid';
  END IF;
  IF v_intents IS NULL OR array_length(v_intents, 1) IS NULL THEN
    RAISE EXCEPTION 'experience_intent_required';
  END IF;
  v_intent := v_intents[1];

  v_currency := upper(COALESCE(
    NULLIF(p_payload->>'currency', ''),
    NULLIF(v_existing.currency, '')::text,
    v_brand.default_currency::text,
    'USD'
  ))::char(3);

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

  -- Live experiences are published: enforce the same 2–5 stop gate.
  IF v_stop_count < 1 OR v_stop_count > 5 THEN
    RAISE EXCEPTION 'experience_stop_count_invalid';
  END IF;

  FOR v_stop IN SELECT value FROM jsonb_array_elements(v_stops)
  LOOP
    IF NULLIF(btrim(COALESCE(v_stop->>'place_name', '')), '') IS NULL THEN
      RAISE EXCEPTION 'stop_name_required';
    END IF;
    IF (v_stop->'image_urls') IS NOT NULL
       AND jsonb_typeof(v_stop->'image_urls') = 'array'
       AND jsonb_array_length(v_stop->'image_urls') > 5 THEN
      RAISE EXCEPTION 'stop_too_many_images';
    END IF;
    IF COALESCE((v_stop->>'price_cents')::integer, 0) < 0 THEN
      RAISE EXCEPTION 'experience_price_invalid';
    END IF;
  END LOOP;

  -- Resolve the new ONE-ticket total (I-1).
  v_resolved_total :=
    CASE
      WHEN v_is_free THEN 0
      WHEN v_pricing_mode = 'whole' THEN v_whole_price
      ELSE (
        SELECT COALESCE(sum(COALESCE((s->>'price_cents')::integer, 0)), 0)
        FROM jsonb_array_elements(v_stops) s
      )
    END;

  -- ---------- 5. REFUND-GATE (only when sold > 0, except capacity) ----------

  -- 5a. Capacity can't drop below sold (applies whenever capacity present).
  IF (p_payload ? 'capacity') AND v_capacity IS NOT NULL AND v_capacity < v_total_sold THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'capacity_below_sold',
      'affected_order_count', v_total_sold
    );
  END IF;

  IF v_total_sold > 0 THEN
    -- 5b. Price lock — the ONE ticket's resolved price can't change once sold.
    SELECT price_cents INTO v_old_resolved
    FROM public.ticket_types
    WHERE event_id = p_event_id AND deleted_at IS NULL
    ORDER BY display_order ASC
    LIMIT 1;
    v_old_resolved := COALESCE(v_old_resolved, 0);

    IF v_resolved_total IS DISTINCT FROM v_old_resolved THEN
      RETURN jsonb_build_object(
        'ok', false,
        'reason', 'price_change_with_sales',
        'affected_order_count', v_total_sold
      );
    END IF;

    -- 5c. Stop removal — removing an existing (by name) stop is destructive.
    SELECT array_agg(lower(btrim(place_name)))
      INTO v_existing_stop_keys
      FROM public.experience_stops
      WHERE event_id = p_event_id;
    v_existing_stop_keys := COALESCE(v_existing_stop_keys, '{}'::text[]);

    SELECT array_agg(lower(btrim(s->>'place_name')))
      INTO v_new_stop_keys
      FROM jsonb_array_elements(v_stops) s;
    v_new_stop_keys := COALESCE(v_new_stop_keys, '{}'::text[]);

    v_dropped_stops := (
      SELECT COALESCE(array_agg(k), '{}'::text[])
      FROM unnest(v_existing_stop_keys) k
      WHERE NOT (k = ANY (v_new_stop_keys))
    );

    IF array_length(v_dropped_stops, 1) > 0 THEN
      RETURN jsonb_build_object(
        'ok', false,
        'reason', 'stop_removed_with_sales',
        'affected_order_count', v_total_sold,
        'dropped_stops', to_jsonb(v_dropped_stops)
      );
    END IF;
  END IF;

  -- ---------- 6. Resolve the date model + date-shift gate ----------
  v_when_mode := COALESCE(NULLIF(p_payload->>'whenMode', ''), 'single');
  v_when := p_payload->'when';
  v_multi_dates := p_payload->'multiDates';
  v_recurrence_rules := p_payload->'recurrence_rules';
  v_timezone := COALESCE(NULLIF(p_payload->>'timezone', ''), NULLIF(v_existing.timezone, ''), 'UTC');
  v_is_recurring  := (v_when_mode = 'recurring');
  v_is_multi_date := (v_when_mode = 'multi_date');

  -- ORCH-1153 WS1 SEED-HARDENING (F-4). A stale client seed can send a recurring
  -- whenMode but a NULL recurrence_rules (e.g. firstRecurrenceRule returned null
  -- on an unexpected jsonb shape). Below, date reconcile + expand only run when
  -- recurrence_rules IS NOT NULL — so a dropped rule would leave the series
  -- without fresh children. Re-derive the rule from the PERSISTED
  -- events.recurrence_rules rather than draining the series. Net: a live-edit
  -- that omits the rule can never silently drain a recurring series.
  IF v_is_recurring
     AND v_recurrence_rules IS NULL
     AND v_existing.is_recurring = true
     AND v_existing.recurrence_rules IS NOT NULL THEN
    v_recurrence_rules := v_existing.recurrence_rules;
  END IF;

  IF v_when_mode NOT IN ('single','multi_date','recurring') THEN
    RAISE EXCEPTION 'event_date_required';
  END IF;

  -- Build the proposed occurrence start/end arrays (sorted by start).
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
    v_new_date_starts := ARRAY[v_start];
    v_new_date_ends   := ARRAY[v_end];
  ELSE
    IF v_multi_dates IS NULL
       OR jsonb_typeof(v_multi_dates) IS DISTINCT FROM 'array'
       OR jsonb_array_length(v_multi_dates) = 0 THEN
      RAISE EXCEPTION 'event_date_required';
    END IF;
    v_new_date_starts := '{}'::timestamptz[];
    v_new_date_ends := '{}'::timestamptz[];
    FOR v_date_entry IN
      SELECT value FROM jsonb_array_elements(v_multi_dates)
      ORDER BY (value->>'date'), (value->>'startTime')
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
      v_new_date_starts := v_new_date_starts || v_start;
      v_new_date_ends := v_new_date_ends || v_end;
    END LOOP;
  END IF;


  -- ORCH-1075 paid-publish integrity guards (experience live-edit) --------
  -- Q3: block ANY resulting PAID state while not Stripe-ready (free->paid AND
  -- paid->paid), and block shifting onto an already-past date. Structured
  -- return shape matches this RPC. FREE edits are exempt.
  --   Stripe charges_enabled: https://docs.stripe.com/api/accounts/object
  --   Finish onboarding:      https://docs.stripe.com/connect/onboarding.md
  IF NOT v_is_free AND v_resolved_total > 0 THEN
    IF NOT public.pg_brand_can_collect(v_brand.id) THEN
      -- TRANSITIONAL wire alias; remove only under cleanup issue #1922:
      -- https://github.com/Mingla-LLC/mingla-main/issues/1922
      RETURN jsonb_build_object('ok', false, 'reason', 'stripe_charges_disabled');
    END IF;
    SELECT max(d) INTO v_max_end FROM unnest(v_new_date_ends) AS d;
    IF v_max_end IS NULL OR v_max_end <= v_now THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'offering_date_past');
    END IF;
  END IF;

  -- Date-shift gate (only with sales). Compare against current event_dates.
  -- issue #3281 1c: for recurring, only the master seed is in the payload; expanded
  -- children must not count as a shift on a title/price-neutral live edit.
  IF v_total_sold > 0 THEN
    IF v_when_mode = 'recurring' THEN
      SELECT array_agg(start_at ORDER BY start_at), array_agg(end_at ORDER BY start_at)
        INTO v_old_date_starts, v_old_date_ends
        FROM public.event_dates
        WHERE event_id = p_event_id AND is_master = true;
    ELSE
      SELECT array_agg(start_at ORDER BY start_at), array_agg(end_at ORDER BY start_at)
        INTO v_old_date_starts, v_old_date_ends
        FROM public.event_dates
        WHERE event_id = p_event_id;
    END IF;
    v_old_date_starts := COALESCE(v_old_date_starts, '{}'::timestamptz[]);
    v_old_date_ends   := COALESCE(v_old_date_ends, '{}'::timestamptz[]);

    IF COALESCE(array_length(v_old_date_starts, 1), 0)
         IS DISTINCT FROM COALESCE(array_length(v_new_date_starts, 1), 0) THEN
      v_dates_changed := true;
    ELSE
      FOR v_idx IN 1 .. COALESCE(array_length(v_old_date_starts, 1), 0)
      LOOP
        IF v_old_date_starts[v_idx] IS DISTINCT FROM v_new_date_starts[v_idx]
           OR v_old_date_ends[v_idx] IS DISTINCT FROM v_new_date_ends[v_idx] THEN
          v_dates_changed := true;
          EXIT;
        END IF;
      END LOOP;
    END IF;

    IF v_dates_changed THEN
      RETURN jsonb_build_object(
        'ok', false,
        'reason', 'dates_shifted_with_sales',
        'affected_order_count', v_total_sold,
        'dropped_dates', (
          SELECT COALESCE(jsonb_agg(to_char(d AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')), '[]'::jsonb)
          FROM unnest(v_old_date_starts) d
        )
      );
    END IF;
  END IF;

  -- ---------- 7. APPLY (all gates passed) ----------
  IF v_location_mode = 'single' AND v_stop_count > 0 THEN
    v_shared_place_id   := NULLIF(v_stops->0->>'place_id', '');
    v_shared_place_addr := NULLIF(v_stops->0->>'address', '');
    v_shared_city       := NULLIF(v_stops->0->>'city', '');
    v_shared_region     := NULLIF(v_stops->0->>'region', '');
    v_shared_country    := NULLIF(v_stops->0->>'country_code', '');
    v_shared_lat        := NULLIF(v_stops->0->>'lat', '')::double precision;
    v_shared_lng        := NULLIF(v_stops->0->>'lng', '')::double precision;
  END IF;

  UPDATE public.events SET
    title             = v_title,
    description       = v_description,
    experience_intents = v_intents,
    experience_intent  = v_intent,
    currency          = v_currency,
    timezone          = v_timezone,
    location_mode     = v_location_mode,
    pricing_mode      = v_pricing_mode,
    whole_price_cents = CASE WHEN v_pricing_mode = 'whole' THEN v_resolved_total ELSE NULL END,
    is_recurring      = v_is_recurring,
    is_multi_date     = v_is_multi_date,
    recurrence_rules  = v_recurrence_rules,
    pass_tax          = CASE WHEN (p_payload ? 'pass_tax') THEN (p_payload->>'pass_tax')::boolean ELSE pass_tax END,
    pass_mingla_fee   = CASE WHEN (p_payload ? 'pass_mingla_fee') THEN (p_payload->>'pass_mingla_fee')::boolean ELSE pass_mingla_fee END,
    pass_service_fee  = CASE WHEN (p_payload ? 'pass_service_fee') THEN (p_payload->>'pass_service_fee')::boolean ELSE pass_service_fee END,
    theme             = jsonb_set(
                          COALESCE(theme, '{}'::jsonb),
                          '{experience_meta,venue_text}',
                          to_jsonb(COALESCE(NULLIF(v_stops->0->>'address', ''), '')),
                          true
                        ),
    updated_at        = v_now
  WHERE id = p_event_id;

  -- issue #3281 1c — reconcile experience_stops in place (match by stop_order).
  -- Kept ids matter for R2/R3 per-stop address choice; never DELETE+reinsert.
  v_idx := 0;
  v_keep_stop_orders := '{}'::integer[];
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
    ELSE
      v_s_place_id := NULLIF(v_stop->>'place_id', '');
      v_s_address  := NULLIF(v_stop->>'address', '');
      v_s_city     := NULLIF(v_stop->>'city', '');
      v_s_region   := NULLIF(v_stop->>'region', '');
      v_s_country  := NULLIF(v_stop->>'country_code', '');
      v_s_lat      := NULLIF(v_stop->>'lat', '')::double precision;
      v_s_lng      := NULLIF(v_stop->>'lng', '')::double precision;
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
    v_stop_order := COALESCE((v_stop->>'stop_order')::integer, v_idx);

    UPDATE public.experience_stops SET
      place_id     = v_s_place_id,
      place_name   = btrim(v_stop->>'place_name'),
      address      = COALESCE(v_s_address, ''),
      city         = v_s_city,
      region       = v_s_region,
      country_code = v_s_country,
      lat          = v_s_lat,
      lng          = v_s_lng,
      image_urls   = v_s_images,
      start_time   = v_s_start,
      price_cents  = v_s_price,
      ai_description = COALESCE(NULLIF(v_stop->>'ai_description', ''), '')
    WHERE event_id = p_event_id AND stop_order = v_stop_order
    RETURNING id INTO v_stop_id;

    IF v_stop_id IS NULL THEN
      INSERT INTO public.experience_stops (
        event_id, stop_order, place_id, place_name, address,
        city, region, country_code, lat, lng,
        image_urls, start_time, price_cents, ai_description
      ) VALUES (
        p_event_id,
        v_stop_order,
        v_s_place_id,
        btrim(v_stop->>'place_name'),
        COALESCE(v_s_address, ''),
        v_s_city, v_s_region, v_s_country, v_s_lat, v_s_lng,
        v_s_images, v_s_start, v_s_price,
        COALESCE(NULLIF(v_stop->>'ai_description', ''), '')
      );
    END IF;

    v_keep_stop_orders := v_keep_stop_orders || v_stop_order;
    v_stop_id := NULL;
    v_idx := v_idx + 1;
  END LOOP;

  DELETE FROM public.experience_stops
   WHERE event_id = p_event_id
     AND NOT (stop_order = ANY (v_keep_stop_orders));

  -- Rewrite the ONE ticket (I-1). Preserve identity by UPDATEing the live ticket
  -- in place (so existing order_line_items.ticket_type_id stays valid) rather
  -- than soft-delete + insert.
  -- Ticket types — legacy Standard OR price_options (#3281 R2)
  -- Refuse option rewrite when sales exist and payload names price_options
  -- with a unit/price change; additive-only live edits omit price_options and
  -- keep the existing Standard row update below via the helper's sales guard.
  IF p_payload ? 'price_options' THEN
    PERFORM public.issue_3281_apply_experience_price_options(
      p_event_id,
      v_currency,
      v_pricing_mode,
      v_resolved_total,
      v_capacity,
      p_payload->'price_options',
      (v_total_sold > 0)
    );
  ELSE
    -- Omission: never flatten multi-option experiences. Legacy single-ticket
    -- experiences still get the Standard in-place update.
    IF (SELECT count(*) FROM public.ticket_types
         WHERE event_id = p_event_id AND deleted_at IS NULL) <= 1 THEN
      UPDATE public.ticket_types SET
        name           = 'Standard',
        price_cents    = v_resolved_total,
        currency       = v_currency,
        quantity_total = CASE WHEN v_capacity IS NULL OR v_capacity <= 0 THEN NULL ELSE v_capacity END,
        is_unlimited   = (v_capacity IS NULL OR v_capacity <= 0),
        is_free        = (v_resolved_total = 0),
        updated_at     = v_now
      WHERE event_id = p_event_id
        AND deleted_at IS NULL;
    ELSE
      UPDATE public.ticket_types SET
        currency       = v_currency,
        quantity_total = CASE WHEN v_capacity IS NULL OR v_capacity <= 0 THEN NULL ELSE v_capacity END,
        is_unlimited   = (v_capacity IS NULL OR v_capacity <= 0),
        updated_at     = v_now
      WHERE event_id = p_event_id
        AND deleted_at IS NULL;
    END IF;
  END IF;

  -- issue #3281 1c — reconcile event_dates in place (match by start_at; P3 for
  -- single/recurring one-occurrence moves). Held rows never deleted
  -- (issue_3285_event_date_hold_reason). Recurring children survive when the
  -- master seed is unchanged; the expander skips existing starts.
  v_min_start := NULL;
  FOR v_idx IN 1 .. COALESCE(array_length(v_new_date_starts, 1), 0)
  LOOP
    IF v_min_start IS NULL OR v_new_date_starts[v_idx] < v_min_start THEN
      v_min_start := v_new_date_starts[v_idx];
    END IF;
  END LOOP;

  SELECT ed.start_at, ed.end_at INTO v_existing_master_start, v_existing_master_end
    FROM public.event_dates ed
   WHERE ed.event_id = p_event_id AND ed.is_master = true
   ORDER BY ed.start_at, ed.id
   LIMIT 1;
  v_seed_unchanged := (
    v_when_mode = 'recurring'
    AND v_existing_master_start IS NOT DISTINCT FROM v_start
    AND v_existing_master_end IS NOT DISTINCT FROM v_end
  );

  v_keep_date_ids := '{}'::uuid[];
  FOR v_idx IN 1 .. COALESCE(array_length(v_new_date_starts, 1), 0)
  LOOP
    v_date_id := NULL;
    SELECT ed.id INTO v_date_id
      FROM public.event_dates ed
     WHERE ed.event_id = p_event_id
       AND ed.start_at = v_new_date_starts[v_idx]
       AND NOT (ed.id = ANY (v_keep_date_ids))
     ORDER BY ed.id
     LIMIT 1;

    -- P3: a single/recurring experience's one seed occurrence keeps its id when
    -- its start moves (unsold path only; sold shifts are gated above).
    IF v_date_id IS NULL
       AND v_when_mode IN ('single', 'recurring')
       AND COALESCE(array_length(v_new_date_starts, 1), 0) = 1 THEN
      SELECT ed.id INTO v_date_id
        FROM public.event_dates ed
       WHERE ed.event_id = p_event_id
         AND ed.is_master = true
         AND NOT (ed.id = ANY (v_keep_date_ids))
       ORDER BY ed.start_at, ed.id
       LIMIT 1;
      IF v_date_id IS NULL THEN
        SELECT ed.id INTO v_date_id
          FROM public.event_dates ed
         WHERE ed.event_id = p_event_id
           AND NOT (ed.id = ANY (v_keep_date_ids))
         ORDER BY ed.start_at, ed.id
         LIMIT 1;
      END IF;
    END IF;

    IF v_date_id IS NOT NULL THEN
      UPDATE public.event_dates
         SET start_at = v_new_date_starts[v_idx],
             end_at = v_new_date_ends[v_idx],
             timezone = v_timezone
       WHERE id = v_date_id
         AND (start_at, end_at, timezone) IS DISTINCT FROM
             (v_new_date_starts[v_idx], v_new_date_ends[v_idx], v_timezone);
      v_keep_date_ids := v_keep_date_ids || v_date_id;
    ELSE
      INSERT INTO public.event_dates (event_id, start_at, end_at, timezone, is_master)
      VALUES (
        p_event_id, v_new_date_starts[v_idx], v_new_date_ends[v_idx], v_timezone,
        v_new_date_starts[v_idx] = v_min_start
      )
      RETURNING id INTO v_date_id;
      v_keep_date_ids := v_keep_date_ids || v_date_id;
    END IF;
  END LOOP;

  -- Recurring children: keep when the master seed is unchanged.
  IF v_seed_unchanged THEN
    SELECT COALESCE(v_keep_date_ids, '{}'::uuid[])
           || COALESCE(array_agg(ed.id), '{}'::uuid[])
      INTO v_keep_date_ids
      FROM public.event_dates ed
     WHERE ed.event_id = p_event_id
       AND ed.is_master = false
       AND NOT (ed.id = ANY (COALESCE(v_keep_date_ids, '{}'::uuid[])));
  END IF;

  -- Remove only unheld rows that are not in the keep set.
  FOR v_date_id IN
    SELECT ed.id FROM public.event_dates ed
     WHERE ed.event_id = p_event_id
       AND NOT (ed.id = ANY (v_keep_date_ids))
  LOOP
    v_hold := public.issue_3285_event_date_hold_reason(v_date_id);
    IF v_hold IS NOT NULL THEN
      RAISE EXCEPTION 'multi_date_remove_with_sales'
        USING DETAIL = format('issue #3281: occurrence %s is held (%s)', v_date_id, v_hold);
    END IF;
    DELETE FROM public.ticket_event_dates ted
     USING public.tickets t
     WHERE t.id = ted.ticket_id
       AND ted.event_date_id = v_date_id
       AND t.status NOT IN ('valid', 'used', 'transferred', 'refund_pending');
    DELETE FROM public.event_dates WHERE id = v_date_id;
  END LOOP;

  -- Exactly one master = the earliest occurrence.
  SELECT ed.id INTO v_master_id
    FROM public.event_dates ed
   WHERE ed.event_id = p_event_id
   ORDER BY ed.start_at, ed.id
   LIMIT 1;
  UPDATE public.event_dates
     SET is_master = false
   WHERE event_id = p_event_id
     AND is_master
     AND id IS DISTINCT FROM v_master_id;
  IF v_master_id IS NOT NULL THEN
    UPDATE public.event_dates SET is_master = true WHERE id = v_master_id AND NOT is_master;
  END IF;

  v_next_occurrence := v_min_start;

  -- ORCH-1138 Leg 3 (§4.6) — RECURRENCE MATERIALISATION on live-edit. Seed
  -- row(s) are reconciled above; for a `recurring` rule, expand the 2nd..Nth
  -- bookable occurrences (bounded 52-cap). The expander skips starts that
  -- already exist so surviving date ids stay put. I-4 preserved.
  IF v_when_mode = 'recurring' AND v_recurrence_rules IS NOT NULL THEN
    PERFORM public.pg_expand_experience_recurrence(
      p_event_id, v_start, v_end, v_recurrence_rules, v_timezone
    );

    -- ORCH-1153 WS1 live-edit DRAIN GUARD (I-PROPOSED-1153-NO-DRAIN). After
    -- re-materialisation a recurring experience must never have zero future
    -- occurrences (unless the rule is count-exhausted / until-expired). Blocks a
    -- live-edit that would shift the master into the past with a non-productive
    -- rule. count/until series whose window legitimately closed are EXEMPT.
    IF NOT EXISTS (
          SELECT 1 FROM public.event_dates ed
          WHERE ed.event_id = p_event_id AND ed.start_at > v_now
        )
       AND NOT public.pg_recurrence_is_terminated(v_recurrence_rules, p_event_id, v_now)
    THEN
      RAISE EXCEPTION 'recurring_experience_has_no_future_occurrences';
    END IF;
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
    WHERE id = p_event_id;
  END IF;

  -- ---------- 8. Audit log ----------
  v_changed_keys := ARRAY(SELECT jsonb_object_keys(p_payload));

  IF (p_payload ? 'capacity' OR p_payload ? 'stops' OR p_payload ? 'whenMode'
      OR p_payload ? 'whole_price_cents' OR p_payload ? 'pricing_mode') THEN
    v_severity := 'material';
  ELSE
    v_severity := 'additive';
  END IF;

  SELECT COALESCE(array_agg(id), '{}'::uuid[])
    INTO v_affected_order_ids
    FROM public.orders
    WHERE event_id = p_event_id
      AND payment_status NOT IN ('failed', 'cancelled');

  INSERT INTO public.experience_edit_log
    (event_id, brand_id, edited_by, reason, severity,
     changed_field_keys, diff_summary, affected_order_ids, occurred_at)
  VALUES (
    p_event_id,
    v_existing.brand_id,
    v_user_id,
    v_trimmed_reason,
    v_severity,
    v_changed_keys,
    jsonb_build_object('changed_keys', to_jsonb(v_changed_keys)),
    v_affected_order_ids,
    v_now
  ) RETURNING id INTO v_log_id;

  -- issue #3827 buyer email [H1 notice-flush]
  v_notice := public.event_edit_notice_flush(p_event_id, v_trimmed_reason, 'experience', false);

  -- ---------- 9. Return payload (mirror biz_publish_experience shape) ----------
  SELECT * INTO v_event FROM public.events WHERE id = p_event_id;

  SELECT COALESCE(jsonb_agg(to_jsonb(es) ORDER BY es.stop_order), '[]'::jsonb)
  INTO v_stop_rows
  FROM public.experience_stops es
  WHERE es.event_id = p_event_id;

  SELECT COALESCE(jsonb_agg(to_jsonb(tt) ORDER BY tt.display_order), '[]'::jsonb)
  INTO v_ticket_rows
  FROM public.ticket_types tt
  WHERE tt.event_id = p_event_id
    AND tt.deleted_at IS NULL;

  SELECT COALESCE(jsonb_agg(to_jsonb(ed) ORDER BY ed.start_at), '[]'::jsonb)
  INTO v_event_dates_rows
  FROM public.event_dates ed
  WHERE ed.event_id = p_event_id;

  RETURN jsonb_build_object(
    'ok', true,
    'edit_log_entry_id', v_log_id,
    'severity', v_severity,
    'changed_keys', to_jsonb(v_changed_keys),
    'affected_order_count', COALESCE(array_length(v_affected_order_ids, 1), 0),
    'event', to_jsonb(v_event),
    'brand', jsonb_build_object('id', v_brand.id, 'slug', v_brand.slug, 'name', v_brand.name),
    'stops', v_stop_rows,
    'ticket', (v_ticket_rows->0),
    'tickets', v_ticket_rows,
    'eventDates', v_event_dates_rows,
    -- issue #3827 buyer email [H2 notice-result]
    'buyer_notice', v_notice
  );
END;
$function$
;

-- ---------------------------------------------------------------------------
-- Re-emit issue_1973_agent_experience_payload (2a stop gate 1..5)
-- ---------------------------------------------------------------------------
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
    'price_options',CASE
      WHEN jsonb_typeof(p_args->'price_options')='array' THEN p_args->'price_options'
      ELSE NULL
    END,
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

-- ---------------------------------------------------------------------------
-- Re-emit business_apply_experience_action (2a stop gate 1..5)
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- Self-verify: stop gate is 1..5 on the three host writers
-- ---------------------------------------------------------------------------
DO $verify$
DECLARE
  v_src text;
BEGIN
  SELECT pg_get_functiondef('public.biz_create_experience'::regproc) INTO v_src;
  IF position('v_stop_count < 1 OR v_stop_count > 5' IN v_src) = 0 THEN
    RAISE EXCEPTION 'issue_3281_r2_verify: create still refuses one stop';
  END IF;
  -- Match an executable old gate (not this verify literal): strip quoted strings.
  IF position('v_stop_count < 2 OR v_stop_count > 5' IN
       regexp_replace(v_src, '''[^'']*''', '', 'g')) > 0 THEN
    RAISE EXCEPTION 'issue_3281_r2_verify: create still has old <2 gate';
  END IF;

  SELECT pg_get_functiondef('public.biz_publish_experience'::regproc) INTO v_src;
  IF position('v_stop_count < 1 OR v_stop_count > 5' IN v_src) = 0 THEN
    RAISE EXCEPTION 'issue_3281_r2_verify: publish still refuses one stop';
  END IF;

  SELECT pg_get_functiondef('public.biz_update_live_experience(uuid,jsonb,text)'::regprocedure)
    INTO v_src;
  IF position('v_stop_count < 1 OR v_stop_count > 5' IN v_src) = 0 THEN
    RAISE EXCEPTION 'issue_3281_r2_verify: live-edit still refuses one stop';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='ticket_types'
       AND column_name='price_basis'
  ) THEN
    RAISE EXCEPTION 'issue_3281_r2_verify: ticket_types.price_basis missing';
  END IF;
END
$verify$;

COMMIT;
