-- #4490 P5-1 — tables under spaces, the floor plan, pick a table,
-- minimum-spend tables, joined tables, the guest waitlist, by the hour.
--
-- Tables:
--   * venue_tables gain a space (backfilled: one space per old zone), a
--     place on the floor plan (x, y, size, rotation, shape), a minimum spend,
--     a per-guest hold and "Guests can pick this table". `zone` stays for old
--     clients and is no longer the grouping.
--   * venue_table_joins: two combinable tables in one space seat a bigger
--     party together ("Or join"). A reservation keeps its extra tables in
--     reservations.joined_table_ids.
--   * One occupancy helper (issue_4490_table_slot_occupancy) answers both the
--     slot list (pg_venue_available_slots, now with a seating-area filter) and
--     the table map (pg_venue_available_tables), so they cannot disagree.
--     For a venue without joins or picked tables the slot numbers are the
--     same as before.
--   * pg_create_guest_reservation takes an optional table pick and an
--     optional seating area, holds the venue's table lock (so two guests can
--     never take the same table at overlapping times), snapshots the table's
--     minimum spend and checks the per-guest hold was paid.
--   * The guest party cap is the venue's largest table or joined pair (at
--     most 100); a bigger party may send a request when the venue allows.
-- Guest waitlist: a guest joins from the public page with no account
-- (edge venue-waitlist), sees their place in line with a private link, and
-- leaves; a cancelled table tells the oldest matching guest once.
-- By the hour: offer kind `by_the_hour` (a space, or any one of n units, for
-- a start time and a length, priced per hour, with buffers and a no-show
-- release), on the shared offer engine and the P4 space claims. A
-- `flexible` schedule rule gives the opening hours a booking may sit in;
-- each booking gets its own window. Private hire uses the same flexible
-- rule for "Hours you set" (authoring arrives in the P4 follow-up).
--
-- Feature switches now built: floor_plan, pick_a_table, min_spend_tables,
-- by_the_hour (waitlist was already on the list; guests may now join it).
-- The two-way mirror with venue_reservation_settings.reservations_enabled is
-- unchanged: its dependents (floor_plan, pick_a_table, min_spend_tables)
-- follow table_reservations both ways.
--
-- New tables hang off tables and bookings only (no venue_id column, no venue
-- foreign key), so #2099's pending-venue dependency seal does not move.
--
-- Static SQL. Local stack only until Seth says otherwise.
-- Reverse (local only): drop the new tables and functions, restore the
-- redefined functions from their previous migrations, drop the added columns
-- (the backfilled spaces may stay: they are ordinary spaces).

BEGIN;
SET LOCAL lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. Tables on the floor.
-- ---------------------------------------------------------------------------
ALTER TABLE public.venue_tables
  ADD COLUMN space_id uuid REFERENCES public.venue_spaces(id) ON DELETE RESTRICT,
  ADD COLUMN plan_x numeric(7,2) CHECK (plan_x IS NULL OR plan_x BETWEEN 0 AND 1000),
  ADD COLUMN plan_y numeric(7,2) CHECK (plan_y IS NULL OR plan_y BETWEEN 0 AND 1000),
  ADD COLUMN plan_w numeric(7,2) CHECK (plan_w IS NULL OR plan_w BETWEEN 1 AND 1000),
  ADD COLUMN plan_h numeric(7,2) CHECK (plan_h IS NULL OR plan_h BETWEEN 1 AND 1000),
  ADD COLUMN plan_rotation smallint NOT NULL DEFAULT 0 CHECK (plan_rotation BETWEEN 0 AND 359),
  ADD COLUMN shape text NOT NULL DEFAULT 'rect' CHECK (shape IN ('booth', 'sofa', 'high_top', 'round', 'rect')),
  ADD COLUMN min_spend_minor bigint NOT NULL DEFAULT 0 CHECK (min_spend_minor >= 0),
  ADD COLUMN deposit_minor_per_guest bigint CHECK (deposit_minor_per_guest IS NULL OR deposit_minor_per_guest >= 0),
  ADD COLUMN guest_pickable boolean NOT NULL DEFAULT true;
CREATE INDEX venue_tables_space_idx ON public.venue_tables (space_id) WHERE space_id IS NOT NULL;
COMMENT ON COLUMN public.venue_tables.zone IS
  '#4490 P5: read-only for old clients; tables now sit in a space (space_id).';
COMMENT ON COLUMN public.venue_tables.deposit_minor_per_guest IS
  '#4490 P5: hold per guest to book this table (comes off the bill). NULL = the venue''s usual deposit rule.';

-- A table's space is an active space of the same venue.
CREATE OR REPLACE FUNCTION public.issue_4490_assert_table_space()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF NEW.space_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.venue_spaces s
    WHERE s.id = NEW.space_id AND s.venue_id = NEW.venue_id
      AND (s.archived_at IS NULL OR (TG_OP = 'UPDATE' AND NEW.space_id IS NOT DISTINCT FROM OLD.space_id))
  ) THEN
    RAISE EXCEPTION 'table_space_invalid' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER issue_4490_venue_tables_space
  BEFORE INSERT OR UPDATE OF space_id, venue_id ON public.venue_tables
  FOR EACH ROW EXECUTE FUNCTION public.issue_4490_assert_table_space();

-- Backfill: one space per distinct zone of a venue's tables (name = the
-- zone's label, seats = the tables' seats), unless a space of that name
-- already exists; every live table moves into its zone's space.
WITH zones AS (
  SELECT t.venue_id, v.brand_id, COALESCE(t.zone, 'main') AS zone_key,
         LEAST(GREATEST(sum(t.capacity), 1), 100000)::integer AS seats,
         min(t.sort_order) AS first_sort
  FROM public.venue_tables t
  JOIN public.venue_listings v ON v.id = t.venue_id
  WHERE t.deleted_at IS NULL
  GROUP BY t.venue_id, v.brand_id, COALESCE(t.zone, 'main')
), named AS (
  SELECT z.*,
    CASE z.zone_key WHEN 'indoor' THEN 'Indoor' WHEN 'outdoor' THEN 'Outdoor'
      WHEN 'private_room' THEN 'Private room' WHEN 'bar' THEN 'Bar' WHEN 'patio' THEN 'Patio'
      ELSE 'Main floor' END AS space_name,
    CASE WHEN z.zone_key IN ('outdoor', 'patio') THEN 'outdoor' ELSE 'indoor' END AS setting
  FROM zones z
)
INSERT INTO public.venue_spaces (venue_id, brand_id, name, setting, capacity_seated, sort_order, can_be_hired)
SELECT n.venue_id, n.brand_id, n.space_name, n.setting, n.seats, 1000 + n.first_sort, false
FROM named n
WHERE NOT EXISTS (
  SELECT 1 FROM public.venue_spaces s
  WHERE s.venue_id = n.venue_id AND lower(btrim(s.name)) = lower(n.space_name) AND s.archived_at IS NULL
);
UPDATE public.venue_tables t
SET space_id = s.id
FROM public.venue_spaces s
WHERE t.deleted_at IS NULL AND t.space_id IS NULL
  AND s.venue_id = t.venue_id AND s.archived_at IS NULL
  AND lower(btrim(s.name)) = lower(CASE COALESCE(t.zone, 'main') WHEN 'indoor' THEN 'Indoor'
    WHEN 'outdoor' THEN 'Outdoor' WHEN 'private_room' THEN 'Private room' WHEN 'bar' THEN 'Bar'
    WHEN 'patio' THEN 'Patio' ELSE 'Main floor' END);

-- Two combinable tables in one space that seat a bigger party together.
CREATE TABLE public.venue_table_joins (
  table_a uuid NOT NULL REFERENCES public.venue_tables(id) ON DELETE CASCADE,
  table_b uuid NOT NULL REFERENCES public.venue_tables(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (table_a, table_b),
  CONSTRAINT venue_table_joins_ordered CHECK (table_a < table_b)
);
CREATE INDEX venue_table_joins_b_idx ON public.venue_table_joins (table_b);
COMMENT ON TABLE public.venue_table_joins IS
  '#4490 P5: two combinable tables in the same space that can be joined for one party. Written only through issue_4490_manage_table.';

CREATE OR REPLACE FUNCTION public.issue_4490_assert_table_join()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.venue_tables a, public.venue_tables b
    WHERE a.id = NEW.table_a AND b.id = NEW.table_b
      AND a.venue_id = b.venue_id AND a.space_id IS NOT NULL AND a.space_id = b.space_id
      AND a.combinable AND b.combinable AND a.deleted_at IS NULL AND b.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'table_join_invalid' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER issue_4490_venue_table_joins_valid
  BEFORE INSERT OR UPDATE ON public.venue_table_joins
  FOR EACH ROW EXECUTE FUNCTION public.issue_4490_assert_table_join();

-- A table that stops being combinable, leaves its space or is deleted loses
-- its joins.
CREATE OR REPLACE FUNCTION public.issue_4490_prune_table_joins()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF NOT NEW.combinable OR NEW.deleted_at IS NOT NULL OR NEW.space_id IS DISTINCT FROM OLD.space_id THEN
    DELETE FROM public.venue_table_joins WHERE table_a = NEW.id OR table_b = NEW.id;
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER issue_4490_venue_tables_prune_joins
  AFTER UPDATE OF combinable, deleted_at, space_id ON public.venue_tables
  FOR EACH ROW EXECUTE FUNCTION public.issue_4490_prune_table_joins();

ALTER TABLE public.venue_table_joins ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.venue_table_joins FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.venue_table_joins TO authenticated;
GRANT ALL ON public.venue_table_joins TO service_role;
CREATE POLICY "venue table joins readable by venue viewers"
  ON public.venue_table_joins FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.venue_tables t
                 WHERE t.id = table_a AND public.issue_4490_can_view_venue(t.venue_id)));

-- Reservations remember their joined tables, the table's minimum spend at
-- booking time, and when the party is finishing (Host "Free around").
ALTER TABLE public.reservations
  ADD COLUMN joined_table_ids uuid[] NOT NULL DEFAULT '{}'::uuid[]
    CHECK (cardinality(joined_table_ids) <= 5),
  ADD COLUMN min_spend_minor bigint NOT NULL DEFAULT 0 CHECK (min_spend_minor >= 0),
  ADD COLUMN finishing_at timestamptz;
ALTER TABLE public.reservation_checkout_sessions
  ADD COLUMN table_ids uuid[] NOT NULL DEFAULT '{}'::uuid[] CHECK (cardinality(table_ids) <= 6),
  ADD COLUMN space_id uuid;

-- ---------------------------------------------------------------------------
-- 2. The guest waitlist (same table as the staff waitlist).
-- ---------------------------------------------------------------------------
ALTER TABLE public.venue_waitlist
  ADD COLUMN source text NOT NULL DEFAULT 'staff' CHECK (source IN ('staff', 'guest')),
  ADD COLUMN desired_date date,
  ADD COLUMN desired_from time,
  ADD COLUMN desired_to time,
  ADD COLUMN manage_token_hash bytea UNIQUE CHECK (manage_token_hash IS NULL OR octet_length(manage_token_hash) = 32),
  ADD COLUMN guest_phone_country_iso text CHECK (guest_phone_country_iso IS NULL OR guest_phone_country_iso ~ '^[A-Z]{2}$'),
  ADD COLUMN left_by_guest_at timestamptz,
  ADD COLUMN offered_slot_at timestamptz,
  ADD CONSTRAINT venue_waitlist_guest_shape CHECK (
    source = 'staff' OR (desired_date IS NOT NULL AND manage_token_hash IS NOT NULL)),
  ADD CONSTRAINT venue_waitlist_window_shape CHECK (
    (desired_from IS NULL) = (desired_to IS NULL) AND (desired_from IS NULL OR desired_to > desired_from));
CREATE INDEX venue_waitlist_guest_day_idx ON public.venue_waitlist (venue_id, desired_date, created_at)
  WHERE source = 'guest' AND status = 'waiting';

-- ---------------------------------------------------------------------------
-- 3. By the hour: how the units are allocated, the no-show release, staff
--    may start a session at the venue; flexible opening-hours rules and the
--    windows made for one booking.
-- ---------------------------------------------------------------------------
ALTER TABLE public.stay_offerings
  ADD COLUMN space_allocation text NOT NULL DEFAULT 'all' CHECK (space_allocation IN ('all', 'any_one')),
  ADD COLUMN no_show_release_minutes smallint
    CHECK (no_show_release_minutes IS NULL OR no_show_release_minutes BETWEEN 5 AND 240),
  ADD COLUMN staff_can_start boolean NOT NULL DEFAULT false;

ALTER TABLE public.stay_place_schedule_rules DROP CONSTRAINT stay_place_rule_mode_shape;
ALTER TABLE public.stay_place_schedule_rules DROP CONSTRAINT stay_place_schedule_rules_mode_check;
ALTER TABLE public.stay_place_schedule_rules
  ADD CONSTRAINT stay_place_schedule_rules_mode_check
    CHECK (mode IN ('fixed_slots', 'repeating_windows', 'full_day', 'flexible')),
  ADD CONSTRAINT stay_place_rule_mode_shape CHECK (
    (mode = 'fixed_slots' AND local_end_date IS NULL AND cardinality(weekdays) = 0
      AND local_start_time IS NOT NULL AND local_end_time IS NOT NULL
      AND slot_duration_minutes IS NULL AND slot_interval_minutes IS NULL
      AND full_day_start_time IS NULL AND full_day_end_time IS NULL)
    OR (mode = 'repeating_windows' AND cardinality(weekdays) BETWEEN 1 AND 7
      AND local_start_time IS NOT NULL AND local_end_time IS NOT NULL
      AND slot_duration_minutes BETWEEN 5 AND 1440 AND slot_interval_minutes BETWEEN 5 AND 1440
      AND full_day_start_time IS NULL AND full_day_end_time IS NULL)
    OR (mode = 'full_day' AND cardinality(weekdays) BETWEEN 1 AND 7
      AND local_start_time IS NULL AND local_end_time IS NULL
      AND slot_duration_minutes IS NULL AND slot_interval_minutes IS NULL
      AND full_day_start_time IS NOT NULL AND full_day_end_time IS NOT NULL)
    -- #4490 P5: opening hours a by-the-hour (or "Hours you set") booking sits in.
    OR (mode = 'flexible' AND cardinality(weekdays) BETWEEN 1 AND 7
      AND local_start_time IS NOT NULL AND local_end_time IS NOT NULL
      AND slot_duration_minutes IS NULL AND slot_interval_minutes IS NULL
      AND full_day_start_time IS NULL AND full_day_end_time IS NULL)
  );

-- A window made for one flexible booking (its exact start and end). Day
-- windows of a flexible rule (the opening hours) keep booked_block false.
ALTER TABLE public.stay_place_windows
  ADD COLUMN booked_block boolean NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------
-- 4. Built features and kinds.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_4490_built_features()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $function$
  SELECT ARRAY['table_reservations', 'waitlist', 'menu', 'table_ordering', 'events_here', 'stays', 'entry',
               'group_packages', 'private_hire', 'floor_plan', 'pick_a_table', 'min_spend_tables',
               'by_the_hour']::text[];
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_built_offer_kinds()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $function$
  SELECT ARRAY['entry', 'group_package', 'private_hire', 'by_the_hour']::text[];
$function$;

-- A new by-the-hour offer books instantly, priced per hour.
CREATE OR REPLACE FUNCTION public.issue_4490_hour_default_mode()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF NEW.kind = 'by_the_hour' THEN
    NEW.confirmation_mode := 'instant';
    NEW.booking_length_step_minutes := COALESCE(NEW.booking_length_step_minutes, 60);
    NEW.booking_length_min_minutes := COALESCE(NEW.booking_length_min_minutes, 60);
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER issue_4490_hour_default_mode
  BEFORE INSERT ON public.stay_offerings
  FOR EACH ROW EXECUTE FUNCTION public.issue_4490_hour_default_mode();

