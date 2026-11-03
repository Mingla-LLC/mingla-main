-- Issue #4238 — Host ads: one ad promotes every date of a series.
--
-- Spec: https://github.com/Mingla-LLC/mingla-main/issues/4238#issuecomment-6604481937
--
-- Before this migration the dated-offering branch of ad_destination_resolve
-- (wave1 body, 20270814003697) treated the MASTER (first) date as "the start":
-- once the first date of a weekly event passed, the whole series read "ended",
-- dropped out of the Host picker, and the hourly pause guard
-- (admin-ad-spend-sync → resolveAdDestination → this RPC) would pause a live
-- ad an hour after date one. It also required rsvp_discoverable (the Explorer
-- feed switch, not "page is public"), never checked that anything was on sale,
-- ignored a trip's booking deadline, and excluded Unlisted events and RSVPs
-- whose link does open.
--
-- What this adds:
--   1. ad_offering_destination_by_id(event_id) — the ONE owner of the
--      dated-offering advertising rule (list, plan gates and pause guard).
--   2. ad_destination_resolve — same signature; dated types route to (1);
--      every other type still calls ad_destination_resolve_wave1, whose dated
--      branch is now unreachable through the wrapper.
--   3. ad_advertisable_pages — return type grows (next_date, last_bookable_at,
--      dates_remaining, timezone, ok), so DROP + CREATE. Dated candidates are
--      read from public.events (public + hidden; with include_unavailable on a
--      brand scope, every non-deleted offering so the Host sees why).
--
-- Rules (I-4238-AD-SERIES-ENDS-AT-LAST-BOOKABLE-DATE, I-4238-AD-SOMETHING-ON-SALE,
-- I-4238-AD-UNLISTED-FOLLOWS-THE-LINK — declared beside the pg17 test):
--   * A date is bookable until its end (event, RSVP, experience) or until it
--     starts (trip departure). Cancelled dates never count.
--   * Something must be buyable or RSVP-able now.
--   * Unlisted events/RSVPs open from their link (pg_direct_event_checkout_bundle,
--     pg_public_rsvp_by_slug admit 'hidden'); unlisted trips/experiences do not
--     (pg_public_trip_by_slug / pg_public_experience_by_slug use the 'listing'
--     visibility gate = public only).
--
-- Static SQL only. No conflict path; nothing raises 40001.
-- Do NOT auto-apply — reviewed path post-merge.

BEGIN;

