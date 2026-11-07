-- Issue #3645 (bundle 2b, with #3281) — what can be sold.
--
--   1. business_publish_event_draft only refused a negative price, so a paid
--      ticket with no price (or one that rounds to 0) went live at 0. It now
--      raises paid_ticket_price_required, the code the tier editor already
--      uses; issue_1974_normalize_ticket_tiers also refuses a sub-unit price
--      that rounds to 0.
--   2. biz_update_live_experience let a live paid whole-price experience be
--      edited to 0, which silently made it free. It now raises
--      experience_price_invalid, as publish does.
--   3. biz_publish_experience wrote currency in one UPDATE and status in a
--      later one, so the status triggers never saw the currency the publish
--      wrote, and tickets kept the sent currency when the brand-currency
--      trigger stamped another. Dates are now materialised first, one UPDATE
--      writes currency and status, and tickets use the stored currency.
--   4. (#3281) Cancelling one date left checkouts for it open, and a cancelled
--      date could still be chosen or auto-picked. business_cancel_event_date
--      now revokes open checkouts (as a time change does); authorisation, the
--      checkout day context and the day choice ignore cancelled dates.
--
-- Forward-only: functions are re-emitted from their latest definitions with
-- the hunks declared in __tests__/issue_3645_sell_publish_reemit_hunks.ts;
-- signatures are unchanged, so owners and grants are kept. No row is
-- rewritten. Proofs: __tests__/issue_3645_sell_publish_integrity.pg17.test.sql.

BEGIN;

-- business_publish_event_draft: re-emitted from 20280314003281_issue_3281_extras_authoring.sql; hunks declared in
-- __tests__/issue_3645_sell_publish_reemit_hunks.ts.
CREATE OR REPLACE FUNCTION public.business_publish_event_draft(p_event_id uuid, p_draft_payload jsonb, p_client_revision integer DEFAULT NULL::integer)
 RETURNS jsonb
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
  v_tickets jsonb;
  v_ticket jsonb;
  v_ticket_type_id uuid; -- issue #3281
  v_title text;
  v_description text;
  v_location_text text;
  v_online_url text;
  v_cover_media_url text;
  v_cover_media_type text;
  v_cover_media_poster_url text;
  v_keep_cover boolean; -- #3439: resolve under the existing event row lock
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
  v_format text;   -- issue #2333
  -- issue #1653 — the wizard's pin was collected and then discarded at publish.
  v_location_geo point;
  v_coordinate_precision text;
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
  -- issue #3281 — a client that predates day lists cannot widen a ticket.
  v_tickets := public.issue_3281_keep_draft_day_lists(v_tickets,
    (SELECT e.theme#>'{business_draft,tickets}' FROM public.events e WHERE e.id = p_event_id));
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
  -- issue #3645: public.supported_brand_currencies owns the list; this
  -- function asks the shared helper and carries no list of its own.
  IF v_currency IS NOT NULL
     AND NOT public.is_supported_offering_currency(v_currency::text) THEN
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
      -- issue #3645: a paid ticket with no price (or one that rounds to 0)
      -- would go live at 0. The wizard refuses it; the server now does too.
      IF round(v_price * 100) <= 0 THEN
        RAISE EXCEPTION 'paid_ticket_price_required' USING ERRCODE = '22023';
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
  v_format := lower(NULLIF(btrim(COALESCE(v_business_draft->>'format', '')), ''));
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

  -- issue #2333 — an ONLINE-ONLY event has no city and the wizard renders no
  -- field that could set one (CreatorStep3Where.tsx:138-140 gates the ONLY
  -- writer of city behind in_person|hybrid), so demanding one here made every
  -- online publish impossible while the client said "Ready to publish".
  -- Keyed on business_draft.format, the SAME node v_city is read from, and NOT
  -- on p_draft_payload.is_online — is_online is TRUE for HYBRID too
  -- (serverDraftEventMapper.ts:708), and hybrid genuinely has a city that
  -- validateWhere:382-406 requires. Absent/unknown format FAILS CLOSED.
  IF v_city IS NULL AND v_format IS DISTINCT FROM 'online' THEN
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

  -- #1931 Amendment 1 §3 / Amendment 3 §5 released item 6 — the legacy-Private-draft
  -- publish block. This is the AUTHORITATIVE half: the client hook blocks too, but
  -- deleting the client block cannot admit a Private publish because this raises.
  --
  -- It is evaluated BEFORE any write, so a denied publish mutates nothing.
  --
  -- DELIBERATE, CONTRACT-MANDATED BEHAVIOUR CHANGE AT READINESS FALSE, and the only one
  -- in the released set. Today this function publishes visibility='private' UNGUARDED,
  -- which creates an offering no guest has a working access path to — the exact defect
  -- #1931 is named after. Amendment 1 §3 requires the server to "independently return
  -- typed private_access_not_ready", and Amendment 3 §5 frozen item 2 freezes anything
  -- that PERMITS Private publication. Non-private publishes are bit-identical.
  IF v_visibility = 'private' AND NOT public.issue_1931_private_event_access_ready() THEN
    RAISE EXCEPTION 'private_access_not_ready';
  END IF;

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

  -- issue #1653 — promote the coordinate the wizard already captured. Mirrors
  -- business_patch_event_taxonomy exactly, including point(LNG, LAT) argument
  -- order. When the payload carries no coordinate we KEEP whatever the row
  -- already holds, so publishing can never erase a pin a later edit set.
  IF (p_draft_payload->'locationGeo'->>'lat') IS NOT NULL
     AND (p_draft_payload->'locationGeo'->>'lng') IS NOT NULL THEN
    v_location_geo := point(
      (p_draft_payload->'locationGeo'->>'lng')::double precision,
      (p_draft_payload->'locationGeo'->>'lat')::double precision
    );
    -- Normalise the token so the coordinate_precision CHECK only ever sees
    -- 'exact' | 'approximate' | NULL — a stale client cannot break publish.
    v_coordinate_precision := NULLIF(
      btrim(COALESCE(p_draft_payload->>'coordinatePrecision', '')), ''
    );
    IF v_coordinate_precision NOT IN ('exact', 'approximate') THEN
      v_coordinate_precision := NULL;
    END IF;
  ELSE
    SELECT e.location_geo, e.coordinate_precision
      INTO v_location_geo, v_coordinate_precision
      FROM public.events e WHERE e.id = p_event_id;
  END IF;
  v_online_url := NULLIF(p_draft_payload->>'online_url', '');
  v_cover_media_url := NULLIF(p_draft_payload->>'cover_media_url', '');
  v_cover_media_type := NULLIF(p_draft_payload->>'cover_media_type', '');
  v_cover_media_provider := NULLIF(p_draft_payload->>'cover_media_provider', '');
  v_cover_media_source_url := NULLIF(p_draft_payload->>'cover_media_source_url', '');
  v_cover_media_credit := NULLIF(p_draft_payload->>'cover_media_credit', '');
  v_cover_media_credit_url := NULLIF(p_draft_payload->>'cover_media_credit_url', '');
  v_cover_media_alt := NULLIF(p_draft_payload->>'cover_media_alt', '');
  -- #3439: validate explicit input exactly as the poster wrapper did, then
  -- resolve all cover fields together against the locked row. Validation must
  -- not disappear when a stale URL is protected.
  v_cover_media_poster_url := COALESCE(NULLIF(p_draft_payload->>'cover_media_poster_url', ''),
    CASE WHEN v_cover_media_type = 'image' THEN v_cover_media_url END);
  PERFORM public.assert_cover_media_triplet(
    v_cover_media_url, v_cover_media_type, v_cover_media_poster_url);
  v_keep_cover := (CASE WHEN p_draft_payload ? '__coverBase' THEN
      v_cover_media_url IS NOT DISTINCT FROM NULLIF(p_draft_payload->>'__coverBase','')
      AND v_event.cover_media_url IS DISTINCT FROM NULLIF(p_draft_payload->>'__coverBase','')
    ELSE
      v_event.cover_media_url IS NOT NULL
      AND v_cover_media_url IS DISTINCT FROM v_event.cover_media_url
      AND EXISTS (SELECT 1 FROM public.event_cover_video_jobs j
        WHERE j.event_id = p_event_id AND j.target_kind = 'event'
          AND j.apply_mode = 'draft_auto' AND j.status = 'applied'
          AND j.processed_url = v_event.cover_media_url
          AND j.applied_at >= v_event.updated_at)
    END);
  IF v_keep_cover THEN
    v_cover_media_url := v_event.cover_media_url;
    v_cover_media_type := v_event.cover_media_type;
    v_cover_media_poster_url := v_event.cover_media_poster_url;
    v_cover_media_provider := v_event.cover_media_provider;
    v_cover_media_source_url := v_event.cover_media_source_url;
    v_cover_media_credit := v_event.cover_media_credit;
    v_cover_media_credit_url := v_event.cover_media_credit_url;
    v_cover_media_alt := v_event.cover_media_alt;
  END IF;
  PERFORM public.assert_cover_media_triplet(
    v_cover_media_url, v_cover_media_type, v_cover_media_poster_url);
  -- issue #868 — ADDITIVE + INDEPENDENT: read the extra-photos gallery; it is
  -- NOT nulled when the cover url is absent (a photo gallery coexists with any
  -- cover, incl. a video cover). Default [] preserves single-cover behavior.
  -- issue #3288 — an ABSENT key keeps the stored gallery; a PRESENT key
  -- (including an explicit []) is written exactly as before.
  v_cover_media_gallery := CASE WHEN p_draft_payload ? 'cover_media_gallery'
    THEN COALESCE(p_draft_payload->'cover_media_gallery', '[]'::jsonb)
    ELSE COALESCE(v_event.cover_media_gallery, '[]'::jsonb) END;
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

    -- issue #3313 — A RECURRING EVENT GETS EVERY DATE ITS RULE DESCRIBES.
    -- This branch used to stop at the master row above, so "every Tuesday, 8
    -- times" published ONE Tuesday: the rule was only copied onto the event
    -- row. The #1138 expander (52-date cap, master = date #1, same local start
    -- time and length) has always been type-agnostic; experiences called it and
    -- events never did. The rule expanded is the SAME value written to
    -- events.recurrence_rules below, so the stored rule and the dates cannot
    -- disagree. DELETE THIS BLOCK and a recurring event sells one night only.
    IF v_when_mode = 'recurring'
       AND jsonb_typeof(p_draft_payload->'recurrence_rules') = 'object' THEN
      PERFORM public.pg_expand_experience_recurrence(
        p_event_id, v_start, v_end, p_draft_payload->'recurrence_rules', v_timezone
      );
    END IF;

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
      INSERT INTO public.event_dates (
        event_id, start_at, end_at, timezone, is_master,
        override_title, override_location
      ) VALUES (
        p_event_id, v_start, v_end, v_timezone, v_start = v_min_start,
        NULLIF(left(btrim(COALESCE(
          v_date_entry #>> '{overrides,title}',
          v_date_entry->>'overrideTitle',
          ''
        )), 120), ''),
        NULLIF(left(btrim(COALESCE(
          v_date_entry #>> '{overrides,venueName}',
          v_date_entry->>'overrideLocation',
          ''
        )), 120), '')
      );
    END LOOP;
    -- issue #3281 — the organiser's day id is the stable key a ticket scopes to.
    PERFORM public.issue_3281_sync_occurrence_keys(p_event_id, v_multi_dates);
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
    -- Collection + past-date stay online-only (door money cannot hit checkout 409).
    IF NOT public.pg_brand_can_collect(v_event.brand_id) THEN
      -- TRANSITIONAL wire alias; remove only under cleanup issue #1922:
      -- https://github.com/Mingla-LLC/mingla-main/issues/1922
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

  -- #3645 PR11d — Organiser Terms 1.0 on ANY money-bearing publish (door-only
  -- included). Matches the app gate (positive price, not online-only). Free
  -- path skips. Collection/date guards above stay online-only.
  IF COALESCE(v_money_bearing, false) THEN
    PERFORM public.biz_require_current_organiser_terms(v_event.brand_id);
  END IF;

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
    cover_media_poster_url = v_cover_media_poster_url,
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
    location_geo = v_location_geo,              -- issue #1653
    coordinate_precision = v_coordinate_precision,  -- issue #1653
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
      valid_occurrence_keys,
      event_id, name, description, price_cents, currency,
      quantity_total, is_unlimited, is_free,
      sale_start_at, sale_end_at,
      min_purchase_qty, max_purchase_qty,
      is_hidden, is_disabled, requires_approval, allow_transfers,
      password_protected, password_hash,
      available_online, available_in_person,
      waitlist_enabled, display_order, deleted_at
    ) VALUES (
      public.issue_3281_draft_ticket_scope(v_ticket, v_when_mode, v_multi_dates),
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
    ) RETURNING id INTO v_ticket_type_id;
    -- issue #3281 — the tier's extras, inside its dates.
    PERFORM public.issue_3281_publish_tier_extras(
      v_ticket_type_id, v_ticket, v_when_mode, v_multi_dates,
      (SELECT tt.valid_occurrence_keys FROM public.ticket_types tt WHERE tt.id = v_ticket_type_id));
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
$function$;