-- A venue feature's setting (true unless the host turned it off).
CREATE OR REPLACE FUNCTION public.issue_4490_feature_setting_on(p_venue_id uuid, p_key text, p_setting text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT COALESCE((SELECT (f.settings->>p_setting)::boolean FROM public.venue_features f
                   WHERE f.venue_id = p_venue_id AND f.feature_key = p_key
                     AND jsonb_typeof(f.settings->p_setting) = 'boolean'), true);
$function$;

-- ---------------------------------------------------------------------------
-- 5. Table occupancy: the one helper behind the slot list and the table map.
--
-- For one slot start and party it returns every table that fits the party
-- (option_kind 'table') and every joined pair that seats a party no single
-- table of the pair can ('join'), each taken or free, plus the slot's
-- remaining count:
--   remaining = LEAST(per-slot cap - overlapping weight, free fitting tables
--               - overlapping reservations without a table)
-- which is exactly the old count when nothing is joined or picked (each
-- overlapping reservation weighs one), so existing venues see the same slots.
-- A table is taken when an overlapping reservation sits on it (its table or
-- one of its joined tables), or when the reservations without a table use
-- up the free ones.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_4490_table_slot_occupancy(
  p_venue_id uuid,
  p_slot timestamptz,
  p_party integer,
  p_space_id uuid DEFAULT NULL,
  p_exclude_reservation uuid DEFAULT NULL
)
RETURNS TABLE (
  option_kind text,
  table_ids uuid[],
  table_names text[],
  capacity integer,
  space_id uuid,
  taken boolean,
  pickable boolean,
  min_spend_minor bigint,
  deposit_minor_per_guest bigint,
  slot_remaining integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_cfg public.venue_availability_config%ROWTYPE;
  v_tz text;
  v_date date;
  v_turn integer;
  v_buffer integer;
  v_end timestamptz;
BEGIN
  IF p_venue_id IS NULL OR p_slot IS NULL OR p_party IS NULL OR p_party < 1 THEN
    RETURN;
  END IF;
  SELECT * INTO v_cfg FROM public.venue_availability_config WHERE venue_id = p_venue_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  -- (venue_availability_config's own trigger validates the zone; looking it
  -- up in pg_timezone_names costs ~100 ms and this runs once per slot.)
  v_tz := COALESCE(NULLIF(btrim(COALESCE(v_cfg.iana_timezone, '')), ''), 'UTC');
  v_date := (p_slot AT TIME ZONE v_tz)::date;
  IF EXISTS (
    SELECT 1 FROM public.venue_blackouts b
    WHERE b.venue_id = p_venue_id AND b.applies_to = 'all' AND v_date BETWEEN b.date_start AND b.date_end
  ) THEN
    RETURN;
  END IF;
  v_buffer := COALESCE(v_cfg.buffer_minutes, 0);
  v_turn := public.pg_venue_turn_minutes_for_party(v_cfg.turn_times, p_party);
  v_end := p_slot + make_interval(mins => v_turn + v_buffer);

  RETURN QUERY
  WITH tbl AS (
    SELECT t.id, t.name, t.capacity, t.min_party, t.max_party, t.space_id AS t_space, t.combinable,
           t.guest_pickable, t.min_spend_minor AS t_min_spend, t.deposit_minor_per_guest AS t_hold,
           t.sort_order,
           (NOT t.is_active OR t.deleted_at IS NOT NULL OR t.reservation_policy <> 'reservable'
            OR EXISTS (
              SELECT 1 FROM public.venue_blackouts b
              WHERE b.venue_id = p_venue_id AND v_date BETWEEN b.date_start AND b.date_end
                AND ((b.applies_to = 'table' AND b.table_id = t.id)
                     OR (b.applies_to = 'zone' AND b.zone IS NOT DISTINCT FROM t.zone)))) AS unusable
    FROM public.venue_tables t
    WHERE t.venue_id = p_venue_id
  ),
  res AS (
    SELECT r.id, r.table_id, r.joined_table_ids,
           array_remove(ARRAY[r.table_id] || r.joined_table_ids, NULL) AS seats_on
    FROM public.reservations r
    WHERE r.venue_id = p_venue_id
      AND r.status IN ('requested', 'confirmed', 'seated')
      AND r.id IS DISTINCT FROM p_exclude_reservation
      AND r.reserved_for < v_end
      AND r.reserved_for + make_interval(mins =>
            public.pg_venue_turn_minutes_for_party(v_cfg.turn_times, r.party_size) + v_buffer) > p_slot
  ),
  taken_ids AS (
    SELECT DISTINCT x AS id FROM res, unnest(res.seats_on) AS x
  ),
  elig AS (
    SELECT t.* FROM tbl t
    WHERE NOT t.unusable
      AND p_party BETWEEN COALESCE(t.min_party, 1) AND LEAST(COALESCE(t.max_party, t.capacity), t.capacity)
      AND (p_space_id IS NULL OR t.t_space = p_space_id)
  ),
  counts AS (
    SELECT
      (SELECT count(*) FROM elig)::integer AS n_elig,
      (SELECT count(*) FROM res WHERE res.table_id IS NULL)::integer AS n_unassigned,
      (SELECT count(*) FROM res)::integer AS n_overlaps,
      (SELECT COALESCE(sum((SELECT count(*) FROM unnest(res.seats_on) x WHERE x IN (SELECT e.id FROM elig e))), 0)
       FROM res WHERE res.table_id IS NOT NULL)::integer AS n_assigned_weight,
      (SELECT count(*) FROM elig e WHERE e.id NOT IN (SELECT ti.id FROM taken_ids ti))::integer AS n_elig_free,
      (SELECT count(*) FROM tbl t WHERE NOT t.unusable AND (p_space_id IS NULL OR t.t_space = p_space_id)
         AND t.id NOT IN (SELECT ti.id FROM taken_ids ti))::integer AS n_all_free
  ),
  single_rem AS (
    SELECT CASE WHEN c.n_elig = 0 THEN 0 ELSE LEAST(
             LEAST(COALESCE(v_cfg.max_reservations_per_slot, c.n_elig), c.n_elig) - (c.n_unassigned + c.n_assigned_weight),
             c.n_elig_free - c.n_unassigned) END AS rem,
           c.*
    FROM counts c
  ),
  pairs AS (
    SELECT a.id AS a_id, b.id AS b_id, a.name AS a_name, b.name AS b_name,
           (a.capacity + b.capacity)::integer AS cap, a.t_space,
           (a.guest_pickable AND b.guest_pickable) AS both_pickable,
           GREATEST(a.t_min_spend, b.t_min_spend) AS ms,
           CASE WHEN a.t_hold IS NULL AND b.t_hold IS NULL THEN NULL
                ELSE GREATEST(COALESCE(a.t_hold, 0), COALESCE(b.t_hold, 0)) END AS hold,
           LEAST(a.sort_order, b.sort_order) AS so
    FROM public.venue_table_joins j
    JOIN tbl a ON a.id = j.table_a
    JOIN tbl b ON b.id = j.table_b
    WHERE NOT a.unusable AND NOT b.unusable AND a.combinable AND b.combinable
      AND (p_space_id IS NULL OR a.t_space = p_space_id)
      AND a.capacity + b.capacity >= p_party
      AND p_party > LEAST(COALESCE(a.max_party, a.capacity), a.capacity)
      AND p_party > LEAST(COALESCE(b.max_party, b.capacity), b.capacity)
  ),
  pair_rows AS (
    SELECT p.*,
      (p.a_id IN (SELECT ti.id FROM taken_ids ti) OR p.b_id IN (SELECT ti.id FROM taken_ids ti)
       OR s.n_all_free - s.n_unassigned < 2
       OR COALESCE(v_cfg.max_reservations_per_slot, 2147483647) - s.n_overlaps < 1) AS is_taken
    FROM pairs p CROSS JOIN single_rem s
  ),
  total AS (
    SELECT GREATEST(s.rem, 0) + (SELECT count(*) FROM pair_rows pr WHERE NOT pr.is_taken)::integer AS remaining,
           s.rem
    FROM single_rem s
  )
  SELECT 'table'::text, ARRAY[e.id], ARRAY[e.name], e.capacity, e.t_space,
         (e.id IN (SELECT ti.id FROM taken_ids ti) OR tt.rem <= 0),
         (e.id NOT IN (SELECT ti.id FROM taken_ids ti) AND tt.rem > 0 AND e.guest_pickable),
         e.t_min_spend, e.t_hold, tt.remaining
  FROM elig e CROSS JOIN total tt
  UNION ALL
  SELECT 'join'::text, ARRAY[pr.a_id, pr.b_id], ARRAY[pr.a_name, pr.b_name], pr.cap, pr.t_space,
         pr.is_taken, (NOT pr.is_taken AND pr.both_pickable), pr.ms, pr.hold, tt.remaining
  FROM pair_rows pr CROSS JOIN total tt;
END;
$function$;

-- Whether a party could ever be seated (one fitting table or one joined pair)
-- in a space (or anywhere), ignoring bookings.
CREATE OR REPLACE FUNCTION public.issue_4490_tables_could_seat(p_venue_id uuid, p_party integer, p_space_id uuid DEFAULT NULL)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.venue_tables t
    WHERE t.venue_id = p_venue_id AND t.is_active AND t.deleted_at IS NULL AND t.reservation_policy = 'reservable'
      AND p_party BETWEEN COALESCE(t.min_party, 1) AND LEAST(COALESCE(t.max_party, t.capacity), t.capacity)
      AND (p_space_id IS NULL OR t.space_id = p_space_id)
  ) OR EXISTS (
    SELECT 1 FROM public.venue_table_joins j
    JOIN public.venue_tables a ON a.id = j.table_a
    JOIN public.venue_tables b ON b.id = j.table_b
    WHERE a.venue_id = p_venue_id AND a.is_active AND b.is_active AND a.deleted_at IS NULL AND b.deleted_at IS NULL
      AND a.reservation_policy = 'reservable' AND b.reservation_policy = 'reservable'
      AND a.combinable AND b.combinable AND a.capacity + b.capacity >= p_party
      AND (p_space_id IS NULL OR a.space_id = p_space_id)
  );
$function$;

-- The guest party cap: the largest table or joined pair, at most 100.
CREATE OR REPLACE FUNCTION public.issue_4490_table_party_max(p_venue_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT LEAST(100, GREATEST(
    (SELECT max(LEAST(COALESCE(t.max_party, t.capacity), t.capacity)) FROM public.venue_tables t
     WHERE t.venue_id = p_venue_id AND t.is_active AND t.deleted_at IS NULL AND t.reservation_policy = 'reservable'),
    (SELECT max(a.capacity + b.capacity) FROM public.venue_table_joins j
     JOIN public.venue_tables a ON a.id = j.table_a
     JOIN public.venue_tables b ON b.id = j.table_b
     WHERE a.venue_id = p_venue_id AND a.is_active AND b.is_active AND a.deleted_at IS NULL AND b.deleted_at IS NULL
       AND a.reservation_policy = 'reservable' AND b.reservation_policy = 'reservable'
       AND a.combinable AND b.combinable)));
$function$;

-- ---------------------------------------------------------------------------
-- 6. Slots: + a seating-area filter (p_space_id); a party bigger than every
--    single table is offered times when a joined pair is free. Otherwise
--    unchanged (same eligibility, periods, notice and window rules).
-- ---------------------------------------------------------------------------
DROP FUNCTION public.pg_venue_available_slots(date, integer, uuid, uuid);
CREATE FUNCTION public.pg_venue_available_slots(
  p_date       date,
  p_party_size int,
  p_venue_id   uuid DEFAULT NULL,
  p_brand_id   uuid DEFAULT NULL,
  p_space_id   uuid DEFAULT NULL
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
  v_now           timestamptz := now();
  v_special       public.venue_special_hours%ROWTYPE;
  v_periods       jsonb;
BEGIN
  IF p_date IS NULL OR p_party_size IS NULL OR p_party_size < 1 THEN
    RETURN;
  END IF;

  -- [TRANSITIONAL-1] legacy consumer-binary shim (brand with exactly one venue).
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

  -- No table (or joined pair) can ever seat this party here: no slots.
  IF NOT public.issue_4490_tables_could_seat(v_venue_id, p_party_size, p_space_id) THEN
    RETURN;
  END IF;

  v_dow := EXTRACT(dow FROM p_date)::int;

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
      COALESCE((SELECT max(o.slot_remaining)
                FROM public.issue_4490_table_slot_occupancy(v_venue_id, w.slot_utc, p_party_size, p_space_id) o), 0)
        AS remaining_calc
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
REVOKE ALL ON FUNCTION public.pg_venue_available_slots(date, integer, uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pg_venue_available_slots(date, integer, uuid, uuid, uuid)
  TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. The guest's table map for one time (pick a table): every live table of
--    the venue (or of one space) with where it sits, whether it fits the
--    party and whether it is free, plus the joined pairs for a bigger party.
--    Rows only when "Pick a table" is on for a verified venue.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pg_venue_available_tables(
  p_venue_id uuid,
  p_date date,
  p_party_size integer,
  p_slot_start timestamptz,
  p_space_id uuid DEFAULT NULL
)
RETURNS TABLE (
  option_kind text,
  table_ids uuid[],
  names text[],
  space_id uuid,
  space_name text,
  capacity integer,
  shape text,
  plan_x numeric,
  plan_y numeric,
  plan_w numeric,
  plan_h numeric,
  plan_rotation integer,
  status text,
  min_spend_minor bigint,
  hold_minor_per_guest bigint,
  hold_minor bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_venue public.venue_listings%ROWTYPE;
  v_min_spend_on boolean;
  v_slot_ok boolean;
BEGIN
  IF p_venue_id IS NULL OR p_date IS NULL OR p_slot_start IS NULL
     OR p_party_size IS NULL OR p_party_size NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'tables_request_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_venue FROM public.venue_listings WHERE id = p_venue_id AND claim_status = 'verified';
  IF NOT FOUND OR NOT public.issue_4490_venue_feature_on(p_venue_id, 'pick_a_table') THEN
    RETURN;
  END IF;
  v_min_spend_on := public.issue_4490_venue_feature_on(p_venue_id, 'min_spend_tables');
  -- The time must be one the slot list offers today (else everything is taken).
  SELECT EXISTS (SELECT 1 FROM public.pg_venue_available_slots(p_date, p_party_size, p_venue_id, NULL, p_space_id) s
                 WHERE s.slot_start_utc = p_slot_start AND NOT s.is_full) INTO v_slot_ok;
  RETURN QUERY
  WITH occ AS (
    SELECT o.* FROM public.issue_4490_table_slot_occupancy(p_venue_id, p_slot_start, p_party_size, p_space_id) o
  )
  SELECT 'table'::text, ARRAY[t.id], ARRAY[t.name], t.space_id, sp.name, t.capacity, t.shape,
         t.plan_x, t.plan_y, t.plan_w, t.plan_h, t.plan_rotation::integer,
         CASE WHEN o.table_ids IS NULL THEN 'not_fit'
              WHEN NOT v_slot_ok OR o.taken THEN 'taken'
              WHEN NOT o.pickable THEN 'not_pickable'
              ELSE 'free' END,
         CASE WHEN v_min_spend_on THEN t.min_spend_minor ELSE 0 END,
         t.deposit_minor_per_guest,
         CASE WHEN t.deposit_minor_per_guest IS NULL THEN NULL ELSE t.deposit_minor_per_guest * p_party_size END
  FROM public.venue_tables t
  LEFT JOIN public.venue_spaces sp ON sp.id = t.space_id
  LEFT JOIN occ o ON o.option_kind = 'table' AND o.table_ids = ARRAY[t.id]
  WHERE t.venue_id = p_venue_id AND t.is_active AND t.deleted_at IS NULL AND t.reservation_policy = 'reservable'
    AND (p_space_id IS NULL OR t.space_id = p_space_id)
  UNION ALL
  SELECT 'join'::text, o.table_ids, o.table_names, o.space_id, sp.name, o.capacity, NULL::text,
         NULL::numeric, NULL::numeric, NULL::numeric, NULL::numeric, NULL::integer,
         CASE WHEN NOT v_slot_ok OR o.taken THEN 'taken' WHEN NOT o.pickable THEN 'not_pickable' ELSE 'free' END,
         CASE WHEN v_min_spend_on THEN o.min_spend_minor ELSE 0 END,
         o.deposit_minor_per_guest,
         CASE WHEN o.deposit_minor_per_guest IS NULL THEN NULL ELSE o.deposit_minor_per_guest * p_party_size END
  FROM occ o
  LEFT JOIN public.venue_spaces sp ON sp.id = o.space_id
  WHERE o.option_kind = 'join';
END;
$function$;

-- What a table pick costs and promises (edge venue-reservation-create):
-- the hold (per guest x party, NULL = the venue's usual deposit rule) and
-- the minimum spend (only when "Minimum spend tables" is on).
CREATE OR REPLACE FUNCTION public.issue_4490_table_pick_terms(
  p_venue_id uuid,
  p_table_ids uuid[],
  p_party_size integer
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_hold bigint;
  v_min_spend bigint;
  v_names text;
  v_count integer;
BEGIN
  IF p_table_ids IS NULL OR cardinality(p_table_ids) = 0 THEN
    RETURN jsonb_build_object('holdMinor', NULL, 'minSpendMinor', 0, 'tableNames', '');
  END IF;
  SELECT count(*), CASE WHEN bool_and(t.deposit_minor_per_guest IS NULL) THEN NULL
                        ELSE max(COALESCE(t.deposit_minor_per_guest, 0)) END,
         max(t.min_spend_minor), string_agg(t.name, ' + ' ORDER BY t.sort_order, t.name)
  INTO v_count, v_hold, v_min_spend, v_names
  FROM public.venue_tables t
  WHERE t.id = ANY(p_table_ids) AND t.venue_id = p_venue_id AND t.deleted_at IS NULL;
  IF v_count <> cardinality(p_table_ids) THEN
    RAISE EXCEPTION 'table_not_found' USING ERRCODE = 'P0002';
  END IF;
  RETURN jsonb_build_object(
    'holdMinor', CASE WHEN v_hold IS NULL THEN NULL ELSE v_hold * p_party_size END,
    'holdPerGuestMinor', v_hold,
    'minSpendMinor', CASE WHEN public.issue_4490_venue_feature_on(p_venue_id, 'min_spend_tables')
                          THEN COALESCE(v_min_spend, 0) ELSE 0 END,
    'tableNames', v_names);
END;
$function$;

-- Checks a guest's table pick for one time and returns the reservation's
-- table, its joined tables and the minimum spend to snapshot. Raises
-- table_pick_unavailable (feature off), table_not_found, table_not_fit or
-- PT409 table_taken.
CREATE OR REPLACE FUNCTION public.issue_4490_resolve_table_pick(
  p_venue_id uuid,
  p_reserved_for timestamptz,
  p_party_size integer,
  p_table_ids uuid[],
  p_space_id uuid DEFAULT NULL,
  p_exclude_reservation uuid DEFAULT NULL,
  p_staff boolean DEFAULT false
)
RETURNS TABLE (table_id uuid, joined_table_ids uuid[], min_spend_minor bigint, hold_minor_per_guest bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_sorted uuid[];
  v_row record;
BEGIN
  IF p_table_ids IS NULL OR cardinality(p_table_ids) = 0 THEN
    -- A seating area with no table chosen: the smallest free table there.
    IF p_space_id IS NULL THEN
      RETURN;
    END IF;
    SELECT o.* INTO v_row
    FROM public.issue_4490_table_slot_occupancy(p_venue_id, p_reserved_for, p_party_size, p_space_id, p_exclude_reservation) o
    WHERE NOT o.taken
    ORDER BY (o.option_kind = 'join'), o.capacity, o.table_names[1]
    LIMIT 1;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'table_taken' USING ERRCODE = 'PT409';
    END IF;
    table_id := v_row.table_ids[1];
    joined_table_ids := v_row.table_ids[2:];
    min_spend_minor := CASE WHEN public.issue_4490_venue_feature_on(p_venue_id, 'min_spend_tables')
                            THEN v_row.min_spend_minor ELSE 0 END;
    hold_minor_per_guest := v_row.deposit_minor_per_guest;
    RETURN NEXT;
    RETURN;
  END IF;
  IF NOT p_staff AND NOT public.issue_4490_venue_feature_on(p_venue_id, 'pick_a_table') THEN
    RAISE EXCEPTION 'table_pick_unavailable' USING ERRCODE = 'P0001';
  END IF;
  IF cardinality(p_table_ids) > 2 OR EXISTS (
    SELECT 1 FROM unnest(p_table_ids) x WHERE NOT EXISTS (
      SELECT 1 FROM public.venue_tables t WHERE t.id = x AND t.venue_id = p_venue_id
        AND t.is_active AND t.deleted_at IS NULL)) THEN
    RAISE EXCEPTION 'table_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT array_agg(x ORDER BY x) INTO v_sorted FROM (SELECT DISTINCT unnest(p_table_ids) x) d;
  SELECT o.* INTO v_row
  FROM public.issue_4490_table_slot_occupancy(p_venue_id, p_reserved_for, p_party_size, NULL, p_exclude_reservation) o
  WHERE (SELECT array_agg(x ORDER BY x) FROM unnest(o.table_ids) x) = v_sorted;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'table_not_fit' USING ERRCODE = '22023';
  END IF;
  IF v_row.taken OR (NOT p_staff AND NOT v_row.pickable) THEN
    RAISE EXCEPTION '%', CASE WHEN v_row.taken THEN 'table_taken' ELSE 'table_not_pickable' END USING ERRCODE = 'PT409';
  END IF;
  table_id := v_row.table_ids[1];
  joined_table_ids := v_row.table_ids[2:];
  min_spend_minor := CASE WHEN public.issue_4490_venue_feature_on(p_venue_id, 'min_spend_tables')
                          THEN v_row.min_spend_minor ELSE 0 END;
  hold_minor_per_guest := v_row.deposit_minor_per_guest;
  RETURN NEXT;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 8. The guest reservation writer: + an optional table pick (p_table_ids) or
--    seating area (p_space_id). Every write now also takes the venue's table
--    lock first, so two reservations can never land on the same table at
--    overlapping times (the old (venue, start) lock did not cover two
--    different starts that overlap). A per-guest table hold must have been
--    paid; the table's minimum spend is snapshotted (settled at the venue).
--    A big-party request (status requested, above the venue's party cap,
--    when the venue allows it) skips the slot check: the venue answers it.
--    Everything else is unchanged.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.pg_create_guest_reservation(
  uuid,timestamptz,integer,text,text,uuid,text,text,text,integer,character,
  text,text,text,text,text,text,text
) FROM PUBLIC, anon, authenticated, service_role;
DROP FUNCTION public.pg_create_guest_reservation(
  uuid,timestamptz,integer,text,text,uuid,text,text,text,integer,character,
  text,text,text,text,text,text,text
);

CREATE FUNCTION public.pg_create_guest_reservation(
  p_venue_id uuid,
  p_reserved_for timestamptz,
  p_party_size int,
  p_source text,
  p_created_via text,
  p_consumer_user_id uuid,
  p_guest_name text,
  p_guest_phone_e164 text,
  p_guest_email text,
  p_fee_cents int,
  p_fee_currency char(3),
  p_payment_intent_id text,
  p_payment_status text,
  p_guest_cancel_token text,
  p_occasion text DEFAULT NULL,
  p_guest_notes text DEFAULT NULL,
  p_status text DEFAULT 'confirmed',
  p_guest_phone_country_iso text DEFAULT NULL,
  p_table_ids uuid[] DEFAULT NULL,
  p_space_id uuid DEFAULT NULL
) RETURNS public.reservations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_row public.reservations;
  v_brand_id uuid;
  v_place_pool_id uuid;
  v_enabled boolean;
  v_tz text;
  v_slot_date date;
  v_slot_ok boolean;
  v_deposit_required boolean := false;
  v_lock_key bigint;
  v_pick record;
  v_table uuid;
  v_joined uuid[] := '{}'::uuid[];
  v_min_spend bigint := 0;
  v_big_party boolean := false;
BEGIN
  IF p_venue_id IS NULL OR p_reserved_for IS NULL OR p_party_size IS NULL THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
  END IF;
  IF NULLIF(btrim(COALESCE(p_guest_phone_e164, '')), '') IS NOT NULL
     AND btrim(p_guest_phone_e164) !~ '^\+[1-9][0-9]{7,14}$' THEN
    RAISE EXCEPTION 'reservation_phone_must_be_e164' USING ERRCODE = '22023';
  END IF;
  IF p_guest_phone_country_iso IS NOT NULL
     AND p_guest_phone_country_iso !~ '^[A-Z]{2}$' THEN
    RAISE EXCEPTION 'reservation_phone_country_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_guest_phone_country_iso IS NOT NULL
     AND NULLIF(btrim(COALESCE(p_guest_phone_e164, '')), '') IS NULL THEN
    RAISE EXCEPTION 'reservation_phone_country_without_phone' USING ERRCODE = '22023';
  END IF;
  IF p_party_size < 1 OR p_party_size > 100 THEN
    RAISE EXCEPTION 'invalid_party_size' USING ERRCODE = '23514';
  END IF;
  IF p_source NOT IN ('mingla', 'website') THEN
    RAISE EXCEPTION 'invalid_source_%', p_source USING ERRCODE = '23514';
  END IF;
  IF p_created_via NOT IN ('consumer', 'guest') THEN
    RAISE EXCEPTION 'invalid_created_via_%', p_created_via USING ERRCODE = '23514';
  END IF;
  IF p_status NOT IN ('requested', 'confirmed') THEN
    RAISE EXCEPTION 'invalid_initial_status_%', p_status USING ERRCODE = '23514';
  END IF;
  IF p_payment_status NOT IN ('none', 'paid') THEN
    RAISE EXCEPTION 'invalid_payment_status_%', p_payment_status USING ERRCODE = '23514';
  END IF;

  SELECT v.brand_id, v.place_pool_id INTO v_brand_id, v_place_pool_id
  FROM public.venue_listings v
  WHERE v.id = p_venue_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'venue_not_reservable' USING ERRCODE = 'P0001';
  END IF;

  SELECT reservations_enabled INTO v_enabled
  FROM public.venue_reservation_settings
  WHERE venue_id = p_venue_id;
  IF v_enabled IS NOT TRUE THEN
    RAISE EXCEPTION 'venue_not_reservable' USING ERRCODE = 'P0001';
  END IF;
  SELECT iana_timezone INTO v_tz
  FROM public.venue_availability_config
  WHERE venue_id = p_venue_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'venue_not_reservable' USING ERRCODE = 'P0001';
  END IF;
  v_tz := NULLIF(btrim(COALESCE(v_tz, '')), '');
  IF v_tz IS NULL OR NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = v_tz) THEN
    v_tz := 'UTC';
  END IF;

  -- #4490 P5: the venue's table lock first (every writer takes it in this
  -- order), then the original (venue, start) lock.
  PERFORM pg_advisory_xact_lock(hashtextextended('issue_4490_tables:' || p_venue_id::text, 4490));
  v_lock_key := hashtextextended(p_venue_id::text || '|' || p_reserved_for::text, 0);
  PERFORM pg_advisory_xact_lock(v_lock_key);

  v_slot_date := (p_reserved_for AT TIME ZONE v_tz)::date;
  -- A big party (above every table and joined pair) may only ask.
  v_big_party := p_status = 'requested'
    AND p_party_size > COALESCE(public.issue_4490_table_party_max(p_venue_id), 0)
    AND COALESCE(cardinality(p_table_ids), 0) = 0;
  IF v_big_party THEN
    IF NOT public.issue_4490_feature_setting_on(p_venue_id, 'table_reservations', 'largePartyRequest') THEN
      RAISE EXCEPTION 'slot_unavailable' USING ERRCODE = 'P0001';
    END IF;
  ELSE
    SELECT EXISTS (
      SELECT 1
      FROM public.pg_venue_available_slots(
        p_date => v_slot_date,
        p_party_size => p_party_size,
        p_venue_id => p_venue_id,
        p_space_id => p_space_id
      ) s
      WHERE s.slot_start_utc = p_reserved_for
        AND s.is_full = false
        AND s.remaining > 0
    ) INTO v_slot_ok;
    IF NOT v_slot_ok THEN
      RAISE EXCEPTION 'slot_unavailable' USING ERRCODE = 'P0001';
    END IF;
    -- A picked table (or a seating area): checked under the table lock.
    IF COALESCE(cardinality(p_table_ids), 0) > 0 OR p_space_id IS NOT NULL THEN
      SELECT * INTO v_pick FROM public.issue_4490_resolve_table_pick(
        p_venue_id, p_reserved_for, p_party_size, p_table_ids, p_space_id, NULL, false);
      IF FOUND THEN
        v_table := v_pick.table_id;
        v_joined := COALESCE(v_pick.joined_table_ids, '{}'::uuid[]);
        v_min_spend := COALESCE(v_pick.min_spend_minor, 0);
        IF COALESCE(cardinality(p_table_ids), 0) > 0 AND COALESCE(v_pick.hold_minor_per_guest, 0) > 0
           AND (p_payment_status <> 'paid' OR COALESCE(p_fee_cents, 0) <= 0) THEN
          -- (the edge charges the hold; a discount code may lower what was paid)
          RAISE EXCEPTION 'deposit_required' USING ERRCODE = 'P0001';
        END IF;
      END IF;
    END IF;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.venue_capacity_rules cr
    WHERE cr.venue_id = p_venue_id
      AND cr.is_active
      AND cr.kind = 'deposit_threshold'
      AND COALESCE((cr.params->>'min_party_for_fee')::int, 1) <= p_party_size
  ) INTO v_deposit_required;
  IF v_deposit_required AND NOT v_big_party
     AND (p_payment_status <> 'paid' OR COALESCE(p_fee_cents, 0) <= 0) THEN
    RAISE EXCEPTION 'deposit_required' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.reservations (
    brand_id, venue_id, place_pool_id, reserved_for, party_size, status, source,
    created_via, guest_name, guest_phone_e164, guest_phone_country_iso, guest_email, consumer_user_id,
    occasion, guest_notes, fee_cents, fee_currency, payment_intent_id,
    payment_status, guest_cancel_token, table_id, joined_table_ids, min_spend_minor
  ) VALUES (
    v_brand_id, p_venue_id, v_place_pool_id, p_reserved_for, p_party_size, p_status, p_source,
    p_created_via, p_guest_name, NULLIF(btrim(COALESCE(p_guest_phone_e164, '')), ''), p_guest_phone_country_iso, p_guest_email,
    p_consumer_user_id, p_occasion, p_guest_notes,
    NULLIF(COALESCE(p_fee_cents, 0), 0), p_fee_currency, p_payment_intent_id,
    p_payment_status, p_guest_cancel_token, v_table, v_joined, v_min_spend
  ) RETURNING * INTO v_row;

  INSERT INTO public.audit_log (
    user_id, brand_id, action, target_type, target_id, after
  ) VALUES (
    p_consumer_user_id, v_brand_id,
    'venue_reservation.guest_create',
    'reservation', v_row.id,
    jsonb_build_object(
      'source', p_source, 'created_via', p_created_via,
      'party_size', p_party_size, 'reserved_for', p_reserved_for,
      'fee_cents', NULLIF(COALESCE(p_fee_cents, 0), 0),
      'payment_status', p_payment_status, 'status', p_status,
      'venue_id', p_venue_id, 'table_id', v_table, 'joined_table_ids', to_jsonb(v_joined),
      'min_spend_minor', v_min_spend
    )
  );

  RETURN v_row;
END;
$function$;
REVOKE ALL ON FUNCTION public.pg_create_guest_reservation(
  uuid,timestamptz,integer,text,text,uuid,text,text,text,integer,character,
  text,text,text,text,text,text,text,uuid[],uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pg_create_guest_reservation(
  uuid,timestamptz,integer,text,text,uuid,text,text,text,integer,character,
  text,text,text,text,text,text,text,uuid[],uuid
) TO service_role;

-- The paid path mints with the session's table pick. A table taken after the
-- charge is reported as slot_unavailable (the existing refund-due seam).
CREATE OR REPLACE FUNCTION public.pg_finalize_guest_reservation(
  p_session_id uuid,
  p_payment_intent_id text
) RETURNS TABLE (reservation public.reservations, session_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_session public.reservation_checkout_sessions;
  v_row public.reservations;
  v_venue_id uuid;
  v_legacy_ids uuid[];
BEGIN
  IF p_session_id IS NULL OR p_payment_intent_id IS NULL
     OR btrim(p_payment_intent_id) = '' THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_session
  FROM public.reservation_checkout_sessions
  WHERE id = p_session_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'session_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_session.reservation_id IS NOT NULL THEN
    SELECT * INTO v_row FROM public.reservations WHERE id = v_session.reservation_id;
    IF FOUND THEN
      reservation := v_row;
      session_id := v_session.id;
      RETURN NEXT;
      RETURN;
    END IF;
  END IF;

  SELECT * INTO v_row FROM public.reservations
  WHERE payment_intent_id = p_payment_intent_id
  LIMIT 1;
  IF FOUND THEN
    UPDATE public.reservation_checkout_sessions
       SET status = 'completed', reservation_id = v_row.id, updated_at = now()
     WHERE id = p_session_id;
    reservation := v_row;
    session_id := v_session.id;
    RETURN NEXT;
    RETURN;
  END IF;

  v_venue_id := v_session.venue_id;
  IF v_venue_id IS NULL THEN
    SELECT array_agg(v.id) INTO v_legacy_ids
    FROM public.venue_listings v
    WHERE v.brand_id = v_session.brand_id;
    IF v_legacy_ids IS NULL OR array_length(v_legacy_ids, 1) <> 1 THEN
      RAISE EXCEPTION 'venue_ambiguous' USING ERRCODE = 'P0001';
    END IF;
    v_venue_id := v_legacy_ids[1];
  END IF;

  BEGIN
    v_row := public.pg_create_guest_reservation(
      v_venue_id,
      v_session.reserved_for,
      v_session.party_size,
      CASE WHEN v_session.created_via = 'web' THEN 'website' ELSE 'mingla' END,
      CASE WHEN v_session.created_via = 'web' THEN 'guest' ELSE 'consumer' END,
      v_session.consumer_user_id,
      v_session.buyer_name,
      v_session.buyer_phone_e164,
      v_session.buyer_email,
      v_session.amount_cents,
      substr(v_session.currency, 1, 3)::char(3),
      p_payment_intent_id,
      'paid',
      v_session.guest_cancel_token,
      v_session.occasion,
      v_session.guest_notes,
      'confirmed',
      v_session.buyer_phone_country_iso,
      NULLIF(v_session.table_ids, '{}'::uuid[]),
      v_session.space_id
    );
  EXCEPTION WHEN unique_violation THEN
      SELECT * INTO v_row FROM public.reservations
      WHERE payment_intent_id = p_payment_intent_id
      LIMIT 1;
      IF NOT FOUND THEN
        RAISE;
      END IF;
    WHEN SQLSTATE 'PT409' THEN
      -- #4490 P5: the picked table went to someone else after the charge.
      RAISE EXCEPTION 'slot_unavailable' USING ERRCODE = 'P0001', DETAIL = 'table_taken';
  END;

  UPDATE public.reservation_checkout_sessions
     SET status = 'completed', reservation_id = v_row.id, updated_at = now()
   WHERE id = p_session_id;

  reservation := v_row;
  session_id := v_session.id;
  RETURN NEXT;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 9. Host: tables under spaces and the floor plan.
-- ---------------------------------------------------------------------------
-- Who may set up tables (the same people the old Tables screen allowed).
CREATE OR REPLACE FUNCTION public.issue_4490_can_manage_tables(p_venue_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.venue_listings v WHERE v.id = p_venue_id
      AND (public.biz_brand_effective_rank_for_caller(v.brand_id) >= public.biz_role_rank('event_manager')
           OR public.issue_4188_has_venue_capability(v.id, auth.uid(), 'restaurant.manage_reservations')));
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_table_projection(p_table_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT jsonb_build_object(
    'id', t.id, 'venueId', t.venue_id, 'spaceId', t.space_id, 'name', t.name,
    'capacity', t.capacity, 'minParty', t.min_party, 'maxParty', t.max_party,
    'shape', t.shape, 'planX', t.plan_x, 'planY', t.plan_y, 'planW', t.plan_w, 'planH', t.plan_h,
    'rotation', t.plan_rotation, 'combinable', t.combinable, 'accessible', t.accessible,
    'guestPickable', t.guest_pickable, 'minSpendMinor', t.min_spend_minor,
    'depositPerGuestMinor', t.deposit_minor_per_guest, 'reservationPolicy', t.reservation_policy,
    'isActive', t.is_active, 'zone', t.zone, 'sortOrder', t.sort_order, 'updatedAt', t.updated_at,
    'joinsWith', COALESCE((SELECT jsonb_agg(CASE WHEN j.table_a = t.id THEN j.table_b ELSE j.table_a END
                                            ORDER BY CASE WHEN j.table_a = t.id THEN j.table_b ELSE j.table_a END)
                           FROM public.venue_table_joins j WHERE j.table_a = t.id OR j.table_b = t.id), '[]'::jsonb))
  FROM public.venue_tables t WHERE t.id = p_table_id;
$function$;

-- create / update / archive one table (space, seats, shape, place on the
-- plan, minimum spend, per-guest hold, guests can pick it, joins).
CREATE OR REPLACE FUNCTION public.issue_4490_manage_table(
  p_action text,
  p_venue_id uuid,
  p_payload jsonb,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_venue public.venue_listings%ROWTYPE;
  v_table public.venue_tables%ROWTYPE;
  v_hash text;
  v_replay jsonb;
  v_result jsonb;
  v_space uuid;
  v_joins uuid[];
  v_other uuid;
  v_capacity integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF p_action NOT IN ('create', 'update', 'archive') OR p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'invalid_payload' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_venue FROM public.venue_listings WHERE id = p_venue_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'venue_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.issue_4490_can_manage_tables(p_venue_id) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  v_hash := encode(pg_catalog.sha256(convert_to(jsonb_build_object(
    'action', p_action, 'venue', p_venue_id, 'payload', p_payload)::text, 'UTF8')), 'hex');
  v_replay := public.issue_4490_receipt_lookup('manage_table:' || p_venue_id::text, p_idempotency_key, v_hash);
  IF v_replay IS NOT NULL THEN
    RETURN v_replay;
  END IF;
  IF p_action <> 'create' THEN
    SELECT * INTO v_table FROM public.venue_tables
    WHERE id = NULLIF(p_payload->>'tableId', '')::uuid AND venue_id = p_venue_id AND deleted_at IS NULL
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'table_not_found' USING ERRCODE = 'P0002';
    END IF;
  END IF;

  IF p_action = 'archive' THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('issue_4490_tables:' || p_venue_id::text, 4490));
    UPDATE public.venue_tables SET is_active = false, deleted_at = now(), updated_at = now()
    WHERE id = v_table.id;
    v_result := jsonb_build_object('tableId', v_table.id, 'archived', true);
    PERFORM public.issue_4490_receipt_store('manage_table:' || p_venue_id::text, p_idempotency_key, v_hash, v_result);
    RETURN v_result || jsonb_build_object('replayed', false);
  END IF;

  -- Validate the fields present (all required on create).
  IF (p_action = 'create' OR p_payload ? 'name')
     AND char_length(btrim(COALESCE(p_payload->>'name', ''))) NOT BETWEEN 1 AND 60 THEN
    RAISE EXCEPTION 'table_name_required' USING ERRCODE = '22023';
  END IF;
  IF (p_action = 'create' OR p_payload ? 'capacity')
     AND (COALESCE(p_payload->>'capacity', '') !~ '^[0-9]{1,3}$' OR (p_payload->>'capacity')::integer NOT BETWEEN 1 AND 100) THEN
    RAISE EXCEPTION 'table_capacity_invalid' USING ERRCODE = '22023';
  END IF;
  v_capacity := COALESCE((p_payload->>'capacity')::integer, v_table.capacity);
  IF p_payload ? 'minParty' AND p_payload->'minParty' <> 'null'::jsonb
     AND (COALESCE(p_payload->>'minParty', '') !~ '^[0-9]{1,3}$'
          OR (p_payload->>'minParty')::integer NOT BETWEEN 1 AND v_capacity) THEN
    RAISE EXCEPTION 'table_min_party_invalid' USING ERRCODE = '22023';
  END IF;
  IF (p_action = 'create' OR p_payload ? 'spaceId') THEN
    v_space := CASE WHEN COALESCE(p_payload->>'spaceId', '') ~ '^[0-9a-f-]{36}$' THEN (p_payload->>'spaceId')::uuid END;
    IF v_space IS NULL OR NOT EXISTS (SELECT 1 FROM public.venue_spaces s WHERE s.id = v_space
                                      AND s.venue_id = p_venue_id AND s.archived_at IS NULL) THEN
      RAISE EXCEPTION 'table_space_invalid' USING ERRCODE = '22023';
    END IF;
  ELSE
    v_space := v_table.space_id;
  END IF;
  IF p_payload ? 'shape' AND COALESCE(p_payload->>'shape', '') NOT IN ('booth', 'sofa', 'high_top', 'round', 'rect') THEN
    RAISE EXCEPTION 'table_shape_invalid' USING ERRCODE = '22023';
  END IF;
  IF (p_payload ? 'planX' AND p_payload->'planX' <> 'null'::jsonb
        AND (jsonb_typeof(p_payload->'planX') <> 'number' OR (p_payload->>'planX')::numeric NOT BETWEEN 0 AND 1000))
     OR (p_payload ? 'planY' AND p_payload->'planY' <> 'null'::jsonb
        AND (jsonb_typeof(p_payload->'planY') <> 'number' OR (p_payload->>'planY')::numeric NOT BETWEEN 0 AND 1000))
     OR (p_payload ? 'planW' AND p_payload->'planW' <> 'null'::jsonb
        AND (jsonb_typeof(p_payload->'planW') <> 'number' OR (p_payload->>'planW')::numeric NOT BETWEEN 1 AND 1000))
     OR (p_payload ? 'planH' AND p_payload->'planH' <> 'null'::jsonb
        AND (jsonb_typeof(p_payload->'planH') <> 'number' OR (p_payload->>'planH')::numeric NOT BETWEEN 1 AND 1000))
     OR (p_payload ? 'rotation' AND (COALESCE(p_payload->>'rotation', '') !~ '^[0-9]{1,3}$'
        OR (p_payload->>'rotation')::integer > 359)) THEN
    RAISE EXCEPTION 'table_plan_invalid' USING ERRCODE = '22023';
  END IF;
  IF (p_payload ? 'combinable' AND jsonb_typeof(p_payload->'combinable') <> 'boolean')
     OR (p_payload ? 'accessible' AND jsonb_typeof(p_payload->'accessible') <> 'boolean')
     OR (p_payload ? 'guestPickable' AND jsonb_typeof(p_payload->'guestPickable') <> 'boolean') THEN
    RAISE EXCEPTION 'invalid_payload' USING ERRCODE = '22023';
  END IF;
  IF p_payload ? 'minSpendMinor' AND (jsonb_typeof(p_payload->'minSpendMinor') <> 'number'
     OR (p_payload->>'minSpendMinor') !~ '^[0-9]{1,12}$') THEN
    RAISE EXCEPTION 'table_min_spend_invalid' USING ERRCODE = '22023';
  END IF;
  IF COALESCE((p_payload->>'minSpendMinor')::bigint, 0) > 0
     AND NOT public.issue_4490_venue_feature_on(p_venue_id, 'min_spend_tables') THEN
    RAISE EXCEPTION 'min_spend_tables_off' USING ERRCODE = 'P0001';
  END IF;
  IF p_payload ? 'depositPerGuestMinor' AND p_payload->'depositPerGuestMinor' <> 'null'::jsonb
     AND (jsonb_typeof(p_payload->'depositPerGuestMinor') <> 'number'
          OR (p_payload->>'depositPerGuestMinor') !~ '^[0-9]{1,10}$') THEN
    RAISE EXCEPTION 'table_hold_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_payload ? 'reservationPolicy'
     AND COALESCE(p_payload->>'reservationPolicy', '') NOT IN ('reservable', 'walk_in_only', 'approval_required') THEN
    RAISE EXCEPTION 'invalid_payload' USING ERRCODE = '22023';
  END IF;
  IF p_payload ? 'joinsWith' AND (jsonb_typeof(p_payload->'joinsWith') <> 'array'
     OR jsonb_array_length(p_payload->'joinsWith') > 8
     OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(p_payload->'joinsWith') x WHERE x !~ '^[0-9a-f-]{36}$')) THEN
    RAISE EXCEPTION 'table_join_invalid' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('issue_4490_tables:' || p_venue_id::text, 4490));
  IF p_action = 'create' THEN
    INSERT INTO public.venue_tables (
      brand_id, venue_id, place_pool_id, name, capacity, min_party, combinable, accessible,
      reservation_policy, sort_order, space_id, plan_x, plan_y, plan_w, plan_h, plan_rotation, shape,
      min_spend_minor, deposit_minor_per_guest, guest_pickable
    ) VALUES (
      v_venue.brand_id, p_venue_id, v_venue.place_pool_id, btrim(p_payload->>'name'), v_capacity,
      NULLIF(p_payload->>'minParty', '')::integer,
      COALESCE((p_payload->>'combinable')::boolean, false), COALESCE((p_payload->>'accessible')::boolean, false),
      COALESCE(p_payload->>'reservationPolicy', 'reservable'),
      COALESCE((SELECT max(t.sort_order) + 1 FROM public.venue_tables t WHERE t.venue_id = p_venue_id), 0),
      v_space, NULLIF(p_payload->>'planX', '')::numeric, NULLIF(p_payload->>'planY', '')::numeric,
      NULLIF(p_payload->>'planW', '')::numeric, NULLIF(p_payload->>'planH', '')::numeric,
      COALESCE((p_payload->>'rotation')::integer, 0), COALESCE(p_payload->>'shape', 'rect'),
      COALESCE((p_payload->>'minSpendMinor')::bigint, 0), NULLIF(p_payload->>'depositPerGuestMinor', '')::bigint,
      COALESCE((p_payload->>'guestPickable')::boolean, true)
    ) RETURNING * INTO v_table;
  ELSE
    UPDATE public.venue_tables SET
      name = CASE WHEN p_payload ? 'name' THEN btrim(p_payload->>'name') ELSE name END,
      capacity = v_capacity,
      min_party = CASE WHEN p_payload ? 'minParty' THEN NULLIF(p_payload->>'minParty', '')::integer ELSE min_party END,
      max_party = CASE WHEN max_party IS NOT NULL AND max_party > v_capacity THEN v_capacity ELSE max_party END,
      combinable = COALESCE((p_payload->>'combinable')::boolean, combinable),
      accessible = COALESCE((p_payload->>'accessible')::boolean, accessible),
      reservation_policy = COALESCE(p_payload->>'reservationPolicy', reservation_policy),
      space_id = v_space,
      plan_x = CASE WHEN p_payload ? 'planX' THEN NULLIF(p_payload->>'planX', '')::numeric ELSE plan_x END,
      plan_y = CASE WHEN p_payload ? 'planY' THEN NULLIF(p_payload->>'planY', '')::numeric ELSE plan_y END,
      plan_w = CASE WHEN p_payload ? 'planW' THEN NULLIF(p_payload->>'planW', '')::numeric ELSE plan_w END,
      plan_h = CASE WHEN p_payload ? 'planH' THEN NULLIF(p_payload->>'planH', '')::numeric ELSE plan_h END,
      plan_rotation = COALESCE((p_payload->>'rotation')::integer, plan_rotation),
      shape = COALESCE(p_payload->>'shape', shape),
      min_spend_minor = COALESCE((p_payload->>'minSpendMinor')::bigint, min_spend_minor),
      deposit_minor_per_guest = CASE WHEN p_payload ? 'depositPerGuestMinor'
        THEN NULLIF(p_payload->>'depositPerGuestMinor', '')::bigint ELSE deposit_minor_per_guest END,
      guest_pickable = COALESCE((p_payload->>'guestPickable')::boolean, guest_pickable),
      updated_at = now()
    WHERE id = v_table.id RETURNING * INTO v_table;
  END IF;
  IF p_payload ? 'joinsWith' THEN
    SELECT COALESCE(array_agg(DISTINCT x::uuid), '{}'::uuid[]) INTO v_joins
    FROM jsonb_array_elements_text(p_payload->'joinsWith') x WHERE x::uuid <> v_table.id;
    IF cardinality(v_joins) > 0 AND NOT v_table.combinable THEN
      RAISE EXCEPTION 'table_join_invalid' USING ERRCODE = '22023';
    END IF;
    DELETE FROM public.venue_table_joins
    WHERE (table_a = v_table.id AND NOT table_b = ANY(v_joins))
       OR (table_b = v_table.id AND NOT table_a = ANY(v_joins));
    FOREACH v_other IN ARRAY v_joins LOOP
      IF NOT EXISTS (SELECT 1 FROM public.venue_tables t WHERE t.id = v_other AND t.venue_id = p_venue_id
                       AND t.deleted_at IS NULL) THEN
        RAISE EXCEPTION 'table_join_invalid' USING ERRCODE = '22023';
      END IF;
      INSERT INTO public.venue_table_joins (table_a, table_b)
      VALUES (LEAST(v_table.id, v_other), GREATEST(v_table.id, v_other))
      ON CONFLICT DO NOTHING;
    END LOOP;
  END IF;
  v_result := public.issue_4490_table_projection(v_table.id);
  PERFORM public.issue_4490_receipt_store('manage_table:' || p_venue_id::text, p_idempotency_key, v_hash, v_result);
  RETURN v_result || jsonb_build_object('replayed', false);
END;
$function$;

-- Save where the tables of one space sit (drag, resize, rotate, shape) and,
-- optionally, the space's own outline. One version check on the space.
CREATE OR REPLACE FUNCTION public.issue_4490_save_floor_plan(
  p_venue_id uuid,
  p_space_id uuid,
  p_payload jsonb,
  p_expected_version bigint,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_space public.venue_spaces%ROWTYPE;
  v_hash text;
  v_replay jsonb;
  v_result jsonb;
  v_item jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.issue_4490_can_manage_tables(p_venue_id) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object'
     OR jsonb_typeof(COALESCE(p_payload->'tables', '[]'::jsonb)) <> 'array'
     OR jsonb_array_length(COALESCE(p_payload->'tables', '[]'::jsonb)) > 200 THEN
    RAISE EXCEPTION 'invalid_payload' USING ERRCODE = '22023';
  END IF;
  v_hash := encode(pg_catalog.sha256(convert_to(jsonb_build_object(
    'venue', p_venue_id, 'space', p_space_id, 'payload', p_payload, 'expected', p_expected_version)::text, 'UTF8')), 'hex');
  v_replay := public.issue_4490_receipt_lookup('save_floor_plan:' || p_venue_id::text, p_idempotency_key, v_hash);
  IF v_replay IS NOT NULL THEN
    RETURN v_replay;
  END IF;
  SELECT * INTO v_space FROM public.venue_spaces
  WHERE id = p_space_id AND venue_id = p_venue_id AND archived_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'space_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF p_expected_version IS NULL OR v_space.version <> p_expected_version THEN
    RAISE EXCEPTION 'stale_write' USING ERRCODE = 'PT409';
  END IF;
  FOR v_item IN SELECT x FROM jsonb_array_elements(COALESCE(p_payload->'tables', '[]'::jsonb)) x LOOP
    IF jsonb_typeof(v_item) <> 'object' OR COALESCE(v_item->>'tableId', '') !~ '^[0-9a-f-]{36}$'
       OR jsonb_typeof(v_item->'planX') <> 'number' OR (v_item->>'planX')::numeric NOT BETWEEN 0 AND 1000
       OR jsonb_typeof(v_item->'planY') <> 'number' OR (v_item->>'planY')::numeric NOT BETWEEN 0 AND 1000
       OR (v_item ? 'planW' AND (jsonb_typeof(v_item->'planW') <> 'number' OR (v_item->>'planW')::numeric NOT BETWEEN 1 AND 1000))
       OR (v_item ? 'planH' AND (jsonb_typeof(v_item->'planH') <> 'number' OR (v_item->>'planH')::numeric NOT BETWEEN 1 AND 1000))
       OR (v_item ? 'rotation' AND (COALESCE(v_item->>'rotation', '') !~ '^[0-9]{1,3}$' OR (v_item->>'rotation')::integer > 359))
       OR (v_item ? 'shape' AND COALESCE(v_item->>'shape', '') NOT IN ('booth', 'sofa', 'high_top', 'round', 'rect')) THEN
      RAISE EXCEPTION 'table_plan_invalid' USING ERRCODE = '22023';
    END IF;
    UPDATE public.venue_tables SET
      plan_x = (v_item->>'planX')::numeric, plan_y = (v_item->>'planY')::numeric,
      plan_w = CASE WHEN v_item ? 'planW' THEN (v_item->>'planW')::numeric ELSE plan_w END,
      plan_h = CASE WHEN v_item ? 'planH' THEN (v_item->>'planH')::numeric ELSE plan_h END,
      plan_rotation = COALESCE((v_item->>'rotation')::integer, plan_rotation),
      shape = COALESCE(v_item->>'shape', shape),
      updated_at = now()
    WHERE id = (v_item->>'tableId')::uuid AND venue_id = p_venue_id AND space_id = p_space_id AND deleted_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'table_not_found' USING ERRCODE = 'P0002';
    END IF;
  END LOOP;
  UPDATE public.venue_spaces SET
    plan_shape = CASE WHEN p_payload ? 'planShape'
                      THEN CASE WHEN jsonb_typeof(p_payload->'planShape') = 'null' THEN NULL ELSE p_payload->'planShape' END
                      ELSE plan_shape END,
    version = version + 1, updated_at = now()
  WHERE id = p_space_id;
  v_result := public.issue_4490_floor_plan(p_venue_id, p_space_id, now());
  PERFORM public.issue_4490_receipt_store('save_floor_plan:' || p_venue_id::text, p_idempotency_key, v_hash, v_result);
  RETURN v_result || jsonb_build_object('replayed', false);
END;
$function$;

-- Arrange the spaces on the site plan in one save (each space's outline).
CREATE OR REPLACE FUNCTION public.issue_4490_arrange_spaces(
  p_venue_id uuid,
  p_payload jsonb,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_hash text;
  v_replay jsonb;
  v_result jsonb;
  v_item jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.issue_4490_can_manage_venue(p_venue_id, 'venue.manage_offers') THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload->'spaces') <> 'array'
     OR jsonb_array_length(p_payload->'spaces') NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'invalid_payload' USING ERRCODE = '22023';
  END IF;
  v_hash := encode(pg_catalog.sha256(convert_to(jsonb_build_object(
    'venue', p_venue_id, 'payload', p_payload)::text, 'UTF8')), 'hex');
  v_replay := public.issue_4490_receipt_lookup('arrange_spaces:' || p_venue_id::text, p_idempotency_key, v_hash);
  IF v_replay IS NOT NULL THEN
    RETURN v_replay;
  END IF;
  FOR v_item IN SELECT x FROM jsonb_array_elements(p_payload->'spaces') x LOOP
    IF jsonb_typeof(v_item) <> 'object' OR COALESCE(v_item->>'spaceId', '') !~ '^[0-9a-f-]{36}$'
       OR jsonb_typeof(v_item->'planShape') NOT IN ('object', 'null') THEN
      RAISE EXCEPTION 'space_plan_invalid' USING ERRCODE = '22023';
    END IF;
    IF v_item ? 'version' AND NOT EXISTS (SELECT 1 FROM public.venue_spaces s
         WHERE s.id = (v_item->>'spaceId')::uuid AND s.version = (v_item->>'version')::bigint) THEN
      RAISE EXCEPTION 'stale_write' USING ERRCODE = 'PT409';
    END IF;
    UPDATE public.venue_spaces SET
      plan_shape = CASE WHEN jsonb_typeof(v_item->'planShape') = 'null' THEN NULL ELSE v_item->'planShape' END,
      version = version + 1, updated_at = now()
    WHERE id = (v_item->>'spaceId')::uuid AND venue_id = p_venue_id AND archived_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'space_not_found' USING ERRCODE = 'P0002';
    END IF;
  END LOOP;
  SELECT jsonb_build_object('spaces', COALESCE(jsonb_agg(jsonb_build_object(
      'id', s.id, 'name', s.name, 'planShape', s.plan_shape, 'version', s.version) ORDER BY s.sort_order, s.name), '[]'::jsonb))
  INTO v_result
  FROM public.venue_spaces s WHERE s.venue_id = p_venue_id AND s.archived_at IS NULL;
  PERFORM public.issue_4490_receipt_store('arrange_spaces:' || p_venue_id::text, p_idempotency_key, v_hash, v_result);
  RETURN v_result || jsonb_build_object('replayed', false);
END;
$function$;

-- The Host floor plan: spaces, their tables where they sit, who is on each
-- table at a moment (and next), "Free around", bookings with no table yet.
CREATE OR REPLACE FUNCTION public.issue_4490_floor_plan(
  p_venue_id uuid,
  p_space_id uuid DEFAULT NULL,
  p_at timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_cfg public.venue_availability_config%ROWTYPE;
  v_tz text;
  v_at timestamptz := COALESCE(p_at, now());
  v_day date;
  v_day_from timestamptz;
  v_day_to timestamptz;
BEGIN
  IF auth.uid() IS NULL OR NOT (public.issue_4490_can_view_venue(p_venue_id)
                                OR public.issue_4490_can_manage_tables(p_venue_id)) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_cfg FROM public.venue_availability_config WHERE venue_id = p_venue_id;
  v_tz := COALESCE(NULLIF(btrim(COALESCE(v_cfg.iana_timezone, '')), ''), public.issue_4490_venue_timezone(p_venue_id), 'UTC');
  v_day := (v_at AT TIME ZONE v_tz)::date;
  v_day_from := v_day::timestamp AT TIME ZONE v_tz;
  v_day_to := (v_day + 1)::timestamp AT TIME ZONE v_tz;
  RETURN jsonb_build_object(
    'venueId', p_venue_id,
    'at', v_at,
    'localDate', v_day,
    'timezone', v_tz,
    'features', jsonb_build_object(
      'floorPlan', public.issue_4490_venue_feature_on(p_venue_id, 'floor_plan'),
      'pickATable', public.issue_4490_venue_feature_on(p_venue_id, 'pick_a_table'),
      'minSpendTables', public.issue_4490_venue_feature_on(p_venue_id, 'min_spend_tables')),
    'partyMax', public.issue_4490_table_party_max(p_venue_id),
    'spaces', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', s.id, 'name', s.name, 'setting', s.setting, 'planShape', s.plan_shape, 'version', s.version,
        'tables', COALESCE((
          SELECT jsonb_agg(public.issue_4490_table_projection(t.id) || jsonb_build_object(
            'now', (SELECT jsonb_build_object('reservationId', r.id, 'guestName', r.guest_name,
                      'partySize', r.party_size, 'reservedFor', r.reserved_for, 'status', r.status,
                      'minSpendMinor', r.min_spend_minor, 'joined', cardinality(r.joined_table_ids) > 0,
                      'freeAround', COALESCE(r.finishing_at, r.reserved_for + make_interval(mins =>
                        public.pg_venue_turn_minutes_for_party(v_cfg.turn_times, r.party_size))))
                    FROM public.reservations r
                    WHERE r.venue_id = p_venue_id AND r.status IN ('requested', 'confirmed', 'seated')
                      AND (r.table_id = t.id OR t.id = ANY(r.joined_table_ids))
                      AND r.reserved_for <= v_at
                      AND COALESCE(r.finishing_at, r.reserved_for + make_interval(mins =>
                        public.pg_venue_turn_minutes_for_party(v_cfg.turn_times, r.party_size))) > v_at
                    ORDER BY r.reserved_for DESC LIMIT 1),
            'next', (SELECT jsonb_build_object('reservationId', r.id, 'guestName', r.guest_name,
                       'partySize', r.party_size, 'reservedFor', r.reserved_for, 'status', r.status)
                     FROM public.reservations r
                     WHERE r.venue_id = p_venue_id AND r.status IN ('requested', 'confirmed')
                       AND (r.table_id = t.id OR t.id = ANY(r.joined_table_ids))
                       AND r.reserved_for > v_at AND r.reserved_for < v_day_to
                     ORDER BY r.reserved_for LIMIT 1))
            ORDER BY t.sort_order, t.name)
          FROM public.venue_tables t
          WHERE t.space_id = s.id AND t.deleted_at IS NULL), '[]'::jsonb))
        ORDER BY s.sort_order, s.name)
      FROM public.venue_spaces s
      WHERE s.venue_id = p_venue_id AND s.archived_at IS NULL
        AND (p_space_id IS NULL OR s.id = p_space_id)), '[]'::jsonb),
    'unplaced', COALESCE((
      SELECT jsonb_agg(public.issue_4490_table_projection(t.id) ORDER BY t.sort_order, t.name)
      FROM public.venue_tables t
      WHERE t.venue_id = p_venue_id AND t.deleted_at IS NULL AND t.space_id IS NULL), '[]'::jsonb),
    'unassigned', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('reservationId', r.id, 'guestName', r.guest_name,
        'partySize', r.party_size, 'reservedFor', r.reserved_for, 'status', r.status, 'version', r.version)
        ORDER BY r.reserved_for)
      FROM public.reservations r
      WHERE r.venue_id = p_venue_id AND r.table_id IS NULL
        AND r.status IN ('requested', 'confirmed', 'seated')
        AND r.reserved_for >= v_day_from AND r.reserved_for < v_day_to), '[]'::jsonb)
  );
