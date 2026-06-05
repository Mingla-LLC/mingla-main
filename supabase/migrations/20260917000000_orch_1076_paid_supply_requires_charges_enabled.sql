-- ===========================================================================
-- ORCH-1076 [paid-readiness-supply-and-publish-banners] · Stream A
--   Buyer-facing SUPPLY suppression — the serve-time mirror of ORCH-1075's
--   publish-time guards and the ticket-checkout-create 409.
-- ===========================================================================
--
-- ORCH-1075 stopped a not-ready brand (stripe_connect_accounts.charges_enabled
-- = false) from PUBLISHING a paid offering, and the checkout already 409s
-- (stripe_account_not_ready) if someone tries to buy one. Stream A closes the
-- gap in the middle: a PAID offering from a brand that cannot charge must never
-- APPEAR to a buyer in the first place. This migration adds ONE consistent
-- predicate -- "the offering is FREE, OR the brand can charge" -- to the five
-- buyer-facing supply RPCs, reusing the exact ORCH-1075 pg_brand_can_charge()
-- predicate so discovery, publish, and checkout all enforce the identical rule
-- (Constitution #13: the same rules in generation and serving).
--
-- New invariant: I-PAID-SUPPLY-REQUIRES-CHARGES-ENABLED.
--
-- PAID = ticket_types row with available_online = true AND deleted_at IS NULL
--   AND price_cents > 0 (the same definition the checkout reads + ORCH-1075).
--   FREE offerings and in-person-only paid offerings (available_online = false)
--   are EXEMPT -- they never sell through the online checkout, so they can never
--   hit the 409. Owner / business / admin reads are NEVER gated (those read the
--   events table directly, not these public-supply RPCs) -- the owner MUST keep
--   seeing their own not-ready listing so they can finish onboarding.
--
-- Stripe field semantics (COMMS-0003, external-API docs cited inline):
--   charges_enabled = "Whether the account can process charges."
--     https://docs.stripe.com/api/accounts/object
--   Accounts with outstanding requirements have charges_enabled=false and must
--     be directed to finish onboarding:
--     https://docs.stripe.com/connect/onboarding.md
--   PostgreSQL CREATE FUNCTION / SECURITY DEFINER:
--     https://www.postgresql.org/docs/current/sql-createfunction.html
--   Supabase RPC over PostgREST (anon/authenticated grants):
--     https://supabase.com/docs/guides/database/functions
--
-- Self-healing: every gated object is a LIVE function (STABLE, re-evaluated per
-- query). pg_brand_can_charge reads the SOURCE column
-- stripe_connect_accounts.charges_enabled, which the B2A onboarding trigger
-- chain flips true on Stripe completion and false on detach. Because no gated
-- object is materialised (business_public_events_view is a PLAIN view --
-- grep-confirmed + pg_matviews probe 2026-06-04 returned empty), the listing
-- reappears the moment readiness flips and auto-hides if a brand later loses
-- capability. NO backfill, NO cron, NO matview refresh.
--
-- ORCH-1076: do NOT add a readiness filter to business_public_events_view --
-- it serves keyed enrich (theme / price / connections) as well as discovery;
-- gating the view would null out price/theme for legitimately-chosen events.
-- Gate per-caller instead (see SPEC §3.B full reader enumeration).
--
-- All functions are CREATE OR REPLACE -- idempotent, no destructive DDL, no
-- data backfill, no column changes, no pre-flight RAISE guards against existing
-- rows. Safe to re-run. Each of the five supply RPCs is re-emitted VERBATIM
-- from its latest-defining migration (confirmed via grep-all -> sort ->
-- read-newest, 2026-06-04; matches origin/main + remote) plus ONLY the readiness
-- WHERE branch. Every existing comment, the ORCH-1070 strict-intent logic, the
-- ORCH-1072 cover/availability columns, the display_price_cents side-fetch, and
-- all grants are preserved untouched.
--
-- Monotonic: 20260917000000 > TRUE remote head. `supabase migration list
-- --linked` (2026-06-04) shows the max applied LOCAL+REMOTE prefix is
-- 20260911000000 (ORCH-1075) and two REMOTE-ONLY versions 20260915000000 +
-- 20260916000000 (META-ORCH-1076 paystack-nigeria, applied-to-remote-not-on-main
-- per COMMS-0019). 20260917000000 is strictly above all of them and above every
-- sibling-worktree + origin/main migration. Do NOT hardcode below the
-- remote-only head.
--
-- C7 backend allowlist (ORCH_1076_BACKEND_ALLOWLIST) updated in the SAME commit
-- (COMMS-0002). Strict-grep gate orch-1076-paid-supply-requires-charges-enabled
-- asserts the pg_brand_can_charge( marker stays in each of the five RPC bodies
-- (fails-on-revert).
--
-- DO NOT run `supabase db push` from the implementor skill -- the orchestrator
-- applies it after review.
-- ===========================================================================

BEGIN;

-- ===========================================================================
-- A-0. Batched readiness helper -- pg_brands_can_charge(uuid[])
-- ---------------------------------------------------------------------------
-- The edge function (discover-merged-events) + service-layer post-fetch filters
-- cannot express pg_brand_can_charge() inline in a PostgREST query, so they
-- resolve N brands in ONE round-trip via this set-returning helper. Returns the
-- subset of the input brand ids whose brand CAN charge.
--   Stripe charges_enabled: https://docs.stripe.com/api/accounts/object
--   Supabase RPC over PostgREST: https://supabase.com/docs/guides/database/functions
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.pg_brands_can_charge(p_brand_ids uuid[])
RETURNS TABLE (brand_id uuid)
LANGUAGE sql
STABLE
AS $$
  SELECT bid
  FROM unnest(p_brand_ids) AS bid
  WHERE public.pg_brand_can_charge(bid);
$$;

COMMENT ON FUNCTION public.pg_brands_can_charge(uuid[]) IS
  'ORCH-1076 I-PAID-SUPPLY-REQUIRES-CHARGES-ENABLED: batched readiness resolver. Returns the subset of p_brand_ids whose brand can charge (pg_brand_can_charge=true). Used by discover-merged-events + service-layer post-fetch filters to gate paid buyer-supply in one round-trip. Reads the SOURCE column stripe_connect_accounts.charges_enabled via pg_brand_can_charge.';

GRANT EXECUTE ON FUNCTION public.pg_brands_can_charge(uuid[]) TO anon, authenticated, service_role;

-- ===========================================================================
-- A-0b. anon grant on pg_brand_can_charge(uuid)
-- ---------------------------------------------------------------------------
-- The deep-link experience/event resolvers (publicExperienceService /
-- publicEventsService) run ANON for a logged-out share-link visitor and call
-- pg_brand_can_charge directly to compute the bookable flag. ORCH-1075 granted
-- EXECUTE to authenticated only; extend to anon. The function reads only
-- stripe_connect_accounts via a single-row EXISTS and returns a boolean -- it
-- exposes NO row data to the caller, so anon-grant leaks nothing (mirrors the
-- anon-safe posture of the SECURITY-DEFINER supply RPCs).
-- ===========================================================================
GRANT EXECUTE ON FUNCTION public.pg_brand_can_charge(uuid) TO anon;

-- ===========================================================================
-- A-1. pg_eligible_experiences_for_deck -- consumer swipe deck (HIDE)
-- ---------------------------------------------------------------------------
-- Re-emitted VERBATIM from its latest definer
--   20260908000000_orch_1072_experience_detail_cover_availability.sql:68
-- plus ONLY the readiness branch added to the `eligible` CTE WHERE (after the
-- AND e.id <> ALL(p_exclude_ids) line). Return type unchanged -> CREATE OR
-- REPLACE is sufficient (no DROP). Preserves the ORCH-1070 strict-intent gate,
-- the ORCH-1072 cover/availability columns + display_price_cents side-fetch.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.pg_eligible_experiences_for_deck(p_lat double precision, p_lng double precision, p_radius_m double precision, p_intents text[], p_now timestamp with time zone, p_exclude_ids uuid[], p_limit integer)
 RETURNS TABLE(event_id uuid, event_slug text, title text, experience_intents text[], tagline text, description text, cover_media_url text, cover_media_type text, currency text, timezone text, brand_id uuid, brand_name text, brand_slug text, brand_logo_url text, master_date_utc timestamp with time zone, master_end_at_utc timestamp with time zone, total_price_cents integer, stops jsonb, upcoming_occurrences jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH eligible AS (
    SELECT
      e.id,
      e.slug,
      e.title,
      e.experience_intents,
      e.currency,
      e.timezone,
      e.brand_id,
      -- per-event soonest FUTURE master/active date (next-occurring first):
      (
        SELECT ed.start_at
        FROM public.event_dates ed
        WHERE ed.event_id = e.id
          AND ed.end_at > p_now
        ORDER BY ed.start_at ASC
        LIMIT 1
      ) AS next_start_at,
      (
        SELECT ed.end_at
        FROM public.event_dates ed
        WHERE ed.event_id = e.id
          AND ed.end_at > p_now
        ORDER BY ed.start_at ASC
        LIMIT 1
      ) AS next_end_at,
      e.published_at,
      -- best-effort per-event tagline from theme.experience_meta (honest '' default):
      COALESCE(e.theme -> 'experience_meta' ->> 'tagline', '') AS tagline,
      -- ORCH-1072: the experience's REAL description + cover (honest defaults —
      -- never fabricated; an empty description stays '' and the client shows
      -- its empty-state, NOT the tagline):
      COALESCE(e.description, '')        AS description,
      e.cover_media_url                  AS cover_media_url,
      e.cover_media_type                 AS cover_media_type,
      -- the single sellable all-in ticket the ORCH-1006 engine reads (I-1):
      (
        SELECT tt.id
        FROM public.ticket_types tt
        WHERE tt.event_id = e.id
          AND tt.available_online = true
          AND tt.deleted_at IS NULL
        ORDER BY tt.price_cents ASC, tt.id ASC
        LIMIT 1
      ) AS sellable_ticket_id,
      (
        SELECT tt.price_cents
        FROM public.ticket_types tt
        WHERE tt.event_id = e.id
          AND tt.available_online = true
          AND tt.deleted_at IS NULL
        ORDER BY tt.price_cents ASC, tt.id ASC
        LIMIT 1
      ) AS ticket_price_cents,
      -- ORCH-1072: the ONE sellable ticket's remaining capacity (event-level —
      -- per-occurrence cap is not in the schema). NULL ⇒ unlimited; matches
      -- pg_public_ticket_types_remaining (ORCH-0946) sold formula.
      (
        SELECT
          CASE
            WHEN tt.is_unlimited THEN NULL
            WHEN tt.quantity_total IS NULL THEN NULL
            ELSE GREATEST(
              tt.quantity_total - COALESCE((
                SELECT COUNT(*)
                FROM public.tickets tk
                WHERE tk.ticket_type_id = tt.id
                  AND tk.status IN ('valid', 'used', 'transferred')
              ), 0),
              0
            )::int
          END
        FROM public.ticket_types tt
        WHERE tt.event_id = e.id
          AND tt.available_online = true
          AND tt.deleted_at IS NULL
        ORDER BY tt.price_cents ASC, tt.id ASC
        LIMIT 1
      ) AS ticket_remaining,
      (
        SELECT tt.quantity_total
        FROM public.ticket_types tt
        WHERE tt.event_id = e.id
          AND tt.available_online = true
          AND tt.deleted_at IS NULL
        ORDER BY tt.price_cents ASC, tt.id ASC
        LIMIT 1
      ) AS ticket_capacity,
      (
        SELECT COALESCE((
          SELECT COUNT(*)
          FROM public.tickets tk
          WHERE tk.ticket_type_id = tt.id
            AND tk.status IN ('valid', 'used', 'transferred')
        ), 0)::int
        FROM public.ticket_types tt
        WHERE tt.event_id = e.id
          AND tt.available_online = true
          AND tt.deleted_at IS NULL
        ORDER BY tt.price_cents ASC, tt.id ASC
        LIMIT 1
      ) AS ticket_sold,
      -- the all-in display price (tax/fee-inclusive) when the public view exposes it:
      (
        SELECT v.display_price_cents
        FROM public.business_public_events_view v
        WHERE v.id = e.id
        LIMIT 1
      ) AS display_price_cents
    FROM public.events e
    WHERE e.event_type   = 'experience'
      AND e.visibility   = 'public'
      AND e.status       = 'scheduled'
      AND e.published_at IS NOT NULL
      AND e.deleted_at   IS NULL
      AND e.experience_intents IS NOT NULL
      AND array_length(e.experience_intents, 1) >= 1
      -- future master/active date (mirrors i-discover-excludes-ended-master-date):
      AND EXISTS (
        SELECT 1 FROM public.event_dates ed
        WHERE ed.event_id = e.id
          AND ed.end_at > p_now
      )
      -- exactly the one sellable ticket the all-in engine reads (gates unsellable drafts):
      AND EXISTS (
        SELECT 1 FROM public.ticket_types tt
        WHERE tt.event_id = e.id
          AND tt.available_online = true
          AND tt.deleted_at IS NULL
      )
      -- intent overlap with the user's active deck signals; empty p_intents ⇒ no intent filter:
      AND e.experience_intents && p_intents  -- ORCH-1070: STRICT — only surface for a SELECTED matching vibe (no permissive)
      -- geo: ≥1 stop within p_radius_m metres of the user (haversine fallback — no extension):
      AND EXISTS (
        SELECT 1 FROM public.experience_stops s
        WHERE s.event_id = e.id
          AND s.lat IS NOT NULL
          AND s.lng IS NOT NULL
          AND (
            6371000.0 * 2.0 * ASIN(SQRT(
              POWER(SIN(RADIANS(s.lat - p_lat) / 2.0), 2) +
              COS(RADIANS(p_lat)) * COS(RADIANS(s.lat)) *
              POWER(SIN(RADIANS(s.lng - p_lng) / 2.0), 2)
            ))
          ) <= p_radius_m
      )
      AND e.id <> ALL(p_exclude_ids)
      -- ORCH-1076 I-PAID-SUPPLY-REQUIRES-CHARGES-ENABLED: paid-only Stripe-readiness gate (mirror of checkout 409 + ORCH-1075 publish guard). FREE + in-person-only-paid exempt. Buyer-facing only — owners read events directly.
      AND (
        NOT EXISTS (  -- offering is FREE / in-person-only → never gated
          SELECT 1 FROM public.ticket_types tt
           WHERE tt.event_id = e.id
             AND tt.available_online = true
             AND tt.deleted_at IS NULL
             AND tt.price_cents > 0
        )
        OR public.pg_brand_can_charge(e.brand_id)
      )
  ),
  stops_agg AS (
    SELECT
      s.event_id,
      jsonb_agg(
        jsonb_build_object(
          'stop_order',   s.stop_order,
          'place_id',     COALESCE(s.place_id, s.id::text),
          'place_name',   s.place_name,
          'address',      s.address,
          'image_urls',   to_jsonb(s.image_urls),
          'ai_description', s.ai_description,
          'lat',          s.lat,
          'lng',          s.lng,
          'price_cents',  s.price_cents
        )
        ORDER BY s.stop_order ASC
      ) AS stops
    FROM public.experience_stops s
    WHERE s.event_id IN (SELECT id FROM eligible)
    GROUP BY s.event_id
  ),
  -- ORCH-1072: the next ≤12 future occurrences per experience, each carrying the
  -- event-level capacity / sold / remaining of the ONE sellable ticket. The
  -- Book sheet renders this as the date picker (one-off → single element →
  -- auto-select; sold-out [remaining = 0] → disabled row).
  occurrences_agg AS (
    SELECT
      occ.event_id,
      jsonb_agg(
        jsonb_build_object(
          'event_date_id', occ.id,
          'start_at',      occ.start_at,
          'end_at',        occ.end_at,
          'capacity',      occ.ticket_capacity,
          'sold',          occ.ticket_sold,
          'remaining',     occ.ticket_remaining
        )
        ORDER BY occ.start_at ASC
      ) AS upcoming_occurrences
    FROM (
      SELECT
        ed.event_id,
        ed.id,
        ed.start_at,
        ed.end_at,
        el.ticket_capacity,
        el.ticket_sold,
        el.ticket_remaining,
        ROW_NUMBER() OVER (PARTITION BY ed.event_id ORDER BY ed.start_at ASC) AS rn
      FROM public.event_dates ed
      JOIN eligible el ON el.id = ed.event_id
      WHERE ed.end_at > p_now
    ) occ
    WHERE occ.rn <= 12
    GROUP BY occ.event_id
  )
  SELECT
    el.id                                   AS event_id,
    el.slug                                 AS event_slug,
    el.title,
    el.experience_intents,
    el.tagline,
    el.description,
    el.cover_media_url,
    el.cover_media_type,
    el.currency,
    COALESCE(el.timezone, 'UTC')            AS timezone,
    el.brand_id,
    b.name                                  AS brand_name,
    b.slug                                  AS brand_slug,
    b.profile_photo_url                     AS brand_logo_url,
    el.next_start_at                        AS master_date_utc,
    el.next_end_at                          AS master_end_at_utc,
    -- prefer the all-in display price; fall back to the raw ticket price:
    COALESCE(el.display_price_cents, el.ticket_price_cents, 0) AS total_price_cents,
    COALESCE(sa.stops, '[]'::jsonb)         AS stops,
    COALESCE(oa.upcoming_occurrences, '[]'::jsonb) AS upcoming_occurrences
  FROM eligible el
  JOIN public.brands b ON b.id = el.brand_id
  LEFT JOIN stops_agg sa ON sa.event_id = el.id
  LEFT JOIN occurrences_agg oa ON oa.event_id = el.id
  WHERE b.deleted_at IS NULL
  ORDER BY el.next_start_at ASC NULLS LAST, el.published_at DESC
  LIMIT LEAST(GREATEST(p_limit, 0), 30);
$function$;

GRANT EXECUTE ON FUNCTION public.pg_eligible_experiences_for_deck(double precision, double precision, double precision, text[], timestamptz, uuid[], integer) TO service_role;

-- ===========================================================================
-- A-2. pg_brand_experiences_for_place -- consumer claimed-venue place-card (HIDE)
-- ---------------------------------------------------------------------------
-- Re-emitted VERBATIM from 20260906000001_orch_1072_brand_experiences_for_place.sql:16
-- plus ONLY the readiness branch in the single WHERE (after e.deleted_at IS NULL,
-- before ORDER BY). Preserves anon/authenticated/service_role grant.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.pg_brand_experiences_for_place(p_place_pool_id uuid)
RETURNS TABLE(
  experience_id uuid,
  brand_id uuid,
  brand_slug text,
  brand_name text,
  experience_slug text,
  title text,
  description text,
  cover_media_url text,
  cover_media_type text,
  theme jsonb,
  venue_text text,
  next_occurrence_at timestamp with time zone,
  price_from_cents bigint,
  currency text,
  is_free boolean,
  published_at timestamp with time zone
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT
    e.id AS experience_id,
    e.brand_id,
    b.slug AS brand_slug,
    b.name AS brand_name,
    e.slug AS experience_slug,
    e.title,
    e.description,
    e.cover_media_url,
    e.cover_media_type::text AS cover_media_type,
    e.theme,
    (e.theme->'experience_meta'->>'venue_text')::text AS venue_text,
    NULLIF(e.theme->'experience_meta'->>'next_occurrence_at', '')::timestamptz AS next_occurrence_at,
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
  WHERE b.place_pool_id = p_place_pool_id
    AND b.claim_status = 'verified'
    AND b.deleted_at IS NULL
    AND e.event_type = 'experience'
    AND e.visibility = 'public'
    AND e.published_at IS NOT NULL
    AND e.deleted_at IS NULL
    -- ORCH-1076 I-PAID-SUPPLY-REQUIRES-CHARGES-ENABLED: paid-only Stripe-readiness gate (mirror of checkout 409 + ORCH-1075 publish guard). FREE + in-person-only-paid exempt. Buyer-facing only — owners read events directly.
    AND (
      NOT EXISTS (
        SELECT 1 FROM public.ticket_types tt
         WHERE tt.event_id = e.id
           AND tt.available_online = true
           AND tt.deleted_at IS NULL
           AND tt.price_cents > 0
      )
      OR public.pg_brand_can_charge(e.brand_id)
    )
  ORDER BY
    NULLIF(e.theme->'experience_meta'->>'next_occurrence_at', '')::timestamptz ASC NULLS LAST,
    e.published_at DESC;
$function$;

GRANT EXECUTE ON FUNCTION public.pg_brand_experiences_for_place(uuid) TO anon, authenticated, service_role;

-- ===========================================================================
-- A-3. pg_public_experiences_by_brand -- public brand-page experiences (HIDE)
-- ---------------------------------------------------------------------------
-- Re-emitted VERBATIM from 20260729000000_meta_orch_0972_universal_authoring.sql:344
-- plus ONLY the readiness branch (after e.deleted_at IS NULL, before ORDER BY).
-- Preserves REVOKE ALL FROM PUBLIC + GRANT anon, authenticated.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.pg_public_experiences_by_brand(p_brand_slug text)
RETURNS TABLE (
  experience_id uuid,
  brand_id uuid,
  brand_slug text,
  brand_name text,
  experience_slug text,
  title text,
  description text,
  cover_media_url text,
  theme jsonb,
  venue_text text,
  next_occurrence_at timestamptz,
  price_from_cents bigint,
  currency text,
  is_free boolean,
  published_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    e.id AS experience_id,
    e.brand_id,
    b.slug AS brand_slug,
    b.name AS brand_name,
    e.slug AS experience_slug,
    e.title,
    e.description,
    e.cover_media_url,
    e.theme,
    (e.theme->'experience_meta'->>'venue_text')::text AS venue_text,
    NULLIF(e.theme->'experience_meta'->>'next_occurrence_at', '')::timestamptz AS next_occurrence_at,
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
  WHERE b.slug = p_brand_slug
    AND b.deleted_at IS NULL
    AND e.event_type = 'experience'
    AND e.visibility = 'public'
    AND e.published_at IS NOT NULL
    AND e.deleted_at IS NULL
    -- ORCH-1076 I-PAID-SUPPLY-REQUIRES-CHARGES-ENABLED: paid-only Stripe-readiness gate (mirror of checkout 409 + ORCH-1075 publish guard). FREE + in-person-only-paid exempt. Buyer-facing only — owners read events directly.
    AND (
      NOT EXISTS (
        SELECT 1 FROM public.ticket_types tt
         WHERE tt.event_id = e.id
           AND tt.available_online = true
           AND tt.deleted_at IS NULL
           AND tt.price_cents > 0
      )
      OR public.pg_brand_can_charge(e.brand_id)
    )
  ORDER BY
    NULLIF(e.theme->'experience_meta'->>'next_occurrence_at', '')::timestamptz ASC NULLS LAST,
    e.published_at DESC;
$$;

REVOKE ALL ON FUNCTION public.pg_public_experiences_by_brand(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pg_public_experiences_by_brand(text) TO anon, authenticated;

-- ===========================================================================
-- A-4. pg_public_brand_upcoming -- public brand-page "upcoming" feed (HIDE)
-- ---------------------------------------------------------------------------
-- Re-emitted VERBATIM from 20260729000000_meta_orch_0972_universal_authoring.sql:414
-- plus ONLY the readiness branch in the `offerings` CTE WHERE (after
-- e.status IN (...)). The CTE spans event/trip/experience; the EXISTS-based
-- free-OR-can-charge predicate works uniformly for all three (PAID test reads
-- ticket_types). Preserves REVOKE ALL + GRANT anon, authenticated.
-- ===========================================================================
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
AS $$
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
      -- ORCH-1076 I-PAID-SUPPLY-REQUIRES-CHARGES-ENABLED: paid-only Stripe-readiness gate (mirror of checkout 409 + ORCH-1075 publish guard). FREE + in-person-only-paid exempt. Buyer-facing only — owners read events directly.
      AND (
        NOT EXISTS (
          SELECT 1 FROM public.ticket_types tt
           WHERE tt.event_id = e.id
             AND tt.available_online = true
             AND tt.deleted_at IS NULL
             AND tt.price_cents > 0
        )
        OR public.pg_brand_can_charge(e.brand_id)
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
    o.theme,
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
$$;

REVOKE ALL ON FUNCTION public.pg_public_brand_upcoming(text, timestamptz, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pg_public_brand_upcoming(text, timestamptz, integer) TO anon, authenticated;

-- ===========================================================================
-- A-5. pg_public_trips_by_brand -- public brand-page trips feed (HIDE, latent)
-- ---------------------------------------------------------------------------
-- Re-emitted VERBATIM from 20260729000000_meta_orch_0972_universal_authoring.sql:220
-- plus: (1) e.brand_id added to the trip_rows CTE select (additive, no
-- RETURNS-TABLE change); (2) a final readiness WHERE. "free tier" semantics for
-- trips differ: a trip can have BOTH free and paid tiers, and a buyer can still
-- book the free tier -> has_free_tier=true ⇒ NOT gated. min_price_cents IS NULL
-- ⇒ no priced tier at all ⇒ free/unsellable ⇒ NOT a paid leak. Only a trip whose
-- ALL priced tiers are paid AND the brand cannot charge is hidden.
-- Preserves REVOKE ALL + GRANT anon, authenticated + COMMENT.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.pg_public_trips_by_brand(
  p_brand_slug text
)
RETURNS TABLE (
  trip_id          uuid,
  trip_slug        text,
  brand_slug       text,
  title            text,
  description      text,
  destination_text text,
  cover_media_url  text,
  cover_media_type text,
  status           text,
  start_at         timestamptz,
  end_at           timestamptz,
  timezone         text,
  bookings_closed  boolean,
  total_capacity   integer,
  tickets_sold     integer,
  spots_left       integer,
  min_price_cents  integer,
  currency         text,
  has_free_tier    boolean,
  published_at     timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH brand AS (
    SELECT b.id, b.slug
    FROM public.brands b
    WHERE b.slug = p_brand_slug
      AND b.deleted_at IS NULL
  ),
  trip_rows AS (
    SELECT e.id, e.brand_id, e.slug, e.title, e.description, e.destination_text,
           e.cover_media_url, e.cover_media_type, e.status,
           e.timezone, e.bookings_closed, e.published_at
    FROM public.events e
    JOIN brand ON brand.id = e.brand_id
    WHERE e.event_type = 'trip'
      AND e.visibility = 'public'
      AND e.status IN ('scheduled', 'live', 'ended', 'cancelled')
      AND e.deleted_at IS NULL
  ),
  dates AS (
    SELECT ed.event_id, ed.start_at, ed.end_at
    FROM public.event_dates ed
    WHERE ed.event_id IN (SELECT id FROM trip_rows)
      AND ed.is_master = true
  ),
  capacity AS (
    SELECT tpt.event_id,
           bool_or(tt.is_unlimited) AS any_unlimited,
           SUM(tt.quantity_total)::int AS total_capacity
    FROM public.trip_pricing_tiers tpt
    JOIN public.ticket_types tt ON tt.id = tpt.ticket_type_id
    WHERE tpt.event_id IN (SELECT id FROM trip_rows)
      AND tt.deleted_at IS NULL
    GROUP BY tpt.event_id
  ),
  sold AS (
    SELECT tt.event_id, COUNT(*)::int AS tickets_sold
    FROM public.tickets t
    JOIN public.ticket_types tt ON tt.id = t.ticket_type_id
    WHERE tt.event_id IN (SELECT id FROM trip_rows)
      AND t.status IN ('valid', 'used', 'transferred')
    GROUP BY tt.event_id
  ),
  pricing AS (
    SELECT tpt.event_id,
           MIN(NULLIF(tt.price_cents, 0)) FILTER (WHERE NOT tt.is_free) AS min_price_cents,
           (ARRAY_AGG(tt.currency ORDER BY tt.price_cents ASC, tt.id ASC)
              FILTER (WHERE NOT tt.is_free))[1] AS currency,
           bool_or(tt.is_free) AS has_free_tier
    FROM public.trip_pricing_tiers tpt
    JOIN public.ticket_types tt ON tt.id = tpt.ticket_type_id
    WHERE tpt.event_id IN (SELECT id FROM trip_rows)
      AND tt.deleted_at IS NULL
    GROUP BY tpt.event_id
  )
  SELECT
    tr.id                    AS trip_id,
    tr.slug                  AS trip_slug,
    (SELECT slug FROM brand) AS brand_slug,
    tr.title,
    tr.description,
    tr.destination_text,
    tr.cover_media_url,
    tr.cover_media_type,
    tr.status,
    d.start_at,
    d.end_at,
    tr.timezone,
    tr.bookings_closed,
    CASE WHEN c.any_unlimited THEN NULL ELSE c.total_capacity END AS total_capacity,
    COALESCE(s.tickets_sold, 0) AS tickets_sold,
    CASE
      WHEN c.any_unlimited THEN NULL
      WHEN c.total_capacity IS NULL THEN NULL
      ELSE GREATEST(c.total_capacity - COALESCE(s.tickets_sold, 0), 0)
    END AS spots_left,
    p.min_price_cents,
    p.currency,
    COALESCE(p.has_free_tier, false) AS has_free_tier,
    tr.published_at
  FROM trip_rows tr
  LEFT JOIN dates    d ON d.event_id = tr.id
  LEFT JOIN capacity c ON c.event_id = tr.id
  LEFT JOIN sold     s ON s.event_id = tr.id
  LEFT JOIN pricing  p ON p.event_id = tr.id
  -- ORCH-1076 I-PAID-SUPPLY-REQUIRES-CHARGES-ENABLED: paid-only Stripe-readiness gate (mirror of checkout 409 + ORCH-1075 publish guard). A trip with ANY free tier (has_free_tier) or no priced tier (min_price_cents IS NULL) is bookable and NOT gated; only an all-paid-tier trip from a not-ready brand is hidden. Buyer-facing only — owners read events directly.
  WHERE (
    COALESCE(p.has_free_tier, false)
    OR p.min_price_cents IS NULL
    OR public.pg_brand_can_charge(tr.brand_id)
  )
  ORDER BY
    (CASE WHEN tr.status IN ('scheduled','live') THEN 0 ELSE 1 END),
    d.start_at NULLS LAST;
$$;

REVOKE ALL ON FUNCTION public.pg_public_trips_by_brand(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pg_public_trips_by_brand(text) TO anon, authenticated;

COMMENT ON FUNCTION public.pg_public_trips_by_brand(text) IS
  'META-ORCH-0972 Sub-C: anon-callable public trips by brand without brands.kind guard. Sold formula mirrors I-TRIP-SPOTS-MIRRORS-CAPACITY-GATE. ORCH-1076: gated on paid-only Stripe readiness (all-paid-tier trips from a not-ready brand are hidden; free-tier / no-priced-tier trips always shown).';

COMMIT;
