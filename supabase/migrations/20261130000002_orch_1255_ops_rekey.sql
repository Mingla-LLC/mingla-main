-- ===========================================================================
-- META-ORCH-1255 [multi-venue first-class creation] — M3: per-venue ops re-key
-- + engine RPC venue signatures
-- ---------------------------------------------------------------------------
-- SPEC §4.A.4 (binding, commit b236bfaf9). Seth decision D-3: FULL per-venue
-- ops — reservation settings, tables, waitlist, hours. NO shared inventory
-- survives: every ops row carries venue_id NOT NULL matching its brand's venue
-- (I-PROPOSED-1255-PER-VENUE-OPS-NO-SHARED-INVENTORY).
--
-- RLS on ops tables: UNCHANGED. Every policy stays keyed on brand_id
-- (biz_is_brand_member_for_read_for_caller / rank >= event_manager — verbatim
-- 1148 predicates). Venue scoping is DATA-shape (venue_id NOT NULL + the M1
-- brand-match trigger), not privilege-shape: the brand's ONE team manages all
-- its venues (D-1). RETURNING-OWNER-GAP: ops tables allow client
-- INSERT…RETURNING (FOR ALL policies); writer rank (>= event_manager) strictly
-- implies the member-read predicate, so RETURNING always passes the SELECT
-- policy — probed by orch_1255_ops_venue_not_null.test.sql (T-A6).
--
-- Engine RPCs: each re-stated from its LATEST live definition (named source in
-- each block) changing ONLY the venue-scope resolution. brand_id is DERIVED
-- from the venue row wherever payments/currency/ownership need it (D-1: one
-- brand, one Stripe account — resolve_brand_pricing_inputs(p_brand_id) is
-- UNTOUCHED). Old signatures are DROPped in this migration (PostgREST
-- named-arg calls would otherwise be ambiguous).
--
-- [TRANSITIONAL-1] single-venue compat shim (consumer OTA frozen; shipped
-- consumer binaries call pg_venue_available_slots with p_brand_id):
-- implemented as ONE function with BOTH named optional params — a literal
-- second overload pg_venue_available_slots(p_brand_id uuid, date, int) is
-- IMPOSSIBLE in Postgres (function identity = name + arg TYPES; the two
-- "overloads" the spec names have identical types). The single function
-- preserves BOTH PostgREST call shapes: {p_venue_id,p_date,p_party_size} and
-- legacy {p_brand_id,p_date,p_party_size}. Legacy resolution: the brand's
-- venue IFF the brand has exactly one venue row, else ZERO rows (fail-soft
-- empty slot list — no crash, no dead 500).
-- Exit condition: next consumer native build ships + OTA freeze lifts → drop
-- the p_brand_id param + legacy body path in a follow-on migration.
--
-- Assert-empty guards: remote read-only probe 2026-07-02 (MCP execute_sql):
-- venue_reservation_settings=0, venue_tables=0, venue_capacity_rules=0,
-- venue_availability_config=0, venue_blackouts=0, venue_waitlist=0,
-- reservations=0, brand_hours=0, reservation_checkout_sessions=0 (F-8; brands
-- were wiped 2026-06-22 with CASCADE). brand_hours is NOT asserted-empty —
-- its venue_id stays NULLABLE and legacy brand-keyed rows keep their old
-- uniqueness via a partial index (additive-safe with data present).
--
-- Apply via the Supabase Management API from MERGED main at CLOSE.
-- ===========================================================================

BEGIN;

-- Assert-empty guards (F-8; fail LOUD if drifted).
DO $$ BEGIN
  IF (SELECT count(*) FROM public.venue_reservation_settings) > 0
  THEN RAISE EXCEPTION 'orch1255_precondition: venue_reservation_settings rows exist — re-run F-8 audit'; END IF;
  IF (SELECT count(*) FROM public.venue_tables) > 0
  THEN RAISE EXCEPTION 'orch1255_precondition: venue_tables rows exist — re-run F-8 audit'; END IF;
  IF (SELECT count(*) FROM public.venue_capacity_rules) > 0
  THEN RAISE EXCEPTION 'orch1255_precondition: venue_capacity_rules rows exist — re-run F-8 audit'; END IF;
  IF (SELECT count(*) FROM public.venue_availability_config) > 0
  THEN RAISE EXCEPTION 'orch1255_precondition: venue_availability_config rows exist — re-run F-8 audit'; END IF;
  IF (SELECT count(*) FROM public.venue_blackouts) > 0
  THEN RAISE EXCEPTION 'orch1255_precondition: venue_blackouts rows exist — re-run F-8 audit'; END IF;
  IF (SELECT count(*) FROM public.venue_waitlist) > 0
  THEN RAISE EXCEPTION 'orch1255_precondition: venue_waitlist rows exist — re-run F-8 audit'; END IF;
  IF (SELECT count(*) FROM public.reservations) > 0
  THEN RAISE EXCEPTION 'orch1255_precondition: reservations rows exist — re-run F-8 audit'; END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. HOURS — brand_hours stays the single owner (1186-A contract), now
