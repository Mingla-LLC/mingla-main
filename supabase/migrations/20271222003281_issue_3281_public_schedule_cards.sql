-- issue #3281 PR7 — cards / share / admin schedule fields.
-- Adds issue_3281_event_schedule helper and appends schedule keys to
-- business_public_events_view, discover_v2_event_base, and admin list/get.
-- (#3081 filtered replay may flag the view append — accepted for this PR;
-- filtered lanes skip this file by exact filename.)

BEGIN;

-- Human schedule line for cards (server clock). Keeps nextStartAt/nextEndAt ISO.
CREATE OR REPLACE FUNCTION public.issue_3281_event_schedule(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_next_start timestamptz;
  v_next_end timestamptz;
  v_upcoming integer := 0;
  v_tz text;
  v_chip text;
BEGIN
  -- Used by DEFINER readers (admin/discover/direct bundle). The anon public view
  -- inlines the same math — this helper is NOT granted to anon.
  SELECT NULLIF(btrim(e.timezone), '') INTO v_tz
    FROM public.events e
   WHERE e.id = p_event_id;

  SELECT count(*)::integer
    INTO v_upcoming
    FROM public.event_dates d
   WHERE d.event_id = p_event_id
     AND d.end_at > now();

  SELECT d.start_at, d.end_at
    INTO v_next_start, v_next_end
    FROM public.event_dates d
   WHERE d.event_id = p_event_id
     AND d.end_at > now()
   ORDER BY d.start_at, d.id
   LIMIT 1;

  IF v_next_start IS NOT NULL THEN
    v_chip := to_char(
      v_next_start AT TIME ZONE COALESCE(v_tz, 'UTC'),
      'Dy DD Mon'
    );
  END IF;

  RETURN jsonb_build_object(
    'nextStartAt', v_next_start,
    'nextEndAt', v_next_end,
    'upcomingCount', COALESCE(v_upcoming, 0),
    'scheduleLine', CASE
      WHEN v_upcoming IS NULL OR v_upcoming = 0 THEN NULL
      WHEN v_upcoming = 1 THEN v_chip
      ELSE format('%s · +%s more', v_chip, v_upcoming - 1)
    END
  );
END;
$fn$;

-- DEFINER readers only (admin / discover / direct bundle). Not anon-callable.
REVOKE ALL ON FUNCTION public.issue_3281_event_schedule(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3281_event_schedule(uuid)
  TO service_role;

COMMENT ON FUNCTION public.issue_3281_event_schedule(uuid) IS
  'issue #3281 many-dates — next upcoming occurrence + scheduleLine for DEFINER readers.';

-- Public card read model: schedule columns for Connections / seed / brand pages.
-- Schedule math is inlined (not via issue_3281_event_schedule) so anon never
-- needs EXECUTE on a SECURITY DEFINER helper.
CREATE OR REPLACE VIEW public.business_public_events_view WITH (security_invoker = false) AS
SELECT e.id,e.brand_id,b.slug AS brand_slug,b.name AS brand_name,b.description AS brand_description,
  b.profile_photo_url AS brand_profile_photo_url,b.display_attendee_count AS brand_display_attendee_count,
  b.address AS brand_address,b.cover_media_url AS brand_cover_media_url,b.theme_color AS brand_theme_color,
  b.theme_font AS brand_theme_font,b.theme_animation AS brand_theme_animation,e.title,e.description,e.slug,
  e.event_type,CASE WHEN public.issue_2489_address_withheld(e.theme) THEN NULL ELSE e.location_text END AS location_text,
  e.online_url,e.is_online,e.is_recurring,e.is_multi_date,e.recurrence_rules,e.cover_media_url,e.cover_media_type,
  e.visibility,e.show_on_discover,e.status,e.published_at,e.timezone,e.created_at,e.updated_at,
  public.issue_2489_public_theme(e.theme) AS public_theme,e.theme_color_override,e.theme_font_override,
  e.theme_animation_override,e.currency,e.cover_media_provider,e.cover_media_source_url,e.cover_media_credit,
  e.cover_media_credit_url,e.cover_media_alt,ed.start_at AS master_start_at,ed.end_at AS master_end_at,
  ed.timezone AS master_timezone,ed.id AS master_event_date_id,e.city,e.party_types,e.vibe_tags,e.music_genres,
  CASE WHEN public.issue_2489_address_withheld(e.theme) THEN NULL ELSE e.location_geo END AS location_geo,
  COALESCE(e.pass_tax,b.default_pass_tax) AS pass_tax,
  COALESCE(e.pass_mingla_fee,b.default_pass_mingla_fee) AS pass_mingla_fee,
  COALESCE(e.pass_service_fee,b.default_pass_service_fee) AS pass_service_fee,
  b.pricing_region,b.pricing_currency,(e.pricing_locked_at IS NOT NULL) AS pricing_locked,
  (SELECT d.display_price_cents
     FROM public.pg_public_event_display_prices(ARRAY[e.id]) d
    WHERE d.event_id=e.id) AS display_price_cents,
  e.rsvp_discoverable,e.rsvp_capacity,e.rsvp_allow_plus_ones,e.rsvp_plus_ones_max,e.rsvp_waitlist_enabled,
  e.rsvp_approval_mode,
  CASE WHEN public.issue_3827_private_guest_list(e.theme) THEN NULL::integer ELSE (
    SELECT COALESCE(sum(1+r.plus_count),0)::integer FROM public.event_rsvps r
     WHERE r.event_id=e.id AND r.rsvp_status='going' AND r.approval_status='approved'
  ) END AS rsvp_going_count,
  e.city_geo,e.rsvp_contribution_enabled,e.rsvp_contribution_suggested_cents,e.rsvp_contribution_min_cents,
  e.cover_media_gallery,
  sched.next_start_at,
  sched.next_end_at,
  sched.upcoming_count,
  sched.schedule_line
FROM public.events e
JOIN public.brands b ON b.id=e.brand_id
LEFT JOIN public.event_dates ed ON ed.event_id=e.id AND ed.is_master=true
LEFT JOIN LATERAL (
  SELECT
    n.start_at AS next_start_at,
    n.end_at AS next_end_at,
    COALESCE(c.upcoming_count, 0) AS upcoming_count,
    CASE
      WHEN COALESCE(c.upcoming_count, 0) = 0 THEN NULL
      WHEN c.upcoming_count = 1 THEN to_char(
        n.start_at AT TIME ZONE COALESCE(NULLIF(btrim(e.timezone), ''), 'UTC'), 'Dy DD Mon')
      ELSE format(
        '%s · +%s more',
        to_char(n.start_at AT TIME ZONE COALESCE(NULLIF(btrim(e.timezone), ''), 'UTC'), 'Dy DD Mon'),
        c.upcoming_count - 1)
    END AS schedule_line
  FROM (
    SELECT count(*)::integer AS upcoming_count
      FROM public.event_dates d
     WHERE d.event_id = e.id AND d.end_at > now()
  ) c
  LEFT JOIN LATERAL (
    SELECT d.start_at, d.end_at
      FROM public.event_dates d
     WHERE d.event_id = e.id AND d.end_at > now()
     ORDER BY d.start_at, d.id
     LIMIT 1
  ) n ON true
) sched ON true
WHERE e.deleted_at IS NULL AND b.deleted_at IS NULL AND e.visibility='public'
  AND e.status=ANY(ARRAY['scheduled','live','ended','cancelled'])
  AND NOT public.issue_1931_event_ordinary_read_blocked(e.id);

COMMENT ON VIEW public.business_public_events_view IS
  '#2489 — anon-readable public offering read model. location_text, location_geo and the '
  'theme''s business_event.location.address are withheld whenever '
  'issue_2489_address_withheld(theme) is true. city_geo is exempt by design. Do not '
  're-emit this view without the gate, and do not re-implement the predicate inline. '
  'issue #3827 — rsvp_going_count is NULL when the guest list is private (never 0). '
  'issue #3281 PR7 — next_start_at / next_end_at / upcoming_count / schedule_line inlined '
  'from event_dates (server clock); helper stays service_role-only.';
-- Discover base: append schedule keys (master_* stay the windowed next occurrence).
CREATE OR REPLACE FUNCTION public.discover_v2_event_base(
  p_cities text[], p_lower_bound timestamptz, p_upper_start timestamptz DEFAULT NULL,
  p_party_types text[] DEFAULT NULL, p_vibe_tags text[] DEFAULT NULL,
  p_music_genres text[] DEFAULT NULL, p_center_lng float8 DEFAULT NULL,
  p_center_lat float8 DEFAULT NULL, p_radius_km float8 DEFAULT NULL
) RETURNS SETOF jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
  SELECT jsonb_build_object(
    'id',e.id,'brand_id',e.brand_id,'title',e.title,'description',e.description,'slug',e.slug,
    'location_text',CASE WHEN public.issue_2489_address_withheld(e.theme) THEN NULL ELSE e.location_text END,
    'location_geo',CASE WHEN public.issue_2489_address_withheld(e.theme) THEN NULL ELSE to_jsonb(e.location_geo) END,
    'online_url',e.online_url,'is_online',e.is_online,'cover_media_url',e.cover_media_url,
    'cover_media_type',e.cover_media_type,'theme',public.issue_2489_public_theme(e.theme),
    'timezone',e.timezone,'currency',e.currency,'city',e.city,'party_types',to_jsonb(e.party_types),
    'vibe_tags',to_jsonb(e.vibe_tags),'music_genres',to_jsonb(e.music_genres),'event_type',e.event_type,
    'brand_slug',b.slug,'brand_name',b.name,'brand_profile_photo_url',b.profile_photo_url,
    'master_start_at',ed.start_at,'master_end_at',ed.end_at,'master_timezone',ed.timezone,
    -- Window-selected occurrence is the card timestamp authority (#3281 PR7).
    -- Do NOT call issue_3281_event_schedule here: this base feeds eligibility,
    -- facets, and counts before pagination (same page-only rule as admin_list).
    'next_start_at',ed.start_at,
    'next_end_at',ed.end_at,
    'upcoming_count',NULL,
    'schedule_line',NULL,
    'price_min_cents',(SELECT min(tt.price_cents) FROM public.ticket_types tt
      WHERE tt.event_id=e.id AND tt.deleted_at IS NULL AND tt.is_hidden IS NOT TRUE
        AND tt.is_disabled IS NOT TRUE AND tt.price_cents IS NOT NULL),
    'price_max_cents',(SELECT max(tt.price_cents) FROM public.ticket_types tt
      WHERE tt.event_id=e.id AND tt.deleted_at IS NULL AND tt.is_hidden IS NOT TRUE
        AND tt.is_disabled IS NOT TRUE AND tt.price_cents IS NOT NULL),
    'display_price_cents',public.discover_v2_from_price_minor(e.id),
    'pricing_currency',b.pricing_currency
  )
  FROM public.events e
  JOIN public.brands b ON b.id=e.brand_id AND b.deleted_at IS NULL
  JOIN public.event_dates master_ed ON master_ed.event_id=e.id
    AND master_ed.is_master IS TRUE
  JOIN LATERAL (
    SELECT occurrence.start_at,occurrence.end_at,occurrence.timezone
    FROM public.event_dates occurrence
    WHERE occurrence.event_id=e.id AND occurrence.end_at>=p_lower_bound
      AND (p_upper_start IS NULL OR occurrence.start_at<=p_upper_start)
    ORDER BY occurrence.start_at,occurrence.id LIMIT 1
  ) ed ON true
  WHERE e.deleted_at IS NULL
    AND e.visibility='public'
    AND (e.event_type='event' OR (e.event_type='rsvp' AND e.rsvp_discoverable=true))
    AND e.status=ANY(ARRAY['scheduled','live'])
    AND NOT public.issue_1931_event_ordinary_read_blocked(e.id)
    AND (
      e.city=ANY(p_cities)
      OR (p_center_lng IS NOT NULL AND p_center_lat IS NOT NULL AND p_radius_km IS NOT NULL
        AND e.location_geo IS NOT NULL AND public.ST_DWithin(
          public.ST_SetSRID(e.location_geo::public.geometry,4326)::public.geography,
          public.ST_SetSRID(public.ST_MakePoint(p_center_lng,p_center_lat),4326)::public.geography,
          p_radius_km*1000))
      OR (e.is_online IS TRUE AND lower(btrim(COALESCE(e.theme->'business_event'->>'format',''),
        E' \t\n\r\f\v'||chr(160)))='online')
    )
    AND (p_party_types IS NULL OR cardinality(p_party_types)=0 OR e.party_types && p_party_types)
    AND (p_vibe_tags IS NULL OR cardinality(p_vibe_tags)=0 OR e.vibe_tags && p_vibe_tags)
    AND (p_music_genres IS NULL OR cardinality(p_music_genres)=0 OR e.music_genres && p_music_genres)
    AND NOT (
      EXISTS (SELECT 1 FROM public.ticket_types tt WHERE tt.event_id=e.id
        AND tt.deleted_at IS NULL AND tt.is_hidden IS NOT TRUE AND tt.is_disabled IS NOT TRUE
        AND tt.available_online IS TRUE AND tt.price_cents>0)
      AND NOT public.pg_brand_can_collect(e.brand_id)
    )
$function$;

-- Admin list: display + sort by next occurrence; full schedule helper only
-- on the page rows (count / filter / rank stay free of schedule enrichment).
CREATE OR REPLACE FUNCTION public.admin_list_offerings(
  p_search          text        DEFAULT NULL,
  p_event_type      text        DEFAULT NULL,
  p_status          text        DEFAULT NULL,
  p_visibility      text        DEFAULT NULL,
  p_lifecycle       text        DEFAULT NULL,
  p_brand_id        uuid        DEFAULT NULL,
  p_date_from       timestamptz DEFAULT NULL,
  p_date_to         timestamptz DEFAULT NULL,
  p_include_deleted boolean     DEFAULT false,
  p_sort            text        DEFAULT 'start_at',
  p_sort_dir        text        DEFAULT 'desc',
  p_limit           int         DEFAULT 25,
  p_offset          int         DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_sort  text;
  v_dir   text;
  v_total bigint;
  v_rows  jsonb;
  v_limit int := LEAST(GREATEST(COALESCE(p_limit, 25), 1), 200);
  v_offset int := GREATEST(COALESCE(p_offset, 0), 0);
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;

  v_sort := CASE lower(COALESCE(p_sort, 'start_at'))
              WHEN 'created_at' THEN 'created_at'
              WHEN 'title'      THEN 'title'
              WHEN 'status'     THEN 'status'
              ELSE 'start_at'
            END;
  v_dir  := CASE lower(COALESCE(p_sort_dir, 'desc')) WHEN 'asc' THEN 'asc' ELSE 'desc' END;

  WITH base AS (
    SELECT
      e.id, e.event_type, e.title, e.slug, e.status, e.visibility, e.brand_id,
      e.city, e.currency, e.published_at, e.deleted_at, e.created_at,
      m.start_at AS master_start_at,
      m.end_at   AS master_end_at,
      -- Lightweight next-start for sort/display alignment only (no schedule_line).
      (
        SELECT d.start_at
          FROM public.event_dates d
         WHERE d.event_id = e.id AND d.end_at > now()
         ORDER BY d.start_at, d.id
         LIMIT 1
      ) AS next_start_at_sort,
      b.name     AS brand_name,
      CASE
        WHEN e.status = 'cancelled' THEN 'cancelled'
        WHEN e.status = 'draft'     THEN 'draft'
        WHEN e.status = 'ended'     THEN 'past'
        WHEN m.start_at IS NULL     THEN 'upcoming'
        WHEN now() >= m.start_at - interval '4 hours'
         AND now() <  m.start_at + interval '24 hours' THEN 'live'
        WHEN now() <  m.start_at - interval '4 hours' THEN 'upcoming'
        ELSE 'past'
      END AS lifecycle_bucket
    FROM public.events e
    LEFT JOIN public.event_dates m ON m.event_id = e.id AND m.is_master
    LEFT JOIN public.brands b ON b.id = e.brand_id
  ),
  filtered AS (
    SELECT * FROM base
    WHERE (p_include_deleted OR deleted_at IS NULL)
      AND (p_event_type IS NULL OR event_type = p_event_type)
      AND (p_status IS NULL OR status = p_status)
      AND (p_visibility IS NULL OR visibility = p_visibility)
      AND (p_lifecycle IS NULL OR lifecycle_bucket = p_lifecycle)
      AND (p_brand_id IS NULL OR brand_id = p_brand_id)
      AND (p_date_from IS NULL OR COALESCE(next_start_at_sort, master_start_at) >= p_date_from)
      AND (p_date_to IS NULL OR COALESCE(next_start_at_sort, master_start_at) <= p_date_to)
      AND (
        p_search IS NULL OR btrim(p_search) = '' OR
        title      ILIKE '%' || p_search || '%' OR
        brand_name ILIKE '%' || p_search || '%' OR
        city       ILIKE '%' || p_search || '%' OR
        slug       ILIKE '%' || p_search || '%'
      )
  ),
  ranked AS (
    SELECT f.*, row_number() OVER (
      ORDER BY
        (CASE WHEN v_sort = 'start_at'   AND v_dir = 'asc'
          THEN COALESCE(next_start_at_sort, master_start_at) END) ASC  NULLS LAST,
        (CASE WHEN v_sort = 'start_at'   AND v_dir = 'desc'
          THEN COALESCE(next_start_at_sort, master_start_at) END) DESC NULLS LAST,
        (CASE WHEN v_sort = 'created_at' AND v_dir = 'asc'  THEN created_at END)      ASC  NULLS LAST,
        (CASE WHEN v_sort = 'created_at' AND v_dir = 'desc' THEN created_at END)      DESC NULLS LAST,
        (CASE WHEN v_sort = 'title'      AND v_dir = 'asc'  THEN title END)           ASC  NULLS LAST,
        (CASE WHEN v_sort = 'title'      AND v_dir = 'desc' THEN title END)           DESC NULLS LAST,
        (CASE WHEN v_sort = 'status'     AND v_dir = 'asc'  THEN status END)          ASC  NULLS LAST,
        (CASE WHEN v_sort = 'status'     AND v_dir = 'desc' THEN status END)          DESC NULLS LAST,
        created_at DESC, id
    ) AS rn
    FROM filtered f
  ),
  page AS (
    SELECT
      r.*,
      public.issue_3281_event_schedule(r.id) AS schedule
    FROM ranked r
    WHERE r.rn > v_offset AND r.rn <= v_offset + v_limit
  )
  SELECT
    (SELECT count(*) FROM filtered),
    COALESCE(jsonb_agg(
      jsonb_build_object(
        'id',               p.id,
        'event_type',       p.event_type,
        'title',            p.title,
        'slug',             p.slug,
        'status',           p.status,
        'visibility',       p.visibility,
        'lifecycle_bucket', p.lifecycle_bucket,
        'brand_id',         p.brand_id,
        'brand_name',       p.brand_name,
        'city',             p.city,
        'currency',         p.currency,
        'master_start_at',  p.master_start_at,
        'master_end_at',    p.master_end_at,
        'next_start_at',    (p.schedule->>'nextStartAt')::timestamptz,
        'next_end_at',      (p.schedule->>'nextEndAt')::timestamptz,
        'upcoming_count',   COALESCE((p.schedule->>'upcomingCount')::integer, 0),
        'schedule_line',    p.schedule->>'scheduleLine',
        'published_at',     p.published_at,
        'deleted_at',       p.deleted_at,
        'created_at',       p.created_at,
        'attendee_count', (
          SELECT count(*) FROM public.tickets tk
          JOIN public.orders o ON o.id = tk.order_id
          WHERE tk.event_id = p.id AND o.payment_status = 'paid'
        ),
        'rsvp_going_count', (
          SELECT count(*) FROM public.event_rsvps rv
          WHERE rv.event_id = p.id AND rv.rsvp_status = 'going' AND rv.approval_status = 'approved'
        ),
        'child_summary', CASE p.event_type
          WHEN 'trip' THEN jsonb_build_object('trip_day_count',
            (SELECT count(*) FROM public.trip_days td WHERE td.event_id = p.id))
          WHEN 'experience' THEN jsonb_build_object('stop_count',
            (SELECT count(*) FROM public.experience_stops es WHERE es.event_id = p.id))
          WHEN 'rsvp' THEN jsonb_build_object('rsvp_total',
            (SELECT count(*) FROM public.event_rsvps rv WHERE rv.event_id = p.id))
          ELSE jsonb_build_object('ticket_type_count',
            (SELECT count(*) FROM public.ticket_types tt WHERE tt.event_id = p.id AND tt.deleted_at IS NULL))
        END
      )
      ORDER BY p.rn
    ), '[]'::jsonb)
  INTO v_total, v_rows
  FROM page p;

  RETURN jsonb_build_object('rows', v_rows, 'total', COALESCE(v_total, 0));
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_get_offering(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_out jsonb;
  v_sched jsonb;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;

  v_sched := public.issue_3281_event_schedule(p_event_id);

  SELECT jsonb_build_object(
    'id',               e.id,
    'event_type',       e.event_type,
    'title',            e.title,
    'slug',             e.slug,
    'description',      e.description,
    'status',           e.status,
    'visibility',       e.visibility,
    'lifecycle_bucket', CASE
        WHEN e.status = 'cancelled' THEN 'cancelled'
        WHEN e.status = 'draft'     THEN 'draft'
        WHEN e.status = 'ended'     THEN 'past'
        WHEN m.start_at IS NULL     THEN 'upcoming'
        WHEN now() >= m.start_at - interval '4 hours'
         AND now() <  m.start_at + interval '24 hours' THEN 'live'
        WHEN now() <  m.start_at - interval '4 hours' THEN 'upcoming'
        ELSE 'past'
      END,
    'brand_id',         e.brand_id,
    'brand_name',       b.name,
    'brand_slug',       b.slug,
    'brand_city',       b.city,
    'city',             e.city,
    'location_text',    e.location_text,
    'destination_text', e.destination_text,
    'currency',         e.currency,
    'master_start_at',  m.start_at,
    'master_end_at',    m.end_at,
    'next_start_at',    (v_sched->>'nextStartAt')::timestamptz,
    'next_end_at',      (v_sched->>'nextEndAt')::timestamptz,
    'upcoming_count',   COALESCE((v_sched->>'upcomingCount')::integer, 0),
    'schedule_line',    v_sched->>'scheduleLine',
    'pass_tax',         e.pass_tax,
    'pass_mingla_fee',  e.pass_mingla_fee,
    'pass_service_fee', e.pass_service_fee,
    'pricing_mode',     e.pricing_mode,
    'whole_price_cents',e.whole_price_cents,
    'refund_policy',    e.refund_policy,
    'bookings_closed',  e.bookings_closed,
    'booking_deadline', e.booking_deadline,
    'published_at',     e.published_at,
    'deleted_at',       e.deleted_at,
    'created_at',       e.created_at,
    'rsvp_capacity',        e.rsvp_capacity,
    'rsvp_approval_mode',   e.rsvp_approval_mode,
    'rsvp_waitlist_enabled',e.rsvp_waitlist_enabled,
    'rsvp_allow_plus_ones', e.rsvp_allow_plus_ones,
    'rsvp_plus_ones_max',   e.rsvp_plus_ones_max,
    'child_summary', CASE e.event_type
        WHEN 'trip' THEN jsonb_build_object('trip_day_count',
          (SELECT count(*) FROM public.trip_days td WHERE td.event_id = e.id))
        WHEN 'experience' THEN jsonb_build_object('stop_count',
          (SELECT count(*) FROM public.experience_stops es WHERE es.event_id = e.id))
        WHEN 'rsvp' THEN jsonb_build_object('rsvp_total',
          (SELECT count(*) FROM public.event_rsvps rv WHERE rv.event_id = e.id))
        ELSE jsonb_build_object('ticket_type_count',
          (SELECT count(*) FROM public.ticket_types tt WHERE tt.event_id = e.id AND tt.deleted_at IS NULL))
      END,
    -- #3645: cancel-review hold visibility (must survive schedule append).
    'cancel_refund_run_status', (
      SELECT r.status FROM public.event_cancel_refund_runs r
      WHERE r.event_id = e.id
      LIMIT 1
    ),
    'cancel_refund_object_count', (
      SELECT count(*)::int FROM public.event_cancel_refund_progress p
      WHERE p.event_id = e.id
    )
  )
  INTO v_out
  FROM public.events e
  LEFT JOIN public.event_dates m ON m.event_id = e.id AND m.is_master
  LEFT JOIN public.brands b ON b.id = e.brand_id
  WHERE e.id = p_event_id;

  RETURN v_out;
END;
$$;

-- Keep pg_public_rsvp_by_slug.publicEventRow column-identical to the view
-- (issue #3827 T-18). Unlisted RSVPs are not in the view, so the row stays an
-- explicit SELECT; append the same schedule lateral the view uses. #3872's
-- enrich wrapper is preserved — we rewrite prosrc in place.
DO $patch_rsvp_schedule$
DECLARE
  v_body text;
  v_old text;
  v_new text;
  v_hits integer;
BEGIN
  SELECT regexp_replace(p.prosrc, E'\\s*$', '')
    INTO v_body
    FROM pg_proc p
   WHERE p.oid = 'public.pg_public_rsvp_by_slug(text,text)'::regprocedure;

  IF v_body IS NULL THEN
    RAISE EXCEPTION 'issue_3281_rsvp_publicEventRow_missing';
  END IF;

  v_old :=
    'e.cover_media_gallery'
    || E'\n          FROM public.events e'
    || E'\n          JOIN public.brands b ON b.id = e.brand_id'
    || E'\n          LEFT JOIN public.event_dates ed ON ed.event_id = e.id AND ed.is_master = true'
    || E'\n          WHERE e.id = ev.id';

  v_new :=
    'e.cover_media_gallery,'
    || E'\n            sched.next_start_at,'
    || E'\n            sched.next_end_at,'
    || E'\n            sched.upcoming_count,'
    || E'\n            sched.schedule_line'
    || E'\n          FROM public.events e'
    || E'\n          JOIN public.brands b ON b.id = e.brand_id'
    || E'\n          LEFT JOIN public.event_dates ed ON ed.event_id = e.id AND ed.is_master = true'
    || E'\n          LEFT JOIN LATERAL ('
    || E'\n            SELECT'
    || E'\n              n.start_at AS next_start_at,'
    || E'\n              n.end_at AS next_end_at,'
    || E'\n              COALESCE(c.upcoming_count, 0) AS upcoming_count,'
    || E'\n              CASE'
    || E'\n                WHEN COALESCE(c.upcoming_count, 0) = 0 THEN NULL'
    || E'\n                WHEN c.upcoming_count = 1 THEN to_char('
    || E'\n                  n.start_at AT TIME ZONE COALESCE(NULLIF(btrim(e.timezone), ''''), ''UTC''), ''Dy DD Mon'')'
    || E'\n                ELSE format('
    || E'\n                  ''%s · +%s more'','
    || E'\n                  to_char(n.start_at AT TIME ZONE COALESCE(NULLIF(btrim(e.timezone), ''''), ''UTC''), ''Dy DD Mon''),'
    || E'\n                  c.upcoming_count - 1)'
    || E'\n              END AS schedule_line'
    || E'\n            FROM ('
    || E'\n              SELECT count(*)::integer AS upcoming_count'
    || E'\n                FROM public.event_dates d'
    || E'\n               WHERE d.event_id = e.id AND d.end_at > now()'
    || E'\n            ) c'
    || E'\n            LEFT JOIN LATERAL ('
    || E'\n              SELECT d.start_at, d.end_at'
    || E'\n                FROM public.event_dates d'
    || E'\n               WHERE d.event_id = e.id AND d.end_at > now()'
    || E'\n               ORDER BY d.start_at, d.id'
    || E'\n               LIMIT 1'
    || E'\n            ) n ON true'
    || E'\n          ) sched ON true'
    || E'\n          WHERE e.id = ev.id';

  v_hits := (length(v_body) - length(replace(v_body, v_old, ''))) / length(v_old);
  IF v_hits <> 1 THEN
    RAISE EXCEPTION
      'issue_3281_rsvp_publicEventRow_schedule_drift: expected 1 publicEventRow tail, got %',
      v_hits;
  END IF;
  v_body := replace(v_body, v_old, v_new);

  EXECUTE format(
    'CREATE OR REPLACE FUNCTION public.pg_public_rsvp_by_slug(p_brand_slug text, p_event_slug text) '
    'RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS %L',
    v_body
  );
END;
$patch_rsvp_schedule$;

COMMIT;
