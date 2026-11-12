-- Issue #3281 bundle 6 — a date that something holds is never deleted, and a
-- cancelled date never reaches Discover.
--
-- 1. Discover: issue_3281_explorer_date_listable_rows listed an event on a
--    cancelled date when the event sells nothing online (free, door-only,
--    RSVP): only the buyable-tier arm checked cancelled_at.
-- 2. biz_publish_experience: publishing again deletes and rebuilds every
--    date, with no draft-only check. On a live experience with bookings the
--    orders lost their date (orders.event_date_id is ON DELETE SET NULL) or
--    the publish failed on a raw foreign-key error. It now refuses with
--    experience_dates_have_sales when any date is not deletable.
-- 3. biz_update_live_rsvp: an extra legacy date row that something holds
--    refuses the edit (multi_date_remove_with_sales, as live events do)
--    instead of being deleted. Both writers lock the dates before checking.
-- 4. scan_events.event_date_id becomes ON DELETE RESTRICT. Any check-in is
--    already a hold (issue_3285_event_date_hold_reason), so no guarded path
--    changes; service-role and cron deletes get the same backstop.
--    orders.event_date_id stays SET NULL on purpose: the hold rule protects
--    live orders (pending, paid, partial refund), and a date whose orders
--    are all refunded, failed or cancelled may still be removed.
--
-- One definition of "this date may be deleted": issue_3281_event_date_deletable.
-- Re-emits: __tests__/issue_3281_b6_reemit_hunks.ts.
-- Proofs: __tests__/issue_3281_dates_never_orphan.pg17.test.sql.

BEGIN;

-- §1. A date may be deleted only when nothing holds it and nothing the
-- database refuses to orphan points at it: no hold (live order, live pass,
-- check-in, payout release) and no entitlement row of any status
-- (ticket_event_dates is ON DELETE RESTRICT, also for refunded passes).
-- The scan_events and payout arms repeat what the hold rule already says,
-- on purpose: this function lists every RESTRICT reference in one place.
CREATE OR REPLACE FUNCTION public.issue_3281_event_date_deletable(
  p_event_date_id uuid
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $fn$
  SELECT public.issue_3285_event_date_hold_reason(p_event_date_id) IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.ticket_event_dates ted
        WHERE ted.event_date_id = p_event_date_id
     )
     AND NOT EXISTS (
       SELECT 1 FROM public.scan_events s
        WHERE s.event_date_id = p_event_date_id
     )
     AND NOT EXISTS (
       SELECT 1 FROM public.brand_payout_releases r
        WHERE r.event_date_id = p_event_date_id
     );
$fn$;

