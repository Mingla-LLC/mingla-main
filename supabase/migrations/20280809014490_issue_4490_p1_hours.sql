-- #4490 P1 migration 2 — opening hours: several windows a day, special days.
--
-- Opening hours keep ONE home, the venue-keyed `brand_hours` (reconciliation
-- ruling 2). This file:
--   1. adds `brand_hours.window_ordinal` (0..3: up to four windows a day; a
--      close earlier than the open runs past midnight, as today) and swaps the
--      venue partial unique index to (venue_id, weekday, window_ordinal);
--   2. guards the windows of one venue day: no overlap, and a closed day is the
--      only row for that day;
--   3. adds `venue_special_hours` (a closed day or replacement windows for one
--      date), written by issue_4490_set_special_hours / _clear_special_hours;
--   4. teaches biz_upsert_brand_hours the new day shape
--      {weekday, windows:[{open,close}], is_closed} while the old shape
--      {weekday, open_time, close_time, is_closed} still writes window 0
--      exactly as before (old Host builds, Ari tools, the create wizard);
--   5. derives one service period per window (deterministic order);
--   6. keeps `venue_public_view.hours` byte-identical for every existing shape
--      (first window per weekday, same keys) and appends `hours_windows` (all
--      windows) and `special_hours` (the next 60 days);
--   7. pg_venue_available_slots: a closed special day has no slots, and a
--      special day's windows replace the weekly periods for that date.
--
-- Conflicts raise PT409 (never 40001). Static SQL. Local stack only until Seth
-- says otherwise.

BEGIN;
SET LOCAL lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. window_ordinal + index swap.
-- ---------------------------------------------------------------------------
ALTER TABLE public.brand_hours
  ADD COLUMN window_ordinal smallint NOT NULL DEFAULT 0
  CONSTRAINT brand_hours_window_ordinal_check CHECK (window_ordinal BETWEEN 0 AND 3);
DROP INDEX public.brand_hours_venue_weekday_uniq;
CREATE UNIQUE INDEX brand_hours_venue_weekday_window_uniq
  ON public.brand_hours (venue_id, weekday, window_ordinal) WHERE venue_id IS NOT NULL;
COMMENT ON COLUMN public.brand_hours.window_ordinal IS
  '#4490: 0..3, the window''s place in its day (split shifts). Window 0 is what the legacy single-window shape reads and writes.';

-- ---------------------------------------------------------------------------
-- 2. Window guard.
-- ---------------------------------------------------------------------------
-- Minutes since local midnight for a window; a close at or before the open
-- runs past midnight.
CREATE OR REPLACE FUNCTION public.issue_4490_window_bounds(p_open time, p_close time)
RETURNS int[]
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $function$
  SELECT ARRAY[
    (EXTRACT(hour FROM p_open) * 60 + EXTRACT(minute FROM p_open))::int,
    (EXTRACT(hour FROM p_close) * 60 + EXTRACT(minute FROM p_close))::int
      + CASE WHEN p_close <= p_open THEN 1440 ELSE 0 END
  ];
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_assert_hours_windows()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
DECLARE
  v_mine int[];
BEGIN
  IF NEW.venue_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.is_closed AND EXISTS (
    SELECT 1 FROM public.brand_hours other
    WHERE other.venue_id = NEW.venue_id AND other.weekday = NEW.weekday AND other.id <> NEW.id
  ) THEN
    RAISE EXCEPTION 'hours_closed_day_has_windows' USING ERRCODE = '22023';
  END IF;
  IF NOT NEW.is_closed AND EXISTS (
    SELECT 1 FROM public.brand_hours other
    WHERE other.venue_id = NEW.venue_id AND other.weekday = NEW.weekday AND other.id <> NEW.id
      AND other.is_closed
  ) THEN
    RAISE EXCEPTION 'hours_closed_day_has_windows' USING ERRCODE = '22023';
  END IF;
  IF NEW.open_time IS NULL OR NEW.close_time IS NULL THEN
    RETURN NEW;
  END IF;
  v_mine := public.issue_4490_window_bounds(NEW.open_time, NEW.close_time);
  IF EXISTS (
    SELECT 1
    FROM public.brand_hours other
    CROSS JOIN LATERAL (SELECT public.issue_4490_window_bounds(other.open_time, other.close_time) AS b) bounds
    WHERE other.venue_id = NEW.venue_id AND other.weekday = NEW.weekday AND other.id <> NEW.id
      AND other.open_time IS NOT NULL AND other.close_time IS NOT NULL
      AND v_mine[1] < bounds.b[2] AND bounds.b[1] < v_mine[2]
  ) THEN
    RAISE EXCEPTION 'hours_windows_overlap' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER issue_4490_brand_hours_windows
  BEFORE INSERT OR UPDATE ON public.brand_hours
  FOR EACH ROW EXECUTE FUNCTION public.issue_4490_assert_hours_windows();

