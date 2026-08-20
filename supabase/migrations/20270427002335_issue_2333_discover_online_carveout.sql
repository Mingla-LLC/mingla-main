-- =====================================================================================
-- Issue #2333 — S3. Make an ONLINE-ONLY event FINDABLE, in every market.
--
-- 20270427002333 lets an online-only event publish with `city = NULL`. Without this
-- migration that event is then reachable ONLY by direct link: `pg_discover_business_events`
-- is the SOLE consumer discovery entry point for first-party Mingla events (it feeds BOTH
-- the Discover grid and the swipeable deck, via discover-merged-events → _business-query.ts:152),
-- and its location predicate had exactly two arms — a city match and a geo radius. An
-- online event has no city (`NULL = ANY(p_cities)` is NULL, not TRUE) and no pin
-- (`location_geo IS NULL` kills the radius arm), so BOTH arms are false and the row was
-- returned by NO market, ever, with no error and no admin signal. S1 alone would have
-- traded a loud failure (publish refused) for a silent one (published, invisible).
--
-- Seth's decision, 2026-08-19: an online event surfaces in EVERY market. This adds the
-- third OR arm that implements it.
--
-- THE ONE CONSTRAINT THAT MATTERS: the arm tests
--   e.is_online IS TRUE AND theme.business_event.format = 'online'
-- It may NEVER be a bare `e.is_online`. `is_online` is written as
-- `format === "online" || format === "hybrid"` (serverDraftEventMapper.ts:708), so the
-- bare test also broadcasts every HYBRID event — which has a real venue, a real city and
-- a real catchment — into every market on earth. The naive version compiles, passes the
-- online happy path, and is wrong. The two predicates differ by ONE conjunct.
-- Pinned by DRAFT invariant I-2333-ONLINE-ONLY-CARVE-OUT-IS-FORMAT-SCOPED and gated by
-- test case D-09 in the S3 probe (a hybrid event with a city is NOT returned for a
-- different market).
--
-- CO-REQUISITE, NOT A FOLLOW-UP: `app-mobile/src/components/discover/BusinessEventCard.tsx`
-- rendered `data.venueName ?? data.city ?? ""` — the empty string for an online event.
-- Shipping this carve-out alone would have put cards with a blank location line and no
-- online signal into every market's grid. The consumer card gains an explicit "Online"
-- badge in the SAME change. They ship together or neither ships (Seth, OQ-1, 2026-08-19).
--
-- WIDENS LOCATION AND NOTHING ELSE. `visibility = 'public'`, the event_type/rsvp_discoverable
-- gate, `status IN ('scheduled','live')`, `deleted_at IS NULL`,
-- `issue_1931_event_ordinary_read_blocked`, the master-date window, the party/vibe/genre
-- facets, the `gated` paid-collection CTE, `COUNT(*) OVER ()`,
-- `ORDER BY master_start_at ASC NULLS LAST`, OFFSET/LIMIT and the projection are all
-- untouched. `total` and pagination are computed AFTER the predicate, so both stay
-- correct; an online event simply counts in every market's total.
--
-- COORDS-ANCHORED REQUESTS: _build-response.ts:72-95 sends `p_cities: []` for a coords
-- anchor, and `= ANY('{}')` is FALSE (never NULL), so today the geo arm owns that whole
-- selection. With the new arm a coords anchor ALSO returns online events — which is the
-- decided behaviour, since "every market" includes a coords-anchored one. The degenerate
-- case (no city name AND no fallback coords) currently returns nothing at all and will
-- now return online events only. Called out so it is not discovered as a surprise.
--
-- METHOD: idempotent CREATE OR REPLACE of the FULL function body, reproduced byte-for-byte
-- from the LIVE production definition (`pg_get_functiondef`, read-only). The repo copy in
-- 20270413001931_issue_1931_private_event_access.sql:1208-1390 was diffed against prod and
-- found IDENTICAL (no drift, 5,945-char body, zero hunks). The candidate below diffs
-- against prod in exactly ONE hunk: the third OR arm + its comment.
--
-- NO `DROP FUNCTION`. 20270117001020 dropped first because it CHANGED the defaults; this
-- change does not, and dropping would revoke the grants. All 11 arguments, every default,
-- RETURNS jsonb, LANGUAGE sql, STABLE, SECURITY DEFINER and SET search_path TO '' are
-- byte-identical, so the existing ACL and COMMENT survive CREATE OR REPLACE untouched.
--
-- INDEX NOTE, recorded not actioned: `idx_events_city_published` and `idx_events_discover_feed`
-- both cover `city`; a third OR arm on a jsonb expression makes that arm itself unindexable.
-- At current event volume this is inert. If the Discover plan ever matters, the fix is a
-- partial index on `(is_online) WHERE is_online` plus an expression index — not a rewrite
-- of this predicate.
--
-- REPAIRS ZERO EXISTING ROWS. The only published null-city row in prod is private, not
-- online, and excluded by `visibility = 'public'` regardless. This is forward-looking
-- only and must not reach the ship log as a repair.
--
-- Ordering floor: strictly greater than 20270427002334 (this issue's S2), than
-- 20270424002267 (origin/main head) and than 20270426002305 (highest across every sibling
-- worktree). No historical migration is edited.
-- =====================================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.pg_discover_business_events(p_cities text[], p_lower_bound timestamp with time zone, p_upper_start timestamp with time zone DEFAULT NULL::timestamp with time zone, p_party_types text[] DEFAULT NULL::text[], p_vibe_tags text[] DEFAULT NULL::text[], p_music_genres text[] DEFAULT NULL::text[], p_offset integer DEFAULT 0, p_limit integer DEFAULT 20, p_center_lng double precision DEFAULT NULL::double precision, p_center_lat double precision DEFAULT NULL::double precision, p_radius_km double precision DEFAULT NULL::double precision)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  WITH base AS (
    SELECT
      e.id,
      e.brand_id,
      e.title,
      e.description,
      e.slug,
      e.location_text,
      e.location_geo,
      e.online_url,
      e.is_online,
      e.cover_media_url,
      e.cover_media_type,
      e.theme,
      e.timezone,
      e.currency,
      e.city,
      e.party_types,
      e.vibe_tags,
      e.music_genres,
      e.event_type,
      b.slug AS brand_slug,
      b.name AS brand_name,
      b.profile_photo_url AS brand_profile_photo_url,
      ed.start_at AS master_start_at,
      ed.end_at AS master_end_at,
      ed.timezone AS master_timezone,
      (
        SELECT MIN(tt.price_cents)
        FROM public.ticket_types tt
        WHERE tt.event_id = e.id
          AND tt.deleted_at IS NULL
          AND tt.is_hidden IS NOT TRUE
          AND tt.is_disabled IS NOT TRUE
          AND tt.price_cents IS NOT NULL
      ) AS price_min_cents,
      (
        SELECT MAX(tt.price_cents)
        FROM public.ticket_types tt
        WHERE tt.event_id = e.id
          AND tt.deleted_at IS NULL
          AND tt.is_hidden IS NOT TRUE
          AND tt.is_disabled IS NOT TRUE
          AND tt.price_cents IS NOT NULL
      ) AS price_max_cents,
      EXISTS (
        SELECT 1
        FROM public.ticket_types tt
        WHERE tt.event_id = e.id
          AND tt.deleted_at IS NULL
          AND tt.is_hidden IS NOT TRUE
          AND tt.is_disabled IS NOT TRUE
          AND tt.available_online IS TRUE
          AND tt.price_cents > 0
      ) AS has_paid_online,
      (
        SELECT public.compute_all_in_cents(
          MIN(tt.price_cents),
          COALESCE(e.pass_mingla_fee, b.default_pass_mingla_fee),
          COALESCE(e.pass_service_fee, b.default_pass_service_fee),
          (SELECT r.effective_take_rate_bps FROM public.resolve_effective_take_rate_bps(b.id) r)
        )
        FROM public.ticket_types tt
        WHERE tt.event_id = e.id
          AND tt.price_cents > 0
          AND tt.deleted_at IS NULL
      ) AS display_price_cents,
      b.pricing_currency AS pricing_currency
    FROM public.events e
    INNER JOIN public.brands b ON b.id = e.brand_id AND b.deleted_at IS NULL
    INNER JOIN public.event_dates ed
      ON ed.event_id = e.id
     AND ed.is_master IS TRUE
     AND ed.end_at >= p_lower_bound
    WHERE e.deleted_at IS NULL
      AND e.visibility = 'public'
      -- ORCH-1150: admit opted-in RSVP rows alongside ticketed events.
      AND ( e.event_type = 'event'
         OR (e.event_type = 'rsvp' AND e.rsvp_discoverable = true) )
      AND e.status = ANY (ARRAY['scheduled', 'live'])
      AND NOT public.issue_1931_event_ordinary_read_blocked(e.id)
      -- issue #1020: geo-radius OR-fallback on the venue pin. A sub-municipality
      -- venue (city label != browsed city) still surfaces when its pin sits inside
      -- the browsed metro radius; also rescues NULL-city rows that carry a pin.
      -- Every PostGIS symbol AND both type names are public.-qualified because
      -- this function runs under SET search_path = '' (bare ST_*/geometry/geography
      -- would throw does-not-exist). ST_DWithin on geography takes metres.
      AND (
            e.city = ANY (p_cities)
         OR (
              p_center_lng IS NOT NULL
              AND p_center_lat IS NOT NULL
              AND p_radius_km  IS NOT NULL
              AND e.location_geo IS NOT NULL
              AND public.ST_DWithin(
                    public.ST_SetSRID(e.location_geo::public.geometry, 4326)::public.geography,
                    public.ST_SetSRID(public.ST_MakePoint(p_center_lng, p_center_lat), 4326)::public.geography,
                    p_radius_km * 1000
                  )
            )
         -- issue #2333 — ONLINE-ONLY carve-out. Seth, 2026-08-19: an online event
         -- surfaces in EVERY market. It has no city and no pin, so BOTH arms above are
         -- false for it (NULL = ANY(...) is NULL, not TRUE; location_geo IS NULL kills
         -- the radius arm) and it was returned by NO market, ever, with no error and no
         -- admin signal. Added LAST so the two existing arms keep their short-circuit
         -- and the common city/geo path is untouched.
         --
         -- The test is theme.business_event.format = 'online', NOT a bare e.is_online.
         -- `is_online` is written as `format === "online" || format === "hybrid"`
         -- (serverDraftEventMapper.ts:708), and a HYBRID event has a real venue, a real
         -- city and a real catchment — broadcasting it into every market on earth is
         -- spam, and is not what was decided. The two predicates differ by one conjunct
         -- and both produce a feed that looks plausible. The `e.is_online IS TRUE`
         -- conjunct is belt-and-braces so a stale/hand-edited theme key alone can never
         -- widen the feed. Pinned by DRAFT invariant
         -- I-2333-ONLINE-ONLY-CARVE-OUT-IS-FORMAT-SCOPED.
         OR (
              e.is_online IS TRUE
              AND lower(btrim(
                COALESCE(e.theme->'business_event'->>'format', ''),
                E' \t\n\r\f\v' || chr(160)
              )) = 'online'
            )
      )
      AND (p_upper_start IS NULL OR ed.start_at <= p_upper_start)
      AND (p_party_types IS NULL OR cardinality(p_party_types) = 0 OR e.party_types && p_party_types)
      AND (p_vibe_tags IS NULL OR cardinality(p_vibe_tags) = 0 OR e.vibe_tags && p_vibe_tags)
      AND (p_music_genres IS NULL OR cardinality(p_music_genres) = 0 OR e.music_genres && p_music_genres)
  ),
  gated AS (
    SELECT *
    FROM base
    WHERE NOT (has_paid_online AND NOT public.pg_brand_can_collect(brand_id))
  ),
  ranked AS (
    SELECT
      g.*,
      COUNT(*) OVER () AS total_count
    FROM gated g
    ORDER BY master_start_at ASC NULLS LAST
    OFFSET GREATEST(p_offset, 0)
    LIMIT GREATEST(p_limit, 0)
  )
  SELECT jsonb_build_object(
    'total', COALESCE((SELECT total_count FROM ranked LIMIT 1), 0),
    'rows', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', r.id,
            'brand_id', r.brand_id,
            'title', r.title,
            'description', r.description,
            'slug', r.slug,
            'location_text', r.location_text,
            'location_geo', r.location_geo,
            'online_url', r.online_url,
            'is_online', r.is_online,
            'cover_media_url', r.cover_media_url,
            'cover_media_type', r.cover_media_type,
            'theme', r.theme,
            'timezone', r.timezone,
            'currency', r.currency,
            'city', r.city,
            'party_types', r.party_types,
            'vibe_tags', r.vibe_tags,
            'music_genres', r.music_genres,
            'event_type', r.event_type,
            'brand_slug', r.brand_slug,
            'brand_name', r.brand_name,
            'brand_profile_photo_url', r.brand_profile_photo_url,
            'master_start_at', r.master_start_at,
            'master_end_at', r.master_end_at,
            'master_timezone', r.master_timezone,
            'price_min_cents', r.price_min_cents,
            'price_max_cents', r.price_max_cents,
            'display_price_cents', r.display_price_cents,
            'pricing_currency', r.pricing_currency
          )
          ORDER BY r.master_start_at ASC NULLS LAST
        )
        FROM ranked r
      ),
      '[]'::jsonb
    )
  );
$function$;

COMMIT;

NOTIFY pgrst, 'reload schema';