END;
$function$;

-- "Best fit" / "Or join" for a booking (or a party and time): free options
-- first, single tables by size, then joined pairs.
CREATE OR REPLACE FUNCTION public.issue_4490_suggest_tables(
  p_venue_id uuid,
  p_reserved_for timestamptz,
  p_party_size integer,
  p_space_id uuid DEFAULT NULL,
  p_reservation_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_options jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT (public.issue_4490_can_view_venue(p_venue_id)
                                OR public.issue_4490_can_manage_tables(p_venue_id)) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF p_reserved_for IS NULL OR p_party_size IS NULL OR p_party_size NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'invalid_payload' USING ERRCODE = '22023';
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'kind', o.option_kind, 'tableIds', to_jsonb(o.table_ids), 'names', to_jsonb(o.table_names),
      'capacity', o.capacity, 'spaceId', o.space_id, 'free', NOT o.taken,
      'minSpendMinor', o.min_spend_minor) ORDER BY o.taken, (o.option_kind = 'join'), o.capacity, o.table_names[1]), '[]'::jsonb)
  INTO v_options
  FROM public.issue_4490_table_slot_occupancy(p_venue_id, p_reserved_for, p_party_size, p_space_id, p_reservation_id) o;
  RETURN jsonb_build_object(
    'bestFit', (SELECT x FROM jsonb_array_elements(v_options) x WHERE x->>'kind' = 'table' AND (x->>'free')::boolean LIMIT 1),
    'orJoin', (SELECT x FROM jsonb_array_elements(v_options) x WHERE x->>'kind' = 'join' AND (x->>'free')::boolean LIMIT 1),
    'options', v_options);
END;
$function$;

-- Give a booking a table (or two joined tables), move it, or clear it
-- (empty list). Refused when the table is taken at that time.
CREATE OR REPLACE FUNCTION public.issue_4490_assign_table(
  p_reservation_id uuid,
  p_table_ids uuid[],
  p_expected_version bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_res public.reservations%ROWTYPE;
  v_pick record;
BEGIN
  SELECT * INTO v_res FROM public.reservations WHERE id = p_reservation_id;
  IF NOT FOUND OR auth.uid() IS NULL OR NOT public.issue_4490_can_manage_tables(v_res.venue_id) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('issue_4490_tables:' || v_res.venue_id::text, 4490));
  SELECT * INTO v_res FROM public.reservations WHERE id = p_reservation_id FOR UPDATE;
  IF p_expected_version IS NULL OR v_res.version <> p_expected_version THEN
    RAISE EXCEPTION 'stale_write' USING ERRCODE = 'PT409';
  END IF;
  IF v_res.status NOT IN ('requested', 'confirmed', 'seated') THEN
    RAISE EXCEPTION 'reservation_not_active' USING ERRCODE = 'PT409';
  END IF;
  IF COALESCE(cardinality(p_table_ids), 0) = 0 THEN
    UPDATE public.reservations SET table_id = NULL, joined_table_ids = '{}'::uuid[], min_spend_minor = 0,
      version = version + 1, updated_at = now()
    WHERE id = v_res.id RETURNING * INTO v_res;
  ELSE
    SELECT * INTO v_pick FROM public.issue_4490_resolve_table_pick(
      v_res.venue_id, v_res.reserved_for, v_res.party_size, p_table_ids, NULL, v_res.id, true);
    UPDATE public.reservations SET table_id = v_pick.table_id,
      joined_table_ids = COALESCE(v_pick.joined_table_ids, '{}'::uuid[]),
      min_spend_minor = GREATEST(v_res.min_spend_minor, COALESCE(v_pick.min_spend_minor, 0)),
      version = version + 1, updated_at = now()
    WHERE id = v_res.id RETURNING * INTO v_res;
  END IF;
  RETURN jsonb_build_object('reservationId', v_res.id, 'tableId', v_res.table_id,
    'joinedTableIds', to_jsonb(v_res.joined_table_ids), 'minSpendMinor', v_res.min_spend_minor,
    'version', v_res.version);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 10. Public page: the tables block (party cap incl. joins, pick a table,
--     hold and minimum spend "from", big-party request, guest waitlist).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_4490_public_tables(p_venue_id uuid, p_features text[])
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT CASE WHEN NOT ('table_reservations' = ANY(p_features)) THEN NULL ELSE jsonb_build_object(
    'partyMax', public.issue_4490_table_party_max(p_venue_id),
    'pickATable', 'pick_a_table' = ANY(p_features),
    'holdFromMinor', (SELECT min(t.deposit_minor_per_guest) FROM public.venue_tables t
                      WHERE t.venue_id = p_venue_id AND t.is_active AND t.deleted_at IS NULL
                        AND t.reservation_policy = 'reservable' AND t.deposit_minor_per_guest > 0),
    'minSpendFromMinor', CASE WHEN 'min_spend_tables' = ANY(p_features) THEN
                            (SELECT min(t.min_spend_minor) FROM public.venue_tables t
                             WHERE t.venue_id = p_venue_id AND t.is_active AND t.deleted_at IS NULL
                               AND t.reservation_policy = 'reservable' AND t.min_spend_minor > 0) END,
    'largePartyRequest', public.issue_4490_feature_setting_on(p_venue_id, 'table_reservations', 'largePartyRequest'),
    'guestWaitlist', 'waitlist' = ANY(p_features)
                     AND public.issue_4490_feature_setting_on(p_venue_id, 'waitlist', 'guestJoin'),
    'notifyMe', 'waitlist' = ANY(p_features)
                AND public.issue_4490_feature_setting_on(p_venue_id, 'waitlist', 'guestJoin'),
    'seatingAreas', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('spaceId', s.id, 'name', s.name) ORDER BY s.sort_order, s.name)
      FROM public.venue_spaces s
      WHERE s.venue_id = p_venue_id AND s.is_active AND s.archived_at IS NULL
        AND EXISTS (SELECT 1 FROM public.venue_tables t WHERE t.space_id = s.id AND t.is_active
                      AND t.deleted_at IS NULL AND t.reservation_policy = 'reservable')), '[]'::jsonb)
  ) END;
