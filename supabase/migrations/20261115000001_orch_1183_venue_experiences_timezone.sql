-- ORCH-1183 [experience-standardize] — add the real timezone to the venue-card
-- experiences RPC so the consumer venue→experience SEED carries the experience's
-- actual IANA timezone (events.timezone) instead of the hardcoded "UTC" the mapper
-- fell back to (venueExperienceMapping.ts). The by-slug RPC already emits the real
-- timezone; this closes the same gap on the deck/venue seed path so the
-- per-occurrence date/start-time chips format in the correct zone on every entry.
--
-- LOAD-BEARING (COMMS-0029 lineage): this re-emits FROM THE LATEST git body —
-- 20261009000003 (ORCH-1153 WS2: stops/intents/upcoming_occurrences/is_recurring/
-- recurrence_rules) — NOT the stale ORCH-1072 body. Re-emitting the older body
-- would CLOBBER the 1138/1153 reworks the consumer mapper already reads.
--
-- pg_brand_experiences_for_place RETURNS TABLE → adding a column requires DROP +
-- CREATE (RETURNS-TABLE widening hazard). The new `timezone` column is APPENDED
-- last so the by-name mapper read is unaffected.
--
-- SAFE-MIGRATION PROTOCOL: SECURITY DEFINER, STABLE, schema-qualified, $function$
-- terminator before GRANT, GRANT EXECUTE re-asserted. MONOTONIC 20261115000001.
--
-- DO NOT auto-apply — orchestrator/Seth applies via the Management API post-merge.

DROP FUNCTION IF EXISTS public.pg_brand_experiences_for_place(uuid);

CREATE FUNCTION public.pg_brand_experiences_for_place(p_place_pool_id uuid)
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
  recurrence_rules jsonb,
  timezone text
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
    e.experience_intents,
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
    e.is_recurring,
    e.recurrence_rules,
    -- ORCH-1183 — the real experience timezone (NULL → the mapper keeps "UTC").
    e.timezone::text AS timezone
  FROM public.events e
  JOIN public.brands b ON b.id = e.brand_id
  WHERE b.place_pool_id = p_place_pool_id
    AND b.claim_status = 'verified'
    AND b.deleted_at IS NULL
    AND e.event_type = 'experience'
    AND e.visibility = 'public'
    AND e.published_at IS NOT NULL
    AND e.deleted_at IS NULL
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
