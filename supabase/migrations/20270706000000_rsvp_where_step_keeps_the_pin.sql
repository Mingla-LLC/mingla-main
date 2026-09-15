-- ---------------------------------------------------------------------------
-- RSVP Where step — the picked address keeps its map pin, and the published
-- RSVP carries it.
--
-- On an RSVP draft the organiser picks "61 Wythe Avenue, Brooklyn…", the map
-- preview renders, and about a second later it falls back to "Pick an address
-- to preview the map" while the address label stays. The wizard autosaves
-- 700 ms after the pick through business_update_rsvp_graph; that owner's draft
-- branch writes `city` but never `location_geo`, and its response (the events
-- row, location_geo NULL) replaces the local draft wholesale. The coordinate is
-- gone from the wizard, the next autosave writes the blob's locationGeo as null
-- too, and business_publish_rsvp_draft never promoted a coordinate anyway.
--
-- Production, read-only (2026-09-15): in-person RSVP drafts created in the last
-- 60 days — 4 of 5 with an address have no coordinate; published RSVPs with an
-- address — 1 of 2 has none. Ticketed event drafts are unaffected
-- (business_update_event_draft writes location_geo): 0 of 5 without.
--
--   business_update_rsvp_graph   draft branch writes location_geo when sent
--                                (the wizard sends it on every save, null when
--                                the address is cleared); live branch writes
--                                location_geo + coordinate_precision when a
--                                re-picked address sends them
--   business_publish_rsvp_draft  promotes business_draft.locationGeo +
--                                coordinatePrecision (mirror of #1653 for
--                                ticketed events); keeps the row's pin when the
--                                blob has none
--
-- Both functions are full CREATE OR REPLACE copies of their LATEST definition,
-- 20270701003288_issue_3288_gallery_absent_key_preserves.sql, which was read back
-- from production and compared body-for-body before copying (identical apart
-- from the signature default spelling `NULL` vs `NULL::integer`). ONLY the
-- lines marked "Where-step pin" differ. Public readers already withhold the
-- coordinate while the address is hidden (pg_public_rsvp_by_slug and
-- pg_discover_business_events gate on issue_2489_address_withheld), exactly as
-- they do for ticketed events, which have always stored it.
--
-- Pinned by supabase/migrations/__tests__/rsvp_where_step_keeps_the_pin.test.sql.
--
-- Idempotent: CREATE OR REPLACE only; grants and ownership are preserved.
--
-- MONOTONIC VERSION 20270706000000 — above the production applied head
-- 20270704003314 and above 20270705001984 (on main, not yet applied), so a
-- `supabase db push` after either apply order still reaches this file.
-- ---------------------------------------------------------------------------

BEGIN;

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
  -- Where-step pin — the coordinate the organiser picked, and how it was captured.
  v_location_geo point;
  v_coordinate_precision text;
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

  -- Where-step pin — promote the coordinate the wizard captured, exactly as
  -- #1653 does for ticketed events (point(LNG, LAT) argument order). An RSVP
  -- publish reads the STORED draft blob (issue_1977_current_rsvp_publish_payload
  -- hands theme.business_draft through), so the pin lives at
  -- business_draft.locationGeo. When the blob carries no coordinate we KEEP what
  -- the row already holds, so publishing never erases a pin.
  IF (v_business_draft->'locationGeo'->>'lat') IS NOT NULL
     AND (v_business_draft->'locationGeo'->>'lng') IS NOT NULL THEN
    v_location_geo := point(
      (v_business_draft->'locationGeo'->>'lng')::double precision,
      (v_business_draft->'locationGeo'->>'lat')::double precision
    );
    -- Normalise so the coordinate_precision CHECK only ever sees
    -- 'exact' | 'approximate' | NULL — an older client cannot break publish.
    v_coordinate_precision := NULLIF(
      btrim(COALESCE(v_business_draft->>'coordinatePrecision', '')), ''
    );
    IF v_coordinate_precision NOT IN ('exact', 'approximate') THEN
      v_coordinate_precision := NULL;
    END IF;
  ELSE
    v_location_geo := v_event.location_geo;
    v_coordinate_precision := v_event.coordinate_precision;
  END IF;
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
  -- issue #3288 — an ABSENT key keeps the stored gallery; a PRESENT key
  -- (including an explicit []) is written exactly as before.
  v_cover_media_gallery := CASE WHEN p_draft_payload ? 'cover_media_gallery'
    THEN COALESCE(p_draft_payload->'cover_media_gallery', '[]'::jsonb)
    ELSE COALESCE(v_event.cover_media_gallery, '[]'::jsonb) END;
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
    location_geo = v_location_geo,                  -- Where-step pin
    coordinate_precision = v_coordinate_precision,  -- Where-step pin
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

