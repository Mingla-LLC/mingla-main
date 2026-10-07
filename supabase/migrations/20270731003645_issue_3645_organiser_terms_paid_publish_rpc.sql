-- Issue #3645 PR11d — Organiser Terms 1.0 on paid publish RPCs.
--
-- PR11c gated paid publish in the app + Paystack/Stripe edges. Older clients
-- or direct RPC callers can still publish paid supply without accepting
-- version 1.0. This migration:
--   1. Adds biz_require_current_organiser_terms(brand_id [, user_id])
--   2. Calls it on the paid paths of business_publish_event_draft,
--      business_publish_trip_draft, biz_publish_experience, and biz_publish_stay.
-- Free publishes and experience draft saves (p_publish=false) stay unchanged.
--
-- Bodies are re-emitted from the last-writer migrations for each RPC
-- (event: #3439 draft-autosave pin; trip/experience: #1919; stay: #1424)
-- with a single additive PERFORM — no other behaviour change.

BEGIN;

CREATE OR REPLACE FUNCTION public.biz_require_current_organiser_terms(
  p_brand_id uuid,
  p_user_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  -- Authenticated callers are always bound to auth.uid(). Only service_role
  -- may supply p_user_id (ops / edge workers acting for a known member).
  v_uid uuid := CASE
    WHEN auth.role() = 'service_role' AND p_user_id IS NOT NULL THEN p_user_id
    ELSE auth.uid()
  END;
  v_version text;
  v_accepted_at timestamptz;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_brand_id IS NULL THEN
    RAISE EXCEPTION 'validation_error'
      USING ERRCODE = '22023', DETAIL = 'brand_id_required';
  END IF;

  SELECT m.mingla_tos_version_accepted, m.mingla_tos_accepted_at
    INTO v_version, v_accepted_at
  FROM public.brand_team_members AS m
  WHERE m.brand_id = p_brand_id
    AND m.user_id = v_uid
    AND m.removed_at IS NULL
    AND m.accepted_at IS NOT NULL
  LIMIT 1;

  -- Must match app CURRENT_MINGLA_TOS_VERSION / edge CURRENT_ORGANISER_TERMS_VERSION.
  -- Both fields required (same two-part proof as Paystack/Stripe onboard edges).
  IF v_version IS DISTINCT FROM '1.0' OR v_accepted_at IS NULL THEN
    RAISE EXCEPTION 'mingla_tos_not_accepted'
      USING ERRCODE = 'P0001',
            DETAIL = 'organiser_terms_version_required=1.0';
  END IF;
END;
$function$;

COMMENT ON FUNCTION public.biz_require_current_organiser_terms(uuid, uuid) IS
  'Issue #3645 PR11d: require the caller''s active brand_team_members row has mingla_tos_version_accepted = 1.0 AND mingla_tos_accepted_at set. Used on paid publish RPC paths only. p_user_id override is service_role-only.';

REVOKE ALL ON FUNCTION public.biz_require_current_organiser_terms(uuid, uuid)
  FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.biz_require_current_organiser_terms(uuid, uuid)
  FROM anon;
GRANT EXECUTE ON FUNCTION public.biz_require_current_organiser_terms(uuid, uuid)
  TO authenticated, service_role;

-- ── business_publish_event_draft (last-writer + PR11d ToS) ─────────────────────────────
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
    -- #3645 PR11d — Organiser Terms 1.0 before paid publish (free path skips).
    PERFORM public.biz_require_current_organiser_terms(v_event.brand_id);
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
$function$;

-- ── business_publish_trip_draft (last-writer + PR11d ToS) ─────────────────────────────
CREATE OR REPLACE FUNCTION public.business_publish_trip_draft(
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
  v_business_trip jsonb;
  v_title text;
  v_description text;
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
  v_destination_text text;
  v_capacity int;
  v_start_at_text text;
  v_end_at_text text;
  v_start timestamptz;
  v_end timestamptz;
  v_base_slug text;
  v_final_slug text;
  v_suffix integer := 2;
  v_now timestamptz := now();
  v_trip_day_count int;
  v_pricing_tier_count int;
  v_trip_days_rows jsonb;
  v_pricing_tier_rows jsonb;
  v_inclusion_rows jsonb;
  v_ticket_rows jsonb;
  v_event_dates_rows jsonb;
  v_trip_price_cents int; -- ORCH-1075: max online paid tier price
  -- issue #1014: money predicate over the PRE-EXISTING ticket rows (broader
  -- than the available_online-filtered Stripe predicate — door money counts).
  v_money_bearing boolean;
BEGIN
  -- ---------- 1. Auth ----------
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- ---------- 2. Event row lookup + state checks ----------
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

  IF v_event.event_type <> 'trip' THEN
    RAISE EXCEPTION 'event_not_a_trip'
      USING HINT = 'business_publish_trip_draft only handles event_type=trip rows. Use business_publish_event_draft for event_type=event.';
  END IF;

  IF public.biz_brand_effective_rank(v_event.brand_id, v_user_id) < public.biz_role_rank('event_manager'::text) THEN
    RAISE EXCEPTION 'insufficient_event_permission';
  END IF;

  -- ---------- 3. Brand lookup ----------
  SELECT id, slug, name, default_currency
  INTO v_brand
  FROM public.brands
  WHERE id = v_event.brand_id
    AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'brand_not_found';
  END IF;

  -- ---------- 4. Title validation ----------
  v_title := NULLIF(btrim(COALESCE(p_draft_payload->>'title', '')), '');
  IF v_title IS NULL THEN
    RAISE EXCEPTION 'event_title_required';
  END IF;

  -- ---------- 5. Trip-specific validation ----------
  v_theme := COALESCE(p_draft_payload->'theme', v_event.theme, '{}'::jsonb);
  v_business_trip := COALESCE(v_theme->'business_trip', '{}'::jsonb);

  v_destination_text := NULLIF(btrim(COALESCE(v_business_trip->>'destinationLocationText', '')), '');
  IF v_destination_text IS NULL THEN
    -- orch-strict-grep-allow trip-capacity-defensive-throw: HINT names the theme key as UX guidance only inside a defensive RAISE (not a canonical read — see v_business_trip->> read above, ORCH-0950); verbatim re-emit of the historical-exempt trip publish RPC, ORCH-1075 adds only paid-readiness/past-date guards.
    RAISE EXCEPTION 'trip_destination_required'
      USING HINT = 'Trips must have a destination before publish. Set theme.business_trip.destinationLocationText in Step 1 of the wizard.';
  END IF;

  SELECT tt.quantity_total INTO v_capacity
  FROM public.ticket_types tt
  JOIN public.trip_pricing_tiers tpt ON tpt.ticket_type_id = tt.id
  WHERE tpt.event_id = p_event_id
    AND tt.deleted_at IS NULL
  LIMIT 1;

  IF v_capacity IS NULL OR v_capacity <= 0 THEN
    RAISE EXCEPTION 'trip_capacity_required'
      USING HINT = 'Trips must have a positive capacity in ticket_types.quantity_total before publish.';
  END IF;

  v_start_at_text := NULLIF(v_business_trip->>'startAt', '');
  v_end_at_text := NULLIF(v_business_trip->>'endAt', '');
  IF v_start_at_text IS NULL OR v_end_at_text IS NULL THEN
    RAISE EXCEPTION 'trip_dates_required'
      USING HINT = 'Trips must have start + end dates before publish.';
  END IF;

  v_start := v_start_at_text::timestamptz;
  v_end := v_end_at_text::timestamptz;
  IF v_end <= v_start THEN
    RAISE EXCEPTION 'trip_end_before_start'
      USING HINT = 'Trip end date must be after start date.';
  END IF;

  -- ---------- 6. Sidecar table validation ----------
  SELECT count(*) INTO v_trip_day_count FROM public.trip_days WHERE event_id = p_event_id;
  IF v_trip_day_count = 0 THEN
    RAISE EXCEPTION 'trip_days_required'
      USING HINT = 'Trips must have at least one day before publish. Add days in Step 2 of the wizard.';
  END IF;

  SELECT count(*) INTO v_pricing_tier_count FROM public.trip_pricing_tiers WHERE event_id = p_event_id;
  IF v_pricing_tier_count = 0 THEN
    RAISE EXCEPTION 'trip_pricing_tier_required'
      USING HINT = 'Trips must have at least one pricing tier before publish. Configure pricing in Step 4 of the wizard.';
  END IF;


  -- ORCH-1075 paid-publish integrity guards (trip publish path) ----------
  -- PAID trip = a pricing tier whose ticket_type is online-sellable
  -- (available_online) with price_cents > 0. FREE / in-person-only trips are
  -- exempt. Mirror the checkout readiness predicate + reject a trip whose range
  -- has already ended. v_start/v_end already validated (end > start above).
  --   Stripe charges_enabled: https://docs.stripe.com/api/accounts/object
  --   Finish onboarding:      https://docs.stripe.com/connect/onboarding.md
  SELECT max(tt.price_cents) INTO v_trip_price_cents
    FROM public.trip_pricing_tiers tpt
    JOIN public.ticket_types tt ON tt.id = tpt.ticket_type_id
   WHERE tpt.event_id = p_event_id
     AND tt.deleted_at IS NULL
     AND tt.available_online = true;

  IF COALESCE(v_trip_price_cents, 0) > 0 THEN
    -- #3645 PR11d — Organiser Terms 1.0 before paid trip publish.
    PERFORM public.biz_require_current_organiser_terms(v_event.brand_id);
    IF NOT public.pg_brand_can_collect(v_event.brand_id) THEN
      -- TRANSITIONAL wire alias; remove only under cleanup issue #1922:
      -- https://github.com/Mingla-LLC/mingla-main/issues/1922
      RAISE EXCEPTION 'stripe_charges_disabled';
    END IF;
    IF v_end <= v_now THEN  -- trip range already ended (Q4 for a single range)
      RAISE EXCEPTION 'offering_date_past';
    END IF;
  END IF;

  -- ---------- 7. Slug generation + uniqueness (per-brand) ----------
  v_base_slug := lower(regexp_replace(v_title, '[^a-zA-Z0-9]+', '-', 'g'));
  v_base_slug := regexp_replace(v_base_slug, '(^-+|-+$)', '', 'g');
  IF v_base_slug = '' OR v_base_slug LIKE 'draft-%' THEN
    v_base_slug := 'trip';
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

  -- ---------- 8. Visibility mapping ----------
  v_visibility := CASE COALESCE(v_business_trip->>'requestedVisibility', 'public')
    WHEN 'private' THEN 'private'
    WHEN 'unlisted' THEN 'hidden'
    ELSE 'public'
  END;

  -- ---------- 9. Cover media (optional) ----------
  v_description := NULLIF(p_draft_payload->>'description', '');
  v_cover_media_url := NULLIF(p_draft_payload->>'cover_media_url', '');
  v_cover_media_type := NULLIF(p_draft_payload->>'cover_media_type', '');
  v_cover_media_provider := NULLIF(p_draft_payload->>'cover_media_provider', '');
  v_cover_media_source_url := NULLIF(p_draft_payload->>'cover_media_source_url', '');
  v_cover_media_credit := NULLIF(p_draft_payload->>'cover_media_credit', '');
  v_cover_media_credit_url := NULLIF(p_draft_payload->>'cover_media_credit_url', '');
  v_cover_media_alt := NULLIF(p_draft_payload->>'cover_media_alt', '');
  -- issue #868 — ADDITIVE + INDEPENDENT: read the extra-photos gallery; it is
  -- NOT nulled by the cover-absent branch (a gallery coexists with any cover).
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

  -- ---------- 10. event_dates write ----------
  DELETE FROM public.event_dates WHERE event_id = p_event_id;
  INSERT INTO public.event_dates (event_id, start_at, end_at, timezone, is_master)
  VALUES (p_event_id, v_start, v_end, v_timezone, true);

  -- ---------- 11. RLS / slug-trigger context flags ----------
  -- issue #1014 delta (1): trips validate PRE-EXISTING ticket rows (unlike
  -- events, which write tickets from the payload) — money-bearing = any
  -- non-deleted ticket priced > 0, online OR door. Moneyless → declare the
  -- free-only transition (transaction-scoped flag) so a currency-less brand
  -- publishes with events.currency NULL; money-bearing without a resolvable
  -- currency hits trigger (c)'s strict path → event_currency_required.
  v_money_bearing := EXISTS (
    SELECT 1
    FROM public.ticket_types tt
    WHERE tt.event_id = p_event_id
      AND tt.deleted_at IS NULL
      AND tt.price_cents > 0
  );

  PERFORM set_config('mingla.business_publish_trip_draft', 'on', true);
  PERFORM set_config('mingla.business_publish_event_draft', 'on', true);
  IF NOT v_money_bearing THEN
    PERFORM set_config('mingla.publish_free_only', 'on', true);
  END IF;

  -- ---------- 12. events UPDATE ----------
  UPDATE public.events
  SET
    title = v_title,
    description = v_description,
    slug = v_final_slug,
    cover_media_url = v_cover_media_url,
    cover_media_type = v_cover_media_type,
    cover_media_provider = v_cover_media_provider,
    cover_media_source_url = v_cover_media_source_url,
    cover_media_credit = v_cover_media_credit,
    cover_media_credit_url = v_cover_media_credit_url,
    cover_media_alt = v_cover_media_alt,
    cover_media_gallery = v_cover_media_gallery,
    destination_text = v_destination_text,
    theme = jsonb_strip_nulls(
      (v_theme
        #- '{business_trip,capacity}'
        #- '{business_trip,destinationLocationText}'
        #- '{business_trip,destinationPlaceId}'
        #- '{business_trip,destinationLat}'
        #- '{business_trip,destinationLng}'
        #- '{business_trip,startAt}'
        #- '{business_trip,endAt}'
      ) - 'business_draft'
    ),
    is_online = false,
    is_recurring = false,
    is_multi_date = false,
    recurrence_rules = NULL,
    status = 'scheduled',
    visibility = v_visibility,
    published_at = v_now,
    timezone = v_timezone,
    updated_at = v_now
  WHERE id = p_event_id
    AND status = 'draft'
    AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'event_draft_not_publishable';
  END IF;

  -- issue #1014 delta (2): normalize ticket currencies to the event's FINAL
  -- currency (trigger (c) just stamped or NULLed it). Nulls the fabricated
  -- draft-time USD on free trips of currency-less brands; heals draft/brand
  -- currency drift on resolved trips. Trigger (d) permits both directions
  -- (free→NULL; stamped→match).
  UPDATE public.ticket_types tt
     SET currency = e.currency,
         updated_at = v_now
    FROM public.events e
   WHERE e.id = p_event_id
     AND tt.event_id = p_event_id
     AND tt.deleted_at IS NULL
     AND tt.currency IS DISTINCT FROM e.currency;

  -- ---------- 13. Refresh + return composite payload ----------
  SELECT * INTO v_event FROM public.events WHERE id = p_event_id;

  SELECT COALESCE(jsonb_agg(to_jsonb(td) ORDER BY td.ordinal), '[]'::jsonb)
  INTO v_trip_days_rows
  FROM public.trip_days td
  WHERE td.event_id = p_event_id;

  SELECT COALESCE(jsonb_agg(to_jsonb(tpt) ORDER BY tpt.created_at), '[]'::jsonb)
  INTO v_pricing_tier_rows
  FROM public.trip_pricing_tiers tpt
  WHERE tpt.event_id = p_event_id;

  SELECT COALESCE(jsonb_agg(to_jsonb(ti) ORDER BY ti.kind, ti.ordinal), '[]'::jsonb)
  INTO v_inclusion_rows
  FROM public.trip_inclusions ti
  WHERE ti.event_id = p_event_id;

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
    'brand', jsonb_build_object(
      'id', v_brand.id,
      'slug', v_brand.slug,
      'name', v_brand.name
    ),
    'tripDays', v_trip_days_rows,
    'tripPricingTiers', v_pricing_tier_rows,
    'tripInclusions', v_inclusion_rows,
    'tickets', v_ticket_rows,
    'eventDates', v_event_dates_rows,
    'client_revision', p_client_revision
  );