-- ---------------------------------------------------------------------------
-- 3. Special days.
-- ---------------------------------------------------------------------------
-- A windows array: up to four {open:"HH:MM", close:"HH:MM"} that do not overlap.
CREATE OR REPLACE FUNCTION public.issue_4490_windows_valid(p_windows jsonb, p_max integer)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $function$
  SELECT jsonb_typeof(p_windows) = 'array'
    AND jsonb_array_length(p_windows) BETWEEN 1 AND p_max
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_windows) w
      WHERE jsonb_typeof(w) <> 'object'
        OR COALESCE(w->>'open', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
        OR COALESCE(w->>'close', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
        OR (SELECT count(*) FROM jsonb_object_keys(w)) <> 2
    )
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(p_windows) WITH ORDINALITY a(w, i)
      JOIN jsonb_array_elements(p_windows) WITH ORDINALITY b(w, i) ON a.i < b.i
      CROSS JOIN LATERAL (SELECT
        public.issue_4490_window_bounds((a.w->>'open')::time, (a.w->>'close')::time) AS x,
        public.issue_4490_window_bounds((b.w->>'open')::time, (b.w->>'close')::time) AS y) r
      WHERE r.x[1] < r.y[2] AND r.y[1] < r.x[2]
    );
$function$;

CREATE TABLE public.venue_special_hours (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL REFERENCES public.venue_listings(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  local_date date NOT NULL,
  label text NULL CHECK (label IS NULL OR char_length(btrim(label)) BETWEEN 1 AND 60),
  is_closed boolean NOT NULL DEFAULT false,
  windows jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_by uuid NULL,
  CONSTRAINT venue_special_hours_day_uniq UNIQUE (venue_id, local_date),
  CONSTRAINT venue_special_hours_shape CHECK (
    (is_closed AND windows = '[]'::jsonb)
    OR (NOT is_closed AND jsonb_typeof(windows) = 'array' AND jsonb_array_length(windows) BETWEEN 1 AND 4)
  ),
  CONSTRAINT venue_special_hours_windows_valid CHECK (is_closed OR public.issue_4490_windows_valid(windows, 4))
);
CREATE INDEX venue_special_hours_venue_date_idx ON public.venue_special_hours (venue_id, local_date);
COMMENT ON TABLE public.venue_special_hours IS
  '#4490: one date that differs from the weekly hours: closed, or open on its own windows (which replace the weekly ones for that date). Written only through issue_4490_set_special_hours / issue_4490_clear_special_hours.';

CREATE TRIGGER issue_4490_venue_special_hours_brand
  BEFORE INSERT OR UPDATE OF venue_id, brand_id ON public.venue_special_hours
  FOR EACH ROW EXECUTE FUNCTION public.issue_4490_assert_venue_brand();

ALTER TABLE public.venue_special_hours ENABLE ROW LEVEL SECURITY;
CREATE POLICY "venue special hours readable by venue viewers"
  ON public.venue_special_hours FOR SELECT TO authenticated
  USING (public.issue_4490_can_view_venue(venue_id));
REVOKE ALL ON public.venue_special_hours FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.venue_special_hours TO authenticated;
GRANT ALL ON public.venue_special_hours TO service_role;

CREATE OR REPLACE FUNCTION public.issue_4490_special_day_projection(p_row public.venue_special_hours)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = ''
AS $function$
  SELECT jsonb_build_object(
    'id', p_row.id,
    'venue_id', p_row.venue_id,
    'local_date', p_row.local_date,
    'label', p_row.label,
    'is_closed', p_row.is_closed,
    'windows', p_row.windows,
    'version', p_row.version,
    'updated_at', p_row.updated_at
  );
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_set_special_hours(
  p_venue_id uuid,
  p_local_date date,
  p_is_closed boolean,
  p_windows jsonb,
  p_label text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_venue public.venue_listings%ROWTYPE;
  v_row public.venue_special_hours%ROWTYPE;
  v_windows jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_venue FROM public.venue_listings WHERE id = p_venue_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'venue_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.issue_4490_can_manage_venue(p_venue_id, 'venue.manage_offers') THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF p_local_date IS NULL OR p_is_closed IS NULL THEN
    RAISE EXCEPTION 'special_day_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_label IS NOT NULL AND char_length(btrim(p_label)) > 60 THEN
    RAISE EXCEPTION 'special_day_label_invalid' USING ERRCODE = '22023';
  END IF;
  v_windows := CASE WHEN p_is_closed THEN '[]'::jsonb ELSE COALESCE(p_windows, '[]'::jsonb) END;
  IF NOT p_is_closed AND NOT public.issue_4490_windows_valid(v_windows, 4) THEN
    RAISE EXCEPTION 'special_day_windows_invalid' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.venue_special_hours (venue_id, brand_id, local_date, label, is_closed, windows, updated_by)
  VALUES (p_venue_id, v_venue.brand_id, p_local_date, NULLIF(btrim(p_label), ''), p_is_closed, v_windows, auth.uid())
  ON CONFLICT (venue_id, local_date) DO UPDATE
    SET label = EXCLUDED.label,
        is_closed = EXCLUDED.is_closed,
        windows = EXCLUDED.windows,
        version = public.venue_special_hours.version + 1,
        updated_at = now(),
        updated_by = auth.uid()
  RETURNING * INTO v_row;
  RETURN public.issue_4490_special_day_projection(v_row);
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_clear_special_hours(
  p_venue_id uuid,
  p_local_date date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_deleted integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.venue_listings WHERE id = p_venue_id) THEN
    RAISE EXCEPTION 'venue_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.issue_4490_can_manage_venue(p_venue_id, 'venue.manage_offers') THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.venue_special_hours WHERE venue_id = p_venue_id AND local_date = p_local_date;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN jsonb_build_object('venue_id', p_venue_id, 'local_date', p_local_date, 'cleared', v_deleted > 0);
END;
$function$;

REVOKE ALL ON FUNCTION public.issue_4490_window_bounds(time, time) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_4490_window_bounds(time, time) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.issue_4490_windows_valid(jsonb, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_4490_windows_valid(jsonb, integer) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.issue_4490_assert_hours_windows() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_4490_special_day_projection(public.venue_special_hours) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_4490_set_special_hours(uuid, date, boolean, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_4490_set_special_hours(uuid, date, boolean, jsonb, text) TO authenticated;
REVOKE ALL ON FUNCTION public.issue_4490_clear_special_hours(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_4490_clear_special_hours(uuid, date) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. biz_upsert_brand_hours v2 (20261130000002 body; both day shapes).
--    Old shape {weekday, open_time, close_time, is_closed} -> window 0, the
--    exact row it wrote before. New shape {weekday, windows:[{open,close}],
--    is_closed} -> one row per window (0..3), or one closed row.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.biz_upsert_brand_hours (
  p_venue_id uuid,
  p_hours jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_brand_id uuid;
  v_idx int;
  v_hour jsonb;
  v_window jsonb;
  v_ordinal int;
  v_closed boolean;
BEGIN
  IF auth.uid () IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT v.brand_id INTO v_brand_id
  FROM public.venue_listings v
  WHERE v.id = p_venue_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'venue_not_found';
  END IF;

  IF NOT public.biz_is_brand_admin_plus_for_caller (v_brand_id) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF p_hours IS NULL OR jsonb_typeof(p_hours) != 'array' OR jsonb_array_length(p_hours) != 7 THEN
    RAISE EXCEPTION 'hours_must_have_7_rows';
  END IF;

  DELETE FROM public.brand_hours
  WHERE venue_id = p_venue_id;

  FOR v_idx IN 0 .. 6 LOOP
    v_hour := p_hours -> v_idx;
    IF v_hour IS NULL THEN
      RAISE EXCEPTION 'missing_hour_index_%', v_idx;
    END IF;

    IF jsonb_typeof(v_hour) = 'object' AND v_hour ? 'windows' THEN
      -- #4490 shape: several windows a day.
      v_closed := coalesce((v_hour ->> 'is_closed')::boolean, false);
      IF v_closed THEN
        INSERT INTO public.brand_hours (brand_id, venue_id, weekday, open_time, close_time, is_closed, window_ordinal)
        VALUES (v_brand_id, p_venue_id, (v_hour ->> 'weekday')::smallint, NULL, NULL, true, 0);
      ELSE
        IF NOT public.issue_4490_windows_valid(v_hour -> 'windows', 4) THEN
          RAISE EXCEPTION 'hours_windows_invalid' USING ERRCODE = '22023';
        END IF;
        v_ordinal := 0;
        FOR v_window IN
          SELECT w FROM jsonb_array_elements(v_hour -> 'windows') WITH ORDINALITY AS a(w, i)
          ORDER BY (w ->> 'open')::time, i
        LOOP
          INSERT INTO public.brand_hours (brand_id, venue_id, weekday, open_time, close_time, is_closed, window_ordinal)
          VALUES (v_brand_id, p_venue_id, (v_hour ->> 'weekday')::smallint,
                  (v_window ->> 'open')::time, (v_window ->> 'close')::time, false, v_ordinal);
          v_ordinal := v_ordinal + 1;
        END LOOP;
      END IF;
    ELSE
      -- Legacy shape: window 0, byte-for-byte the pre-#4490 row.
      INSERT INTO public.brand_hours (
        brand_id,
        venue_id,
        weekday,
        open_time,
        close_time,
        is_closed
      )
      VALUES (
        v_brand_id,
        p_venue_id,
        (v_hour ->> 'weekday')::smallint,
        CASE
          WHEN coalesce((v_hour ->> 'is_closed')::boolean, false) THEN NULL
          WHEN v_hour ->> 'open_time' IS NULL OR (v_hour ->> 'open_time') = '' THEN NULL
          ELSE (v_hour ->> 'open_time')::time
        END,
        CASE
          WHEN coalesce((v_hour ->> 'is_closed')::boolean, false) THEN NULL
          WHEN v_hour ->> 'close_time' IS NULL OR (v_hour ->> 'close_time') = '' THEN NULL
          ELSE (v_hour ->> 'close_time')::time
        END,
        coalesce((v_hour ->> 'is_closed')::boolean, false)
      );
    END IF;
  END LOOP;

  -- ORCH-1186-A live bridge (venue-keyed): re-derive the reservation baseline
  -- service periods from the updated hours via
  -- biz_derive_service_periods_from_brand_hours.
  PERFORM public.biz_derive_service_periods_from_brand_hours(p_venue_id);
END;
$$;

REVOKE ALL ON FUNCTION public.biz_upsert_brand_hours (uuid, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.biz_upsert_brand_hours (uuid, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.biz_upsert_brand_hours (uuid, jsonb) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. Derivation (20261130000002 body): one period per window. The only change
--    is the tie-break in the ORDER BY, so two windows on one day always
--    aggregate in the same order (the idempotence check stays exact). A
--    one-window week derives exactly the periods it derived before.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.biz_derive_service_periods_from_brand_hours (
  p_venue_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $derive$
DECLARE
  v_brand_id uuid;
  v_place_pool_id uuid;
  v_existing jsonb;
  v_operator_authored boolean;
  v_derived jsonb;
BEGIN
  -- Resolve the venue's brand + place linkage (venue row is the truth, D-1).
  SELECT v.brand_id, v.place_pool_id INTO v_brand_id, v_place_pool_id
  FROM public.venue_listings v
  WHERE v.id = p_venue_id;
  IF NOT FOUND THEN
    RETURN; -- no venue, nothing to derive (mirror of the old NULL-brand no-op)
  END IF;

  -- Step 1 — ensure a config row exists PER VENUE (the engine returns zero
  -- slots when the row is absent, 20261008000001:128-133).
  INSERT INTO public.venue_availability_config (brand_id, venue_id, place_pool_id)
  VALUES (v_brand_id, p_venue_id, v_place_pool_id)
  ON CONFLICT (venue_id) DO NOTHING;

  -- Read the current periods to apply the non-clobber merge rule.
  SELECT service_periods INTO v_existing
  FROM public.venue_availability_config
  WHERE venue_id = p_venue_id;

  v_existing := coalesce(v_existing, '[]'::jsonb);

  -- "operator-authored" = at least one element WITHOUT type=derived_from_hours.
  v_operator_authored := EXISTS (
    SELECT 1
    FROM jsonb_array_elements(v_existing) AS e
    WHERE coalesce(e ->> 'type', '') IS DISTINCT FROM 'derived_from_hours'
  );

  IF v_operator_authored THEN
    RETURN;
  END IF;

  -- Step 2 — build derived periods from the VENUE's brand_hours rows,
  -- remapping brand_hours weekday (Mon=0..Sun=6) to Postgres dow (Sun=0..Sat=6).
  -- #4490: one period per window; windows of one day in window order.
  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'name', 'Open',
        'days', jsonb_build_array(((h.weekday + 1) % 7)),
        'start', to_char(h.open_time, 'HH24:MI'),
        'end', to_char(h.close_time, 'HH24:MI'),
        'type', 'derived_from_hours'
      )
      ORDER BY ((h.weekday + 1) % 7), h.window_ordinal
    ),
    '[]'::jsonb
  )
  INTO v_derived
  FROM public.brand_hours h
  WHERE h.venue_id = p_venue_id
    AND h.is_closed = false
    AND h.open_time IS NOT NULL
    AND h.close_time IS NOT NULL;

  -- Idempotent: only write (and bump updated_at) when periods change.
  IF v_existing IS DISTINCT FROM v_derived THEN
    UPDATE public.venue_availability_config
    SET service_periods = v_derived,
        updated_at = now()
    WHERE venue_id = p_venue_id;
  END IF;
END;
$derive$;

REVOKE ALL ON FUNCTION public.biz_derive_service_periods_from_brand_hours (uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.biz_derive_service_periods_from_brand_hours (uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.biz_derive_service_periods_from_brand_hours (uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.biz_derive_service_periods_from_brand_hours (uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 6. venue_public_view (20270227001719 body). `hours` is unchanged for every
--    existing shape: it reads window 0 only, so an old Explorer or Host build
--    never sees a weekday twice. Two columns are appended at the end:
--    hours_windows (every window, by weekday then window) and special_hours
--    (dates from yesterday to 60 days ahead in UTC, so every venue's local
--    "today" is covered; clients trim to the venue's own today).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.venue_public_view AS
SELECT
  v.id, v.brand_id, b.slug AS brand_slug, b.name AS brand_name,
  v.slug, v.name, v.address, v.city, v.country_code, v.lat, v.lng,
  v.venue_category, v.google_place_id, v.contact_email, v.contact_phone,
  v.cover_media_url, v.cover_media_type, v.place_pool_id,
  COALESCE(v.theme_color_override, b.theme_color) AS theme_color,
  COALESCE(v.theme_font_override, b.theme_font) AS theme_font,
  COALESCE(v.theme_animation_override, b.theme_animation) AS theme_animation,
  b.cover_hue, b.default_currency,
  (SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'weekday', bh.weekday, 'open_time', to_char(bh.open_time::interval, 'HH24:MI'),
      'close_time', to_char(bh.close_time::interval, 'HH24:MI'),
      'is_closed', bh.is_closed) ORDER BY bh.weekday), '[]'::jsonb)
     FROM public.brand_hours bh WHERE bh.venue_id = v.id AND bh.window_ordinal = 0) AS hours,
  pp.stored_photo_urls AS pool_photo_urls,
  pp.generative_summary AS pitch,
  v.created_at, v.updated_at,
  CASE WHEN vac.iana_timezone_source IN ('derived', 'operator')
       THEN vac.iana_timezone END AS iana_timezone,
  v.cover_media_poster_url,
  (SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'weekday', bh.weekday, 'window_ordinal', bh.window_ordinal,
      'open_time', to_char(bh.open_time::interval, 'HH24:MI'),
      'close_time', to_char(bh.close_time::interval, 'HH24:MI'),
      'is_closed', bh.is_closed) ORDER BY bh.weekday, bh.window_ordinal), '[]'::jsonb)
     FROM public.brand_hours bh WHERE bh.venue_id = v.id) AS hours_windows,
  (SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'local_date', sh.local_date, 'label', sh.label,
      'is_closed', sh.is_closed, 'windows', sh.windows) ORDER BY sh.local_date), '[]'::jsonb)
     FROM public.venue_special_hours sh
     WHERE sh.venue_id = v.id
       AND sh.local_date BETWEEN (now() AT TIME ZONE 'UTC')::date - 1
                             AND (now() AT TIME ZONE 'UTC')::date + 60) AS special_hours
FROM public.venue_listings v
JOIN public.brands b ON b.id = v.brand_id AND b.deleted_at IS NULL
LEFT JOIN public.place_pool pp ON pp.id = v.place_pool_id
LEFT JOIN public.venue_availability_config vac ON vac.venue_id = v.id
WHERE v.claim_status = 'verified';
ALTER VIEW public.venue_public_view SET (security_invoker = false);
REVOKE ALL ON public.venue_public_view FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.venue_public_view TO anon, authenticated;
GRANT SELECT ON public.venue_public_view TO service_role;

-- ---------------------------------------------------------------------------
-- 7. pg_venue_available_slots (20261130000002 engine v4). Changes, nothing
--    else: a closed special day returns no slots, and a special day with
--    windows uses those windows instead of the weekly periods for that date.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pg_venue_available_slots(
  p_date       date,
  p_party_size int,
  p_venue_id   uuid DEFAULT NULL,
  p_brand_id   uuid DEFAULT NULL
)
RETURNS TABLE (
  slot_start_utc   timestamptz,
  slot_local_label text,
  remaining        int,
  is_full          boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_venue_id      uuid := p_venue_id;
  v_legacy_ids    uuid[];
  v_enabled       boolean;
  v_cfg           public.venue_availability_config%ROWTYPE;
  v_tz            text;
  v_dow           int;
  v_turn_min      int;
  v_buffer_min    int;
  v_gran_min      int;
  v_eligible_cnt  int;
  v_eligible_ids  uuid[];
  v_cap_per_slot  int;
  v_now           timestamptz := now();
  v_special       public.venue_special_hours%ROWTYPE;
  v_periods       jsonb;
BEGIN
  IF p_date IS NULL OR p_party_size IS NULL OR p_party_size < 1 THEN
    RETURN;
  END IF;

  -- [TRANSITIONAL-1] legacy consumer-binary shim — shipped consumer binaries
  -- call { p_brand_id, ... } (useVenueAvailability.ts) and consumer OTA is
  -- frozen. Resolve the brand's venue IFF the brand has exactly one venue row;
  -- else return ZERO rows (fail-soft empty slot list, no crash, no dead 500).
  -- Exit condition: next consumer native build ships + OTA freeze lifts →
  -- drop p_brand_id + this block in a follow-on migration.
  IF v_venue_id IS NULL THEN
    IF p_brand_id IS NULL THEN
      RETURN;
    END IF;
    SELECT array_agg(v.id) INTO v_legacy_ids
    FROM public.venue_listings v
    WHERE v.brand_id = p_brand_id;
    IF v_legacy_ids IS NULL OR array_length(v_legacy_ids, 1) <> 1 THEN
      RETURN;
    END IF;
    v_venue_id := v_legacy_ids[1];
  END IF;

  SELECT reservations_enabled INTO v_enabled
  FROM public.venue_reservation_settings
  WHERE venue_id = v_venue_id;
  IF v_enabled IS NOT TRUE THEN
    RETURN;
  END IF;

  SELECT * INTO v_cfg
  FROM public.venue_availability_config
  WHERE venue_id = v_venue_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- #4490: a special day closes the date, or replaces its weekly periods.
  SELECT * INTO v_special
  FROM public.venue_special_hours
  WHERE venue_id = v_venue_id AND local_date = p_date;
  IF FOUND AND v_special.is_closed THEN
    RETURN;
  END IF;

  v_buffer_min := COALESCE(v_cfg.buffer_minutes, 0);
  v_gran_min   := COALESCE(v_cfg.slot_granularity_minutes, 15);
  IF v_gran_min < 1 THEN
    v_gran_min := 15;
  END IF;

  v_tz := NULLIF(btrim(COALESCE(v_cfg.iana_timezone, '')), '');
  IF v_tz IS NULL OR NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = v_tz) THEN
    v_tz := 'UTC';
  END IF;

  v_turn_min := public.pg_venue_turn_minutes_for_party(v_cfg.turn_times, p_party_size);

  IF EXISTS (
    SELECT 1 FROM public.venue_blackouts b
    WHERE b.venue_id = v_venue_id
      AND b.applies_to = 'all'
      AND p_date BETWEEN b.date_start AND b.date_end
  ) THEN
    RETURN;
  END IF;

  -- ELIGIBLE TABLES: active, reservable, party-fitting, not blacked out, and —
  -- SOFT-DELETE — NOT soft-deleted. A deleted table can never produce a slot.
  SELECT array_agg(t.id), count(*)::int
  INTO v_eligible_ids, v_eligible_cnt
  FROM public.venue_tables t
  WHERE t.venue_id = v_venue_id
    AND t.is_active
    AND t.deleted_at IS NULL                       -- SOFT-DELETE exclusion
    AND t.reservation_policy = 'reservable'
    AND p_party_size BETWEEN COALESCE(t.min_party, 1)
                         AND LEAST(COALESCE(t.max_party, t.capacity), t.capacity)
    AND NOT EXISTS (
      SELECT 1 FROM public.venue_blackouts b
      WHERE b.venue_id = v_venue_id
        AND p_date BETWEEN b.date_start AND b.date_end
        AND (
          (b.applies_to = 'table' AND b.table_id = t.id)
          OR (b.applies_to = 'zone' AND b.zone IS NOT DISTINCT FROM t.zone)
        )
    );

  v_eligible_cnt := COALESCE(v_eligible_cnt, 0);
  IF v_eligible_cnt = 0 THEN
    RETURN;
  END IF;

  v_cap_per_slot := LEAST(COALESCE(v_cfg.max_reservations_per_slot, v_eligible_cnt), v_eligible_cnt);

  v_dow := EXTRACT(dow FROM p_date)::int;

  -- #4490: the special day's windows stand in for the weekly periods.
  IF v_special.id IS NOT NULL THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'start', w->>'open', 'end', w->>'close', 'days', jsonb_build_array(v_dow))), '[]'::jsonb)
    INTO v_periods
    FROM jsonb_array_elements(v_special.windows) AS w;
  ELSE
    v_periods := COALESCE(v_cfg.service_periods, '[]'::jsonb);
  END IF;

  RETURN QUERY
  WITH periods AS (
    SELECT
      pr.value->>'start' AS p_start,
      pr.value->>'end'   AS p_end
    FROM jsonb_array_elements(v_periods) AS pr(value)
    WHERE EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(COALESCE(pr.value->'days', '[]'::jsonb)) AS d(dow)
      WHERE d.dow::int = v_dow
    )
      AND (pr.value->>'start') ~ '^[0-2][0-9]:[0-5][0-9]$'
      AND (pr.value->>'end')   ~ '^[0-2][0-9]:[0-5][0-9]$'
  ),
  bounds AS (
    SELECT
      ((p_date::timestamp) AT TIME ZONE v_tz) AS local_midnight_utc,
      ((split_part(p.p_start, ':', 1))::int * 60 + (split_part(p.p_start, ':', 2))::int) AS start_min,
      ((split_part(p.p_end,   ':', 1))::int * 60 + (split_part(p.p_end,   ':', 2))::int) AS end_min
    FROM periods p
  ),
  candidates AS (
    SELECT
      (b.local_midnight_utc + make_interval(mins => g.minute_of_day)) AS slot_utc,
      g.minute_of_day
    FROM bounds b
    CROSS JOIN LATERAL generate_series(
      b.start_min,
      b.end_min - (v_turn_min + v_buffer_min),
      v_gran_min
    ) AS g(minute_of_day)
    WHERE b.end_min - (v_turn_min + v_buffer_min) >= b.start_min
  ),
  windowed AS (
    SELECT DISTINCT c.slot_utc, c.minute_of_day
    FROM candidates c
    WHERE c.slot_utc >= v_now + make_interval(mins => COALESCE(v_cfg.min_notice_minutes, 0))
      AND p_date <= ((v_now AT TIME ZONE v_tz)::date + COALESCE(v_cfg.advance_window_days, 30))
  ),
  scored AS (
    SELECT
      w.slot_utc,
      w.minute_of_day,
      v_cap_per_slot - (
        SELECT count(*)::int
        FROM public.reservations r
        WHERE r.venue_id = v_venue_id
          AND r.status IN ('requested', 'confirmed', 'seated')
          AND (r.table_id IS NULL OR r.table_id = ANY (v_eligible_ids))
          AND r.reserved_for
                < (w.slot_utc + make_interval(mins => v_turn_min + v_buffer_min))
          AND (r.reserved_for
                + make_interval(mins =>
                    public.pg_venue_turn_minutes_for_party(v_cfg.turn_times, r.party_size)
                    + v_buffer_min)) > w.slot_utc
      ) AS remaining_calc
    FROM windowed w
  )
  SELECT
    s.slot_utc AS slot_start_utc,
    to_char(s.slot_utc AT TIME ZONE v_tz, 'HH24:MI') AS slot_local_label,
    GREATEST(s.remaining_calc, 0) AS remaining,
    (s.remaining_calc <= 0) AS is_full
  FROM scored s
  ORDER BY s.slot_utc;