-- issue_1974_normalize_ticket_tiers: re-emitted from 20280314003281_issue_3281_extras_authoring.sql; hunks declared in
-- __tests__/issue_3645_sell_publish_reemit_hunks.ts.
CREATE OR REPLACE FUNCTION public.issue_1974_normalize_ticket_tiers(p_tiers jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tier jsonb;
  v_out jsonb := '[]'::jsonb;
  v_id text;
  v_name text;
  v_free boolean;
  v_unlimited boolean;
  v_price numeric;
  v_capacity integer;
  v_visibility text;
  v_order integer;
  v_min integer;
  v_max integer;
  v_description text;
  v_start timestamptz;
  v_end timestamptz;
  v_available text;
BEGIN
  IF jsonb_typeof(p_tiers) IS DISTINCT FROM 'array' OR jsonb_array_length(p_tiers) > 50 THEN
    RAISE EXCEPTION 'invalid_ticket_tiers';
  END IF;

  FOR v_tier IN SELECT value FROM jsonb_array_elements(p_tiers)
  LOOP
    BEGIN
      v_id := NULLIF(v_tier->>'id', '');
      v_name := btrim(COALESCE(v_tier->>'name', ''));
      v_free := COALESCE((v_tier->>'isFree')::boolean, false);
      v_unlimited := COALESCE((v_tier->>'isUnlimited')::boolean, false);
      v_price := NULLIF(v_tier->>'priceGbp', '')::numeric;
      v_capacity := NULLIF(v_tier->>'capacity', '')::integer;
      v_visibility := COALESCE(NULLIF(v_tier->>'visibility', ''), 'public');
      v_order := COALESCE(NULLIF(v_tier->>'displayOrder', '')::integer, jsonb_array_length(v_out));
      v_min := COALESCE(NULLIF(v_tier->>'minPurchaseQty', '')::integer, 1);
      v_max := NULLIF(v_tier->>'maxPurchaseQty', '')::integer;
      v_description := NULLIF(btrim(v_tier->>'description'), '');
      v_start := NULLIF(v_tier->>'saleStartAt', '')::timestamptz;
      v_end := NULLIF(v_tier->>'saleEndAt', '')::timestamptz;
      v_available := COALESCE(NULLIF(v_tier->>'availableAt', ''), 'both');
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'invalid_ticket_tier';
    END;

    IF v_id IS NULL OR length(v_id)>100 OR v_name = '' THEN RAISE EXCEPTION 'invalid_ticket_tier'; END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_out) prior WHERE prior->>'id'=v_id) THEN
      RAISE EXCEPTION 'duplicate_ticket_tier_id';
    END IF;
    IF v_visibility NOT IN ('public','hidden','disabled') OR v_available NOT IN ('online','door','both') THEN
      RAISE EXCEPTION 'invalid_ticket_tier';
    END IF;
    IF v_free AND COALESCE(v_price,0) <> 0 THEN RAISE EXCEPTION 'free_ticket_price_invalid'; END IF;
    IF NOT v_free AND round(COALESCE(v_price,0) * 100) <= 0 THEN RAISE EXCEPTION 'paid_ticket_price_required'; END IF;  -- issue #3645
    IF v_unlimited AND v_capacity IS NOT NULL THEN RAISE EXCEPTION 'unlimited_ticket_capacity_invalid'; END IF;
    IF NOT v_unlimited AND COALESCE(v_capacity,0) <= 0 THEN RAISE EXCEPTION 'ticket_capacity_required'; END IF;
    IF v_unlimited AND COALESCE((v_tier->>'waitlistEnabled')::boolean,false) THEN
      RAISE EXCEPTION 'unlimited_ticket_waitlist_invalid';
    END IF;
    IF v_min < 1 OR (v_max IS NOT NULL AND v_max < v_min) THEN RAISE EXCEPTION 'ticket_purchase_limits_invalid'; END IF;
    IF length(COALESCE(v_description,'')) > 280 THEN RAISE EXCEPTION 'ticket_description_too_long'; END IF;
    IF v_start IS NOT NULL AND v_end IS NOT NULL AND v_end <= v_start THEN RAISE EXCEPTION 'ticket_sale_window_invalid'; END IF;
    IF v_order < 0 THEN RAISE EXCEPTION 'ticket_display_order_invalid'; END IF;

    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'id',v_id,
      'name',v_name,
      'isFree',v_free,
      'isUnlimited',v_unlimited,
      'priceGbp',CASE WHEN v_free THEN NULL ELSE v_price END,
      'capacity',CASE WHEN v_unlimited THEN NULL ELSE v_capacity END,
      'visibility',v_visibility,
      'displayOrder',v_order,
      'approvalRequired',COALESCE((v_tier->>'approvalRequired')::boolean,false),
      'passwordProtected',COALESCE((v_tier->>'passwordProtected')::boolean,false),
      'passwordConfigured',COALESCE((v_tier->>'passwordConfigured')::boolean,false),
      'waitlistEnabled',COALESCE((v_tier->>'waitlistEnabled')::boolean,false),
      'minPurchaseQty',v_min,
      'maxPurchaseQty',v_max,
      'allowTransfers',COALESCE((v_tier->>'allowTransfers')::boolean,true),
      'description',v_description,
      'saleStartAt',v_start,
      'saleEndAt',v_end,
      'availableAt',v_available
    ) || CASE WHEN v_tier ? 'validDayIds'
      THEN jsonb_build_object('validDayIds',v_tier->'validDayIds')
      ELSE '{}'::jsonb END
      -- issue #3281 — extras ride their tier, validated; no key keeps them.
      || CASE WHEN v_tier ? 'extras' AND jsonb_typeof(v_tier->'extras') <> 'null'
      THEN jsonb_build_object('extras',public.issue_3281_normalize_tier_extras(v_tier->'extras',v_free))
      ELSE '{}'::jsonb END);
  END LOOP;
  RETURN v_out;
