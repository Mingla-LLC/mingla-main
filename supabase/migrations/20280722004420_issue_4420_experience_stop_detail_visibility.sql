-- =====================================================================================
-- Issue #4420 — experience stop details follow the address-visibility rule everywhere.
--
-- 20280719004420 made the public experience page, the brand cards and the Explorer
-- place sheet return only the "City, CC" area line while a host hides an experience's
-- address until booking (issue_2489_address_withheld: hideAddressUntilTicket true or
-- absent). This file applies the same rule to the remaining readers of a stop's
-- street, map pin and map place id:
--
--   1. experience_stops, read directly. The public read policy now admits a stop row
--      only while its experience's address is visible. The host and the brand team,
--      admins and guests who booked read every stop through their own policies; the
--      service role is unaffected. Anonymous and signed-in public callers read a
--      hidden-address experience's stops only through the gated readers
--      (pg_public_experience_by_slug and its siblings), which keep the stop name,
--      photos and times. Hiding the whole row (not a column) also means a WHERE on
--      lat/lng/address cannot be used to search a hidden stop's value.
--
--   2. pg_eligible_experiences_for_deck (the Explorer deck reader behind
--      discover-cards and generate-curated-experiences). While hidden, each stop
--      returns no street, the stop's own id instead of the map place id, and a coarse
--      point (one decimal, about 11 km; the links_page_week rule) instead of the exact
--      pin, so the deck keeps its distance chip, weather and area. The radius filter
--      measures that same coarse point, so a radius search cannot narrow in on the
--      exact pin.
--
--   3. links_page_week (the /links and city pages): an experience's point is the same
--      coarse point while hidden (its events branch already did this).
--
--   4. events.theme.experience_meta.venue_text. The experience writers stored the
--      first stop's street there, and the theme column is readable on the base
--      relation. While hidden they now store the area line (city or region, country
--      code), the same value issue_4420_experience_venue_line returns; a visible
--      address still stores the street. Existing hidden rows are rewritten once.
--      public_search_source_facts' venue uses the area line while hidden.
--
-- Signatures, return shapes, SECURITY DEFINER and grants of every re-emitted reader
-- and writer are unchanged: each is rewritten in place from its live definition by an
-- exact, counted substitution (the #4174 pattern), and CREATE OR REPLACE keeps the ACL.
-- A count mismatch aborts the migration instead of leaving a reader unchanged.
--
-- ORDERING: strictly greater than 20280721004420 (the newest prefix in this worktree,
-- every sibling worktree and origin/main when this file was created).
-- =====================================================================================

BEGIN;

-- -------------------------------------------------------------------------------------
-- The rule's helpers. Pure functions over the theme; called only from SECURITY DEFINER
-- readers and writers, so app clients hold no EXECUTE.
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_4420_stop_coordinate(p_theme jsonb, p_value double precision)
 RETURNS double precision
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO ''
AS $function$
  SELECT CASE
    WHEN p_value IS NULL THEN NULL
    WHEN public.issue_2489_address_withheld(p_theme)
      THEN pg_catalog.round(p_value::numeric, 1)::double precision
    ELSE p_value
  END
$function$;

CREATE OR REPLACE FUNCTION public.issue_4420_stop_street(p_theme jsonb, p_address text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO ''
AS $function$
  SELECT CASE WHEN public.issue_2489_address_withheld(p_theme) THEN NULL ELSE p_address END
$function$;

CREATE OR REPLACE FUNCTION public.issue_4420_stop_place_id(p_theme jsonb, p_place_id text, p_stop_id uuid)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO ''
AS $function$
  SELECT CASE
    WHEN public.issue_2489_address_withheld(p_theme) THEN p_stop_id::text
    ELSE COALESCE(p_place_id, p_stop_id::text)
  END
$function$;

-- The value the experience writers store in theme.experience_meta.venue_text, from the
-- first stop of the save payload. Hidden: the area line, '' when the stop has no area
-- (missing is hidden, never faked). Visible: the street, as before.
CREATE OR REPLACE FUNCTION public.issue_4420_stored_venue_text(p_theme jsonb, p_stop jsonb)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO ''
AS $function$
  SELECT CASE
    WHEN public.issue_2489_address_withheld(p_theme) THEN COALESCE((
      SELECT CASE
               WHEN area.place IS NULL THEN NULL
               ELSE pg_catalog.concat_ws(', ', area.place, area.country)
             END
        FROM (
          SELECT COALESCE(NULLIF(pg_catalog.btrim(p_stop->>'city'), ''),
                          NULLIF(pg_catalog.btrim(p_stop->>'region'), '')) AS place,
                 NULLIF(pg_catalog.upper(pg_catalog.btrim(p_stop->>'country_code')), '') AS country
        ) area), '')
    ELSE COALESCE(NULLIF(p_stop->>'address', ''), '')
  END
$function$;

COMMENT ON FUNCTION public.issue_4420_stop_coordinate(jsonb, double precision) IS
  '#4420 — a stop coordinate for a public reader: rounded to one decimal while the '
  'experience hides its address, exact otherwise.';
COMMENT ON FUNCTION public.issue_4420_stop_street(jsonb, text) IS
  '#4420 — a stop street for a public reader: NULL while the experience hides its address.';
COMMENT ON FUNCTION public.issue_4420_stop_place_id(jsonb, text, uuid) IS
  '#4420 — a stop place id for a public reader: the stop''s own id while the experience '
  'hides its address, else the map place id (or the stop id).';
COMMENT ON FUNCTION public.issue_4420_stored_venue_text(jsonb, jsonb) IS
  '#4420 — theme.experience_meta.venue_text as the writers store it: the first stop''s '
  'area line while the address is hidden, its street otherwise.';

REVOKE ALL ON FUNCTION public.issue_4420_stop_coordinate(jsonb, double precision) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_4420_stop_street(jsonb, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_4420_stop_place_id(jsonb, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_4420_stored_venue_text(jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4420_stop_coordinate(jsonb, double precision) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_4420_stop_street(jsonb, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_4420_stop_place_id(jsonb, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_4420_stored_venue_text(jsonb, jsonb) TO service_role;

-- -------------------------------------------------------------------------------------
-- 1. experience_stops: who reads a hidden-address experience's stop rows.
-- -------------------------------------------------------------------------------------

-- The brand team (any accepted member with read rank) and guests who booked: a paid or
-- partly refunded order they bought, or a valid or used ticket they hold. Owner rights
-- so the check reads orders and tickets without the caller's row policies.
CREATE OR REPLACE FUNCTION public.issue_4420_caller_reads_exact_stops(p_event_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
        FROM public.events e
       WHERE e.id = p_event_id
         AND e.deleted_at IS NULL
         AND (
           public.biz_is_brand_member_for_read(e.brand_id, auth.uid())
           OR EXISTS (
             SELECT 1 FROM public.orders o
              WHERE o.event_id = e.id
                AND o.buyer_user_id = auth.uid()
                AND o.payment_status IN ('paid', 'partial_refund'))
           OR EXISTS (
             SELECT 1 FROM public.tickets t
              WHERE t.event_id = e.id
                AND t.holder_user_id = auth.uid()
                AND t.status IN ('valid', 'used'))
         )
    )
$function$;

COMMENT ON FUNCTION public.issue_4420_caller_reads_exact_stops(uuid) IS
  '#4420 — true when the signed-in caller is on the experience''s brand team or booked it '
  '(paid or partly refunded order they bought, or a valid or used ticket they hold). The '
  'experience_stops team-or-booked read policy.';

REVOKE ALL ON FUNCTION public.issue_4420_caller_reads_exact_stops(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_4420_caller_reads_exact_stops(uuid) TO authenticated, service_role;

ALTER POLICY experience_stops_select_public ON public.experience_stops
  USING (EXISTS (
    SELECT 1
      FROM public.events e
     WHERE e.id = experience_stops.event_id
       AND e.deleted_at IS NULL
       AND e.event_type = 'experience'
       AND e.published_at IS NOT NULL
       AND e.visibility = 'public'
       -- #4420: a hidden-address experience's stops are read through the gated readers.
       AND NOT public.issue_2489_address_withheld(e.theme)));

DROP POLICY IF EXISTS experience_stops_select_team_or_booked ON public.experience_stops;
CREATE POLICY experience_stops_select_team_or_booked ON public.experience_stops
  FOR SELECT TO authenticated
  USING (public.issue_4420_caller_reads_exact_stops(event_id));

COMMENT ON POLICY experience_stops_select_public ON public.experience_stops IS
  '#4420 — public read of a published public experience''s stops, only while its address '
  'is visible (issue_2489_address_withheld false). Hidden-address stops reach the public '
  'only through the gated readers.';
COMMENT ON POLICY experience_stops_select_team_or_booked ON public.experience_stops IS
  '#4420 — the brand team and guests who booked read every stop, hidden address or not.';

-- -------------------------------------------------------------------------------------
-- Exact, counted in-place rewrites of live definitions (the #4174 pattern). A pattern
-- that already shows its replacement and no original counts as applied (a re-apply).
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pg_temp.issue_4420_patch(
  p_signature text,
  p_old text,
  p_new text,
  p_expected integer
) RETURNS void
LANGUAGE plpgsql
AS $function$
DECLARE
  v_def text;
  v_old_count integer;
  v_new_count integer;
BEGIN
  v_def := pg_get_functiondef(p_signature::regprocedure);
  v_old_count := (length(v_def) - length(replace(v_def, p_old, ''))) / length(p_old);
  v_new_count := (length(v_def) - length(replace(v_def, p_new, ''))) / length(p_new);
  IF v_old_count = 0 AND v_new_count = p_expected THEN
    RETURN;
  END IF;
  IF v_old_count <> p_expected THEN
    RAISE EXCEPTION 'issue_4420_shape_mismatch: % expected % match(es), found %',
      p_signature, p_expected, v_old_count;
  END IF;
  EXECUTE replace(v_def, p_old, p_new);
END
$function$;

-- -------------------------------------------------------------------------------------
-- 2. pg_eligible_experiences_for_deck.
-- -------------------------------------------------------------------------------------
SELECT pg_temp.issue_4420_patch(
  'public.pg_eligible_experiences_for_deck(double precision,double precision,double precision,text[],timestamp with time zone,uuid[],integer)',
  $old$        SELECT 1 FROM public.experience_stops s
        WHERE s.event_id = e.id
          AND s.lat IS NOT NULL
          AND s.lng IS NOT NULL
          AND (
            6371000.0 * 2.0 * ASIN(SQRT(
              POWER(SIN(RADIANS(s.lat - p_lat) / 2.0), 2) +
              COS(RADIANS(p_lat)) * COS(RADIANS(s.lat)) *
              POWER(SIN(RADIANS(s.lng - p_lng) / 2.0), 2)
            ))
          ) <= p_radius_m$old$,
  $new$        SELECT 1 FROM public.experience_stops s
        -- #4420: a hidden address is measured at its coarse point, never the pin.
        CROSS JOIN LATERAL (
          SELECT public.issue_4420_stop_coordinate(e.theme, s.lat) AS lat,
                 public.issue_4420_stop_coordinate(e.theme, s.lng) AS lng
        ) pt
        WHERE s.event_id = e.id
          AND s.lat IS NOT NULL
          AND s.lng IS NOT NULL
          AND (
            6371000.0 * 2.0 * ASIN(SQRT(
              POWER(SIN(RADIANS(pt.lat - p_lat) / 2.0), 2) +
              COS(RADIANS(p_lat)) * COS(RADIANS(pt.lat)) *
              POWER(SIN(RADIANS(pt.lng - p_lng) / 2.0), 2)
            ))
          ) <= p_radius_m$new$,
  1
);

SELECT pg_temp.issue_4420_patch(
  'public.pg_eligible_experiences_for_deck(double precision,double precision,double precision,text[],timestamp with time zone,uuid[],integer)',
  $old$    FROM public.experience_stops s
    WHERE s.event_id IN (SELECT id FROM eligible)$old$,
  $new$    FROM public.experience_stops s
    JOIN public.events we ON we.id = s.event_id
    WHERE s.event_id IN (SELECT id FROM eligible)$new$,
  1
);

SELECT pg_temp.issue_4420_patch(
  'public.pg_eligible_experiences_for_deck(double precision,double precision,double precision,text[],timestamp with time zone,uuid[],integer)',
  $old$          'place_id',     COALESCE(s.place_id, s.id::text),
          'place_name',   s.place_name,
          'address',      s.address,
          'image_urls',   to_jsonb(s.image_urls),
          'ai_description', s.ai_description,
          'lat',          s.lat,
          'lng',          s.lng,$old$,
  $new$          -- #4420: a hidden address returns no street, no map place id and a
          -- coarse point (the same rule as the other public experience readers).
          'place_id',     public.issue_4420_stop_place_id(we.theme, s.place_id, s.id),
          'place_name',   s.place_name,
          'address',      public.issue_4420_stop_street(we.theme, s.address),
          'image_urls',   to_jsonb(s.image_urls),
          'ai_description', s.ai_description,
          'lat',          public.issue_4420_stop_coordinate(we.theme, s.lat),
          'lng',          public.issue_4420_stop_coordinate(we.theme, s.lng),$new$,
  1
);

-- -------------------------------------------------------------------------------------
-- 3. links_page_week: an experience's point is coarse while its address is hidden.
-- -------------------------------------------------------------------------------------
SELECT pg_temp.issue_4420_patch(
  'public.links_page_week()',
  $old$      stop_point.lat, stop_point.lng,$old$,
  $new$      public.issue_4420_stop_coordinate(e.theme, stop_point.lat),
      public.issue_4420_stop_coordinate(e.theme, stop_point.lng),$new$,
  1
);

-- -------------------------------------------------------------------------------------
-- 4. The experience writers store the area line while the address is hidden. In the
--    two UPDATE paths `theme` is the stored row's theme; a newly created experience
--    has no hideAddressUntilTicket yet, so it is hidden (NULL theme, fail closed).
-- -------------------------------------------------------------------------------------
SELECT pg_temp.issue_4420_patch(
  'public.biz_create_experience(uuid,jsonb,boolean)',
  $old$COALESCE(NULLIF(v_stops->0->>'address', ''), '')$old$,
  $new$public.issue_4420_stored_venue_text(NULL::jsonb, v_stops->0)$new$,
  1
);
SELECT pg_temp.issue_4420_patch(
  'public.biz_publish_experience(uuid,jsonb,boolean)',
  $old$COALESCE(NULLIF(v_stops->0->>'address', ''), '')$old$,
  $new$public.issue_4420_stored_venue_text(theme, v_stops->0)$new$,
  1
);
SELECT pg_temp.issue_4420_patch(
  'public.biz_update_live_experience(uuid,jsonb,text)',
  $old$COALESCE(NULLIF(v_stops->0->>'address', ''), '')$old$,
  $new$public.issue_4420_stored_venue_text(theme, v_stops->0)$new$,
  1
);

-- The search source's venue for a hidden experience is the area line (else the first
-- stop's name, as before); the stored venue_text is only read while visible.
SELECT pg_temp.issue_4420_patch(
  'public.public_search_source_facts(text,text)',
  $old$          NULLIF(e.theme #>> '{experience_meta,venue_text}',''),$old$,
  $new$          CASE WHEN public.issue_2489_address_withheld(e.theme)
            THEN public.issue_4420_experience_venue_line(e.id, e.theme)
            ELSE NULLIF(e.theme #>> '{experience_meta,venue_text}','') END,$new$,
  1
);

-- Existing hidden-address experiences: venue_text becomes the area line (or '' when
-- the first stop has no area). Status is unchanged, so no publish guard fires; the
-- edit-notice snapshot reads stops, not venue_text, so no guest notice is produced.
CREATE OR REPLACE FUNCTION public.issue_4420_backfill_experience_venue_text()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_count integer;
BEGIN
  UPDATE public.events e
     SET theme = pg_catalog.jsonb_set(
           e.theme,
           '{experience_meta,venue_text}',
           pg_catalog.to_jsonb(COALESCE(public.issue_4420_experience_venue_line(e.id, e.theme), '')),
           true)
   WHERE e.event_type = 'experience'
     AND public.issue_2489_address_withheld(e.theme)
     AND pg_catalog.jsonb_typeof(e.theme #> '{experience_meta,venue_text}') = 'string'
     AND (e.theme #>> '{experience_meta,venue_text}')
         IS DISTINCT FROM COALESCE(public.issue_4420_experience_venue_line(e.id, e.theme), '');
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END
$function$;

COMMENT ON FUNCTION public.issue_4420_backfill_experience_venue_text() IS
  '#4420 — rewrites a hidden-address experience''s stored venue_text to the area line. '
  'Idempotent; run once by 20280722004420. Not callable by app clients.';

REVOKE ALL ON FUNCTION public.issue_4420_backfill_experience_venue_text() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4420_backfill_experience_venue_text() TO service_role;

DO $backfill$
DECLARE
  v_count integer;
BEGIN
  v_count := public.issue_4420_backfill_experience_venue_text();
  RAISE NOTICE '#4420: % hidden-address experience venue line(s) rewritten', v_count;
END
$backfill$;

-- Restate the re-emitted readers' grants (#1023 F-9 style; values equal the live ACLs).
GRANT EXECUTE ON FUNCTION public.pg_eligible_experiences_for_deck(double precision, double precision, double precision, text[], timestamp with time zone, uuid[], integer) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.links_page_week() TO anon, authenticated, service_role;

-- #2489 SC-25: every object that carries the shared address gate is declared.
INSERT INTO public.issue_2489_gate_carriers (object_name, object_kind) VALUES
  ('issue_4420_stop_coordinate', 'function'),
  ('issue_4420_stop_street', 'function'),
  ('issue_4420_stop_place_id', 'function'),
  ('issue_4420_stored_venue_text', 'function'),
  ('issue_4420_backfill_experience_venue_text', 'function')
ON CONFLICT (object_name) DO NOTHING;

COMMIT;