$function$;

-- ---------------------------------------------------------------------------
-- 11. Guest waitlist (edge venue-waitlist; service role only). A guest joins
--     with no account: tonight's waitlist (a day, any time) or "tell me if a
--     table opens" (a day and a time range). The private link's token is
--     stored as SHA-256 only. An entry opens only with its token or for its
--     own signed-in guest (the booking-access rule).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_4490_waitlist_position(p_waitlist_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT CASE WHEN w.status <> 'waiting' THEN NULL ELSE 1 + (
    SELECT count(*)::integer FROM public.venue_waitlist o
    WHERE o.venue_id = w.venue_id AND o.status = 'waiting' AND o.id <> w.id
      AND o.created_at < w.created_at
      AND COALESCE(o.desired_date, (o.created_at AT TIME ZONE public.issue_4490_venue_timezone(o.venue_id))::date)
          = COALESCE(w.desired_date, (w.created_at AT TIME ZONE public.issue_4490_venue_timezone(w.venue_id))::date)) END
  FROM public.venue_waitlist w WHERE w.id = p_waitlist_id;
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_waitlist_projection(p_waitlist_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT jsonb_build_object(
    'waitlistId', w.id,
    'status', CASE WHEN w.status = 'lost' AND w.left_by_guest_at IS NOT NULL THEN 'left'
                   WHEN w.status = 'converted' THEN 'seated' ELSE w.status END,
    'position', public.issue_4490_waitlist_position(w.id),
    'partySize', w.party_size,
    'desiredDate', w.desired_date,
    'desiredFrom', to_char(w.desired_from, 'HH24:MI'),
    'desiredTo', to_char(w.desired_to, 'HH24:MI'),
    'quotedWaitMinutes', w.quoted_wait_minutes,
    'notifiedAt', w.notified_at,
    'offeredSlotAt', w.offered_slot_at,
    'expiresAt', w.expires_at,
    'guestName', w.guest_name,
    'createdAt', w.created_at,
    'venue', (SELECT jsonb_build_object('id', v.id, 'name', v.name, 'slug', v.slug, 'brandSlug', b.slug,
                'brandName', b.name, 'timezone', public.issue_4490_venue_timezone(v.id))
              FROM public.venue_listings v JOIN public.brands b ON b.id = v.brand_id WHERE v.id = w.venue_id))
  FROM public.venue_waitlist w WHERE w.id = p_waitlist_id;
$function$;

CREATE OR REPLACE FUNCTION public.pg_join_venue_waitlist(
  p_venue_id uuid,
  p_party_size integer,
  p_desired_date date,
  p_desired_from time,
  p_desired_to time,
  p_guest jsonb,
  p_token_hash bytea,
  p_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_venue public.venue_listings%ROWTYPE;
  v_cfg public.venue_availability_config%ROWTYPE;
  v_tz text;
  v_today date;
  v_name text;
  v_email text;
  v_phone text;
  v_iso text;
  v_id uuid;
  v_existing public.venue_waitlist%ROWTYPE;
BEGIN
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_venue_id IS NULL OR p_desired_date IS NULL OR p_party_size IS NULL OR p_party_size NOT BETWEEN 1 AND 100
     OR p_token_hash IS NULL OR octet_length(p_token_hash) <> 32
     OR (p_desired_from IS NULL) <> (p_desired_to IS NULL)
     OR (p_desired_from IS NOT NULL AND p_desired_to <= p_desired_from)
     OR p_guest IS NULL OR jsonb_typeof(p_guest) <> 'object' THEN
    RAISE EXCEPTION 'waitlist_invalid' USING ERRCODE = '22023';
  END IF;
  v_name := btrim(COALESCE(p_guest->>'name', ''));
  v_email := NULLIF(lower(btrim(COALESCE(p_guest->>'email', ''))), '');
  v_phone := NULLIF(btrim(COALESCE(p_guest->>'phone', '')), '');
  v_iso := NULLIF(btrim(COALESCE(p_guest->>'phoneCountryIso', '')), '');
  IF char_length(v_name) NOT BETWEEN 2 AND 120
     OR (v_email IS NULL AND v_phone IS NULL)
     OR (v_email IS NOT NULL AND (char_length(v_email) > 254 OR v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'))
     OR (v_phone IS NOT NULL AND v_phone !~ '^\+[1-9][0-9]{7,14}$')
     OR (v_iso IS NOT NULL AND (v_iso !~ '^[A-Z]{2}$' OR v_phone IS NULL)) THEN
    RAISE EXCEPTION 'waitlist_guest_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_venue FROM public.venue_listings WHERE id = p_venue_id AND claim_status = 'verified';
  IF NOT FOUND OR NOT public.issue_4490_venue_feature_on(p_venue_id, 'table_reservations')
     OR NOT public.issue_4490_venue_feature_on(p_venue_id, 'waitlist')
     OR NOT public.issue_4490_feature_setting_on(p_venue_id, 'waitlist', 'guestJoin') THEN
    RAISE EXCEPTION 'waitlist_closed' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_cfg FROM public.venue_availability_config WHERE venue_id = p_venue_id;
  v_tz := COALESCE(NULLIF(btrim(COALESCE(v_cfg.iana_timezone, '')), ''), 'UTC');
  v_today := (now() AT TIME ZONE v_tz)::date;
  IF p_desired_date < v_today OR p_desired_date > v_today + COALESCE(v_cfg.advance_window_days, 30) THEN
    RAISE EXCEPTION 'waitlist_date_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_party_size > COALESCE(public.issue_4490_table_party_max(p_venue_id), 0) THEN
    RAISE EXCEPTION 'waitlist_party_too_large' USING ERRCODE = '22023';
  END IF;
  -- One active entry per contact per venue and day.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'issue_4490_waitlist:' || p_venue_id::text || ':' || p_desired_date::text || ':' || COALESCE(v_email, v_phone), 4490));
  SELECT * INTO v_existing FROM public.venue_waitlist w
  WHERE w.venue_id = p_venue_id AND w.source = 'guest' AND w.desired_date = p_desired_date
    AND w.status IN ('waiting', 'notified')
    AND ((v_email IS NOT NULL AND lower(w.guest_email) = v_email) OR (v_phone IS NOT NULL AND w.guest_phone_e164 = v_phone));
  IF FOUND THEN
    IF v_existing.manage_token_hash = p_token_hash THEN
      RETURN public.issue_4490_waitlist_projection(v_existing.id) || jsonb_build_object('replayed', true);
    END IF;
    RAISE EXCEPTION 'waitlist_already_joined' USING ERRCODE = 'PT409';
  END IF;
  INSERT INTO public.venue_waitlist (
    brand_id, venue_id, place_pool_id, guest_name, guest_phone_e164, guest_phone_country_iso, guest_email,
    party_size, status, notify_via, consumer_user_id, source, desired_date, desired_from, desired_to, manage_token_hash,
    created_at
  ) VALUES (
    v_venue.brand_id, p_venue_id, v_venue.place_pool_id, v_name, v_phone, v_iso, v_email,
    p_party_size, 'waiting', CASE WHEN v_phone IS NOT NULL THEN 'sms' ELSE 'none' END, p_user_id,
    'guest', p_desired_date, p_desired_from, p_desired_to, p_token_hash,
    pg_catalog.clock_timestamp()
  ) RETURNING id INTO v_id;
  PERFORM public.issue_4490_enqueue_waitlist_message(v_id, 'venue_waitlist_joined');
  RETURN public.issue_4490_waitlist_projection(v_id) || jsonb_build_object('replayed', false);
END;
$function$;

-- The booking-access rule for a waitlist entry: its token, or its own
-- signed-in guest.
CREATE OR REPLACE FUNCTION public.issue_4490_waitlist_actor_ok(
  p_entry public.venue_waitlist,
  p_token_hash bytea,
  p_user_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $function$
  SELECT p_entry.source = 'guest' AND (
    (p_token_hash IS NOT NULL AND p_entry.manage_token_hash IS NOT NULL AND p_entry.manage_token_hash = p_token_hash)
    OR (p_user_id IS NOT NULL AND p_entry.consumer_user_id IS NOT DISTINCT FROM p_user_id AND p_entry.consumer_user_id IS NOT NULL));
$function$;

CREATE OR REPLACE FUNCTION public.pg_get_venue_waitlist_entry(
  p_waitlist_id uuid,
  p_token_hash bytea,
  p_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_entry public.venue_waitlist%ROWTYPE;
BEGIN
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_entry FROM public.venue_waitlist WHERE id = p_waitlist_id;
  IF NOT FOUND OR NOT COALESCE(public.issue_4490_waitlist_actor_ok(v_entry, p_token_hash, p_user_id), false) THEN
    RAISE EXCEPTION 'waitlist_not_found' USING ERRCODE = 'P0002';
  END IF;
  RETURN public.issue_4490_waitlist_projection(v_entry.id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.pg_leave_venue_waitlist(
  p_waitlist_id uuid,
  p_token_hash bytea,
  p_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_entry public.venue_waitlist%ROWTYPE;
BEGIN
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_entry FROM public.venue_waitlist WHERE id = p_waitlist_id FOR UPDATE;
  IF NOT FOUND OR NOT COALESCE(public.issue_4490_waitlist_actor_ok(v_entry, p_token_hash, p_user_id), false) THEN
    RAISE EXCEPTION 'waitlist_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_entry.status IN ('waiting', 'notified') THEN
    UPDATE public.venue_waitlist SET status = 'lost', left_by_guest_at = now(), updated_at = now()
    WHERE id = v_entry.id;
  END IF;
  RETURN public.issue_4490_waitlist_projection(v_entry.id);
END;
$function$;

-- Messages to a waitlist guest (email; words in the payload, no private
-- link: the page link is the public venue page).
CREATE OR REPLACE FUNCTION public.issue_4490_enqueue_waitlist_message(p_waitlist_id uuid, p_category text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_entry public.venue_waitlist%ROWTYPE;
  v_venue record;
BEGIN
  SELECT * INTO v_entry FROM public.venue_waitlist WHERE id = p_waitlist_id;
  IF NOT FOUND OR v_entry.source <> 'guest' OR (v_entry.guest_email IS NULL AND v_entry.consumer_user_id IS NULL) THEN
    RETURN;
  END IF;
  SELECT v.name, v.slug, b.slug AS brand_slug, public.issue_4490_venue_timezone(v.id) AS tz INTO v_venue
  FROM public.venue_listings v JOIN public.brands b ON b.id = v.brand_id WHERE v.id = v_entry.venue_id;
  INSERT INTO public.notification_outbox (
    category_key, user_id, contact, brand_id, payload, idempotency_key, country_code
  ) VALUES (
    p_category, v_entry.consumer_user_id, lower(v_entry.guest_email), v_entry.brand_id,
    jsonb_strip_nulls(jsonb_build_object(
      'waitlist_id', v_entry.id, 'venue_id', v_entry.venue_id, 'venue_name', v_venue.name,
      'brand_slug', v_venue.brand_slug, 'venue_slug', v_venue.slug,
      'party_size', v_entry.party_size, 'desired_date', v_entry.desired_date,
      'desired_from', to_char(v_entry.desired_from, 'HH24:MI'), 'desired_to', to_char(v_entry.desired_to, 'HH24:MI'),
      'slot_label', CASE WHEN v_entry.offered_slot_at IS NOT NULL
                         THEN to_char(v_entry.offered_slot_at AT TIME ZONE v_venue.tz, 'HH24:MI') END,
      'position', public.issue_4490_waitlist_position(v_entry.id))),
    'venue-waitlist:' || v_entry.id || ':' || p_category || ':' || COALESCE(floor(extract(epoch FROM v_entry.notified_at))::text, '0'),
    NULL
  ) ON CONFLICT (idempotency_key) DO NOTHING;
END;
$function$;

-- A guest entry moved to "notified": the staff offered the table (or the
-- table-opened trigger did; it names the time it found).
CREATE OR REPLACE FUNCTION public.issue_4490_on_waitlist_notified()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF NEW.source = 'guest' AND NEW.status = 'notified' AND OLD.status = 'waiting' THEN
    PERFORM public.issue_4490_enqueue_waitlist_message(NEW.id,
      CASE WHEN NEW.offered_slot_at IS NOT NULL THEN 'venue_table_opened' ELSE 'venue_waitlist_ready' END);
  END IF;
  RETURN NULL;
END;
$function$;
CREATE TRIGGER issue_4490_waitlist_notified
  AFTER UPDATE OF status ON public.venue_waitlist
  FOR EACH ROW EXECUTE FUNCTION public.issue_4490_on_waitlist_notified();

-- A reservation cancelled (or a no-show): tell the oldest waiting guest of
-- that day whose party now has a free time in their range. One per opening.
CREATE OR REPLACE FUNCTION public.issue_4490_on_table_opened()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_tz text;
  v_day date;
  v_entry record;
  v_slot timestamptz;
BEGIN
  IF NOT (OLD.status IN ('requested', 'confirmed', 'seated')
          AND NEW.status IN ('cancelled_by_guest', 'cancelled_by_venue', 'no_show')) THEN
    RETURN NULL;
  END IF;
  v_tz := COALESCE(NULLIF(btrim(COALESCE((SELECT c.iana_timezone FROM public.venue_availability_config c
                                          WHERE c.venue_id = NEW.venue_id), '')), ''), 'UTC');
  v_day := (NEW.reserved_for AT TIME ZONE v_tz)::date;
  FOR v_entry IN
    SELECT w.* FROM public.venue_waitlist w
    WHERE w.venue_id = NEW.venue_id AND w.source = 'guest' AND w.status = 'waiting' AND w.desired_date = v_day
    ORDER BY w.created_at, w.id
    FOR UPDATE SKIP LOCKED
  LOOP
    SELECT s.slot_start_utc INTO v_slot
    FROM public.pg_venue_available_slots(v_day, v_entry.party_size, NEW.venue_id) s
    WHERE NOT s.is_full
      AND (v_entry.desired_from IS NULL
           OR ((s.slot_start_utc AT TIME ZONE v_tz)::time >= v_entry.desired_from
               AND (s.slot_start_utc AT TIME ZONE v_tz)::time <= v_entry.desired_to))
    ORDER BY abs(extract(epoch FROM (s.slot_start_utc - NEW.reserved_for))), s.slot_start_utc
    LIMIT 1;
    IF v_slot IS NOT NULL THEN
      UPDATE public.venue_waitlist
      SET status = 'notified', notified_at = now(), offered_slot_at = v_slot,
          expires_at = now() + interval '30 minutes', updated_at = now()
      WHERE id = v_entry.id;
      EXIT;
    END IF;
  END LOOP;
  RETURN NULL;
END;
$function$;
CREATE TRIGGER issue_4490_reservation_table_opened
  AFTER UPDATE OF status ON public.reservations
  FOR EACH ROW EXECUTE FUNCTION public.issue_4490_on_table_opened();

INSERT INTO public.notification_categories (key, section, is_transactional, urgency, default_channels)
VALUES
  ('venue_waitlist_joined', 'Venue bookings', true, 'normal', ARRAY['inapp', 'email']),
  ('venue_table_opened', 'Venue bookings', true, 'high', ARRAY['inapp', 'push', 'email']),
  ('venue_waitlist_ready', 'Venue bookings', true, 'high', ARRAY['inapp', 'push', 'email'])
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 12. Flexible bookings (by the hour, and later "Hours you set" hires).
--     A flexible rule's day windows are the opening hours; a booking picks a
--     start (on the offer's step) and a length (shortest..longest, in steps)
--     inside them and gets a window of its own (booked_block). Places are
--     claimed with the P4 space claims, so the exclusion constraint refuses
--     two bookings of one unit at overlapping times (buffers included).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_4490_window_is_flexible(p_window_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.stay_place_windows w
    JOIN public.stay_place_schedule_rules r ON r.id = w.schedule_rule_id
    WHERE w.id = p_window_id AND r.mode = 'flexible' AND NOT w.booked_block);
$function$;

-- The places a flexible booking may take: by the hour = each unit (any one
-- of) or all its spaces together; private hire = each price row's place.
CREATE OR REPLACE FUNCTION public.issue_4490_flex_places(
  p_offering_id uuid,
  p_guests integer DEFAULT NULL,
  p_price_option_id uuid DEFAULT NULL
)
RETURNS TABLE (place_key text, space_ids uuid[], name text, price_option_id uuid, capacity integer, sort_key integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_offer public.stay_offerings%ROWTYPE;
  v_option public.venue_offer_price_options%ROWTYPE;
BEGIN
  SELECT * INTO v_offer FROM public.stay_offerings WHERE id = p_offering_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  IF v_offer.kind = 'by_the_hour' THEN
    SELECT * INTO v_option FROM public.venue_offer_price_options o
    WHERE o.offering_id = v_offer.id AND o.status = 'active'
      AND (p_price_option_id IS NULL OR o.id = p_price_option_id)
    ORDER BY o.sort_order, o.created_at LIMIT 1;
    IF NOT FOUND OR (p_guests IS NOT NULL AND p_guests NOT BETWEEN v_option.guest_min AND v_option.guest_max) THEN
      RETURN;
    END IF;
    IF v_offer.space_allocation = 'any_one' THEN
      RETURN QUERY
      SELECT s.id::text, ARRAY[s.id], s.name, v_option.id, public.issue_4490_space_capacity(s.id),
             (row_number() OVER (ORDER BY s.sort_order, s.name))::integer
      FROM public.venue_offer_spaces os JOIN public.venue_spaces s ON s.id = os.space_id
      WHERE os.offering_id = v_offer.id AND s.is_active AND s.archived_at IS NULL;
    ELSE
      RETURN QUERY
      SELECT 'all'::text, array_agg(s.id ORDER BY s.id), v_offer.name, v_option.id,
             COALESCE(sum(public.issue_4490_space_capacity(s.id)), 0)::integer, 1
      FROM public.venue_offer_spaces os JOIN public.venue_spaces s ON s.id = os.space_id
      WHERE os.offering_id = v_offer.id AND s.is_active AND s.archived_at IS NULL
      HAVING count(*) > 0;
    END IF;
  ELSIF v_offer.kind = 'private_hire' THEN
    RETURN QUERY
    SELECT o.id::text, public.issue_4490_option_spaces(o.id), public.issue_4490_option_place_name(o.id), o.id,
           public.issue_4490_option_capacity(o.id), (row_number() OVER (ORDER BY o.sort_order, o.created_at))::integer
    FROM public.venue_offer_price_options o
    WHERE o.offering_id = v_offer.id AND o.status = 'active'
      AND public.issue_4490_option_spaces(o.id) IS NOT NULL
      AND (p_price_option_id IS NULL OR o.id = p_price_option_id)
      AND (p_guests IS NULL OR (p_guests >= o.guest_min AND p_guests <= CASE
             WHEN v_offer.extra_guest_minor IS NOT NULL THEN public.issue_4490_option_capacity(o.id) ELSE o.guest_max END));
  END IF;
END;
$function$;

-- Every start time of one flexible day window with the longest booking that
-- fits from it on each free place (buffers included), never before the
-- notice period, never past closing, in the offer's steps.
CREATE OR REPLACE FUNCTION public.issue_4490_flex_starts(
  p_offering_id uuid,
  p_window_id uuid,
  p_guests integer DEFAULT NULL,
  p_price_option_id uuid DEFAULT NULL,
  p_exclude_group uuid DEFAULT NULL
)
RETURNS TABLE (starts_at timestamptz, place_key text, space_ids uuid[], price_option_id uuid, max_minutes integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_offer public.stay_offerings%ROWTYPE;
  v_window public.stay_place_windows%ROWTYPE;
  v_step integer;
  v_min integer;
  v_max integer;
  v_span integer;
  v_earliest timestamptz;
BEGIN
  SELECT * INTO v_offer FROM public.stay_offerings WHERE id = p_offering_id;
  SELECT * INTO v_window FROM public.stay_place_windows WHERE id = p_window_id AND offering_id = p_offering_id;
  IF v_offer.id IS NULL OR v_window.id IS NULL THEN
    RETURN;
  END IF;
  v_step := COALESCE(v_offer.booking_length_step_minutes, 60);
  v_min := GREATEST(COALESCE(v_offer.booking_length_min_minutes, v_step), v_step);
  v_span := (extract(epoch FROM (v_window.ends_at - v_window.starts_at)) / 60)::integer;
  v_max := LEAST(COALESCE(v_offer.booking_length_max_minutes, v_span), v_span);
  IF v_min > v_max THEN
    RETURN;
  END IF;
  v_earliest := now() + make_interval(mins => v_offer.min_notice_minutes);
  RETURN QUERY
  WITH places AS (
    SELECT p.* FROM public.issue_4490_flex_places(p_offering_id, p_guests, p_price_option_id) p
    WHERE p.price_option_id IS NULL
       OR public.issue_4490_option_window_reason(p.price_option_id, v_window.id) IS NULL
  ),
  starts AS (
    SELECT v_window.starts_at + make_interval(mins => k * v_step) AS s
    FROM generate_series(0, (v_span - v_min) / v_step) k
  ),
  busy AS (
    SELECT p.place_key AS pk, c.claim_range
    FROM places p
    JOIN public.venue_space_claims c ON c.space_id = ANY(p.space_ids)
    WHERE (c.state = 'committed' OR (c.state = 'held' AND c.held_until > now()))
      AND (p_exclude_group IS NULL OR c.group_id IS DISTINCT FROM p_exclude_group)
      AND c.claim_range && tstzrange(v_window.starts_at - interval '2 days', v_window.ends_at + interval '2 days', '[)')
  ),
  fits AS (
    SELECT st.s, p.place_key AS pk, p.space_ids AS sids, p.price_option_id AS opt, p.sort_key,
      (LEAST(
         v_max,
         (extract(epoch FROM (v_window.ends_at - st.s)) / 60)::integer,
         COALESCE((SELECT (extract(epoch FROM (min(lower(b.claim_range)) - st.s)) / 60)::integer - v_offer.buffer_after_minutes
                   FROM busy b WHERE b.pk = p.place_key
                     AND lower(b.claim_range) >= st.s - make_interval(mins => v_offer.buffer_before_minutes)), v_max)
       ) / v_step) * v_step AS longest
    FROM starts st CROSS JOIN places p
    WHERE st.s >= v_earliest
      AND NOT EXISTS (
        SELECT 1 FROM busy b WHERE b.pk = p.place_key
          AND b.claim_range && tstzrange(st.s - make_interval(mins => v_offer.buffer_before_minutes),
                                         st.s + make_interval(mins => v_min + v_offer.buffer_after_minutes), '[)'))
  )
  SELECT f.s, f.pk, f.sids, f.opt, f.longest
  FROM fits f
  WHERE f.longest >= v_min
  ORDER BY f.s, f.sort_key;
END;
$function$;

-- The guest's day line for one flexible offer (anon): opening hours, steps,
-- shortest / longest, the hour price, every place's busy ranges (setup and
-- cleanup included) and every start with the longest free booking from it.
CREATE OR REPLACE FUNCTION public.pg_venue_hour_day(
  p_offering_id uuid,
  p_date date,
  p_guests integer DEFAULT NULL,
  p_price_option_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_offer public.stay_offerings%ROWTYPE;
  v_settings public.venue_booking_settings%ROWTYPE;
  v_window public.stay_place_windows%ROWTYPE;
  v_status text := 'open';
  v_last date;
BEGIN
  IF p_offering_id IS NULL OR p_date IS NULL OR (p_guests IS NOT NULL AND p_guests NOT BETWEEN 1 AND 100000) THEN
    RAISE EXCEPTION 'availability_range_invalid' USING ERRCODE = '22023';
  END IF;
  IF NOT public.issue_4490_flag_on('VENUE_OFFERS_READS') THEN
    RETURN NULL;
  END IF;
  SELECT o.* INTO v_offer
  FROM public.stay_offerings o
  JOIN public.venue_listings v ON v.id = o.venue_id AND v.claim_status = 'verified'
  JOIN public.brands b ON b.id = v.brand_id AND b.deleted_at IS NULL
  WHERE o.id = p_offering_id AND o.kind IN ('by_the_hour', 'private_hire') AND o.status = 'live';
  IF NOT FOUND OR NOT public.issue_4490_venue_feature_on(v_offer.venue_id, public.issue_4490_offer_kind_feature(v_offer.kind)) THEN
    RETURN NULL;
  END IF;
  SELECT * INTO v_settings FROM public.venue_booking_settings WHERE venue_id = v_offer.venue_id;
  SELECT w.* INTO v_window FROM public.stay_place_windows w
  JOIN public.stay_place_schedule_rules r ON r.id = w.schedule_rule_id AND r.active AND r.mode = 'flexible'
  WHERE w.offering_id = v_offer.id AND w.local_date = p_date AND NOT w.booked_block AND NOT w.stop_sell
  ORDER BY w.starts_at LIMIT 1;
  v_last := (now() AT TIME ZONE COALESCE(v_settings.timezone, 'UTC'))::date
    + LEAST(COALESCE(v_settings.booking_horizon_days, 365), COALESCE(v_offer.max_advance_days, 730));
  IF v_window.id IS NULL THEN
    v_status := 'closed';
  ELSIF COALESCE(v_settings.booking_state, 'active') <> 'active' THEN
    v_status := 'paused';
  ELSIF public.issue_4490_day_closed(v_offer.venue_id, p_date) THEN
    v_status := 'closed';
  ELSIF p_date > v_last THEN
    v_status := 'too_far';
  END IF;
  RETURN jsonb_build_object(
    'offeringId', v_offer.id,
    'kind', v_offer.kind,
    'localDate', p_date,
    'status', v_status,
    'timezone', COALESCE(v_settings.timezone, 'UTC'),
    'windowId', v_window.id,
    'opensAt', v_window.starts_at,
    'closesAt', v_window.ends_at,
    'stepMinutes', COALESCE(v_offer.booking_length_step_minutes, 60),
    'minMinutes', GREATEST(COALESCE(v_offer.booking_length_min_minutes, 60), COALESCE(v_offer.booking_length_step_minutes, 60)),
    'maxMinutes', v_offer.booking_length_max_minutes,
    'setupMinutes', v_offer.buffer_before_minutes,
    'cleanupMinutes', v_offer.buffer_after_minutes,
    'priceMinor', CASE WHEN v_window.id IS NULL THEN NULL ELSE (
      SELECT min(public.issue_4490_option_price_at(o.id, v_window.id)) FROM public.venue_offer_price_options o
      WHERE o.offering_id = v_offer.id AND o.status = 'active'
        AND (p_price_option_id IS NULL OR o.id = p_price_option_id)) END,
    'places', CASE WHEN v_window.id IS NULL OR v_status <> 'open' THEN '[]'::jsonb ELSE COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'key', p.place_key, 'name', p.name, 'spaceIds', to_jsonb(p.space_ids), 'priceOptionId', p.price_option_id,
        'busy', COALESCE((SELECT jsonb_agg(jsonb_build_object('from', lower(r.rng), 'to', upper(r.rng)) ORDER BY lower(r.rng))
                          FROM (SELECT DISTINCT c.claim_range AS rng FROM public.venue_space_claims c
                                WHERE c.space_id = ANY(p.space_ids)
                                  AND (c.state = 'committed' OR (c.state = 'held' AND c.held_until > now()))
                                  AND c.claim_range && tstzrange(v_window.starts_at, v_window.ends_at, '[)')) r), '[]'::jsonb))
        ORDER BY p.sort_key)
      FROM public.issue_4490_flex_places(v_offer.id, p_guests, p_price_option_id) p), '[]'::jsonb) END,
    'starts', CASE WHEN v_window.id IS NULL OR v_status <> 'open' THEN '[]'::jsonb ELSE COALESCE((
      SELECT jsonb_agg(jsonb_build_object('startsAt', x.starts_at, 'maxMinutes', x.longest, 'places', x.places)
                       ORDER BY x.starts_at)
      FROM (SELECT f.starts_at, max(f.max_minutes) AS longest, count(*) AS places
            FROM public.issue_4490_flex_starts(v_offer.id, v_window.id, p_guests, p_price_option_id) f
            GROUP BY f.starts_at) x), '[]'::jsonb) END
  );
END;
$function$;

-- The booking window for a start and length (service role; the edge calls
-- it before quoting a flexible offer). Refuses a time outside opening hours,
-- off the step, or a length outside shortest..longest.
CREATE OR REPLACE FUNCTION public.issue_4490_flexible_window(
  p_offering_id uuid,
  p_starts_at timestamptz,
  p_minutes integer
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_offer public.stay_offerings%ROWTYPE;
  v_day public.stay_place_windows%ROWTYPE;
  v_step integer;
  v_min integer;
  v_max integer;
  v_id uuid;
BEGIN
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_offering_id IS NULL OR p_starts_at IS NULL OR p_minutes IS NULL THEN
    RAISE EXCEPTION 'offer_invalid_payload' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_offer FROM public.stay_offerings
  WHERE id = p_offering_id AND kind IN ('by_the_hour', 'private_hire') AND status = 'live';
  IF NOT FOUND OR NOT public.issue_4490_venue_feature_on(v_offer.venue_id, public.issue_4490_offer_kind_feature(v_offer.kind)) THEN
    RAISE EXCEPTION 'offer_not_found' USING ERRCODE = 'P0002';
  END IF;
  v_step := COALESCE(v_offer.booking_length_step_minutes, 60);
  v_min := GREATEST(COALESCE(v_offer.booking_length_min_minutes, v_step), v_step);
  v_max := COALESCE(v_offer.booking_length_max_minutes, 1440);
  IF p_minutes < v_min OR p_minutes > v_max OR p_minutes % v_step <> 0 THEN
    RAISE EXCEPTION 'offer_length_invalid' USING ERRCODE = '22023',
      DETAIL = jsonb_build_object('minMinutes', v_min, 'maxMinutes', v_max, 'stepMinutes', v_step)::text;
  END IF;
  SELECT w.* INTO v_day FROM public.stay_place_windows w
  JOIN public.stay_place_schedule_rules r ON r.id = w.schedule_rule_id AND r.active AND r.mode = 'flexible'
  WHERE w.offering_id = v_offer.id AND NOT w.booked_block AND NOT w.stop_sell
    AND p_starts_at >= w.starts_at AND p_starts_at + make_interval(mins => p_minutes) <= w.ends_at
  ORDER BY w.starts_at LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'offer_window_unavailable' USING ERRCODE = 'P0002';
  END IF;
  IF ((extract(epoch FROM (p_starts_at - v_day.starts_at)) / 60)::integer) % v_step <> 0
     OR extract(second FROM p_starts_at) <> 0 THEN
    RAISE EXCEPTION 'offer_wrong_time' USING ERRCODE = 'PT409';
  END IF;
  INSERT INTO public.stay_place_windows (
    offering_id, schedule_rule_id, brand_id, venue_id, local_date, starts_at, ends_at,
    sellable_units, sellable_capacity, dst_resolution, booked_block
  ) VALUES (
    v_offer.id, v_day.schedule_rule_id, v_offer.brand_id, v_offer.venue_id, v_day.local_date,
    p_starts_at, p_starts_at + make_interval(mins => p_minutes),
    v_day.sellable_units, v_day.sellable_capacity, 'unambiguous', true
  ) ON CONFLICT (offering_id, starts_at, ends_at) DO NOTHING;
  SELECT id INTO v_id FROM public.stay_place_windows
  WHERE offering_id = v_offer.id AND starts_at = p_starts_at AND ends_at = p_starts_at + make_interval(mins => p_minutes);
  RETURN v_id;
END;
$function$;

-- One day of a flexible offer for the date strip: available when some start
-- has a free place for the shortest booking.
CREATE OR REPLACE FUNCTION public.issue_4490_flex_day_summary(
  p_offering_id uuid,
  p_window_id uuid,
  p_guests integer,
  p_price_option_id uuid
)
RETURNS TABLE (status text, reason text, free_starts integer, price_minor bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_places integer;
BEGIN
  SELECT count(*) INTO v_places FROM public.issue_4490_flex_places(p_offering_id, p_guests, p_price_option_id);
  SELECT count(DISTINCT f.starts_at)::integer INTO free_starts
  FROM public.issue_4490_flex_starts(p_offering_id, p_window_id, p_guests, p_price_option_id) f;
  SELECT min(public.issue_4490_option_price_at(o.id, p_window_id)) INTO price_minor
  FROM public.venue_offer_price_options o
  WHERE o.offering_id = p_offering_id AND o.status = 'active'
    AND (p_price_option_id IS NULL OR o.id = p_price_option_id);
  IF v_places = 0 THEN
    status := 'closed'; reason := 'no_space_fits';
  ELSIF free_starts > 0 THEN
    status := 'available'; reason := NULL;
  ELSIF now() >= (SELECT w.ends_at FROM public.stay_place_windows w WHERE w.id = p_window_id)
                  - make_interval(mins => GREATEST(COALESCE((SELECT o.booking_length_min_minutes FROM public.stay_offerings o
                                                             WHERE o.id = p_offering_id), 60), 15)) THEN
    status := 'too_soon'; reason := NULL;
  ELSE
    status := 'taken'; reason := NULL;
  END IF;
  RETURN NEXT;
END;
$function$;

-- Claim a by-the-hour place for one booking line: the chosen unit, or (for
-- "any one of") the next free unit when someone took it first.
CREATE OR REPLACE FUNCTION public.issue_4490_claim_hour_unit(
  p_group_id uuid,
  p_line_id uuid,
  p_hold_id uuid,
  p_offering_id uuid,
  p_preferred uuid[],
  p_booked tstzrange,
  p_claim tstzrange,
  p_held_until timestamptz
)
RETURNS uuid[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_offer public.stay_offerings%ROWTYPE;
  v_unit record;
BEGIN
  SELECT * INTO v_offer FROM public.stay_offerings WHERE id = p_offering_id;
  IF v_offer.space_allocation <> 'any_one' THEN
    PERFORM public.issue_4490_claim_spaces(p_group_id, p_line_id, p_hold_id, p_preferred, NULL,
      p_booked, p_claim, p_held_until);
    RETURN p_preferred;
  END IF;
  FOR v_unit IN
    SELECT s.id, (ARRAY[s.id] = p_preferred) AS preferred, s.sort_order, s.name
    FROM public.venue_offer_spaces os JOIN public.venue_spaces s ON s.id = os.space_id
    WHERE os.offering_id = p_offering_id AND s.is_active AND s.archived_at IS NULL
    ORDER BY (ARRAY[s.id] = p_preferred) DESC, s.sort_order, s.name
  LOOP
    BEGIN
      PERFORM public.issue_4490_claim_spaces(p_group_id, p_line_id, p_hold_id, ARRAY[v_unit.id], NULL,
        p_booked, p_claim, p_held_until);
      RETURN ARRAY[v_unit.id];
    EXCEPTION WHEN SQLSTATE 'PT409' THEN
      NULL; -- that unit went to someone else; try the next one
    END;
  END LOOP;
  RAISE EXCEPTION 'offer_space_taken' USING ERRCODE = 'PT409';
END;
$function$;

-- ---------------------------------------------------------------------------
-- 13. By the hour authoring (Host). issue_4490_manage_offer keeps
--     create_draft (kind by_the_hour), name, the per-hour price
--     (upsert_price_option unit 'hour', busy-time price rules), refund ladder,
--     publish / pause / archive. This adds:
--       set_place   one space or several booked together ('all'), or any one
--                   of n units: existing spaces, or n new units auto-named
--                   "<name> 1..n"
--       set_hours   opening hours a booking sits in (a flexible rule)
--       set_length  shortest / longest booking and the step ("starts every")
--       set_rules   setup / cleanup buffers, release a no-show after N
--                   minutes, staff can start a session at the venue
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_4490_manage_hour(
  p_action text,
  p_venue_id uuid,
  p_payload jsonb,
  p_expected_version bigint,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_venue public.venue_listings%ROWTYPE;
  v_settings public.venue_booking_settings%ROWTYPE;
  v_offer public.stay_offerings%ROWTYPE;
  v_hash text;
  v_replay jsonb;
  v_result jsonb;
  v_spaces uuid[];
  v_allocation text;
  v_count integer;
  v_name text;
  v_seats integer;
  v_setting text;
  v_i integer;
  v_space uuid;
  v_weekdays smallint[];
  v_start time;
  v_end time;
  v_min integer;
  v_max integer;
  v_step integer;
  v_windows integer := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF p_action NOT IN ('set_place', 'set_hours', 'set_length', 'set_rules')
     OR p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'invalid_payload' USING ERRCODE = '22023';
  END IF;
  IF NOT public.issue_4490_flag_on('VENUE_OFFERS_WRITES') THEN
    RAISE EXCEPTION 'offers_not_enabled' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_venue FROM public.venue_listings WHERE id = p_venue_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'venue_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.issue_4490_can_manage_venue(p_venue_id, 'venue.manage_offers') THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  v_hash := encode(pg_catalog.sha256(convert_to(jsonb_build_object(
    'action', p_action, 'venue', p_venue_id, 'payload', p_payload, 'expected', p_expected_version)::text, 'UTF8')), 'hex');
  v_replay := public.issue_4490_receipt_lookup('manage_hour:' || p_venue_id::text, p_idempotency_key, v_hash);
  IF v_replay IS NOT NULL THEN
    RETURN v_replay;
  END IF;
  SELECT * INTO v_offer FROM public.stay_offerings
  WHERE id = NULLIF(p_payload->>'offerId', '')::uuid AND venue_id = p_venue_id
    AND kind NOT IN ('room', 'place')
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'offer_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF p_expected_version IS NULL OR v_offer.version <> p_expected_version THEN
    RAISE EXCEPTION 'stale_write' USING ERRCODE = 'PT409';
  END IF;
  IF v_offer.status = 'archived' THEN
    RAISE EXCEPTION 'offer_archived' USING ERRCODE = 'PT409';
  END IF;
  IF v_offer.kind <> 'by_the_hour' THEN
    RAISE EXCEPTION 'offer_kind_invalid' USING ERRCODE = '22023';
  END IF;
  v_settings := public.issue_4490_ensure_booking_settings(p_venue_id);

  IF p_action = 'set_place' THEN
    IF p_payload ? 'units' THEN
      -- n new units, auto-named "<name> 1..n" (any one of them is booked).
      IF jsonb_typeof(p_payload->'units') <> 'object'
         OR COALESCE(p_payload->'units'->>'count', '') !~ '^[0-9]{1,2}$'
         OR (p_payload->'units'->>'count')::integer NOT BETWEEN 1 AND 50
         OR char_length(btrim(COALESCE(p_payload->'units'->>'name', ''))) NOT BETWEEN 1 AND 60
         OR COALESCE(p_payload->'units'->>'seats', '') !~ '^[0-9]{1,5}$'
         OR (p_payload->'units'->>'seats')::integer NOT BETWEEN 1 AND 10000
         OR COALESCE(p_payload->'units'->>'setting', 'indoor') NOT IN ('indoor', 'covered', 'outdoor') THEN
        RAISE EXCEPTION 'hour_units_invalid' USING ERRCODE = '22023';
      END IF;
      v_count := (p_payload->'units'->>'count')::integer;
      v_name := btrim(p_payload->'units'->>'name');
      v_seats := (p_payload->'units'->>'seats')::integer;
      v_setting := COALESCE(p_payload->'units'->>'setting', 'indoor');
      v_spaces := '{}'::uuid[];
      FOR v_i IN 1..v_count LOOP
        SELECT s.id INTO v_space FROM public.venue_spaces s
        WHERE s.venue_id = p_venue_id AND s.archived_at IS NULL
          AND lower(btrim(s.name)) = lower(v_name || ' ' || v_i);
        IF v_space IS NULL THEN
          INSERT INTO public.venue_spaces (venue_id, brand_id, name, setting, capacity_seated, sort_order, can_be_hired)
          VALUES (p_venue_id, v_venue.brand_id, v_name || ' ' || v_i, v_setting, v_seats, 2000 + v_i, false)
          RETURNING id INTO v_space;
        END IF;
        v_spaces := v_spaces || v_space;
        v_space := NULL;
      END LOOP;
      v_allocation := CASE WHEN v_count = 1 THEN 'all' ELSE 'any_one' END;
    ELSE
      IF jsonb_typeof(p_payload->'spaceIds') <> 'array' OR jsonb_array_length(p_payload->'spaceIds') NOT BETWEEN 1 AND 50
         OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(p_payload->'spaceIds') x WHERE x !~ '^[0-9a-f-]{36}$')
         OR COALESCE(p_payload->>'allocation', 'all') NOT IN ('all', 'any_one') THEN
        RAISE EXCEPTION 'hour_spaces_invalid' USING ERRCODE = '22023';
      END IF;
      SELECT array_agg(DISTINCT x::uuid) INTO v_spaces FROM jsonb_array_elements_text(p_payload->'spaceIds') x;
      IF EXISTS (SELECT 1 FROM unnest(v_spaces) s WHERE NOT EXISTS (
           SELECT 1 FROM public.venue_spaces vs WHERE vs.id = s AND vs.venue_id = p_venue_id
             AND vs.is_active AND vs.archived_at IS NULL)) THEN
        RAISE EXCEPTION 'hour_spaces_invalid' USING ERRCODE = '22023';
      END IF;
      v_allocation := COALESCE(p_payload->>'allocation', 'all');
    END IF;
    -- A booked unit cannot leave the offer while it has bookings ahead.
    IF EXISTS (
      SELECT 1 FROM public.venue_space_claims c
      JOIN public.stay_reservation_groups g ON g.id = c.group_id
      JOIN public.stay_reservation_lines l ON l.id = c.reservation_line_id AND l.offering_id = v_offer.id
      WHERE c.state IN ('held', 'committed') AND upper(c.claim_range) > now() AND NOT c.space_id = ANY(v_spaces)
    ) THEN
      RAISE EXCEPTION 'hour_space_in_use' USING ERRCODE = 'PT409';
    END IF;
    DELETE FROM public.venue_offer_spaces WHERE offering_id = v_offer.id AND NOT space_id = ANY(v_spaces);
    INSERT INTO public.venue_offer_spaces (offering_id, space_id, venue_id, brand_id)
    SELECT v_offer.id, s, p_venue_id, v_venue.brand_id FROM unnest(v_spaces) s
    ON CONFLICT (offering_id, space_id) DO NOTHING;
    UPDATE public.stay_offerings
    SET space_allocation = v_allocation, version = version + 1, updated_at = now(), updated_by = v_uid
    WHERE id = v_offer.id RETURNING * INTO v_offer;

  ELSIF p_action = 'set_hours' THEN
    IF jsonb_typeof(p_payload->'weekdays') <> 'array' OR jsonb_array_length(p_payload->'weekdays') NOT BETWEEN 1 AND 7
       OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(p_payload->'weekdays') d WHERE d !~ '^[0-6]$') THEN
      RAISE EXCEPTION 'schedule_weekdays_invalid' USING ERRCODE = '22023';
    END IF;
    IF COALESCE(p_payload->>'startTime', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
       OR COALESCE(p_payload->>'endTime', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
       OR (p_payload->>'startTime') = (p_payload->>'endTime') THEN
      RAISE EXCEPTION 'schedule_times_invalid' USING ERRCODE = '22023';
    END IF;
    SELECT array_agg(DISTINCT d::smallint ORDER BY d::smallint) INTO v_weekdays
    FROM jsonb_array_elements_text(p_payload->'weekdays') d;
    v_start := (p_payload->>'startTime')::time;
    v_end := (p_payload->>'endTime')::time;
    UPDATE public.stay_place_schedule_rules SET active = false, version = version + 1, updated_at = now(), updated_by = v_uid
    WHERE offering_id = v_offer.id AND active;
    -- Opening-hours windows with no booking yet stop selling (bookings keep theirs).
    UPDATE public.stay_place_windows w SET stop_sell = true, version = w.version + 1, updated_at = now()
    WHERE w.offering_id = v_offer.id AND NOT w.booked_block AND NOT w.stop_sell;
    INSERT INTO public.stay_place_schedule_rules (
      offering_id, brand_id, venue_id, mode, timezone, local_start_date, local_end_date, weekdays,
      local_start_time, local_end_time, created_by, updated_by
    ) VALUES (
      v_offer.id, v_offer.brand_id, p_venue_id, 'flexible', v_settings.timezone,
      COALESCE(NULLIF(p_payload->>'startDate', '')::date, (now() AT TIME ZONE v_settings.timezone)::date),
      NULLIF(p_payload->>'endDate', '')::date, v_weekdays, v_start, v_end, v_uid, v_uid
    );
    UPDATE public.stay_offerings SET version = version + 1, updated_at = now(), updated_by = v_uid
    WHERE id = v_offer.id RETURNING * INTO v_offer;
    v_windows := public.issue_4490_materialize_offer_windows(v_offer.id);
    -- A day window that already existed (same hours) sells again.
    UPDATE public.stay_place_windows w SET stop_sell = false, version = w.version + 1, updated_at = now()
    FROM public.stay_place_schedule_rules r
    WHERE w.offering_id = v_offer.id AND NOT w.booked_block AND w.stop_sell
      AND r.offering_id = v_offer.id AND r.active AND r.mode = 'flexible'
      AND (extract(isodow FROM w.local_date)::integer - 1) = ANY(r.weekdays)
      AND w.starts_at = (w.local_date + r.local_start_time) AT TIME ZONE r.timezone;

  ELSIF p_action = 'set_length' THEN
    IF COALESCE(p_payload->>'stepMinutes', '') NOT IN ('15', '30', '60')
       OR COALESCE(p_payload->>'minMinutes', '') !~ '^[0-9]{1,4}$'
       OR (p_payload ? 'maxMinutes' AND p_payload->'maxMinutes' <> 'null'::jsonb
           AND COALESCE(p_payload->>'maxMinutes', '') !~ '^[0-9]{1,4}$') THEN
      RAISE EXCEPTION 'hour_length_invalid' USING ERRCODE = '22023';
    END IF;
    v_step := (p_payload->>'stepMinutes')::integer;
    v_min := (p_payload->>'minMinutes')::integer;
    v_max := NULLIF(p_payload->>'maxMinutes', '')::integer;
    IF v_min < 15 OR v_min > 1440 OR v_min % v_step <> 0
       OR (v_max IS NOT NULL AND (v_max < v_min OR v_max > 1440 OR v_max % v_step <> 0)) THEN
      RAISE EXCEPTION 'hour_length_invalid' USING ERRCODE = '22023';
    END IF;
    UPDATE public.stay_offerings
    SET booking_length_step_minutes = v_step, booking_length_min_minutes = v_min, booking_length_max_minutes = v_max,
        version = version + 1, updated_at = now(), updated_by = v_uid
    WHERE id = v_offer.id RETURNING * INTO v_offer;

  ELSE -- set_rules
    IF COALESCE(p_payload->>'bufferBeforeMinutes', '0') !~ '^[0-9]{1,3}$'
       OR COALESCE(p_payload->>'bufferAfterMinutes', '0') !~ '^[0-9]{1,3}$'
       OR COALESCE(p_payload->>'bufferBeforeMinutes', '0')::integer > 240
       OR COALESCE(p_payload->>'bufferAfterMinutes', '0')::integer > 240
       OR (p_payload ? 'noShowReleaseMinutes' AND p_payload->'noShowReleaseMinutes' <> 'null'::jsonb
           AND (COALESCE(p_payload->>'noShowReleaseMinutes', '') !~ '^[0-9]{1,3}$'
                OR (p_payload->>'noShowReleaseMinutes')::integer NOT BETWEEN 5 AND 240))
       OR (p_payload ? 'staffCanStart' AND jsonb_typeof(p_payload->'staffCanStart') <> 'boolean') THEN
      RAISE EXCEPTION 'hour_rules_invalid' USING ERRCODE = '22023';
    END IF;
    UPDATE public.stay_offerings
    SET buffer_before_minutes = COALESCE((p_payload->>'bufferBeforeMinutes')::integer, buffer_before_minutes),
        buffer_after_minutes = COALESCE((p_payload->>'bufferAfterMinutes')::integer, buffer_after_minutes),
        no_show_release_minutes = CASE WHEN p_payload ? 'noShowReleaseMinutes'
                                       THEN NULLIF(p_payload->>'noShowReleaseMinutes', '')::smallint
                                       ELSE no_show_release_minutes END,
        staff_can_start = COALESCE((p_payload->>'staffCanStart')::boolean, staff_can_start),
        version = version + 1, updated_at = now(), updated_by = v_uid
    WHERE id = v_offer.id RETURNING * INTO v_offer;
  END IF;

  v_result := public.issue_4490_offer_projection(v_offer.id) || jsonb_build_object('windowsCreated', v_windows);
  PERFORM public.issue_4490_receipt_store('manage_hour:' || p_venue_id::text, p_idempotency_key, v_hash, v_result);
  RETURN v_result || jsonb_build_object('replayed', false);
END;
$function$;

-- The by-the-hour part of an offer read (Host and guest). NULL otherwise.
CREATE OR REPLACE FUNCTION public.issue_4490_hour_projection(p_offering_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT CASE WHEN o.kind <> 'by_the_hour' THEN NULL ELSE jsonb_build_object(
    'allocation', o.space_allocation,
    'places', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'setting', s.setting,
        'capacity', public.issue_4490_space_capacity(s.id)) ORDER BY s.sort_order, s.name)
      FROM public.venue_offer_spaces os JOIN public.venue_spaces s ON s.id = os.space_id
      WHERE os.offering_id = o.id), '[]'::jsonb),
    'hours', (SELECT jsonb_build_object('ruleId', r.id, 'weekdays', to_jsonb(r.weekdays),
                'startTime', to_char(r.local_start_time, 'HH24:MI'), 'endTime', to_char(r.local_end_time, 'HH24:MI'),
                'pastMidnight', r.local_end_time <= r.local_start_time,
                'startDate', r.local_start_date, 'endDate', r.local_end_date)
              FROM public.stay_place_schedule_rules r
              WHERE r.offering_id = o.id AND r.active AND r.mode = 'flexible'
              ORDER BY r.created_at DESC LIMIT 1),
    'stepMinutes', COALESCE(o.booking_length_step_minutes, 60),
    'minMinutes', o.booking_length_min_minutes,
    'maxMinutes', o.booking_length_max_minutes,
    'pricePerHourMinor', (SELECT p.amount_minor FROM public.venue_offer_price_options opt
                          JOIN public.stay_price_versions p ON p.price_option_id = opt.id AND p.effective_to IS NULL
                          WHERE opt.offering_id = o.id AND opt.status = 'active'
                          ORDER BY opt.sort_order, opt.created_at LIMIT 1),
    'setupMinutes', o.buffer_before_minutes,
    'cleanupMinutes', o.buffer_after_minutes,
    'noShowReleaseMinutes', o.no_show_release_minutes,
    'staffCanStart', o.staff_can_start
  ) END
  FROM public.stay_offerings o WHERE o.id = p_offering_id;
$function$;

-- The by-the-hour facts of a booking (guest and staff reads). The place is
-- the unit actually claimed. NULL for other kinds.
CREATE OR REPLACE FUNCTION public.issue_4490_hour_booking_facts(p_group_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT CASE WHEN g.offer_kind <> 'by_the_hour' THEN NULL ELSE jsonb_strip_nulls(jsonb_build_object(
    'placeName', COALESCE((SELECT string_agg(s.name, ' + ' ORDER BY s.sort_order, s.name)
                           FROM public.venue_spaces s
                           WHERE s.id IN (SELECT c.space_id FROM public.venue_space_claims c
                                          WHERE c.group_id = g.id
                                          ORDER BY (c.state <> 'released') DESC, c.created_at DESC)),
                          l.price_snapshot->>'placeName'),
    'spaceIds', COALESCE((SELECT jsonb_agg(DISTINCT c.space_id) FROM public.venue_space_claims c
                          WHERE c.group_id = g.id AND c.state <> 'released'), l.price_snapshot->'spaceIds'),
    'bookedFrom', w.starts_at,
    'bookedTo', w.ends_at,
    'minutes', (extract(epoch FROM (w.ends_at - w.starts_at)) / 60)::integer,
    'setupFrom', w.starts_at - make_interval(mins => o.buffer_before_minutes),
    'cleanupUntil', w.ends_at + make_interval(mins => o.buffer_after_minutes),
    'guests', COALESCE((l.price_snapshot->>'guests')::integer, l.place_guests),
    'pricePerHourMinor', (l.price_snapshot->>'unitPriceMinor')::bigint,
    'hoursMinor', (l.price_snapshot->>'packageMinor')::bigint,
    'noShowReleaseMinutes', o.no_show_release_minutes,
    'releaseIfNoShowAt', CASE WHEN o.no_show_release_minutes IS NOT NULL
                              THEN w.starts_at + make_interval(mins => o.no_show_release_minutes) END,
    'released', EXISTS (SELECT 1 FROM public.stay_reservation_events e
                        WHERE e.group_id = g.id AND e.event_type = 'stay_offer_no_show_released')
  )) END
  FROM public.stay_reservation_groups g
  JOIN LATERAL (SELECT * FROM public.stay_reservation_lines l2 WHERE l2.group_id = g.id
                ORDER BY l2.created_at, l2.id LIMIT 1) l ON true
  JOIN public.stay_offerings o ON o.id = l.offering_id
  LEFT JOIN public.stay_place_windows w ON w.id = public.issue_4490_line_window_id(l.id)
  WHERE g.id = p_group_id;
$function$;

-- ---------------------------------------------------------------------------
-- 14. Quote a by-the-hour booking (service role): one line {guests,
--     priceOptionId?} on a booking window (issue_4490_flexible_window). The
--     price is the hour price (busy rules by the start) x the minutes / 60
--     (half up), plus extras, plus VAT. The place is the first free unit.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_4490_quote_hour_internal(
  p_offering_id uuid,
  p_window_id uuid,
  p_lines jsonb,
  p_actor_key text,
  p_user_id uuid,
  p_idempotency_key text,
  p_extras jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_offer public.stay_offerings%ROWTYPE;
  v_window public.stay_place_windows%ROWTYPE;
  v_settings public.venue_booking_settings%ROWTYPE;
  v_policy public.stay_policy_versions%ROWTYPE;
  v_existing public.stay_quotes%ROWTYPE;
  v_option public.venue_offer_price_options%ROWTYPE;
  v_price public.stay_price_versions%ROWTYPE;
  v_fee public.stay_fee_versions%ROWTYPE;
  v_item jsonb;
  v_quote_id uuid := gen_random_uuid();
  v_line_id uuid := gen_random_uuid();
  v_request_hash text;
  v_currency text;
  v_guests integer;
  v_unit bigint;
  v_minutes integer;
  v_hours_minor bigint;
  v_extras jsonb := '[]'::jsonb;
  v_extras_minor bigint := 0;
  v_base bigint;
  v_tax bigint;
  v_total bigint;
  v_last date;
  v_booked tstzrange;
  v_claim tstzrange;
  v_place record;
BEGIN
  IF p_offering_id IS NULL OR p_window_id IS NULL
     OR COALESCE(p_actor_key, '') !~ '^[a-f0-9]{64}$'
     OR char_length(btrim(COALESCE(p_idempotency_key, ''))) NOT BETWEEN 8 AND 200
     OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) <> 1 THEN
    RAISE EXCEPTION 'offer_invalid_payload' USING ERRCODE = '22023';
  END IF;
  v_item := p_lines->0;
  IF jsonb_typeof(v_item) <> 'object'
     OR (v_item ? 'priceOptionId' AND COALESCE(v_item->>'priceOptionId', '') !~ '^[0-9a-f-]{36}$')
     OR jsonb_typeof(v_item->'guests') <> 'number' OR (v_item->>'guests') !~ '^[0-9]{1,6}$'
     OR (v_item->>'guests')::integer NOT BETWEEN 1 AND 100000 THEN
    RAISE EXCEPTION 'offer_invalid_payload' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(COALESCE(p_extras, '[]'::jsonb)) <> 'array' OR jsonb_array_length(COALESCE(p_extras, '[]'::jsonb)) > 20
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(p_extras, '[]'::jsonb)) e
                WHERE jsonb_typeof(e) <> 'object' OR COALESCE(e->>'id', '') !~ '^[a-z0-9][a-z0-9-]{0,39}$'
                   OR (e ? 'qty' AND (COALESCE(e->>'qty', '') !~ '^[0-9]{1,3}$' OR (e->>'qty')::integer NOT BETWEEN 1 AND 100)))
     OR (SELECT count(DISTINCT e->>'id') FROM jsonb_array_elements(COALESCE(p_extras, '[]'::jsonb)) e)
        <> jsonb_array_length(COALESCE(p_extras, '[]'::jsonb)) THEN
    RAISE EXCEPTION 'offer_invalid_payload' USING ERRCODE = '22023';
  END IF;
  IF NOT public.issue_4490_flag_on('VENUE_OFFERS_WRITES') THEN
    RAISE EXCEPTION 'offers_not_enabled' USING ERRCODE = 'P0001';
  END IF;
  v_request_hash := encode(pg_catalog.sha256(convert_to(jsonb_build_object(
    'offering', p_offering_id, 'window', p_window_id, 'lines', p_lines,
    'extras', COALESCE(p_extras, '[]'::jsonb))::text, 'UTF8')), 'hex');
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_actor_key || ':offer-quote:' || btrim(p_idempotency_key), 4490));
  SELECT * INTO v_existing FROM public.stay_quotes
  WHERE actor_key_hash = p_actor_key AND idempotency_key = btrim(p_idempotency_key);
  IF FOUND THEN
    IF v_existing.request_hash <> v_request_hash THEN
      RAISE EXCEPTION 'offer_idempotency_conflict' USING ERRCODE = '23505';
    END IF;
    RETURN public.issue_4490_quote_projection(v_existing.id);
  END IF;

  SELECT o.* INTO v_offer
  FROM public.stay_offerings o
  JOIN public.venue_listings v ON v.id = o.venue_id AND v.claim_status = 'verified'
  JOIN public.brands b ON b.id = v.brand_id AND b.deleted_at IS NULL
  WHERE o.id = p_offering_id AND o.kind = 'by_the_hour';
  IF NOT FOUND OR v_offer.status <> 'live' OR NOT public.issue_4490_venue_feature_on(v_offer.venue_id, 'by_the_hour') THEN
    RAISE EXCEPTION 'offer_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v_window FROM public.stay_place_windows
  WHERE id = p_window_id AND offering_id = v_offer.id AND booked_block;
  IF NOT FOUND OR v_window.stop_sell THEN
    RAISE EXCEPTION 'offer_window_unavailable' USING ERRCODE = 'P0002';
  END IF;
  v_settings := public.issue_4490_ensure_booking_settings(v_offer.venue_id);
  IF v_settings.booking_state <> 'active' OR public.issue_4490_day_closed(v_offer.venue_id, v_window.local_date) THEN
    RAISE EXCEPTION 'offer_day_closed' USING ERRCODE = 'PT409';
  END IF;
  v_last := (now() AT TIME ZONE v_settings.timezone)::date
    + LEAST(v_settings.booking_horizon_days, COALESCE(v_offer.max_advance_days, 730));
  IF v_window.local_date > v_last THEN
    RAISE EXCEPTION 'offer_too_far' USING ERRCODE = 'PT409';
  END IF;
  IF now() >= public.issue_4490_window_cutoff(v_offer.id, v_window.id) THEN
    RAISE EXCEPTION 'offer_too_soon' USING ERRCODE = 'PT409';
  END IF;
  SELECT * INTO v_policy FROM public.stay_policy_versions WHERE offering_id = v_offer.id AND effective_to IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'offer_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT upper(COALESCE(NULLIF(btrim(b.default_currency), ''), 'NGN')) INTO v_currency
  FROM public.brands b WHERE b.id = v_offer.brand_id;
  SELECT * INTO v_option FROM public.venue_offer_price_options
  WHERE offering_id = v_offer.id AND status = 'active'
    AND (NOT (v_item ? 'priceOptionId') OR id = (v_item->>'priceOptionId')::uuid)
  ORDER BY sort_order, created_at LIMIT 1;
  IF NOT FOUND OR v_option.unit <> 'hour' THEN
    RAISE EXCEPTION 'offer_option_unavailable' USING ERRCODE = 'P0002';
  END IF;
  IF public.issue_4490_option_window_reason(v_option.id, v_window.id) IS NOT NULL THEN
    RAISE EXCEPTION 'offer_%', public.issue_4490_option_window_reason(v_option.id, v_window.id) USING ERRCODE = 'PT409';
  END IF;
  v_guests := (v_item->>'guests')::integer;
  IF v_guests < v_option.guest_min OR v_guests > v_option.guest_max THEN
    RAISE EXCEPTION 'offer_guests_out_of_range' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_price FROM public.stay_price_versions
  WHERE price_option_id = v_option.id AND offering_id = v_offer.id AND effective_to IS NULL;
  IF NOT FOUND OR v_price.currency_code <> v_currency THEN
    RAISE EXCEPTION 'offer_option_unavailable' USING ERRCODE = 'P0002';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(p_extras, '[]'::jsonb)) e
             WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_offer.extras) x WHERE x->>'id' = e->>'id')) THEN
    RAISE EXCEPTION 'offer_extra_unavailable' USING ERRCODE = 'P0002';
  END IF;

  -- A free place (unit) for the whole booking, setup and cleanup included.
  v_booked := tstzrange(v_window.starts_at, v_window.ends_at, '[)');
  v_claim := tstzrange(v_window.starts_at - make_interval(mins => v_offer.buffer_before_minutes),
                       v_window.ends_at + make_interval(mins => v_offer.buffer_after_minutes), '[)');
  SELECT p.* INTO v_place
  FROM public.issue_4490_flex_places(v_offer.id, v_guests, v_option.id) p
  WHERE (SELECT s.status FROM public.issue_4490_spaces_status(p.space_ids, v_claim, NULL) s) = 'free'
  ORDER BY p.sort_key LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'offer_space_taken' USING ERRCODE = 'PT409';
  END IF;

  v_minutes := (extract(epoch FROM (v_window.ends_at - v_window.starts_at)) / 60)::integer;
  v_unit := public.issue_4490_option_price_at(v_option.id, v_window.id);
  v_hours_minor := (v_unit * v_minutes + 30) / 60;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', x->>'id', 'name', x->>'name', 'per', x->>'per',
           'unitPriceMinor', (x->>'price_minor')::bigint,
           'qty', CASE WHEN x->>'per' = 'guest' THEN v_guests ELSE COALESCE((e->>'qty')::integer, 1) END,
           'amountMinor', (x->>'price_minor')::bigint
              * CASE WHEN x->>'per' = 'guest' THEN v_guests ELSE COALESCE((e->>'qty')::integer, 1) END)
           ORDER BY x->>'name'), '[]'::jsonb)
  INTO v_extras
  FROM jsonb_array_elements(COALESCE(p_extras, '[]'::jsonb)) e
  JOIN jsonb_array_elements(v_offer.extras) x ON x->>'id' = e->>'id';
  SELECT COALESCE(sum((x->>'amountMinor')::bigint), 0) INTO v_extras_minor FROM jsonb_array_elements(v_extras) x;
  v_base := v_hours_minor + v_extras_minor;
  IF v_base > 9000000000000000 THEN
    RAISE EXCEPTION 'offer_amount_too_large' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.stay_quotes (
    id, user_id, actor_key_hash, venue_id, brand_id, currency_code, mode, status,
    source_subtotal_minor, fee_total_minor, tax_total_minor, total_minor,
    request_hash, price_revision_set_hash, inventory_revision_set_hash, policy_snapshot_hash,
    idempotency_key, expires_at, offer_kind
  ) VALUES (
    v_quote_id, p_user_id, p_actor_key, v_offer.venue_id, v_offer.brand_id, v_currency,
    'instant', 'building', 0, 0, 0, 0,
    v_request_hash, repeat('0', 64), repeat('0', 64), repeat('0', 64),
    btrim(p_idempotency_key), now() + interval '15 minutes', 'by_the_hour'
  );
  INSERT INTO public.stay_quote_lines (
    id, quote_id, offering_id, kind, confirmation_mode, place_window_id, place_guests,
    base_minor, fee_minor, tax_minor, total_minor, price_version_id, policy_version_id,
    offering_version, inventory_snapshot, offering_snapshot, price_snapshot, policy_snapshot,
    price_option_id, booked_minutes
  ) VALUES (
    v_line_id, v_quote_id, v_offer.id, 'by_the_hour', 'instant', v_window.id, LEAST(v_guests, 1000),
    v_base, 0, 0, v_base, v_price.id, v_policy.id, v_offer.version,
    jsonb_build_object('resources', jsonb_build_array(jsonb_build_object(
      'resourceType', 'place_window', 'windowId', v_window.id, 'version', v_window.version)),
      'localDate', v_window.local_date, 'spaceIds', to_jsonb(v_place.space_ids), 'combinationId', NULL,
      'bookedFrom', lower(v_booked), 'bookedTo', upper(v_booked),
      'claimFrom', lower(v_claim), 'claimTo', upper(v_claim)),
    jsonb_build_object('name', v_offer.name, 'kind', v_offer.kind, 'venueId', v_offer.venue_id),
    jsonb_build_object('optionName', v_option.name, 'unit', 'hour', 'unitPriceMinor', v_unit,
      'listPriceMinor', v_price.amount_minor, 'currencyCode', v_currency, 'sortOrder', v_option.sort_order,
      'placeName', v_place.name, 'spaceIds', to_jsonb(v_place.space_ids),
      'guests', v_guests, 'minutes', v_minutes, 'packageMinor', v_hours_minor,
      'extras', v_extras, 'extrasMinor', v_extras_minor),
    to_jsonb(v_policy) - 'created_by',
    v_option.id, LEAST(GREATEST(v_minutes, 15), 10080)
  );
  FOR v_fee IN
    SELECT * FROM public.stay_fee_versions
    WHERE offering_id = v_offer.id AND effective_to IS NULL
    ORDER BY fee_key, id
  LOOP
    v_tax := CASE
      WHEN v_fee.calculation = 'percentage_of_line_base' AND v_fee.display_mode = 'included'
        THEN round(v_base::numeric * v_fee.basis_points / (10000 + v_fee.basis_points))::bigint
      WHEN v_fee.calculation = 'percentage_of_line_base'
        THEN round(v_base::numeric * v_fee.basis_points / 10000)::bigint
      WHEN v_fee.calculation = 'fixed_per_place_booking' THEN v_fee.amount_minor
      WHEN v_fee.calculation = 'fixed_per_place_guest' THEN v_fee.amount_minor * v_guests
      ELSE 0 END;
    INSERT INTO public.stay_quote_fee_lines (
      quote_id, quote_line_id, fee_version_id, name, fee_kind, amount_minor,
      included_in_base, refund_treatment, snapshot
    ) VALUES (
      v_quote_id, v_line_id, v_fee.id, v_fee.label, v_fee.fee_kind, v_tax,
      v_fee.display_mode = 'included', v_fee.refund_treatment, to_jsonb(v_fee)
    );
  END LOOP;
  UPDATE public.stay_quote_lines line
  SET fee_minor = totals.fee_minor, tax_minor = totals.tax_minor,
      total_minor = line.base_minor + totals.fee_minor + totals.tax_minor
  FROM (
    SELECT quote_line_id,
      COALESCE(sum(amount_minor) FILTER (WHERE fee_kind = 'mandatory_fee' AND NOT included_in_base), 0) AS fee_minor,
      COALESCE(sum(amount_minor) FILTER (WHERE fee_kind = 'tax' AND NOT included_in_base), 0) AS tax_minor
    FROM public.stay_quote_fee_lines WHERE quote_id = v_quote_id GROUP BY quote_line_id
  ) totals
  WHERE line.id = totals.quote_line_id;
  SELECT total_minor INTO v_total FROM public.stay_quote_lines WHERE id = v_line_id;
  IF v_total > 9000000000000000 THEN
    RAISE EXCEPTION 'offer_amount_too_large' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.stay_quotes q
  SET status = 'active',
      source_subtotal_minor = l.base_minor, fee_total_minor = l.fee_minor,
      tax_total_minor = l.tax_minor, total_minor = l.total_minor,
      price_revision_set_hash = encode(pg_catalog.sha256(convert_to(
        l.price_version_id::text || ':' || l.price_snapshot::text, 'UTF8')), 'hex'),
      inventory_revision_set_hash = encode(pg_catalog.sha256(convert_to(
        l.offering_id::text || ':' || l.offering_version::text || ':' || l.inventory_snapshot::text, 'UTF8')), 'hex'),
      policy_snapshot_hash = encode(pg_catalog.sha256(convert_to(
        l.policy_version_id::text || ':' || l.policy_snapshot::text, 'UTF8')), 'hex')
  FROM public.stay_quote_lines l
  WHERE q.id = v_quote_id AND l.id = v_line_id;
  RETURN public.issue_4490_quote_projection(v_quote_id) || jsonb_build_object(
    'hour', jsonb_build_object(
      'placeName', v_place.name,
      'spaceIds', to_jsonb(v_place.space_ids),
      'guests', v_guests,
      'bookedFrom', lower(v_booked), 'bookedTo', upper(v_booked),
      'minutes', v_minutes,
      'pricePerHourMinor', v_unit,
      'hoursMinor', v_hours_minor,
      'noShowReleaseMinutes', v_offer.no_show_release_minutes));
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_quote_offer(
  p_offering_id uuid,
  p_window_id uuid,
  p_lines jsonb,
  p_actor_key text,
  p_user_id uuid,
  p_idempotency_key text,
  p_extras jsonb DEFAULT '[]'::jsonb,
  p_answers jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_kind text;
BEGIN
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT o.kind INTO v_kind FROM public.stay_offerings o WHERE o.id = p_offering_id;
  IF v_kind = 'private_hire' THEN
    RETURN public.issue_4490_quote_hire_internal(
      p_offering_id, p_window_id, p_lines, p_actor_key, p_user_id, p_idempotency_key, p_extras, p_answers);
  ELSIF v_kind = 'by_the_hour' THEN
    RETURN public.issue_4490_quote_hour_internal(
      p_offering_id, p_window_id, p_lines, p_actor_key, p_user_id, p_idempotency_key, p_extras);
  END IF;
  RETURN public.issue_4490_quote_offer_internal(
    p_offering_id, p_window_id, p_lines, p_actor_key, p_user_id, p_idempotency_key, false, p_extras, p_answers);
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_create_offer_group(
  p_group_id uuid,
  p_quote_id uuid,
  p_guest jsonb,
  p_actor_key text,
  p_user_id uuid,
  p_buyer_token_hash bytea,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_id uuid;
BEGIN
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF NOT public.issue_4490_flag_on('VENUE_OFFERS_WRITES') THEN
    RAISE EXCEPTION 'offers_not_enabled' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.stay_quotes q WHERE q.id = p_quote_id AND q.offer_kind IN ('private_hire', 'by_the_hour')) THEN
    v_id := public.issue_4490_hold_hire_internal(
      p_group_id, p_quote_id, p_guest, p_actor_key, p_user_id, p_buyer_token_hash, p_idempotency_key);
  ELSE
    v_id := public.issue_4490_hold_offer_internal(
      p_group_id, p_quote_id, p_guest, p_actor_key, p_user_id, p_buyer_token_hash,
      p_idempotency_key, false, NULL, 'mingla');
  END IF;
  RETURN public.issue_4490_booking_projection(v_id, NULL);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 15. Redefined functions (each is its previous definition plus the marked
--     #4490 P5 change).
-- ---------------------------------------------------------------------------

-- public page payload: P5 tables block (from 20281203084490_issue_4490_p2_offer_checkout.sql)
CREATE OR REPLACE FUNCTION public.issue_4490_venue_page_payload(p_venue_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_venue public.venue_listings%ROWTYPE;
  v_row jsonb;
  v_features text[];
  v_currency text;
  v_brand_slug text;
  v_spaces jsonb;
  v_events jsonb;
  v_tables jsonb;
  v_version bigint;
  v_offers jsonb;
  v_vat jsonb;
BEGIN
  SELECT * INTO v_venue FROM public.venue_listings WHERE id = p_venue_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  v_row := public.issue_4490_venue_page_row(p_venue_id);
  v_features := public.issue_4490_public_features(p_venue_id);
  SELECT upper(COALESCE(NULLIF(btrim(b.default_currency), ''), 'NGN')), b.slug
    INTO v_currency, v_brand_slug
  FROM public.brands b WHERE b.id = v_venue.brand_id;

  SELECT COALESCE(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'id', s.id,
      'name', s.name,
      'setting', s.setting,
      'capacityStanding', s.capacity_standing,
      'capacitySeated', s.capacity_seated,
      'planShape', s.plan_shape,
      'photoUrls', (SELECT COALESCE(jsonb_agg(p->>'url' ORDER BY i), '[]'::jsonb)
                    FROM jsonb_array_elements(s.photos) WITH ORDINALITY AS ph(p, i))
    )) ORDER BY s.sort_order, s.created_at), '[]'::jsonb)
  INTO v_spaces
  FROM public.venue_spaces s
  WHERE s.venue_id = p_venue_id AND s.is_active AND s.archived_at IS NULL;

  IF 'events_here' = ANY(v_features) THEN
    SELECT COALESCE(jsonb_agg(item ORDER BY starts_at), '[]'::jsonb)
    INTO v_events
    FROM (
      SELECT jsonb_build_object(
          'id', e.id,
          'kind', e.event_type,
          'title', e.title,
          'startsAt', nd.starts_at,
          'spaceName', sp.name,
          'fromMinor', (SELECT min(tt.price_cents) FROM public.ticket_types tt
                        WHERE tt.event_id = e.id AND tt.deleted_at IS NULL
                          AND NOT COALESCE(tt.is_hidden, false) AND NOT COALESCE(tt.is_disabled, false)),
          'href', CASE e.event_type
                    WHEN 'experience' THEN '/exp/' || v_brand_slug || '/' || e.slug
                    WHEN 'trip' THEN '/t/' || v_brand_slug || '/' || e.slug
                    ELSE '/e/' || v_brand_slug || '/' || e.slug END
        ) AS item,
        nd.starts_at
      FROM public.events e
      CROSS JOIN LATERAL (
        SELECT min(d.start_at) AS starts_at FROM public.event_dates d
        WHERE d.event_id = e.id AND d.start_at > now()
      ) nd
      LEFT JOIN public.venue_spaces sp ON sp.id = e.space_id
      WHERE e.venue_id = p_venue_id
        AND e.visibility = 'public'
        AND e.status IN ('scheduled', 'live')
        AND e.deleted_at IS NULL
        AND e.slug IS NOT NULL
        AND nd.starts_at IS NOT NULL
      ORDER BY nd.starts_at
      LIMIT 6
    ) upcoming;
  ELSE
    v_events := '[]'::jsonb;
  END IF;

  -- #4490 P5: the tables block (party cap incl. joined tables, pick a table,
  -- hold / minimum spend from, big-party request, guest waitlist).
  v_tables := public.issue_4490_public_tables(p_venue_id, v_features);

  -- #4490 P2: live offers of publicly enabled kinds, and the venue's VAT mode.
  v_offers := public.issue_4490_public_offers(p_venue_id, v_features);
  SELECT jsonb_build_object(
      'mode', s.vat_mode,
      'ratePct', COALESCE((SELECT c.vat_rate_bps FROM public.country_vat_config c
                           WHERE c.country = upper(v_venue.country_code)), 0)::numeric / 100)
    INTO v_vat
  FROM public.venue_booking_settings s WHERE s.venue_id = p_venue_id;
  IF jsonb_array_length(v_offers) = 0 THEN
    v_vat := NULL;
  END IF;

  SELECT GREATEST(
      COALESCE((SELECT max(f.version) FROM public.venue_features f WHERE f.venue_id = p_venue_id), 0),
      COALESCE((SELECT max(s.version) FROM public.venue_spaces s WHERE s.venue_id = p_venue_id), 0),
      COALESCE((SELECT max(o.version) FROM public.stay_offerings o
                WHERE o.venue_id = p_venue_id AND o.kind NOT IN ('room', 'place')), 0))
  INTO v_version;

  RETURN jsonb_build_object(
    'version', v_version,
    'venue', v_row,
    'currencyCode', v_currency,
    -- #4490 W3 fix 1: the exponent comes from its one owner (supported_brand_currencies).
    'minorUnitExponent', COALESCE((SELECT c.minor_unit_exponent FROM public.supported_brand_currencies c
                                   WHERE c.code = v_currency), 2),
    'vat', v_vat,
    'features', to_jsonb(v_features),
    'spaces', v_spaces,
    'hours', jsonb_build_object('weekly', v_row->'hours_windows', 'specialDays', v_row->'special_hours'),
    'events', jsonb_build_object('upcoming', v_events),
    'tables', v_tables,
    'offers', v_offers,
    'memberships', '[]'::jsonb
  );