END;
$$;

-- biz_update_live_experience: re-emitted from 20280217003281_issue_3281_production_order_repair.sql; hunks declared in
-- __tests__/issue_3645_sell_publish_reemit_hunks.ts.
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

  -- 5a. Capacity floor: lifetime for total; busiest day for per_day;
  -- busiest slot (incl. holds) for per_start.
  IF (p_payload ? 'capacity') AND v_capacity IS NOT NULL THEN
    IF COALESCE(
         NULLIF(p_payload->>'capacity_scope', ''),
         NULLIF(p_payload->>'capacityScope', ''),
         (SELECT capacity_scope FROM public.events WHERE id = p_event_id),
         'total'
       ) = 'total' THEN
      IF v_capacity < v_total_sold THEN
        RETURN jsonb_build_object(
          'ok', false,
          'reason', 'capacity_below_sold',
          'affected_order_count', v_total_sold
        );
      END IF;
    ELSIF COALESCE(
         NULLIF(p_payload->>'capacity_scope', ''),
         NULLIF(p_payload->>'capacityScope', ''),
         (SELECT capacity_scope FROM public.events WHERE id = p_event_id),
         'total'
       ) = 'per_start' THEN
      IF v_capacity < COALESCE((
        SELECT MAX(public.issue_3281_ticket_type_slot_taken(
                 tt.id, d.id, gs,
                 gs + make_interval(mins => COALESCE(e.booking_spacing_minutes, 30)),
                 NULL
               ))
          FROM public.events e
          CROSS JOIN public.ticket_types tt
          CROSS JOIN public.event_dates d
          CROSS JOIN LATERAL generate_series(
            d.start_at,
            d.end_at - interval '1 microsecond',
            make_interval(mins => COALESCE(e.booking_spacing_minutes, 30))
          ) AS gs
         WHERE e.id = p_event_id
           AND tt.event_id = p_event_id
           AND tt.deleted_at IS NULL
           AND d.event_id = p_event_id
      ), 0) THEN
        RETURN jsonb_build_object(
          'ok', false,
          'reason', 'capacity_below_sold',
          'affected_order_count', v_total_sold
        );
      END IF;
    ELSE
      IF v_capacity < COALESCE((
        SELECT MAX(public.issue_3313_ticket_type_occurrence_taken(tt.id, d.id))
          FROM public.ticket_types tt
          CROSS JOIN public.event_dates d
         WHERE tt.event_id = p_event_id
           AND tt.deleted_at IS NULL
           AND d.event_id = p_event_id
      ), 0) THEN
        RETURN jsonb_build_object(
          'ok', false,
          'reason', 'capacity_below_sold',
          'affected_order_count', v_total_sold
        );
      END IF;
    END IF;
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

  -- issue #3645: a paid whole-price experience edited to 0 would silently
  -- turn free. Same rule as biz_publish_experience; marking it free is the
  -- way to make it free. Checked after the sold-ticket gates so their
  -- answers are unchanged.
  IF (NOT v_is_free) AND v_pricing_mode = 'whole' AND v_resolved_total <= 0 THEN
    RAISE EXCEPTION 'experience_price_invalid';
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

    -- issue #3281 R3 — spacing / notice / capacity_scope / stop offsets
  PERFORM public.issue_3281_apply_experience_r3_settings(p_event_id, p_payload);

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
$function$;

