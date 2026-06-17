-- ORCH-1153 [experience-reserve-checkout-integrity] — WS2 consumer deck-supply
-- recurrence fields.
--
-- Widens BOTH consumer experience-supply RPCs to carry is_recurring +
-- recurrence_rules so the consumer surface can run the SAME rule-based open-daily
-- detector (isOpenDailyExperience) the buyer-web /exp/ page uses — replacing the
-- consumer's occurrence-density heuristic (F-5). Without these fields the
-- consumer detector reads undefined and silently regresses to "never open-daily".
--
--   * pg_eligible_experiences_for_deck — the SOLO swipe-deck supply (read
--     service-role by the discover-cards edge fn).
--   * pg_brand_experiences_for_place — the venue→experiences supply (read by
--     useVenueExperiences on the consumer).
--
-- COMMS-0029 / drift reconciliation (LOAD-BEARING): the LIVE PROD bodies of both
-- RPCs are the OLDER ORCH-1072 shape — the ORCH-1138 rework migration
-- (20261007000000_orch_1138_rework_deck_supply.sql) is committed to origin/main
-- but was NOT applied to prod (the 1148 migrations 20261008000000-3 ARE applied;
-- 1138's rework was skipped). The discover-cards edge fn + venueExperienceMapping
-- on main already READ the 1138-rework columns (brand_theme, city,
-- upcoming_occurrences). Therefore this migration re-emits FROM THE GIT-1138
-- BODY (the intended-latest), NOT the stale live-prod body — because
-- 20261007000000 sorts BEFORE 20261009000003 and will apply first, installing the
-- 1138-rework shape that this migration then extends. Re-emitting from the stale
-- live-prod body would CLOBBER the 1138 rework. (See report Discoveries.)
--
-- DROP-before-CREATE per the migration-baseline rule (RETURNS TABLE widened).

-- ---- pg_eligible_experiences_for_deck (git-1138 body + is_recurring/recurrence_rules) ----
DROP FUNCTION IF EXISTS public.pg_eligible_experiences_for_deck(
  double precision, double precision, double precision, text[], timestamptz, uuid[], integer
);

CREATE OR REPLACE FUNCTION public.pg_eligible_experiences_for_deck(p_lat double precision, p_lng double precision, p_radius_m double precision, p_intents text[], p_now timestamp with time zone, p_exclude_ids uuid[], p_limit integer)
 RETURNS TABLE(event_id uuid, event_slug text, title text, experience_intents text[], tagline text, description text, cover_media_url text, cover_media_type text, currency text, timezone text, brand_id uuid, brand_name text, brand_slug text, brand_logo_url text, master_date_utc timestamp with time zone, master_end_at_utc timestamp with time zone, total_price_cents integer, brand_theme jsonb, city text, stops jsonb, upcoming_occurrences jsonb, is_recurring boolean, recurrence_rules jsonb)
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
      -- ORCH-1153 WS2: recurrence fields for the consumer rule-based open-daily
      -- detector (isOpenDailyExperience). NULL recurrence_rules → not open-daily.
      e.is_recurring,
      e.recurrence_rules,
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
      -- ORCH-1138 rework (§4.A.2): the anon-safe resolved brand theme the consumer
      -- needs WITHOUT a client .from('brands') (COMMS-0009). Sourced from the
      -- business_public_events_view theme columns (same view useEventTheme reads).
      -- jsonb of {color, font, animation, color_override, font_override,
      -- animation_override} → the seed mapper feeds resolveTheme synchronously.
      (
        SELECT jsonb_build_object(
          'color',            v.brand_theme_color,
          'font',             v.brand_theme_font,
          'animation',        v.brand_theme_animation,
          'color_override',   v.theme_color_override,
          'font_override',    v.theme_font_override,
          'animation_override', v.theme_animation_override
        )
        FROM public.business_public_events_view v
        WHERE v.id = e.id
        LIMIT 1
      ) AS brand_theme,
      -- ORCH-1138 rework (§4.A.2): the first stop's city → the consumer
      -- City,Country meta chip (rule 9: NULL when no stop carries a city).
      (
        SELECT s.city
        FROM public.experience_stops s
        WHERE s.event_id = e.id
          AND NULLIF(btrim(s.city), '') IS NOT NULL
        ORDER BY s.stop_order ASC
        LIMIT 1
      ) AS city,
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
          'price_cents',  s.price_cents,
          'start_time',   s.start_time
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
    el.brand_theme                          AS brand_theme,
    el.city                                 AS city,
    COALESCE(sa.stops, '[]'::jsonb)         AS stops,
    COALESCE(oa.upcoming_occurrences, '[]'::jsonb) AS upcoming_occurrences,
    -- ORCH-1153 WS2: recurrence fields → consumer open-daily detector.
    el.is_recurring                         AS is_recurring,
    el.recurrence_rules                     AS recurrence_rules
  FROM eligible el
  JOIN public.brands b ON b.id = el.brand_id
  LEFT JOIN stops_agg sa ON sa.event_id = el.id
  LEFT JOIN occurrences_agg oa ON oa.event_id = el.id
  WHERE b.deleted_at IS NULL
  ORDER BY el.next_start_at ASC NULLS LAST, el.published_at DESC
  LIMIT LEAST(GREATEST(p_limit, 0), 30);
$function$
;

REVOKE ALL ON FUNCTION public.pg_eligible_experiences_for_deck(
  double precision, double precision, double precision, text[], timestamptz, uuid[], integer
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pg_eligible_experiences_for_deck(
  double precision, double precision, double precision, text[], timestamptz, uuid[], integer
) TO service_role;

-- ---- pg_brand_experiences_for_place (git-1138 body + is_recurring/recurrence_rules) ----
DROP FUNCTION IF EXISTS public.pg_brand_experiences_for_place(uuid);

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
  experience_intents text[],
  stops jsonb,
  upcoming_occurrences jsonb,
  published_at timestamp with time zone,
  is_recurring boolean,
  recurrence_rules jsonb
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
    -- ORCH-1138 rework (§4.A.3): the curated vibes → consumer vibe chips.
    e.experience_intents,
    -- ORCH-1138 rework (§4.A.3): the ordered stops (mirror the deck RPC stops
    -- shape) → per-stop count-aware galleries + map + START HERE/THEN/END WITH.
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'stop_order',     s.stop_order,
          'place_id',       COALESCE(s.place_id, s.id::text),
          'place_name',     s.place_name,
          'address',        s.address,
          'city',           s.city,
          'image_urls',     to_jsonb(s.image_urls),
          'ai_description', s.ai_description,
          'lat',            s.lat,
          'lng',            s.lng,
          'start_time',     s.start_time,
          'price_cents',    s.price_cents
        )
        ORDER BY s.stop_order ASC
      )
      FROM public.experience_stops s
      WHERE s.event_id = e.id
    ), '[]'::jsonb) AS stops,
    -- ORCH-1138 rework (§4.A.3): the next <=52 future occurrences (post-
    -- materializer) carrying the event-level capacity/sold/remaining of the ONE
    -- sellable ticket, so the venue->detail Reserve sees real bookable slots.
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'event_date_id', occ.id,
          'start_at',      occ.start_at,
          'end_at',        occ.end_at,
          'capacity',      occ.cap,
          'sold',          occ.sold,
          'remaining',     occ.remaining
        )
        ORDER BY occ.start_at ASC
      )
      FROM (
        SELECT
          ed.id, ed.start_at, ed.end_at,
          tcap.cap, tcap.sold, tcap.remaining,
          ROW_NUMBER() OVER (ORDER BY ed.start_at ASC) AS rn
        FROM public.event_dates ed
        CROSS JOIN LATERAL (
          SELECT
            tt.quantity_total AS cap,
            COALESCE((
              SELECT COUNT(*) FROM public.tickets tk
              WHERE tk.ticket_type_id = tt.id
                AND tk.status IN ('valid','used','transferred')
            ), 0)::int AS sold,
            CASE
              WHEN tt.is_unlimited THEN NULL
              WHEN tt.quantity_total IS NULL THEN NULL
              ELSE GREATEST(tt.quantity_total - COALESCE((
                SELECT COUNT(*) FROM public.tickets tk
                WHERE tk.ticket_type_id = tt.id
                  AND tk.status IN ('valid','used','transferred')
              ), 0), 0)::int
            END AS remaining
          FROM public.ticket_types tt
          WHERE tt.event_id = e.id
            AND tt.available_online = true
            AND tt.deleted_at IS NULL
          ORDER BY tt.price_cents ASC, tt.id ASC
          LIMIT 1
        ) tcap
        WHERE ed.event_id = e.id
          AND ed.end_at > now()
      ) occ
      WHERE occ.rn <= 12
    ), '[]'::jsonb) AS upcoming_occurrences,
    e.published_at,
    -- ORCH-1153 WS2: the recurrence fields the consumer rule-based open-daily
    -- detector (isOpenDailyExperience) needs. NULL recurrence_rules → not
    -- open-daily (the detector falls back to the flat slot list).
    e.is_recurring,
    e.recurrence_rules
  FROM public.events e
  JOIN public.brands b ON b.id = e.brand_id
  WHERE b.place_pool_id = p_place_pool_id
    AND b.claim_status = 'verified'
    AND b.deleted_at IS NULL
    AND e.event_type = 'experience'
    AND e.visibility = 'public'
    AND e.published_at IS NOT NULL
    AND e.deleted_at IS NULL
    -- ORCH-1076 I-PAID-SUPPLY-REQUIRES-CHARGES-ENABLED: paid-only Stripe-readiness gate (mirror of checkout 409 + ORCH-1075 publish guard). FREE + in-person-only-paid exempt. Buyer-facing only — owners read events directly. ORCH-1138 rework re-emitted the ORCH-1072 body verbatim, which predated this gate; restore it here (the WHERE widen must NOT drop the ORCH-1076 readiness branch).
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
$function$
;

GRANT EXECUTE ON FUNCTION public.pg_brand_experiences_for_place(uuid) TO anon, authenticated, service_role;
