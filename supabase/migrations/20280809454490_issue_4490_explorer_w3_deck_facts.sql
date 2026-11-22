-- Issue #4490, Explorer app W3: deck facts (what a venue card says).
-- Spec 06 §3 W3 (the spec's number 20280809384490 is taken; this is the next
-- free number in the #4490 series after 20280809444490). W3 fix round 1 edits
-- this (unpushed, local-only) file in place.
-- 0. The venue page's own "from" prices (one owner for page and card):
--    issue_4490_option_from_minor(option) is the smallest amount a guest can
--    pay for one active price option (its current price, or a busy-time price
--    that can apply on the option's days and hours, lower or higher);
--    issue_4490_public_offers is re-emitted from its latest body
--    (20280809144490_issue_4490_p3_packages_deposits.sql) with fromMinor read
--    from it and the brand's collect-online answer worked out once per call;
--    issue_4490_public_memberships is re-emitted from its latest body (204490
--    plus the 374490 and 384490 checked patches) so its headline price is the
--    cheapest plan a guest can join today (an instant plan with room, or any
--    request plan), carried with its own period, and says whether that plan is
--    joinable (fromJoinable).
-- 1. issue_4490_venue_upcoming_events(venue, until): the ONE owner of "which
--    events at a venue are upcoming" (public, scheduled or live, not deleted,
--    with a slug; the next date after now and, when `until` is given, before
--    it, with that date's end; plus whether a date is running right now and
--    until when). Lifted from the events block of issue_4490_venue_page_payload.
-- 2. issue_4490_venue_page_payload: re-emitted from its latest body
--    (20280809204490_issue_4490_p6_memberships.sql) with ONLY the events block
--    changed to read (1). Same rows, same order, same limit.
-- 3. issue_4490_venue_bookable_given(...): the ONE rule for "bookable"
--    (verified venue of a live brand with a live offer of a switched-on kind
--    (entry, group packages, private hire, by the hour), or live plans with
--    Memberships on, or Table reservations on and reservable; Stays rooms
--    alone never count, decision 2). issue_4490_venue_is_bookable(venue) reads
--    the projections and asks it; W5 and W6 call that, never a copy.
-- 4. (none: the card's zone is read inside (5), see there.)
-- 5. issue_4490_venue_card_facts(venue): the single owner of what a venue
--    card says (deck chips now, the Discover venue card in W6). Every price is
--    the page's own (issue_4490_public_offers, issue_4490_public_memberships),
--    worked out once per venue. Service-internal.
-- 6. pg_deck_venue_facts(place ids): anon/authenticated batch read for the
--    deck: one row per claimed place of a verified venue of a live,
--    non-internal brand (I-4174), at most 100 ids. One venue whose facts fail
--    keeps its identity row (no chips) instead of failing the batch. No
--    contact, owner or buyer data.
-- Static SQL. Local stack only until Seth approves a production migration.

BEGIN;
SET LOCAL lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 0. The page's own "from" prices (one owner for the venue page and the card).
-- ---------------------------------------------------------------------------
-- The smallest amount a guest can pay for one active price option: its current
-- price, or a busy-time price (lower or higher) whose days meet the option's
-- days and whose hours meet the option's hours. Busy-time prices apply by the
-- window's start (issue_4490_option_price_at), so a rule that can never meet the
-- option never prices it. NULL for an archived option or one with no current
-- price.
CREATE OR REPLACE FUNCTION public.issue_4490_option_from_minor(p_option_id uuid)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT LEAST(price.amount_minor, (
    SELECT min((rule->>'amount_minor')::bigint)
    FROM jsonb_array_elements(opt.busy_rules) rule
    WHERE (rule->>'from')::time < (rule->>'to')::time
      AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(rule->'weekdays') d
                  WHERE d::smallint = ANY(opt.weekdays))
      AND (opt.local_start_time IS NULL
           OR opt.local_start_time >= opt.local_end_time
           OR ((rule->>'from')::time < opt.local_end_time AND opt.local_start_time < (rule->>'to')::time))
  ))
  FROM public.venue_offer_price_options opt
  JOIN public.stay_price_versions price ON price.price_option_id = opt.id AND price.effective_to IS NULL
  WHERE opt.id = p_option_id AND opt.status = 'active';
$function$;
REVOKE ALL ON FUNCTION public.issue_4490_option_from_minor(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4490_option_from_minor(uuid) TO service_role;

-- Live offers of publicly enabled kinds (latest body 20280809144490); fromMinor
-- now reads issue_4490_option_from_minor, and the brand's collect-online answer
-- is worked out once per call instead of once per offer.
CREATE OR REPLACE FUNCTION public.issue_4490_public_offers(p_venue_id uuid, p_features text[])
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT CASE WHEN NOT public.issue_4490_flag_on('VENUE_OFFERS_READS') THEN '[]'::jsonb ELSE COALESCE((
    WITH live AS (
      SELECT o.* FROM public.stay_offerings o
      WHERE o.venue_id = p_venue_id AND o.status = 'live'
        AND o.kind = ANY(public.issue_4490_built_offer_kinds())
        AND public.issue_4490_offer_kind_feature(o.kind) = ANY(p_features)
    ),
    -- One collect-online answer per brand (every live offer here shares it).
    collect AS MATERIALIZED (
      SELECT x.brand_id, public.issue_4490_can_collect_online(x.brand_id, p_venue_id) AS ok
      FROM (SELECT DISTINCT l.brand_id FROM live l) x
    )
    SELECT jsonb_agg(jsonb_build_object(
      'id', o.id,
      'kind', o.kind,
      'entryStyle', o.entry_style,
      'name', o.name,
      'summary', NULLIF(o.summary, ''),
      'fromMinor', (SELECT min(public.issue_4490_option_from_minor(opt.id)) FROM public.venue_offer_price_options opt
                    WHERE opt.offering_id = o.id AND opt.status = 'active'),
      'unit', COALESCE((SELECT opt.unit FROM public.venue_offer_price_options opt
                        WHERE opt.offering_id = o.id AND opt.status = 'active'
                        ORDER BY opt.sort_order LIMIT 1), 'guest'),
      'guestMin', (SELECT min(opt.guest_min) FROM public.venue_offer_price_options opt
                   WHERE opt.offering_id = o.id AND opt.status = 'active'),
      'guestMax', (SELECT max(opt.guest_max) FROM public.venue_offer_price_options opt
                   WHERE opt.offering_id = o.id AND opt.status = 'active'),
      'confirmationMode', COALESCE(o.confirmation_mode, 'instant'),
      'spaceIds', (SELECT jsonb_agg(s.space_id ORDER BY s.space_id) FROM public.venue_offer_spaces s
                   WHERE s.offering_id = o.id),
      'sortOrder', o.sort_order,
      'canCollectOnline', (SELECT c.ok FROM collect c WHERE c.brand_id = o.brand_id),
      'durationMinutes', CASE WHEN o.kind = 'group_package' THEN (
        SELECT r.slot_duration_minutes FROM public.stay_place_schedule_rules r
        WHERE r.offering_id = o.id AND r.active ORDER BY r.created_at DESC LIMIT 1) END,
      'payModes', CASE WHEN o.deposit_kind = 'none' THEN '["full"]'::jsonb ELSE '["deposit","full"]'::jsonb END,
      'minNoticeMinutes', o.min_notice_minutes
    ) ORDER BY o.sort_order, o.created_at)
    FROM live o
  ), '[]'::jsonb) END;
$function$;


-- The guest's view of live plans (latest body 20280809204490 plus the 374490
-- and 384490 checked patches). The headline price is the cheapest plan a guest
-- can join today: an instant plan with room, or any request plan (a request
-- holds no place). Its period travels with it ("interval"); a tie goes to the
-- monthly plan. When every plan is full the headline falls back to the
-- cheapest plan and fromJoinable says false (a card then shows no amount).
CREATE OR REPLACE FUNCTION public.issue_4490_public_memberships(p_venue_id uuid, p_features text[])
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT CASE WHEN NOT public.issue_4490_flag_on('VENUE_OFFERS_READS') OR NOT ('memberships' = ANY(p_features)) THEN NULL
    ELSE (
      SELECT CASE WHEN count(*) = 0 THEN NULL ELSE jsonb_build_object(
        'fromMinor', COALESCE(min(x.price_minor) FILTER (WHERE x.joinable), min(x.price_minor)),
        'interval', COALESCE(
          (array_agg(x.period ORDER BY x.price_minor, x.period, x.sort_order, x.created_at) FILTER (WHERE x.joinable))[1],
          (array_agg(x.period ORDER BY x.price_minor, x.period, x.sort_order, x.created_at))[1]),
        'fromJoinable', COALESCE(bool_or(x.joinable), false),
        'currencyCode', min(x.currency_code),
        'plans', jsonb_agg(jsonb_build_object(
          'id', x.id, 'name', x.name, 'summary', x.summary, 'inclusions', x.inclusions,
          'priceMinor', x.price_minor, 'interval', x.period,
          'entryIncluded', x.entry_included, 'roomHours', x.room_hours_per_period,
          'guestPasses', x.guest_passes_per_period, 'discountBps', x.discount_bps,
          'discountKinds', to_jsonb(x.discount_kinds),
          'minMonths', x.min_months, 'noticeDays', x.notice_days, 'graceDays', x.grace_days,
          'renewalNoticeDays', x.renewal_notice_days,
          'joinMode', x.join_mode,
          'assignedDeskAvailable', cardinality(x.desk_space_ids) > 0,
          'full', x.full)
          ORDER BY x.sort_order, x.created_at)) END
      FROM (
        SELECT p.*, f.full, (p.join_mode = 'request' OR NOT f.full) AS joinable
        FROM public.venue_membership_plans p
        JOIN public.stay_offerings o ON o.id = p.offering_id
        CROSS JOIN LATERAL (
          SELECT COALESCE((public.issue_4490_membership_plan_projection(p.id)->>'full')::boolean, false) AS full
          OFFSET 0  -- the projection runs once per plan
        ) f
        WHERE o.venue_id = p_venue_id AND p.status = 'live'
      ) x)
    END;
$function$;

-- ---------------------------------------------------------------------------
-- 1. Upcoming events at a venue (one owner).
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.issue_4490_venue_upcoming_events(uuid, timestamptz);
CREATE FUNCTION public.issue_4490_venue_upcoming_events(p_venue_id uuid, p_until timestamptz)
RETURNS TABLE (
  event_id uuid,
  event_type text,
  title text,
  slug text,
  space_id uuid,
  starts_at timestamptz,
  ends_at timestamptz,
  live_now boolean,
  live_until timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT e.id, e.event_type, e.title, e.slug, e.space_id, nd.start_at, nd.end_at, lv.until IS NOT NULL, lv.until
  FROM public.events e
  LEFT JOIN LATERAL (
    SELECT d.start_at, d.end_at FROM public.event_dates d
    WHERE d.event_id = e.id AND d.start_at > now()
      AND (p_until IS NULL OR d.start_at < p_until)
    ORDER BY d.start_at
    LIMIT 1
  ) nd ON true
  CROSS JOIN LATERAL (
    SELECT max(d.end_at) AS until FROM public.event_dates d
    WHERE d.event_id = e.id AND d.start_at <= now() AND d.end_at > now()
  ) lv
  WHERE e.venue_id = p_venue_id
    AND e.visibility = 'public'
    AND e.status IN ('scheduled', 'live')
    AND e.deleted_at IS NULL
    AND e.slug IS NOT NULL
    AND (nd.start_at IS NOT NULL OR lv.until IS NOT NULL);
$function$;
REVOKE ALL ON FUNCTION public.issue_4490_venue_upcoming_events(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4490_venue_upcoming_events(uuid, timestamptz) TO service_role;

-- ---------------------------------------------------------------------------
-- 2. The public page payload (latest body 20280809204490_issue_4490_p6_memberships.sql);
--    only the events block changed: it reads issue_4490_venue_upcoming_events.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_4490_venue_page_payload(p_venue_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_venue public.venue_listings%ROWTYPE;
  v_row jsonb;
  v_features text[];
  v_currency text;
  v_brand_slug text;
  v_spaces jsonb;
  v_events jsonb;
  v_tables jsonb;
  v_version bigint;
  v_offers jsonb;
  v_vat jsonb;
BEGIN
  SELECT * INTO v_venue FROM public.venue_listings WHERE id = p_venue_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  v_row := public.issue_4490_venue_page_row(p_venue_id);
  v_features := public.issue_4490_public_features(p_venue_id);
  SELECT upper(COALESCE(NULLIF(btrim(b.default_currency), ''), 'NGN')), b.slug
    INTO v_currency, v_brand_slug
  FROM public.brands b WHERE b.id = v_venue.brand_id;

  SELECT COALESCE(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'id', s.id,
      'name', s.name,
      'setting', s.setting,
      'capacityStanding', s.capacity_standing,
      'capacitySeated', s.capacity_seated,
      'planShape', s.plan_shape,
      'photoUrls', (SELECT COALESCE(jsonb_agg(p->>'url' ORDER BY i), '[]'::jsonb)
                    FROM jsonb_array_elements(s.photos) WITH ORDINALITY AS ph(p, i))
    )) ORDER BY s.sort_order, s.created_at), '[]'::jsonb)
  INTO v_spaces
  FROM public.venue_spaces s
  WHERE s.venue_id = p_venue_id AND s.is_active AND s.archived_at IS NULL;

  IF 'events_here' = ANY(v_features) THEN
    -- #4490 Explorer W3: the predicate lives in issue_4490_venue_upcoming_events.
    SELECT COALESCE(jsonb_agg(item ORDER BY starts_at), '[]'::jsonb)
    INTO v_events
    FROM (
      SELECT jsonb_build_object(
          'id', u.event_id,
          'kind', u.event_type,
          'title', u.title,
          'startsAt', u.starts_at,
          'spaceName', sp.name,
          'fromMinor', (SELECT min(tt.price_cents) FROM public.ticket_types tt
                        WHERE tt.event_id = u.event_id AND tt.deleted_at IS NULL
                          AND NOT COALESCE(tt.is_hidden, false) AND NOT COALESCE(tt.is_disabled, false)),
          'href', CASE u.event_type
                    WHEN 'experience' THEN '/exp/' || v_brand_slug || '/' || u.slug
                    WHEN 'trip' THEN '/t/' || v_brand_slug || '/' || u.slug
                    ELSE '/e/' || v_brand_slug || '/' || u.slug END
        ) AS item,
        u.starts_at
      FROM public.issue_4490_venue_upcoming_events(p_venue_id, NULL) u
      LEFT JOIN public.venue_spaces sp ON sp.id = u.space_id
      WHERE u.starts_at IS NOT NULL
      ORDER BY u.starts_at
      LIMIT 6
    ) upcoming;
  ELSE
    v_events := '[]'::jsonb;
  END IF;

  -- #4490 P5: the tables block (party cap incl. joined tables, pick a table,
  -- hold / minimum spend from, big-party request, guest waitlist).
  v_tables := public.issue_4490_public_tables(p_venue_id, v_features);

  -- #4490 P2: live offers of publicly enabled kinds, and the venue's VAT mode.
  v_offers := public.issue_4490_public_offers(p_venue_id, v_features);
  SELECT jsonb_build_object(
      'mode', s.vat_mode,
      'ratePct', COALESCE((SELECT c.vat_rate_bps FROM public.country_vat_config c
                           WHERE c.country = upper(v_venue.country_code)), 0)::numeric / 100)
    INTO v_vat
  FROM public.venue_booking_settings s WHERE s.venue_id = p_venue_id;
  IF jsonb_array_length(v_offers) = 0 THEN
    v_vat := NULL;
  END IF;

  SELECT GREATEST(
      COALESCE((SELECT max(f.version) FROM public.venue_features f WHERE f.venue_id = p_venue_id), 0),
      COALESCE((SELECT max(s.version) FROM public.venue_spaces s WHERE s.venue_id = p_venue_id), 0),
      COALESCE((SELECT max(o.version) FROM public.stay_offerings o
                WHERE o.venue_id = p_venue_id AND o.kind NOT IN ('room', 'place')), 0))
  INTO v_version;

  RETURN jsonb_build_object(
    'version', v_version,
    'venue', v_row,
    'currencyCode', v_currency,
    -- orch-strict-grep-allow offering-currency-list: zero-decimal currencies (minor unit exponent map), not an allow-list.
    'minorUnitExponent', CASE WHEN v_currency IN ('JPY', 'KRW', 'VND', 'CLP', 'ISK', 'UGX', 'RWF', 'XOF', 'XAF', 'PYG', 'GNF', 'KMF', 'DJF', 'BIF', 'VUV', 'XPF')
                              THEN 0 ELSE 2 END,
    'vat', v_vat,
    'features', to_jsonb(v_features),
    'spaces', v_spaces,
    'hours', jsonb_build_object('weekly', v_row->'hours_windows', 'specialDays', v_row->'special_hours'),
    'events', jsonb_build_object('upcoming', v_events),
    'tables', v_tables,
    'offers', v_offers,
    'memberships', public.issue_4490_public_memberships(p_venue_id, v_features)
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4490_venue_page_payload(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4490_venue_page_payload(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Bookable (one owner). Rooms alone never count.
-- ---------------------------------------------------------------------------
-- The rule, given the projections the page itself shows.
CREATE OR REPLACE FUNCTION public.issue_4490_venue_bookable_given(
  p_live_venue boolean,
  p_offers jsonb,
  p_memberships jsonb,
  p_tables_reservable boolean
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT COALESCE(p_live_venue, false) AND (
    EXISTS (
      SELECT 1 FROM jsonb_array_elements(COALESCE(p_offers, '[]'::jsonb)) o
      WHERE o->>'kind' IN ('entry', 'group_package', 'private_hire', 'by_the_hour')
    )
    OR p_memberships IS NOT NULL
    OR COALESCE(p_tables_reservable, false)
  );
$function$;
REVOKE ALL ON FUNCTION public.issue_4490_venue_bookable_given(boolean, jsonb, jsonb, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4490_venue_bookable_given(boolean, jsonb, jsonb, boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.issue_4490_venue_is_bookable(p_venue_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT COALESCE((
    SELECT public.issue_4490_venue_bookable_given(
      true,
      public.issue_4490_public_offers(v.id, f.feats),
      public.issue_4490_public_memberships(v.id, f.feats),
      'table_reservations' = ANY(f.feats)
        AND COALESCE((SELECT r.reservable FROM public.pg_venue_reservable_for_place(v.place_pool_id) r), false))
    FROM public.venue_listings v
    JOIN public.brands b ON b.id = v.brand_id AND b.deleted_at IS NULL
    CROSS JOIN LATERAL (SELECT public.issue_4490_public_features(v.id) AS feats) f
    WHERE v.id = p_venue_id AND v.claim_status = 'verified'
  ), false);
$function$;
REVOKE ALL ON FUNCTION public.issue_4490_venue_is_bookable(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4490_venue_is_bookable(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 5. What a venue card says (one owner; service-internal). Every projection
--    is worked out once per venue.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_4490_venue_card_facts(p_venue_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_venue public.venue_listings%ROWTYPE;
  v_brand public.brands%ROWTYPE;
  v_features text[];
  v_offers jsonb;
  v_members jsonb;
  v_currency text;
  v_tz text;
  v_local timestamp;
  v_until timestamptz;
  v_on_starts timestamptz;
  v_on_ends timestamptz;
  v_live_until timestamptz;
  v_tables boolean;
  v_plan_from bigint;
  v_plan_period text;
BEGIN
  SELECT * INTO v_venue FROM public.venue_listings WHERE id = p_venue_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  SELECT * INTO v_brand FROM public.brands WHERE id = v_venue.brand_id;
  v_features := public.issue_4490_public_features(p_venue_id);
  v_offers := public.issue_4490_public_offers(p_venue_id, v_features);
  v_members := public.issue_4490_public_memberships(p_venue_id, v_features);
  v_currency := upper(COALESCE(NULLIF(btrim(v_brand.default_currency), ''), 'NGN'));
  -- The venue's zone from the venue code's own chain (issue_4490_venue_timezone),
  -- which ends on 'UTC' when it knows nothing: then the brand's default zone,
  -- else none (never a guessed clock, rule 12). 'UTC' stays only when the venue
  -- itself says UTC.
  v_tz := public.issue_4490_venue_timezone(p_venue_id);
  IF v_tz = 'UTC'
     AND NOT EXISTS (SELECT 1 FROM public.venue_booking_settings s
                     WHERE s.venue_id = p_venue_id AND s.timezone = 'UTC')
     AND NOT EXISTS (SELECT 1 FROM public.venue_availability_config c
                     WHERE c.venue_id = p_venue_id AND c.iana_timezone = 'UTC') THEN
    v_tz := NULL;
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names n WHERE n.name = v_brand.default_timezone) THEN
      v_tz := v_brand.default_timezone;
    END IF;
  END IF;
  v_tables := 'table_reservations' = ANY(v_features)
    AND COALESCE((SELECT r.reservable FROM public.pg_venue_reservable_for_place(v_venue.place_pool_id) r), false);

  -- Plans: the page's own headline plan, only when a guest can join it today.
  IF v_members IS NOT NULL AND COALESCE((v_members->>'fromJoinable')::boolean, false) THEN
    v_plan_from := (v_members->>'fromMinor')::bigint;
    v_plan_period := v_members->>'interval';
  END IF;

  -- On today / on tonight: the earliest date that starts from now until the
  -- next 05:00 in the venue's zone (with its end), or one running now (with
  -- when it ends). Only with a known zone.
  IF 'events_here' = ANY(v_features) AND v_tz IS NOT NULL THEN
    v_local := now() AT TIME ZONE v_tz;
    v_until := (date_trunc('day', v_local) + interval '5 hours'
                + CASE WHEN v_local::time >= time '05:00' THEN interval '1 day' ELSE interval '0' END)
               AT TIME ZONE v_tz;
    SELECT (array_agg(u.starts_at ORDER BY u.starts_at) FILTER (WHERE u.starts_at IS NOT NULL))[1],
           (array_agg(u.ends_at ORDER BY u.starts_at) FILTER (WHERE u.starts_at IS NOT NULL))[1],
           max(u.live_until) FILTER (WHERE u.live_now)
      INTO v_on_starts, v_on_ends, v_live_until
    FROM public.issue_4490_venue_upcoming_events(p_venue_id, v_until) u;
  END IF;

  RETURN jsonb_build_object(
    'venueId', v_venue.id,
    'venueName', v_venue.name,
    'venueSlug', v_venue.slug,
    'brandId', v_brand.id,
    'brandSlug', v_brand.slug,
    'brandName', v_brand.name,
    'venueType', v_venue.venue_category,
    'timezone', v_tz,
    'features', to_jsonb(v_features),
    'isBookable', public.issue_4490_venue_bookable_given(
      v_venue.claim_status = 'verified' AND v_brand.deleted_at IS NULL, v_offers, v_members, v_tables),
    'tablesReservable', v_tables,
    'plansLive', v_members IS NOT NULL,
    'priceFrom', jsonb_build_object(
      'entry', (SELECT min((o->>'fromMinor')::bigint) FROM jsonb_array_elements(v_offers) o
                WHERE o->>'kind' = 'entry' AND o->>'fromMinor' IS NOT NULL),
      'group_packages', (SELECT min((o->>'fromMinor')::bigint) FROM jsonb_array_elements(v_offers) o
                WHERE o->>'kind' = 'group_package' AND o->>'fromMinor' IS NOT NULL),
      'private_hire', (SELECT min((o->>'fromMinor')::bigint) FROM jsonb_array_elements(v_offers) o
                WHERE o->>'kind' = 'private_hire' AND o->>'fromMinor' IS NOT NULL),
      'by_the_hour', (SELECT min((o->>'fromMinor')::bigint) FROM jsonb_array_elements(v_offers) o
                WHERE o->>'kind' = 'by_the_hour' AND o->>'fromMinor' IS NOT NULL),
      'memberships', v_plan_from),
    'membershipsPeriod', v_plan_period,
    'currencyCode', v_currency,
    -- orch-strict-grep-allow offering-currency-list: zero-decimal currencies (minor unit exponent map), not an allow-list.
    'minorUnitExponent', CASE WHEN v_currency IN ('JPY', 'KRW', 'VND', 'CLP', 'ISK', 'UGX', 'RWF', 'XOF', 'XAF', 'PYG', 'GNF', 'KMF', 'DJF', 'BIF', 'VUV', 'XPF')
                              THEN 0 ELSE 2 END,
    'onTodayStartsAt', v_on_starts,
    'onTodayEndsAt', v_on_ends,
    'onTodayLive', v_live_until IS NOT NULL,
    'onTodayLiveUntil', v_live_until
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4490_venue_card_facts(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4490_venue_card_facts(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 6. The deck's batch read (anon + authenticated). One venue whose facts fail
--    keeps its identity row (claimed, no chips); the rest of the batch is
--    unaffected.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pg_deck_venue_facts(p_place_ids uuid[])
RETURNS TABLE (place_pool_id uuid, facts jsonb)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  r record;
  v_facts jsonb;
BEGIN
  IF p_place_ids IS NULL OR cardinality(p_place_ids) = 0 THEN
    RETURN;
  END IF;
  IF cardinality(p_place_ids) > 100 THEN
    RAISE EXCEPTION 'too_many_places' USING ERRCODE = '22023';
  END IF;
  FOR r IN
    SELECT v.id, v.place_pool_id AS place_id, v.slug, v.name, v.venue_category,
           b.id AS brand_id, b.slug AS brand_slug, b.name AS brand_name, b.default_currency
    FROM public.venue_listings v
    JOIN public.brands b ON b.id = v.brand_id AND b.deleted_at IS NULL
    WHERE v.place_pool_id = ANY(p_place_ids)
      AND v.claim_status = 'verified'
      AND NOT public.admin_brand_is_internal(b.id)
    ORDER BY v.place_pool_id
  LOOP
    BEGIN
      v_facts := public.issue_4490_venue_card_facts(r.id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'pg_deck_venue_facts: card facts failed for venue % (%)', r.id, SQLSTATE;
      v_facts := jsonb_build_object(
        'venueId', r.id, 'venueName', r.name, 'venueSlug', r.slug,
        'brandId', r.brand_id, 'brandSlug', r.brand_slug, 'brandName', r.brand_name,
        'venueType', r.venue_category, 'timezone', NULL, 'features', '[]'::jsonb,
        'isBookable', false, 'tablesReservable', false, 'plansLive', false,
        'priceFrom', jsonb_build_object('entry', NULL, 'group_packages', NULL, 'private_hire', NULL,
                                        'by_the_hour', NULL, 'memberships', NULL),
        'membershipsPeriod', NULL,
        'currencyCode', upper(COALESCE(NULLIF(btrim(r.default_currency), ''), 'NGN')),
        'minorUnitExponent', 2,
        'onTodayStartsAt', NULL, 'onTodayEndsAt', NULL, 'onTodayLive', false, 'onTodayLiveUntil', NULL);
    END;
    place_pool_id := r.place_id;
    facts := v_facts;
    RETURN NEXT;
  END LOOP;
END;
$function$;
REVOKE ALL ON FUNCTION public.pg_deck_venue_facts(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pg_deck_venue_facts(uuid[]) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.pg_deck_venue_facts(uuid[]) IS
  '#4490 Explorer W3: deck card facts for claimed places (verified venues of live, non-internal brands; at most 100 ids). Prices are the public page''s own live "from" prices; no contact, owner or buyer data.';

COMMIT;

-- Reverse (local use only): DROP FUNCTION public.pg_deck_venue_facts(uuid[]),
--   public.issue_4490_venue_card_facts(uuid),
--   public.issue_4490_venue_is_bookable(uuid),
--   public.issue_4490_venue_bookable_given(boolean, jsonb, jsonb, boolean);
--   re-apply issue_4490_venue_page_payload from 20280809204490; then
--   DROP FUNCTION public.issue_4490_venue_upcoming_events(uuid, timestamptz);
--   re-apply issue_4490_public_offers from 20280809144490 and
--   issue_4490_public_memberships from 20280809204490 + the 374490/384490
--   patches; then DROP FUNCTION public.issue_4490_option_from_minor(uuid).