END;
$$;

-- ── biz_publish_experience (last-writer + PR11d ToS) ─────────────────────────────
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
    IF v_stop_count < 2 OR v_stop_count > 5 THEN
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

  -- 10. Rewrite the ONE ticket_types row (NEVER N) — I-1 spine -----------
  UPDATE public.ticket_types
  SET deleted_at = v_now
  WHERE event_id = p_event_id
    AND deleted_at IS NULL;

  INSERT INTO public.ticket_types (
    event_id, name, description, price_cents, currency,
    quantity_total, is_unlimited, is_free,
    min_purchase_qty, max_purchase_qty,
    is_hidden, is_disabled, requires_approval, allow_transfers,
    password_protected, available_online, available_in_person,
    waitlist_enabled, display_order
  ) VALUES (
    p_event_id, 'Standard', NULL, v_resolved_total, v_currency,
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

-- ── biz_publish_stay (last-writer + PR11d ToS) ─────────────────────────────
CREATE OR REPLACE FUNCTION public.biz_publish_stay(
  p_venue_id uuid,
  p_expected_version bigint,
  p_request_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_venue public.venue_listings%ROWTYPE;
  v_settings public.stay_settings%ROWTYPE;
  v_default_currency character(3);
  v_authoring_enabled boolean := false;
  v_ready_offering_ids uuid[];
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE(flag.is_enabled, false)
  INTO v_authoring_enabled
  FROM public.feature_flags flag
  WHERE flag.flag_key = 'STAY_VENUE_AUTHORING';
  IF NOT COALESCE(v_authoring_enabled, false) THEN
    RAISE EXCEPTION 'stay_authoring_disabled' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_venue
  FROM public.venue_listings
  WHERE id = p_venue_id AND venue_category = 'stay'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'stay_venue_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.issue_1387_has_brand_capability(
    v_venue.brand_id,
    v_uid,
    'inventory'
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF v_venue.claim_status <> 'verified' THEN
    RAISE EXCEPTION 'stay_venue_not_approved' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_settings
  FROM public.stay_settings
  WHERE venue_id = p_venue_id
  FOR UPDATE;
  IF NOT FOUND OR p_expected_version IS NULL
     OR v_settings.version <> p_expected_version
     OR char_length(pg_catalog.btrim(COALESCE(v_settings.summary, ''))) < 20
     OR v_settings.check_in_time = v_settings.check_out_time THEN
    RAISE EXCEPTION 'stay_publish_incomplete' USING ERRCODE = 'P0001';
  END IF;
  -- #3645 PR11d — stay publish requires a current price → always paid.
  PERFORM public.biz_require_current_organiser_terms(v_venue.brand_id);
  SELECT brand.default_currency
  INTO v_default_currency
  FROM public.brands brand
  WHERE brand.id = v_venue.brand_id
  FOR UPDATE;
  IF v_default_currency IS NULL
     OR NOT public.pg_brand_can_collect(v_venue.brand_id)
     OR EXISTS (
       SELECT 1
       FROM public.brand_currency_reconciliations reconciliation
       WHERE reconciliation.brand_id = v_venue.brand_id
         AND reconciliation.status = 'pending'
     ) THEN
    RAISE EXCEPTION 'paid_currency_not_ready' USING ERRCODE = 'P0001';
  END IF;

  SELECT pg_catalog.array_agg(offering.id ORDER BY offering.id)
  INTO v_ready_offering_ids
  FROM public.stay_offerings offering
  WHERE offering.venue_id = p_venue_id
    AND offering.status IN ('draft', 'live')
    AND pg_catalog.btrim(offering.description) <> ''
    AND EXISTS (
      SELECT 1
      FROM public.stay_price_versions price
      WHERE price.offering_id = offering.id
        AND price.effective_to IS NULL
        AND price.currency_code = v_default_currency
    )
    AND EXISTS (
      SELECT 1
      FROM public.stay_policy_versions policy
      WHERE policy.offering_id = offering.id
        AND policy.effective_to IS NULL
    )
    AND (
      SELECT count(*)
      FROM public.stay_offering_media media
      WHERE media.offering_id = offering.id
        AND media.status = 'ready'
        AND media.is_cover
    ) = 1
    AND (
      offering.unit_naming_mode <> 'named'
      OR (
        SELECT count(*)
        FROM public.stay_units unit_row
        WHERE unit_row.offering_id = offering.id
          AND unit_row.status = 'active'
      ) = offering.quantity
    )
    AND (
      (
        offering.kind = 'room'
        AND EXISTS (
          SELECT 1
          FROM public.stay_room_nights night
          WHERE night.offering_id = offering.id
            AND NOT night.stop_sell
            AND night.sellable_quantity > 0
            AND night.local_date >=
              (now() AT TIME ZONE v_settings.timezone)::date
        )
      )
      OR (
        offering.kind = 'place'
        AND EXISTS (
          SELECT 1
          FROM public.stay_place_windows place_window
          WHERE place_window.offering_id = offering.id
            AND NOT place_window.stop_sell
            AND COALESCE(
              place_window.sellable_units,
              place_window.sellable_capacity,
              0
            ) > 0
            AND place_window.ends_at > now()
        )
      )
    );
  IF cardinality(COALESCE(v_ready_offering_ids, '{}'::uuid[])) = 0 THEN
    RAISE EXCEPTION 'stay_publish_incomplete' USING ERRCODE = 'P0001';
  END IF;

  PERFORM set_config('mingla.stay_publish_authorized', 'true', true);
  UPDATE public.stay_settings
  SET booking_state = 'active',
      version = version + 1,
      updated_by = v_uid,
      updated_at = now()
  WHERE venue_id = p_venue_id
    AND version = p_expected_version;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'stay_version_conflict' USING ERRCODE = '40001';
  END IF;
  UPDATE public.stay_offerings
  SET status = 'live',
      version = version + 1,
      updated_by = v_uid,
      updated_at = now()
  WHERE id = ANY(v_ready_offering_ids)
    AND status = 'draft';
  IF p_request_id IS NOT NULL THEN
    PERFORM set_config('mingla.request_id', p_request_id::text, true);
  END IF;
  INSERT INTO public.audit_log (
    user_id,
    brand_id,
    action,
    target_type,
    target_id,
    before,
    after
  ) VALUES (
    v_uid,
    v_venue.brand_id,
    'stay.publish',
    'stay',
    p_venue_id,
    jsonb_build_object('bookingState', v_settings.booking_state),
    jsonb_build_object(
      'bookingState',
      'active',
      'offeringIds',
      v_ready_offering_ids
    )
  );
  RETURN jsonb_build_object(
    'inventory',
    public.issue_1387_stay_inventory_snapshot(p_venue_id)
  );
END;
$function$;


DO $guard$
DECLARE
  v_helper text := pg_get_functiondef(
    'public.biz_require_current_organiser_terms(uuid, uuid)'::regprocedure
  );
  v_event text := pg_get_functiondef(
    'public.business_publish_event_draft(uuid, jsonb, integer)'::regprocedure
  );
  v_trip text := pg_get_functiondef(
    'public.business_publish_trip_draft(uuid, jsonb, integer)'::regprocedure
  );
  v_exp text := pg_get_functiondef(
    'public.biz_publish_experience(uuid, jsonb, boolean)'::regprocedure
  );
  v_stay text := pg_get_functiondef(
    'public.biz_publish_stay(uuid, bigint, uuid)'::regprocedure
  );
BEGIN
  IF position('organiser_terms_version_required=1.0' IN v_helper) = 0 THEN
    RAISE EXCEPTION 'issue-3645 PR11d: helper missing 1.0 version pin';
  END IF;
  IF position('biz_require_current_organiser_terms' IN v_event) = 0 THEN
    RAISE EXCEPTION 'issue-3645 PR11d: event publish missing ToS require';
  END IF;
  IF position('biz_require_current_organiser_terms' IN v_trip) = 0 THEN
    RAISE EXCEPTION 'issue-3645 PR11d: trip publish missing ToS require';
  END IF;
  IF position('biz_require_current_organiser_terms' IN v_exp) = 0 THEN
    RAISE EXCEPTION 'issue-3645 PR11d: experience publish missing ToS require';
  END IF;
  IF position('biz_require_current_organiser_terms' IN v_stay) = 0 THEN
    RAISE EXCEPTION 'issue-3645 PR11d: stay publish missing ToS require';
  END IF;
END
$guard$;

COMMIT;