--    venue-scoped rows. venue_id NULLABLE: legacy brand-only rows keep the old
--    per-brand uniqueness via the partial index; venue rows are unique per
--    (venue_id, weekday).
-- ---------------------------------------------------------------------------
ALTER TABLE public.brand_hours
  ADD COLUMN IF NOT EXISTS venue_id uuid REFERENCES public.venue_listings(id) ON DELETE CASCADE;
ALTER TABLE public.brand_hours DROP CONSTRAINT IF EXISTS brand_hours_brand_weekday_uniq;
CREATE UNIQUE INDEX IF NOT EXISTS brand_hours_venue_weekday_uniq
  ON public.brand_hours (venue_id, weekday) WHERE venue_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS brand_hours_legacy_brand_weekday_uniq
  ON public.brand_hours (brand_id, weekday) WHERE venue_id IS NULL;   -- legacy NULL rows keep old shape

-- ---------------------------------------------------------------------------
-- 2. RESERVATION SETTINGS — PK moves brand → venue (assert-empty makes this
--    safe). brand_id loses PK but stays NOT NULL (RLS keying). The enabled
--    partial index is re-created on (venue_id).
-- ---------------------------------------------------------------------------
ALTER TABLE public.venue_reservation_settings
  ADD COLUMN IF NOT EXISTS venue_id uuid REFERENCES public.venue_listings(id) ON DELETE CASCADE;
ALTER TABLE public.venue_reservation_settings ALTER COLUMN venue_id SET NOT NULL;
ALTER TABLE public.venue_reservation_settings DROP CONSTRAINT venue_reservation_settings_pkey;
ALTER TABLE public.venue_reservation_settings ADD PRIMARY KEY (venue_id);
DROP INDEX IF EXISTS public.venue_reservation_settings_enabled_idx;
CREATE INDEX IF NOT EXISTS venue_reservation_settings_enabled_idx
  ON public.venue_reservation_settings (venue_id) WHERE reservations_enabled;

-- ---------------------------------------------------------------------------
-- 3. TABLES / CAPACITY / AVAILABILITY / BLACKOUTS / WAITLIST / RESERVATIONS —
--    venue_id NOT NULL + venue-scoped variants of the existing hot indexes.
-- ---------------------------------------------------------------------------
ALTER TABLE public.venue_tables
  ADD COLUMN IF NOT EXISTS venue_id uuid REFERENCES public.venue_listings(id) ON DELETE CASCADE;
ALTER TABLE public.venue_tables ALTER COLUMN venue_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS venue_tables_venue_idx ON public.venue_tables (venue_id);
CREATE INDEX IF NOT EXISTS venue_tables_venue_active_idx
  ON public.venue_tables (venue_id) WHERE is_active AND deleted_at IS NULL;

ALTER TABLE public.venue_capacity_rules
  ADD COLUMN IF NOT EXISTS venue_id uuid REFERENCES public.venue_listings(id) ON DELETE CASCADE;
ALTER TABLE public.venue_capacity_rules ALTER COLUMN venue_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS venue_capacity_rules_venue_idx ON public.venue_capacity_rules (venue_id);
CREATE INDEX IF NOT EXISTS venue_capacity_rules_venue_active_idx
  ON public.venue_capacity_rules (venue_id) WHERE is_active;

ALTER TABLE public.venue_availability_config
  ADD COLUMN IF NOT EXISTS venue_id uuid REFERENCES public.venue_listings(id) ON DELETE CASCADE;
ALTER TABLE public.venue_availability_config ALTER COLUMN venue_id SET NOT NULL;
ALTER TABLE public.venue_availability_config
  DROP CONSTRAINT IF EXISTS venue_availability_config_brand_id_key;
ALTER TABLE public.venue_availability_config
  ADD CONSTRAINT venue_availability_config_venue_id_key UNIQUE (venue_id);
CREATE INDEX IF NOT EXISTS venue_availability_config_venue_idx
  ON public.venue_availability_config (venue_id);

ALTER TABLE public.venue_blackouts
  ADD COLUMN IF NOT EXISTS venue_id uuid REFERENCES public.venue_listings(id) ON DELETE CASCADE;
ALTER TABLE public.venue_blackouts ALTER COLUMN venue_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS venue_blackouts_venue_idx ON public.venue_blackouts (venue_id);
CREATE INDEX IF NOT EXISTS venue_blackouts_venue_dates_idx
  ON public.venue_blackouts (venue_id, date_start, date_end);

ALTER TABLE public.venue_waitlist
  ADD COLUMN IF NOT EXISTS venue_id uuid REFERENCES public.venue_listings(id) ON DELETE CASCADE;
ALTER TABLE public.venue_waitlist ALTER COLUMN venue_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS venue_waitlist_venue_queue_idx
  ON public.venue_waitlist (venue_id, status, created_at);
CREATE INDEX IF NOT EXISTS venue_waitlist_venue_active_idx
  ON public.venue_waitlist (venue_id, created_at)
  WHERE status IN ('waiting','notified');

ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS venue_id uuid REFERENCES public.venue_listings(id) ON DELETE CASCADE;
ALTER TABLE public.reservations ALTER COLUMN venue_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS reservations_venue_reserved_for_idx
  ON public.reservations (venue_id, reserved_for);