-- biz_publish_experience: re-emitted from 20271123003281_issue_3281_r3_spacing_spots.sql; hunks declared in
-- __tests__/issue_3645_sell_publish_reemit_hunks.ts.
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

  -- 8b. issue #3645 — PUBLISH: currency and status in ONE update, so the
  -- status triggers (brand-currency stamp, draft-currency stop) see the
  -- currency this publish writes. The brand-currency trigger may stamp the
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

-- business_cancel_event_date: re-emitted from 20280216003281_issue_3281_cancel_event_date.sql; hunks declared in
-- __tests__/issue_3645_sell_publish_reemit_hunks.ts.
CREATE OR REPLACE FUNCTION public.business_cancel_event_date(
  p_event_id uuid,
  p_event_date_id uuid,
  p_reason text,
  p_preview boolean DEFAULT true
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_brand uuid;
  v_event_status text;
  v_is_pass boolean;
  v_buyer_count integer := 0;
  v_amount_cents bigint := 0;
  v_currency text;
  v_row public.event_dates%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) < 10 OR length(btrim(p_reason)) > 200 THEN
    RAISE EXCEPTION 'invalid_edit_reason';
  END IF;

  -- Lock event first (matches business_patch_event_when / issue_1930 order).
  SELECT e.brand_id,
         e.status,
         (e.is_multi_date IS TRUE AND e.is_recurring IS NOT TRUE
          AND COALESCE(e.multi_date_pricing_mode, 'per_day') = 'all_days'),
         e.currency
    INTO v_brand, v_event_status, v_is_pass, v_currency
    FROM public.events e
   WHERE e.id = p_event_id AND e.deleted_at IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'event_not_found';
  END IF;
  IF v_event_status IS DISTINCT FROM 'scheduled'
     AND v_event_status IS DISTINCT FROM 'live' THEN
    RAISE EXCEPTION 'event_not_editable';
  END IF;
  IF public.biz_brand_effective_rank(v_brand, v_uid)
       < public.biz_role_rank('event_manager'::text) THEN
    RAISE EXCEPTION 'insufficient_event_permission';
  END IF;

  SELECT * INTO v_row
    FROM public.event_dates d
   WHERE d.id = p_event_date_id AND d.event_id = p_event_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'occurrence_not_found';
  END IF;
  IF v_row.status = 'cancelled' THEN
    RAISE EXCEPTION 'occurrence_already_cancelled';
  END IF;

  -- Affected tickets: explicit binding to this date OR legacy unscoped
  -- (zero ticket_event_dates rows = any-occurrence), matching
  -- issue_3313_ticket_type_occurrence_sold. Include partial_refund orders.
  -- Amount basis = buyer_total_cents (fees + tax) minus already refunded.
  -- All-days passes: remaining / covered dates (bindings, else active dates).
  -- Per-day: remaining / live tickets on the order (never the full order total
  -- for one of several day tickets). Cap by remaining refundable on the order.
  WITH affected AS (
    SELECT o.id AS order_id,
           tk.id AS ticket_id,
           GREATEST(
             0,
             COALESCE(o.buyer_total_cents, o.total_cents, 0)
               - COALESCE(o.refunded_amount_cents, 0)
           )::bigint AS remaining_cents,
           GREATEST(
             1,
             CASE
               WHEN EXISTS (
                 SELECT 1 FROM public.ticket_event_dates ted_any
                  WHERE ted_any.ticket_id = tk.id
               ) THEN (
                 SELECT count(*)::integer
                   FROM public.ticket_event_dates ted_all
                  WHERE ted_all.ticket_id = tk.id
               )
               ELSE (
                 SELECT count(*)::integer
                   FROM public.event_dates d_cov
                  WHERE d_cov.event_id = p_event_id
                    AND COALESCE(d_cov.status, 'active') = 'active'
               )
             END
           )::integer AS covered_dates,
           GREATEST(
             1,
             (
               SELECT count(*)::integer
                 FROM public.tickets tk_ord
                WHERE tk_ord.order_id = o.id
                  AND tk_ord.status = ANY (
                    ARRAY['valid'::text, 'used'::text, 'transferred'::text]
                  )
             )
           )::integer AS order_live_tickets
      FROM public.orders o
      JOIN public.tickets tk ON tk.order_id = o.id
     WHERE o.event_id = p_event_id
       AND o.payment_status = ANY (ARRAY['paid'::text, 'partial_refund'::text])
       AND tk.status = ANY (ARRAY['valid'::text, 'used'::text, 'transferred'::text])
       AND (
         EXISTS (
           SELECT 1 FROM public.ticket_event_dates ted
            WHERE ted.ticket_id = tk.id AND ted.event_date_id = p_event_date_id
         )
         OR NOT EXISTS (
           SELECT 1 FROM public.ticket_event_dates ted
            WHERE ted.ticket_id = tk.id
         )
       )
  ),
  per_ticket AS (
    SELECT order_id,
           ticket_id,
           remaining_cents,
           CASE
             WHEN v_is_pass THEN
               (remaining_cents / covered_dates)
             ELSE
               (remaining_cents / order_live_tickets)
           END::bigint AS share_cents
      FROM affected
  ),
  capped AS (
    SELECT order_id,
           least(
             sum(share_cents),
             max(remaining_cents)
           )::bigint AS order_share
      FROM per_ticket
     GROUP BY order_id
  )
  SELECT count(*)::integer,
         COALESCE(sum(order_share), 0)::bigint
    INTO v_buyer_count, v_amount_cents
    FROM capped;

  IF p_preview IS TRUE THEN
    RETURN jsonb_build_object(
      'ok', true,
      'preview', true,
      'eventDateId', p_event_date_id,
      'buyerCount', COALESCE(v_buyer_count, 0),
      'amountCents', COALESCE(v_amount_cents, 0),
      'currency', v_currency,
      'passProration', v_is_pass
    );
  END IF;

  UPDATE public.event_dates
     SET status = 'cancelled',
         cancelled_at = now(),
         cancel_reason = left(btrim(p_reason), 200)
   WHERE id = p_event_date_id
     AND status = 'active';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'occurrence_already_cancelled';
  END IF;

  -- issue #3281: checkouts already under way must not complete for a date
  -- that no longer happens. Same path a date's time change takes (the #1930
  -- date trigger): every open checkout on the event is revoked and re-quotes;
  -- one already charged is refunded by the late-reversal path. The event row
  -- is locked above, so the lock order matches that trigger.
  PERFORM public.issue_1930_revoke_event_checkout_admissions(
    p_event_id, 'inventory_changed');

  RETURN jsonb_build_object(
    'ok', true,
    'preview', false,
    'eventDateId', p_event_date_id,
    'buyerCount', COALESCE(v_buyer_count, 0),
    'amountCents', COALESCE(v_amount_cents, 0),
    'currency', v_currency,
    'passProration', v_is_pass,
    'status', 'cancelled'
  );