END;
$function$;


-- materialize: P5 flexible opening-hours windows (from 20281203074490_issue_4490_p2_offer_engine.sql)
CREATE OR REPLACE FUNCTION public.issue_4490_materialize_offer_windows(p_offering_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_offer public.stay_offerings%ROWTYPE;
  v_settings public.venue_booking_settings%ROWTYPE;
  v_rule public.stay_place_schedule_rules%ROWTYPE;
  v_today date;
  v_until date;
  v_count integer := 0;
  v_rows integer;
  v_span integer;
BEGIN
  SELECT * INTO v_offer FROM public.stay_offerings WHERE id = p_offering_id;
  v_settings := public.issue_4490_ensure_booking_settings(v_offer.venue_id);
  v_today := (now() AT TIME ZONE v_settings.timezone)::date;
  v_until := v_today + LEAST(v_settings.booking_horizon_days, COALESCE(v_offer.max_advance_days, 730));
  FOR v_rule IN
    SELECT * FROM public.stay_place_schedule_rules
    WHERE offering_id = p_offering_id AND active
    ORDER BY created_at, id
  LOOP
    IF v_rule.mode = 'full_day' THEN
      INSERT INTO public.stay_place_windows (
        offering_id, schedule_rule_id, brand_id, venue_id, local_date,
        starts_at, ends_at, sellable_capacity, dst_resolution
      )
      SELECT v_offer.id, v_rule.id, v_offer.brand_id, v_offer.venue_id, d::date,
        (d::date + v_rule.full_day_start_time) AT TIME ZONE v_rule.timezone,
        ((d::date + CASE WHEN v_rule.full_day_end_time <= v_rule.full_day_start_time THEN 1 ELSE 0 END)
          + v_rule.full_day_end_time) AT TIME ZONE v_rule.timezone,
        v_offer.capacity, 'unambiguous'
      FROM generate_series(
        GREATEST(v_rule.local_start_date, v_today)::timestamp,
        LEAST(COALESCE(v_rule.local_end_date, v_until), v_until)::timestamp,
        interval '1 day'
      ) d
      WHERE (extract(isodow FROM d)::integer - 1) = ANY(v_rule.weekdays)
      ON CONFLICT (offering_id, starts_at, ends_at) DO NOTHING;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      v_count := v_count + v_rows;
    ELSIF v_rule.mode = 'repeating_windows' THEN
      v_span := (extract(epoch FROM (v_rule.local_end_time - v_rule.local_start_time))::integer / 60);
      IF v_span <= 0 THEN
        v_span := v_span + 1440;
      END IF;
      INSERT INTO public.stay_place_windows (
        offering_id, schedule_rule_id, brand_id, venue_id, local_date,
        starts_at, ends_at, sellable_capacity, dst_resolution
      )
      SELECT v_offer.id, v_rule.id, v_offer.brand_id, v_offer.venue_id, d::date,
        (d::date + v_rule.local_start_time + make_interval(mins => k * v_rule.slot_interval_minutes))
          AT TIME ZONE v_rule.timezone,
        (d::date + v_rule.local_start_time
          + make_interval(mins => k * v_rule.slot_interval_minutes + v_rule.slot_duration_minutes))
          AT TIME ZONE v_rule.timezone,
        v_offer.capacity, 'unambiguous'
      FROM generate_series(
        GREATEST(v_rule.local_start_date, v_today)::timestamp,
        LEAST(COALESCE(v_rule.local_end_date, v_until), v_until)::timestamp,
        interval '1 day'
      ) d
      CROSS JOIN generate_series(
        0, GREATEST((v_span - v_rule.slot_duration_minutes) / v_rule.slot_interval_minutes, -1)
      ) k
      WHERE (extract(isodow FROM d)::integer - 1) = ANY(v_rule.weekdays)
      ON CONFLICT (offering_id, starts_at, ends_at) DO NOTHING;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      v_count := v_count + v_rows;
    ELSIF v_rule.mode = 'flexible' THEN
      -- #4490 P5: one window per open day (the opening hours a flexible
      -- booking sits in; each booking gets its own window later).
      INSERT INTO public.stay_place_windows (
        offering_id, schedule_rule_id, brand_id, venue_id, local_date,
        starts_at, ends_at, sellable_capacity, dst_resolution
      )
      SELECT v_offer.id, v_rule.id, v_offer.brand_id, v_offer.venue_id, d::date,
        (d::date + v_rule.local_start_time) AT TIME ZONE v_rule.timezone,
        ((d::date + CASE WHEN v_rule.local_end_time <= v_rule.local_start_time THEN 1 ELSE 0 END)
          + v_rule.local_end_time) AT TIME ZONE v_rule.timezone,
        v_offer.capacity, 'unambiguous'
      FROM generate_series(
        GREATEST(v_rule.local_start_date, v_today)::timestamp,
        LEAST(COALESCE(v_rule.local_end_date, v_until), v_until)::timestamp,
        interval '1 day'
      ) d
      WHERE (extract(isodow FROM d)::integer - 1) = ANY(v_rule.weekdays)
      ON CONFLICT (offering_id, starts_at, ends_at) DO NOTHING;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      v_count := v_count + v_rows;
    END IF;
  END LOOP;
  RETURN v_count;
