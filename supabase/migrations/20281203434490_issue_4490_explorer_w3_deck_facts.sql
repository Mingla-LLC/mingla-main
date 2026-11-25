-- Issue #4490, Explorer app W3: deck facts (what a venue card says).
-- Spec 06 §3 W3 (the spec's number 20281203364490 is taken; this is the next
-- free number in the #4490 series after 20281203424490). W3 fix round 1 edits
-- this (unpushed, local-only) file in place.
-- 0. The venue page's own "from" prices (one owner for page, card and the
--    Host Offers list). W3 fix 2: issue_4490_offer_from(offer) is the smallest
--    price checkout really charges for some bookable slot (the quote's own
--    resolver, issue_4490_option_price_at, now runs on lifted pure helpers
--    that the set read issue_4490_offer_slot_prices shares), with one unit;
--    issue_4490_option_price_at, issue_4490_option_window_reason and
--    issue_4490_window_cutoff are re-emitted from 20281203084490 onto those
--    helpers (same answers), and issue_4490_day_closed as plpgsql (same
--    answer, planned once per session);
--    issue_4490_public_offers is re-emitted from its latest body
--    (20281203144490_issue_4490_p3_packages_deposits.sql) with fromMinor and
--    unit read from it and the brand's collect-online answer worked out once per call;
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
--    (20281203194490_issue_4490_p6_memberships.sql) with ONLY the events block
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
--    non-internal brand (#4174), at most 100 ids. One venue whose facts fail
--    keeps its identity row (no chips) instead of failing the batch. No
--    contact, owner or buyer data.
-- Static SQL. Local stack only until Seth approves a production migration.

BEGIN;
SET LOCAL lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 0. The page's own "from" prices (one owner for the venue page, the card
--    and the Host Offers list), from the SAME price resolution checkout uses.
-- ---------------------------------------------------------------------------
-- W3 fix round 2 (W3-N14): checkout prices an option for one slot with
-- issue_4490_option_price_at (the first busy rule, by order, whose weekday and
-- [from, to) hold the slot's LOCAL START, else the current price), after
-- issue_4490_option_window_reason (the option's days and hours) and the
-- window's cut-off (issue_4490_window_cutoff). Their bodies are lifted into
-- three pure helpers below, and those three functions now call them, so the
-- "from" read and checkout run one body each and cannot disagree.

-- The price an option charges for a slot that starts at p_local_start (venue
-- time): the first busy rule (array order) whose weekday matches and whose
-- [from, to) holds the start, else the current price.
CREATE OR REPLACE FUNCTION public.issue_4490_busy_price(
  p_busy_rules jsonb,
  p_amount_minor bigint,
  p_local_start timestamp
)
RETURNS bigint
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $function$
  SELECT COALESCE((
    SELECT (b.rule->>'amount_minor')::bigint
    FROM jsonb_array_elements(COALESCE(p_busy_rules, '[]'::jsonb)) WITH ORDINALITY AS b(rule, ord)
    WHERE (extract(isodow FROM p_local_start)::integer - 1) IN (
            SELECT d::integer FROM jsonb_array_elements_text(b.rule->'weekdays') d)
      AND p_local_start::time >= (b.rule->>'from')::time
      AND p_local_start::time < (b.rule->>'to')::time
    ORDER BY b.ord
    LIMIT 1
  ), p_amount_minor);
$function$;

-- Why an option cannot be bought for a slot on p_local_date starting at
-- p_local_start (NULL = it can): archived, not on that weekday, or outside the
-- option's own hours.
CREATE OR REPLACE FUNCTION public.issue_4490_option_slot_reason(
  p_status text,
  p_weekdays smallint[],
  p_local_start_time time,
  p_local_end_time time,
  p_local_date date,
  p_local_start timestamp
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $function$
  SELECT CASE
    WHEN p_status IS DISTINCT FROM 'active' THEN 'option_unavailable'
    WHEN NOT ((extract(isodow FROM p_local_date)::integer - 1)::smallint = ANY(p_weekdays)) THEN 'wrong_weekday'
    WHEN p_local_start_time IS NOT NULL AND NOT (
      p_local_start::time >= p_local_start_time
      AND p_local_start::time < p_local_end_time
    ) THEN 'wrong_time'
    ELSE NULL
  END;
$function$;

-- The last moment a slot can be bought online: the start for timed sessions
-- and every non-entry kind, the end for walk-in / day pass; minus the notice.
CREATE OR REPLACE FUNCTION public.issue_4490_slot_cutoff(
  p_kind text,
  p_entry_style text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_min_notice_minutes integer
)
RETURNS timestamptz
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $function$
  SELECT CASE WHEN p_entry_style = 'timed_session' OR p_kind <> 'entry' THEN p_starts_at ELSE p_ends_at END
         - make_interval(mins => p_min_notice_minutes);
$function$;

-- Re-emitted from 20281203084490 (the only body): the same answer, now from
-- the lifted helpers.
CREATE OR REPLACE FUNCTION public.issue_4490_option_price_at(
  p_option_id uuid,
  p_window_id uuid
)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT public.issue_4490_busy_price(opt.busy_rules, price.amount_minor, w.starts_at AT TIME ZONE r.timezone)
  FROM public.venue_offer_price_options opt
  JOIN public.stay_price_versions price
    ON price.price_option_id = opt.id AND price.effective_to IS NULL
  JOIN public.stay_place_windows w ON w.id = p_window_id AND w.offering_id = opt.offering_id
  JOIN public.stay_place_schedule_rules r ON r.id = w.schedule_rule_id
  WHERE opt.id = p_option_id;
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_option_window_reason(p_option_id uuid, p_window_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT public.issue_4490_option_slot_reason(opt.status, opt.weekdays, opt.local_start_time, opt.local_end_time,
                                              w.local_date, w.starts_at AT TIME ZONE r.timezone)
  FROM public.stay_place_windows w
  JOIN public.stay_place_schedule_rules r ON r.id = w.schedule_rule_id
  LEFT JOIN public.venue_offer_price_options opt ON opt.id = p_option_id AND opt.offering_id = w.offering_id
  WHERE w.id = p_window_id;
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_window_cutoff(p_offering_id uuid, p_window_id uuid)
RETURNS timestamptz
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT public.issue_4490_slot_cutoff(o.kind, o.entry_style, w.starts_at, w.ends_at, o.min_notice_minutes)
  FROM public.stay_offerings o
  JOIN public.stay_place_windows w ON w.offering_id = o.id
  WHERE o.id = p_offering_id AND w.id = p_window_id;
$function$;

-- Whether an offer's day can sell at all: not a closed special day, not a
-- weekday whose hours are all closed (issue_4490_day_closed), and not a day
-- closed on the offer's capacity pool (as issue_4490_pool_day_usage reads it).
-- Re-emitted from 20281203084490 (its only body) as plpgsql, same answer: an
-- SQL body is planned again on every call from another function (W3 fix 2
-- measured ~66 us a call against ~10 us); every availability and "from" read
-- asks it once per day.
CREATE OR REPLACE FUNCTION public.issue_4490_day_closed(p_venue_id uuid, p_local_date date)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  RETURN (SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM public.venue_special_hours s
      WHERE s.venue_id = p_venue_id AND s.local_date = p_local_date AND s.is_closed
    ) THEN true
    WHEN EXISTS (
      SELECT 1 FROM public.venue_special_hours s
      WHERE s.venue_id = p_venue_id AND s.local_date = p_local_date AND NOT s.is_closed
    ) THEN false
    WHEN NOT EXISTS (SELECT 1 FROM public.brand_hours h WHERE h.venue_id = p_venue_id) THEN false
    ELSE NOT EXISTS (
      SELECT 1 FROM public.brand_hours h
      WHERE h.venue_id = p_venue_id
        AND h.weekday = (extract(isodow FROM p_local_date)::integer - 1)
        AND NOT COALESCE(h.is_closed, false)
    )
  END);
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_offer_day_open(p_venue_id uuid, p_pool_id uuid, p_local_date date)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  RETURN NOT public.issue_4490_day_closed(p_venue_id, p_local_date)
     AND NOT EXISTS (SELECT 1 FROM public.venue_capacity_overrides ov
                     WHERE ov.pool_id = p_pool_id AND ov.local_date = p_local_date AND ov.closed);
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4490_offer_day_open(uuid, uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4490_offer_day_open(uuid, uuid, date) TO service_role;

-- The slots a guest could book for an offer, each with the price checkout
-- would charge each active option there. A slot is a window that sells (not
-- stopped, not a booking block) on an open day (no closed special day, no
-- closed weekly hours, no closed day on its pool) inside the booking horizon
-- (and inside p_days venue days when given), whose cut-off has not passed; a
-- flexible day ("Hours you set", by the hour) offers every start on its length
-- step from opening that fits the shortest booking, as the flexible window
-- checkout creates. An option prices a slot only when it can be bought there
-- (issue_4490_option_slot_reason) with a current price in the brand's currency.
-- Capacity is not read: "from" is what the venue charges, not who is left.
-- p_open_days_only false skips the open-day test (issue_4490_offer_day_open)
-- for a caller that asks it lazily, cheapest slot first.
CREATE OR REPLACE FUNCTION public.issue_4490_offer_slot_prices(
  p_offering_id uuid,
  p_days integer,
  p_open_days_only boolean DEFAULT true
)
RETURNS TABLE (price_option_id uuid, unit text, local_date date, starts_at timestamptz, price_minor bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  -- plpgsql so the plan is prepared once per session (an SQL body is planned
  -- again on every call from another function).
  RETURN QUERY
  WITH o AS (
    SELECT o.id, o.kind, o.entry_style, o.venue_id, o.capacity_pool_id, o.min_notice_minutes,
           COALESCE(o.booking_length_step_minutes, 60) AS step,
           GREATEST(COALESCE(o.booking_length_min_minutes, 60), COALESCE(o.booking_length_step_minutes, 60)) AS min_len,
           upper(COALESCE(NULLIF(btrim(b.default_currency), ''), 'NGN')) AS currency,
           (now() AT TIME ZONE COALESCE(s.timezone, 'UTC'))::date AS today,
           LEAST(COALESCE(s.booking_horizon_days, 365), COALESCE(o.max_advance_days, 730),
                 COALESCE(p_days, 100000)) AS span
    FROM public.stay_offerings o
    JOIN public.brands b ON b.id = o.brand_id
    LEFT JOIN public.venue_booking_settings s ON s.venue_id = o.venue_id
    WHERE o.id = p_offering_id
  ),
  slots AS MATERIALIZED (
    -- Windows that sell, on open days (closed special day, closed weekly
    -- hours, or a closed day on the offer's pool never sell), in range.
    SELECT o.id AS offering_id, w.local_date, x.starts_at, r.timezone
    FROM o
    JOIN public.stay_place_windows w
      ON w.offering_id = p_offering_id AND NOT w.stop_sell AND NOT w.booked_block
     AND w.starts_at >= now() - interval '2 days'
     AND w.starts_at < now() + make_interval(days => o.span + 2)
     AND w.local_date BETWEEN o.today - 1 AND o.today + o.span
    JOIN public.stay_place_schedule_rules r ON r.id = w.schedule_rule_id
    CROSS JOIN LATERAL (
      -- A fixed window is one slot; a flexible day offers every start on its
      -- length step from opening that fits the shortest booking.
      SELECT w.starts_at, w.ends_at WHERE r.mode IS DISTINCT FROM 'flexible'
      UNION ALL
      SELECT g, g + make_interval(mins => o.min_len)
      FROM generate_series(w.starts_at, w.ends_at - make_interval(mins => o.min_len), make_interval(mins => o.step)) g
      WHERE r.mode = 'flexible' AND r.active
    ) x
    WHERE (NOT p_open_days_only OR public.issue_4490_offer_day_open(o.venue_id, o.capacity_pool_id, w.local_date))
      -- (A slot that starts after now plus the notice is before its cut-off by
      -- the cut-off's own definition, so the helper is asked only near now.)
      AND (x.starts_at - make_interval(mins => o.min_notice_minutes) > now()
           OR (now() >= public.issue_4490_slot_cutoff(o.kind, o.entry_style, x.starts_at, x.ends_at,
                                                     o.min_notice_minutes)) IS NOT TRUE)
  )
  -- (An option with no busy rules charges its current price everywhere, and
  -- one sold every weekday at any hour fits every slot: the helpers' own
  -- answers, so they are asked only for options with rules or limits.)
  SELECT opt.id, opt.unit, s.local_date, s.starts_at,
         CASE WHEN opt.busy_rules = '[]'::jsonb THEN price.amount_minor
              ELSE public.issue_4490_busy_price(opt.busy_rules, price.amount_minor, s.starts_at AT TIME ZONE s.timezone) END
  FROM slots s
  JOIN public.venue_offer_price_options opt ON opt.offering_id = p_offering_id AND opt.status = 'active'
  JOIN public.stay_price_versions price
    ON price.price_option_id = opt.id AND price.offering_id = p_offering_id AND price.effective_to IS NULL
   AND price.currency_code = (SELECT o.currency FROM o)
  WHERE (opt.local_start_time IS NULL AND opt.weekdays @> '{0,1,2,3,4,5,6}'::smallint[])
     OR public.issue_4490_option_slot_reason(opt.status, opt.weekdays, opt.local_start_time, opt.local_end_time,
                                             s.local_date, s.starts_at AT TIME ZONE s.timezone) IS NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4490_offer_slot_prices(uuid, integer, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4490_offer_slot_prices(uuid, integer, boolean) TO service_role;

-- An offer's "from" ({fromMinor, unit}): the smallest price checkout charges
-- for some slot in the next 14 venue days (one week's pattern twice, so every
-- weekday and every busy rule is met even when one week has a closed day;
-- the same 14 days the card's "Sold out" reads), else in the whole booking
-- horizon, else (no slot at all: nothing can be bought) the current price.
-- Options with an ID check count (spec: Gameland's card says "Entry from
-- ₦4,000", the Student & NYSC price). Units are never mixed (W3-N17): when the
-- offer has a per-guest price, "from" is the cheapest per-guest price, unit
-- 'guest'; otherwise the cheapest price with its own unit (ties: sort order).
CREATE OR REPLACE FUNCTION public.issue_4490_offer_from(p_offering_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_offer public.stay_offerings%ROWTYPE;
  r record;
  v_pass integer;
  v_closed date[] := '{}';
BEGIN
  SELECT * INTO v_offer FROM public.stay_offerings WHERE id = p_offering_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  -- Cheapest slot first (per-guest prices first): the first slot on an open
  -- day is the answer, so the open-day test runs for one day in the usual case.
  FOR v_pass IN 1..2 LOOP
    FOR r IN
      SELECT s.unit, s.price_minor, s.local_date
      FROM public.issue_4490_offer_slot_prices(p_offering_id, CASE WHEN v_pass = 1 THEN 14 END, false) s
      JOIN public.venue_offer_price_options opt ON opt.id = s.price_option_id
      ORDER BY (s.unit = 'guest') DESC, s.price_minor, opt.sort_order, opt.id, s.local_date
    LOOP
      IF r.local_date = ANY(v_closed) THEN
        CONTINUE;
      END IF;
      IF public.issue_4490_offer_day_open(v_offer.venue_id, v_offer.capacity_pool_id, r.local_date) THEN
        RETURN jsonb_build_object('fromMinor', r.price_minor, 'unit', r.unit);
      END IF;
      v_closed := v_closed || r.local_date;
    END LOOP;
  END LOOP;
  -- No slot at all (nothing can be bought now): the current price, so the
  -- offer still reads; per-guest first, then by price.
  RETURN (
    SELECT jsonb_build_object('fromMinor', price.amount_minor, 'unit', opt.unit)
    FROM public.venue_offer_price_options opt
    JOIN public.stay_price_versions price ON price.price_option_id = opt.id AND price.effective_to IS NULL
    WHERE opt.offering_id = p_offering_id AND opt.status = 'active'
    ORDER BY (opt.unit = 'guest') DESC, price.amount_minor, opt.sort_order, opt.id
    LIMIT 1);
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4490_offer_from(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4490_offer_from(uuid) TO service_role;

-- Which offers a guest sees (W3 fix 2: lifted from issue_4490_public_offers
-- so the card's lean price read and the page read share it): live offers of a
-- built kind whose feature is publicly on, with offer reads switched on.
CREATE OR REPLACE FUNCTION public.issue_4490_public_live_offers(p_venue_id uuid, p_features text[])
RETURNS SETOF public.stay_offerings
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT o.* FROM public.stay_offerings o
  WHERE public.issue_4490_flag_on('VENUE_OFFERS_READS')
    AND o.venue_id = p_venue_id AND o.status = 'live'
    AND o.kind = ANY(public.issue_4490_built_offer_kinds())
    AND public.issue_4490_offer_kind_feature(o.kind) = ANY(p_features);
$function$;
REVOKE ALL ON FUNCTION public.issue_4490_public_live_offers(uuid, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4490_public_live_offers(uuid, text[]) TO service_role;

-- The card's lean read of the same offers: id, kind and "from" (amount and
-- unit) only, without the page's offer JSON or the collect-online answer
-- (W3-N9).
CREATE OR REPLACE FUNCTION public.issue_4490_public_offer_prices(p_venue_id uuid, p_features text[])
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_prices jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', o.id, 'kind', o.kind) || COALESCE(f.price, '{}'::jsonb)
                            ORDER BY o.sort_order, o.created_at), '[]'::jsonb)
  INTO v_prices
  FROM public.issue_4490_public_live_offers(p_venue_id, p_features) o
  CROSS JOIN LATERAL (SELECT public.issue_4490_offer_from(o.id) AS price OFFSET 0) f;
  RETURN v_prices;
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4490_public_offer_prices(uuid, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4490_public_offer_prices(uuid, text[]) TO service_role;

-- Live offers of publicly enabled kinds (latest body 20281203144490); fromMinor
-- and unit now read issue_4490_offer_from (the price checkout charges, one
-- unit), and the brand's collect-online answer is worked out once per call
-- instead of once per offer.
CREATE OR REPLACE FUNCTION public.issue_4490_public_offers(p_venue_id uuid, p_features text[])
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_offers jsonb;
BEGIN
  -- W3 fix 2: plpgsql so the plan is prepared once per session (the SQL body
  -- was planned again on every page read).
  IF NOT public.issue_4490_flag_on('VENUE_OFFERS_READS') THEN
    RETURN '[]'::jsonb;
  END IF;
  SELECT COALESCE((
    WITH live AS (
      SELECT o.* FROM public.issue_4490_public_live_offers(p_venue_id, p_features) o
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
      -- W3 fix 2: the price checkout really charges, with its own unit.
      'fromMinor', (f.price->>'fromMinor')::bigint,
      'unit', COALESCE(f.price->>'unit', 'guest'),
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
    CROSS JOIN LATERAL (SELECT public.issue_4490_offer_from(o.id) AS price OFFSET 0) f
  ), '[]'::jsonb) INTO v_offers;
  RETURN v_offers;
END;
$function$;


-- The guest's view of live plans (latest body 20281203194490 plus the 374490
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
-- 2. The public page payload (latest body 20281203194490_issue_4490_p6_memberships.sql);
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
    -- #4490 W3 fix 1: the exponent comes from its one owner (supported_brand_currencies).
    'minorUnitExponent', COALESCE((SELECT c.minor_unit_exponent FROM public.supported_brand_currencies c
                                   WHERE c.code = v_currency), 2),
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
  -- W3 fix 2 (W3-N9): the lean read of the page's own offers and prices.
  v_offers := public.issue_4490_public_offer_prices(p_venue_id, v_features);
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
      -- W3 fix 2 (W3-N17): the page's groups rule, one unit: per-guest
      -- packages when there are any, else per-booking ones.
      'group_packages', COALESCE(
                (SELECT min((o->>'fromMinor')::bigint) FROM jsonb_array_elements(v_offers) o
                 WHERE o->>'kind' = 'group_package' AND o->>'fromMinor' IS NOT NULL AND o->>'unit' <> 'booking'),
                (SELECT min((o->>'fromMinor')::bigint) FROM jsonb_array_elements(v_offers) o
                 WHERE o->>'kind' = 'group_package' AND o->>'fromMinor' IS NOT NULL)),
      'private_hire', (SELECT min((o->>'fromMinor')::bigint) FROM jsonb_array_elements(v_offers) o
                WHERE o->>'kind' = 'private_hire' AND o->>'fromMinor' IS NOT NULL),
      'by_the_hour', (SELECT min((o->>'fromMinor')::bigint) FROM jsonb_array_elements(v_offers) o
                WHERE o->>'kind' = 'by_the_hour' AND o->>'fromMinor' IS NOT NULL),
      'memberships', v_plan_from),
    'membershipsPeriod', v_plan_period,
    'currencyCode', v_currency,
    -- #4490 W3 fix 1: the exponent comes from its one owner (supported_brand_currencies).
    'minorUnitExponent', COALESCE((SELECT c.minor_unit_exponent FROM public.supported_brand_currencies c
                                   WHERE c.code = v_currency), 2),
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
  v_all jsonb;
BEGIN
  IF p_place_ids IS NULL OR cardinality(p_place_ids) = 0 THEN
    RETURN;
  END IF;
  IF cardinality(p_place_ids) > 100 THEN
    RAISE EXCEPTION 'too_many_places' USING ERRCODE = '22023';
  END IF;
  -- W3 fix 2 (W3-N9): the whole batch in ONE subtransaction; only when some
  -- venue's facts fail is the batch answered venue by venue (below), so that
  -- venue alone keeps just its identity row (W3-N10).
  BEGIN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('p', x.place_pool_id, 'f', x.facts) ORDER BY x.place_pool_id), '[]'::jsonb)
    INTO v_all
    FROM (
      SELECT v.place_pool_id, public.issue_4490_venue_card_facts(v.id) AS facts
      FROM public.venue_listings v
      JOIN public.brands b ON b.id = v.brand_id AND b.deleted_at IS NULL
      WHERE v.place_pool_id = ANY(p_place_ids)
        AND v.claim_status = 'verified'
        AND NOT public.admin_brand_is_internal(b.id)
    ) x;
    RETURN QUERY SELECT (e->>'p')::uuid, e->'f' FROM jsonb_array_elements(v_all) e;
    RETURN;
  EXCEPTION WHEN OTHERS THEN
    NULL;  -- fall through: venue by venue
  END;
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


-- ---------------------------------------------------------------------------
-- 7. The Host Offers list (re-emitted from 20281203224490) carries each live
--    offer's guest "from" (W3 fix 2, W3-N16).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_4490_list_offers(p_venue_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.issue_4490_can_view_venue(p_venue_id) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'venueId', p_venue_id,
    'canCollectOnline', (SELECT public.issue_4490_can_collect_online(v.brand_id, v.id)
                         FROM public.venue_listings v WHERE v.id = p_venue_id),
    'flags', jsonb_build_object(
      'reads', public.issue_4490_flag_on('VENUE_OFFERS_READS'),
      'writes', public.issue_4490_flag_on('VENUE_OFFERS_WRITES')),
    'settings', (
      SELECT jsonb_build_object(
        'timezone', s.timezone, 'vatMode', s.vat_mode,
        'vatRateBps', (SELECT c.vat_rate_bps FROM public.venue_listings v
                       JOIN public.country_vat_config c ON c.country = upper(v.country_code)
                       WHERE v.id = p_venue_id),
        'instantPaymentHoldMinutes', s.instant_payment_hold_minutes,
        'bookingHorizonDays', s.booking_horizon_days,
        'bookingState', s.booking_state, 'version', s.version)
      FROM public.venue_booking_settings s WHERE s.venue_id = p_venue_id),
    'pools', COALESCE((
      SELECT jsonb_agg(public.issue_4490_pool_projection(p.id) ORDER BY p.created_at)
      FROM public.venue_capacity_pools p
      WHERE p.venue_id = p_venue_id AND p.archived_at IS NULL), '[]'::jsonb),
    'offers', COALESCE((
      -- #4490 fix round 1 (B6, N28): a read flag when the offer sells outside
      -- the venue's opening hours (the offer itself is never changed).
      -- W3 fix 2 (W3-N16): a live offer carries the "from" guests are shown
      -- (issue_4490_offer_from, the one owner), so the Host list and the
      -- guest page say one price.
      SELECT jsonb_agg(public.issue_4490_offer_projection(o.id) || public.issue_4490_offer_hours_check(o.id)
                       || jsonb_build_object('guestFrom',
                            CASE WHEN o.status = 'live' THEN public.issue_4490_offer_from(o.id) END)
                       ORDER BY o.sort_order, o.created_at)
      FROM public.stay_offerings o
      WHERE o.venue_id = p_venue_id AND o.kind NOT IN ('room', 'place', 'membership') AND o.status <> 'archived'), '[]'::jsonb)
  );
END;
$function$;

COMMIT;

-- Reverse (local use only): DROP FUNCTION public.pg_deck_venue_facts(uuid[]),
--   public.issue_4490_venue_card_facts(uuid),
--   public.issue_4490_venue_is_bookable(uuid),
--   public.issue_4490_venue_bookable_given(boolean, jsonb, jsonb, boolean);
--   re-apply issue_4490_venue_page_payload from 20281203194490; then
--   DROP FUNCTION public.issue_4490_venue_upcoming_events(uuid, timestamptz);
--   re-apply issue_4490_public_offers from 20281203144490,
--   issue_4490_public_memberships from 20281203194490 + the 374490/384490
--   patches, issue_4490_list_offers from 20281203224490, and
--   issue_4490_option_price_at, issue_4490_option_window_reason,
--   issue_4490_window_cutoff and issue_4490_day_closed from 20281203084490;
--   then DROP FUNCTION public.issue_4490_public_offer_prices(uuid, text[]),
--   public.issue_4490_public_live_offers(uuid, text[]),
--   public.issue_4490_offer_from(uuid),
--   public.issue_4490_offer_slot_prices(uuid, integer, boolean),
--   public.issue_4490_offer_day_open(uuid, uuid, date),
--   public.issue_4490_busy_price(jsonb, bigint, timestamp),
--   public.issue_4490_option_slot_reason(text, smallint[], time, time, date, timestamp),
--   public.issue_4490_slot_cutoff(text, text, timestamptz, timestamptz, integer).