END;
$fn$;

-- issue_1930_ticket_session_authorized: re-emitted from 20280404004271_issue_4271_door_pay.sql; hunks declared in
-- __tests__/issue_3645_sell_publish_reemit_hunks.ts.
CREATE OR REPLACE FUNCTION public.issue_1930_ticket_session_authorized(
  p_session_id uuid, p_event_id uuid
) RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=public,auth,pg_temp AS $function$
DECLARE
  v_event public.events%ROWTYPE; v_bad boolean;
  v_session public.ticket_checkout_sessions%ROWTYPE; v_decision text;
  v_per_occurrence boolean; -- issue #3313
BEGIN
  SELECT * INTO v_event FROM public.events WHERE id=p_event_id;
  IF public.issue_1930_event_sale_reason(v_event) <> 'sellable' THEN RETURN false; END IF;
  -- #2101 — the sole decision owner, consuming this session's snapshots. It
  -- takes event -> brand in the canonical order before any lower-order row.
  SELECT * INTO v_session FROM public.ticket_checkout_sessions
    WHERE id=p_session_id AND event_id=p_event_id;
  IF NOT FOUND THEN RETURN false; END IF;
  v_decision := public.issue_2101_ticket_checkout_access_decision(
    p_event_id, v_session.buyer_user_id,
    v_session.checkout_access_mode_snapshot,
    v_session.checkout_access_restrictive_epoch_snapshot,
    v_session.checkout_access_membership_id_snapshot,
    v_session.checkout_access_membership_epoch_snapshot);
  IF v_decision NOT IN ('allowed_unrestricted','allowed_named') THEN RETURN false; END IF;
  v_per_occurrence := COALESCE(
    (public.issue_3313_event_day_choice(p_event_id) ->> 'perOccurrenceCapacity')::boolean, false);
  IF NOT EXISTS(SELECT 1 FROM public.ticket_checkout_sessions s
    WHERE s.id=p_session_id AND s.event_id=p_event_id AND s.revoked_at IS NULL
      AND s.status IN ('pending_free','requires_payment','processing_payment','awaiting_web_redirect'))
  THEN RETURN false; END IF;
  -- issue #4271 — a pay code's checkout is payable only while its code is.
  IF v_session.door_pay_code_id IS NOT NULL
     AND NOT public.issue_4271_door_session_payable(p_session_id) THEN
    RETURN false;
  END IF;
  SELECT EXISTS(
    SELECT 1 FROM public.ticket_checkout_session_items i
    LEFT JOIN public.ticket_types tt ON tt.id=i.ticket_type_id AND tt.event_id=p_event_id
    WHERE i.checkout_session_id=p_session_id AND (
      tt.id IS NULL OR tt.deleted_at IS NOT NULL OR tt.is_hidden OR tt.is_disabled
      -- issue #4271 — a door-only tier passes only inside its own code's session.
      OR (NOT tt.available_online
        AND NOT public.issue_4271_door_code_allows_tier(v_session.door_pay_code_id, tt.id))
      OR (tt.sale_start_at IS NOT NULL AND tt.sale_start_at > now())
      OR (tt.sale_end_at IS NOT NULL AND tt.sale_end_at <= now())
      -- issue #3313 — a recurring event's capacity is PER NIGHT, so the
      -- finalize-time re-check measures each of this session's nights (every
      -- upcoming night when it has none): everyone else's sold + held places
      -- that night, plus this session's own places that night. The shared
      -- whole-run check below stays for every other event. DELETE THIS and a
      -- second night's buyer is authorised at reserve and refused at finalize.
      -- issue #3281 — a day-limited ticket is measured per date, on its dates.
      OR ((v_per_occurrence OR tt.valid_occurrence_keys IS NOT NULL)
        AND NOT tt.is_unlimited AND tt.quantity_total IS NOT NULL
        AND EXISTS (
          SELECT 1
            FROM public.event_dates night
           WHERE night.event_id = p_event_id
             AND (tt.valid_occurrence_keys IS NULL
               OR night.occurrence_key = ANY (tt.valid_occurrence_keys))
             AND (
               EXISTS (SELECT 1 FROM public.ticket_checkout_session_event_dates sd
                        WHERE sd.checkout_session_id = p_session_id AND sd.event_date_id = night.id)
               OR (NOT EXISTS (SELECT 1 FROM public.ticket_checkout_session_event_dates sd
                                WHERE sd.checkout_session_id = p_session_id)
                   AND night.end_at > now())
             )
             AND public.issue_3313_ticket_type_occurrence_taken(tt.id, night.id, p_session_id)
                 + CASE
                     WHEN jsonb_typeof(i.by_date) = 'object'
                       THEN COALESCE((i.by_date ->> night.id::text)::integer, 0)
                     WHEN COALESCE(v_session.multi_date_pricing_mode_snapshot, 'per_day') = 'per_day'
                          AND (SELECT count(*) FROM public.ticket_checkout_session_event_dates sd
                                WHERE sd.checkout_session_id = p_session_id) > 0
                       THEN i.quantity / (SELECT count(*) FROM public.ticket_checkout_session_event_dates sd
                                           WHERE sd.checkout_session_id = p_session_id)
                     ELSE i.quantity
                   END
                 > tt.quantity_total
        ))
      OR (NOT v_per_occurrence AND tt.valid_occurrence_keys IS NULL
        AND NOT tt.is_unlimited AND tt.quantity_total IS NOT NULL AND
        (SELECT count(*) FROM public.tickets sold
          WHERE sold.ticket_type_id=tt.id
            AND sold.status IN ('valid','used','transferred'))
        + (SELECT COALESCE(sum(reserved.quantity),0) FROM public.ticket_checkout_session_items reserved
            JOIN public.ticket_checkout_sessions active
              ON active.id=reserved.checkout_session_id
          WHERE reserved.ticket_type_id=tt.id
            AND active.id<>p_session_id
            AND active.expires_at>now()
            AND active.order_id IS NULL
            AND active.revoked_at IS NULL
            AND active.status IN ('pending_free','requires_payment','processing_payment','awaiting_web_redirect'))
        + i.quantity > tt.quantity_total)
    )
  ) INTO v_bad;
  IF v_bad THEN RETURN false; END IF;
  -- issue #3281 — every extra this session holds is still on sale and still
  -- fits, measured per date for a date-limited extra.
  IF EXISTS (
    SELECT 1 FROM public.ticket_checkout_session_add_on_items x
      LEFT JOIN public.ticket_add_ons a ON a.id = x.ticket_add_on_id
     WHERE x.checkout_session_id = p_session_id
       AND (a.id IS NULL OR NOT a.is_active
         OR (NOT a.is_unlimited AND (
           (a.valid_occurrence_keys IS NULL
             AND public.issue_3281_add_on_taken(a.id, NULL, p_session_id) + x.quantity > a.quantity_total)
           OR (a.valid_occurrence_keys IS NOT NULL AND EXISTS (
             SELECT 1 FROM unnest(x.day_scope) AS k
              WHERE public.issue_3281_add_on_taken(a.id, k, p_session_id) + x.quantity > a.quantity_total))
         )))
  ) THEN RETURN false; END IF;
  IF EXISTS(SELECT 1 FROM public.ticket_checkout_sessions s
    WHERE s.id=p_session_id AND (s.metadata->>'event_date_id') IS NOT NULL
      AND NOT EXISTS(SELECT 1 FROM public.event_dates d
        WHERE d.id=(s.metadata->>'event_date_id')::uuid AND d.event_id=p_event_id
          AND d.end_at > now() AND d.status = 'active')) THEN RETURN false; END IF;  -- issue #3281
  -- ══ issue #2160 — RE-VALIDATE **EVERY** CHOSEN DAY, NOT JUST THE ANCHOR ══
  -- The clause above re-checks only `metadata->>'event_date_id'`, which under
  -- #2160 is the ANCHOR (the latest-ENDING day). Without the clause below a
  -- stale NON-anchor day could still mint an entitlement at finalize for an
  -- occurrence that has already ended — the guest gets a pass for a day that
  -- is over, and the scanner correctly refuses them at a door they paid for.
  --
  -- DELETE THIS BLOCK and a session that sat in the cart across the end of
  -- day 1 finalizes into a day-1 pass.
  IF EXISTS(SELECT 1 FROM public.ticket_checkout_session_event_dates i
             WHERE i.checkout_session_id=p_session_id
               AND NOT EXISTS(SELECT 1 FROM public.event_dates d
                 WHERE d.id=i.event_date_id AND d.event_id=p_event_id
                   AND d.end_at > now() AND d.status = 'active')) THEN RETURN false; END IF;  -- issue #3281
  -- issue #3281: a checkout with no date of its own (a single-date event,
  -- or one opened before a cancel) cannot complete once every upcoming date
  -- of the event is cancelled.
  IF NOT EXISTS(SELECT 1 FROM public.ticket_checkout_session_event_dates i
                 WHERE i.checkout_session_id=p_session_id)
     AND (v_session.metadata->>'event_date_id') IS NULL
     AND NOT EXISTS(SELECT 1 FROM public.event_dates d
                     WHERE d.event_id=p_event_id AND d.end_at > now() AND d.status = 'active')
     AND EXISTS(SELECT 1 FROM public.event_dates d
                 WHERE d.event_id=p_event_id AND d.end_at > now() AND d.status <> 'active')
  THEN RETURN false; END IF;
  RETURN true;