END;
$function$;


-- offer projection: P5 hour (from 20281203154490_issue_4490_p4_private_hire.sql)
CREATE OR REPLACE FUNCTION public.issue_4490_offer_projection(p_offering_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT jsonb_build_object(
    'id', o.id,
    'venueId', o.venue_id,
    'kind', o.kind,
    'entryStyle', o.entry_style,
    'name', o.name,
    'summary', NULLIF(o.summary, ''),
    'description', NULLIF(o.description, ''),
    'status', o.status,
    'version', o.version,
    'confirmationMode', COALESCE(o.confirmation_mode, 'instant'),
    'sessionCapacity', CASE WHEN o.entry_style = 'timed_session' THEN o.capacity ELSE NULL END,
    'minNoticeMinutes', o.min_notice_minutes,
    'maxAdvanceDays', o.max_advance_days,
    'sortOrder', o.sort_order,
    'pool', public.issue_4490_pool_projection(o.capacity_pool_id),
    'options', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', opt.id,
        'name', opt.name,
        'unit', opt.unit,
        'guestMin', opt.guest_min,
        'guestMax', opt.guest_max,
        'weekdays', to_jsonb(opt.weekdays),
        'startTime', to_char(opt.local_start_time, 'HH24:MI'),
        'endTime', to_char(opt.local_end_time, 'HH24:MI'),
        'eligibility', CASE WHEN opt.eligibility IS NULL THEN NULL ELSE jsonb_build_object(
          'label', opt.eligibility->>'label',
          'checkAtGate', (opt.eligibility->>'check_at_gate')::boolean) END,
        'busyRules', opt.busy_rules,
        'sortOrder', opt.sort_order,
        'status', opt.status,
        'version', opt.version,
        'priceMinor', price.amount_minor,
        'priceVersionId', price.id,
        -- #4490 P4: a hire price row sits on a space or a combination.
        'spaceId', opt.space_id,
        'combinationId', opt.combination_id
      ) ORDER BY opt.sort_order, opt.created_at)
      FROM public.venue_offer_price_options opt
      LEFT JOIN public.stay_price_versions price
        ON price.price_option_id = opt.id AND price.offering_id = opt.offering_id AND price.effective_to IS NULL
      WHERE opt.offering_id = o.id AND opt.status = 'active'
    ), '[]'::jsonb),
    'policy', (
      SELECT jsonb_build_object(
        'versionId', p.id,
        'cancellationPolicy', p.cancellation_policy,
        'refundLadder', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'minMinutesBefore', (r->>'min_minutes_before')::integer,
            'refundBps', (r->>'refund_bps')::integer) ORDER BY ord)
          FROM jsonb_array_elements(p.refund_ladder) WITH ORDINALITY AS l(r, ord)
        ), '[]'::jsonb),
        'dateChangeRule', jsonb_strip_nulls(jsonb_build_object(
          'allowedUntilMinutesBefore', (p.date_change_rule->>'allowed_until_minutes_before')::integer,
          'feeBps', (p.date_change_rule->>'fee_bps')::integer,
          'maxChanges', (p.date_change_rule->>'max_changes')::integer,
          'guestChangeUntilMinutesBefore', (p.date_change_rule->>'guest_change_until_minutes_before')::integer)),
        'operatorCancelRefundBps', p.operator_cancel_refund_basis_points)
      FROM public.stay_policy_versions p
      WHERE p.offering_id = o.id AND p.effective_to IS NULL
    ),
    'schedule', (
      SELECT jsonb_build_object(
        'ruleId', r.id,
        'mode', CASE r.mode WHEN 'full_day' THEN 'full_day' ELSE 'sessions' END,
        'weekdays', to_jsonb(r.weekdays),
        'startTime', to_char(COALESCE(r.full_day_start_time, r.local_start_time), 'HH24:MI'),
        'endTime', to_char(COALESCE(r.full_day_end_time, r.local_end_time), 'HH24:MI'),
        'sessionMinutes', r.slot_duration_minutes,
        'sessionEveryMinutes', r.slot_interval_minutes,
        'startDate', r.local_start_date,
        'endDate', r.local_end_date,
        'timezone', r.timezone)
      FROM public.stay_place_schedule_rules r
      WHERE r.offering_id = o.id AND r.active
      ORDER BY r.created_at DESC
      LIMIT 1
    ),
    'inclusions', COALESCE((
      SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'kind', COALESCE(i->>'kind', 'item'),
        'label', i->>'label',
        'qtyPer', i->>'qty_per',
        'menuItemId', i->>'menu_item_id',
        'staffRatio', (i->>'staff_ratio')::integer,
        'options', i->'options')) ORDER BY ord)
      FROM jsonb_array_elements(o.inclusions) WITH ORDINALITY AS inc(i, ord)), '[]'::jsonb),
    'extras', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', e->>'id', 'name', e->>'name', 'priceMinor', (e->>'price_minor')::bigint, 'per', e->>'per') ORDER BY ord)
      FROM jsonb_array_elements(o.extras) WITH ORDINALITY AS ex(e, ord)), '[]'::jsonb),
    'staffRoleLabel', o.staff_role_label,
    'deposit', jsonb_build_object(
      'kind', o.deposit_kind,
      'value', o.deposit_value,
      'balanceDueDaysBefore', o.balance_due_days_before),
    'payModes', CASE WHEN o.deposit_kind = 'none' THEN '["full"]'::jsonb ELSE '["deposit","full"]'::jsonb END,
    'durationMinutes', (SELECT r.slot_duration_minutes FROM public.stay_place_schedule_rules r
                        WHERE r.offering_id = o.id AND r.active AND r.mode = 'repeating_windows'
                        ORDER BY r.created_at DESC LIMIT 1),
    'startTimes', COALESCE((
      SELECT jsonb_agg(st.t ORDER BY st.t) FROM (
      SELECT DISTINCT to_char(r.local_start_time + make_interval(mins => k * r.slot_interval_minutes), 'HH24:MI') AS t
      FROM public.stay_place_schedule_rules r
      CROSS JOIN LATERAL generate_series(0, GREATEST((
        (CASE WHEN r.local_end_time <= r.local_start_time
              THEN extract(epoch FROM (r.local_end_time - r.local_start_time))::integer / 60 + 1440
              ELSE extract(epoch FROM (r.local_end_time - r.local_start_time))::integer / 60 END)
        - r.slot_duration_minutes) / r.slot_interval_minutes, 0)) k
      WHERE r.offering_id = o.id AND r.active AND r.mode = 'repeating_windows') st), '[]'::jsonb),
    'readiness', to_jsonb(public.issue_4490_offer_readiness(o.id)),
    'canCollectOnline', public.issue_4490_can_collect_online(o.brand_id, o.venue_id),
    'warnings', to_jsonb(CASE WHEN public.issue_4490_can_collect_online(o.brand_id, o.venue_id)
                              THEN '{}'::text[] ELSE ARRAY['online_payments_off']::text[] END),
    'hire', public.issue_4490_hire_projection(o.id),
    -- #4490 P5: by the hour (places, opening hours, lengths, rules).
    'hour', public.issue_4490_hour_projection(o.id),
    'createdAt', o.created_at,
    'updatedAt', o.updated_at
  )
  FROM public.stay_offerings o
  WHERE o.id = p_offering_id;
