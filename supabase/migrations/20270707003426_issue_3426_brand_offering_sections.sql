-- ---------------------------------------------------------------------------
-- issue #3426 — a public brand page puts every offering in exactly ONE of three
-- places — Happening now, Upcoming, Past — decided by DATES, never by
-- `events.status`.
--
-- ── THE DEFECT (verified against production, 2026-09-15) ────────────────────
--   * `pg_public_brand_upcoming` kept `starts_at > now()`, so anything already
--     running (a multi-day event, a trip, a festival) VANISHED from the page the
--     moment it started, and there was no Past or Happening-now view to catch it.
--   * It dated an event by its MASTER `event_dates` row only. A multi-date or
--     recurring event (#3313 materialises every night) dropped out after its
--     FIRST night even with seven nights still to come.
--   * It dated an experience by `theme.experience_meta.next_occurrence_at`,
--     which is written ONCE at publish (the first date) and never advanced. The
--     real schedule is `event_dates`: publish materialises every date and the
--     #1153 daily cron keeps recurring experiences topped up.
--   * Past offerings had no reader at all.
--
-- ── THE RULE (Seth, 2026-09-15, #3426) ──────────────────────────────────────
-- An offering's occurrences are its `event_dates` rows — events, RSVPs, trips
-- and experiences alike. At the database clock (`now()`, fixed per statement):
--   happening_now  an occurrence has started and not ended  (start_at <= now < end_at)
--   upcoming       nothing in progress, an occurrence starts later (start_at > now)
--   past           every occurrence has ended               (end_at <= now)
-- A single-date offering is therefore exactly Seth's master rule. Equality is
-- decided the way the event page decides it (`resolveEventTerminal`): an
-- occurrence whose end equals now has ENDED; one whose start equals now has
-- STARTED.
--
-- Fail-closed shapes (the offering is in NO section, as it is today):
--   * no occurrence at all — except an experience published before dates were
--     materialised, which falls back to its stored `next_occurrence_at` and is
--     listed as Upcoming ONLY while that stored date is in the future (with no
--     end, it can never be proven in progress or over);
--   * any occurrence with a missing end or an end at/before its start (the event
--     page calls this `occurrences_invalid`).
--
-- Status is consulted for exactly two exclusions, never to keep anything current:
--   * `cancelled` — excluded from all three. A cancelled offering did not happen,
--     so it is never presented as Past as if it had.
--   * `draft`     — excluded (a published row is never a draft; belt and braces).
-- `scheduled`, `live` and `ended` are all classified by their dates (#3422: the
-- status never advances in production).
--
-- ── WHAT THIS MIGRATION DOES ────────────────────────────────────────────────
--   §1 issue_3426_offering_schedule — the ONE classifier. SECURITY INVOKER, not
--      executable by anon/authenticated; only the two definer readers below call
--      it (they run as their owner).
--   §2 pg_public_brand_offering_section — NEW anon reader, one section per call,
--      keyset-paginated. Carries every visibility guard of the Upcoming reader.
--      It projects NO theme column at all, so there is no address or draft blob
--      to strip — a strictly smaller surface than the Upcoming reader.
--   §3 pg_public_brand_upcoming — re-emitted from its LATEST definition
--      (20270523002489) with the date rule swapped in. Signature, return shape,
--      ordering, cursor, limit+1, grants and every guard are unchanged, so the
--      Explorer builds already in the stores read the corrected Upcoming too.
--   §4 grants + a self-verify probe.
--
-- Guards carried by both readers, verbatim in effect: b.deleted_at IS NULL,
-- e.deleted_at IS NULL, e.visibility = 'public', e.published_at IS NOT NULL,
-- NOT issue_1931_event_ordinary_read_blocked(e.id), and the paid-supply
-- pg_brand_can_collect guard.
--
-- NOT APPLIED TO PRODUCTION BY THE PR THAT ADDS IT. Apply order after merge:
-- this migration, then the web deploy (the new clients call §2).
--
-- BEFORE APPLYING: compare production's pg_get_functiondef of
-- pg_public_brand_upcoming against 20270523002489 §5 (it matched on 2026-09-15).
--
-- ROLLBACK: re-apply pg_public_brand_upcoming from 20270523002489 §5, then
-- DROP FUNCTION public.pg_public_brand_offering_section(text, text, timestamptz, uuid, integer)
-- and public.issue_3426_offering_schedule(uuid, text, jsonb). Nothing is written.
-- ---------------------------------------------------------------------------

BEGIN;

-- ===========================================================================
-- §1 — The one classifier.
-- ===========================================================================
-- Returns ZERO rows when the offering cannot be placed (fail closed), otherwise
-- exactly ONE row:
--   happening_now  start_at = earliest start of the occurrences in progress,
--                  end_at   = latest end of the occurrences in progress
--   upcoming       start_at = the next start, end_at = that occurrence's end
--                  (NULL on the stored-experience fallback)
--   past           start_at = the latest start, end_at = the latest end
CREATE OR REPLACE FUNCTION public.issue_3426_offering_schedule(
  p_event_id uuid,
  p_event_type text,
  p_theme jsonb
)
RETURNS TABLE (
  section text,
  start_at timestamptz,
  end_at timestamptz
)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $function$
  WITH occurrences AS (
    SELECT d.start_at AS o_start, d.end_at AS o_end
    FROM public.event_dates d
    WHERE d.event_id = p_event_id
  ),
  shape AS (
    SELECT
      count(*) AS n_total,
      count(*) FILTER (
        WHERE o.o_start IS NULL OR o.o_end IS NULL OR o.o_end <= o.o_start
      ) AS n_invalid,
      COALESCE(bool_or(o.o_start <= now() AND o.o_end > now()), false) AS any_running,
      COALESCE(bool_or(o.o_start > now()), false) AS any_future
    FROM occurrences o
  ),
  stored AS (
    -- Experiences published before their dates were materialised carry only this
    -- publish-time field. Parsed defensively: a malformed value is ignored rather
    -- than raising and taking the whole brand feed down with it.
    SELECT CASE
      WHEN p_event_type = 'experience'
       AND jsonb_typeof(p_theme) = 'object'
       AND (p_theme #>> '{experience_meta,next_occurrence_at}')
             ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9]{2}:[0-9]{2}'
      THEN (p_theme #>> '{experience_meta,next_occurrence_at}')::timestamptz
    END AS stored_next
  ),
  placed AS (
    SELECT
      CASE
        WHEN s.n_total > 0 AND s.n_invalid = 0 AND s.any_running THEN 'happening_now'
        WHEN s.n_total > 0 AND s.n_invalid = 0 AND s.any_future THEN 'upcoming'
        WHEN s.n_total > 0 AND s.n_invalid = 0 THEN 'past'
        WHEN s.n_total = 0 AND st.stored_next > now() THEN 'upcoming'
      END AS section,
      st.stored_next
    FROM shape s
    CROSS JOIN stored st
  )
  SELECT
    p.section,
    CASE p.section
      WHEN 'happening_now' THEN (
        SELECT min(o.o_start) FROM occurrences o
         WHERE o.o_start <= now() AND o.o_end > now()
      )
      WHEN 'upcoming' THEN COALESCE(
        (SELECT min(o.o_start) FROM occurrences o WHERE o.o_start > now()),
        p.stored_next
      )
      WHEN 'past' THEN (SELECT max(o.o_start) FROM occurrences o)
    END AS start_at,
    CASE p.section
      WHEN 'happening_now' THEN (
        SELECT max(o.o_end) FROM occurrences o
         WHERE o.o_start <= now() AND o.o_end > now()
      )
      WHEN 'upcoming' THEN (
        SELECT o.o_end FROM occurrences o
         WHERE o.o_start > now()
         ORDER BY o.o_start ASC, o.o_end ASC
         LIMIT 1
      )
      WHEN 'past' THEN (SELECT max(o.o_end) FROM occurrences o)
    END AS end_at
  FROM placed p
  WHERE p.section IS NOT NULL;
$function$;

COMMENT ON FUNCTION public.issue_3426_offering_schedule(uuid, text, jsonb) IS
  '#3426 — the ONE date classifier for a public brand page: happening_now / '
  'upcoming / past from the offering''s event_dates (experiences without dates '
  'fall back to a FUTURE stored next_occurrence_at as upcoming only). Zero rows '
  'when the offering cannot be placed. Never reads events.status. Not executable '
  'by anon or authenticated; called only from pg_public_brand_offering_section '
  'and pg_public_brand_upcoming.';

REVOKE ALL ON FUNCTION public.issue_3426_offering_schedule(uuid, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3426_offering_schedule(uuid, text, jsonb)
  TO service_role;

-- ===========================================================================
-- §2 — pg_public_brand_offering_section: one section of one brand page.
-- ===========================================================================
-- p_section   'happening_now' | 'upcoming' | 'past'; anything else returns no rows.
-- Ordering (and the keyset cursor it pages on, strictly after the cursor):
--   happening_now  ends_at ASC,   offering_id ASC   (ending soonest first)
--   upcoming       starts_at ASC, offering_id ASC   (next first)
--   past           ends_at DESC,  offering_id DESC  (most recent first)
-- p_cursor_at NULL -> first page. p_cursor_id NULL with a cursor time -> strictly
-- past that time. Returns up to LEAST(GREATEST(p_limit,1),100) + 1 rows so the
-- caller can detect another page, exactly like pg_public_brand_upcoming.
CREATE OR REPLACE FUNCTION public.pg_public_brand_offering_section(
  p_brand_slug text,
  p_section text,
  p_cursor_at timestamptz DEFAULT NULL,
  p_cursor_id uuid DEFAULT NULL,
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
  section text,
  starts_at timestamptz,
  ends_at timestamptz,
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
      sched.section,
      sched.start_at AS starts_at,
      sched.end_at AS ends_at,
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
    CROSS JOIN LATERAL public.issue_3426_offering_schedule(e.id, e.event_type, e.theme) sched
    WHERE b.slug = p_brand_slug
      AND b.deleted_at IS NULL
      AND e.deleted_at IS NULL
      AND e.visibility = 'public'
      AND e.published_at IS NOT NULL
      AND e.event_type IN ('event', 'rsvp', 'trip', 'experience')
      AND e.status IN ('scheduled', 'live', 'ended')
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
    o.section,
    o.starts_at,
    o.ends_at,
    o.price_from_cents,
    o.currency,
    o.is_free,
    o.published_at
  FROM offerings o
  WHERE o.section = p_section
    AND (
      p_cursor_at IS NULL
      OR (
        p_section = 'happening_now'
        AND (
          o.ends_at > p_cursor_at
          OR (o.ends_at = p_cursor_at AND p_cursor_id IS NOT NULL AND o.offering_id > p_cursor_id)
        )
      )
      OR (
        p_section = 'upcoming'
        AND (
          o.starts_at > p_cursor_at
          OR (o.starts_at = p_cursor_at AND p_cursor_id IS NOT NULL AND o.offering_id > p_cursor_id)
        )
      )
      OR (
        p_section = 'past'
        AND (
          o.ends_at < p_cursor_at
          OR (o.ends_at = p_cursor_at AND p_cursor_id IS NOT NULL AND o.offering_id < p_cursor_id)
        )
      )
    )
  ORDER BY
    CASE WHEN p_section = 'happening_now' THEN o.ends_at END ASC,
    CASE WHEN p_section = 'upcoming' THEN o.starts_at END ASC,
    CASE WHEN p_section = 'past' THEN o.ends_at END DESC,
    CASE WHEN p_section = 'past' THEN NULL ELSE o.offering_id END ASC,
    CASE WHEN p_section = 'past' THEN o.offering_id END DESC
  LIMIT (LEAST(GREATEST(COALESCE(p_limit, 30), 1), 100) + 1);
$function$;

COMMENT ON FUNCTION public.pg_public_brand_offering_section(text, text, timestamptz, uuid, integer) IS
  '#3426 — one date-decided section (happening_now / upcoming / past) of a public '
  'brand page, all four offering kinds, keyset-paginated, limit+1. Same visibility, '
  'private-access and paid-supply guards as pg_public_brand_upcoming; projects no '
  'theme. Cancelled offerings are in no section.';

REVOKE ALL ON FUNCTION public.pg_public_brand_offering_section(text, text, timestamptz, uuid, integer)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pg_public_brand_offering_section(text, text, timestamptz, uuid, integer)
  TO anon, authenticated;

-- ===========================================================================
-- §3 — pg_public_brand_upcoming, re-emitted with the date rule.
-- ===========================================================================
-- Latest definer: 20270523002489_issue_2489_address_privacy_server_gate.sql §5.
-- Changed ONLY in the hunks marked "#3426":
--   * dates come from issue_3426_offering_schedule (alias `ed`: the offering's
--     event_dates schedule) and only its 'upcoming' section is admitted;
--   * `ed.start_at` is the NEXT occurrence's start for every kind, so an
--     experience is no longer dated by its never-advanced stored field;
--   * status admits `ended` as well — dates decide, cancelled stays out.
-- Unchanged: signature, return shape, the #2489 theme gate, every guard, the
-- exclusive cursor, the ordering and limit+1.
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
      -- #3426 — the next occurrence's start, from the event_dates schedule, for
      -- every admitted kind.
      CASE e.event_type
        WHEN 'event' THEN ed.start_at
        WHEN 'rsvp' THEN ed.start_at
        WHEN 'trip' THEN ed.start_at
        WHEN 'experience' THEN ed.start_at
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
    -- #3426 — the date rule. Replaces the master-only LEFT JOIN.
    CROSS JOIN LATERAL public.issue_3426_offering_schedule(e.id, e.event_type, e.theme) ed
    WHERE b.slug = p_brand_slug
      AND b.deleted_at IS NULL
      AND e.deleted_at IS NULL
      AND e.visibility = 'public'
      AND e.published_at IS NOT NULL
      -- #3426 — dates decide; only cancellation (and draft) is excluded by status.
      AND e.status IN ('scheduled', 'live', 'ended')
      AND ed.section = 'upcoming'
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
    public.issue_2489_public_theme(o.theme) AS theme,
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

REVOKE ALL ON FUNCTION public.pg_public_brand_upcoming(text, timestamptz, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pg_public_brand_upcoming(text, timestamptz, integer) TO anon, authenticated;

-- ===========================================================================
-- §4 — Self-verify. A DO block (plpgsql) so it is checked at APPLY time, not
-- CREATE time: it proves the grant posture this migration claims.
-- ===========================================================================
DO $verify$
BEGIN
  IF has_function_privilege('anon', 'public.issue_3426_offering_schedule(uuid, text, jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.issue_3426_offering_schedule(uuid, text, jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION '#3426: the date classifier must not be executable by anon or authenticated';
  END IF;
  IF (SELECT p.prosecdef FROM pg_proc p
       WHERE p.oid = 'public.issue_3426_offering_schedule(uuid, text, jsonb)'::regprocedure) THEN
    RAISE EXCEPTION '#3426: the date classifier must stay SECURITY INVOKER';
  END IF;
  IF NOT has_function_privilege('anon', 'public.pg_public_brand_offering_section(text, text, timestamptz, uuid, integer)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.pg_public_brand_offering_section(text, text, timestamptz, uuid, integer)', 'EXECUTE') THEN
    RAISE EXCEPTION '#3426: the brand section reader lost its public grant';
  END IF;
  IF NOT has_function_privilege('anon', 'public.pg_public_brand_upcoming(text, timestamptz, integer)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.pg_public_brand_upcoming(text, timestamptz, integer)', 'EXECUTE') THEN
    RAISE EXCEPTION '#3426: pg_public_brand_upcoming lost its public grant';
  END IF;
END
$verify$;

COMMIT;