END $function$;

-- issue_3872_checkout_day_context: re-emitted from 20271216013872_issue_3872_r1_ticket_checkout.sql; hunks declared in
-- __tests__/issue_3645_sell_publish_reemit_hunks.ts.
CREATE OR REPLACE FUNCTION public.issue_3872_checkout_day_context(
  p_event_id uuid,p_event_date_ids uuid[],p_booked_start_at timestamptz,p_booked_end_at timestamptz
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,auth,pg_temp AS $fn$
DECLARE
  v_event record; v_day_ids uuid[]; v_day_count integer:=0; v_day_choice jsonb;
  v_per_occurrence boolean:=false; v_pricing_mode text:='per_day'; v_day_multiplier integer:=1;
  v_booked_start timestamptz:=p_booked_start_at; v_booked_end timestamptz:=p_booked_end_at;
  v_open_daily boolean:=false;
BEGIN
  SELECT e.id,e.brand_id,e.event_type,e.capacity_scope,e.booking_spacing_minutes,
         e.is_recurring,e.recurrence_rules,e.timezone,e.multi_date_pricing_mode
    INTO v_event FROM public.events e WHERE e.id=p_event_id AND e.deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'event_not_found'; END IF;

  IF p_event_date_ids IS NOT NULL AND array_length(p_event_date_ids,1)>0 THEN
    SELECT ARRAY(SELECT d.id FROM public.event_dates d
      WHERE d.event_id=p_event_id AND d.id=ANY(p_event_date_ids)
      ORDER BY d.start_at,d.id) INTO v_day_ids;
    IF COALESCE(array_length(v_day_ids,1),0)
       <> (SELECT count(DISTINCT x) FROM unnest(p_event_date_ids) x) THEN
      RAISE EXCEPTION 'occurrence_not_found';
    END IF;
    IF EXISTS(SELECT 1 FROM public.event_dates d WHERE d.id=ANY(v_day_ids)
              AND (d.end_at<=now() OR d.status<>'active')) THEN  -- issue #3281
      RAISE EXCEPTION 'occurrence_not_available';
    END IF;
    v_day_count:=COALESCE(array_length(v_day_ids,1),0);
  END IF;

  v_day_choice:=public.issue_3313_event_day_choice(p_event_id);
  v_per_occurrence:=COALESCE((v_day_choice->>'perOccurrenceCapacity')::boolean,false);
  IF v_day_count=0 AND (v_day_choice->>'soleOccurrenceId') IS NOT NULL THEN
    v_day_ids:=ARRAY[(v_day_choice->>'soleOccurrenceId')::uuid]; v_day_count:=1;
  END IF;
  -- issue #3281: every upcoming date is cancelled. Nothing can be sold, and
  -- asking the buyer to choose a date that does not exist would mislead.
  IF v_day_count=0 AND COALESCE((v_day_choice->>'upcomingCount')::integer,0)=0
     AND EXISTS(SELECT 1 FROM public.event_dates d WHERE d.event_id=p_event_id
                  AND d.end_at>now() AND d.status<>'active') THEN
    RAISE EXCEPTION 'occurrence_not_available';
  END IF;
  IF v_day_count=0 AND COALESCE((v_day_choice->>'requiresChoice')::boolean,false) THEN
    RAISE EXCEPTION 'event_date_choice_required';
  END IF;
  IF v_event.event_type='experience'
     AND COALESCE(v_event.capacity_scope,'total') IN ('per_day','per_start')
     AND v_day_count=0 THEN RAISE EXCEPTION 'event_date_choice_required'; END IF;

  v_pricing_mode:=COALESCE(v_event.multi_date_pricing_mode,'per_day');
  IF v_day_count>0 AND v_pricing_mode='per_day' THEN v_day_multiplier:=v_day_count; END IF;
  IF v_booked_start IS NOT NULL AND v_day_count<>1 THEN RAISE EXCEPTION 'booked_start_invalid'; END IF;
  v_open_daily:=COALESCE(v_event.is_recurring,false)
    AND jsonb_typeof(v_event.recurrence_rules)='object'
    AND v_event.recurrence_rules->>'preset'='daily'
    AND v_event.recurrence_rules->'termination'->>'kind'='never';
  IF v_booked_start IS NULL AND v_event.event_type='experience'
     AND COALESCE(v_event.capacity_scope,'total')='per_start' AND v_day_count=1 AND NOT v_open_daily THEN
    SELECT d.start_at,d.start_at+make_interval(mins=>GREATEST(1,COALESCE(v_event.booking_spacing_minutes,30)))
      INTO v_booked_start,v_booked_end FROM public.event_dates d WHERE d.id=v_day_ids[1];
  END IF;
  PERFORM public.issue_3281_validate_booked_start(p_event_id,
    CASE WHEN v_day_count=1 THEN v_day_ids[1] ELSE NULL END,v_booked_start,v_booked_end);
  RETURN jsonb_build_object('dayIds',to_jsonb(v_day_ids),'dayCount',v_day_count,
    'perOccurrence',v_per_occurrence,'pricingMode',v_pricing_mode,'dayMultiplier',v_day_multiplier,
    'bookedStart',v_booked_start,'bookedEnd',v_booked_end,'eventType',v_event.event_type,
    'brandId',v_event.brand_id,'eventTimezone',COALESCE(v_event.timezone,'UTC'));
END;
$fn$;

-- issue_3313_event_day_choice: re-emitted from 20271123003281_issue_3281_r3_spacing_spots.sql; hunks declared in
-- __tests__/issue_3645_sell_publish_reemit_hunks.ts.
CREATE OR REPLACE FUNCTION public.issue_3313_event_day_choice(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_type      text;
  v_multi     boolean;
  v_recurring boolean;
  v_upcoming  integer;
  v_sole      uuid;
  v_scope     text;
  v_cancelled integer;  -- issue #3281
BEGIN
  SELECT e.event_type, COALESCE(e.is_multi_date, false), COALESCE(e.is_recurring, false),
         COALESCE(e.capacity_scope, 'total')
    INTO v_type, v_multi, v_recurring, v_scope
    FROM public.events e
   WHERE e.id = p_event_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'requiresChoice', false, 'soleOccurrenceId', NULL,
      'perOccurrenceCapacity', false, 'upcomingCount', 0);
  END IF;

  SELECT count(*)::integer, (array_agg(d.id ORDER BY d.start_at, d.id))[1]
    INTO v_upcoming, v_sole
    FROM public.event_dates d
   WHERE d.event_id = p_event_id AND d.end_at > now()
     AND d.status = 'active';  -- issue #3281
  -- issue #3281: upcoming dates that were cancelled. When they are all that
  -- is left, an event still requires a date to be chosen (and none can be),
  -- so no caller falls back to selling without a date.
  SELECT count(*)::integer INTO v_cancelled
    FROM public.event_dates d
   WHERE d.event_id = p_event_id AND d.end_at > now() AND d.status <> 'active';

  RETURN jsonb_build_object(
    'requiresChoice',
      v_type = 'event' AND (v_multi OR (v_recurring AND v_upcoming > 1)
        OR (v_upcoming = 0 AND v_cancelled > 0)),  -- issue #3281
    'soleOccurrenceId',
      CASE WHEN v_type = 'event' AND v_recurring AND NOT v_multi AND v_upcoming = 1
        THEN v_sole END,
    'perOccurrenceCapacity',
      (v_type = 'event' AND v_recurring AND NOT v_multi)
      OR (v_type = 'experience' AND v_scope = 'per_day'),
    'perStartCapacity',
      (v_type = 'experience' AND v_scope = 'per_start'),
    'capacityScope',
      CASE WHEN v_type = 'experience' THEN v_scope ELSE 'total' END,
    'upcomingCount', v_upcoming
  );
END;
$fn$;

COMMIT;
