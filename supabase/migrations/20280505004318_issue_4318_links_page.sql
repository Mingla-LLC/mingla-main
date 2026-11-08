-- #4318 — usemingla.com/links: the weekly city calendar.
--
-- 1. public.links_strips: the custom strips Support staff pin to /links
--    ("From Mingla"). Admin-only writes through SECURITY DEFINER RPCs guarded
--    by is_support_staff (the Blog pattern, #4137). Anonymous readers see only
--    published, unexpired strips through RLS + column grants and the SECURITY
--    INVOKER reader links_page_strips().
-- 2. public.links_page_week(): one row per occurrence date in the next seven
--    days of every public, published, upcoming event, trip and experience.
--    Eligibility mirrors discover_v2_items (events, experiences, trips) and
--    discover_v2_event_base, plus "not cancelled" on every date. SQL never
--    names a city: it returns lat/lng and the marketing site assigns each
--    listing to its nearest live city.
-- 3. public.links_page_places(): for a city with nothing listed this week, a
--    few real places near the city centre the page passes in.
--
-- plpgsql throughout (bodies are not validated at CREATE, so the pre-#1931
-- replay lane needs no skip entry). Static SQL only (#1860 C7). Conflicts raise
-- PT409, never 40001 (#4134).

BEGIN;
SET LOCAL lock_timeout = '10s';

-- ───────────────────────────────────────────────────────────────────────────
-- A. The strips table.
-- ───────────────────────────────────────────────────────────────────────────
-- The one title normaliser, shared by the CHECK and the save RPC: every run of
-- whitespace (ASCII, no-break, the Unicode space separators, line and
-- paragraph separators, ideographic space, zero-width space and BOM) becomes
-- one plain space, and the ends are trimmed. btrim alone trims plain spaces
-- only, so a title of tabs, newlines or U+00A0/U+3000 would pass as "text".
CREATE OR REPLACE FUNCTION public.issue_4318_links_title_normal(p_title text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $function$
  SELECT regexp_replace(
    regexp_replace(p_title,
      '[\s\u0085  ᠎ -​    　﻿]+', ' ', 'g'),
    '^ | $', '', 'g');
$function$;
REVOKE ALL ON FUNCTION public.issue_4318_links_title_normal(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_4318_links_title_normal(text) TO authenticated, service_role;
COMMENT ON FUNCTION public.issue_4318_links_title_normal(text) IS
  '#4318: a /links strip title with every Unicode whitespace run collapsed to one space and the ends trimmed.';

CREATE TABLE IF NOT EXISTS public.links_strips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shows_on date NOT NULL,
  title text NOT NULL CHECK (
    title = public.issue_4318_links_title_normal(title) AND length(title) BETWEEN 1 AND 60
  ),
  label text NOT NULL CHECK (label IN ('From Mingla', 'Featured', 'New', 'Giveaway')),
  opens text NOT NULL CHECK (opens IN ('web', 'blog', 'explorer', 'host')),
  url text NULL CHECK (
    url IS NULL OR (
      length(url) <= 500
      AND url !~* '^[a-z][a-z0-9+.-]*://'
      AND url ~* '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,63}(:[0-9]{1,5})?([/?#][^[:space:]]*)?$'
    )
  ),
  blog_post_id uuid NULL REFERENCES public.blog_posts(id) ON DELETE SET NULL,
  position integer NOT NULL,
  is_published boolean NOT NULL DEFAULT true,
  created_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- What each kind of strip opens. A blog strip's post may later be removed
  -- (ON DELETE SET NULL); the public reader then omits it.
  CONSTRAINT links_strips_opens_target CHECK (
    (opens = 'web' AND url IS NOT NULL AND blog_post_id IS NULL)
    OR (opens = 'blog' AND url IS NULL)
    OR (opens IN ('explorer', 'host') AND url IS NULL AND blog_post_id IS NULL)
  )
);
COMMENT ON TABLE public.links_strips IS
  '#4318: custom "From Mingla" strips on usemingla.com/links, shown first for every live city (strips are not by city). Public from creation through the end of shows_on. Lower position = higher on the page. Written only through admin_links_* RPCs.';

CREATE INDEX IF NOT EXISTS links_strips_position_idx ON public.links_strips (position, created_at, id);
CREATE INDEX IF NOT EXISTS links_strips_shows_on_idx ON public.links_strips (shows_on);

ALTER TABLE public.links_strips ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.links_strips FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.links_strips TO service_role;

-- Public: the columns /links shows, for published strips not yet past their
-- day. created_by and timestamps are never granted.
GRANT SELECT (id, shows_on, title, label, opens, url, blog_post_id, position, is_published)
  ON public.links_strips TO anon, authenticated;
DROP POLICY IF EXISTS links_strips_public_read ON public.links_strips;
CREATE POLICY links_strips_public_read ON public.links_strips FOR SELECT TO anon, authenticated
  USING (is_published AND shows_on >= (now() AT TIME ZONE 'utc')::date - 1);

-- ───────────────────────────────────────────────────────────────────────────
-- B. Public reader for the strips (SECURITY INVOKER: RLS is the fence).
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.links_page_strips()
RETURNS TABLE (
  id uuid, shows_on date, title text, label text, opens text,
  url text, blog_slug text, "position" integer
)
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $function$
#variable_conflict use_column
BEGIN
  RETURN QUERY
  SELECT strip.id, strip.shows_on, strip.title, strip.label, strip.opens,
         strip.url, post.slug, strip.position
  FROM public.links_strips strip
  LEFT JOIN public.blog_posts post ON post.id = strip.blog_post_id
  WHERE strip.is_published
    AND strip.shows_on >= (now() AT TIME ZONE 'utc')::date - 1
    AND (
      strip.opens <> 'blog'
      OR (post.id IS NOT NULL
          AND public.issue_4137_blog_post_visible(post.status, post.deleted_at, post.published_version_id,
                                                  post.publish_at, post.take_down_at))
    )
  ORDER BY strip.position, strip.id;  -- anon holds no grant on created_at
END;
$function$;
REVOKE ALL ON FUNCTION public.links_page_strips() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.links_page_strips() TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.links_page_strips() IS
  '#4318: /links custom strips: published, unexpired, in admin order; a blog strip only while its post is public (blog_slug set).';

-- ───────────────────────────────────────────────────────────────────────────
-- C. Public reader for the week's listings (SECURITY DEFINER, allowlisted).
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.links_page_week()
RETURNS TABLE (
  kind text, title text, place_label text, starts_at timestamptz, ends_at timestamptz,
  tz text, lat double precision, lng double precision, cover_url text,
  brand_slug text, item_slug text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
#variable_conflict use_column
DECLARE
  v_now constant timestamptz := now();
  v_end constant timestamptz := now() + interval '7 days';
BEGIN
  RETURN QUERY
  WITH listings AS (
    -- Events (and discoverable RSVPs): the discover_v2_event_base rule, one row
    -- per buyable, uncancelled date that has not ended and starts this week.
    SELECT 'event'::text AS kind, e.title,
      CASE WHEN public.issue_2489_address_withheld(e.theme) THEN NULL ELSE e.location_text END AS place_label,
      ed.start_at AS starts_at, ed.end_at AS ends_at,
      COALESCE(NULLIF(ed.timezone, ''), NULLIF(e.timezone, ''), 'UTC') AS tz,
      -- A withheld address returns a coarse point (one decimal, about 11 km):
      -- enough to place the listing in its city, never the venue.
      CASE WHEN e.location_geo IS NULL THEN NULL
           WHEN public.issue_2489_address_withheld(e.theme) THEN round((e.location_geo)[1]::numeric, 1)::double precision
           ELSE (e.location_geo)[1]::double precision END AS lat,
      CASE WHEN e.location_geo IS NULL THEN NULL
           WHEN public.issue_2489_address_withheld(e.theme) THEN round((e.location_geo)[0]::numeric, 1)::double precision
           ELSE (e.location_geo)[0]::double precision END AS lng,
      e.cover_media_url AS cover_url, b.slug AS brand_slug, e.slug AS item_slug
    FROM public.events e
    JOIN public.brands b ON b.id = e.brand_id AND b.deleted_at IS NULL
    JOIN public.event_dates ed ON ed.event_id = e.id
      AND ed.cancelled_at IS NULL AND ed.end_at > v_now AND ed.start_at < v_end
    WHERE e.deleted_at IS NULL
      AND public.issue_4174_explorer_brand_visible(e.brand_id)
      AND e.visibility = 'public'
      AND (e.event_type = 'event' OR (e.event_type = 'rsvp' AND e.rsvp_discoverable = true))
      AND e.status = ANY (ARRAY['scheduled', 'live'])
      AND NOT public.issue_1931_event_ordinary_read_blocked(e.id)
      AND NOT (
        EXISTS (SELECT 1 FROM public.ticket_types tt WHERE tt.event_id = e.id
          AND tt.deleted_at IS NULL AND tt.is_hidden IS NOT TRUE AND tt.is_disabled IS NOT TRUE
          AND tt.available_online IS TRUE AND tt.price_cents > 0)
        AND NOT public.pg_brand_can_collect(e.brand_id)
      )
      AND EXISTS (SELECT 1 FROM public.issue_3281_explorer_date_listable_rows(e.id, ed.id))

    UNION ALL

    -- Experiences: the discover_v2_items experience rule, one row per bookable,
    -- uncancelled date this week. Place and point come from the first stop.
    SELECT 'experience'::text, e.title,
      (SELECT s.place_name FROM public.experience_stops s WHERE s.event_id = e.id
        ORDER BY s.stop_order, s.id LIMIT 1),
      ed.start_at, ed.end_at,
      COALESCE(NULLIF(ed.timezone, ''), NULLIF(e.timezone, ''), 'UTC'),
      stop_point.lat, stop_point.lng,
      e.cover_media_url, b.slug, e.slug
    FROM public.events e
    JOIN public.brands b ON b.id = e.brand_id AND b.deleted_at IS NULL
    JOIN public.event_dates ed ON ed.event_id = e.id
      AND ed.cancelled_at IS NULL AND ed.end_at > v_now AND ed.start_at < v_end
    LEFT JOIN LATERAL (
      SELECT s.lat, s.lng FROM public.experience_stops s
      WHERE s.event_id = e.id AND s.lat IS NOT NULL AND s.lng IS NOT NULL
      ORDER BY s.stop_order, s.id LIMIT 1
    ) stop_point ON true
    WHERE e.deleted_at IS NULL
      AND public.issue_4174_explorer_brand_visible(e.brand_id)
      AND e.event_type = 'experience' AND e.visibility = 'public' AND e.status = 'scheduled'
      AND e.published_at IS NOT NULL AND cardinality(e.experience_intents) > 0
      AND NOT public.issue_1931_event_ordinary_read_blocked(e.id)
      AND EXISTS (SELECT 1 FROM public.issue_3281_experience_date_bookable_ticket_types(e.id, ed.id))
      AND (NOT EXISTS (SELECT 1 FROM public.ticket_types tt WHERE tt.event_id = e.id
            AND tt.available_online IS TRUE AND tt.deleted_at IS NULL AND tt.is_hidden IS NOT TRUE
            AND tt.is_disabled IS NOT TRUE AND tt.price_cents > 0)
        OR public.pg_brand_can_collect(e.brand_id))

    UNION ALL

    -- Trips: the discover_v2_items trip rule on the trip's own (master) date.
    SELECT 'trip'::text, e.title, e.destination_text,
      ed.start_at, ed.end_at,
      COALESCE(NULLIF(ed.timezone, ''), NULLIF(e.timezone, ''), 'UTC'),
      CASE WHEN e.location_geo IS NULL THEN NULL ELSE (e.location_geo)[1]::double precision END,
      CASE WHEN e.location_geo IS NULL THEN NULL ELSE (e.location_geo)[0]::double precision END,
      e.cover_media_url, b.slug, e.slug
    FROM public.events e
    JOIN public.brands b ON b.id = e.brand_id AND b.deleted_at IS NULL
    JOIN public.event_dates ed ON ed.event_id = e.id AND ed.is_master IS TRUE
      AND ed.cancelled_at IS NULL AND ed.end_at > v_now AND ed.start_at < v_end
    WHERE e.deleted_at IS NULL
      AND public.issue_4174_explorer_brand_visible(e.brand_id)
      AND e.event_type = 'trip' AND e.visibility = 'public' AND e.status IN ('scheduled', 'live')
      AND NOT public.issue_1931_event_ordinary_read_blocked(e.id)
      AND COALESCE(e.bookings_closed, false) = false
      AND (e.booking_deadline IS NULL OR e.booking_deadline >= v_now)
      AND EXISTS (SELECT 1 FROM public.trip_pricing_tiers tpt JOIN public.ticket_types tt ON tt.id = tpt.ticket_type_id
        WHERE tpt.event_id = e.id AND tt.deleted_at IS NULL AND COALESCE(tt.is_hidden, false) = false)
  )
  SELECT l.kind, l.title, l.place_label, l.starts_at, l.ends_at, l.tz, l.lat, l.lng,
         l.cover_url, l.brand_slug, l.item_slug
  FROM listings l
  ORDER BY l.starts_at, l.kind, l.item_slug
  LIMIT 500;
END;
$function$;
REVOKE ALL ON FUNCTION public.links_page_week() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.links_page_week() TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.links_page_week() IS
  '#4318: /links listings: one row per occurrence date in [now, now + 7 days) of public, published, upcoming events, experiences and trips (discover_v2_items eligibility, cancelled dates excluded). Column allow-list only; a withheld address yields no place text and a one-decimal point. Capped at 500 rows.';

-- ───────────────────────────────────────────────────────────────────────────
-- C2. Public reader for a quiet week: real places near a city centre
--     (SECURITY DEFINER, allowlisted). The marketing city registry owns the
--     centre and reach; this reader never names a city.
--
-- Visibility is Explorer's own serving gate, copied from the solo deck
-- reader query_servable_places_by_signal
-- (20261221000001_meta_orch_1290_servable_rpcs_generative_summary.sql:69-77):
-- is_servable, is_active, and a stored photo that is not the
-- '__backfill_failed__' marker. On top of it: business_status OPERATIONAL,
-- not soft-deleted (deleted_at, #1073), not held by the #4276 serving hold,
-- and a 384px thumb already written (thumbs_backfilled_at, set by
-- backfill-place-photo-thumbs) for a photo in the place-photos bucket.
-- photo_path is that thumb's object path (<dir>/<stem>_thumb.jpg, the
-- app-mobile/src/utils/placePhotoThumb.ts rule); never a /render/image URL.
-- Order: review_count DESC NULLS LAST (Explorer's own tie-break, same file
-- :86), then distance, then id. Radius capped at 100 km, limit at 6.
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.links_page_places(
  p_lat double precision,
  p_lng double precision,
  p_radius_km integer DEFAULT 60,
  p_limit integer DEFAULT 3
)
RETURNS TABLE (
  place_id text, name text, category text, area_label text,
  lat double precision, lng double precision, photo_path text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
#variable_conflict use_column
DECLARE
  v_radius constant double precision := LEAST(GREATEST(COALESCE(p_radius_km, 60), 1), 100);
  v_limit constant integer := LEAST(GREATEST(COALESCE(p_limit, 3), 1), 6);
  v_prefix constant text := '/storage/v1/object/public/place-photos/';
  v_lat_span double precision;
  v_lng_span double precision;
BEGIN
  IF p_lat IS NULL OR p_lng IS NULL OR p_lat NOT BETWEEN -90 AND 90 OR p_lng NOT BETWEEN -180 AND 180
     OR p_lat = 'NaN'::double precision OR p_lng = 'NaN'::double precision THEN
    RETURN;
  END IF;
  -- A cheap box around the circle first; the exact distance decides.
  v_lat_span := v_radius / 111.0;
  v_lng_span := v_radius / GREATEST(111.0 * cos(radians(p_lat)), 1.0);

  RETURN QUERY
  WITH candidates AS (
    SELECT pp.id, pp.name, pp.primary_type_display_name, pp.city, pp.lat, pp.lng, pp.review_count,
      split_part(pp.stored_photo_urls[1], v_prefix, 2) AS object_path,
      6371.0 * 2.0 * asin(sqrt(
        power(sin(radians(pp.lat - p_lat) / 2.0), 2)
        + cos(radians(p_lat)) * cos(radians(pp.lat)) * power(sin(radians(pp.lng - p_lng) / 2.0), 2)
      )) AS distance_km
    FROM public.place_pool pp
    WHERE pp.is_servable = true
      AND pp.is_active = true
      AND pp.business_status = 'OPERATIONAL'
      AND pp.deleted_at IS NULL
      AND pp.serving_hold IS NOT TRUE
      AND pp.thumbs_backfilled_at IS NOT NULL
      AND pp.stored_photo_urls IS NOT NULL
      AND array_length(pp.stored_photo_urls, 1) > 0
      AND NOT (array_length(pp.stored_photo_urls, 1) = 1 AND pp.stored_photo_urls[1] = '__backfill_failed__')
      AND position(v_prefix IN pp.stored_photo_urls[1]) > 0
      AND pp.lat IS NOT NULL AND pp.lng IS NOT NULL
      AND pp.lat BETWEEN p_lat - v_lat_span AND p_lat + v_lat_span
      AND pp.lng BETWEEN p_lng - v_lng_span AND p_lng + v_lng_span
      AND NULLIF(btrim(pp.name), '') IS NOT NULL
  ), thumbs AS (
    SELECT c.*,
      -- <dir>/<stem>.<ext> -> <dir>/<stem>_thumb.jpg; query and fragment dropped.
      regexp_replace(split_part(split_part(c.object_path, '?', 1), '#', 1), '\.[^./]*$', '') || '_thumb.jpg' AS thumb
    FROM candidates c
    WHERE c.distance_km <= v_radius
  )
  SELECT t.id::text, t.name, t.primary_type_display_name, t.city, t.lat, t.lng, t.thumb
  FROM thumbs t
  WHERE t.thumb ~ '^[^/]+/.*[^/]_thumb\.jpg$'
    AND t.thumb !~ '_thumb_thumb\.jpg$'
  ORDER BY t.review_count DESC NULLS LAST, t.distance_km, t.id
  LIMIT v_limit;
END;
$function$;
REVOKE ALL ON FUNCTION public.links_page_places(double precision, double precision, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.links_page_places(double precision, double precision, integer, integer)
  TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.links_page_places(double precision, double precision, integer, integer) IS
  '#4318: up to 6 real, servable, operational places with a stored thumb within 100 km of a point, for a /links quiet week. Explorer''s serving gate; no address (area label = city), no private columns; photo_path is the place-photos <dir>/<stem>_thumb.jpg object, never a /render/image URL.';

-- ───────────────────────────────────────────────────────────────────────────
-- D. Admin RPCs (Support area, same guard as the Blog RPCs).
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_links_strips_list()
RETURNS TABLE (
  id uuid, shows_on date, title text, label text, opens text, url text,
  blog_post_id uuid, blog_slug text, blog_title text, blog_is_public boolean,
  "position" integer, is_published boolean, is_expired boolean,
  created_at timestamptz, updated_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
#variable_conflict use_column
BEGIN
  IF auth.uid() IS NULL OR NOT COALESCE(public.is_support_staff(auth.uid()), false) THEN
    RAISE EXCEPTION 'links_forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT strip.id, strip.shows_on, strip.title, strip.label, strip.opens, strip.url,
    strip.blog_post_id, post.slug,
    (SELECT version.title FROM public.blog_post_versions version
      WHERE version.id = COALESCE(post.published_version_id, post.draft_version_id)),
    COALESCE(public.issue_4137_blog_post_visible(post.status, post.deleted_at, post.published_version_id,
                                                 post.publish_at, post.take_down_at), false),
    strip.position, strip.is_published,
    strip.shows_on < (now() AT TIME ZONE 'utc')::date - 1,
    strip.created_at, strip.updated_at
  FROM public.links_strips strip
  LEFT JOIN public.blog_posts post ON post.id = strip.blog_post_id
  ORDER BY strip.position, strip.created_at, strip.id;
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_links_strips_list() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_links_strips_list() TO authenticated, service_role;
COMMENT ON FUNCTION public.admin_links_strips_list() IS
  '#4318: every /links strip in page order with its blog post title, for Support staff.';

CREATE OR REPLACE FUNCTION public.admin_links_strip_save(
  p_id uuid, p_shows_on date, p_title text, p_label text,
  p_opens text, p_url text, p_blog_post_id uuid
)
RETURNS public.links_strips
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_title text := COALESCE(public.issue_4318_links_title_normal(p_title), '');
  v_url text := NULL;
  v_blog uuid := NULL;
  v_row public.links_strips;
BEGIN
  IF v_actor IS NULL OR NOT COALESCE(public.is_support_staff(v_actor), false) THEN
    RAISE EXCEPTION 'links_forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_shows_on IS NULL OR p_shows_on < (now() AT TIME ZONE 'utc')::date - 1 THEN
    RAISE EXCEPTION 'links_shows_on_invalid' USING ERRCODE = 'P0001';
  END IF;
  IF length(v_title) NOT BETWEEN 1 AND 60 THEN
    RAISE EXCEPTION 'links_title_invalid' USING ERRCODE = 'P0001';
  END IF;
  IF p_label IS NULL OR p_label NOT IN ('From Mingla', 'Featured', 'New', 'Giveaway') THEN
    RAISE EXCEPTION 'links_label_invalid' USING ERRCODE = 'P0001';
  END IF;
  IF p_opens IS NULL OR p_opens NOT IN ('web', 'blog', 'explorer', 'host') THEN
    RAISE EXCEPTION 'links_opens_invalid' USING ERRCODE = 'P0001';
  END IF;

  IF p_opens = 'web' THEN
    -- Stored without its scheme: "https://usemingla.com/x" -> "usemingla.com/x".
    v_url := regexp_replace(btrim(COALESCE(p_url, '')), '^https?://', '', 'i');
    IF v_url = '' OR length(v_url) > 500
       OR v_url ~* '^[a-z][a-z0-9+.-]*://'
       OR v_url !~* '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,63}(:[0-9]{1,5})?([/?#][^[:space:]]*)?$' THEN
      RAISE EXCEPTION 'links_url_invalid' USING ERRCODE = 'P0001';
    END IF;
  ELSIF p_opens = 'blog' THEN
    IF p_blog_post_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.blog_posts post
      WHERE post.id = p_blog_post_id
        AND public.issue_4137_blog_post_visible(post.status, post.deleted_at, post.published_version_id,
                                                post.publish_at, post.take_down_at)
    ) THEN
      RAISE EXCEPTION 'links_blog_post_invalid' USING ERRCODE = 'P0001';
    END IF;
    v_blog := p_blog_post_id;
  END IF;

  -- One ordering across every strip: saves and reorders take turns.
  PERFORM pg_advisory_xact_lock(hashtext('issue_4318_links_strips_order'));

  IF p_id IS NULL THEN
    INSERT INTO public.links_strips (shows_on, title, label, opens, url, blog_post_id, position, created_by)
    VALUES (p_shows_on, v_title, p_label, p_opens, v_url, v_blog,
      COALESCE((SELECT min(existing.position) - 1 FROM public.links_strips existing), 0), v_actor)
    RETURNING * INTO v_row;
  ELSE
    UPDATE public.links_strips strip
    SET shows_on = p_shows_on, title = v_title, label = p_label, opens = p_opens,
        url = v_url, blog_post_id = v_blog, updated_at = now()
    WHERE strip.id = p_id
    RETURNING * INTO v_row;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'links_strip_not_found' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN v_row;
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_links_strip_save(uuid, date, text, text, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_links_strip_save(uuid, date, text, text, text, text, uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.admin_links_strip_save(uuid, date, text, text, text, text, uuid) IS
  '#4318: create (p_id null; the new strip goes to the top) or update a /links strip. Validates day, title, label, opens, web URL (scheme stripped) and published blog post.';

CREATE OR REPLACE FUNCTION public.admin_links_strip_delete(p_id uuid)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT COALESCE(public.is_support_staff(auth.uid()), false) THEN
    RAISE EXCEPTION 'links_forbidden' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('issue_4318_links_strips_order'));
  DELETE FROM public.links_strips strip WHERE strip.id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'links_strip_not_found' USING ERRCODE = 'P0001';
  END IF;
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_links_strip_delete(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_links_strip_delete(uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.admin_links_strip_delete(uuid) IS '#4318: remove one /links strip.';

CREATE OR REPLACE FUNCTION public.admin_links_strips_reorder(p_ids uuid[])
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT COALESCE(public.is_support_staff(auth.uid()), false) THEN
    RAISE EXCEPTION 'links_forbidden' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('issue_4318_links_strips_order'));
  -- The list must be exactly today's set of strips: no gaps, no repeats, no
  -- strangers. Anything else means the editor is looking at an old list.
  IF p_ids IS NULL
     OR array_position(p_ids, NULL) IS NOT NULL
     OR cardinality(p_ids) <> (SELECT count(DISTINCT given.strip_id) FROM unnest(p_ids) AS given(strip_id))
     OR cardinality(p_ids) <> (SELECT count(*) FROM public.links_strips)
     OR EXISTS (SELECT 1 FROM unnest(p_ids) AS given(strip_id)
                WHERE NOT EXISTS (SELECT 1 FROM public.links_strips strip WHERE strip.id = given.strip_id)) THEN
    RAISE EXCEPTION 'links_strips_stale' USING ERRCODE = 'PT409';
  END IF;
  UPDATE public.links_strips strip
  SET position = given.ord::integer, updated_at = now()
  FROM unnest(p_ids) WITH ORDINALITY AS given(strip_id, ord)
  WHERE strip.id = given.strip_id
    AND strip.position IS DISTINCT FROM given.ord::integer;
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_links_strips_reorder(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_links_strips_reorder(uuid[]) TO authenticated, service_role;
COMMENT ON FUNCTION public.admin_links_strips_reorder(uuid[]) IS
  '#4318: set every /links strip''s position to its 1-based index in p_ids; p_ids must be exactly the current set (PT409 otherwise).';

NOTIFY pgrst, 'reload schema';

COMMIT;
