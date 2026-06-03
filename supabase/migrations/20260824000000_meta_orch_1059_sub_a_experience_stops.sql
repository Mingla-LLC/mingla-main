-- META-ORCH-1059 [experiences-business-parity] · SUB-A · CREATION FOUNDATION
--
-- Layer 1 + Layer 2 of SPEC_META-ORCH-1059_SUB-A_CREATION_FOUNDATION.md.
--
-- WHAT THIS DOES
--   L1  — adds the experience-only columns location_mode/pricing_mode/whole_price_cents
--         to public.events (NULL on all event/trip rows; zero behaviour change),
--         and creates public.experience_stops (mirrors app-mobile CuratedStop) with
--         UNIQUE(event_id, stop_order), a ≤5-image CHECK, ON DELETE CASCADE, and RLS
--         (brand-owner write + anon read of published experiences).
--   L2  — biz_create_experience(p_brand_id, p_payload, p_publish) SECURITY DEFINER:
--         atomically writes the events row + 2–5 experience_stops + EXACTLY ONE
--         ticket_types row at the resolved total + master event_dates row(s).
--         The date-materialisation + ticket-insert logic mirrors
--         business_publish_event_draft (20260604000001_orch_0824_publish_rpc.sql)
--         verbatim in shape, COLLAPSED to a single ticket (I-1 one-ticket invariant).
--
-- INVARIANTS (SPEC §INVARIANTS)
--   I-1 ONE-TICKET            — one ticket_types row at the resolved total, never N.
--   I-2 2–5 STOPS ON PUBLISH  — publish enforces 2..5; a draft may have 0..5.
--   I-3 ALWAYS-VALIDATED LOC  — every published stop has place_id/lat/lng (per-stop)
--                               or inherits stops[0]'s validated place (single mode).
--   I-4 PUBLISH-TIME DATES    — event_dates materialise ONLY at publish; drafts carry none.
--   I-6 NO PARALLEL MONEY FN  — checkout stays on ticket-checkout-create; this RPC only
--                               writes the single sellable ticket the existing engine reads.
--   I-7 CURRENCY DE-GBP       — currency defaults to brand.default_currency, never GBP.
--
-- COMMS: COMMS-0014/0016 (one-ticket → existing checkout), COMMS-0002 (migration +
--        edge fn land in the same commit as the backend allowlist).
--
-- DO NOT run `supabase db push` from this skill — the orchestrator applies it after
-- the safe-migration protocol. Migration prefix 20260824000000 re-checked free across
-- all active worktrees + origin/main (max prior = 20260823000000 ORCH-1054).

BEGIN;

-- ===========================================================================
-- LAYER 1.1 — events: experience-only columns (nullable; existing rows untouched)
-- ===========================================================================

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS location_mode     text,      -- 'single' | 'per_stop' | NULL (non-experience)
  ADD COLUMN IF NOT EXISTS pricing_mode      text,      -- 'whole'  | 'per_stop' | NULL
  ADD COLUMN IF NOT EXISTS whole_price_cents integer;   -- display/audit redundancy; sellable price lives on ticket_types

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'events_location_mode_chk'
  ) THEN
    ALTER TABLE public.events
      ADD CONSTRAINT events_location_mode_chk
        CHECK (location_mode IS NULL OR location_mode IN ('single','per_stop')) NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'events_pricing_mode_chk'
  ) THEN
    ALTER TABLE public.events
      ADD CONSTRAINT events_pricing_mode_chk
        CHECK (pricing_mode IS NULL OR pricing_mode IN ('whole','per_stop')) NOT VALID;
  END IF;
END $$;

ALTER TABLE public.events VALIDATE CONSTRAINT events_location_mode_chk;
ALTER TABLE public.events VALIDATE CONSTRAINT events_pricing_mode_chk;

COMMENT ON COLUMN public.events.location_mode IS
  'META-ORCH-1059 Sub-A: experience-only. single = one shared location for all stops; per_stop = each stop has its own. NULL on event/trip rows.';
COMMENT ON COLUMN public.events.pricing_mode IS
  'META-ORCH-1059 Sub-A: experience-only. whole = one price; per_stop = summed per-stop prices. NULL on event/trip rows.';
COMMENT ON COLUMN public.events.whole_price_cents IS
  'META-ORCH-1059 Sub-A: experience-only display/audit redundancy of the whole-mode price. The SELLABLE price always lives in the single ticket_types row (I-1).';