CREATE OR REPLACE FUNCTION public.business_update_rsvp_graph(p_event_id uuid, p_payload jsonb, p_reason text DEFAULT NULL::text, p_client_request_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE v_actor uuid:=auth.uid(); v public.events%ROWTYPE; v_draft jsonb; v_patch jsonb; v_merged jsonb;
  v_theme jsonb; v_result jsonb; v_hash text; v_prior public.rsvp_domain_operation_receipts%ROWTYPE;
  v_live_payload jsonb; v_update_result jsonb; v_current_revision integer; v_expected_revision integer;
  v_suggested integer; v_minimum integer;
BEGIN
  IF v_actor IS NULL OR p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN
    RAISE EXCEPTION 'rsvp_payload_invalid' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v FROM public.events WHERE id=p_event_id AND event_type='rsvp' AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND OR public.biz_brand_effective_rank(v.brand_id,v_actor)<public.biz_role_rank('event_manager') THEN
    RAISE EXCEPTION 'rsvp_not_found_or_forbidden' USING ERRCODE='42501';
  END IF;
  v_hash:=encode(extensions.digest(convert_to(p_event_id::text||':'||p_payload::text||':'||COALESCE(p_reason,''),'UTF8'),'sha256'),'hex');
  IF p_client_request_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(v_actor::text||':rsvp_update:'||p_client_request_id::text,0));
    SELECT * INTO v_prior FROM public.rsvp_domain_operation_receipts
      WHERE actor_id=v_actor AND operation='update' AND client_request_id=p_client_request_id;
    IF FOUND THEN
      IF v_prior.request_hash<>v_hash THEN RAISE EXCEPTION 'rsvp_idempotency_hash_mismatch' USING ERRCODE='23505'; END IF;
      RETURN v_prior.result||jsonb_build_object('replayed',true);
    END IF;
  END IF;
  IF v.status='draft' AND v.visibility='draft' THEN
    IF EXISTS(SELECT 1 FROM public.event_dates d WHERE d.event_id=p_event_id)
       OR EXISTS(SELECT 1 FROM public.ticket_types t WHERE t.event_id=p_event_id AND t.deleted_at IS NULL) THEN
      RAISE EXCEPTION 'rsvp_draft_graph_invalid';
    END IF;
    v_draft:=COALESCE(v.theme#>'{business_draft}','{}'::jsonb);
    v_patch:=COALESCE(p_payload#>'{theme,business_draft}','{}'::jsonb)||p_payload;
    v_current_revision:=COALESCE((v_draft->>'clientRevision')::integer,0);
    v_expected_revision:=NULLIF(p_payload->>'__expectedClientRevision','')::integer;
    IF v_expected_revision IS NOT NULL AND v_expected_revision<v_current_revision THEN
      RAISE EXCEPTION 'rsvp_revision_conflict' USING ERRCODE='40001';
    END IF;
    v_patch:=v_patch-'__expectedClientRevision';
    v_merged:=jsonb_set(v_draft||v_patch,'{clientRevision}',to_jsonb(COALESCE(v_expected_revision,v_current_revision+1)),true);
    IF v_patch?'when' THEN v_merged:=jsonb_set(v_merged,'{when}',COALESCE(v_draft->'when','{}'::jsonb)||(v_patch->'when'),true); END IF;
    IF v_patch?'settings' THEN v_merged:=jsonb_set(v_merged,'{settings}',COALESCE(v_draft->'settings','{}'::jsonb)||(v_patch->'settings'),true); END IF;
    IF COALESCE(jsonb_array_length(COALESCE(v_merged->'tickets','[]'::jsonb)),0)<>0
       OR COALESCE((v_merged->>'isRsvp')::boolean,true)<>true THEN
      RAISE EXCEPTION 'rsvp_ticket_wall' USING ERRCODE='22023';
    END IF;
    v_suggested:=NULLIF(v_merged->>'rsvpContributionSuggestedCents','')::integer;
    v_minimum:=NULLIF(v_merged->>'rsvpContributionMinCents','')::integer;
    IF (v_suggested IS NOT NULL AND v_suggested<=0)
       OR (v_minimum IS NOT NULL AND v_minimum<=0)
       OR (v_suggested IS NOT NULL AND v_minimum IS NOT NULL AND v_suggested<v_minimum) THEN
      RAISE EXCEPTION 'rsvp_contribution_amount_invalid' USING ERRCODE='22023';
    END IF;
    IF COALESCE((v_merged->>'rsvpContributionEnabled')::boolean,false)
       AND NOT public.pg_brand_can_collect(v.brand_id) THEN
      RAISE EXCEPTION 'stripe_charges_disabled' USING ERRCODE='42501';
    END IF;
    v_theme:=jsonb_set(COALESCE(v.theme,'{}'::jsonb),'{business_draft}',v_merged,true);
    UPDATE public.events SET
      title=COALESCE(NULLIF(btrim(p_payload->>'title'),''),v.title),
      description=CASE WHEN p_payload?'description' THEN NULLIF(p_payload->>'description','') ELSE v.description END,
      location_text=CASE WHEN p_payload?'location_text' THEN NULLIF(p_payload->>'location_text','') ELSE v.location_text END,
      online_url=CASE WHEN p_payload?'online_url' THEN NULLIF(p_payload->>'online_url','') ELSE v.online_url END,
      cover_media_url=CASE WHEN p_payload?'cover_media_url' THEN NULLIF(p_payload->>'cover_media_url','') ELSE v.cover_media_url END,
      cover_media_poster_url=CASE WHEN p_payload?'cover_media_poster_url' THEN NULLIF(p_payload->>'cover_media_poster_url','') ELSE v.cover_media_poster_url END,
      cover_media_type=CASE WHEN p_payload?'cover_media_type' THEN NULLIF(p_payload->>'cover_media_type','') ELSE v.cover_media_type END,
      cover_media_provider=CASE WHEN p_payload?'cover_media_provider' THEN NULLIF(p_payload->>'cover_media_provider','') ELSE v.cover_media_provider END,
      cover_media_source_url=CASE WHEN p_payload?'cover_media_source_url' THEN NULLIF(p_payload->>'cover_media_source_url','') ELSE v.cover_media_source_url END,
      cover_media_credit=CASE WHEN p_payload?'cover_media_credit' THEN NULLIF(p_payload->>'cover_media_credit','') ELSE v.cover_media_credit END,
      cover_media_credit_url=CASE WHEN p_payload?'cover_media_credit_url' THEN NULLIF(p_payload->>'cover_media_credit_url','') ELSE v.cover_media_credit_url END,
      cover_media_alt=CASE WHEN p_payload?'cover_media_alt' THEN NULLIF(p_payload->>'cover_media_alt','') ELSE v.cover_media_alt END,
      cover_media_gallery=CASE WHEN p_payload?'cover_media_gallery' THEN p_payload->'cover_media_gallery' ELSE v.cover_media_gallery END,
      timezone=COALESCE(NULLIF(p_payload->>'timezone',''),v.timezone),
      is_online=CASE WHEN v_patch?'format' THEN (v_patch->>'format') IN ('online','hybrid') ELSE v.is_online END,
      theme=v_theme,
      party_types=CASE WHEN v_patch?'partyTypes' THEN ARRAY(SELECT jsonb_array_elements_text(v_patch->'partyTypes')) ELSE v.party_types END,
      vibe_tags=CASE WHEN v_patch?'vibeTags' THEN ARRAY(SELECT jsonb_array_elements_text(v_patch->'vibeTags')) ELSE v.vibe_tags END,
      music_genres=CASE WHEN v_patch?'musicGenres' THEN ARRAY(SELECT jsonb_array_elements_text(v_patch->'musicGenres')) ELSE v.music_genres END,
      city=CASE WHEN v_patch?'city' THEN NULLIF(v_patch->>'city','') ELSE v.city END,
      -- Where-step pin: written when the save carries it (the wizard always does;
      -- an explicit null clears it with the address). Absent key keeps the row.
      location_geo=CASE WHEN p_payload?'location_geo' THEN NULLIF(p_payload->>'location_geo','')::point ELSE v.location_geo END,
      theme_color_override=CASE WHEN p_payload?'theme_color_override' THEN NULLIF(p_payload->>'theme_color_override','') ELSE v.theme_color_override END,
      theme_font_override=CASE WHEN p_payload?'theme_font_override' THEN NULLIF(p_payload->>'theme_font_override','') ELSE v.theme_font_override END,
      theme_animation_override=CASE WHEN p_payload?'theme_animation_override' THEN NULLIF(p_payload->>'theme_animation_override','') ELSE v.theme_animation_override END,
      currency=COALESCE(NULLIF(upper(COALESCE(p_payload->>'currency',v_patch->>'currency')),''),v.currency),updated_at=now()
    WHERE id=p_event_id;
  ELSE
    IF length(btrim(COALESCE(p_reason,''))) NOT BETWEEN 10 AND 200 THEN
      RAISE EXCEPTION 'rsvp_edit_reason_invalid' USING ERRCODE='22023';
    END IF;
    v_live_payload:=p_payload||jsonb_build_object('title',COALESCE(NULLIF(p_payload->>'title',''),v.title));
    v_update_result:=public.biz_update_live_rsvp(p_event_id,v_live_payload,p_reason);
    UPDATE public.events SET
      party_types=CASE WHEN p_payload?'partyTypes' THEN ARRAY(SELECT jsonb_array_elements_text(p_payload->'partyTypes')) ELSE party_types END,
      vibe_tags=CASE WHEN p_payload?'vibeTags' THEN ARRAY(SELECT jsonb_array_elements_text(p_payload->'vibeTags')) ELSE vibe_tags END,
      music_genres=CASE WHEN p_payload?'musicGenres' THEN ARRAY(SELECT jsonb_array_elements_text(p_payload->'musicGenres')) ELSE music_genres END,
      city=CASE WHEN p_payload?'city' THEN NULLIF(p_payload->>'city','') ELSE city END,
      -- Where-step pin on a published RSVP: a re-picked address sends its
      -- coordinate and precision together; an unrelated edit sends neither.
      location_geo=CASE WHEN p_payload?'location_geo' THEN NULLIF(p_payload->>'location_geo','')::point ELSE location_geo END,
      coordinate_precision=CASE WHEN p_payload?'location_geo' THEN
        CASE WHEN NULLIF(p_payload->>'location_geo','') IS NOT NULL
              AND p_payload->>'coordinate_precision' IN ('exact','approximate')
             THEN p_payload->>'coordinate_precision' END
        ELSE coordinate_precision END,
      cover_media_gallery=CASE WHEN p_payload?'cover_media_gallery' THEN p_payload->'cover_media_gallery' ELSE cover_media_gallery END
    WHERE id=p_event_id;
  END IF;
  v_result:=public.issue_1977_rsvp_graph(p_event_id);
  IF v_update_result IS NOT NULL THEN
    v_result:=v_result||jsonb_build_object('updateResult',v_update_result);
  END IF;
  IF p_client_request_id IS NOT NULL THEN
    INSERT INTO public.rsvp_domain_operation_receipts(actor_id,operation,client_request_id,event_id,request_hash,result)
    VALUES(v_actor,'update',p_client_request_id,p_event_id,v_hash,v_result);
  END IF;
  RETURN v_result||jsonb_build_object('replayed',false);
END;
$function$;

COMMIT;

NOTIFY pgrst, 'reload schema';