CREATE INDEX IF NOT EXISTS reservations_venue_status_idx
  ON public.reservations (venue_id, status);
CREATE INDEX IF NOT EXISTS reservations_venue_status_reserved_idx
  ON public.reservations (venue_id, status, reserved_for);

-- reservation_checkout_sessions: NULLABLE venue_id carrier so the idempotent
-- fee finalize (pg_finalize_guest_reservation) can mint the reservation
-- venue-keyed. NOT in the spec's 8-table list, but required for correctness:
-- without it a 2-venue brand's FEE reservation would charge and then fail (or
-- mis-key) at finalize. NULLABLE (legacy in-flight sessions; the finalize
-- falls back to the [TRANSITIONAL-1] single-venue resolution when NULL).
-- Deviation documented in IMPLEMENTATION_META-ORCH-1255_LEG_A.md.
ALTER TABLE public.reservation_checkout_sessions
  ADD COLUMN IF NOT EXISTS venue_id uuid REFERENCES public.venue_listings(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- 4. Attach the M1 brand-match integrity trigger to every (brand_id, venue_id)
--    table (T-A4: brand-X manager pointing a row at brand-Y's venue must get
--    'venue_brand_mismatch').
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'brand_hours',
    'venue_reservation_settings',
    'venue_tables',
    'venue_capacity_rules',
    'venue_availability_config',
    'venue_blackouts',
    'venue_waitlist',
    'reservations',
    'reservation_checkout_sessions'
  ] LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_orch1255_%I_venue_brand_match ON public.%I', t, t);
    EXECUTE format(
      'CREATE TRIGGER trg_orch1255_%I_venue_brand_match
         BEFORE INSERT OR UPDATE ON public.%I
         FOR EACH ROW EXECUTE FUNCTION public._orch1255_venue_belongs_to_brand()', t, t);
  END LOOP;
END $$;

-- ===========================================================================
-- 5. ENGINE / OPS RPC RE-KEYS. Each re-stated VERBATIM from its latest live
--    definition, changing ONLY the venue-scope resolution.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 5a. biz_derive_service_periods_from_brand_hours — re-keyed PER VENUE
--     (re-stated from 20261116000000 ORCH-1186-A; DEC-B contract preserved:
--     single producer of type:"derived_from_hours"; weekday remap (w+1)%7;
--     non-clobber; idempotent). Old brand-keyed signature DROPped (identical
--     arg types — param rename requires DROP).
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.biz_derive_service_periods_from_brand_hours(uuid);

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
  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'name', 'Open',
        'days', jsonb_build_array(((h.weekday + 1) % 7)),
        'start', to_char(h.open_time, 'HH24:MI'),
        'end', to_char(h.close_time, 'HH24:MI'),
        'type', 'derived_from_hours'
      )
      ORDER BY ((h.weekday + 1) % 7)
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

COMMENT ON FUNCTION public.biz_derive_service_periods_from_brand_hours IS
  'ORCH-1186-A DEC-B re-keyed by META-ORCH-1255 M3: the SINGLE producer of '
  'reservation baseline service periods, now PER VENUE. Derives '
  'venue_availability_config.service_periods (keyed venue_id) from the venue''s '
  'brand_hours rows, remapping weekday (Mon=0..Sun=6) to Postgres dow via '
  '(weekday+1)%7. Non-clobber + idempotent. Called ONLY from '
  'biz_create_venue_listing + biz_upsert_brand_hours.';

