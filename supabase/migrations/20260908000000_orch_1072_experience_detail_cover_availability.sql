-- ORCH-1072 [experience-detail-cover-availability] — supply the consumer deck
-- with everything a brand experience needs to render + book correctly:
--   1. the experience's REAL cover (events.cover_media_url + cover_media_type),
--      not the fabricated first-stop image (fixes investigation symptom #1).
--   2. the REAL description (events.description), not the one-line tagline
--      (fixes investigation symptom #2).
--   3. UPCOMING OCCURRENCES — a jsonb array of the experience's future
--      event_dates, each with remaining capacity, so the consumer Book sheet can
--      offer a date picker (operator-locked: PICK FROM UPCOMING DATES; a one-off
--      single-date experience skips date-picking; sold-out occurrences disabled).
--
-- CHANGE: additive CREATE OR REPLACE of pg_eligible_experiences_for_deck
-- (ORCH-1065 → ORCH-1070). The RETURNS TABLE gains four columns; the WHERE /
-- ORDER BY / intent-gating / geo / one-sellable-ticket guards are UNCHANGED, so
-- the existing deck-eligibility behavior is byte-identical. Both edge envelopes
-- (discover-cards + generate-curated-experiences) are extended in the SAME
-- commit to carry the new columns identically (no parallel system).
--
-- CAPACITY MODEL (investigation §F — per-EVENT, not per-occurrence): the
-- experience has exactly ONE sellable online ticket (gated by the existing
-- EXISTS guard / I-1 ONE-TICKET). Its remaining = quantity_total − sold (or NULL
-- when unlimited/null-capacity), matching pg_public_ticket_types_remaining
-- (ORCH-0946) and biz_experience_sold_count (META-ORCH-1059): sold counts
-- tickets.status IN ('valid','used','transferred'). Every upcoming occurrence
-- therefore shows the SAME event-level remaining — there is no per-occurrence
-- cap in the schema, so we do NOT invent one (Constitution rule 9 — no
-- fabrication). `remaining = NULL` ⇒ unlimited (never sold-out); `remaining = 0`
-- ⇒ the occurrence renders disabled in the Book sheet.
--
-- OCCURRENCE SHAPE (per element of upcoming_occurrences, ordered start_at ASC):
--   { event_date_id uuid, start_at timestamptz, end_at timestamptz,
--     capacity int|null, sold int, remaining int|null }
-- Capped to the next 12 future occurrences (end_at > p_now) so the payload stays
-- bounded for never-ends/recurring experiences.
--
-- Idempotent CREATE OR REPLACE; the trailing `;` ends the function body BEFORE
-- the GRANT (a prior ORCH broke CI migration-baseline by omitting it).
--
-- DOCS (per COMMS-0003 external-API-docs-verified — Postgres/Supabase):
--   jsonb_agg / jsonb_build_object:
--     https://www.postgresql.org/docs/current/functions-json.html
--   array overlap (&&):
--     https://www.postgresql.org/docs/current/functions-array.html
--   SECURITY DEFINER + search_path hardening:
--     https://supabase.com/docs/guides/database/functions#security-definer
--   RPC over PostgREST (supabase.rpc):
--     https://supabase.com/docs/reference/javascript/rpc
--
-- COMMS: COMMS-0002 (this migration + the ORCH-0863 C7 backend allowlist land in
--        the SAME commit). COMMS-0014/0016 (experiences book via the EXISTING
--        ticket-checkout-create — no parallel money fn). COMMS-0018 (no
--        place_pool / ai_signal_scores touch).
--
-- DO NOT run `supabase db push` from this skill — the orchestrator applies it
-- after the safe-migration protocol. Prefix 20260908000000 re-checked free
-- across all active worktrees + origin/main (max prior = 20260907000000,
-- ORCH-1070). Additive only: CREATE OR REPLACE FUNCTION; no destructive DDL.

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
