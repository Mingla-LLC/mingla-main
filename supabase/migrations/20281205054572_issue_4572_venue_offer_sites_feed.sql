-- #4572 expanded: coworking and venue offers on Mingla Sites.
-- Re-emits the #4572 feed body after #4490 introduced venue price options
-- and membership plans. Ordinary offers use their lowest current active
-- price; live membership plans use their own monthly price and buyer route.
-- Also adds the setup vocabulary needed to identify a coworking site.
--
-- MINGLA-INVARIANT: I-SITES-VENUE-OFFER-PRICE | issue #4572 | live venue
-- offers and membership plans carry their source price, currency, cadence and
-- canonical Mingla buyer route; room/place stays keep the stay-tab route.

-- #4572 items 2 and 7a: event cards on Mingla Sites.
--
--   2. An event whose flyer is a video showed an empty grey box: the feed's
--      `cover` only accepted an image cover. Now
--        * a video/gif cover with a poster in Mingla storage
--          (event_covers|brand_covers) gives `cover` = {path, type:'image'}
--          (the shape every renderer already reads);
--        * a video/gif cover whose poster is a stream-CDN still
--          (https://<x>.b-cdn.net/<video_id>/thumbnail[_x].jpg) gives a NEW
--          key `cover_stream_poster` = {host, video_id, file}.
--      business_public_events_view has no poster column, so the events CTE
--      joins public.events for it. The view is unchanged.
--   7a. `summary` keeps line breaks (paragraphs and "- " lines).
--
-- Safe in EITHER order with the code deploy (#4572 release note):
--   * applied BEFORE the Sites/CMS deploy: `cover` keeps today's shape, and
--     older parsers (normalizeSiteOffering picks only the keys it knows) drop
--     `cover_stream_poster`, so a live site looks exactly as today plus
--     Supabase-poster stills and kept line breaks (a newline is plain text to
--     the old renderer and reads as a space);
--   * applied AFTER: the new renderer draws the still.
--
-- brand_site_offerings_feed_for_brand is re-emitted from
-- 20281129004572_issue_4572_sites_feed_poster_and_breaks.sql with only the
-- venue-offer lines changed. Drift guard: md5 of that live predecessor body.
-- Static SQL, SECURITY
-- DEFINER, explicit search_path, grants unchanged (CREATE OR REPLACE keeps
-- them). brand_site_offerings_feed(p_site_id) calls this body, so it follows.
--
-- INVARIANT sites-cover-still-one-rule: brand_site_offering_cover_stream_poster
-- emits exactly the parts isOfferingStreamPoster (packages/site-contracts
-- offerings.ts) accepts.
--
-- Rollback: re-run section 2 of 20280807094453 (the two helpers can stay).

BEGIN;

SET LOCAL lock_timeout = '10s';

-- Coworking is a venue plan option and shares the neutral Visit recipe.
CREATE OR REPLACE FUNCTION public.brand_site_plan_offering_keys()
RETURNS text[]
LANGUAGE sql IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT ARRAY['trips','events','experiences','venue_coworking','venue_food_drink','venue_play',
    'venue_creative_arts','venue_stay'];
$function$;
REVOKE ALL ON FUNCTION public.brand_site_plan_offering_keys() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.brand_site_plan_offering_keys() TO authenticated, service_role;

ALTER TABLE public.brand_site_plans
  DROP CONSTRAINT brand_site_plans_offerings_selected_check;
ALTER TABLE public.brand_site_plans
  ADD CONSTRAINT brand_site_plans_offerings_selected_check CHECK (
    offerings_selected IS NULL OR (
      offerings_selected <@ public.brand_site_plan_offering_keys()
      AND cardinality(offerings_selected) <= 8
    )
  );

DO $drift_guard$
BEGIN
  IF (SELECT md5(p.prosrc) FROM pg_proc p
      WHERE p.oid = 'public.brand_site_offerings_feed_for_brand(uuid)'::regprocedure)
     IS DISTINCT FROM '583376e4dcdb96b3cde0e17e13104874' THEN
    RAISE EXCEPTION 'issue #4572 drift: public.brand_site_offerings_feed_for_brand no longer matches its prior #4572 definition';
  END IF;
END;
$drift_guard$;

-- ── 1. A card's storage picture: the image cover, else a video's storage poster ──
CREATE OR REPLACE FUNCTION public.brand_site_offering_cover(p_url text, p_type text, p_poster text)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT CASE
    WHEN public.brand_site_offering_cover_path(p_url, p_type) IS NOT NULL
      THEN jsonb_build_object('path', public.brand_site_offering_cover_path(p_url, p_type), 'type', 'image')
    WHEN p_type IN ('video','gif') AND public.brand_site_offering_cover_path(p_poster, 'image') IS NOT NULL
      THEN jsonb_build_object('path', public.brand_site_offering_cover_path(p_poster, 'image'), 'type', 'image')
    ELSE NULL
  END
$fn$;
REVOKE ALL ON FUNCTION public.brand_site_offering_cover(text, text, text) FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.brand_site_offering_cover(text, text, text) IS
  '#4572 item 2 — an offering card''s storage picture: the image cover''s <bucket>/<key>, else a video/gif cover''s poster in event_covers|brand_covers; NULL otherwise.';

-- ── 2. A video cover's stream-CDN still ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.brand_site_offering_cover_stream_poster(p_type text, p_poster text)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT CASE
    WHEN p_type IN ('video','gif') AND p_poster IS NOT NULL
      AND char_length(p_poster) <= 1000 AND position('..' IN p_poster) = 0
      AND p_poster ~ '^https://([a-z0-9-]{1,63}\.b-cdn\.net)/([0-9a-f-]{36})/(thumbnail(_[A-Za-z0-9]{1,16})?\.jpg)$'
      THEN jsonb_build_object(
        'host', substring(p_poster FROM '^https://([a-z0-9-]{1,63}\.b-cdn\.net)/'),
        'video_id', substring(p_poster FROM '^https://[a-z0-9-]{1,63}\.b-cdn\.net/([0-9a-f-]{36})/'),
        'file', substring(p_poster FROM '/(thumbnail(?:_[A-Za-z0-9]{1,16})?\.jpg)$'))
    ELSE NULL
  END
$fn$;
REVOKE ALL ON FUNCTION public.brand_site_offering_cover_stream_poster(text, text) FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.brand_site_offering_cover_stream_poster(text, text) IS
  '#4572 item 2 — INVARIANT sites-cover-still-one-rule: a video/gif cover''s still on the stream CDN as {host, video_id, file}; NULL for anything else (other hosts, http, dot-dot, over 1000 chars).';

-- ── 3. The feed (re-emitted; only the #4572 lines change) ──────────────────
CREATE OR REPLACE FUNCTION public.brand_site_offerings_feed_for_brand(p_brand_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_brand record;
  v_offerings jsonb;
BEGIN
  SELECT b.id, b.slug, b.default_currency, b.payment_provider::text AS payment_provider
    INTO v_brand
  FROM public.brands b
  WHERE b.id = p_brand_id
    AND b.deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'sites_not_found';
  END IF;

  WITH trips AS (
    SELECT
      t.trip_id AS id, 'trip'::text AS kind, t.trip_slug AS slug, t.title,
      t.description, t.destination_text, t.cover_media_url, t.cover_media_type,
      t.start_at, t.end_at, t.timezone, t.status, COALESCE(t.bookings_closed, false) AS bookings_closed,
      t.total_capacity AS capacity, t.spots_left,
      t.min_price_cents::bigint AS min_price_minor, t.currency, 'from'::text AS price_cadence, COALESCE(t.has_free_tier, false) AS has_free_tier,
      false AS waitlist_enabled,
      public.pg_trip_installments_supported(t.trip_id) AS installments_available,
      'https://host.usemingla.com/t/' || t.brand_slug || '/' || t.trip_slug AS public_url,
      NULL::text AS cover_path, NULL::text AS cover_poster_url
    FROM (
      SELECT r.trip_id, r.trip_slug, r.brand_slug, r.title, r.description, r.destination_text,
        r.cover_media_url, r.cover_media_type, r.start_at, r.end_at, r.timezone, r.status,
        r.bookings_closed, r.total_capacity, r.spots_left, r.min_price_cents, r.currency, r.has_free_tier
      FROM public.pg_public_trips_by_brand(v_brand.slug) r
      UNION ALL
      -- #2829 W7c (A13.5): an ENDED trip is shown even while the brand cannot
      -- take payments (nobody can book an ended trip). Exactly the rows the
      -- public reader's readiness gate held back; upcoming paid trips still
      -- need payments readiness.
      SELECT u.trip_id, u.trip_slug, u.brand_slug, u.title, u.description, u.destination_text,
        u.cover_media_url, u.cover_media_type, u.start_at, u.end_at, u.timezone, u.status,
        u.bookings_closed, u.total_capacity, u.spots_left, u.min_price_cents, u.currency, u.has_free_tier
      FROM public.brand_site_ended_trips_held_for_readiness(v_brand.id) u
    ) t
  ),
  event_rows AS (
    SELECT v.*
    FROM public.business_public_events_view v
    WHERE v.brand_id = v_brand.id
      AND v.event_type IN ('event','rsvp')
  ),
  event_remaining AS (
    SELECT er.id,
      bool_or(r.remaining IS NULL) AS any_unlimited,
      SUM(r.remaining)::int AS remaining,
      SUM(r.remaining + r.sold)::int AS capacity,
      count(r.ticket_type_id) AS tiers
    FROM event_rows er
    LEFT JOIN LATERAL public.pg_public_ticket_types_remaining(er.id) r ON true
    GROUP BY er.id
  ),
  event_free AS (
    SELECT er.id, EXISTS (
      SELECT 1 FROM public.ticket_types tt
      WHERE tt.event_id = er.id AND tt.deleted_at IS NULL
        AND COALESCE(tt.is_hidden, false) = false AND (tt.is_free OR tt.price_cents = 0)
    ) AS has_free
    FROM event_rows er
  ),
  events AS (
    SELECT
      er.id, 'event'::text AS kind, er.slug, er.title, er.description,
      er.location_text AS destination_text, er.cover_media_url, er.cover_media_type,
      er.master_start_at AS start_at, er.master_end_at AS end_at,
      COALESCE(er.master_timezone, er.timezone) AS timezone, er.status, false AS bookings_closed,
      CASE
        WHEN er.event_type = 'rsvp' THEN er.rsvp_capacity
        WHEN rem.tiers = 0 OR rem.any_unlimited THEN NULL
        ELSE rem.capacity
      END AS capacity,
      CASE
        WHEN er.event_type = 'rsvp' THEN
          CASE WHEN er.rsvp_capacity IS NULL OR er.rsvp_going_count IS NULL THEN NULL
               ELSE GREATEST(er.rsvp_capacity - er.rsvp_going_count, 0) END
        WHEN rem.tiers = 0 OR rem.any_unlimited THEN NULL
        ELSE rem.remaining
      END AS spots_left,
      NULLIF(er.display_price_cents, 0)::bigint AS min_price_minor, er.currency, 'from'::text AS price_cadence,
      COALESCE(fr.has_free, false) OR er.event_type = 'rsvp' AS has_free_tier,
      COALESCE(er.rsvp_waitlist_enabled, false) AND er.event_type = 'rsvp' AS waitlist_enabled,
      false AS installments_available,
      'https://host.usemingla.com/e/' || er.brand_slug || '/' || er.slug AS public_url,
      NULL::text AS cover_path,
      -- #4572 item 2 — the video cover's still (business_public_events_view has no poster column).
      ev.cover_media_poster_url AS cover_poster_url
    FROM event_rows er
    LEFT JOIN public.events ev ON ev.id = er.id
    LEFT JOIN event_remaining rem ON rem.id = er.id
    LEFT JOIN event_free fr ON fr.id = er.id
  ),
  experiences AS (
    SELECT
      x.experience_id AS id, 'experience'::text AS kind, x.experience_slug AS slug, x.title,
      x.description, x.venue_text AS destination_text, x.cover_media_url, x.cover_media_type,
      x.next_occurrence_at AS start_at, NULL::timestamptz AS end_at, e.timezone, e.status,
      false AS bookings_closed, NULL::integer AS capacity, NULL::integer AS spots_left,
      NULLIF(x.price_from_cents, 0)::bigint AS min_price_minor, x.currency, 'from'::text AS price_cadence,
      COALESCE(x.is_free, false) AS has_free_tier, false AS waitlist_enabled, false AS installments_available,
      'https://host.usemingla.com/exp/' || x.brand_slug || '/' || x.experience_slug AS public_url,
      NULL::text AS cover_path, NULL::text AS cover_poster_url
    FROM public.pg_public_experiences_by_brand(v_brand.slug) x
    JOIN public.events e ON e.id = x.experience_id
    WHERE e.status IN ('scheduled','live','ended','cancelled')
  ),
  -- #4453 M5 (§6.5) — live rooms and places of the brand's verified stay
  -- venues, only while the stay flags are on. "From" is the lowest sellable
  -- night in the next 60 days (never a stay total). Links to the venue page's
  -- stay tab with the room picked.
  stays AS (
    SELECT
      o.id, 'stay'::text AS kind, o.id::text AS slug, o.name AS title,
      NULLIF(o.summary, '') AS description, v.name AS destination_text,
      NULL::text AS cover_media_url, NULL::text AS cover_media_type,
      NULL::timestamptz AS start_at, NULL::timestamptz AS end_at, NULL::text AS timezone,
      'scheduled'::text AS status, false AS bookings_closed,
      NULL::integer AS capacity, NULL::integer AS spots_left,
      night.price_minor AS min_price_minor, night.currency, 'from'::text AS price_cadence,
      false AS has_free_tier, false AS waitlist_enabled, false AS installments_available,
      'https://host.usemingla.com/b/' || v_brand.slug || '/v/' || v.slug || '?tab=stay&room=' || o.id::text AS public_url,
      (SELECT 'brand_covers/' || m.storage_object_name FROM public.stay_offering_media m
        WHERE m.offering_id = o.id AND m.status = 'ready' AND m.storage_bucket_id = 'brand_covers'
        ORDER BY m.is_cover DESC, m.sort_order ASC LIMIT 1) AS cover_path,
      NULL::text AS cover_poster_url
    FROM public.stay_offerings o
    JOIN public.venue_listings v ON v.id = o.venue_id AND v.brand_id = o.brand_id
    LEFT JOIN public.stay_settings ss ON ss.venue_id = v.id
    LEFT JOIN LATERAL (
      SELECT COALESCE(n.price_override_minor, pv.amount_minor)::bigint AS price_minor,
             COALESCE(n.currency_code, pv.currency_code)::text AS currency
      FROM public.stay_room_nights n
      LEFT JOIN LATERAL (
        SELECT p.amount_minor, p.currency_code FROM public.stay_price_versions p
        WHERE p.offering_id = n.offering_id AND p.pricing_unit = 'room_night'
          AND p.effective_from <= now() AND (p.effective_to IS NULL OR p.effective_to > now())
        ORDER BY p.version_number DESC LIMIT 1
      ) pv ON true
      -- A night with a room LEFT (sellable less holds and bookings; 20280807044453).
      WHERE n.offering_id = o.id AND public.stay_room_night_available(n.offering_id, n.local_date) > 0
        AND n.local_date BETWEEN (now() AT TIME ZONE public.brand_site_zone_or_utc(ss.timezone))::date
                             AND (now() AT TIME ZONE public.brand_site_zone_or_utc(ss.timezone))::date + 60
        AND COALESCE(n.price_override_minor, pv.amount_minor) IS NOT NULL
      ORDER BY COALESCE(n.price_override_minor, pv.amount_minor) ASC
      LIMIT 1
    ) night ON true
    WHERE public.brand_site_stay_flags_on()
      AND o.brand_id = v_brand.id AND o.status = 'live' AND o.archived_at IS NULL
      AND o.kind IN ('room', 'place')
      AND v.claim_status = 'verified'
  ),
  venue_offers AS (
    SELECT
      o.id, 'venue'::text AS kind, o.id::text AS slug, o.name AS title,
      NULLIF(o.summary, '') AS description, v.name AS destination_text,
      NULL::text AS cover_media_url, NULL::text AS cover_media_type,
      NULL::timestamptz AS start_at, NULL::timestamptz AS end_at, NULL::text AS timezone,
      'scheduled'::text AS status, false AS bookings_closed,
      NULL::integer AS capacity, NULL::integer AS spots_left,
      price.amount_minor AS min_price_minor, price.currency_code AS currency,
      CASE WHEN o.kind = 'by_the_hour' OR price.unit = 'hour' THEN 'hour'::text ELSE 'from'::text END AS price_cadence,
      false AS has_free_tier, false AS waitlist_enabled, false AS installments_available,
      'https://host.usemingla.com/b/' || v_brand.slug || '/v/' || v.slug || '/book/' || o.id::text AS public_url,
      (SELECT 'brand_covers/' || m.storage_object_name FROM public.stay_offering_media m
        WHERE m.offering_id = o.id AND m.status = 'ready' AND m.storage_bucket_id = 'brand_covers'
        ORDER BY m.is_cover DESC, m.sort_order ASC LIMIT 1) AS cover_path,
      NULL::text AS cover_poster_url
    FROM public.stay_offerings o
    JOIN public.venue_listings v ON v.id = o.venue_id AND v.brand_id = o.brand_id
    LEFT JOIN LATERAL (
      SELECT p.amount_minor::bigint AS amount_minor, p.currency_code::text AS currency_code, opt.unit
      FROM public.venue_offer_price_options opt
      JOIN public.stay_price_versions p ON p.price_option_id = opt.id
      WHERE opt.offering_id = o.id AND opt.status = 'active'
        AND p.effective_from <= now() AND (p.effective_to IS NULL OR p.effective_to > now())
      ORDER BY p.amount_minor ASC, opt.sort_order ASC, opt.id ASC
      LIMIT 1
    ) price ON true
    WHERE o.brand_id = v_brand.id AND o.status = 'live' AND o.archived_at IS NULL
      AND o.kind IN ('entry', 'group_package', 'private_hire', 'by_the_hour')
      AND v.claim_status = 'verified'
  ),
  memberships AS (
    SELECT
      plan.id, 'venue'::text AS kind, plan.id::text AS slug, plan.name AS title,
      NULLIF(plan.summary, '') AS description, v.name AS destination_text,
      NULL::text AS cover_media_url, NULL::text AS cover_media_type,
      NULL::timestamptz AS start_at, NULL::timestamptz AS end_at, NULL::text AS timezone,
      'scheduled'::text AS status, false AS bookings_closed,
      plan.max_members AS capacity, NULL::integer AS spots_left,
      plan.price_minor::bigint AS min_price_minor, plan.currency_code::text AS currency,
      CASE WHEN plan.period = 'year' THEN 'year'::text ELSE 'month'::text END AS price_cadence,
      false AS has_free_tier, false AS waitlist_enabled, false AS installments_available,
      'https://host.usemingla.com/b/' || v_brand.slug || '/v/' || v.slug || '/book/' || plan.id::text || '?k=plan' AS public_url,
      (SELECT 'brand_covers/' || m.storage_object_name FROM public.stay_offering_media m
        WHERE m.offering_id = o.id AND m.status = 'ready' AND m.storage_bucket_id = 'brand_covers'
        ORDER BY m.is_cover DESC, m.sort_order ASC LIMIT 1) AS cover_path,
      NULL::text AS cover_poster_url
    FROM public.venue_membership_plans plan
    JOIN public.stay_offerings o ON o.id = plan.offering_id AND o.brand_id = plan.brand_id
    JOIN public.venue_listings v ON v.id = o.venue_id AND v.brand_id = o.brand_id
    WHERE plan.brand_id = v_brand.id AND plan.status = 'live'
      AND o.status = 'live' AND o.archived_at IS NULL
      AND v.claim_status = 'verified'
  ),
  all_rows AS (
    SELECT * FROM trips
    UNION ALL SELECT * FROM events
    UNION ALL SELECT * FROM experiences
    UNION ALL SELECT * FROM stays
    UNION ALL SELECT * FROM venue_offers
    UNION ALL SELECT * FROM memberships
  ),
  ranked AS (
    SELECT a.*,
      (a.status IN ('ended','cancelled') OR COALESCE(a.end_at, a.start_at) < now()) AS is_past
    FROM all_rows a
    WHERE a.slug IS NOT NULL AND a.title IS NOT NULL
  ),
  limited AS (
    SELECT r.* FROM ranked r
    ORDER BY r.is_past,
      CASE WHEN NOT r.is_past THEN r.start_at END ASC NULLS LAST,
      CASE WHEN r.is_past THEN r.start_at END DESC NULLS LAST,
      r.id
    LIMIT 200
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', l.id,
      'kind', l.kind,
      'slug', l.slug,
      'title', left(l.title, 200),
      -- #4572 item 7a — line breaks are kept: CRLF/CR become LF, runs of
      -- spaces and tabs within a line become one space, spaces next to a
      -- break go, three or more breaks become one blank line.
      'summary', NULLIF(left(btrim(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
                   COALESCE(l.description, ''), '\r\n?', E'\n', 'g'),
                   '[ \t\f\v\u00a0]+', ' ', 'g'),
                   ' ?\n ?', E'\n', 'g'),
                   '\n{3,}', E'\n\n', 'g'), E' \n'), 500), ''),
      'cover', CASE
                WHEN l.cover_path IS NOT NULL AND l.cover_path ~ '^brand_covers/[A-Za-z0-9._/-]+$' AND char_length(l.cover_path) <= 913 AND position('..' in l.cover_path) = 0
                  THEN jsonb_build_object('path', l.cover_path, 'type', 'image')
                ELSE public.brand_site_offering_cover(l.cover_media_url, l.cover_media_type, l.cover_poster_url) END,
      -- #4572 item 2 — a video cover's still on the stream CDN, only when no
      -- storage picture exists (a separate key: older parsers drop it).
      'cover_stream_poster', CASE
                WHEN l.cover_path IS NULL AND public.brand_site_offering_cover(l.cover_media_url, l.cover_media_type, l.cover_poster_url) IS NULL
                  THEN public.brand_site_offering_cover_stream_poster(l.cover_media_type, l.cover_poster_url) END,
      'destination_text', NULLIF(left(btrim(COALESCE(l.destination_text, '')), 200), ''),
      'start_at', l.start_at,
      'end_at', l.end_at,
      'timezone', l.timezone,
      'status', l.status,
      'bookings_closed', l.bookings_closed,
      'capacity', l.capacity,
      'spots_left', l.spots_left,
      'group_minimum', CASE WHEN l.kind = 'trip' THEN (SELECT g.group_minimum FROM public.trip_guides g WHERE g.event_id = l.id) END,
      'min_price_minor', l.min_price_minor,
      'currency', CASE WHEN l.currency ~ '^[A-Z]{3}$' THEN l.currency END,
      'price_cadence', l.price_cadence,
      'has_free_tier', l.has_free_tier,
      'public_url', l.public_url,
      'waitlist_enabled', l.waitlist_enabled,
      'installments_available', l.installments_available
    ) ORDER BY l.is_past,
      CASE WHEN NOT l.is_past THEN l.start_at END ASC NULLS LAST,
      CASE WHEN l.is_past THEN l.start_at END DESC NULLS LAST,
      l.id), '[]'::jsonb)
    INTO v_offerings
  FROM limited l;

  RETURN jsonb_build_object(
    'generated_at', to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'brand', jsonb_build_object(
      'slug', v_brand.slug,
      'currency', v_brand.default_currency,
      'payment_rails', CASE WHEN v_brand.payment_provider = 'paystack' THEN 'paystack' ELSE 'stripe' END
    ),
    'offerings', v_offerings
  );
END;
$fn$;
-- CREATE OR REPLACE keeps the existing grants.

COMMIT;