-- ===========================================================================
-- LAYER 1.2 — experience_stops (mirrors app-mobile/src/types/curatedExperience.ts CuratedStop)
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.experience_stops (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  stop_order      integer NOT NULL,                 -- 0-based; CuratedStop.stopNumber/stopLabel derive from this
  place_id        text,                             -- Mapbox feature id (validated pick); NULL allowed only transiently in draft
  place_name      text NOT NULL,                    -- → CuratedStop.placeName
  address         text NOT NULL,                    -- → CuratedStop.address (Mapbox formattedAddress)
  city            text,
  region          text,
  country_code    text,
  lat             double precision,                 -- → CuratedStop.lat (non-null once validated; gated at publish, not column-level)
  lng             double precision,                 -- → CuratedStop.lng
  image_urls      text[] NOT NULL DEFAULT '{}',     -- ≤5; image_urls[0] = primary (→ CuratedStop.imageUrl)
  start_time      time,                             -- OPTIONAL per-stop intra-day time (HH:mm local)
  price_cents     integer NOT NULL DEFAULT 0,       -- per-stop price; 0 in whole-experience mode (display-only)
  ai_description  text NOT NULL DEFAULT '',         -- optional blurb ('' in v1)
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT experience_stops_unique_order UNIQUE (event_id, stop_order),
  CONSTRAINT experience_stops_order_nonneg CHECK (stop_order >= 0),
  CONSTRAINT experience_stops_price_nonneg CHECK (price_cents >= 0),
  CONSTRAINT experience_stops_images_max5 CHECK (array_length(image_urls, 1) IS NULL OR array_length(image_urls, 1) <= 5)
);

CREATE INDEX IF NOT EXISTS experience_stops_event_id_idx ON public.experience_stops (event_id);

COMMENT ON TABLE public.experience_stops IS
  'META-ORCH-1059 Sub-A: ordered 2–5-stop itinerary for an experience (event_type=experience). Mirrors CuratedStop so authoring is deck-ready. UNIQUE(event_id, stop_order); per-stop price_cents is display-only (the sellable price is the single ticket_types row, I-1).';

-- ===========================================================================
-- LAYER 1.3 — RLS (direct-predicate owner write per [[rls-returning-owner-gap]])
-- ===========================================================================

ALTER TABLE public.experience_stops ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS experience_stops_select_owner ON public.experience_stops;
CREATE POLICY experience_stops_select_owner ON public.experience_stops
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = experience_stops.event_id
        AND e.deleted_at IS NULL
        AND public.biz_brand_effective_rank(e.brand_id, auth.uid()) >= public.biz_role_rank('event_manager'::text)
    )
  );

DROP POLICY IF EXISTS experience_stops_select_public ON public.experience_stops;
CREATE POLICY experience_stops_select_public ON public.experience_stops
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = experience_stops.event_id
        AND e.deleted_at IS NULL
        AND e.event_type = 'experience'
        AND e.published_at IS NOT NULL
        AND e.visibility = 'public'
    )
  );

-- WRITE (INSERT/UPDATE/DELETE): brand owner/team only, via a DIRECT EXISTS predicate
-- (not a bare SECURITY DEFINER helper as the sole gate) so owner-SELECT/UPDATE-RETURNING
-- and soft-delete WITH CHECK contexts work. Mutations normally route through the
-- biz_create_experience SECURITY DEFINER RPC; the Sub-B edit screen needs this direct policy.
DROP POLICY IF EXISTS experience_stops_write_owner ON public.experience_stops;
CREATE POLICY experience_stops_write_owner ON public.experience_stops
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = experience_stops.event_id
        AND e.deleted_at IS NULL
        AND public.biz_brand_effective_rank(e.brand_id, auth.uid()) >= public.biz_role_rank('event_manager'::text)
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = experience_stops.event_id
        AND e.deleted_at IS NULL
        AND public.biz_brand_effective_rank(e.brand_id, auth.uid()) >= public.biz_role_rank('event_manager'::text)
    )
  );