-- ---------------------------------------------------------------------------
-- 5b. biz_upsert_brand_hours — venue-keyed (re-stated from 20261116000000;
--     the ONLY change is the venue scope: rows are the venue's, ownership is
--     the DERIVED brand's admin-plus rank, and the bridge PERFORM is
--     venue-keyed). Old brand-keyed signature DROPped (identical arg types).
--     Required cascade of the D-3 hours re-key: a brand-keyed hours upsert is
--     wrong the moment a brand has 2 venues.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.biz_upsert_brand_hours(uuid, jsonb);

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
-- 5c. pg_venue_available_slots — ENGINE v4 (re-stated from the v3 body,
--     20261013000002, byte-faithful except the venue-scope keying). ONE
--     function serving BOTH call shapes (see [TRANSITIONAL-1] header note):
--       new:    { p_venue_id, p_date, p_party_size }
--       legacy: { p_brand_id, p_date, p_party_size } → the brand's venue IFF
--               exactly one venue row exists, else ZERO rows (fail-soft).
--     Old (uuid, date, int) signature DROPped. Anon EXECUTE re-granted (the
--     2.2 consumer keystone grant, 20261012000000, must survive the DROP).
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.pg_venue_available_slots(uuid, date, int);

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

  RETURN QUERY
  WITH periods AS (
    SELECT
      pr.value->>'start' AS p_start,
      pr.value->>'end'   AS p_end
    FROM jsonb_array_elements(COALESCE(v_cfg.service_periods, '[]'::jsonb)) AS pr(value)
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

-- Grants: the DROP killed the old grants. Re-establish the live posture:
-- REVOKE PUBLIC; anon EXECUTE (2.2 consumer keystone grant, 20261012000000);
-- authenticated; service_role.
REVOKE ALL ON FUNCTION public.pg_venue_available_slots(date, int, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pg_venue_available_slots(date, int, uuid, uuid)
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.pg_venue_available_slots(date, int, uuid, uuid) IS
  'META-ORCH-1255 M3 engine v4: venue-keyed availability. New callers pass '
  'p_venue_id; [TRANSITIONAL-1] legacy consumer binaries pass p_brand_id which '
  'resolves IFF the brand has exactly one venue, else zero rows (fail-soft). '
  'Exit: next consumer native build + OTA unfreeze → drop p_brand_id. Body is '
  'the 20261013000002 v3 engine with brand_id→venue_id keying only.';

-- ---------------------------------------------------------------------------
-- 5c-note. pg_venue_turn_minutes_for_party is UNTOUCHED — it is a pure
-- function of (turn_times jsonb, party_size int) with NO brand/venue key to
-- re-key (SPEC §4.A.4 listed it; deviation documented in the implementation
-- report).
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 5d. biz_reservation_create — venue-keyed (re-stated from 20261011000000;
--     rank gate on the DERIVED brand; the D-1 table guard is now VENUE-scoped
--     — a same-brand OTHER-venue table is also a splice). Old signature DROPped.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.biz_reservation_create(uuid, timestamptz, int, text, text, text, text, uuid, text, text, text[], text);

CREATE OR REPLACE FUNCTION public.biz_reservation_create(
  p_venue_id uuid,
  p_reserved_for timestamptz,
  p_party_size int,
  p_source text DEFAULT 'phone',
  p_guest_name text DEFAULT NULL,
  p_guest_phone_e164 text DEFAULT NULL,
  p_guest_email text DEFAULT NULL,
  p_table_id uuid DEFAULT NULL,
  p_occasion text DEFAULT NULL,
  p_guest_notes text DEFAULT NULL,
  p_tags text[] DEFAULT '{}'::text[],
  p_status text DEFAULT 'confirmed'
) RETURNS public.reservations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_row public.reservations;
  v_brand uuid;
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT v.brand_id INTO v_brand
  FROM public.venue_listings v
  WHERE v.id = p_venue_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'venue_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- Ownership: SAME rank helper, against the DERIVED brand (D-1: one team).
  -- Re-asserted BEFORE the INSERT so the SECURITY DEFINER RETURNING cannot
  -- leak another brand's row (RLS-RETURNING-OWNER-GAP note, SPEC §4.A.4).
  IF public.biz_brand_effective_rank_for_caller(v_brand)
       < public.biz_role_rank('event_manager') THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  -- A manual booking starts in a non-terminal, sensible state only.
  IF p_status NOT IN ('requested','confirmed','seated') THEN
    RAISE EXCEPTION 'invalid_initial_status_%', p_status USING ERRCODE = '23514';
  END IF;
  IF p_source NOT IN ('mingla','phone','walk_in','website','instagram') THEN
    RAISE EXCEPTION 'invalid_source_%', p_source USING ERRCODE = '23514';
  END IF;

  -- D-1 guard, now VENUE-scoped: an assigned table MUST belong to the SAME
  -- venue as the reservation being created. NULL p_table_id is allowed.
  -- (Error literal kept as table_brand_mismatch — same cross-tenant-splice
  -- class the clients already map; it now also fires for a same-brand
  -- OTHER-venue table.)
  IF p_table_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.venue_tables
        WHERE id = p_table_id AND venue_id = p_venue_id
     ) THEN
    RAISE EXCEPTION 'table_brand_mismatch: table % does not belong to venue %',
      p_table_id, p_venue_id USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.reservations (
    brand_id, venue_id, reserved_for, party_size, status, source, created_via,
    guest_name, guest_phone_e164, guest_email, table_id, occasion,
    guest_notes, tags
  ) VALUES (
    v_brand, p_venue_id, p_reserved_for, p_party_size, p_status, p_source, 'operator',
    p_guest_name, p_guest_phone_e164, p_guest_email, p_table_id, p_occasion,
    p_guest_notes, COALESCE(p_tags, '{}'::text[])
  ) RETURNING * INTO v_row;

  INSERT INTO public.audit_log (
    user_id, brand_id, action, target_type, target_id, after
  ) VALUES (
    v_uid, v_brand,
    'venue_reservation.create',
    'reservation', v_row.id::text,
    jsonb_build_object(
      'source', p_source, 'party_size', p_party_size,
      'reserved_for', p_reserved_for, 'status', p_status, 'created_via', 'operator',
      'venue_id', p_venue_id
    )
  );

  RETURN v_row;
END;
$function$;

REVOKE ALL ON FUNCTION public.biz_reservation_create(uuid, timestamptz, int, text, text, text, text, uuid, text, text, text[], text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.biz_reservation_create(uuid, timestamptz, int, text, text, text, text, uuid, text, text, text[], text) FROM anon;
GRANT EXECUTE ON FUNCTION public.biz_reservation_create(uuid, timestamptz, int, text, text, text, text, uuid, text, text, text[], text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5e. biz_reservation_transition — venue-scoped (re-stated from
--     20261011000000; row-keyed already — the table guard + no-show settings
--     lookup move to the row's venue_id). Same signature → CREATE OR REPLACE.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.biz_reservation_transition(
  p_reservation_id uuid,
  p_to_status text,
  p_table_id uuid DEFAULT NULL,      -- optional table (re)assignment on seat
  p_reason text DEFAULT NULL          -- optional operator note (cancellation reason)
) RETURNS public.reservations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_row public.reservations;
  v_from text;
  v_brand uuid;
  v_venue uuid;
  v_policy text;
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_row FROM public.reservations WHERE id = p_reservation_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'reservation_not_found' USING ERRCODE = 'P0002';
  END IF;
  v_from := v_row.status;
  v_brand := v_row.brand_id;
  v_venue := v_row.venue_id;

  -- Brand-member gate (manager+), unchanged — one team per brand (D-1).
  IF public.biz_brand_effective_rank_for_caller(v_brand)
       < public.biz_role_rank('event_manager') THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  -- Legal-transition enforcement (server-side; the heart of the invariant).
  IF NOT public.pg_reservation_transition_is_legal(v_from, p_to_status) THEN
    RAISE EXCEPTION 'illegal_transition_%_to_%', v_from, p_to_status
      USING ERRCODE = '23514';
  END IF;

  -- D-1 guard, now VENUE-scoped: a (re)assigned table MUST belong to the SAME
  -- venue as the reservation. NULL p_table_id (unassigned) is allowed.
  IF p_table_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.venue_tables
        WHERE id = p_table_id AND venue_id = v_venue
     ) THEN
    RAISE EXCEPTION 'table_brand_mismatch: table % does not belong to venue %',
      p_table_id, v_venue USING ERRCODE = '23514';
  END IF;

  -- no_show RECORDS the forfeit-policy DECISION (NO Stripe capture here).
  -- Settings are PER VENUE now (M3 PK move).
  IF p_to_status = 'no_show' THEN
    SELECT no_show_fee_policy INTO v_policy
      FROM public.venue_reservation_settings WHERE venue_id = v_venue;
  END IF;

  UPDATE public.reservations
     SET status = p_to_status,
         table_id = COALESCE(p_table_id, table_id),
         updated_at = now()
   WHERE id = p_reservation_id
   RETURNING * INTO v_row;

  INSERT INTO public.audit_log (
    user_id, brand_id, action, target_type, target_id, before, after
  ) VALUES (
    v_uid, v_brand,
    'venue_reservation.transition',
    'reservation', p_reservation_id::text,
    jsonb_build_object('status', v_from),
    jsonb_build_object(
      'status', p_to_status,
      'table_id', v_row.table_id,
      'reason', p_reason,
      'no_show_fee_policy', v_policy
    )
  );

  RETURN v_row;
END;
$function$;

REVOKE ALL ON FUNCTION public.biz_reservation_transition(uuid, text, uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.biz_reservation_transition(uuid, text, uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.biz_reservation_transition(uuid, text, uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5f. biz_waitlist_convert_to_reservation — venue-scoped (re-stated from
--     20261011000000; waitlist rows now carry venue_id NOT NULL; the converted
--     reservation inherits it; the table guard is venue-scoped). Same
--     signature → CREATE OR REPLACE. Atomicity preserved verbatim.
--     (biz_waitlist_mark_notified is UNTOUCHED — row-keyed, brand-rank-gated,
--     nothing venue-resolved inside it.)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.biz_waitlist_convert_to_reservation(
  p_waitlist_id uuid,
  p_reserved_for timestamptz,
  p_table_id uuid DEFAULT NULL
) RETURNS public.reservations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_wait public.venue_waitlist;
  v_res public.reservations;
  v_brand uuid;
  v_venue uuid;
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;
  SELECT * INTO v_wait FROM public.venue_waitlist WHERE id = p_waitlist_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'waitlist_not_found' USING ERRCODE = 'P0002';
  END IF;
  v_brand := v_wait.brand_id;
  v_venue := v_wait.venue_id;
  IF public.biz_brand_effective_rank_for_caller(v_brand)
       < public.biz_role_rank('event_manager') THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF v_wait.status = 'converted' THEN
    RAISE EXCEPTION 'waitlist_already_converted' USING ERRCODE = '23505';
  END IF;
  IF v_wait.status NOT IN ('waiting','notified') THEN
    RAISE EXCEPTION 'waitlist_not_active_%', v_wait.status USING ERRCODE = '23514';
  END IF;

  -- D-1 guard, now VENUE-scoped: the assigned table MUST belong to the SAME
  -- venue as the waitlist row (= the converted reservation's venue). NULL
  -- p_table_id (no table assigned at convert) is allowed. Runs BEFORE the
  -- INSERT so a mismatch aborts the whole convert atomically.
  IF p_table_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.venue_tables
        WHERE id = p_table_id AND venue_id = v_venue
     ) THEN
    RAISE EXCEPTION 'table_brand_mismatch: table % does not belong to venue %',
      p_table_id, v_venue USING ERRCODE = '23514';
  END IF;

  -- Create the reservation (FREE; created_via=operator; carries the waitlist
  -- guest identity + party + the venue key).
  INSERT INTO public.reservations (
    brand_id, venue_id, place_pool_id, table_id, reserved_for, party_size, status,
    source, created_via, guest_name, guest_phone_e164, guest_email,
    consumer_user_id
  ) VALUES (
    v_brand, v_venue, v_wait.place_pool_id, p_table_id, p_reserved_for, v_wait.party_size,
    'confirmed', 'walk_in', 'operator',
    v_wait.guest_name, v_wait.guest_phone_e164, v_wait.guest_email,
    v_wait.consumer_user_id
  ) RETURNING * INTO v_res;

  -- Mark the waitlist row converted + link.
  UPDATE public.venue_waitlist
     SET status = 'converted',
         converted_reservation_id = v_res.id,
         updated_at = now()
   WHERE id = p_waitlist_id;

  INSERT INTO public.audit_log (
    user_id, brand_id, action, target_type, target_id, after
  ) VALUES (
    v_uid, v_brand,
    'venue_waitlist.converted',
    'venue_waitlist', p_waitlist_id::text,
    jsonb_build_object('reservation_id', v_res.id, 'reserved_for', p_reserved_for)
  );

  RETURN v_res;
END;
$function$;

REVOKE ALL ON FUNCTION public.biz_waitlist_convert_to_reservation(uuid, timestamptz, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.biz_waitlist_convert_to_reservation(uuid, timestamptz, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.biz_waitlist_convert_to_reservation(uuid, timestamptz, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5g. pg_create_guest_reservation — venue-keyed (re-stated from
--     20261012000003; the anti-double-book advisory lock, slot re-validation,
--     deposit enforcement, audit are all preserved verbatim — only the scope
--     key moves brand→venue; brand_id + place_pool_id are DERIVED from the
--     venue row). Old signature DROPped. service_role ONLY (unchanged).
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.pg_create_guest_reservation(uuid, timestamptz, int, text, text, uuid, text, text, text, int, char, text, text, text, text, text, text);

CREATE OR REPLACE FUNCTION public.pg_create_guest_reservation(
  p_venue_id uuid,
  p_reserved_for timestamptz,
  p_party_size int,
  p_source text,                 -- 'mingla' (app) | 'website' (anon web)
  p_created_via text,            -- 'consumer' (signed-in) | 'guest' (anon)
  p_consumer_user_id uuid,       -- set when created_via='consumer'; else NULL
  p_guest_name text,
  p_guest_phone_e164 text,
  p_guest_email text,
  p_fee_cents int,               -- NULL/0 for free; >0 for a paid fee/deposit
  p_fee_currency char(3),
  p_payment_intent_id text,
  p_payment_status text,         -- 'none' (free) | 'paid' (fee charged upfront)
  p_guest_cancel_token text,     -- web cancel-link token (NULL for app)
  p_occasion text DEFAULT NULL,
  p_guest_notes text DEFAULT NULL,
  p_status text DEFAULT 'confirmed'
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
BEGIN
  -- Validate the discriminators up front (the edge fn validates buyer fields).
  IF p_venue_id IS NULL OR p_reserved_for IS NULL OR p_party_size IS NULL THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
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

  -- (0) Derive the venue's brand + place (venue row is the truth, D-1; the old
  -- body read place_pool_id from settings — the venue row now owns it).
  SELECT v.brand_id, v.place_pool_id INTO v_brand_id, v_place_pool_id
  FROM public.venue_listings v
  WHERE v.id = p_venue_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'venue_not_reservable' USING ERRCODE = 'P0001';
  END IF;

  -- (1) The venue must be reservable + have an availability config.
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

  -- ANTI-DOUBLE-BOOK: transaction-level advisory lock keyed on
  -- (venue_id, reserved_for) — slots are PER VENUE now, so the lock is too.
  v_lock_key := hashtextextended(p_venue_id::text || '|' || p_reserved_for::text, 0);
  PERFORM pg_advisory_xact_lock(v_lock_key);

  -- (2) RE-VALIDATE the slot against the engine AT WRITE TIME
  -- (I-PROPOSED-1148-RESERVATION-WRITE-REVALIDATES-SLOT, venue-keyed).
  v_slot_date := (p_reserved_for AT TIME ZONE v_tz)::date;
  SELECT EXISTS (
    SELECT 1
    FROM public.pg_venue_available_slots(
      p_date => v_slot_date,
      p_party_size => p_party_size,
      p_venue_id => p_venue_id
    ) s
    WHERE s.slot_start_utc = p_reserved_for
      AND s.is_full = false
      AND s.remaining > 0
  ) INTO v_slot_ok;
  IF NOT v_slot_ok THEN
    RAISE EXCEPTION 'slot_unavailable' USING ERRCODE = 'P0001';
  END IF;

  -- (3) deposit_threshold capacity rule (server-side), PER VENUE.
  SELECT EXISTS (
    SELECT 1
    FROM public.venue_capacity_rules cr
    WHERE cr.venue_id = p_venue_id
      AND cr.is_active
      AND cr.kind = 'deposit_threshold'
      AND COALESCE((cr.params->>'min_party_for_fee')::int, 1) <= p_party_size
  ) INTO v_deposit_required;
  IF v_deposit_required
     AND (p_payment_status <> 'paid' OR COALESCE(p_fee_cents, 0) <= 0) THEN
    RAISE EXCEPTION 'deposit_required' USING ERRCODE = 'P0001';
  END IF;

  -- (4) INSERT the reservation row (brand + place derived from the venue).
  INSERT INTO public.reservations (
    brand_id, venue_id, place_pool_id, reserved_for, party_size, status, source,
    created_via, guest_name, guest_phone_e164, guest_email, consumer_user_id,
    occasion, guest_notes, fee_cents, fee_currency, payment_intent_id,
    payment_status, guest_cancel_token
  ) VALUES (
    v_brand_id, p_venue_id, v_place_pool_id, p_reserved_for, p_party_size, p_status, p_source,
    p_created_via, p_guest_name, p_guest_phone_e164, p_guest_email,
    p_consumer_user_id, p_occasion, p_guest_notes,
    NULLIF(COALESCE(p_fee_cents, 0), 0), p_fee_currency, p_payment_intent_id,
    p_payment_status, p_guest_cancel_token
  ) RETURNING * INTO v_row;

  -- (5) Audit (append-only; runs as definer = privileged).
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
      'venue_id', p_venue_id
    )
  );

  RETURN v_row;
END;
$function$;

-- service_role ONLY (the edge fn) — unchanged posture.
REVOKE ALL ON FUNCTION public.pg_create_guest_reservation(uuid, timestamptz, int, text, text, uuid, text, text, text, int, char, text, text, text, text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.pg_create_guest_reservation(uuid, timestamptz, int, text, text, uuid, text, text, text, int, char, text, text, text, text, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.pg_create_guest_reservation(uuid, timestamptz, int, text, text, uuid, text, text, text, int, char, text, text, text, text, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.pg_create_guest_reservation(uuid, timestamptz, int, text, text, uuid, text, text, text, int, char, text, text, text, text, text, text) TO service_role;

-- ---------------------------------------------------------------------------
-- 5h. pg_finalize_guest_reservation — venue-aware (re-stated from
--     20261012000005; the FOR-UPDATE session lock + idempotent early-returns +
--     PI unique-index backstop are preserved VERBATIM — the only change is the
--     venue resolution for the mint). Same signature → CREATE OR REPLACE.
-- ---------------------------------------------------------------------------
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

  -- IDEMPOTENT EARLY-RETURN: the session already minted a reservation.
  IF v_session.reservation_id IS NOT NULL THEN
    SELECT * INTO v_row FROM public.reservations WHERE id = v_session.reservation_id;
    IF FOUND THEN
      reservation := v_row;
      session_id := v_session.id;
      RETURN NEXT;
      RETURN;
    END IF;
  END IF;

  -- IDEMPOTENT EARLY-RETURN via the PI key.
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

  -- Venue resolution for the mint: the session's venue_id (M3 column), with
  -- the [TRANSITIONAL-1] single-venue fallback for legacy sessions written
  -- before the venue key existed. Ambiguous (0 or >1 venues) → RAISE
  -- venue_ambiguous — never mint against the wrong venue.
  -- Exit condition: next consumer/business native builds ship + OTA unfreeze →
  -- sessions always carry venue_id; drop the fallback.
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

  -- No existing reservation → MINT via the same atomic writer (advisory-lock
  -- double-book guard + slot re-validation + deposit enforcement preserved).
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
      'confirmed'
    );
  EXCEPTION WHEN unique_violation THEN
    -- A concurrent mint for the same PI won the unique index. Adopt the winner.
    SELECT * INTO v_row FROM public.reservations
    WHERE payment_intent_id = p_payment_intent_id
    LIMIT 1;
    IF NOT FOUND THEN
      RAISE; -- not the PI index → re-raise.
    END IF;
  END;

  -- Link the session to the freshly-minted reservation in the SAME txn.
  UPDATE public.reservation_checkout_sessions
     SET status = 'completed', reservation_id = v_row.id, updated_at = now()
   WHERE id = p_session_id;

  reservation := v_row;
  session_id := v_session.id;
  RETURN NEXT;
END;
$function$;

REVOKE ALL ON FUNCTION public.pg_finalize_guest_reservation(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.pg_finalize_guest_reservation(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.pg_finalize_guest_reservation(uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.pg_finalize_guest_reservation(uuid, text) TO service_role;

-- ---------------------------------------------------------------------------
-- 5i. pg_cancel_guest_reservation + pg_cancel_my_reservation — row-keyed
--     already; ONLY their settings/cutoff lookups move to the row's venue_id
--     (re-stated from 20261012000003). Same signatures → CREATE OR REPLACE.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pg_cancel_guest_reservation(
  p_reservation_id uuid,
  p_guest_cancel_token text
) RETURNS TABLE (reservation public.reservations, refund_eligible boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_row public.reservations;
  v_cutoff int;
  v_refundable boolean;
  v_before_cutoff boolean;
  v_refund_eligible boolean := false;
BEGIN
  IF p_reservation_id IS NULL OR p_guest_cancel_token IS NULL
     OR btrim(p_guest_cancel_token) = '' THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_row FROM public.reservations
  WHERE id = p_reservation_id
    AND guest_cancel_token = p_guest_cancel_token
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'reservation_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.pg_reservation_transition_is_legal(v_row.status, 'cancelled_by_guest') THEN
    RAISE EXCEPTION 'cancel_not_allowed_from_%', v_row.status USING ERRCODE = '23514';
  END IF;

  -- Cutoff/refund policy is PER VENUE now (M3 settings PK move).
  SELECT cancel_cutoff_hours, fee_refundable INTO v_cutoff, v_refundable
  FROM public.venue_reservation_settings WHERE venue_id = v_row.venue_id;
  v_before_cutoff := public.pg_reservation_before_cancel_cutoff(v_row.reserved_for, COALESCE(v_cutoff, 0));
  v_refund_eligible := (v_row.payment_status = 'paid'
                        AND COALESCE(v_refundable, false)
                        AND v_before_cutoff);

  UPDATE public.reservations
     SET status = 'cancelled_by_guest', updated_at = now()
   WHERE id = p_reservation_id
   RETURNING * INTO v_row;

  INSERT INTO public.audit_log (
    user_id, brand_id, action, target_type, target_id, before, after
  ) VALUES (
    v_row.consumer_user_id, v_row.brand_id,
    'venue_reservation.guest_cancel',
    'reservation', p_reservation_id,
    jsonb_build_object('status', 'confirmed'),
    jsonb_build_object('status', 'cancelled_by_guest',
                       'before_cutoff', v_before_cutoff,
                       'refund_eligible', v_refund_eligible)
  );

  reservation := v_row;
  refund_eligible := v_refund_eligible;
  RETURN NEXT;
END;
$function$;
REVOKE ALL ON FUNCTION public.pg_cancel_guest_reservation(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.pg_cancel_guest_reservation(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.pg_cancel_guest_reservation(uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.pg_cancel_guest_reservation(uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.pg_cancel_my_reservation(
  p_reservation_id uuid
) RETURNS TABLE (reservation public.reservations, refund_eligible boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_row public.reservations;
  v_uid uuid := auth.uid();
  v_cutoff int;
  v_refundable boolean;
  v_before_cutoff boolean;
  v_refund_eligible boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_row FROM public.reservations
  WHERE id = p_reservation_id AND consumer_user_id = v_uid
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'reservation_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.pg_reservation_transition_is_legal(v_row.status, 'cancelled_by_guest') THEN
    RAISE EXCEPTION 'cancel_not_allowed_from_%', v_row.status USING ERRCODE = '23514';
  END IF;

  -- Cutoff/refund policy is PER VENUE now (M3 settings PK move).
  SELECT cancel_cutoff_hours, fee_refundable INTO v_cutoff, v_refundable
  FROM public.venue_reservation_settings WHERE venue_id = v_row.venue_id;
  v_before_cutoff := public.pg_reservation_before_cancel_cutoff(v_row.reserved_for, COALESCE(v_cutoff, 0));
  v_refund_eligible := (v_row.payment_status = 'paid'
                        AND COALESCE(v_refundable, false)
                        AND v_before_cutoff);

  UPDATE public.reservations
     SET status = 'cancelled_by_guest', updated_at = now()
   WHERE id = p_reservation_id
   RETURNING * INTO v_row;

  INSERT INTO public.audit_log (
    user_id, brand_id, action, target_type, target_id, before, after
  ) VALUES (
    v_uid, v_row.brand_id,
    'venue_reservation.consumer_cancel',
    'reservation', p_reservation_id,
    jsonb_build_object('status', 'confirmed'),
    jsonb_build_object('status', 'cancelled_by_guest',
                       'before_cutoff', v_before_cutoff,
                       'refund_eligible', v_refund_eligible)
  );

  reservation := v_row;
  refund_eligible := v_refund_eligible;
  RETURN NEXT;
END;
$function$;
REVOKE ALL ON FUNCTION public.pg_cancel_my_reservation(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.pg_cancel_my_reservation(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.pg_cancel_my_reservation(uuid) TO authenticated;

-- resolve_brand_pricing_inputs(p_brand_id) — UNTOUCHED (payments stay
-- brand-keyed, D-1). See the implementation report's Discoveries: its
-- venue_reservation_settings LEFT JOIN on brand_id can multiply rows once a
-- brand has N settings rows — flagged for the orchestrator.

COMMIT;

NOTIFY pgrst, 'reload schema';
