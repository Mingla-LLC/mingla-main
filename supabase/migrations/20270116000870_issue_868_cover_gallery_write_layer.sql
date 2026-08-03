-- issue #868 [cover-gallery] — Layer 4 (SPEC-868 §G): additive write paths.
--
-- Re-publishes the 3 publish/live-edit RPCs VERBATIM from their latest source
-- definitions with the SINGLE additive delta: persist events.cover_media_gallery.
-- The cover-field reads/writes are BYTE-IDENTICAL (cover_media_url/_type + provider
-- metadata untouched). NO write path syncs, derives, or clears one column from the
-- other; the gallery is never nulled by the cover-absent branch — a photo gallery
-- COEXISTS with any cover, including a video cover
-- (I-PROPOSED-868-GALLERY-ADDITIVE-INDEPENDENT).
--
--   • business_publish_event_draft — latest 20270112000000_issue_857 (VERBATIM).
--   • business_publish_rsvp_draft   — latest 20270112000000_issue_857 (VERBATIM).
--   • biz_update_live_trip          — latest 20260929000000_orch_1120 (VERBATIM);
--     §5a events UPDATE gains the gallery key + an additive CASE.
--
-- event-cover-video-apply edge fn is UNCHANGED (video cover coexists; it never
-- touches cover_media_gallery). Depends on 20270116000868 (the column).
-- DO NOT auto-apply — orchestrator/Seth applies via the Management API post-merge.