ALTER FUNCTION public.issue_3281_event_date_deletable(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.issue_3281_event_date_deletable(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3281_event_date_deletable(uuid)
  TO service_role;

COMMENT ON FUNCTION public.issue_3281_event_date_deletable(uuid) IS
  'issue #3281 bundle 6 — true when an event_dates row may be deleted: no hold (issue_3285_event_date_hold_reason) and no ticket_event_dates, scan_events or brand_payout_releases row points at it.';

-- ---- public.issue_3281_explorer_date_listable_rows (source and hunks: __tests__/issue_3281_b6_reemit_hunks.ts)
CREATE OR REPLACE FUNCTION public.issue_3281_explorer_date_listable_rows(
  p_event_id uuid, p_event_date_id uuid
) RETURNS TABLE(listable boolean)
LANGUAGE sql
STABLE
AS $fn$
  SELECT true
    FROM public.event_dates d
   WHERE d.id = p_event_date_id
     AND d.event_id = p_event_id
     -- #3281 bundle 6: a cancelled date is never listed. The buyable-tier
     -- arm below already said so; an event that sells nothing online (free,
     -- door-only, RSVP) was listed on its cancelled dates.
     AND d.cancelled_at IS NULL
     AND (
       NOT EXISTS (
         SELECT 1 FROM public.ticket_types tt
          WHERE tt.event_id = p_event_id
            AND tt.deleted_at IS NULL
            AND tt.is_hidden IS NOT TRUE
            AND tt.is_disabled IS NOT TRUE
            AND tt.available_online IS TRUE
       )
       OR EXISTS (
         SELECT 1 FROM public.issue_3281_date_buyable_ticket_types(p_event_id, p_event_date_id)
       )
     )
$fn$;

-- ---- public.biz_publish_experience (source and hunks: __tests__/issue_3281_b6_reemit_hunks.ts)
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
    AND deleted_at IS NULL
  FOR UPDATE;  -- issue #3645: serialise publishes; event row before event_dates

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

  -- 11. Materialise event_dates (PUBLISH only — I-4) ----------------------
  -- issue #3645: runs BEFORE step 8 so the master date exists when step 8
  -- moves the row out of draft (biz_enforce_event_has_master_date). It reads
  -- only event_dates and local variables, never the events row.
  IF p_publish THEN
    -- #3281 bundle 6: publishing again rebuilds every date. A date that
    -- holds sales, a pass, a check-in or a payout is never deleted (its
    -- orders would lose their date); live changes go through
    -- biz_update_live_experience, which edits dates in place. The dates are
    -- locked first, so no order can land on one between the check and the
    -- delete.
    PERFORM 1 FROM public.event_dates WHERE event_id = p_event_id ORDER BY id FOR UPDATE;
    IF EXISTS (
      SELECT 1 FROM public.event_dates d
       WHERE d.event_id = p_event_id
         AND NOT public.issue_3281_event_date_deletable(d.id)
    ) THEN
      RAISE EXCEPTION 'experience_dates_have_sales';
    END IF;
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

  END IF;

  -- 8. UPDATE the events row ----------------------------------------------
  UPDATE public.events SET
    title             = v_title,
    description       = v_description,
    currency          = CASE WHEN p_publish THEN currency ELSE v_currency END,  -- issue #3645: see step 8b
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
    -- BUG 5 ROOT CAUSE (ORCH-0792) — biz_enforce_event_has_master_date needs
    -- a master event_date before the row leaves draft. issue #3645: dates are
    -- now materialised above, and a publish writes currency together with
    -- status in step 8b below. This UPDATE never names status, so a draft
    -- save fires no status-column trigger, and on a publish it leaves the
    -- stored currency unchanged.
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

  -- 8b. issue #3645 — PUBLISH: currency and status in ONE update, so the
  -- status triggers (brand-currency stamp, draft-currency stop) see the
  -- currency this publish writes. It runs after the stops are replaced (as
  -- the old status flip did), so a first publish is never captured as a
  -- live edit (issue_3827 edit notices), and before the tickets. The brand-currency trigger may stamp the
  -- brand's currency (or NULL for a free-only publish on a brand with none);
  -- tickets follow what was stored, not what was sent.
  IF p_publish THEN
    UPDATE public.events
    SET currency     = v_currency,
        status       = 'scheduled',
        visibility   = 'public',
        published_at = COALESCE(published_at, v_now),
        updated_at   = v_now
    WHERE id = p_event_id;
    SELECT e.currency INTO v_currency FROM public.events e WHERE e.id = p_event_id;
  END IF;

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

  -- issue #3645: a price option that has sales keeps its row as it was,
  -- currency included, so a publish in another currency would leave the
  -- event and that ticket disagreeing. Refuse instead; nothing is written.
  IF p_publish AND EXISTS (
    SELECT 1 FROM public.ticket_types tt
     WHERE tt.event_id = p_event_id AND tt.deleted_at IS NULL
       AND tt.currency IS DISTINCT FROM v_currency
  ) THEN
    RAISE EXCEPTION 'ticket_currency_must_match_event_currency';
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

    -- issue #3281 R3 — spacing / notice / capacity_scope / stop offsets
  PERFORM public.issue_3281_apply_experience_r3_settings(p_event_id, p_payload);

RETURN jsonb_build_object(
    'event', to_jsonb(v_event),
    'brand', jsonb_build_object('id', v_brand.id, 'slug', v_brand.slug, 'name', v_brand.name),
    'stops', v_stop_rows,
    'ticket', (v_ticket_rows->0),
    'tickets', v_ticket_rows,
    'eventDates', v_event_dates_rows
  );
END;
$function$;

-- ---- public.biz_update_live_rsvp (source and hunks: __tests__/issue_3281_b6_reemit_hunks.ts)
CREATE OR REPLACE FUNCTION public.biz_update_live_rsvp(
  p_event_id uuid,
  p_payload jsonb,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_user_id        uuid;
  v_existing       public.events%ROWTYPE;
  v_brand          record;
  v_now            timestamptz := now();
  v_trimmed_reason text;
  v_title          text;
  v_description    text;
  v_location_text  text;
  v_online_url     text;
  v_timezone       text;
  v_visibility     text;
  v_when           jsonb;
  v_date_iso       text;
  v_doors          text;
  v_ends           text;
  v_new_start      timestamptz;
  v_new_end        timestamptz;
  v_old_start      timestamptz;
  v_date_row       uuid;  -- issue #3281
  v_rsvp_capacity  integer;
  v_rsvp_allow_plus_ones boolean;
  v_rsvp_plus_ones_max integer;
  v_rsvp_waitlist_enabled boolean;
  v_rsvp_approval_mode text;
  v_rsvp_discoverable boolean;
  v_material_change boolean := false;
  v_going_count    integer;
  v_notified_count integer := 0;
  v_event          public.events%ROWTYPE;
  v_guest          record;
  -- ORCH-1172 — theme.business_event.settings privacy toggles.
  v_private_guest_list boolean;
  v_hide_remaining_count boolean;
  -- issue #3827 going-box — guests on the host's own list.
  v_extra_guest_count integer;
  -- ORCH-1172 R2 — theme.business_event.hideAddressUntilTicket (direct child).
  v_hide_address boolean;
  v_theme          jsonb;
  v_settings       jsonb;
  -- ORCH-1296 [chip-in-edit-published-gap] — voluntary chip-in config on EDIT.
  v_rsvp_contribution_enabled boolean;
  v_rsvp_contribution_suggested_cents integer;
  v_rsvp_contribution_min_cents integer;
  -- issue #3827 — structured location (optional `location` payload key).
  v_location_structured boolean := false;
  v_location_venue text;
  v_location_address text;
  -- issue #3827 buyer email — what the edit-notice recorder answered.
  v_notice jsonb;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  v_trimmed_reason := btrim(COALESCE(p_reason, ''));
  -- issue #3827 — the reason check is the shared resolver: a 10 to 200
  -- character reason passes as before (business_update_rsvp_graph always
  -- hands one over), a blank reason passes only when nobody has RSVP'd or
  -- paid, and both refusals keep their existing answers.
  IF public.business_resolve_edit_reason(p_event_id, p_reason) IS NULL THEN
    IF v_trimmed_reason = '' THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'missing_edit_reason');
    END IF;
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_edit_reason');
  END IF;

  SELECT * INTO v_existing FROM public.events
   WHERE id = p_event_id AND deleted_at IS NULL
   FOR UPDATE;   -- issue #3827 buyer email: one live edit of an event at a time
  IF NOT FOUND THEN
    RAISE EXCEPTION 'rsvp_not_found';
  END IF;
  IF v_existing.event_type <> 'rsvp' THEN
    RAISE EXCEPTION 'event_not_an_rsvp'
      USING HINT = 'biz_update_live_rsvp only handles event_type=rsvp rows.';
  END IF;
  IF v_existing.status NOT IN ('scheduled', 'live') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'rsvp_not_editable_status');
  END IF;
  IF public.biz_brand_effective_rank(v_existing.brand_id, v_user_id) < public.biz_role_rank('event_manager'::text) THEN
    RAISE EXCEPTION 'insufficient_event_permission';
  END IF;

  SELECT id, slug, name INTO v_brand FROM public.brands
   WHERE id = v_existing.brand_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'brand_not_found';
  END IF;

  v_title := NULLIF(btrim(COALESCE(p_payload->>'title', '')), '');
  IF v_title IS NULL THEN
    RAISE EXCEPTION 'rsvp_title_required';
  END IF;
  v_description := NULLIF(p_payload->>'description', '');
  v_location_text := NULLIF(p_payload->>'location_text', '');
  -- issue #3827 — this function wrote the label only, while the editor and
  -- the public page read theme.business_event.location first, so an edited
  -- venue or address came straight back as the old one. When the payload
  -- carries `location` as an object, both halves are written (below) and the
  -- label is DERIVED from them here, ahead of the material-change compare.
  -- Without the key (an older client) the behaviour is exactly as before.
  IF jsonb_typeof(p_payload->'location') = 'object' THEN
    v_location_structured := true;
    v_location_venue := p_payload #>> '{location,venueName}';
    v_location_address := p_payload #>> '{location,address}';
    v_location_text := public.business_event_location_label(v_location_venue, v_location_address);
  END IF;
  v_online_url := NULLIF(p_payload->>'online_url', '');
  v_timezone := COALESCE(NULLIF(p_payload->>'timezone', ''), v_existing.timezone, 'UTC');

  v_visibility := CASE COALESCE(p_payload->>'requestedVisibility', NULL)
    WHEN 'private' THEN 'private'
    WHEN 'unlisted' THEN 'hidden'
    WHEN 'public' THEN 'public'
    ELSE v_existing.visibility
  END;

  -- RSVP host-control (default to existing when key absent).
  v_rsvp_capacity := CASE WHEN p_payload ? 'rsvpCapacity'
    THEN NULLIF(p_payload->>'rsvpCapacity', '')::integer ELSE v_existing.rsvp_capacity END;
  v_rsvp_allow_plus_ones := COALESCE((p_payload->>'rsvpAllowPlusOnes')::boolean, v_existing.rsvp_allow_plus_ones);
  v_rsvp_plus_ones_max := COALESCE(NULLIF(p_payload->>'rsvpPlusOnesMax', '')::integer, v_existing.rsvp_plus_ones_max);
  v_rsvp_waitlist_enabled := COALESCE((p_payload->>'rsvpWaitlistEnabled')::boolean, v_existing.rsvp_waitlist_enabled);
  v_rsvp_approval_mode := COALESCE(NULLIF(p_payload->>'rsvpApprovalMode', ''), v_existing.rsvp_approval_mode);
  IF v_rsvp_approval_mode NOT IN ('auto', 'manual') THEN
    RAISE EXCEPTION 'rsvp_approval_mode_invalid';
  END IF;
  v_rsvp_discoverable := COALESCE((p_payload->>'rsvpDiscoverable')::boolean, v_existing.rsvp_discoverable);
  IF v_visibility = 'private' THEN
    v_rsvp_discoverable := false;
  END IF;

  -- ORCH-1296 [chip-in-edit-published-gap] — voluntary chip-in config reads.
  -- Default each to the currently STORED value when the key is ABSENT: the client
  -- sends a diff payload (a chip-in field only when the organiser changed it), so
  -- an unrelated edit must keep the stored config untouched (mirrors the rsvp_*
  -- COALESCE-to-existing pattern above). enabled is a NOT NULL column; the two
  -- amount columns are nullable (present-but-null clears them).
  v_rsvp_contribution_enabled := COALESCE(
    (p_payload->>'rsvpContributionEnabled')::boolean,
    v_existing.rsvp_contribution_enabled,
    false);
  v_rsvp_contribution_suggested_cents := CASE
    WHEN p_payload ? 'rsvpContributionSuggestedCents'
      THEN NULLIF(p_payload->>'rsvpContributionSuggestedCents', '')::integer
    ELSE v_existing.rsvp_contribution_suggested_cents END;
  v_rsvp_contribution_min_cents := CASE
    WHEN p_payload ? 'rsvpContributionMinCents'
      THEN NULLIF(p_payload->>'rsvpContributionMinCents', '')::integer
    ELSE v_existing.rsvp_contribution_min_cents END;

  -- ORCH-1296 — CONDITIONAL PROVIDER-AWARE bank-gate on EDIT (mirrors
  -- business_publish_rsvp_draft, ORCH-1291). Enabling chip-in flips the RSVP into
  -- a money-collector → the brand MUST be able to collect on EITHER rail.
  -- pg_brand_can_collect is provider-aware (Stripe charges_enabled OR Paystack
  -- subaccount) — reusing the Stripe-only pg_brand_can_charge here would wrongly
  -- block every NGN brand. The gate is CONDITIONAL: when chip-in resolves OFF it
  -- NEVER fires (an organiser can always turn chip-in off; free RSVPs stay
  -- ungated). Raises the ORCH-1075-recognized 'stripe_charges_disabled' reason.
  IF v_rsvp_contribution_enabled AND NOT public.pg_brand_can_collect(v_existing.brand_id) THEN
    RAISE EXCEPTION 'stripe_charges_disabled'
      USING HINT = 'RSVP chip-in is enabled but the brand cannot collect (no connected bank / subaccount).';
  END IF;

  -- Single-date when (optional in payload; default to existing master).
  SELECT start_at INTO v_old_start FROM public.event_dates
   WHERE event_id = p_event_id AND is_master = true LIMIT 1;

  v_when := p_payload->'when';
  IF v_when IS NOT NULL AND NULLIF(v_when->>'date', '') IS NOT NULL THEN
    v_date_iso := NULLIF(v_when->>'date', '');
    v_doors := COALESCE(NULLIF(v_when->>'doorsOpen', ''), '00:00');
    v_ends := COALESCE(NULLIF(v_when->>'endsAt', ''), v_doors);
    v_new_start := (v_date_iso || ' ' || v_doors || ':00')::timestamp AT TIME ZONE v_timezone;
    v_new_end := (v_date_iso || ' ' || v_ends || ':00')::timestamp AT TIME ZONE v_timezone;
    IF v_new_end <= v_new_start THEN
      v_new_end := v_new_end + INTERVAL '1 day';
    END IF;
    -- issue #3281: the date row keeps its id, so everything that points at
    -- it stays attached, and keeps its status, cancelled_at and
    -- occurrence_key (an edit never un-cancels a date). A row is inserted
    -- only when none exists. Extra legacy rows go, as before.
    SELECT d.id INTO v_date_row FROM public.event_dates d
     WHERE d.event_id = p_event_id
     ORDER BY d.is_master DESC, d.start_at, d.id LIMIT 1;
    IF v_date_row IS NULL THEN
      INSERT INTO public.event_dates (event_id, start_at, end_at, timezone, is_master)
      VALUES (p_event_id, v_new_start, v_new_end, v_timezone, true);
    ELSE
      -- #3281 bundle 6: an extra row that something holds is never deleted
      -- (its order would lose its date) and never kept behind the moved date
      -- (it would stay bookable): the edit is refused, like a live event's.
      PERFORM 1 FROM public.event_dates WHERE event_id = p_event_id ORDER BY id FOR UPDATE;
      IF EXISTS (
        SELECT 1 FROM public.event_dates d
         WHERE d.event_id = p_event_id AND d.id <> v_date_row
           AND NOT public.issue_3281_event_date_deletable(d.id)
      ) THEN
        RAISE EXCEPTION 'multi_date_remove_with_sales';
      END IF;
      DELETE FROM public.event_dates WHERE event_id = p_event_id AND id <> v_date_row;
      UPDATE public.event_dates
         SET start_at = v_new_start, end_at = v_new_end, timezone = v_timezone, is_master = true
       WHERE id = v_date_row
         AND (start_at, end_at, timezone, is_master)
             IS DISTINCT FROM (v_new_start, v_new_end, v_timezone, true);
    END IF;
    IF v_old_start IS DISTINCT FROM v_new_start THEN
      v_material_change := true;
    END IF;
  END IF;

  -- Material change = date/time OR venue/location text changed.
  IF v_location_text IS DISTINCT FROM v_existing.location_text THEN
    v_material_change := true;
  END IF;

  -- ORCH-1172 — deep-merge the two privacy toggles into
  -- theme.business_event.settings, PRESERVING every other theme key and every
  -- other settings key. jsonb_set with create_missing=true builds the nested
  -- path if it doesn't exist yet (e.g. a legacy row that never had a settings
  -- object), and only ever replaces the two leaf keys we own.
  v_theme := COALESCE(v_existing.theme, '{}'::jsonb);
  v_private_guest_list := COALESCE(
    (p_payload->>'privateGuestList')::boolean,
    (v_theme #>> '{business_event,settings,privateGuestList}')::boolean,
    false);
  v_hide_remaining_count := COALESCE(
    (p_payload->>'hideRemainingCount')::boolean,
    (v_theme #>> '{business_event,settings,hideRemainingCount}')::boolean,
    false);
  -- ORCH-1172 R2 — hideAddressUntilTicket lives at
  -- theme.business_event.hideAddressUntilTicket (a DIRECT child of
  -- business_event, NOT under settings). Same default-to-existing pattern.
  v_hide_address := COALESCE(
    (p_payload->>'hideAddressUntilTicket')::boolean,
    (v_theme #>> '{business_event,hideAddressUntilTicket}')::boolean,
    false);

  v_settings := COALESCE(v_theme #> '{business_event,settings}', '{}'::jsonb);
  v_settings := jsonb_set(v_settings, '{privateGuestList}', to_jsonb(v_private_guest_list), true);
  v_settings := jsonb_set(v_settings, '{hideRemainingCount}', to_jsonb(v_hide_remaining_count), true);
  -- issue #3827 going-box — own-list guests: absent key keeps the stored value.
  -- Display only; never a material change, never a guest alert.
  v_extra_guest_count := COALESCE(
    (p_payload->>'extraGuestCount')::integer,
    public.issue_3827_extra_guest_count(v_theme));
  IF v_extra_guest_count < 0 OR v_extra_guest_count > 5000 THEN
    RAISE EXCEPTION 'invalid_extra_guest_count';
  END IF;
  v_settings := jsonb_set(v_settings, '{extraGuestCount}', to_jsonb(v_extra_guest_count), true);
  -- Ensure the business_event container exists before writing into it.
  IF v_theme -> 'business_event' IS NULL OR jsonb_typeof(v_theme -> 'business_event') <> 'object' THEN
    v_theme := jsonb_set(v_theme, '{business_event}', '{}'::jsonb, true);
  END IF;
  v_theme := jsonb_set(v_theme, '{business_event,settings}', v_settings, true);
  -- ORCH-1172 R2 — write the hideAddressUntilTicket leaf directly under
  -- business_event (NOT under settings). The container guard above already ran,
  -- so business_event is a guaranteed object; this replaces ONLY that one leaf
  -- and leaves settings + every other business_event/theme key untouched.
  v_theme := jsonb_set(v_theme, '{business_event,hideAddressUntilTicket}', to_jsonb(v_hide_address), true);
  -- issue #3827 — write both structured halves beside the derived label.
  IF v_location_structured THEN
    v_theme := public.business_event_theme_with_location(
      v_theme, v_existing.location_text, true, v_location_venue, true, v_location_address);
  END IF;

  UPDATE public.events
  SET
    title = v_title,
    description = v_description,
    location_text = v_location_text,
    online_url = v_online_url,
    cover_media_url = NULLIF(p_payload->>'cover_media_url', ''),
    cover_media_type = NULLIF(p_payload->>'cover_media_type', ''),
    visibility = v_visibility,
    timezone = v_timezone,
    rsvp_capacity = v_rsvp_capacity,
    rsvp_allow_plus_ones = v_rsvp_allow_plus_ones,
    rsvp_plus_ones_max = CASE WHEN v_rsvp_allow_plus_ones THEN GREATEST(v_rsvp_plus_ones_max, 0) ELSE 0 END,
    rsvp_waitlist_enabled = v_rsvp_waitlist_enabled,
    rsvp_approval_mode = v_rsvp_approval_mode,
    rsvp_discoverable = v_rsvp_discoverable,
    -- ORCH-1296 — persist the voluntary chip-in config on EDIT.
    rsvp_contribution_enabled = v_rsvp_contribution_enabled,
    rsvp_contribution_suggested_cents = v_rsvp_contribution_suggested_cents,
    rsvp_contribution_min_cents = v_rsvp_contribution_min_cents,
    theme = v_theme,
    updated_at = v_now
  WHERE id = p_event_id;

  -- issue #3827 buyer email — record this edit (who, why, what changed) and
  -- decide whether guests are told through the edit notice. Never raises.
  v_notice := public.event_edit_notice_flush(
    p_event_id, NULLIF(v_trimmed_reason, ''), 'rsvp', false);

  -- Enqueue rsvp_event_updated for every going+approved guest on material change.
  IF v_material_change THEN
    FOR v_guest IN
      SELECT r.id FROM public.event_rsvps r
       WHERE r.event_id = p_event_id
         AND r.rsvp_status = 'going' AND r.approval_status = 'approved'
         -- issue #3827 buyer email — every guest the edit notice cannot reach
         -- yet gets exactly the row queued before this work: all of them when
         -- the notice does not own the change (the feature is off, the brand
         -- is outside the pilot, or the recorder saw nothing a guest acts on),
         -- and, while emails are being tested (allowlist-only), every guest
         -- who is not on the allowlist. Nothing that alerts a guest today goes
         -- silent.
         AND (COALESCE(v_notice->>'handled', 'false') <> 'true'
              OR (public.event_edit_notice_allowlist_only()
                  AND NOT public.event_edit_notice_on_allowlist(r.guest_email)))
    LOOP
      INSERT INTO public.rsvp_notifications
        (event_id, rsvp_id, channel, recipient, status, template_key, payload,
         idempotency_key, attempt_count)
      VALUES
        (p_event_id, v_guest.id, NULL, NULL, 'pending', 'rsvp_event_updated',
         jsonb_build_object('template_key', 'rsvp_event_updated',
                            'rsvp_id', v_guest.id, 'event_id', p_event_id),
         'rsvp_update:' || p_event_id::text || ':' || extract(epoch FROM v_now)::bigint::text
           || ':' || v_guest.id::text,
         0)
      ON CONFLICT (idempotency_key) DO NOTHING;
      v_notified_count := v_notified_count + 1;
    END LOOP;
    -- issue #3827 buyer email — when the edit notice owns the change it
    -- reaches the rest; notified_count keeps its meaning (going and approved
    -- guests on a material change).
    IF COALESCE(v_notice->>'handled', 'false') = 'true' THEN
      SELECT count(*) INTO v_notified_count FROM public.event_rsvps r
       WHERE r.event_id = p_event_id
         AND r.rsvp_status = 'going' AND r.approval_status = 'approved';
    END IF;
  END IF;

  SELECT * INTO v_event FROM public.events WHERE id = p_event_id;
  SELECT COALESCE(SUM(1 + plus_count), 0) INTO v_going_count
    FROM public.event_rsvps
   WHERE event_id = p_event_id AND rsvp_status = 'going' AND approval_status = 'approved';

  RETURN jsonb_build_object(
    'ok', true,
    'event', to_jsonb(v_event),
    'going_count', v_going_count,
    'notified_count', v_notified_count,
    'buyer_notice', v_notice   -- issue #3827 buyer email
  );
END;
$$;

-- §5. A check-in never loses its date: scan_events.event_date_id refuses.
-- Short lock wait: fail fast rather than queue behind a long transaction.
SET LOCAL lock_timeout = '3s';
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.scan_events s
     WHERE s.event_date_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.event_dates d WHERE d.id = s.event_date_id)
  ) THEN
    RAISE EXCEPTION '#3281 bundle 6: a check-in points at a missing date; repair it before this migration';
  END IF;
END $$;
-- NOT VALID: no scan of scan_events under this migration's locks; the next
-- migration (20280625013281) validates it with a light lock.
ALTER TABLE public.scan_events
  DROP CONSTRAINT scan_events_event_date_id_fkey,
  ADD CONSTRAINT scan_events_event_date_id_fkey
    FOREIGN KEY (event_date_id) REFERENCES public.event_dates(id) ON DELETE RESTRICT
    NOT VALID;
COMMENT ON CONSTRAINT scan_events_event_date_id_fkey ON public.scan_events IS
  'issue #3281 bundle 6 — ON DELETE RESTRICT (was SET NULL): a check-in always keeps its date. Every check-in is a hold, so writers already keep the date.';

-- §6. Self-assert above COMMIT.
DO $$
BEGIN
  IF (SELECT confdeltype FROM pg_constraint
       WHERE conname = 'scan_events_event_date_id_fkey'
         AND conrelid = 'public.scan_events'::regclass) <> 'r'
     OR (SELECT confdeltype FROM pg_constraint
          WHERE conname = 'orders_event_date_id_fkey'
            AND conrelid = 'public.orders'::regclass) <> 'n' THEN
    RAISE EXCEPTION '#3281 bundle 6 self-assert: date foreign keys wrong';
  END IF;
  IF position('experience_dates_have_sales' in pg_get_functiondef(
       'public.biz_publish_experience(uuid,jsonb,boolean)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION '#3281 bundle 6 self-assert: experience publish still deletes held dates';
  END IF;
  IF position('multi_date_remove_with_sales' in pg_get_functiondef(
       'public.biz_update_live_rsvp'::regproc)) = 0 THEN
    RAISE EXCEPTION '#3281 bundle 6 self-assert: live RSVP edit still deletes held rows';
  END IF;
  IF position('d.cancelled_at IS NULL' in pg_get_functiondef(
       'public.issue_3281_explorer_date_listable_rows(uuid,uuid)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION '#3281 bundle 6 self-assert: Discover lists cancelled dates';
  END IF;
END $$;

COMMIT;
