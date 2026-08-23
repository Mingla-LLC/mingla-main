-- =====================================================================================
-- Issue #2489 — address privacy is enforced at the SERVER boundary.
--
-- WHAT: one fail-closed predicate, referenced by every anon-reachable read path that
-- can emit an offering's location, so a host who turns on "Hide address until ticket
-- purchase" is not relying on a renderer to keep that promise.
--
-- WHY HERE AND NOT IN A CLIENT: the withheld values were already on the wire before any
-- renderer ran. A client-side check cannot close that, and app builds already installed
-- on phones cannot be patched by shipping new client code. Gating the server objects
-- corrects every consumer at once — mobile, buyer web, business web, SSR/Open Graph —
-- with no client change and no redeploy of anything but the database.
--
-- THE CLASS: the sibling slug RPCs (pg_public_event_by_slug,
-- pg_direct_event_checkout_bundle, pg_public_rsvp_by_slug, pg_public_experience_by_slug)
-- already implement this rule correctly. Four other anon-reachable objects did not, and
-- each implemented (or failed to implement) the rule independently. This migration
-- defines the rule ONCE and points all four at it, so they cannot drift apart again.
--
-- NOT DOING (deliberate, evidenced in the SPEC):
--   * No data migration. No row is edited. The defect is entirely in the read layer.
--   * No coordinate is derived, rounded, jittered or otherwise invented for a gated
--     offering. Missing is hidden, never faked (Constitution #9). A gated offering with
--     no city-level centroid renders as a venue-name + city text card and no map —
--     which is already exactly what the gated slug RPC returns for it today.
--   * city_geo is NOT gated. It is the privacy-safe city centroid by design and the
--     gated RPCs return it unconditionally.
--
-- ORDERING: strictly greater than 20270522002463. Collision-scanned against the anchor
-- checkout and all sibling worktrees under ~/Desktop/mingla-orchs/ immediately before
-- this file was created; nothing above 20270522002463 existed anywhere.
--
-- DEPLOY: `supabase db push` is NOT safe for this change. Six unapplied local migrations
-- from unrelated issues sit below it and a push would carry them along. Apply this file's
-- SQL alone, then insert only its history row, then re-read the live definitions and
-- confirm the gate symbol is present (a deploy command's exit code is not evidence).
-- =====================================================================================

BEGIN;

-- =====================================================================================
-- 1 — THE PREDICATE. Defined once; referenced by every gated site below.
--
-- FAILS CLOSED, and the cast is TOTAL:
--
--   key = true                  -> true  (withhold)   the gated case
--   key = false                 -> false (reveal)     the opted-out case
--   key ABSENT                  -> true  (withhold)   a legacy row must never leak
--   theme IS NULL               -> true  (withhold)
--   key present, NOT a boolean  -> true  (withhold)   AND THE READ DOES NOT RAISE
--
-- That last row is the reason this is a jsonb_typeof test rather than a bare
-- `(theme #>> path)::boolean`. `('garbage')::boolean` raises invalid input syntax, which
-- on this path would turn a privacy gate into a 500 on every public offering read. No
-- production row carries a non-boolean at that key today, so this is hardening rather
-- than a live fix — but nothing in the schema PREVENTS a future writer from putting a
-- string there, and a privacy gate must not be one bad write away from a site-wide
-- outage. Pinned by the fixture's non-boolean scenario.
--
-- Matches the semantics the correct sibling RPCs already implement, and the client
-- mappers' asBoolean(..., true) default, so all of them now share one rule.
-- =====================================================================================
CREATE OR REPLACE FUNCTION public.issue_2489_address_withheld(p_theme jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $function$
  SELECT CASE
           WHEN pg_catalog.jsonb_typeof(p_theme #> '{business_event,hideAddressUntilTicket}') = 'boolean'
             THEN (p_theme #>> '{business_event,hideAddressUntilTicket}')::boolean
           ELSE true
         END
$function$;

COMMENT ON FUNCTION public.issue_2489_address_withheld(jsonb) IS
  '#2489 — the single address-privacy predicate. TRUE means WITHHOLD. Fails closed on an '
  'absent key, a NULL theme, and any non-boolean value at the key, and never raises. '
  'Every anon-reachable read path that can emit an offering location references THIS '
  'function; do not re-implement the rule at a call site.';

-- Not SECURITY DEFINER: it runs with the caller's rights everywhere. events_public_view
-- is security_invoker, so anon evaluates the predicate itself and needs EXECUTE.
REVOKE ALL ON FUNCTION public.issue_2489_address_withheld(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.issue_2489_address_withheld(jsonb)
  TO anon, authenticated, service_role;

-- =====================================================================================
-- 2 — business_public_events_view.
--
-- Latest definer: 20270413001931_issue_1931_private_event_access.sql:642.
--
-- THREE columns change; every other column, its type and its ORDINAL POSITION are
-- byte-identical, because CREATE OR REPLACE VIEW cannot rename, retype or reorder and
-- because six consumers read this relation with `select("*")`. The withheld value
-- becomes NULL, which every one of those consumers already handles (each parses the pin
-- through a null-guarded parser and omits the map when it is absent). This is also why
-- a column-level REVOKE was rejected: `SELECT *` against a relation with a revoked
-- column raises permission denied, which would have hard-crashed the buyer-web event
-- page, the brand page and every social preview instead of degrading them honestly.
--
-- The `WITH (security_invoker = false)` reloption is RESTATED. A bare CREATE OR REPLACE
-- VIEW silently drops it (documented at 20270413001931:637-641). Definer rights are also
-- why the gate has to be an expression in the projection: this view does not inherit the
-- events RLS and cannot be fixed by a policy.
--
-- The theme vector is the one most likely to be missed: the structured street address
-- also lives at business_event.location.address inside the theme JSON, so nulling the
-- pin and the combined string alone would leave the address fully readable. `#-` removes
-- exactly that key. venueName survives so the venue card still renders, and
-- hideAddressUntilTicket survives so clients still know the state.
-- =====================================================================================
CREATE OR REPLACE VIEW public.business_public_events_view WITH (security_invoker = false) AS
  SELECT e.id,
    e.brand_id,
    b.slug AS brand_slug,
    b.name AS brand_name,
    b.description AS brand_description,
    b.profile_photo_url AS brand_profile_photo_url,
    b.display_attendee_count AS brand_display_attendee_count,
    b.address AS brand_address,
    b.cover_media_url AS brand_cover_media_url,
    b.theme_color AS brand_theme_color,
    b.theme_font AS brand_theme_font,
    b.theme_animation AS brand_theme_animation,
    e.title,
    e.description,
    e.slug,
    e.event_type,
    -- #2489 vector 1 of 3 — the combined "Venue · Street" string.
    CASE WHEN public.issue_2489_address_withheld(e.theme) THEN NULL ELSE e.location_text END AS location_text,
    e.online_url,
    e.is_online,
    e.is_recurring,
    e.is_multi_date,
    e.recurrence_rules,
    e.cover_media_url,
    e.cover_media_type,
    e.visibility,
    e.show_on_discover,
    e.status,
    e.published_at,
    e.timezone,
    e.created_at,
    e.updated_at,
    -- #2489 vector 3 of 3 — the structured street address nested in the theme JSON.
    -- The pre-existing `- 'business_draft'` strip is preserved on BOTH branches.
    CASE WHEN public.issue_2489_address_withheld(e.theme)
         THEN ((e.theme - 'business_draft'::text) #- '{business_event,location,address}')
         ELSE  (e.theme - 'business_draft'::text)
    END AS public_theme,
    e.theme_color_override,
    e.theme_font_override,
    e.theme_animation_override,
    e.currency,
    e.cover_media_provider,
    e.cover_media_source_url,
    e.cover_media_credit,
    e.cover_media_credit_url,
    e.cover_media_alt,
    ed.start_at AS master_start_at,
    ed.end_at AS master_end_at,
    ed.timezone AS master_timezone,
    ed.id AS master_event_date_id,
    e.city,
    e.party_types,
    e.vibe_tags,
    e.music_genres,
    -- #2489 vector 2 of 3 — the exact venue pin. Type is `point`; the CASE preserves it.
    CASE WHEN public.issue_2489_address_withheld(e.theme) THEN NULL ELSE e.location_geo END AS location_geo,
    COALESCE(e.pass_tax,         b.default_pass_tax)         AS pass_tax,
    COALESCE(e.pass_mingla_fee,  b.default_pass_mingla_fee)  AS pass_mingla_fee,
    COALESCE(e.pass_service_fee, b.default_pass_service_fee) AS pass_service_fee,
    b.pricing_region   AS pricing_region,
    b.pricing_currency AS pricing_currency,
    (e.pricing_locked_at IS NOT NULL) AS pricing_locked,
    (
      SELECT public.compute_all_in_cents(
               MIN(tt.price_cents),
               COALESCE(e.pass_mingla_fee,  b.default_pass_mingla_fee),
               COALESCE(e.pass_service_fee, b.default_pass_service_fee),
               (SELECT r.effective_take_rate_bps FROM public.resolve_effective_take_rate_bps(b.id) r)
             )
      FROM public.ticket_types tt
      WHERE tt.event_id = e.id
        AND tt.price_cents > 0
        AND tt.deleted_at IS NULL
    ) AS display_price_cents,
    -- ORCH-1150 RSVP host-control columns (inert for non-RSVP rows).
    e.rsvp_discoverable,
    e.rsvp_capacity,
    e.rsvp_allow_plus_ones,
    e.rsvp_plus_ones_max,
    e.rsvp_waitlist_enabled,
    e.rsvp_approval_mode,
    (
      SELECT COALESCE(SUM(1 + r.plus_count), 0)::integer
      FROM public.event_rsvps r
      WHERE r.event_id = e.id
        AND r.rsvp_status = 'going'
        AND r.approval_status = 'approved'
    ) AS rsvp_going_count,
    -- ORCH-1167 — city-level privacy centroid. Deliberately NOT gated by #2489: it is
    -- the privacy-safe value, and the correctly-gated RPCs return it unconditionally.
    e.city_geo,
    -- ORCH-1291 [rsvp-chip-in] — voluntary contribution config.
    e.rsvp_contribution_enabled,
    e.rsvp_contribution_suggested_cents,
    e.rsvp_contribution_min_cents,
    -- issue #868 [cover-gallery] — ADDITIONAL image/GIF gallery items.
    e.cover_media_gallery
   FROM events e
     JOIN brands b ON b.id = e.brand_id
     LEFT JOIN event_dates ed ON ed.event_id = e.id AND ed.is_master = true
  WHERE e.deleted_at IS NULL
    AND b.deleted_at IS NULL
    AND e.visibility = 'public'::text
    AND (e.status = ANY (ARRAY['scheduled'::text, 'live'::text, 'ended'::text, 'cancelled'::text]))
    AND NOT public.issue_1931_event_ordinary_read_blocked(e.id);

COMMENT ON VIEW public.business_public_events_view IS
  '#2489 — anon-readable public offering read model. location_text, location_geo and the '
  'theme''s business_event.location.address are withheld whenever '
  'issue_2489_address_withheld(theme) is true. city_geo is exempt by design. Do not '
  're-emit this view without the gate, and do not re-implement the predicate inline.';

-- =====================================================================================
-- 3 — events_public_view.
--
-- Latest definer: 20270413001931_issue_1931_private_event_access.sql:607.
--
-- Same class, same treatment. This view additionally exposed the RAW `theme` column —
-- including the host's unpublished `business_draft` blob, which has no business reaching
-- an anon caller at all — so the strip mirrors the business view's: drop business_draft
-- unconditionally, and drop the street address when the gate says withhold.
--
-- `WITH ("security_invoker"='true')` is RESTATED for the same reason as above.
-- =====================================================================================
CREATE OR REPLACE VIEW "public"."events_public_view" WITH ("security_invoker"='true') AS
 SELECT "id",
    "brand_id",
    "title",
    "description",
    "slug",
    CASE WHEN "public"."issue_2489_address_withheld"("theme") THEN NULL ELSE "location_text" END AS "location_text",
    CASE WHEN "public"."issue_2489_address_withheld"("theme") THEN NULL ELSE "location_geo" END AS "location_geo",
    "online_url",
    "is_online",
    "is_recurring",
    "is_multi_date",
    "recurrence_rules",
    "cover_media_url",
    "cover_media_type",
    CASE WHEN "public"."issue_2489_address_withheld"("theme")
         THEN (("theme" - 'business_draft'::"text") #- '{business_event,location,address}')
         ELSE  ("theme" - 'business_draft'::"text")
    END AS "theme",
    "organiser_contact",
    "visibility",
    "show_on_discover",
    "show_in_swipeable_deck",
    "status",
    "published_at",
    "timezone",
    "created_at",
    "updated_at"
   FROM "public"."events"
  WHERE (("deleted_at" IS NULL) AND ("visibility" = 'public'::"text") AND ("status" = ANY (ARRAY['scheduled'::"text", 'live'::"text"]))
    AND NOT "public"."issue_1931_event_ordinary_read_blocked"("id"));

COMMENT ON VIEW public.events_public_view IS
  '#2489 — anon-readable event read model. location_text, location_geo and the theme''s '
  'business_event.location.address are withheld whenever '
  'issue_2489_address_withheld(theme) is true, and the host''s unpublished business_draft '
  'blob is stripped unconditionally.';

-- =====================================================================================
-- 4 — pg_discover_business_events.
--
-- Latest definer: 20270427002335_issue_2333_discover_online_carveout.sql:77.
-- Re-emitted forward from that body; the ONLY change is the three gated projection keys.
--
-- This is an anon-EXECUTABLE LIST endpoint — no slug required. It returns no rows today
-- only because of a data condition, not because of a gate; the defect is in the shipped
-- object and a single host action would have exposed it. Latent, not theoretical.
--
-- Runs under `SET search_path TO ''`, so the predicate is public.-qualified, exactly as
-- every other symbol in this body already is.
-- =====================================================================================
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
      --
      -- #2489: this arm reads e.location_geo to decide MEMBERSHIP. That is a
      -- server-side computation whose result is a row, not a coordinate — a gated
      -- event still belongs to the market it is physically in, and suppressing it
      -- from the feed would be a discovery regression rather than a privacy fix.
      -- The pin is withheld from the OUTPUT below, which is where it leaked.
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
            -- #2489 — the three vectors, gated by the one shared predicate.
            'location_text', CASE WHEN public.issue_2489_address_withheld(r.theme) THEN NULL ELSE r.location_text END,
            'location_geo',  CASE WHEN public.issue_2489_address_withheld(r.theme) THEN NULL ELSE r.location_geo  END,
            'online_url', r.online_url,
            'is_online', r.is_online,
            'cover_media_url', r.cover_media_url,
            'cover_media_type', r.cover_media_type,
            'theme', CASE WHEN public.issue_2489_address_withheld(r.theme)
                          THEN ((r.theme - 'business_draft') #- '{business_event,location,address}')
                          ELSE  (r.theme - 'business_draft')
                     END,
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

-- =====================================================================================
-- 5 — pg_public_brand_upcoming.
--
-- Latest definer: 20270413001931_issue_1931_private_event_access.sql:1606.
-- Re-emitted forward from that body; the ONLY change is the gated `theme` projection.
--
-- Its return signature carries no location_geo / location_text column, so the theme is
-- its only vector — but it projected `e.theme` RAW, stripping neither the street address
-- nor the host's unpublished `business_draft` blob. Both are closed here. The draft
-- strip is unconditional: an anon caller has no claim on a host's unpublished content
-- regardless of the address question.
-- =====================================================================================
CREATE OR REPLACE FUNCTION public.pg_public_brand_upcoming(
  p_brand_slug text,
  p_cursor_at timestamptz DEFAULT now(),
  p_limit integer DEFAULT 30
)
RETURNS TABLE (
  offering_id uuid,
  brand_id uuid,
  brand_slug text,
  brand_name text,
  offering_type text,
  offering_slug text,
  title text,
  description text,
  cover_media_url text,
  cover_media_type text,
  theme jsonb,
  starts_at timestamptz,
  price_from_cents bigint,
  currency text,
  is_free boolean,
  published_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  WITH offerings AS (
    SELECT
      e.id AS offering_id,
      e.brand_id,
      b.slug AS brand_slug,
      b.name AS brand_name,
      e.event_type AS offering_type,
      e.slug AS offering_slug,
      e.title,
      e.description,
      e.cover_media_url,
      e.cover_media_type,
      e.theme,
      CASE e.event_type
        WHEN 'event' THEN ed.start_at
        WHEN 'rsvp' THEN ed.start_at
        WHEN 'trip' THEN ed.start_at
        WHEN 'experience' THEN NULLIF(e.theme->'experience_meta'->>'next_occurrence_at', '')::timestamptz
      END AS starts_at,
      (
        SELECT min(tt.price_cents)
        FROM public.ticket_types tt
        WHERE tt.event_id = e.id
          AND tt.deleted_at IS NULL
          AND tt.is_hidden IS NOT TRUE
          AND tt.is_disabled IS NOT TRUE
      ) AS price_from_cents,
      e.currency::text AS currency,
      (
        SELECT NOT EXISTS (
          SELECT 1
          FROM public.ticket_types tt
          WHERE tt.event_id = e.id
            AND tt.deleted_at IS NULL
            AND tt.price_cents > 0
        )
      ) AS is_free,
      e.published_at
    FROM public.events e
    JOIN public.brands b ON b.id = e.brand_id
    LEFT JOIN public.event_dates ed ON ed.event_id = e.id AND ed.is_master = true
    WHERE b.slug = p_brand_slug
      AND b.deleted_at IS NULL
      AND e.deleted_at IS NULL
      AND e.visibility = 'public'
      AND e.published_at IS NOT NULL
      AND e.status IN ('scheduled', 'live')
      AND NOT public.issue_1931_event_ordinary_read_blocked(e.id)
      AND (
        NOT EXISTS (
          SELECT 1 FROM public.ticket_types tt
           WHERE tt.event_id = e.id
             AND tt.available_online = true
             AND tt.deleted_at IS NULL
             AND tt.price_cents > 0
        )
        OR public.pg_brand_can_collect(e.brand_id)
      )
  )
  SELECT
    o.offering_id,
    o.brand_id,
    o.brand_slug,
    o.brand_name,
    o.offering_type,
    o.offering_slug,
    o.title,
    o.description,
    o.cover_media_url,
    o.cover_media_type,
    -- #2489 — the only vector this signature exposes. business_draft is stripped on
    -- BOTH branches; the street address additionally on the withheld branch.
    CASE WHEN public.issue_2489_address_withheld(o.theme)
         THEN ((o.theme - 'business_draft'::text) #- '{business_event,location,address}')
         ELSE  (o.theme - 'business_draft'::text)
    END AS theme,
    o.starts_at,
    o.price_from_cents,
    o.currency,
    o.is_free,
    o.published_at
  FROM offerings o
  WHERE o.starts_at IS NOT NULL
    AND o.starts_at > COALESCE(p_cursor_at, now())
  ORDER BY o.starts_at ASC, o.published_at DESC
  LIMIT (LEAST(GREATEST(COALESCE(p_limit, 30), 1), 100) + 1);
$function$;

COMMIT;

NOTIFY pgrst, 'reload schema';