$function$;


-- booking projection: P5 hour (from 20281203154490_issue_4490_p4_private_hire.sql)
CREATE OR REPLACE FUNCTION public.issue_4490_booking_projection(p_group_id uuid, p_qr_pepper text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT jsonb_build_object(
    'groupId', g.id,
    'reference', g.public_reference,
    'offerKind', g.offer_kind,
    'state', g.state,
    'version', g.version,
    'bookingSource', g.booking_source,
    'paymentCollection', g.payment_collection,
    'currencyCode', g.currency_code,
    'subtotalMinor', g.source_subtotal_minor,
    'feeMinor', g.fee_total_minor,
    'taxMinor', g.tax_total_minor,
    'totalMinor', g.total_minor,
    'paidMinor', COALESCE((SELECT sum(a.amount_minor) FROM public.stay_payment_attempts a
                           WHERE a.group_id = g.id AND a.state = 'succeeded'), 0),
    'refundedMinor', COALESCE((SELECT sum(r.amount_minor) FROM public.stay_refunds r
                               WHERE r.group_id = g.id AND r.state IN ('submitted', 'processing', 'succeeded')), 0),
    'balanceDueMinor', money.balance,
    -- #4490 P4: while an approved hire is on hold, what is due now is the
    -- deposit (or everything when no deposit applies).
    'amountDueNowMinor', CASE
      WHEN g.state = 'instant_payment_pending' AND g.payment_collection = 'mingla' THEN g.total_minor
      WHEN g.state = 'approved_payment_required' AND g.payment_collection = 'mingla' THEN
        CASE WHEN g.deposit_minor IS NOT NULL AND g.balance_due_at > now() THEN g.deposit_minor ELSE money.total_due END
      ELSE money.balance END,
    'holdUntil', (SELECT h.expires_at FROM public.stay_inventory_holds h
                  WHERE h.group_id = g.id AND h.state = 'active'),
    'guest', jsonb_build_object(
      'name', g.guest_snapshot->>'name',
      'email', g.guest_snapshot->>'email',
      'phone', g.guest_snapshot->>'phone'),
    'venue', (SELECT jsonb_build_object('id', v.id, 'name', v.name, 'slug', v.slug,
                'brandSlug', b.slug, 'brandName', b.name, 'address', v.address, 'city', v.city,
                'lat', v.lat, 'lng', v.lng, 'timezone', public.issue_4490_venue_timezone(v.id))
              FROM public.venue_listings v JOIN public.brands b ON b.id = v.brand_id WHERE v.id = g.venue_id),
    'offer', (SELECT jsonb_build_object('id', o.id, 'name', o.name, 'kind', o.kind, 'entryStyle', o.entry_style)
              FROM public.stay_reservation_lines l JOIN public.stay_offerings o ON o.id = l.offering_id
              WHERE l.group_id = g.id ORDER BY l.created_at, l.id LIMIT 1),
    'window', (SELECT jsonb_build_object('windowId', w.id, 'localDate', w.local_date, 'startsAt', w.starts_at, 'endsAt', w.ends_at)
               FROM public.stay_place_windows w WHERE w.id = public.issue_4490_group_window_id(g.id)),
    'lines', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'lineId', l.id, 'state', l.state, 'priceOptionId', l.price_option_id,
        'name', l.price_snapshot->>'optionName', 'guests', public.issue_4490_line_guests(l.id),
        'bookedGuests', l.place_guests, 'unit', l.price_snapshot->>'unit',
        'packageMinor', (l.price_snapshot->>'packageMinor')::bigint,
        'extrasMinor', (l.price_snapshot->>'extrasMinor')::bigint,
        'unitPriceMinor', (l.price_snapshot->>'unitPriceMinor')::bigint,
        'baseMinor', l.base_minor, 'taxMinor', l.tax_minor, 'feeMinor', l.fee_minor, 'totalMinor', l.total_minor,
        'idCheckLabel', l.price_snapshot->>'idCheckLabel')
        ORDER BY COALESCE((l.price_snapshot->>'sortOrder')::integer, 0), l.created_at, l.id)
      FROM public.stay_reservation_lines l WHERE l.group_id = g.id), '[]'::jsonb),
    'policy', jsonb_build_object(
      'text', g.payment_plan_snapshot->>'policyText',
      'refundLadder', g.payment_plan_snapshot->'refundLadder',
      'dateChangeRule', g.payment_plan_snapshot->'dateChangeRule'),
    'vatMode', g.payment_plan_snapshot->>'vatMode',
    'passes', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'passId', p.id, 'status', p.status, 'admits', p.admits, 'admittedCount', p.admitted_count,
        'validLocalDate', p.valid_local_date, 'validFrom', p.valid_from, 'validTo', p.valid_to,
        'holderName', p.holder_name, 'idCheckLabel', p.id_check_label, 'idCheckCount', p.id_check_count,
        'qrPayload', CASE WHEN p_qr_pepper IS NOT NULL AND p.status = 'valid'
                          THEN public.issue_4490_pass_qr_payload(p.id, p.qr_token_hash, p_qr_pepper) END)
        ORDER BY p.created_at)
      FROM public.venue_passes p WHERE p.group_id = g.id), '[]'::jsonb),
    'createdAt', g.created_at,
    'updatedAt', g.updated_at
  ) || jsonb_build_object(
    'totalDueMinor', money.total_due,
    'paidOnlineMinor', money.paid_online,
    'paidAtVenueMinor', money.paid_offline,
    'changesMinor', money.changes_minor,
    'depositMinor', g.deposit_minor,
    'balanceDueAt', g.balance_due_at,
    'payModes', CASE
      WHEN g.state IN ('instant_payment_pending', 'approved_payment_required') AND g.payment_collection = 'mingla' THEN
        CASE WHEN g.deposit_minor IS NOT NULL AND g.balance_due_at > now()
             THEN jsonb_build_array(
               jsonb_build_object('mode', 'deposit', 'amountMinor', g.deposit_minor),
               jsonb_build_object('mode', 'full', 'amountMinor', money.total_due))
             ELSE jsonb_build_array(jsonb_build_object('mode', 'full', 'amountMinor', money.total_due)) END
      ELSE '[]'::jsonb END,
    'extras', COALESCE((
      SELECT jsonb_agg(x ORDER BY ord)
      FROM (
        SELECT x, 1 AS ord FROM public.stay_reservation_lines l, jsonb_array_elements(COALESCE(l.price_snapshot->'extras', '[]'::jsonb)) x
        WHERE l.group_id = g.id
        UNION ALL
        SELECT x || jsonb_build_object('addedAt', a.created_at), 2 FROM public.venue_booking_amendments a,
          jsonb_array_elements(a.extras) x
        WHERE a.group_id = g.id AND a.kind = 'add_extras'
      ) all_extras), '[]'::jsonb),
    'answers', g.booking_answers,
    'inclusions', (SELECT COALESCE(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
          'kind', COALESCE(i->>'kind', 'item'), 'label', i->>'label', 'qtyPer', i->>'qty_per',
          'staffRatio', (i->>'staff_ratio')::integer)) ORDER BY ord), '[]'::jsonb)
        FROM public.stay_reservation_lines l
        JOIN public.stay_offerings o ON o.id = l.offering_id,
        jsonb_array_elements(o.inclusions) WITH ORDINALITY AS inc(i, ord)
        WHERE l.id = (SELECT l2.id FROM public.stay_reservation_lines l2 WHERE l2.group_id = g.id
                      ORDER BY l2.created_at, l2.id LIMIT 1)),
    'changes', COALESCE((
      SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'changeId', a.id, 'kind', a.kind, 'fromGuests', a.from_guests, 'toGuests', a.to_guests,
        'fromDate', (SELECT w.local_date FROM public.stay_place_windows w WHERE w.id = a.from_window_id),
        'toDate', (SELECT w.local_date FROM public.stay_place_windows w WHERE w.id = a.to_window_id),
        'extras', CASE WHEN jsonb_array_length(a.extras) > 0 THEN a.extras END,
        'amountMinor', a.price_delta_minor + a.fee_delta_minor + a.tax_delta_minor + a.policy_fee_minor,
        'feeMinor', a.policy_fee_minor, 'refundMinor', a.refund_minor, 'by', a.actor_type,
        'createdAt', a.created_at)) ORDER BY a.created_at)
      FROM public.venue_booking_amendments a WHERE a.group_id = g.id), '[]'::jsonb),
    'changeRules', public.issue_4490_change_rules(g.id),
    'requestDeadline', g.request_deadline,
    'paymentDeadline', g.payment_deadline,
    'hire', public.issue_4490_hire_booking_facts(g.id),
    -- #4490 P5: by the hour (the unit claimed, the hours, no-show release).
    'hour', public.issue_4490_hour_booking_facts(g.id)
  )
  FROM public.stay_reservation_groups g
  CROSS JOIN LATERAL public.issue_4490_booking_money(g.id) money
  WHERE g.id = p_group_id AND g.offer_kind IS NOT NULL;
$function$;


-- readiness: P5 by the hour (from 20281203154490_issue_4490_p4_private_hire.sql)
CREATE OR REPLACE FUNCTION public.issue_4490_offer_readiness(p_offering_id uuid)
RETURNS text[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_offer public.stay_offerings%ROWTYPE;
  v_venue public.venue_listings%ROWTYPE;
  v_reasons text[] := '{}'::text[];
  v_pool public.venue_capacity_pools%ROWTYPE;
  v_max_guests integer;
BEGIN
  SELECT * INTO v_offer FROM public.stay_offerings WHERE id = p_offering_id;
  IF NOT FOUND THEN
    RETURN ARRAY['not_found'];
  END IF;
  SELECT * INTO v_venue FROM public.venue_listings WHERE id = v_offer.venue_id;
  IF NOT (v_offer.kind = ANY(public.issue_4490_built_offer_kinds())) THEN
    v_reasons := v_reasons || 'kind_not_available_yet'::text;
  END IF;
  IF NOT public.issue_4490_venue_feature_on(v_offer.venue_id, public.issue_4490_offer_kind_feature(v_offer.kind)) THEN
    v_reasons := v_reasons || 'feature_off'::text;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.venue_offer_price_options o
    JOIN public.stay_price_versions p
      ON p.price_option_id = o.id AND p.offering_id = o.offering_id AND p.effective_to IS NULL
    WHERE o.offering_id = v_offer.id AND o.status = 'active'
  ) THEN
    v_reasons := v_reasons || 'no_price_option'::text;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.stay_policy_versions p
    WHERE p.offering_id = v_offer.id AND p.effective_to IS NULL
  ) THEN
    v_reasons := v_reasons || 'no_policy'::text;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.stay_place_schedule_rules r
    WHERE r.offering_id = v_offer.id AND r.active
  ) THEN
    v_reasons := v_reasons || 'no_schedule'::text;
  END IF;
  IF v_offer.kind IN ('entry', 'group_package') THEN
    SELECT * INTO v_pool FROM public.venue_capacity_pools WHERE id = v_offer.capacity_pool_id;
    IF NOT FOUND OR v_pool.archived_at IS NOT NULL THEN
      v_reasons := v_reasons || 'no_day_limit'::text;
    ELSE
      SELECT max(o.guest_max) INTO v_max_guests
      FROM public.venue_offer_price_options o
      WHERE o.offering_id = v_offer.id AND o.status = 'active';
      IF v_max_guests IS NOT NULL AND v_max_guests > v_pool.daily_limit THEN
        v_reasons := v_reasons || 'guest_max_over_capacity'::text;
      END IF;
    END IF;
  END IF;
  IF v_offer.kind IN ('private_hire', 'by_the_hour') AND NOT EXISTS (
    SELECT 1 FROM public.venue_offer_spaces s WHERE s.offering_id = v_offer.id
  ) THEN
    v_reasons := v_reasons || 'no_spaces'::text;
  END IF;
  IF v_offer.deposit_kind <> 'none' AND v_offer.kind NOT IN ('group_package', 'private_hire') THEN
    v_reasons := v_reasons || 'deposit_not_available_yet'::text;
  END IF;
  -- #4490 P3: packages are priced per guest or per booking, and start at set times.
  IF v_offer.kind IN ('group_package', 'private_hire') AND EXISTS (
    SELECT 1 FROM public.venue_offer_price_options o
    WHERE o.offering_id = v_offer.id AND o.status = 'active' AND o.unit NOT IN ('guest', 'booking')
  ) THEN
    v_reasons := v_reasons || 'option_unit_invalid'::text;
  END IF;
  IF v_offer.kind IN ('group_package', 'private_hire') AND EXISTS (
    SELECT 1 FROM public.stay_place_schedule_rules r
    WHERE r.offering_id = v_offer.id AND r.active AND r.mode = 'full_day'
  ) THEN
    v_reasons := v_reasons || 'no_start_times'::text;
  END IF;
  -- #4490 P4: every hire price row names a space or combination of this
  -- offer, and its largest group fits there.
  IF v_offer.kind = 'private_hire' THEN
    IF EXISTS (
      SELECT 1 FROM public.venue_offer_price_options o
      WHERE o.offering_id = v_offer.id AND o.status = 'active'
        AND (public.issue_4490_option_spaces(o.id) IS NULL
             OR EXISTS (SELECT 1 FROM unnest(public.issue_4490_option_spaces(o.id)) p
                        WHERE NOT EXISTS (SELECT 1 FROM public.venue_offer_spaces s
                                          WHERE s.offering_id = v_offer.id AND s.space_id = p)))
    ) THEN
      v_reasons := v_reasons || 'hire_price_space_missing'::text;
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.venue_offer_price_options o
      WHERE o.offering_id = v_offer.id AND o.status = 'active'
        AND public.issue_4490_option_spaces(o.id) IS NOT NULL
        AND o.guest_max > public.issue_4490_option_capacity(o.id)
    ) THEN
      v_reasons := v_reasons || 'guest_max_over_capacity'::text;
    END IF;
  END IF;
  -- #4490 P5: by the hour is priced per hour and sits in opening hours.
  IF v_offer.kind = 'by_the_hour' THEN
    IF EXISTS (SELECT 1 FROM public.venue_offer_price_options o
               WHERE o.offering_id = v_offer.id AND o.status = 'active' AND o.unit <> 'hour') THEN
      v_reasons := v_reasons || 'option_unit_invalid'::text;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.stay_place_schedule_rules r
                   WHERE r.offering_id = v_offer.id AND r.active AND r.mode = 'flexible') THEN
      v_reasons := v_reasons || 'no_hours'::text;
    END IF;
  END IF;
  IF v_venue.venue_category = 'stay' THEN
    v_reasons := v_reasons || 'stay_venue'::text;
  END IF;
  RETURN v_reasons;
END;
$function$;


