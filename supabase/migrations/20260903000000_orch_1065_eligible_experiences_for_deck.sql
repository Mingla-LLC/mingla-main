-- ORCH-1065 [consumer-experience-deck-card]
-- Supply seam for surfacing brand-authored experiences on the CONSUMER swipe deck.
--
-- This SECURITY DEFINER RPC selects deck-eligible published-live experiences
-- near a user, intent-overlap-filtered, with each row carrying the brand
-- attribution + soonest future date + the single sellable ticket price + a
-- jsonb_agg of ordered stops, so the discover-cards edge function does ONE
-- round-trip (no N+1) and never touches place_pool / ai_signal_scores /
-- run-signal-scorer (the COMMS-0018 signal_id-buggy venue→deck path is bypassed
-- entirely by construction — this function reads `events` + `experience_stops`
-- directly).
--
-- Naming note (deviation from SPEC §3.2's locked `20260901000000`): on this
-- worktree's actual base, `20260901000000` is already taken by ORCH-1064
-- (orch_1064_venue_claim_feedback) and the remote migration head is
-- `20260902000000_meta_orch_1059_sub_e_update_live_experience`. To keep the
-- timestamp prefix STRICTLY GREATER than the max present (monotonic-migration
-- parity rule), this migration is named `20260903000000`. Verified via
-- `mcp__supabase__list_migrations` (remote head 20260902000000) +
-- ls of sibling worktrees (no 20260903* collision) at IMPLEMENT.
--
-- Geo note (deviation from SPEC §3.1.1's preferred `earthdistance`): the
-- `earthdistance`/`cube` extensions are NOT installed on this project
-- (`mcp__supabase__list_extensions` → installed_version null for both). Per the
-- SPEC's explicit D3 fallback ("If earthdistance is NOT enabled, fall back to a
-- haversine expression in plain SQL — no extension dependency"), the geo gate
-- uses the SAME haversine SQL pattern already used across this DB
-- (query_servable_places_by_signal, collab deck RPC, baseline). The predicate's
-- MEANING is unchanged: ≥1 stop within p_radius_m metres of the user.
--
-- Docs cited (COMMS-0003):
--   PostgreSQL CREATE FUNCTION / SECURITY DEFINER:
--     https://www.postgresql.org/docs/current/sql-createfunction.html
--   SECURITY DEFINER + search_path hardening (Supabase):
--     https://supabase.com/docs/guides/database/postgres/row-level-security#security-definer-functions
--   Supabase database functions (called via supabaseAdmin.rpc):
--     https://supabase.com/docs/guides/database/functions
--   jsonb_agg + ORDER BY inside an aggregate:
--     https://www.postgresql.org/docs/current/functions-aggregate.html
--   Trig functions used for the haversine fallback (RADIANS/SIN/COS/ASIN/SQRT):
--     https://www.postgresql.org/docs/current/functions-math.html

CREATE OR REPLACE FUNCTION public.pg_eligible_experiences_for_deck(
  p_lat        double precision,
  p_lng        double precision,
  p_radius_m   double precision,
  p_intents    text[],
  p_now        timestamptz,
  p_exclude_ids uuid[],
  p_limit      integer
)
RETURNS TABLE (
  event_id          uuid,
  event_slug        text,
  title             text,
  experience_intents text[],
  tagline           text,
  currency          text,
  timezone          text,
  brand_id          uuid,
  brand_name        text,
  brand_slug        text,
  brand_logo_url    text,
  master_date_utc   timestamptz,
  master_end_at_utc timestamptz,
  total_price_cents integer,
  stops             jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
      -- the single sellable all-in ticket the ORCH-1006 engine reads (I-1):
      (
        SELECT tt.price_cents
        FROM public.ticket_types tt
        WHERE tt.event_id = e.id
          AND tt.available_online = true
          AND tt.deleted_at IS NULL
        ORDER BY tt.price_cents ASC, tt.id ASC
        LIMIT 1
      ) AS ticket_price_cents,
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
      AND (p_intents = '{}'::text[] OR e.experience_intents && p_intents)
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
  )
  SELECT
    el.id                                   AS event_id,
    el.slug                                 AS event_slug,
    el.title,
    el.experience_intents,
    el.tagline,
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
    COALESCE(sa.stops, '[]'::jsonb)         AS stops
  FROM eligible el
  JOIN public.brands b ON b.id = el.brand_id
  LEFT JOIN stops_agg sa ON sa.event_id = el.id
  WHERE b.deleted_at IS NULL
  ORDER BY el.next_start_at ASC NULLS LAST, el.published_at DESC
  LIMIT LEAST(GREATEST(p_limit, 0), 30);
$$;

-- The discover-cards edge fn calls this service-role. No anon caller exists.
REVOKE ALL ON FUNCTION public.pg_eligible_experiences_for_deck(
  double precision, double precision, double precision, text[], timestamptz, uuid[], integer
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pg_eligible_experiences_for_deck(
  double precision, double precision, double precision, text[], timestamptz, uuid[], integer
) TO service_role;

COMMENT ON FUNCTION public.pg_eligible_experiences_for_deck(
  double precision, double precision, double precision, text[], timestamptz, uuid[], integer
) IS
  'ORCH-1065: service-role deck supply for brand-authored experiences. Returns '
  'published-live experiences (event_type=experience, visibility=public, '
  'status=scheduled, published_at NOT NULL) with a future event_date, exactly one '
  'available_online ticket (I-1), intent-overlap (permissive when p_intents={}), and '
  '>=1 stop within p_radius_m metres (haversine — earthdistance not installed). Each '
  'row carries brand attribution + soonest future date + all-in price + jsonb stops '
  'ordered by stop_order. Reads events + experience_stops directly; bypasses the '
  'venue-vetting deck-supply machinery entirely (COMMS-0018). Ordered by soonest '
  'future date, then published_at DESC.';

-- Supporting index for the per-event geo stop lookup in the EXISTS clauses.
CREATE INDEX IF NOT EXISTS experience_stops_latlng_idx
  ON public.experience_stops (event_id)
  WHERE lat IS NOT NULL AND lng IS NOT NULL;