-- ── 1. The dated-offering rule, by id ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ad_offering_destination_by_id(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_origin text := public.ad_public_web_origin();
  v_e record;
  v_page_type text;
  v_tz text;
  v_base jsonb;
  v_dates_remaining integer := 0;
  v_next timestamptz;
  v_last_date timestamptz;
  v_on_sale boolean := false;
  v_sale_end timestamptz;
  v_last_bookable timestamptz;
  v_going integer;
  v_avail text;
  v_reason text;
  v_url text;
BEGIN
  SELECT
    e.id, e.brand_id, e.slug, e.title, e.city, e.cover_media_url,
    e.event_type, e.status, e.visibility, e.timezone,
    e.booking_deadline, e.bookings_closed,
    e.rsvp_capacity, e.rsvp_waitlist_enabled, e.capacity_scope,
    b.slug AS brand_slug, b.name AS brand_name
  INTO v_e
  FROM public.events e
  JOIN public.brands b ON b.id = e.brand_id
  WHERE e.id = p_event_id
    AND e.deleted_at IS NULL
    AND b.deleted_at IS NULL
    AND e.event_type IN ('event', 'rsvp', 'trip', 'experience');

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'destination_not_public',
      'availability', 'draft',
      'availability_reason', 'admin.dest.draft'
    );
  END IF;

  v_page_type := v_e.event_type;
  SELECT coalesce(
    nullif(btrim(v_e.timezone), ''),
    (SELECT nullif(btrim(d.timezone), '') FROM public.event_dates d
      WHERE d.event_id = v_e.id AND d.is_master IS TRUE LIMIT 1),
    'UTC'
  ) INTO v_tz;

  v_base := jsonb_build_object(
    'page_type', v_page_type,
    'id', v_e.id,
    'brand_id', v_e.brand_id,
    'brand_slug', v_e.brand_slug,
    'entity_slug', v_e.slug,
    'event_id', v_e.id,
    'venue_id', NULL,
    'title', v_e.title,
    'brand_name', v_e.brand_name,
    'city', v_e.city,
    'cover_url', v_e.cover_media_url,
    'timezone', v_tz
  );

  -- Moderation read block: never advertisable.
  IF public.issue_1931_event_ordinary_read_blocked(v_e.id) THEN
    RETURN v_base || jsonb_build_object(
      'ok', false, 'code', 'destination_not_public',
      'availability', 'private', 'availability_reason', 'admin.dest.private'
    );
  END IF;

  IF v_e.status = 'draft' OR v_e.visibility = 'draft'
     OR v_e.slug IS NULL OR length(v_e.slug) > 200
     OR v_e.slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
     OR v_e.brand_slug IS NULL OR length(v_e.brand_slug) > 160
     OR v_e.brand_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' THEN
    RETURN v_base || jsonb_build_object(
      'ok', false, 'code', 'destination_not_public',
      'availability', 'draft', 'availability_reason', 'admin.dest.draft'
    );
  END IF;

  -- Unlisted trips/experiences do not open from their link ('listing' gate).
  IF v_e.visibility = 'hidden' AND v_page_type IN ('trip', 'experience') THEN
    RETURN v_base || jsonb_build_object(
      'ok', false, 'code', 'destination_unlisted_not_linkable',
      'availability', 'unlisted', 'availability_reason', 'admin.dest.unlisted'
    );
  END IF;

  IF v_e.visibility NOT IN ('public', 'hidden') THEN
    RETURN v_base || jsonb_build_object(
      'ok', false, 'code', 'destination_not_public',
      'availability', 'private', 'availability_reason', 'admin.dest.private'
    );
  END IF;

  IF v_e.status IN ('ended', 'cancelled') THEN
    RETURN v_base || jsonb_build_object(
      'ok', false, 'code', 'destination_ended',
      'availability', 'ended', 'availability_reason', 'admin.dest.ended'
    );
  END IF;

  IF v_e.status NOT IN ('scheduled', 'live') THEN
    RETURN v_base || jsonb_build_object(
      'ok', false, 'code', 'destination_not_public',
      'availability', 'draft', 'availability_reason', 'admin.dest.draft'
    );
  END IF;

  -- Bookable dates. A trip departure is bookable until it starts; every
  -- other date until it ends (ticket-checkout-create refuses end_at <= now()).
  -- NEVER the master (first) date alone: that ended whole series (#4238 R5).
  SELECT
    count(*)::integer,
    min(d.start_at),
    max(CASE WHEN v_page_type = 'trip' THEN d.start_at ELSE d.end_at END)
  INTO v_dates_remaining, v_next, v_last_date
  FROM public.event_dates d
  WHERE d.event_id = v_e.id
    AND d.cancelled_at IS NULL
    AND coalesce(d.status, 'active') = 'active'
    AND (CASE WHEN v_page_type = 'trip' THEN d.start_at ELSE d.end_at END) > now();

  IF coalesce(v_dates_remaining, 0) = 0 THEN
    RETURN v_base || jsonb_build_object(
      'ok', false, 'code', 'destination_ended',
      'availability', 'ended', 'availability_reason', 'admin.dest.ended',
      'dates_remaining', 0, 'next_date', NULL, 'last_bookable_at', NULL
    );
  END IF;

  IF v_page_type = 'trip' AND (
    v_e.bookings_closed IS TRUE
    OR (v_e.booking_deadline IS NOT NULL AND v_e.booking_deadline <= now())
  ) THEN
    RETURN v_base || jsonb_build_object(
      'ok', false, 'code', 'destination_bookings_closed',
      'availability', 'bookings_closed',
      'availability_reason', 'admin.dest.bookingsClosed',
      'dates_remaining', v_dates_remaining, 'next_date', v_next,
      'starts_at', v_next
    );
  END IF;

  -- Something to buy or RSVP to right now.
  IF v_page_type = 'rsvp' THEN
    SELECT coalesce(sum(1 + coalesce(r.plus_count, 0)), 0)::integer
    INTO v_going
    FROM public.event_rsvps r
    WHERE r.event_id = v_e.id
      AND r.rsvp_status = 'going'
      AND r.approval_status = 'approved';
    v_on_sale := v_e.rsvp_capacity IS NULL
      OR v_going < v_e.rsvp_capacity
      OR v_e.rsvp_waitlist_enabled IS TRUE;
    v_sale_end := NULL;
  ELSE
    WITH sellable AS (
      SELECT tt.id, tt.sale_end_at
      FROM public.ticket_types tt
      WHERE tt.event_id = v_e.id
        AND tt.deleted_at IS NULL
        AND coalesce(tt.is_hidden, false) IS NOT TRUE
        AND coalesce(tt.is_disabled, false) IS NOT TRUE
        AND coalesce(tt.available_online, true) IS NOT FALSE
        AND coalesce(tt.password_protected, false) IS NOT TRUE
        AND (tt.sale_start_at IS NULL OR tt.sale_start_at <= now())
        AND (tt.sale_end_at IS NULL OR tt.sale_end_at > now())
        AND (
          tt.valid_occurrence_keys IS NULL
          OR EXISTS (
            SELECT 1 FROM public.event_dates d
            WHERE d.event_id = v_e.id
              AND d.cancelled_at IS NULL
              AND coalesce(d.status, 'active') = 'active'
              AND (CASE WHEN v_page_type = 'trip' THEN d.start_at ELSE d.end_at END) > now()
              AND d.occurrence_key = ANY (tt.valid_occurrence_keys)
          )
        )
        AND (
          coalesce(tt.is_unlimited, false) IS TRUE
          OR tt.quantity_total IS NULL
          OR (v_page_type = 'experience'
              AND coalesce(v_e.capacity_scope, 'total') IN ('per_day', 'per_start'))
          OR (tt.valid_occurrence_keys IS NOT NULL
              AND coalesce(public.issue_3281_listed_remaining(tt.id), 0) > 0)
          OR (tt.valid_occurrence_keys IS NULL
              AND tt.quantity_total - (
                SELECT count(*)::integer FROM public.tickets t
                WHERE t.ticket_type_id = tt.id
                  AND t.status IN ('valid', 'used', 'transferred')
              ) > 0)
        )
    )
    SELECT
      count(*) > 0,
      CASE WHEN count(*) > 0 AND bool_and(s.sale_end_at IS NOT NULL)
        THEN max(s.sale_end_at) ELSE NULL END
    INTO v_on_sale, v_sale_end
    FROM sellable s;
  END IF;

  IF v_on_sale IS NOT TRUE THEN
    RETURN v_base || jsonb_build_object(
      'ok', false, 'code', 'destination_nothing_on_sale',
      'availability', 'nothing_on_sale',
      'availability_reason', 'admin.dest.nothingOnSale',
      'dates_remaining', v_dates_remaining, 'next_date', v_next,
      'starts_at', v_next
    );
  END IF;

  -- The last moment anyone can still book (I-4238-AD-ENDS-BY-LAST-BOOKABLE-MOMENT).
  v_last_bookable := LEAST(
    v_last_date,
    v_sale_end,
    CASE WHEN v_page_type = 'trip' THEN v_e.booking_deadline ELSE NULL END
  );

  IF v_last_bookable < now() + interval '48 hours' THEN
    v_avail := 'soon';
    v_reason := 'admin.dest.soon';
  ELSE
    v_avail := 'available';
    v_reason := NULL;
  END IF;

  v_url := CASE v_page_type
    WHEN 'trip' THEN v_origin || '/t/' || v_e.brand_slug || '/' || v_e.slug
    WHEN 'experience' THEN v_origin || '/exp/' || v_e.brand_slug || '/' || v_e.slug
    ELSE v_origin || '/e/' || v_e.brand_slug || '/' || v_e.slug
  END;

  RETURN v_base || jsonb_build_object(
    'ok', true,
    'starts_at', v_next,
    'next_date', v_next,
    'dates_remaining', v_dates_remaining,
    'last_bookable_at', v_last_bookable,
    'canonical_url', v_url,
    'availability', v_avail,
    'availability_reason', v_reason,
    'result_kind', CASE WHEN v_page_type = 'rsvp' THEN 'signups' ELSE 'tickets' END
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.ad_offering_destination_by_id(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ad_offering_destination_by_id(uuid)
  TO service_role;

COMMENT ON FUNCTION public.ad_offering_destination_by_id(uuid) IS
  'issue #4238 — the one owner of the dated-offering ad rule: advertisable while a date '
  'can still be booked and something is on sale; unlisted events/RSVPs yes, unlisted '
  'trips/experiences no. Returns next_date, last_bookable_at, dates_remaining, timezone.';

-- ── 2. Resolve wrapper: marketing + dated by id + wave1 for the rest ────────
CREATE OR REPLACE FUNCTION public.ad_destination_resolve(
  p_page_type text,
  p_brand_slug text,
  p_entity_slug text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_origin text := public.ad_marketing_web_origin();
  v_brand text := lower(btrim(coalesce(p_brand_slug, '')));
  v_entity text := lower(btrim(coalesce(p_entity_slug, '')));
  v_route record;
  v_url text;
  v_event_id uuid;
BEGIN
  IF p_page_type = 'marketing' THEN
    IF v_brand <> '' AND v_brand <> 'mingla' THEN
      RETURN jsonb_build_object(
        'ok', false,
        'code', 'destination_brand_slug_invalid',
        'page_type', 'marketing',
        'availability', 'draft',
        'availability_reason', 'admin.dest.draft'
      );
    END IF;
    IF v_entity = '' THEN
      RETURN jsonb_build_object(
        'ok', false,
        'code', 'destination_entity_slug_required',
        'page_type', 'marketing',
        'availability', 'draft',
        'availability_reason', 'admin.dest.draft'
      );
    END IF;
    SELECT r.* INTO v_route
    FROM public.ad_marketing_route_rows() r
    WHERE r.entity_slug = v_entity
    LIMIT 1;
    IF NOT FOUND THEN
      RETURN jsonb_build_object(
        'ok', false,
        'code', 'destination_not_public',
        'page_type', 'marketing',
        'brand_slug', 'mingla',
        'entity_slug', v_entity,
        'availability', 'draft',
        'availability_reason', 'admin.dest.draft'
      );
    END IF;
    v_url := CASE
      WHEN v_route.path = '/' THEN v_origin || '/'
      ELSE v_origin || v_route.path
    END;
    RETURN jsonb_build_object(
      'ok', true,
      'page_type', 'marketing',
      'id', v_route.id,
      'brand_id', NULL,
      'brand_slug', 'mingla',
      'entity_slug', v_route.entity_slug,
      'event_id', NULL,
      'venue_id', NULL,
      'title', v_route.title,
      'brand_name', 'Mingla',
      'starts_at', NULL,
      'city', NULL,
      'cover_url', NULL,
      'canonical_url', v_url,
      'availability', 'available',
      'availability_reason', NULL,
      'result_kind', v_route.result_kind
    );
  END IF;

  -- issue #4238 — dated offerings resolve through ad_offering_destination_by_id.
  -- The first date passing must never end a series (the pause guard reads this).
  IF p_page_type IN ('event', 'rsvp', 'trip', 'experience') THEN
    IF v_brand = '' OR length(v_brand) > 160
       OR v_brand !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' THEN
      RETURN jsonb_build_object(
        'ok', false,
        'code', 'destination_brand_slug_invalid',
        'page_type', p_page_type,
        'availability', 'draft',
        'availability_reason', 'admin.dest.draft'
      );
    END IF;
    IF v_entity = '' OR length(v_entity) > 200
       OR v_entity !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' THEN
      RETURN jsonb_build_object(
        'ok', false,
        'code', 'destination_entity_slug_invalid',
        'page_type', p_page_type,
        'availability', 'draft',
        'availability_reason', 'admin.dest.draft'
      );
    END IF;
    SELECT e.id INTO v_event_id
    FROM public.events e
    JOIN public.brands b ON b.id = e.brand_id
    WHERE b.slug = v_brand
      AND e.slug = v_entity
      AND e.event_type = p_page_type
      AND e.deleted_at IS NULL
      AND b.deleted_at IS NULL
    ORDER BY (e.visibility = 'public') DESC, (e.visibility = 'hidden') DESC, e.created_at
    LIMIT 1;
    IF v_event_id IS NULL THEN
      RETURN jsonb_build_object(
        'ok', false,
        'code', 'destination_not_public',
        'page_type', p_page_type,
        'availability', 'draft',
        'availability_reason', 'admin.dest.draft'
      );
    END IF;
    RETURN public.ad_offering_destination_by_id(v_event_id)
      || jsonb_build_object('page_type', p_page_type);
  END IF;

  RETURN public.ad_destination_resolve_wave1(p_page_type, p_brand_slug, p_entity_slug);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.ad_destination_resolve(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ad_destination_resolve(text, text, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.ad_destination_resolve(text, text, text) IS
  '#3697 Wave 4 wrap + issue #4238: marketing allowlist; dated offerings via '
  'ad_offering_destination_by_id (series end at the last bookable date); every '
  'other type via ad_destination_resolve_wave1 (whose dated branch is unreachable here).';

-- ── 3. List: dated candidates from events; new schedule columns ─────────────
DROP FUNCTION IF EXISTS public.ad_advertisable_pages(text, text[], boolean, uuid, integer);

CREATE FUNCTION public.ad_advertisable_pages(
  p_query text DEFAULT NULL,
  p_types text[] DEFAULT NULL,
  p_include_unavailable boolean DEFAULT false,
  p_brand_id uuid DEFAULT NULL,
  p_page integer DEFAULT 0
)
RETURNS TABLE (
  page_type text,
  id uuid,
  brand_slug text,
  entity_slug text,
  title text,
  brand_name text,
  starts_at timestamptz,
  city text,
  cover_url text,
  canonical_url text,
  availability text,
  availability_reason text,
  result_kind text,
  total_count bigint,
  next_date timestamptz,
  last_bookable_at timestamptz,
  dates_remaining integer,
  timezone text,
  ok boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_page integer := greatest(coalesce(p_page, 0), 0);
  v_page_size integer := 24;
  v_q text := nullif(btrim(coalesce(p_query, '')), '');
  v_like text;
  v_types text[];
  v_is_admin boolean := public.is_admin_user();
  v_brand_member boolean := false;
BEGIN
  IF p_brand_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.brand_team_members m
      WHERE m.brand_id = p_brand_id
        AND m.user_id = auth.uid()
        AND m.accepted_at IS NOT NULL
        AND m.removed_at IS NULL
    ) INTO v_brand_member;
  END IF;

  IF NOT v_is_admin AND NOT (p_brand_id IS NOT NULL AND v_brand_member) THEN
    RAISE EXCEPTION 'ad_advertisable_forbidden' USING ERRCODE = '42501';
  END IF;

  IF p_types IS NULL OR cardinality(p_types) = 0 THEN
    v_types := ARRAY[
      'event', 'rsvp', 'trip', 'experience', 'brand', 'venue', 'reservation',
      'site', 'marketing'
    ];
  ELSE
    v_types := p_types;
  END IF;

  IF v_q IS NOT NULL THEN
    v_like := '%' || public.ad_escape_ilike(v_q) || '%';
  END IF;

  RETURN QUERY
  WITH dated AS (
    -- issue #4238: public AND unlisted offerings are candidates (an unlisted
    -- event's link opens; the rule decides trips/experiences). With
    -- include_unavailable on a brand scope, every offering so the Host sees why.
    SELECT e.id, e.event_type AS page_type, e.title, b.name AS brand_name,
           b.slug AS brand_slug, e.slug AS entity_slug, e.city,
           e.cover_media_url AS cover_url
    FROM public.events e
    JOIN public.brands b ON b.id = e.brand_id
    WHERE e.deleted_at IS NULL
      AND b.deleted_at IS NULL
      AND e.event_type IN ('event', 'rsvp', 'trip', 'experience')
      AND e.event_type = ANY (v_types)
      AND (p_brand_id IS NULL OR e.brand_id = p_brand_id)
      AND NOT public.issue_1931_event_ordinary_read_blocked(e.id)
      AND (
        e.visibility IN ('public', 'hidden')
        OR (p_include_unavailable AND p_brand_id IS NOT NULL)
      )
      AND (
        v_like IS NULL
        OR e.title ILIKE v_like ESCAPE '\'
        OR b.name ILIKE v_like ESCAPE '\'
        OR coalesce(e.slug, '') ILIKE v_like ESCAPE '\'
        OR coalesce(e.city, '') ILIKE v_like ESCAPE '\'
        OR b.slug ILIKE v_like ESCAPE '\'
      )
  ),
  others AS (
    SELECT
      'brand'::text AS page_type, b.id, b.slug AS brand_slug, NULL::text AS entity_slug,
      b.name AS title, b.name AS brand_name, NULL::text AS city,
      b.profile_photo_url AS cover_url
    FROM public.business_public_brands_view b
    WHERE (p_brand_id IS NULL OR b.id = p_brand_id)
      AND (
        v_like IS NULL
        OR b.name ILIKE v_like ESCAPE '\'
        OR b.slug ILIKE v_like ESCAPE '\'
      )

    UNION ALL

    SELECT
      'venue', s.id, s.brand_slug, s.slug, s.title, s.brand_name, s.city,
      s.cover_media_url
    FROM public.ad_public_stay_destinations_view s
    WHERE (p_brand_id IS NULL OR s.brand_id = p_brand_id)
      AND (
        v_like IS NULL
        OR s.title ILIKE v_like ESCAPE '\'
        OR s.brand_name ILIKE v_like ESCAPE '\'
        OR s.slug ILIKE v_like ESCAPE '\'
        OR coalesce(s.city, '') ILIKE v_like ESCAPE '\'
        OR s.brand_slug ILIKE v_like ESCAPE '\'
      )

    UNION ALL

    SELECT
      'reservation', s.id, s.brand_slug, s.slug, s.title, s.brand_name, s.city,
      s.cover_media_url
    FROM public.ad_public_stay_destinations_view s
    WHERE (p_brand_id IS NULL OR s.brand_id = p_brand_id)
      AND EXISTS (
        SELECT 1 FROM public.venue_reservation_settings vrs
        WHERE vrs.venue_id = s.id AND vrs.reservations_enabled IS TRUE
      )
      AND (
        v_like IS NULL
        OR s.title ILIKE v_like ESCAPE '\'
        OR s.brand_name ILIKE v_like ESCAPE '\'
        OR s.slug ILIKE v_like ESCAPE '\'
        OR coalesce(s.city, '') ILIKE v_like ESCAPE '\'
        OR s.brand_slug ILIKE v_like ESCAPE '\'
      )

    UNION ALL

    SELECT
      'site', site.id, site.brand_slug, NULL::text, site.brand_name,
      site.brand_name, NULL::text, NULL::text
    FROM public.ad_public_site_destinations_view site
    WHERE (p_brand_id IS NULL OR site.brand_id = p_brand_id)
      AND (
        v_like IS NULL
        OR site.brand_name ILIKE v_like ESCAPE '\'
        OR site.brand_slug ILIKE v_like ESCAPE '\'
      )

    UNION ALL

    SELECT
      'marketing', r.id, 'mingla', r.entity_slug, r.title, 'Mingla',
      NULL::text, NULL::text
    FROM public.ad_marketing_route_rows() r
    WHERE p_brand_id IS NULL
      AND (
        v_like IS NULL
        OR r.title ILIKE v_like ESCAPE '\'
        OR r.entity_slug ILIKE v_like ESCAPE '\'
        OR r.path ILIKE v_like ESCAPE '\'
      )
  ),
  resolved AS (
    SELECT d.page_type AS c_page_type, d.id AS c_id, d.brand_slug AS c_brand_slug,
           d.entity_slug AS c_entity_slug, d.title AS c_title,
           d.brand_name AS c_brand_name, d.city AS c_city, d.cover_url AS c_cover_url,
           public.ad_offering_destination_by_id(d.id) AS j
    FROM dated d
    UNION ALL
    SELECT o.page_type, o.id, o.brand_slug, o.entity_slug, o.title, o.brand_name,
           o.city, o.cover_url,
           public.ad_destination_resolve(o.page_type, o.brand_slug, o.entity_slug)
    FROM others o
    WHERE o.page_type = ANY (v_types)
  ),
  filtered AS (
    SELECT
      r.c_page_type AS f_page_type,
      coalesce((nullif(r.j ->> 'id', ''))::uuid, r.c_id) AS f_id,
      coalesce(nullif(r.j ->> 'brand_slug', ''), r.c_brand_slug) AS f_brand_slug,
      coalesce(nullif(r.j ->> 'entity_slug', ''), r.c_entity_slug) AS f_entity_slug,
      coalesce(nullif(r.j ->> 'title', ''), r.c_title) AS f_title,
      coalesce(nullif(r.j ->> 'brand_name', ''), r.c_brand_name) AS f_brand_name,
      (nullif(r.j ->> 'starts_at', ''))::timestamptz AS f_starts_at,
      coalesce(nullif(r.j ->> 'city', ''), r.c_city) AS f_city,
      coalesce(nullif(r.j ->> 'cover_url', ''), r.c_cover_url) AS f_cover_url,
      nullif(r.j ->> 'canonical_url', '') AS f_canonical_url,
      coalesce(nullif(r.j ->> 'availability', ''), 'draft') AS f_availability,
      nullif(r.j ->> 'availability_reason', '') AS f_availability_reason,
      nullif(r.j ->> 'result_kind', '') AS f_result_kind,
      (nullif(r.j ->> 'next_date', ''))::timestamptz AS f_next_date,
      (nullif(r.j ->> 'last_bookable_at', ''))::timestamptz AS f_last_bookable_at,
      (nullif(r.j ->> 'dates_remaining', ''))::integer AS f_dates_remaining,
      nullif(r.j ->> 'timezone', '') AS f_timezone,
      coalesce((r.j ->> 'ok')::boolean, false) AS f_ok
    FROM resolved r
    WHERE p_include_unavailable
       OR coalesce((r.j ->> 'ok')::boolean, false) IS TRUE
  ),
  counted AS (
    SELECT count(*)::bigint AS n FROM filtered
  )
  SELECT
    f.f_page_type,
    f.f_id,
    f.f_brand_slug,
    f.f_entity_slug,
    f.f_title,
    f.f_brand_name,
    f.f_starts_at,
    f.f_city,
    f.f_cover_url,
    f.f_canonical_url,
    f.f_availability,
    f.f_availability_reason,
    f.f_result_kind,
    c.n,
    f.f_next_date,
    f.f_last_bookable_at,
    f.f_dates_remaining,
    f.f_timezone,
    f.f_ok
  FROM filtered f
  CROSS JOIN counted c
  ORDER BY
    CASE WHEN f.f_ok THEN 0 ELSE 1 END,
    f.f_starts_at NULLS LAST,
    f.f_title ASC,
    f.f_id
  LIMIT v_page_size
  OFFSET v_page * v_page_size;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.ad_advertisable_pages(text, text[], boolean, uuid, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ad_advertisable_pages(text, text[], boolean, uuid, integer)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.ad_advertisable_pages(text, text[], boolean, uuid, integer) IS
  '#3697 Wave 4 B1 + issue #4238: unified advertisable page list. Dated offerings '
  '(public + unlisted) resolve by id with next_date / last_bookable_at / dates_remaining.';

COMMIT;