-- ===========================================================================
-- LAYER 2 — biz_create_experience RPC
-- ===========================================================================

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
  -- location-mode single: stops[0]'s validated place is materialised onto every row
  v_shared_place_id     text;
  v_shared_place_addr   text;
  v_shared_city         text;
  v_shared_region       text;
  v_shared_country      text;
  v_shared_lat          double precision;
  v_shared_lng          double precision;
  -- per-stop write locals
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
  -- date materialisation (mirrors business_publish_event_draft)
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
  -- Description required only at publish; a draft shell may carry a short/empty narrative.
  IF p_publish THEN
    IF v_description IS NULL OR char_length(v_description) < 10 OR char_length(v_description) > 500 THEN
      RAISE EXCEPTION 'experience_description_invalid';
    END IF;
  END IF;

  -- I-7 CURRENCY DE-GBP: default to the brand's Stripe-synced default_currency, never GBP.
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
  -- I-2: the 2–5 gate fires ONLY on publish; a draft (AI shell / half-built) may have 0–5.
  IF p_publish THEN
    IF v_stop_count < 2 OR v_stop_count > 5 THEN
      RAISE EXCEPTION 'experience_stop_count_invalid';
    END IF;
  ELSE
    IF v_stop_count > 5 THEN
      RAISE EXCEPTION 'experience_stop_count_invalid';
    END IF;
  END IF;

  -- Per-stop shape validation (applies to whatever stops are present).
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

  -- I-3 ALWAYS-VALIDATED LOCATION (publish only; drafts may hold unvalidated picks).
  IF p_publish THEN
    IF v_location_mode = 'single' THEN
      -- only stops[0] needs a validated pick; stops 2–5 inherit it
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

  -- Single-mode shared place: snapshot stops[0]'s place for materialisation onto every row.
  IF v_location_mode = 'single' AND v_stop_count > 0 THEN
    v_shared_place_id   := NULLIF(v_stops->0->>'place_id', '');
    v_shared_place_addr := NULLIF(v_stops->0->>'address', '');
    v_shared_city       := NULLIF(v_stops->0->>'city', '');
    v_shared_region     := NULLIF(v_stops->0->>'region', '');
    v_shared_country    := NULLIF(v_stops->0->>'country_code', '');
    v_shared_lat        := NULLIF(v_stops->0->>'lat', '')::double precision;
    v_shared_lng        := NULLIF(v_stops->0->>'lng', '')::double precision;
  END IF;

  -- 6. Resolve the date model (mirror business_publish_event_draft) -------
  v_when_mode := COALESCE(NULLIF(p_payload->>'whenMode', ''), 'single');
  v_when := p_payload->'when';
  v_multi_dates := p_payload->'multiDates';
  v_recurrence_rules := p_payload->'recurrence_rules';
  v_timezone := COALESCE(NULLIF(p_payload->>'timezone', ''), 'UTC');
  v_is_recurring  := (v_when_mode = 'recurring');
  v_is_multi_date := (v_when_mode = 'multi_date');

  IF p_publish AND v_when_mode NOT IN ('single','multi_date','recurring') THEN
    RAISE EXCEPTION 'event_date_required';
  END IF;

  -- 7. Build the slug (slugify + collision-suffix loop) -------------------
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

  -- 8. INSERT the events row ----------------------------------------------
  INSERT INTO public.events (
    brand_id, created_by, event_type, title, slug, description,
    status, visibility, published_at, currency, timezone,
    pass_tax, pass_mingla_fee, pass_service_fee,
    location_mode, pricing_mode, whole_price_cents,
    is_recurring, is_multi_date, recurrence_rules,
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
    v_location_mode, v_pricing_mode,
    CASE WHEN v_pricing_mode = 'whole' THEN v_resolved_total ELSE NULL END,
    v_is_recurring, v_is_multi_date, v_recurrence_rules,
    jsonb_build_object(
      'experience_meta', jsonb_build_object(
        'venue_text', COALESCE(NULLIF(v_stops->0->>'address', ''), ''),
        'tier_name', 'Standard'
      )
    ),
    v_now, v_now
  )
  RETURNING id INTO v_event_id;

  -- 9. INSERT experience_stops (per location-mode rule) -------------------
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
    -- per-stop price is display-only; 0 in whole mode
    v_s_price := CASE WHEN v_pricing_mode = 'whole' THEN 0
                      ELSE COALESCE((v_stop->>'price_cents')::integer, 0) END;

    INSERT INTO public.experience_stops (
      event_id, stop_order, place_id, place_name, address,
      city, region, country_code, lat, lng,
      image_urls, start_time, price_cents, ai_description
    ) VALUES (
      v_event_id,
      COALESCE((v_stop->>'stop_order')::integer, v_idx),
      v_s_place_id,
      btrim(v_stop->>'place_name'),
      COALESCE(v_s_address, ''),
      v_s_city, v_s_region, v_s_country, v_s_lat, v_s_lng,
      v_s_images, v_s_start, v_s_price,
      COALESCE(NULLIF(v_stop->>'ai_description', ''), '')
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

    -- Persist the computed next_occurrence onto theme.experience_meta for display readers.
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
    -- slug or (event_id, stop_order) collision → friendly code for the client
    RAISE EXCEPTION 'slug_taken';
END;
$$;

GRANT EXECUTE ON FUNCTION public.biz_create_experience(uuid, jsonb, boolean) TO authenticated;

COMMENT ON FUNCTION public.biz_create_experience(uuid, jsonb, boolean) IS
  'META-ORCH-1059 Sub-A: atomically creates an experience — events row + 2–5 experience_stops + EXACTLY ONE ticket_types row at the resolved total + master event_dates (publish only). Mirrors business_publish_event_draft date/ticket logic, collapsed to one ticket (I-1). Drafts (p_publish=false) write the events row + stops + ticket but NO event_dates → unsellable until published.';

-- ===========================================================================
-- LAYER 1.4 — self-verify probe (fails-on-revert) + schema reload
-- ===========================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='experience_stops') THEN
    RAISE EXCEPTION 'experience_stops table missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='events' AND column_name='pricing_mode') THEN
    RAISE EXCEPTION 'events.pricing_mode column missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='biz_create_experience') THEN
    RAISE EXCEPTION 'biz_create_experience function missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname='experience_stops_unique_order'
  ) THEN
    RAISE EXCEPTION 'experience_stops_unique_order constraint missing';
  END IF;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