-- availability: P5 flexible days (from 20281203154490_issue_4490_p4_private_hire.sql)
CREATE OR REPLACE FUNCTION public.pg_venue_offer_availability(
  p_offering_id uuid,
  p_from date,
  p_to date,
  p_guests integer DEFAULT NULL,
  p_price_option_id uuid DEFAULT NULL
)
RETURNS TABLE (
  local_date date,
  starts_at timestamptz,
  ends_at timestamptz,
  window_id uuid,
  status text,
  reason text,
  remaining integer,
  price_minor bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_offer public.stay_offerings%ROWTYPE;
  v_settings public.venue_booking_settings%ROWTYPE;
  v_window public.stay_place_windows%ROWTYPE;
  v_usage record;
  v_today date;
  v_last date;
  v_remaining integer;
  v_reason text;
  v_opt record;
  v_ranges record;
  v_state record;
  v_best integer;
  v_rank integer;
  v_price bigint;
  v_considered integer;
  v_flex record;
BEGIN
  IF p_offering_id IS NULL OR p_from IS NULL OR p_to IS NULL OR p_to < p_from
     OR p_to - p_from > 62 OR (p_guests IS NOT NULL AND p_guests NOT BETWEEN 1 AND 100000) THEN
    RAISE EXCEPTION 'availability_range_invalid' USING ERRCODE = '22023';
  END IF;
  IF NOT public.issue_4490_flag_on('VENUE_OFFERS_READS') THEN
    RETURN;
  END IF;
  SELECT o.* INTO v_offer
  FROM public.stay_offerings o
  JOIN public.venue_listings v ON v.id = o.venue_id AND v.claim_status = 'verified'
  JOIN public.brands b ON b.id = v.brand_id AND b.deleted_at IS NULL
  WHERE o.id = p_offering_id AND o.kind NOT IN ('room', 'place') AND o.status = 'live';
  IF NOT FOUND OR NOT public.issue_4490_venue_feature_on(v_offer.venue_id, public.issue_4490_offer_kind_feature(v_offer.kind)) THEN
    RETURN;
  END IF;
  SELECT * INTO v_settings FROM public.venue_booking_settings WHERE venue_id = v_offer.venue_id;
  v_today := (now() AT TIME ZONE COALESCE(v_settings.timezone, 'UTC'))::date;
  v_last := v_today + LEAST(COALESCE(v_settings.booking_horizon_days, 365), COALESCE(v_offer.max_advance_days, 730));
  FOR v_window IN
    SELECT w.* FROM public.stay_place_windows w
    WHERE w.offering_id = v_offer.id AND w.local_date BETWEEN p_from AND p_to AND NOT w.stop_sell
      AND NOT w.booked_block
    ORDER BY w.starts_at, w.id
  LOOP
    local_date := v_window.local_date;
    starts_at := v_window.starts_at;
    ends_at := v_window.ends_at;
    window_id := v_window.id;
    reason := NULL;
    remaining := 0;
    -- #4490 P5: a flexible day (by the hour, "Hours you set"): available when
    -- some start has a free place for the shortest booking; remaining = the
    -- number of such starts.
    IF public.issue_4490_window_is_flexible(v_window.id) THEN
      price_minor := NULL;
      IF COALESCE(v_settings.booking_state, 'active') <> 'active' THEN
        status := 'closed'; reason := 'bookings_paused';
      ELSIF public.issue_4490_day_closed(v_offer.venue_id, v_window.local_date) THEN
        status := 'closed';
      ELSIF v_window.local_date > v_last THEN
        status := 'too_far';
      ELSE
        SELECT * INTO v_flex FROM public.issue_4490_flex_day_summary(v_offer.id, v_window.id, p_guests, p_price_option_id);
        status := v_flex.status; reason := v_flex.reason;
        remaining := v_flex.free_starts; price_minor := v_flex.price_minor;
      END IF;
      RETURN NEXT;
      CONTINUE;
    END IF;
    IF v_offer.kind = 'private_hire' THEN
      -- #4490 P4: a hire window is free, on hold or booked for its places.
      price_minor := NULL;
      IF COALESCE(v_settings.booking_state, 'active') <> 'active' THEN
        status := 'closed'; reason := 'bookings_paused';
      ELSIF public.issue_4490_day_closed(v_offer.venue_id, v_window.local_date) THEN
        status := 'closed';
      ELSIF v_window.local_date > v_last THEN
        status := 'too_far';
      ELSIF now() >= public.issue_4490_window_cutoff(v_offer.id, v_window.id) THEN
        status := 'too_soon';
      ELSE
        v_best := 0; v_considered := 0; v_price := NULL;
        SELECT * INTO v_ranges FROM public.issue_4490_hire_ranges(v_offer.id, v_window.id, 0);
        FOR v_opt IN
          SELECT opt.id, opt.guest_min, opt.guest_max,
                 public.issue_4490_option_window_reason(opt.id, v_window.id) AS why,
                 public.issue_4490_option_capacity(opt.id) AS cap
          FROM public.venue_offer_price_options opt
          WHERE opt.offering_id = v_offer.id AND opt.status = 'active'
            AND (p_price_option_id IS NULL OR opt.id = p_price_option_id)
            AND public.issue_4490_option_spaces(opt.id) IS NOT NULL
          ORDER BY opt.sort_order, opt.id
        LOOP
          IF v_opt.why IS NOT NULL THEN
            v_reason := v_opt.why;
            CONTINUE;
          END IF;
          IF p_guests IS NOT NULL AND (p_guests < v_opt.guest_min OR p_guests > CASE
               WHEN v_offer.extra_guest_minor IS NOT NULL THEN v_opt.cap ELSE v_opt.guest_max END) THEN
            CONTINUE;
          END IF;
          v_considered := v_considered + 1;
          SELECT * INTO v_state FROM public.issue_4490_spaces_status(
            public.issue_4490_option_spaces(v_opt.id), v_ranges.claim, NULL);
          v_rank := CASE v_state.status WHEN 'free' THEN 3 WHEN 'held' THEN 2 ELSE 1 END;
          IF v_rank > v_best THEN
            v_best := v_rank;
            v_price := public.issue_4490_option_price_at(v_opt.id, v_window.id);
          ELSIF v_rank = v_best THEN
            v_price := LEAST(v_price, public.issue_4490_option_price_at(v_opt.id, v_window.id));
          END IF;
        END LOOP;
        IF v_considered = 0 THEN
          IF v_reason IN ('wrong_weekday', 'wrong_time') THEN
            status := 'wrong_weekday'; reason := v_reason;
          ELSE
            status := 'closed'; reason := 'no_space_fits';
          END IF;
        ELSE
          status := CASE v_best WHEN 3 THEN 'available' WHEN 2 THEN 'held' ELSE 'taken' END;
          remaining := CASE WHEN v_best = 3 THEN 1 ELSE 0 END;
          price_minor := v_price;
        END IF;
      END IF;
      v_reason := NULL;
      RETURN NEXT;
      CONTINUE;
    END IF;
    price_minor := CASE WHEN p_price_option_id IS NOT NULL
      THEN public.issue_4490_option_price_at(p_price_option_id, v_window.id)
      ELSE (SELECT min(public.issue_4490_option_price_at(opt.id, v_window.id))
            FROM public.venue_offer_price_options opt
            WHERE opt.offering_id = v_offer.id AND opt.status = 'active'
              AND public.issue_4490_option_window_reason(opt.id, v_window.id) IS NULL) END;
    SELECT * INTO v_usage FROM public.issue_4490_pool_day_usage(v_offer.capacity_pool_id, v_window.local_date);
    IF COALESCE(v_settings.booking_state, 'active') <> 'active' THEN
      status := 'closed'; reason := 'bookings_paused';
    ELSIF COALESCE(v_usage.closed, public.issue_4490_day_closed(v_offer.venue_id, v_window.local_date)) THEN
      status := 'closed';
      reason := CASE WHEN COALESCE(v_usage.venue_hired, false) THEN 'venue_hired' END;
    ELSIF v_window.local_date > v_last THEN
      status := 'too_far';
    ELSIF now() >= public.issue_4490_window_cutoff(v_offer.id, v_window.id) THEN
      status := 'too_soon';
    ELSE
      v_reason := CASE WHEN p_price_option_id IS NOT NULL
        THEN public.issue_4490_option_window_reason(p_price_option_id, v_window.id) END;
      IF v_reason IN ('wrong_weekday', 'wrong_time') THEN
        status := 'wrong_weekday'; reason := v_reason;
      ELSIF v_reason IS NOT NULL THEN
        status := 'closed'; reason := v_reason;
      ELSE
        v_remaining := COALESCE(v_usage.online_left, 0);
        IF v_offer.entry_style = 'timed_session' THEN
          v_remaining := LEAST(v_remaining,
            GREATEST(v_window.sellable_capacity - public.issue_4490_window_used(v_window.id), 0));
        END IF;
        remaining := v_remaining;
        IF v_remaining >= COALESCE(p_guests, 1) THEN
          status := 'available';
        ELSIF v_remaining = 0 AND COALESCE(v_usage.gate_left, 0) > 0 THEN
          status := 'gate_only';
        ELSE
          status := 'sold_out';
          reason := CASE WHEN v_remaining > 0 THEN 'not_enough_left' END;
        END IF;
      END IF;
    END IF;
    RETURN NEXT;
  END LOOP;
END;
$function$;


-- hold: P5 by the hour (instant; any free unit) (from 20281203154490_issue_4490_p4_private_hire.sql)
CREATE OR REPLACE FUNCTION public.issue_4490_hold_hire_internal(
  p_group_id uuid,
  p_quote_id uuid,
  p_guest jsonb,
  p_actor_key text,
  p_user_id uuid,
  p_buyer_token_hash bytea,
  p_idempotency_key text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_quote public.stay_quotes%ROWTYPE;
  v_existing public.stay_reservation_groups%ROWTYPE;
  v_offer public.stay_offerings%ROWTYPE;
  v_window public.stay_place_windows%ROWTYPE;
  v_settings public.venue_booking_settings%ROWTYPE;
  v_line public.stay_quote_lines%ROWTYPE;
  v_request_hash text;
  v_hold_id uuid := gen_random_uuid();
  v_line_id uuid;
  v_hold_expires timestamptz;
  v_deadline timestamptz;
  v_policy jsonb;
  v_plan jsonb;
  v_damage bigint;
  v_spaces uuid[];
  v_ranges record;
  v_state record;
  v_request boolean;
BEGIN
  IF p_group_id IS NULL OR p_quote_id IS NULL
     OR COALESCE(p_actor_key, '') !~ '^[a-f0-9]{64}$'
     OR char_length(btrim(COALESCE(p_idempotency_key, ''))) NOT BETWEEN 8 AND 200
     OR p_buyer_token_hash IS NULL OR octet_length(p_buyer_token_hash) <> 32 THEN
    RAISE EXCEPTION 'offer_invalid_payload' USING ERRCODE = '22023';
  END IF;
  PERFORM public.issue_4490_assert_offer_guest(p_guest, true);
  v_request_hash := encode(pg_catalog.sha256(convert_to(jsonb_build_object(
    'quoteId', p_quote_id, 'guest', p_guest)::text, 'UTF8')), 'hex');
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_actor_key || ':offer-group:' || btrim(p_idempotency_key), 4490));
  SELECT * INTO v_existing FROM public.stay_reservation_groups
  WHERE actor_key_hash = p_actor_key AND idempotency_key = btrim(p_idempotency_key);
  IF FOUND THEN
    IF v_existing.request_hash <> v_request_hash OR v_existing.offer_kind IS NULL THEN
      RAISE EXCEPTION 'offer_idempotency_conflict' USING ERRCODE = '23505';
    END IF;
    RETURN v_existing.id;
  END IF;
  SELECT * INTO v_quote FROM public.stay_quotes WHERE id = p_quote_id FOR UPDATE;
  IF NOT FOUND OR v_quote.actor_key_hash <> p_actor_key OR COALESCE(v_quote.offer_kind, '') NOT IN ('private_hire', 'by_the_hour') THEN
    RAISE EXCEPTION 'offer_quote_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_quote.status <> 'active' OR v_quote.expires_at <= now() THEN
    IF v_quote.status = 'active' THEN
      UPDATE public.stay_quotes SET status = 'expired', version = version + 1 WHERE id = v_quote.id;
    END IF;
    RAISE EXCEPTION 'offer_quote_expired' USING ERRCODE = 'PT409';
  END IF;
  PERFORM 1 FROM public.brands WHERE id = v_quote.brand_id FOR UPDATE;
  SELECT * INTO v_line FROM public.stay_quote_lines WHERE quote_id = v_quote.id ORDER BY id LIMIT 1;
  SELECT * INTO v_offer FROM public.stay_offerings WHERE id = v_line.offering_id FOR UPDATE;
  IF v_offer.status <> 'live'
     OR NOT public.issue_4490_venue_feature_on(v_offer.venue_id, public.issue_4490_offer_kind_feature(v_offer.kind))
     OR v_line.offering_version <> v_offer.version
     OR NOT EXISTS (SELECT 1 FROM public.stay_price_versions p WHERE p.id = v_line.price_version_id AND p.effective_to IS NULL)
     OR NOT EXISTS (SELECT 1 FROM public.stay_policy_versions p WHERE p.id = v_line.policy_version_id AND p.effective_to IS NULL) THEN
    RAISE EXCEPTION 'offer_changed' USING ERRCODE = 'PT409';
  END IF;
  SELECT * INTO v_window FROM public.stay_place_windows WHERE id = v_line.place_window_id FOR UPDATE;
  IF v_window.stop_sell OR now() >= public.issue_4490_window_cutoff(v_offer.id, v_window.id) THEN
    RAISE EXCEPTION 'offer_window_unavailable' USING ERRCODE = 'PT409';
  END IF;
  v_settings := public.issue_4490_ensure_booking_settings(v_offer.venue_id);
  IF v_settings.booking_state <> 'active' THEN
    RAISE EXCEPTION 'offer_day_closed' USING ERRCODE = 'PT409';
  END IF;
  IF NOT public.pg_brand_can_collect(v_quote.brand_id)
     OR NOT EXISTS (SELECT 1 FROM public.brands b WHERE b.id = v_quote.brand_id
                    AND upper(b.default_currency) = v_quote.currency_code) THEN
    RAISE EXCEPTION 'offer_bank_not_ready' USING ERRCODE = 'P0001';
  END IF;
  v_request := v_quote.mode = 'request';
  v_spaces := ARRAY(SELECT jsonb_array_elements_text(v_line.inventory_snapshot->'spaceIds')::uuid);
  SELECT tstzrange((v_line.inventory_snapshot->>'bookedFrom')::timestamptz, (v_line.inventory_snapshot->>'bookedTo')::timestamptz, '[)') AS booked,
         tstzrange((v_line.inventory_snapshot->>'claimFrom')::timestamptz, (v_line.inventory_snapshot->>'claimTo')::timestamptz, '[)') AS claim
  INTO v_ranges;
  SELECT * INTO v_state FROM public.issue_4490_spaces_status(v_spaces, v_ranges.claim, NULL);
  -- #4490 P5: a by-the-hour unit taken since the quote: another free unit
  -- is claimed below (any one of), so only a hire is refused here.
  IF v_offer.kind = 'private_hire' AND (v_state.status = 'taken' OR (v_state.status = 'held' AND NOT v_request)) THEN
    RAISE EXCEPTION 'offer_space_taken' USING ERRCODE = 'PT409';
  END IF;

  v_policy := v_line.policy_snapshot;
  SELECT COALESCE(sum(f.amount_minor), 0) INTO v_damage FROM public.stay_quote_fee_lines f
  WHERE f.quote_id = v_quote.id AND f.snapshot->>'fee_key' = 'damage_deposit';
  -- The deposit is worked out on the total less the refundable damage deposit
  -- (collected with the balance).
  v_plan := public.issue_4490_deposit_plan(v_offer.id, v_window.id, v_quote.total_minor - v_damage);
  IF v_request THEN
    v_deadline := LEAST(now() + make_interval(hours => v_settings.request_response_hours), v_window.starts_at);
    v_hold_expires := v_deadline;
  ELSE
    v_hold_expires := now() + make_interval(mins => v_settings.instant_payment_hold_minutes);
  END IF;
  INSERT INTO public.stay_reservation_groups (
    id, public_reference, quote_id, user_id, actor_key_hash, venue_id, brand_id, currency_code,
    mode, state, request_deadline, payment_deadline, guest_snapshot,
    source_subtotal_minor, fee_total_minor, tax_total_minor, total_minor,
    idempotency_key, request_hash, offer_kind, buyer_token_hash, payment_plan_snapshot,
    booking_source, payment_collection, created_by_staff_user_id,
    deposit_minor, balance_due_at, booking_answers
  ) VALUES (
    p_group_id,
    'VB-' || upper(substr(replace(p_group_id::text, '-', ''), 1, 20)),
    v_quote.id, p_user_id, p_actor_key, v_quote.venue_id, v_quote.brand_id, v_quote.currency_code,
    v_quote.mode, CASE WHEN v_request THEN 'request_pending' ELSE 'instant_payment_pending' END,
    v_deadline, NULL,
    jsonb_strip_nulls(jsonb_build_object(
      'name', btrim(p_guest->>'name'),
      'email', NULLIF(lower(btrim(COALESCE(p_guest->>'email', ''))), ''),
      'phone', NULLIF(btrim(COALESCE(p_guest->>'phone', '')), ''),
      'phoneCountryIso', NULLIF(p_guest->>'phoneCountryIso', ''))),
    v_quote.source_subtotal_minor, v_quote.fee_total_minor, v_quote.tax_total_minor, v_quote.total_minor,
    btrim(p_idempotency_key), v_request_hash, v_offer.kind, p_buyer_token_hash,
    jsonb_build_object(
      'stagePlan', CASE WHEN v_plan->>'depositMinor' IS NOT NULL THEN 'deposit_or_full' ELSE 'full' END,
      'depositKind', COALESCE(v_plan->>'depositKind', 'none'),
      'depositValue', (v_plan->>'depositValue')::bigint,
      'depositMinor', (v_plan->>'depositMinor')::bigint,
      'balanceDueAt', v_plan->>'balanceDueAt',
      'payModes', v_plan->'payModes',
      'currencyCode', v_quote.currency_code,
      'vatMode', v_settings.vat_mode,
      'refundLadder', COALESCE(v_policy->'refund_ladder', '[]'::jsonb),
      'dateChangeRule', COALESCE(v_policy->'date_change_rule', '{}'::jsonb),
      'policyText', v_policy->>'cancellation_policy',
      'operatorCancelRefundBps', (v_policy->>'operator_cancel_refund_basis_points')::integer,
      'damageDepositMinor', v_damage,
      'minSpendMinor', v_offer.min_spend_minor,
      'hireCharge', COALESCE(v_offer.hire_charge, 'hire_fee'),
      'setupMinutes', v_offer.buffer_before_minutes,
      'cleanupMinutes', v_offer.buffer_after_minutes,
      'requestResponseHours', v_settings.request_response_hours,
      'approvedPaymentMinutes', v_settings.approved_payment_minutes,
      'localDate', v_window.local_date),
    'guest', 'mingla', NULL,
    (v_plan->>'depositMinor')::bigint,
    (v_plan->>'balanceDueAt')::timestamptz,
    COALESCE(v_line.price_snapshot->'answers', '{}'::jsonb)
  );
  INSERT INTO public.stay_reservation_lines (
    id, group_id, quote_line_id, offering_id, kind, state, place_window_id, place_units, place_guests,
    adults, children, base_minor, fee_minor, tax_minor, total_minor,
    offering_snapshot, price_snapshot, policy_snapshot, price_option_id, booked_minutes
  )
  SELECT gen_random_uuid(), p_group_id, l.id, l.offering_id, l.kind,
         CASE WHEN v_request THEN 'request_pending' ELSE 'payment_pending' END, l.place_window_id,
         l.place_units, l.place_guests, 0, 0, l.base_minor, l.fee_minor, l.tax_minor, l.total_minor,
         l.offering_snapshot, l.price_snapshot, l.policy_snapshot, l.price_option_id, l.booked_minutes
  FROM public.stay_quote_lines l WHERE l.id = v_line.id
  RETURNING id INTO v_line_id;
  INSERT INTO public.stay_inventory_holds (id, group_id, state, expires_at, reason)
  VALUES (v_hold_id, p_group_id, 'active', v_hold_expires, CASE WHEN v_request THEN 'request' ELSE 'instant_payment' END);
  IF NOT v_request THEN
    INSERT INTO public.stay_inventory_hold_slices (
      hold_id, reservation_line_id, resource_type, offering_id, place_window_id, quantity
    ) VALUES (v_hold_id, v_line_id, 'place_window', v_offer.id, v_window.id, v_line.place_guests);
    IF v_offer.kind = 'by_the_hour' THEN
      PERFORM public.issue_4490_claim_hour_unit(p_group_id, v_line_id, v_hold_id, v_offer.id, v_spaces,
        v_ranges.booked, v_ranges.claim, v_hold_expires);
    ELSE
      PERFORM public.issue_4490_claim_spaces(p_group_id, v_line_id, v_hold_id, v_spaces,
        (v_line.inventory_snapshot->>'combinationId')::uuid, v_ranges.booked, v_ranges.claim, v_hold_expires);
      PERFORM public.issue_4490_assert_hire_capacity(v_offer.venue_id, v_spaces, v_ranges.booked);
    END IF;
  END IF;
  UPDATE public.stay_quotes SET status = 'consumed', consumed_at = now(), version = version + 1
  WHERE id = v_quote.id;
  INSERT INTO public.stay_reservation_events (
    group_id, event_type, actor_type, actor_user_id, idempotency_key, safe_metadata
  ) VALUES (
    p_group_id, CASE WHEN v_request THEN 'stay_offer_request_sent' ELSE 'stay_offer_hold_created' END,
    'guest', p_user_id, 'offer-hold:' || btrim(p_idempotency_key),
    jsonb_build_object('holdExpiresAt', v_hold_expires, 'guests', v_line.price_snapshot->'guests',
      'localDate', v_window.local_date, 'placeName', v_line.price_snapshot->>'placeName')
  );
  RETURN p_group_id;
END;
$function$;


-- sweep: P5 no-show release (from 20281203154490_issue_4490_p4_private_hire.sql)
CREATE OR REPLACE FUNCTION public.issue_4490_offer_sweep(p_limit integer DEFAULT 200)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 200), 1), 1000);
  v_expired jsonb;
  v_row record;
  v_reminders integer := 0;
  v_overdue integer := 0;
  v_expiring integer := 0;
  v_lapsed integer := 0;
  v_day integer;
  v_inserted integer;
  v_released integer := 0;
BEGIN
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  -- Lapsed holds: the generic Stays expiry (offer groups included).
  v_expired := to_jsonb(public.issue_1388_expire_groups(v_limit, gen_random_uuid()));
  UPDATE public.venue_space_claims
  SET state = 'released', held_until = NULL, released_at = now(), release_reason = 'hold_lapsed', updated_at = now()
  WHERE state = 'held' AND held_until <= now();
  GET DIAGNOSTICS v_lapsed = ROW_COUNT;

  FOR v_row IN
    SELECT g.id, g.payment_deadline, g.currency_code
    FROM public.stay_reservation_groups g
    WHERE g.offer_kind IS NOT NULL
      AND g.state = 'approved_payment_required'
      AND g.payment_deadline > now()
      AND g.payment_deadline <= now() + interval '12 hours'
    ORDER BY g.payment_deadline
    LIMIT v_limit
    FOR UPDATE OF g SKIP LOCKED
  LOOP
    INSERT INTO public.stay_reservation_events (
      group_id, event_type, actor_type, idempotency_key, safe_metadata
    ) VALUES (
      v_row.id, 'stay_offer_hold_expiring', 'service',
      'hold-expiring:' || v_row.id || ':' || floor(extract(epoch FROM v_row.payment_deadline))::bigint,
      jsonb_build_object('holdUntil', v_row.payment_deadline, 'reason', 'hold_expiring')
    ) ON CONFLICT (group_id, idempotency_key) DO NOTHING;
    GET DIAGNOSTICS v_inserted = ROW_COUNT;
    v_expiring := v_expiring + v_inserted;
  END LOOP;

  FOR v_row IN
    SELECT g.id, g.balance_due_at, g.created_at, g.currency_code, g.venue_id,
           COALESCE(s.balance_reminder_days, '{7,1}'::smallint[]) AS days, m.balance
    FROM public.stay_reservation_groups g
    LEFT JOIN public.venue_booking_settings s ON s.venue_id = g.venue_id
    CROSS JOIN LATERAL public.issue_4490_booking_money(g.id) m
    WHERE g.offer_kind IS NOT NULL
      AND g.state = 'confirmed'
      AND g.balance_due_at IS NOT NULL
      AND g.balance_due_at <= now() + interval '60 days'
      AND g.balance_due_at >= now() - interval '4 days'
      AND m.balance > 0
    ORDER BY g.balance_due_at
    LIMIT v_limit
    FOR UPDATE OF g SKIP LOCKED
  LOOP
    IF now() < v_row.balance_due_at THEN
      SELECT min(d) INTO v_day FROM unnest(v_row.days) d
      WHERE d > 0
        AND now() >= v_row.balance_due_at - make_interval(days => d)
        AND v_row.created_at <= v_row.balance_due_at - make_interval(days => d);
      IF v_day IS NOT NULL THEN
        INSERT INTO public.stay_reservation_events (
          group_id, event_type, actor_type, idempotency_key, safe_metadata
        ) VALUES (
          v_row.id, 'stay_offer_balance_due', 'service', 'balance-reminder:' || v_row.id || ':' || v_day,
          jsonb_build_object('amountMinor', v_row.balance::text, 'currencyCode', v_row.currency_code,
            'balanceDueAt', v_row.balance_due_at, 'reason', 'reminder', 'daysBefore', v_day)
        ) ON CONFLICT (group_id, idempotency_key) DO NOTHING;
        GET DIAGNOSTICS v_inserted = ROW_COUNT;
        v_reminders := v_reminders + v_inserted;
      END IF;
    ELSE
      v_day := CASE WHEN now() >= v_row.balance_due_at + interval '3 days' THEN 3 ELSE 0 END;
      INSERT INTO public.stay_reservation_events (
        group_id, event_type, actor_type, idempotency_key, safe_metadata
      ) VALUES (
        v_row.id, 'stay_offer_balance_overdue', 'service', 'balance-overdue:' || v_row.id || ':' || v_day,
        jsonb_build_object('amountMinor', v_row.balance::text, 'currencyCode', v_row.currency_code,
          'balanceDueAt', v_row.balance_due_at, 'reason', 'overdue', 'daysAfter', v_day)
      ) ON CONFLICT (group_id, idempotency_key) DO NOTHING;
      GET DIAGNOSTICS v_inserted = ROW_COUNT;
      v_overdue := v_overdue + v_inserted;
    END IF;
  END LOOP;
  -- #4490 P5: by the hour: release a booking nobody checked in for N minutes
  -- after its start (the place frees; no refund unless the policy gives one).
  FOR v_row IN
    SELECT g.id, w.starts_at, o.no_show_release_minutes AS release_minutes
    FROM public.stay_reservation_groups g
    JOIN LATERAL (SELECT l.* FROM public.stay_reservation_lines l WHERE l.group_id = g.id
                  ORDER BY l.created_at, l.id LIMIT 1) l ON true
    JOIN public.stay_offerings o ON o.id = l.offering_id
    JOIN public.stay_place_windows w ON w.id = public.issue_4490_line_window_id(l.id)
    JOIN public.venue_passes p ON p.group_id = g.id
    WHERE g.offer_kind = 'by_the_hour' AND g.state = 'confirmed'
      AND o.no_show_release_minutes IS NOT NULL
      AND p.status = 'valid' AND p.admitted_count = 0
      AND now() >= w.starts_at + make_interval(mins => o.no_show_release_minutes)
      AND EXISTS (SELECT 1 FROM public.stay_inventory_commitments c WHERE c.group_id = g.id AND c.state = 'active')
    ORDER BY w.starts_at
    LIMIT v_limit
    FOR UPDATE OF g SKIP LOCKED
  LOOP
    UPDATE public.stay_inventory_commitments
    SET state = 'released', released_at = now(), release_reason = 'no_show'
    WHERE group_id = v_row.id AND state = 'active';
    UPDATE public.venue_passes SET status = 'void', version = version + 1, updated_at = now()
    WHERE group_id = v_row.id AND status = 'valid';
    INSERT INTO public.stay_reservation_events (
      group_id, event_type, actor_type, idempotency_key, safe_metadata
    ) VALUES (
      v_row.id, 'stay_offer_no_show_released', 'service', 'no-show-release:' || v_row.id,
      jsonb_build_object('startsAt', v_row.starts_at, 'releaseMinutes', v_row.release_minutes)
    ) ON CONFLICT (group_id, idempotency_key) DO NOTHING;
    v_released := v_released + 1;
  END LOOP;
  RETURN jsonb_build_object('expired', v_expired, 'reminders', v_reminders, 'overdue', v_overdue,
    'holdExpiring', v_expiring, 'lapsedClaims', v_lapsed, 'noShowReleased', v_released);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 16. Grants. New functions: nobody by default; the guest's table map and
--     day line are public like availability; Host table / floor / by-the-hour
--     authoring and reads to authenticated (each checks its own authority);
--     the guest waitlist and the flexible-window / table-terms helpers to the
--     service role only (edge functions authenticate the caller).
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION
  public.issue_4490_assert_table_space(),
  public.issue_4490_assert_table_join(),
  public.issue_4490_prune_table_joins(),
  public.issue_4490_hour_default_mode(),
  public.issue_4490_feature_setting_on(uuid, text, text),
  public.issue_4490_table_slot_occupancy(uuid, timestamptz, integer, uuid, uuid),
  public.issue_4490_tables_could_seat(uuid, integer, uuid),
  public.issue_4490_table_party_max(uuid),
  public.pg_venue_available_tables(uuid, date, integer, timestamptz, uuid),
  public.issue_4490_table_pick_terms(uuid, uuid[], integer),
  public.issue_4490_resolve_table_pick(uuid, timestamptz, integer, uuid[], uuid, uuid, boolean),
  public.issue_4490_can_manage_tables(uuid),
  public.issue_4490_table_projection(uuid),
  public.issue_4490_manage_table(text, uuid, jsonb, text),
  public.issue_4490_save_floor_plan(uuid, uuid, jsonb, bigint, text),
  public.issue_4490_arrange_spaces(uuid, jsonb, text),
  public.issue_4490_floor_plan(uuid, uuid, timestamptz),
  public.issue_4490_suggest_tables(uuid, timestamptz, integer, uuid, uuid),
  public.issue_4490_assign_table(uuid, uuid[], bigint),
  public.issue_4490_public_tables(uuid, text[]),
  public.issue_4490_waitlist_position(uuid),
  public.issue_4490_waitlist_projection(uuid),
  public.pg_join_venue_waitlist(uuid, integer, date, time, time, jsonb, bytea, uuid),
  public.issue_4490_waitlist_actor_ok(public.venue_waitlist, bytea, uuid),
  public.pg_get_venue_waitlist_entry(uuid, bytea, uuid),
  public.pg_leave_venue_waitlist(uuid, bytea, uuid),
  public.issue_4490_enqueue_waitlist_message(uuid, text),
  public.issue_4490_on_waitlist_notified(),
  public.issue_4490_on_table_opened(),
  public.issue_4490_window_is_flexible(uuid),
  public.issue_4490_flex_places(uuid, integer, uuid),
  public.issue_4490_flex_starts(uuid, uuid, integer, uuid, uuid),
  public.pg_venue_hour_day(uuid, date, integer, uuid),
  public.issue_4490_flexible_window(uuid, timestamptz, integer),
  public.issue_4490_flex_day_summary(uuid, uuid, integer, uuid),
  public.issue_4490_claim_hour_unit(uuid, uuid, uuid, uuid, uuid[], tstzrange, tstzrange, timestamptz),
  public.issue_4490_manage_hour(text, uuid, jsonb, bigint, text),
  public.issue_4490_hour_projection(uuid),
  public.issue_4490_hour_booking_facts(uuid),
  public.issue_4490_quote_hour_internal(uuid, uuid, jsonb, text, uuid, text, jsonb)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
  public.pg_venue_available_tables(uuid, date, integer, timestamptz, uuid),
  public.pg_venue_hour_day(uuid, date, integer, uuid)
TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION
  public.issue_4490_manage_table(text, uuid, jsonb, text),
  public.issue_4490_save_floor_plan(uuid, uuid, jsonb, bigint, text),
  public.issue_4490_arrange_spaces(uuid, jsonb, text),
  public.issue_4490_floor_plan(uuid, uuid, timestamptz),
  public.issue_4490_suggest_tables(uuid, timestamptz, integer, uuid, uuid),
  public.issue_4490_assign_table(uuid, uuid[], bigint),
  public.issue_4490_manage_hour(text, uuid, jsonb, bigint, text)
TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION
  public.issue_4490_table_party_max(uuid),
  public.issue_4490_table_pick_terms(uuid, uuid[], integer),
  public.issue_4490_table_slot_occupancy(uuid, timestamptz, integer, uuid, uuid),
  public.pg_join_venue_waitlist(uuid, integer, date, time, time, jsonb, bytea, uuid),
  public.pg_get_venue_waitlist_entry(uuid, bytea, uuid),
  public.pg_leave_venue_waitlist(uuid, bytea, uuid),
  public.issue_4490_flexible_window(uuid, timestamptz, integer),
  public.issue_4490_hour_projection(uuid),
  public.issue_4490_hour_booking_facts(uuid)
TO service_role;

COMMIT;