END;
$function$;

REVOKE ALL ON FUNCTION public.pg_venue_available_slots(date, int, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pg_venue_available_slots(date, int, uuid, uuid)
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.pg_venue_available_slots(date, int, uuid, uuid) IS
  'META-ORCH-1255 M3 engine v4: venue-keyed availability. New callers pass '
  'p_venue_id; [TRANSITIONAL-1] legacy consumer binaries pass p_brand_id which '
  'resolves IFF the brand has exactly one venue, else zero rows (fail-soft). '
  'Exit: next consumer native build + OTA unfreeze → drop p_brand_id. Body is '
  'the 20261013000002 v3 engine with brand_id→venue_id keying only. #4490: a '
  'closed venue_special_hours date has no slots; a special day''s windows '
  'replace the weekly periods for that date.';

COMMIT;

-- Reverse (local use only; forward-fix in production):
--   DROP TABLE public.venue_special_hours; DROP FUNCTION public.issue_4490_set_special_hours,
--   issue_4490_clear_special_hours, issue_4490_special_day_projection, issue_4490_windows_valid,
--   issue_4490_window_bounds, issue_4490_assert_hours_windows (+ trigger);
--   DELETE FROM public.brand_hours WHERE window_ordinal > 0; DROP INDEX brand_hours_venue_weekday_window_uniq;
--   CREATE UNIQUE INDEX brand_hours_venue_weekday_uniq ON public.brand_hours (venue_id, weekday) WHERE venue_id IS NOT NULL;
--   ALTER TABLE public.brand_hours DROP COLUMN window_ordinal;
--   re-apply the 20261130000002 bodies of biz_upsert_brand_hours, biz_derive_service_periods_from_brand_hours,
--   pg_venue_available_slots and the 20270227001719 venue_public_view (CREATE OR REPLACE cannot drop the two
--   appended columns: DROP VIEW + re-create + re-grant).