-- ============================================================
-- 1) business_publish_event_draft — + cover_media_gallery persist
-- ============================================================
CREATE OR REPLACE FUNCTION public.business_publish_event_draft(
  p_event_id uuid,
  p_draft_payload jsonb,
  p_client_revision integer DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_user_id uuid;
  v_event public.events%ROWTYPE;
  v_brand record;
  v_theme jsonb;
  v_business_draft jsonb;
  v_tickets jsonb;
  v_ticket jsonb;
  v_title text;
  v_description text;
  v_location_text text;
  v_online_url text;
  v_cover_media_url text;
  v_cover_media_type text;
  v_cover_media_provider text;
  v_cover_media_source_url text;
  v_cover_media_credit text;
  v_cover_media_credit_url text;
  v_cover_media_alt text;
  v_cover_media_gallery jsonb;  -- issue #868 (additive, independent)
  v_timezone text;
  v_visibility text;
  v_currency char(3);
  v_price numeric;
  v_base_slug text;
  v_final_slug text;
  v_suffix integer := 2;
  v_now timestamptz := now();
  v_ticket_rows jsonb;
  v_event_dates_rows jsonb;
  v_when_mode text;
  v_when jsonb;
  v_multi_dates jsonb;
  v_date_iso text;
  v_doors text;
  v_ends text;
  v_start timestamptz;
  v_end timestamptz;
  v_date_entry jsonb;
  v_min_start timestamptz;
  -- ORCH-0824: new locals for taxonomy + city.
  v_city text;
  v_party_types text[];
  v_vibe_tags text[];
  v_music_genres text[];
  -- ORCH-1075: paid-publish guard locals.
  v_paid_online boolean;
  v_max_end timestamptz;
  -- issue #1014: money-bearing predicate (BROADER than v_paid_online — no
  -- availableAt filter, no isFree shortcut: a paid DOOR ticket has no Stripe
  -- requirement but DOES display money and therefore requires a currency).
  v_money_bearing boolean;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT *
  INTO v_event
  FROM public.events
  WHERE id = p_event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'event_draft_not_found';
  END IF;

  IF v_event.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'event_draft_deleted';
  END IF;

  IF v_event.status <> 'draft' THEN
    RAISE EXCEPTION 'event_draft_not_publishable';
  END IF;

  IF public.biz_brand_effective_rank(v_event.brand_id, v_user_id) < public.biz_role_rank('event_manager'::text) THEN
    RAISE EXCEPTION 'insufficient_event_permission';
  END IF;

  SELECT id, slug, name, default_currency
  INTO v_brand
  FROM public.brands
  WHERE id = v_event.brand_id
    AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'brand_not_found';
  END IF;

  v_theme := COALESCE(p_draft_payload->'theme', '{}'::jsonb);
  v_business_draft := COALESCE(v_theme->'business_draft', '{}'::jsonb);
  v_tickets := COALESCE(v_business_draft->'tickets', '[]'::jsonb);
  -- issue #1014 delta (1): the 'GBP' fabrication is REMOVED — v_currency may
  -- now be NULL (currency-less brand, no draft override). Trigger (c) is
  -- authoritative: it stamps a resolvable brand currency or NULLs a free-only
  -- publish; the explicit gate below fail-closes money-bearing publishes.
  v_currency := upper(COALESCE(
    NULLIF(v_business_draft->>'currency', ''),
    NULLIF(p_draft_payload->>'currency', ''),
    v_brand.default_currency::text
  ))::char(3);

  -- issue #1014 delta (2): whitelist gains NGN (NG Paystack brands stamp
  -- brands.default_currency='NGN' at onboard) and runs only for a known
  -- currency — NULL means "no currency yet", not "unsupported currency".
  IF v_currency IS NOT NULL AND v_currency <> ALL (
    ARRAY[
      'GBP'::bpchar, 'USD'::bpchar, 'CAD'::bpchar, 'CHF'::bpchar, 'EUR'::bpchar,
      'BGN'::bpchar, 'CZK'::bpchar, 'DKK'::bpchar, 'HUF'::bpchar, 'ISK'::bpchar,
      'NOK'::bpchar, 'PLN'::bpchar, 'RON'::bpchar, 'SEK'::bpchar,
      'NGN'::bpchar
    ]
  ) THEN
    RAISE EXCEPTION 'event_currency_unsupported';
  END IF;

  v_title := NULLIF(btrim(COALESCE(p_draft_payload->>'title', '')), '');
  IF v_title IS NULL THEN
    RAISE EXCEPTION 'event_title_required';
  END IF;

  IF jsonb_typeof(v_tickets) IS DISTINCT FROM 'array' OR jsonb_array_length(v_tickets) = 0 THEN
    RAISE EXCEPTION 'event_ticket_required';
  END IF;

  FOR v_ticket IN SELECT value FROM jsonb_array_elements(v_tickets)
  LOOP
    IF NULLIF(btrim(COALESCE(v_ticket->>'name', '')), '') IS NULL THEN
      RAISE EXCEPTION 'ticket_name_required';
    END IF;

    v_price := COALESCE(
      NULLIF(v_ticket->>'priceMajor', '')::numeric,
      NULLIF(v_ticket->>'price', '')::numeric,
      NULLIF(v_ticket->>'priceGbp', '')::numeric,
      0
    );

    IF COALESCE((v_ticket->>'isFree')::boolean, false) = true THEN
      IF v_price <> 0 THEN
        RAISE EXCEPTION 'free_ticket_price_must_be_zero';
      END IF;
    ELSE
      IF v_price < 0 THEN
        RAISE EXCEPTION 'ticket_price_cannot_be_negative';
      END IF;
    END IF;
    IF COALESCE((v_ticket->>'isUnlimited')::boolean, false) = false
      AND COALESCE((v_ticket->>'capacity')::integer, 0) <= 0
    THEN
      RAISE EXCEPTION 'ticket_capacity_required';
    END IF;
    IF NULLIF(COALESCE(v_ticket->>'password', ''), '') IS NOT NULL THEN
      RAISE EXCEPTION 'ticket_plaintext_password_forbidden';
    END IF;
  END LOOP;

  -- ORCH-0824: read new taxonomy + city fields and validate.
  v_city := NULLIF(btrim(COALESCE(v_business_draft->>'city', '')), '');
  v_party_types := COALESCE(
    (SELECT array_agg(value::text)
     FROM jsonb_array_elements_text(COALESCE(v_business_draft->'partyTypes', '[]'::jsonb))),
    ARRAY[]::text[]
  );
  v_vibe_tags := COALESCE(
    (SELECT array_agg(value::text)
     FROM jsonb_array_elements_text(COALESCE(v_business_draft->'vibeTags', '[]'::jsonb))),
    ARRAY[]::text[]
  );
  v_music_genres := COALESCE(
    (SELECT array_agg(value::text)
     FROM jsonb_array_elements_text(COALESCE(v_business_draft->'musicGenres', '[]'::jsonb))),
    ARRAY[]::text[]
  );

  IF v_city IS NULL THEN
    RAISE EXCEPTION 'city_required';
  END IF;

  IF array_length(v_party_types, 1) IS NULL THEN
    RAISE EXCEPTION 'party_types_required';
  END IF;

  IF NOT (v_party_types <@ ARRAY[
    'birthday-party','rooftop-party','club-night','house-party','warehouse-party',
    'beach-party','pool-party','boat-party','themed-party','corporate-event',
    'graduation-party','holiday-party','networking-event','rave','festival'
  ]::text[]) THEN
    RAISE EXCEPTION 'party_types_not_canonical';
  END IF;

  IF NOT (v_vibe_tags <@ ARRAY[
    'energetic','chill','intimate','wild','classy','casual','upscale','underground',
    'mainstream','artsy','social','exclusive','laid-back','vibrant','retro','futuristic'
  ]::text[]) THEN
    RAISE EXCEPTION 'vibe_tags_not_canonical';
  END IF;

  IF NOT (v_music_genres <@ ARRAY[
    'electronic-edm','house','hiphop-rap','pop','rock','latin','afrobeats',
    'afro-house','amapiano','gospel','rnb-soul','disco-funk','reggae-dancehall',
    'indie','country','jazz','classical','mixed-variety'
  ]::text[]) THEN
    RAISE EXCEPTION 'music_genres_not_canonical';
  END IF;

  v_visibility := CASE COALESCE(v_business_draft->>'requestedVisibility', 'public')
    WHEN 'private' THEN 'private'
    WHEN 'unlisted' THEN 'hidden'
    ELSE 'public'
  END;

  v_base_slug := lower(regexp_replace(v_title, '[^a-zA-Z0-9]+', '-', 'g'));
  v_base_slug := regexp_replace(v_base_slug, '(^-+|-+$)', '', 'g');
  IF v_base_slug = '' OR v_base_slug LIKE 'draft-%' THEN
    v_base_slug := 'event';
  END IF;
  v_final_slug := v_base_slug;

  WHILE EXISTS (
    SELECT 1
    FROM public.events e
    WHERE e.brand_id = v_event.brand_id
      AND e.deleted_at IS NULL
      AND e.id <> p_event_id
      AND lower(e.slug) = lower(v_final_slug)
  ) LOOP
    v_final_slug := v_base_slug || '-' || v_suffix::text;
    v_suffix := v_suffix + 1;
  END LOOP;

  v_description := NULLIF(p_draft_payload->>'description', '');
  v_location_text := NULLIF(p_draft_payload->>'location_text', '');
  v_online_url := NULLIF(p_draft_payload->>'online_url', '');
  v_cover_media_url := NULLIF(p_draft_payload->>'cover_media_url', '');
  v_cover_media_type := NULLIF(p_draft_payload->>'cover_media_type', '');
  v_cover_media_provider := NULLIF(p_draft_payload->>'cover_media_provider', '');
  v_cover_media_source_url := NULLIF(p_draft_payload->>'cover_media_source_url', '');
  v_cover_media_credit := NULLIF(p_draft_payload->>'cover_media_credit', '');
  v_cover_media_credit_url := NULLIF(p_draft_payload->>'cover_media_credit_url', '');
  v_cover_media_alt := NULLIF(p_draft_payload->>'cover_media_alt', '');
  -- issue #868 — ADDITIVE + INDEPENDENT: read the extra-photos gallery; it is
  -- NOT nulled when the cover url is absent (a photo gallery coexists with any
  -- cover, incl. a video cover). Default [] preserves single-cover behavior.
  v_cover_media_gallery := COALESCE(p_draft_payload->'cover_media_gallery', '[]'::jsonb);
  IF v_cover_media_url IS NULL THEN
    v_cover_media_type := NULL;
    v_cover_media_provider := NULL;
    v_cover_media_source_url := NULL;
    v_cover_media_credit := NULL;
    v_cover_media_credit_url := NULL;
    v_cover_media_alt := NULL;
  END IF;
  v_timezone := COALESCE(NULLIF(p_draft_payload->>'timezone', ''), v_event.timezone, 'UTC');

  v_when_mode := COALESCE(NULLIF(v_business_draft->>'whenMode', ''), 'single');
  v_when := v_business_draft->'when';
  v_multi_dates := v_business_draft->'multiDates';

  IF v_when_mode NOT IN ('single', 'multi_date', 'recurring') THEN
    RAISE EXCEPTION 'event_date_required';
  END IF;

  DELETE FROM public.event_dates WHERE event_id = p_event_id;

  IF v_when_mode IN ('single', 'recurring') THEN
    v_date_iso := NULLIF(v_when->>'date', '');
    IF v_date_iso IS NULL THEN
      RAISE EXCEPTION 'event_date_required';
    END IF;
    v_doors := COALESCE(NULLIF(v_when->>'doorsOpen', ''), '00:00');
    v_ends := COALESCE(NULLIF(v_when->>'endsAt', ''), v_doors);
    v_start := (v_date_iso || ' ' || v_doors || ':00')::timestamp AT TIME ZONE v_timezone;
    v_end := (v_date_iso || ' ' || v_ends || ':00')::timestamp AT TIME ZONE v_timezone;
    IF v_end <= v_start THEN
      v_end := v_end + INTERVAL '1 day';
    END IF;
    INSERT INTO public.event_dates (event_id, start_at, end_at, timezone, is_master)
    VALUES (p_event_id, v_start, v_end, v_timezone, true);

  ELSIF v_when_mode = 'multi_date' THEN
    IF v_multi_dates IS NULL
      OR jsonb_typeof(v_multi_dates) IS DISTINCT FROM 'array'
      OR jsonb_array_length(v_multi_dates) = 0
    THEN
      RAISE EXCEPTION 'event_date_required';
    END IF;

    SELECT min(
      (entry->>'date' || ' ' || COALESCE(NULLIF(entry->>'startTime', ''), '00:00') || ':00')::timestamp AT TIME ZONE v_timezone
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
      v_ends := COALESCE(NULLIF(v_date_entry->>'endTime', ''), v_doors);
      v_start := (v_date_iso || ' ' || v_doors || ':00')::timestamp AT TIME ZONE v_timezone;
      v_end := (v_date_iso || ' ' || v_ends || ':00')::timestamp AT TIME ZONE v_timezone;
      IF v_end <= v_start THEN
        v_end := v_end + INTERVAL '1 day';
      END IF;
      INSERT INTO public.event_dates (event_id, start_at, end_at, timezone, is_master)
      VALUES (p_event_id, v_start, v_end, v_timezone, v_start = v_min_start);
    END LOOP;
  END IF;

  -- ORCH-1075 paid-publish integrity guards (event publish path) ---------
  -- PAID = a ticket about to be written that is online-sellable
  -- (availableAt in ('online','both')) AND has price_cents > 0. In-person-only
  -- paid tickets (availableAt='door') and FREE tickets are exempt: they cannot
  -- reach the buyer-web/native checkout 409, so Guard A is N/A (operator-confirmed
  -- 2026-06-04). Mirror the checkout readiness predicate + reject past-dated paid
  -- publishes BEFORE the status flips to scheduled.
  --   Stripe charges_enabled: https://docs.stripe.com/api/accounts/object
  --   Finish onboarding:      https://docs.stripe.com/connect/onboarding.md
  SELECT bool_or(
           COALESCE((t->>'availableAt'), 'both') IN ('online', 'both')
           AND NOT COALESCE((t->>'isFree')::boolean, false)
           AND round(
                 COALESCE(
                   NULLIF(t->>'priceMajor', '')::numeric,
                   NULLIF(t->>'price', '')::numeric,
                   NULLIF(t->>'priceGbp', '')::numeric,
                   0
                 ) * 100
               ) > 0
         )
    INTO v_paid_online
    FROM jsonb_array_elements(v_tickets) t;

  IF COALESCE(v_paid_online, false) THEN
    IF NOT public.pg_brand_can_charge(v_event.brand_id) THEN
      RAISE EXCEPTION 'stripe_charges_disabled';
    END IF;
    SELECT max(ed.end_at) INTO v_max_end
      FROM public.event_dates ed
     WHERE ed.event_id = p_event_id;
    IF v_max_end IS NULL OR v_max_end <= v_now THEN
      RAISE EXCEPTION 'offering_date_past';
    END IF;
  END IF;

  -- issue #1014 deltas (3)+(4) — money-bearing predicate + explicit currency
  -- gate, grouped with the ORCH-1075 guards (before the events write). ANY
  -- ticket priced > 0 (online OR door, isFree flag irrelevant — price is
  -- truth) makes the publish money-bearing; money without a resolvable
  -- currency fails close HERE for error locality (the trigger remains the
  -- backstop for undeclared paths).
  SELECT bool_or(
           round(
             COALESCE(
               NULLIF(t->>'priceMajor', '')::numeric,
               NULLIF(t->>'price', '')::numeric,
               NULLIF(t->>'priceGbp', '')::numeric,
               0
             ) * 100
           ) > 0
         )
    INTO v_money_bearing
    FROM jsonb_array_elements(v_tickets) t;

  IF COALESCE(v_money_bearing, false) AND v_currency IS NULL THEN
    RAISE EXCEPTION 'event_currency_required';
  END IF;

  PERFORM set_config('mingla.business_publish_event_draft', 'on', true);
  -- issue #1014 delta (5): declare the moneyless transition to
  -- tg_require_event_brand_currency (transaction-scoped flag).
  IF NOT COALESCE(v_money_bearing, false) THEN
    PERFORM set_config('mingla.publish_free_only', 'on', true);
  END IF;

  -- ORCH-0824: write the four new top-level columns + strip taxonomy keys
  -- and deprecated 'category' from business_event JSONB so the same data
  -- is not stored in two places.
  UPDATE public.events
  SET
    title = v_title,
    description = v_description,
    slug = v_final_slug,
    location_text = v_location_text,
    online_url = v_online_url,
    cover_media_url = v_cover_media_url,
    cover_media_type = v_cover_media_type,
    cover_media_provider = v_cover_media_provider,
    cover_media_source_url = v_cover_media_source_url,
    cover_media_credit = v_cover_media_credit,
    cover_media_credit_url = v_cover_media_credit_url,
    cover_media_alt = v_cover_media_alt,
    cover_media_gallery = v_cover_media_gallery,
    is_online = COALESCE((p_draft_payload->>'is_online')::boolean, false),
    is_recurring = COALESCE((p_draft_payload->>'is_recurring')::boolean, false),
    is_multi_date = COALESCE((p_draft_payload->>'is_multi_date')::boolean, false),
    recurrence_rules = p_draft_payload->'recurrence_rules',
    theme = (v_theme - 'business_draft') || jsonb_build_object(
      'business_event',
      (v_business_draft
        - 'tickets'
        - 'category'      -- ORCH-0824: deprecated; promoted to party_types column
        - 'partyTypes'    -- ORCH-0824: promoted to party_types column
        - 'vibeTags'      -- ORCH-0824: promoted to vibe_tags column
        - 'musicGenres'   -- ORCH-0824: promoted to music_genres column
        - 'city'          -- ORCH-0824: promoted to city column
        - 'locationGeo'   -- ORCH-0824: cached client-side only
      ) || jsonb_build_object('currency', v_currency::text),
      'coverHue',
      COALESCE(v_business_draft->'coverHue', v_theme->'coverHue', '25'::jsonb)
    ),
    currency = v_currency,
    status = 'scheduled',
    visibility = v_visibility,
    published_at = v_now,
    timezone = v_timezone,
    -- ORCH-0824: new top-level columns
    city = v_city,
    party_types = v_party_types,
    vibe_tags = v_vibe_tags,
    music_genres = v_music_genres,
    updated_at = v_now
  WHERE id = p_event_id
    AND status = 'draft'
    AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'event_draft_not_publishable';
  END IF;

  UPDATE public.ticket_types
  SET deleted_at = v_now, updated_at = v_now
  WHERE event_id = p_event_id
    AND deleted_at IS NULL;

  FOR v_ticket IN SELECT value FROM jsonb_array_elements(v_tickets)
  LOOP
    v_price := COALESCE(
      NULLIF(v_ticket->>'priceMajor', '')::numeric,
      NULLIF(v_ticket->>'price', '')::numeric,
      NULLIF(v_ticket->>'priceGbp', '')::numeric,
      0
    );

    INSERT INTO public.ticket_types (
      event_id, name, description, price_cents, currency,
      quantity_total, is_unlimited, is_free,
      sale_start_at, sale_end_at,
      min_purchase_qty, max_purchase_qty,
      is_hidden, is_disabled, requires_approval, allow_transfers,
      password_protected, password_hash,
      available_online, available_in_person,
      waitlist_enabled, display_order, deleted_at
    ) VALUES (
      p_event_id,
      btrim(v_ticket->>'name'),
      NULLIF(v_ticket->>'description', ''),
      CASE
        WHEN COALESCE((v_ticket->>'isFree')::boolean, false) THEN 0
        ELSE round(v_price * 100)::integer
      END,
      v_currency,
      CASE
        WHEN COALESCE((v_ticket->>'isUnlimited')::boolean, false) THEN NULL
        ELSE COALESCE((v_ticket->>'capacity')::integer, 0)
      END,
      COALESCE((v_ticket->>'isUnlimited')::boolean, false),
      COALESCE((v_ticket->>'isFree')::boolean, false),
      NULLIF(v_ticket->>'saleStartAt', '')::timestamptz,
      NULLIF(v_ticket->>'saleEndAt', '')::timestamptz,
      COALESCE((v_ticket->>'minPurchaseQty')::integer, 1),
      NULLIF(v_ticket->>'maxPurchaseQty', '')::integer,
      COALESCE(v_ticket->>'visibility', 'public') = 'hidden',
      COALESCE(v_ticket->>'visibility', 'public') = 'disabled',
      COALESCE((v_ticket->>'approvalRequired')::boolean, false),
      COALESCE((v_ticket->>'allowTransfers')::boolean, true),
      COALESCE((v_ticket->>'passwordProtected')::boolean, false),
      NULL,
      COALESCE(v_ticket->>'availableAt', 'both') IN ('online', 'both'),
      COALESCE(v_ticket->>'availableAt', 'both') IN ('door', 'both'),
      COALESCE((v_ticket->>'waitlistEnabled')::boolean, false),
      COALESCE((v_ticket->>'displayOrder')::integer, 0),
      NULL
    );
  END LOOP;

  SELECT COALESCE(jsonb_agg(to_jsonb(tt) ORDER BY tt.display_order), '[]'::jsonb)
  INTO v_ticket_rows
  FROM public.ticket_types tt
  WHERE tt.event_id = p_event_id
    AND tt.deleted_at IS NULL;

  SELECT *
  INTO v_event
  FROM public.events
  WHERE id = p_event_id;

  SELECT COALESCE(jsonb_agg(to_jsonb(ed) ORDER BY ed.start_at), '[]'::jsonb)
  INTO v_event_dates_rows
  FROM public.event_dates ed
  WHERE ed.event_id = p_event_id;

  RETURN jsonb_build_object(
    'event', to_jsonb(v_event),
    'brand', jsonb_build_object(
      'id', v_brand.id,
      'slug', v_brand.slug,
      'name', v_brand.name
    ),
    'tickets', v_ticket_rows,
    'eventDates', v_event_dates_rows,
    'client_revision', p_client_revision
  );
END;
$$;

COMMENT ON FUNCTION public.business_publish_event_draft(uuid, jsonb, integer) IS
  'ORCH-0824: extends ORCH-0792 body with new event taxonomy (city + party_types + vibe_tags + music_genres) read/validate/write. Raises city_required, party_types_required, party_types_not_canonical, vibe_tags_not_canonical, music_genres_not_canonical on validation failure. issue #1014: GBP fabrication removed (v_currency may be NULL); NGN whitelisted; money-bearing publishes (any ticket priced > 0, online OR door) raise event_currency_required when the currency is unresolvable; moneyless publishes set the transaction-scoped mingla.publish_free_only flag so tg_require_event_brand_currency permits a NULL published currency.';

GRANT EXECUTE ON FUNCTION public.business_publish_event_draft(uuid, jsonb, integer) TO authenticated;

-- ============================================================
-- 2) business_publish_rsvp_draft — + cover_media_gallery persist
-- ============================================================
CREATE OR REPLACE FUNCTION public.business_publish_rsvp_draft(
  p_event_id uuid,
  p_draft_payload jsonb,
  p_client_revision integer DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id uuid;
  v_event public.events%ROWTYPE;
  v_brand record;
  v_theme jsonb;
  v_business_draft jsonb;
  v_title text;
  v_description text;
  v_location_text text;
  v_online_url text;
  v_cover_media_url text;
  v_cover_media_type text;
  v_cover_media_provider text;
  v_cover_media_source_url text;
  v_cover_media_credit text;
  v_cover_media_credit_url text;
  v_cover_media_alt text;
  v_cover_media_gallery jsonb;  -- issue #868 (additive, independent)
  v_timezone text;
  v_visibility text;
  v_base_slug text;
  v_final_slug text;
  v_suffix integer := 2;
  v_now timestamptz := now();
  v_event_dates_rows jsonb;
  v_when jsonb;
  v_date_iso text;
  v_doors text;
  v_ends text;
  v_start timestamptz;
  v_end timestamptz;
  v_city text;
  v_party_types text[];
  v_vibe_tags text[];
  v_music_genres text[];
  -- RSVP host-control locals.
  v_rsvp_capacity integer;
  v_rsvp_allow_plus_ones boolean;
  v_rsvp_plus_ones_max integer;
  v_rsvp_waitlist_enabled boolean;
  v_rsvp_approval_mode text;
  v_rsvp_discoverable boolean;
  -- ORCH-1291 — voluntary chip-in config.
  v_rsvp_contribution_enabled boolean;
  v_rsvp_contribution_suggested_cents integer;
  v_rsvp_contribution_min_cents integer;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT * INTO v_event FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'event_draft_not_found';
  END IF;
  IF v_event.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'event_draft_deleted';
  END IF;
  IF v_event.status <> 'draft' THEN
    RAISE EXCEPTION 'event_draft_not_publishable';
  END IF;
  IF public.biz_brand_effective_rank(v_event.brand_id, v_user_id) < public.biz_role_rank('event_manager'::text) THEN
    RAISE EXCEPTION 'insufficient_event_permission';
  END IF;

  SELECT id, slug, name, default_currency INTO v_brand
    FROM public.brands WHERE id = v_event.brand_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'brand_not_found';
  END IF;

  v_theme := COALESCE(p_draft_payload->'theme', '{}'::jsonb);
  v_business_draft := COALESCE(v_theme->'business_draft', '{}'::jsonb);

  v_title := NULLIF(btrim(COALESCE(p_draft_payload->>'title', '')), '');
  IF v_title IS NULL THEN
    RAISE EXCEPTION 'event_title_required';
  END IF;

  -- Taxonomy (party-type gate KEPT — steering #2). City NOT required (freeform).
  v_city := NULLIF(btrim(COALESCE(v_business_draft->>'city', '')), '');
  v_party_types := COALESCE(
    (SELECT array_agg(value::text)
     FROM jsonb_array_elements_text(COALESCE(v_business_draft->'partyTypes', '[]'::jsonb))),
    ARRAY[]::text[]);
  v_vibe_tags := COALESCE(
    (SELECT array_agg(value::text)
     FROM jsonb_array_elements_text(COALESCE(v_business_draft->'vibeTags', '[]'::jsonb))),
    ARRAY[]::text[]);
  v_music_genres := COALESCE(
    (SELECT array_agg(value::text)
     FROM jsonb_array_elements_text(COALESCE(v_business_draft->'musicGenres', '[]'::jsonb))),
    ARRAY[]::text[]);

  IF array_length(v_party_types, 1) IS NULL THEN
    RAISE EXCEPTION 'party_types_required';
  END IF;
  IF NOT (v_party_types <@ ARRAY[
    'birthday-party','rooftop-party','club-night','house-party','warehouse-party',
    'beach-party','pool-party','boat-party','themed-party','corporate-event',
    'graduation-party','holiday-party','networking-event','rave','festival'
  ]::text[]) THEN
    RAISE EXCEPTION 'party_types_not_canonical';
  END IF;
  IF NOT (v_vibe_tags <@ ARRAY[
    'energetic','chill','intimate','wild','classy','casual','upscale','underground',
    'mainstream','artsy','social','exclusive','laid-back','vibrant','retro','futuristic'
  ]::text[]) THEN
    RAISE EXCEPTION 'vibe_tags_not_canonical';
  END IF;
  IF NOT (v_music_genres <@ ARRAY[
    'electronic-edm','house','hiphop-rap','pop','rock','latin','afrobeats',
    'afro-house','amapiano','gospel','rnb-soul','disco-funk','reggae-dancehall',
    'indie','country','jazz','classical','mixed-variety'
  ]::text[]) THEN
    RAISE EXCEPTION 'music_genres_not_canonical';
  END IF;

  -- RSVP host-control reads.
  v_rsvp_capacity := NULLIF(v_business_draft->>'rsvpCapacity', '')::integer;
  v_rsvp_allow_plus_ones := COALESCE((v_business_draft->>'rsvpAllowPlusOnes')::boolean, false);
  v_rsvp_plus_ones_max := COALESCE((v_business_draft->>'rsvpPlusOnesMax')::integer, 0);
  v_rsvp_waitlist_enabled := COALESCE((v_business_draft->>'rsvpWaitlistEnabled')::boolean, false);
  v_rsvp_approval_mode := COALESCE(NULLIF(v_business_draft->>'rsvpApprovalMode', ''), 'auto');
  IF v_rsvp_approval_mode NOT IN ('auto', 'manual') THEN
    RAISE EXCEPTION 'rsvp_approval_mode_invalid';
  END IF;
  v_rsvp_discoverable := COALESCE((v_business_draft->>'rsvpDiscoverable')::boolean, false);

  -- ORCH-1291 — voluntary chip-in config reads (nullable; absent → disabled/NULL).
  v_rsvp_contribution_enabled := COALESCE((v_business_draft->>'rsvpContributionEnabled')::boolean, false);
  v_rsvp_contribution_suggested_cents := NULLIF(v_business_draft->>'rsvpContributionSuggestedCents', '')::integer;
  v_rsvp_contribution_min_cents := NULLIF(v_business_draft->>'rsvpContributionMinCents', '')::integer;

  -- ORCH-1291 — CONDITIONAL provider-aware bank-gate. ONLY when chip-in is
  -- enabled does the RSVP become a money-collector requiring a connected payout
  -- rail. pg_brand_can_collect is PROVIDER-AWARE (Stripe charges_enabled OR
  -- Paystack subaccount) — reusing the Stripe-only pg_brand_can_charge here would
  -- wrongly block every NGN brand (investigation F-4/D-1). A FREE RSVP
  -- (enabled=false) is NEVER gated (SC-6). Raises the ORCH-1075-recognized
  -- 'stripe_charges_disabled' reason so paidPublishGuards routes to bank setup.
  IF v_rsvp_contribution_enabled AND NOT public.pg_brand_can_collect(v_event.brand_id) THEN
    RAISE EXCEPTION 'stripe_charges_disabled'
      USING HINT = 'RSVP chip-in is enabled but the brand cannot collect (no connected bank / subaccount).';
  END IF;

  v_visibility := CASE COALESCE(v_business_draft->>'requestedVisibility', 'public')
    WHEN 'private' THEN 'private'
    WHEN 'unlisted' THEN 'hidden'
    ELSE 'public'
  END;
  -- A private RSVP can never be on a public discovery feed.
  IF v_visibility = 'private' THEN
    v_rsvp_discoverable := false;
  END IF;

  -- Slug.
  v_base_slug := lower(regexp_replace(v_title, '[^a-zA-Z0-9]+', '-', 'g'));
  v_base_slug := regexp_replace(v_base_slug, '(^-+|-+$)', '', 'g');
  IF v_base_slug = '' OR v_base_slug LIKE 'draft-%' THEN
    v_base_slug := 'rsvp';
  END IF;
  v_final_slug := v_base_slug;
  WHILE EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.brand_id = v_event.brand_id AND e.deleted_at IS NULL
      AND e.id <> p_event_id AND lower(e.slug) = lower(v_final_slug)
  ) LOOP
    v_final_slug := v_base_slug || '-' || v_suffix::text;
    v_suffix := v_suffix + 1;
  END LOOP;

  v_description := NULLIF(p_draft_payload->>'description', '');
  v_location_text := NULLIF(p_draft_payload->>'location_text', '');
  v_online_url := NULLIF(p_draft_payload->>'online_url', '');
  v_cover_media_url := NULLIF(p_draft_payload->>'cover_media_url', '');
  v_cover_media_type := NULLIF(p_draft_payload->>'cover_media_type', '');
  v_cover_media_provider := NULLIF(p_draft_payload->>'cover_media_provider', '');
  v_cover_media_source_url := NULLIF(p_draft_payload->>'cover_media_source_url', '');
  v_cover_media_credit := NULLIF(p_draft_payload->>'cover_media_credit', '');
  v_cover_media_credit_url := NULLIF(p_draft_payload->>'cover_media_credit_url', '');
  v_cover_media_alt := NULLIF(p_draft_payload->>'cover_media_alt', '');
  -- issue #868 — ADDITIVE + INDEPENDENT extra-photos gallery (never nulled by
  -- the cover-absent branch; default [] = single-cover behavior).
  v_cover_media_gallery := COALESCE(p_draft_payload->'cover_media_gallery', '[]'::jsonb);
  IF v_cover_media_url IS NULL THEN
    v_cover_media_type := NULL; v_cover_media_provider := NULL;
    v_cover_media_source_url := NULL; v_cover_media_credit := NULL;
    v_cover_media_credit_url := NULL; v_cover_media_alt := NULL;
  END IF;
  v_timezone := COALESCE(NULLIF(p_draft_payload->>'timezone', ''), v_event.timezone, 'UTC');

  -- Single-date only (steering #4).
  v_when := v_business_draft->'when';
  v_date_iso := NULLIF(v_when->>'date', '');
  IF v_date_iso IS NULL THEN
    RAISE EXCEPTION 'event_date_required';
  END IF;
  v_doors := COALESCE(NULLIF(v_when->>'doorsOpen', ''), '00:00');
  v_ends := COALESCE(NULLIF(v_when->>'endsAt', ''), v_doors);
  v_start := (v_date_iso || ' ' || v_doors || ':00')::timestamp AT TIME ZONE v_timezone;
  v_end := (v_date_iso || ' ' || v_ends || ':00')::timestamp AT TIME ZONE v_timezone;
  IF v_end <= v_start THEN
    v_end := v_end + INTERVAL '1 day';
  END IF;

  -- Discoverable RSVPs must be future-dated (no dead deck card). Link-only is
  -- allowed same-day. NO stripe gate for FREE RSVPs (moneyless).
  IF v_rsvp_discoverable AND v_end <= v_now THEN
    RAISE EXCEPTION 'offering_date_past';
  END IF;

  DELETE FROM public.event_dates WHERE event_id = p_event_id;
  INSERT INTO public.event_dates (event_id, start_at, end_at, timezone, is_master)
  VALUES (p_event_id, v_start, v_end, v_timezone, true);

  -- Permit the draft->scheduled slug finalization (ORCH-0763 trigger).
  PERFORM set_config('mingla.business_publish_event_draft', 'on', true);
  -- issue #1014 — an RSVP is money-bearing ONLY when chip-in is enabled
  -- (RSVPs create ZERO ticket rows). Chip-in OFF → declare the moneyless
  -- transition so tg_require_event_brand_currency permits a NULL published
  -- currency for a currency-less brand. Chip-in ON on a can_collect brand
  -- whose currency still does not resolve hits the trigger's strict path →
  -- event_currency_required (actionable client copy).
  IF NOT v_rsvp_contribution_enabled THEN
    PERFORM set_config('mingla.publish_free_only', 'on', true);
  END IF;

  UPDATE public.events
  SET
    event_type = 'rsvp',
    title = v_title,
    description = v_description,
    slug = v_final_slug,
    location_text = v_location_text,
    online_url = v_online_url,
    cover_media_url = v_cover_media_url,
    cover_media_type = v_cover_media_type,
    cover_media_provider = v_cover_media_provider,
    cover_media_source_url = v_cover_media_source_url,
    cover_media_credit = v_cover_media_credit,
    cover_media_credit_url = v_cover_media_credit_url,
    cover_media_alt = v_cover_media_alt,
    cover_media_gallery = v_cover_media_gallery,
    is_online = COALESCE((p_draft_payload->>'is_online')::boolean, false),
    is_recurring = false,
    is_multi_date = false,
    recurrence_rules = NULL,
    theme = (v_theme - 'business_draft') || jsonb_build_object(
      'business_event',
      (v_business_draft
        - 'tickets' - 'category' - 'partyTypes' - 'vibeTags' - 'musicGenres'
        - 'city' - 'locationGeo'),
      'coverHue',
      COALESCE(v_business_draft->'coverHue', v_theme->'coverHue', '25'::jsonb)
    ),
    status = 'scheduled',
    visibility = v_visibility,
    published_at = v_now,
    timezone = v_timezone,
    city = v_city,
    party_types = v_party_types,
    vibe_tags = v_vibe_tags,
    music_genres = v_music_genres,
    rsvp_capacity = v_rsvp_capacity,
    rsvp_allow_plus_ones = v_rsvp_allow_plus_ones,
    rsvp_plus_ones_max = CASE WHEN v_rsvp_allow_plus_ones THEN GREATEST(v_rsvp_plus_ones_max, 0) ELSE 0 END,
    rsvp_waitlist_enabled = v_rsvp_waitlist_enabled,
    rsvp_approval_mode = v_rsvp_approval_mode,
    rsvp_discoverable = v_rsvp_discoverable,
    -- ORCH-1291 — persist the voluntary chip-in config.
    rsvp_contribution_enabled = v_rsvp_contribution_enabled,
    rsvp_contribution_suggested_cents = v_rsvp_contribution_suggested_cents,
    rsvp_contribution_min_cents = v_rsvp_contribution_min_cents,
    updated_at = v_now
  WHERE id = p_event_id AND status = 'draft' AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'event_draft_not_publishable';
  END IF;

  -- An RSVP creates ZERO ticket_types (I-PROPOSED-1150-RSVP-NO-TICKET-ROWS).
  -- Defensive: soft-delete any stray ticket rows from a mis-routed draft.
  UPDATE public.ticket_types
     SET deleted_at = v_now, updated_at = v_now
   WHERE event_id = p_event_id AND deleted_at IS NULL;

  SELECT * INTO v_event FROM public.events WHERE id = p_event_id;
  SELECT COALESCE(jsonb_agg(to_jsonb(ed) ORDER BY ed.start_at), '[]'::jsonb)
    INTO v_event_dates_rows
    FROM public.event_dates ed WHERE ed.event_id = p_event_id;

  RETURN jsonb_build_object(
    'event', to_jsonb(v_event),
    'brand', jsonb_build_object('id', v_brand.id, 'slug', v_brand.slug, 'name', v_brand.name),
    'tickets', '[]'::jsonb,
    'eventDates', v_event_dates_rows,
    'client_revision', p_client_revision
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.business_publish_rsvp_draft(uuid, jsonb, integer) TO authenticated;

COMMENT ON FUNCTION public.business_publish_rsvp_draft(uuid, jsonb, integer) IS
  'ORCH-1150 + ORCH-1291 — RSVP publish RPC. Zero tickets; keeps party-type gate. '
  'ORCH-1291: CONDITIONAL provider-aware bank-gate — when rsvpContributionEnabled '
  'the brand must pg_brand_can_collect (Stripe OR Paystack), else RAISE '
  'stripe_charges_disabled; FREE RSVPs stay ungated. Persists the 3 chip-in '
  'config columns. do NOT merge back into the event/ticket path. '
  'issue #1014: chip-in-OFF publishes set the transaction-scoped '
  'mingla.publish_free_only flag so a currency-less brand publishes with '
  'events.currency NULL.';

-- ============================================================
-- 3) biz_update_live_trip — §5a events UPDATE + cover_media_gallery
-- ============================================================
CREATE OR REPLACE FUNCTION public.biz_update_live_trip(
  p_event_id uuid,
  p_patch jsonb,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid;
  v_event public.events%ROWTYPE;
  v_trimmed_reason text;
  v_severity text;
  v_changed_keys text[] := '{}';
  v_sold_by_tier jsonb;
  v_log_id uuid;
  v_business_trip jsonb;
  v_new_business_trip jsonb;
  v_old_start timestamptz;
  v_new_start timestamptz;
  v_old_end timestamptz;
  v_new_end timestamptz;
  v_old_capacity int;
  v_new_capacity int;
  v_ticket_type_id uuid;
  v_total_sold int;
  v_existing_day_ordinals int[];
  v_new_day_ordinals int[];
  v_dropped_ordinals int[];
  v_existing_inclusion_keys text[];
  v_new_inclusion_keys text[];
  v_dropped_inclusions text[];
  v_tier record;
  v_new_tier jsonb;
  v_affected_order_count int := 0;
  v_diff_summary jsonb := '{}'::jsonb;
  v_affected_order_ids uuid[];
  v_now timestamptz := now();
  -- ORCH-0880 Tr5 additions:
  v_intake_schema_entry jsonb;
  v_intake_ticket_type_id uuid;
  v_intake_schema jsonb;
  v_intake_changed_tier_ids uuid[] := '{}'::uuid[];
  -- ORCH-1075: paid-edit guard locals.
  v_trip_price_cents int;
  v_guard_end timestamptz;
  -- ORCH-1120: refund/deadline/bookings-closed gate locals.
  v_old_policy jsonb;
  v_new_policy jsonb;
  v_thresholds int[];
  v_threshold int;
  v_old_pct int;
  v_new_pct int;
  v_refund_unfavorable boolean := false;
  v_old_deadline timestamptz;
  v_new_deadline timestamptz;
  v_old_closed boolean;
  v_new_closed boolean;
BEGIN
  -- ---------- 1. Auth + reason validation ----------
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'authentication_required';
  END IF;

  v_trimmed_reason := btrim(COALESCE(p_reason, ''));
  IF v_trimmed_reason = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_edit_reason');
  END IF;
  IF char_length(v_trimmed_reason) < 10 OR char_length(v_trimmed_reason) > 200 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_edit_reason');
  END IF;

  -- ---------- 2. Event lookup + type/permission gates ----------
  SELECT * INTO v_event
  FROM public.events
  WHERE id = p_event_id
    AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'trip_not_found');
  END IF;

  IF v_event.event_type <> 'trip' THEN
    RAISE EXCEPTION 'event_not_a_trip'
      USING HINT = 'biz_update_live_trip only handles event_type=trip rows. Use the event-side mutation path for events.';
  END IF;

  IF v_event.status NOT IN ('scheduled', 'live') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'trip_not_editable_status');
  END IF;

  IF public.biz_brand_effective_rank(v_event.brand_id, v_user_id)
       < public.biz_role_rank('event_manager'::text) THEN
    RAISE EXCEPTION 'insufficient_event_permission';
  END IF;


  -- ORCH-1075 paid-publish integrity guards (trip live-edit) -------------
  -- Block a PAID trip edit while not Stripe-ready, and block shifting a paid
  -- trip's range onto an already-past end. Structured return shape matches this
  -- RPC. FREE / in-person-only trips are exempt. Effective end = patched endAt
  -- when present, else the current master event_date end.
  --   Stripe charges_enabled: https://docs.stripe.com/api/accounts/object
  --   Finish onboarding:      https://docs.stripe.com/connect/onboarding.md
  SELECT max(tt.price_cents) INTO v_trip_price_cents
    FROM public.trip_pricing_tiers tpt
    JOIN public.ticket_types tt ON tt.id = tpt.ticket_type_id
   WHERE tpt.event_id = p_event_id
     AND tt.deleted_at IS NULL
     AND tt.available_online = true;

  IF COALESCE(v_trip_price_cents, 0) > 0 THEN
    IF NOT public.pg_brand_can_charge(v_event.brand_id) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'stripe_charges_disabled');
    END IF;
    v_guard_end := COALESCE(
      NULLIF(p_patch->'theme'->'business_trip'->>'endAt', '')::timestamptz,
      (SELECT ed.end_at FROM public.event_dates ed
        WHERE ed.event_id = p_event_id AND ed.is_master = true LIMIT 1)
    );
    IF v_guard_end IS NULL OR v_guard_end <= v_now THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'offering_date_past');
    END IF;
  END IF;

  -- ---------- 3. Compute sold-count context ----------
  v_sold_by_tier := public.biz_trip_sold_count_by_tier(p_event_id);

  SELECT COALESCE(SUM((value)::int), 0)
    INTO v_total_sold
    FROM jsonb_each_text(v_sold_by_tier);

  -- ---------- 4. Refund-gate validation per patch shape ----------

  -- 4a. Capacity check. ORCH-0950: source of truth is ticket_types.quantity_total.
  v_business_trip := COALESCE(v_event.theme->'business_trip', '{}'::jsonb);
  v_new_business_trip := COALESCE(p_patch->'theme'->'business_trip', '{}'::jsonb);

  IF v_new_business_trip ? 'capacity' THEN
    v_new_capacity := NULLIF(v_new_business_trip->>'capacity', '')::int;
    IF v_new_capacity IS NULL OR v_new_capacity <= 0 THEN
      RAISE EXCEPTION 'trip_capacity_required';
    END IF;

    SELECT tt.quantity_total, tt.id
      INTO v_old_capacity, v_ticket_type_id
    FROM public.ticket_types tt
    JOIN public.trip_pricing_tiers tpt ON tpt.ticket_type_id = tt.id
    WHERE tpt.event_id = p_event_id
      AND tt.deleted_at IS NULL
    LIMIT 1;

    IF v_ticket_type_id IS NULL THEN
      RAISE EXCEPTION 'trip_pricing_tier_missing';
    END IF;

    IF v_new_capacity < v_total_sold THEN
      RETURN jsonb_build_object(
        'ok', false,
        'reason', 'capacity_below_sold',
        'affected_order_count', v_total_sold
      );
    END IF;

    UPDATE public.ticket_types
    SET quantity_total = v_new_capacity,
        updated_at = v_now
    WHERE id = v_ticket_type_id;

    -- Remove capacity from the inbound patch before any theme merge.
    p_patch := p_patch #- '{theme,business_trip,capacity}';
  END IF;

  -- 4b. Date shift check
  IF v_new_business_trip ? 'startAt' OR v_new_business_trip ? 'endAt' THEN
    SELECT ed.start_at, ed.end_at
      INTO v_old_start, v_old_end
    FROM public.event_dates ed
    WHERE ed.event_id = p_event_id
      AND ed.is_master = true
    LIMIT 1;

    v_new_start := COALESCE(
      NULLIF(v_new_business_trip->>'startAt', '')::timestamptz,
      v_old_start
    );
    v_new_end := COALESCE(
      NULLIF(v_new_business_trip->>'endAt', '')::timestamptz,
      v_old_end
    );
    IF v_total_sold > 0
       AND (v_new_start IS DISTINCT FROM v_old_start
            OR v_new_end IS DISTINCT FROM v_old_end) THEN
      RETURN jsonb_build_object(
        'ok', false,
        'reason', 'dates_shifted_with_sales',
        'affected_order_count', v_total_sold,
        'dropped_dates', jsonb_build_array(
          COALESCE(to_char(v_old_start, 'YYYY-MM-DD'), ''),
          COALESCE(to_char(v_old_end, 'YYYY-MM-DD'), '')
        )
      );
    END IF;

    UPDATE public.event_dates
    SET start_at = COALESCE(v_new_start, start_at),
        end_at = COALESCE(v_new_end, end_at),
        updated_at = v_now
    WHERE event_id = p_event_id
      AND is_master = true;

    p_patch := p_patch #- '{theme,business_trip,startAt}';
    p_patch := p_patch #- '{theme,business_trip,endAt}';
  END IF;

  -- 4b2. Destination text canonical write.
  IF v_new_business_trip ? 'destinationLocationText' THEN
    UPDATE public.events
    SET destination_text = NULLIF(btrim(v_new_business_trip->>'destinationLocationText'), ''),
        updated_at = v_now
    WHERE id = p_event_id;

    p_patch := p_patch #- '{theme,business_trip,destinationLocationText}';
    p_patch := p_patch #- '{theme,business_trip,destinationPlaceId}';
    p_patch := p_patch #- '{theme,business_trip,destinationLat}';
    p_patch := p_patch #- '{theme,business_trip,destinationLng}';
  END IF;

  -- ORCH-0950 expanded: preserve any non-canonical future business_trip
  -- siblings with a deep merge, then remove business_trip from p_patch so the
  -- top-level theme merge below cannot shallow-replace the nested object.
  IF p_patch ? 'theme'
     AND p_patch->'theme' ? 'business_trip'
     AND p_patch->'theme'->'business_trip' <> '{}'::jsonb THEN
    UPDATE public.events
    SET theme = jsonb_set(
          COALESCE(theme, '{}'::jsonb),
          '{business_trip}',
          COALESCE(theme->'business_trip', '{}'::jsonb)
            || (p_patch->'theme'->'business_trip')
        ),
        updated_at = v_now
    WHERE id = p_event_id;

    p_patch := p_patch #- '{theme,business_trip}';
  END IF;

  IF p_patch ? 'theme'
     AND p_patch->'theme' ? 'business_trip'
     AND p_patch->'theme'->'business_trip' = '{}'::jsonb THEN
    p_patch := p_patch #- '{theme,business_trip}';
  END IF;
  IF p_patch ? 'theme' AND p_patch->'theme' = '{}'::jsonb THEN
    p_patch := p_patch - 'theme';
  END IF;

  -- 4c. Days check
  IF p_patch ? 'days' THEN
    SELECT array_agg(ordinal ORDER BY ordinal)
      INTO v_existing_day_ordinals
      FROM public.trip_days
      WHERE event_id = p_event_id;
    v_existing_day_ordinals := COALESCE(v_existing_day_ordinals, '{}'::int[]);

    SELECT array_agg((d->>'ordinal')::int ORDER BY (d->>'ordinal')::int)
      INTO v_new_day_ordinals
      FROM jsonb_array_elements(p_patch->'days') d;
    v_new_day_ordinals := COALESCE(v_new_day_ordinals, '{}'::int[]);

    v_dropped_ordinals := (
      SELECT COALESCE(array_agg(o), '{}'::int[])
      FROM unnest(v_existing_day_ordinals) o
      WHERE NOT (o = ANY (v_new_day_ordinals))
    );

    IF array_length(v_dropped_ordinals, 1) > 0 AND v_total_sold > 0 THEN
      RETURN jsonb_build_object(
        'ok', false,
        'reason', 'days_dropped_with_sales',
        'affected_order_count', v_total_sold,
        'dropped_dates', to_jsonb(v_dropped_ordinals)
      );
    END IF;
  END IF;

  -- 4d. Inclusions check
  IF p_patch ? 'inclusions' THEN
    SELECT array_agg(kind || ':' || item)
      INTO v_existing_inclusion_keys
      FROM public.trip_inclusions
      WHERE event_id = p_event_id;
    v_existing_inclusion_keys := COALESCE(v_existing_inclusion_keys, '{}'::text[]);

    SELECT array_agg((i->>'kind') || ':' || (i->>'item'))
      INTO v_new_inclusion_keys
      FROM jsonb_array_elements(p_patch->'inclusions') i;
    v_new_inclusion_keys := COALESCE(v_new_inclusion_keys, '{}'::text[]);

    v_dropped_inclusions := (
      SELECT COALESCE(array_agg(k), '{}'::text[])
      FROM unnest(v_existing_inclusion_keys) k
      WHERE NOT (k = ANY (v_new_inclusion_keys))
    );

    IF array_length(v_dropped_inclusions, 1) > 0 AND v_total_sold > 0 THEN
      RETURN jsonb_build_object(
        'ok', false,
        'reason', 'inclusions_removed_with_sales',
        'affected_order_count', v_total_sold,
        'dropped_inclusions', to_jsonb(v_dropped_inclusions)
      );
    END IF;
  END IF;

  -- 4e. Pricing tier checks
  IF p_patch ? 'pricing_tiers' THEN
    FOR v_tier IN
      SELECT tpt.id AS tpt_id, tpt.ticket_type_id, tt.price_cents
      FROM public.trip_pricing_tiers tpt
      JOIN public.ticket_types tt ON tt.id = tpt.ticket_type_id
      WHERE tpt.event_id = p_event_id
    LOOP
      SELECT t INTO v_new_tier
        FROM jsonb_array_elements(p_patch->'pricing_tiers') t
       WHERE (t->>'ticket_type_id')::uuid = v_tier.ticket_type_id
       LIMIT 1;

      IF v_new_tier IS NULL THEN
        IF COALESCE((v_sold_by_tier->>v_tier.ticket_type_id::text)::int, 0) > 0 THEN
          RETURN jsonb_build_object(
            'ok', false,
            'reason', 'tier_delete_with_sales',
            'affected_order_count', (v_sold_by_tier->>v_tier.ticket_type_id::text)::int
          );
        END IF;
      ELSIF v_new_tier ? 'price_cents'
            AND (v_new_tier->>'price_cents')::int IS DISTINCT FROM v_tier.price_cents THEN
        IF COALESCE((v_sold_by_tier->>v_tier.ticket_type_id::text)::int, 0) > 0 THEN
          RETURN jsonb_build_object(
            'ok', false,
            'reason', 'tier_price_change_with_sales',
            'affected_order_count', (v_sold_by_tier->>v_tier.ticket_type_id::text)::int
          );
        END IF;
      END IF;
    END LOOP;
  END IF;

  -- 4f. ORCH-0880 Tr5 intake_schemas refund-gate (PERMISSIVE per D2 operator
  -- decision). Schema validation runs but no hard reject on sold>0 - re-answer
  -- notification fan-out handles affected buyers via Section 6 trigger.
  IF p_patch ? 'intake_schemas' THEN
    IF jsonb_typeof(p_patch->'intake_schemas') <> 'array' THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invalid_intake_schemas_payload');
    END IF;

    FOR v_intake_schema_entry IN
      SELECT * FROM jsonb_array_elements(p_patch->'intake_schemas')
    LOOP
      v_intake_ticket_type_id := (v_intake_schema_entry->>'ticket_type_id')::uuid;
      v_intake_schema := v_intake_schema_entry->'schema';

      IF v_intake_ticket_type_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'intake_schema_missing_ticket_type_id');
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM public.trip_pricing_tiers
        WHERE event_id = p_event_id
          AND ticket_type_id = v_intake_ticket_type_id
      ) THEN
        RETURN jsonb_build_object(
          'ok', false,
          'reason', 'intake_schema_unknown_ticket_type',
          'ticket_type_id', v_intake_ticket_type_id
        );
      END IF;

      IF v_intake_schema IS NOT NULL
         AND NOT public.validate_trip_intake_schema(v_intake_schema) THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'invalid_intake_schema');
      END IF;
    END LOOP;
  END IF;

  -- 4g. ORCH-1120 refund_policy / booking_deadline / bookings_closed gate.
  -- Buyer-FAVORABLE edits always allowed. Buyer-UNFAVORABLE edits HARD-BLOCK
  -- when v_total_sold > 0. No sales => everything allowed. Only present patch
  -- keys are evaluated (client omits unchanged keys). Validate/classify BEFORE
  -- any write; on a block we RETURN before §5f so nothing persists.

  -- 4g.1 refund_policy
  IF p_patch ? 'refund_policy' THEN
    v_old_policy := v_event.refund_policy;
    v_new_policy := CASE
                      WHEN jsonb_typeof(p_patch->'refund_policy') = 'null' THEN NULL
                      ELSE p_patch->'refund_policy'
                    END;

    -- Shape validation (belt-and-suspenders; the events_refund_policy_valid
    -- CHECK also fires on the §5f UPDATE). A bad shape RAISEs and propagates
    -- as the existing CHECK path (the service maps it to a friendly error).
    PERFORM public.validate_refund_policy(v_new_policy);

    -- Favorable/unfavorable classification only matters when sales exist.
    IF v_total_sold > 0 THEN
      -- Thresholds = union of both policies' days_before_start + {0}.
      v_thresholds := (
        SELECT array_agg(DISTINCT x)
        FROM (
          SELECT (t->>'days_before_start')::int AS x
            FROM jsonb_array_elements(COALESCE(v_old_policy->'tiers', '[]'::jsonb)) t
          UNION
          SELECT (t->>'days_before_start')::int
            FROM jsonb_array_elements(COALESCE(v_new_policy->'tiers', '[]'::jsonb)) t
          UNION
          SELECT 0
        ) u
      );

      v_refund_unfavorable := false;
      IF v_thresholds IS NOT NULL THEN
        FOREACH v_threshold IN ARRAY v_thresholds LOOP
          -- realized refund_pct at v_threshold = winning tier (largest
          -- days_before_start <= v_threshold), else 0. Mirrors
          -- biz_compute_refund_for_cancel tier selection (TR4 L231-237).
          SELECT COALESCE(
            (SELECT (te->>'refund_pct')::int
               FROM jsonb_array_elements(COALESCE(v_old_policy->'tiers', '[]'::jsonb)) te
              WHERE (te->>'days_before_start')::int <= v_threshold
              ORDER BY (te->>'days_before_start')::int DESC
              LIMIT 1),
            0
          ) INTO v_old_pct;

          SELECT COALESCE(
            (SELECT (te->>'refund_pct')::int
               FROM jsonb_array_elements(COALESCE(v_new_policy->'tiers', '[]'::jsonb)) te
              WHERE (te->>'days_before_start')::int <= v_threshold
              ORDER BY (te->>'days_before_start')::int DESC
              LIMIT 1),
            0
          ) INTO v_new_pct;

          IF v_new_pct < v_old_pct THEN
            v_refund_unfavorable := true;
            EXIT;
          END IF;
        END LOOP;
      END IF;

      IF v_refund_unfavorable THEN
        RETURN jsonb_build_object(
          'ok', false,
          'reason', 'refund_policy_downgrade_with_sales',
          'affected_order_count', v_total_sold
        );
      END IF;
    END IF;
  END IF;

  -- 4g.2 booking_deadline
  IF p_patch ? 'booking_deadline' THEN
    v_old_deadline := v_event.booking_deadline;
    v_new_deadline := CASE
                        WHEN jsonb_typeof(p_patch->'booking_deadline') = 'null' THEN NULL
                        ELSE (p_patch->>'booking_deadline')::timestamptz
                      END;

    -- Unfavorable = pulling the deadline EARLIER (shrinks the booking window).
    -- NULL->deadline = newly closing earlier than "never" = unfavorable.
    -- Later deadline, or clearing to NULL = favorable, always allowed.
    IF v_total_sold > 0
       AND v_new_deadline IS NOT NULL
       AND (v_old_deadline IS NULL OR v_new_deadline < v_old_deadline) THEN
      RETURN jsonb_build_object(
        'ok', false,
        'reason', 'booking_deadline_earlier_with_sales',
        'affected_order_count', v_total_sold
      );
    END IF;

    -- Future-validity (no 5th reason per SPEC §4.1.2 LOCKED): a past deadline
    -- cannot be produced by the client picker (it bounds to future <= start).
    -- Defensive clamp: if a past deadline somehow arrives, drop the write so
    -- nothing harmful persists, but do not block the rest of the patch.
    IF v_new_deadline IS NOT NULL AND v_new_deadline <= v_now THEN
      p_patch := p_patch - 'booking_deadline';
    END IF;
  END IF;

  -- 4g.3 bookings_closed
  IF p_patch ? 'bookings_closed' THEN
    v_old_closed := v_event.bookings_closed;
    v_new_closed := (p_patch->>'bookings_closed')::boolean;

    -- Harmful flip = closing bookings (false -> true) while sales exist.
    -- Opening (true -> false) is favorable, always allowed. No implicit
    -- coupling with the deadline field — each field evaluated independently.
    IF v_total_sold > 0 AND v_old_closed = false AND v_new_closed = true THEN
      RETURN jsonb_build_object(
        'ok', false,
        'reason', 'bookings_closed_harms_active',
        'affected_order_count', v_total_sold
      );
    END IF;
  END IF;

  -- ---------- 5. Apply patch ----------
  -- 5a. events row update
  IF p_patch ?| ARRAY['title','description','theme','cover_media_url','cover_media_type',
                      'cover_media_provider','cover_media_source_url',
                      'cover_media_credit','cover_media_credit_url','cover_media_alt',
                      'cover_media_gallery']::text[] THEN
    UPDATE public.events SET
      title = COALESCE(p_patch->>'title', title),
      description = CASE WHEN p_patch ? 'description'
                         THEN p_patch->>'description' ELSE description END,
      theme = CASE WHEN p_patch ? 'theme'
                   THEN COALESCE(theme, '{}'::jsonb) || (p_patch->'theme') ELSE theme END,
      cover_media_url = CASE WHEN p_patch ? 'cover_media_url'
                              THEN NULLIF(p_patch->>'cover_media_url','')
                              ELSE cover_media_url END,
      cover_media_type = CASE WHEN p_patch ? 'cover_media_type'
                               THEN NULLIF(p_patch->>'cover_media_type','')
                               ELSE cover_media_type END,
      cover_media_provider = CASE WHEN p_patch ? 'cover_media_provider'
                                   THEN NULLIF(p_patch->>'cover_media_provider','')
                                   ELSE cover_media_provider END,
      cover_media_source_url = CASE WHEN p_patch ? 'cover_media_source_url'
                                     THEN NULLIF(p_patch->>'cover_media_source_url','')
                                     ELSE cover_media_source_url END,
      cover_media_credit = CASE WHEN p_patch ? 'cover_media_credit'
                                 THEN NULLIF(p_patch->>'cover_media_credit','')
                                 ELSE cover_media_credit END,
      cover_media_credit_url = CASE WHEN p_patch ? 'cover_media_credit_url'
                                     THEN NULLIF(p_patch->>'cover_media_credit_url','')
                                     ELSE cover_media_credit_url END,
      cover_media_alt = CASE WHEN p_patch ? 'cover_media_alt'
                              THEN NULLIF(p_patch->>'cover_media_alt','')
                              ELSE cover_media_alt END,
      -- issue #868 — ADDITIVE gallery write (jsonb). The cover-field CASE lines
      -- above stay VERBATIM; no derive/sync between cover and gallery.
      cover_media_gallery = CASE WHEN p_patch ? 'cover_media_gallery'
                                  THEN COALESCE(p_patch->'cover_media_gallery','[]'::jsonb)
                                  ELSE cover_media_gallery END,
      updated_at = v_now
    WHERE id = p_event_id;
  END IF;

  -- 5b. trip_days upsert + delete  (ORCH-1119: now carries media)
  -- ORCH-1119: per-day media MUST persist on both draft (upsertTripDays) and
  -- published-edit (this §5b upsert) — reverting either silently drops galleries
  -- (see orch1119_trip_day_media_persistence.test.ts).
  IF p_patch ? 'days' THEN
    IF v_dropped_ordinals IS NOT NULL AND array_length(v_dropped_ordinals, 1) > 0 THEN
      DELETE FROM public.trip_days
        WHERE event_id = p_event_id
          AND ordinal = ANY (v_dropped_ordinals);
    END IF;
    INSERT INTO public.trip_days (event_id, ordinal, title, narrative, media)
      SELECT p_event_id,
             (d->>'ordinal')::int,
             d->>'title',
             NULLIF(d->>'narrative', ''),
             COALESCE(d->'media', '[]'::jsonb)
        FROM jsonb_array_elements(p_patch->'days') d
      ON CONFLICT (event_id, ordinal)
      DO UPDATE SET title = EXCLUDED.title,
                    narrative = EXCLUDED.narrative,
                    media = EXCLUDED.media;
  END IF;

  -- 5c. trip_inclusions: replace-all (safe because dropped-with-sales gated above)
  IF p_patch ? 'inclusions' THEN
    DELETE FROM public.trip_inclusions WHERE event_id = p_event_id;
    INSERT INTO public.trip_inclusions (event_id, kind, item, ordinal)
      SELECT p_event_id, i->>'kind', i->>'item', (i->>'ordinal')::int
        FROM jsonb_array_elements(p_patch->'inclusions') i;
  END IF;

  -- 5d. trip_pricing_tiers upsert
  IF p_patch ? 'pricing_tiers' THEN
    FOR v_new_tier IN
      SELECT * FROM jsonb_array_elements(p_patch->'pricing_tiers')
    LOOP
      UPDATE public.trip_pricing_tiers SET
        tier_name = COALESCE(v_new_tier->>'tier_name', tier_name),
        tier_metadata = COALESCE(v_new_tier->'tier_metadata', tier_metadata)
      WHERE ticket_type_id = (v_new_tier->>'ticket_type_id')::uuid
        AND event_id = p_event_id;

      IF v_new_tier ? 'price_cents' THEN
        UPDATE public.ticket_types SET
          price_cents = (v_new_tier->>'price_cents')::int
        WHERE id = (v_new_tier->>'ticket_type_id')::uuid;
      END IF;
    END LOOP;
  END IF;

  -- 5e. ORCH-0880 Tr5 intake_schemas upsert.
  IF p_patch ? 'intake_schemas' THEN
    FOR v_intake_schema_entry IN
      SELECT * FROM jsonb_array_elements(p_patch->'intake_schemas')
    LOOP
      v_intake_ticket_type_id := (v_intake_schema_entry->>'ticket_type_id')::uuid;
      v_intake_schema := v_intake_schema_entry->'schema';

      v_intake_changed_tier_ids := array_append(v_intake_changed_tier_ids, v_intake_ticket_type_id);

      IF v_intake_schema IS NULL OR jsonb_typeof(v_intake_schema) = 'null' THEN
        DELETE FROM public.trip_intake_schemas
          WHERE event_id = p_event_id
            AND ticket_type_id = v_intake_ticket_type_id;
      ELSE
        INSERT INTO public.trip_intake_schemas
          (event_id, ticket_type_id, schema, schema_version_id, created_at, updated_at)
        VALUES (
          p_event_id,
          v_intake_ticket_type_id,
          v_intake_schema,
          COALESCE(NULLIF(v_intake_schema->>'schema_version_id', '')::uuid, gen_random_uuid()),
          v_now,
          v_now
        )
        ON CONFLICT (event_id, ticket_type_id) DO UPDATE
          SET schema = EXCLUDED.schema,
              schema_version_id = EXCLUDED.schema_version_id,
              updated_at = v_now;
      END IF;
    END LOOP;
  END IF;

  -- 5f. ORCH-1120 refund/deadline/bookings-closed writes (gate passed above).
  -- Each field writes only if present in the (post-gate) patch. bookings_closed_at
  -- mirrors the cron/standalone semantics: set to now() on a false->true close,
  -- cleared on any ->false open (matches process-booking-deadlines +
  -- refundPolicyService.updateBookingDeadline). The events_refund_policy_valid
  -- CHECK validates refund_policy on this UPDATE as defense-in-depth.
  IF p_patch ? 'refund_policy' OR p_patch ? 'booking_deadline' OR p_patch ? 'bookings_closed' THEN
    UPDATE public.events SET
      refund_policy   = CASE WHEN p_patch ? 'refund_policy'
                             THEN (CASE WHEN jsonb_typeof(p_patch->'refund_policy') = 'null'
                                        THEN NULL ELSE p_patch->'refund_policy' END)
                             ELSE refund_policy END,
      booking_deadline = CASE WHEN p_patch ? 'booking_deadline'
                             THEN (CASE WHEN jsonb_typeof(p_patch->'booking_deadline') = 'null'
                                        THEN NULL ELSE (p_patch->>'booking_deadline')::timestamptz END)
                             ELSE booking_deadline END,
      bookings_closed = CASE WHEN p_patch ? 'bookings_closed'
                             THEN (p_patch->>'bookings_closed')::boolean
                             ELSE bookings_closed END,
      bookings_closed_at = CASE
                             WHEN p_patch ? 'bookings_closed' AND (p_patch->>'bookings_closed')::boolean = true
                                  AND bookings_closed = false THEN v_now
                             WHEN p_patch ? 'bookings_closed' AND (p_patch->>'bookings_closed')::boolean = false
                                  THEN NULL
                             ELSE bookings_closed_at END,
      updated_at = v_now
    WHERE id = p_event_id;
  END IF;

  -- ---------- 6. Compute changed_keys + severity + diff_summary ----------
  v_changed_keys := ARRAY(SELECT jsonb_object_keys(p_patch));

  IF (p_patch ? 'days' OR p_patch ? 'inclusions' OR p_patch ? 'pricing_tiers' OR p_patch ? 'intake_schemas'
      OR p_patch ? 'refund_policy' OR p_patch ? 'booking_deadline' OR p_patch ? 'bookings_closed')
     OR (v_new_business_trip ?| ARRAY['startAt','endAt',
                                      'destinationLocationText','capacity']::text[]) THEN
    v_severity := 'material';
  ELSE
    v_severity := 'additive';
  END IF;

  v_diff_summary := jsonb_build_object(
    'changed_keys', to_jsonb(v_changed_keys),
    'dropped_day_ordinals', to_jsonb(COALESCE(v_dropped_ordinals, '{}'::int[])),
    'dropped_inclusions', to_jsonb(COALESCE(v_dropped_inclusions, '{}'::text[])),
    'intake_changed_tier_ids', to_jsonb(v_intake_changed_tier_ids)
  );

  -- ---------- 7. Insert trip_edit_log row ----------
  SELECT COALESCE(array_agg(id), '{}'::uuid[])
    INTO v_affected_order_ids
    FROM public.orders
    WHERE event_id = p_event_id
      AND payment_status NOT IN ('failed', 'cancelled');

  INSERT INTO public.trip_edit_log
    (event_id, brand_id, edited_by, reason, severity,
     changed_field_keys, diff_summary, affected_order_ids, occurred_at)
  VALUES (
    p_event_id,
    v_event.brand_id,
    v_user_id,
    v_trimmed_reason,
    v_severity,
    v_changed_keys,
    v_diff_summary,
    v_affected_order_ids,
    v_now
  ) RETURNING id INTO v_log_id;

  -- ---------- 8. Return success ----------
  RETURN jsonb_build_object(
    'ok', true,
    'edit_log_entry_id', v_log_id,
    'severity', v_severity,
    'changed_keys', to_jsonb(v_changed_keys),
    'affected_order_count', COALESCE(array_length(v_affected_order_ids, 1), 0),
    'intake_changed_tier_ids', to_jsonb(v_intake_changed_tier_ids)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.biz_update_live_trip(uuid, jsonb, text)
  TO authenticated;

NOTIFY pgrst, 'reload schema';
