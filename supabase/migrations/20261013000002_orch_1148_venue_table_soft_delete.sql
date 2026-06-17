-- ===========================================================================
-- META-ORCH-1148 e2e-validation gap — venue_tables SOFT DELETE
-- ---------------------------------------------------------------------------
-- The Tables module shipped add/edit/deactivate but NO delete: an operator who
-- mis-creates a table (or permanently removes one) had no way to remove it. This
-- migration adds SOFT delete (preserves reservation history; reservations.table_id
-- stays valid) via a new `deleted_at timestamptz` column + a guarded
-- `biz_venue_table_soft_delete` RPC, and excludes soft-deleted tables from the
-- availability engine so a deleted table stops producing bookable slots.
--
-- WHY SOFT (not ON DELETE SET NULL hard-delete): a hard delete would NULL the
-- table_id of every historical reservation that referenced the table (the FK is
-- ON DELETE SET NULL), losing which table a past guest sat at. Soft delete keeps
-- the row + the FK intact; existing reservations are untouched. The engine and
-- the operator list simply stop seeing it.
--
-- Three changes, all additive:
--   (1) ADD COLUMN venue_tables.deleted_at timestamptz NULL  (NULL = live).
--       Re-create the brand-active partial index to also require deleted_at IS
--       NULL so the hot path stays lean.
--   (2) RE-EMIT pg_venue_available_slots (engine v3) with ONLY one line added:
--       `AND t.deleted_at IS NULL` in the eligible-tables CTE. SIGNATURE +
--       RETURN shape FROZEN (CREATE OR REPLACE, no DROP). Everything else byte-
--       for-byte identical to v2 (20261008000001). The 2.2 consumer reserve
--       surface re-grants anon EXECUTE separately (20261012000000); this re-emit
--       does NOT re-add the anon grant, so the live anon grant is preserved by
--       the later migration ordering — see the REVOKE/GRANT block (authenticated
--       only here; anon untouched-from-2.2 because we don't REVOKE it).
--   (3) biz_venue_table_soft_delete(p_table_id uuid) — SECURITY DEFINER, manager+
--       gate via biz_brand_effective_rank_for_caller(auth.uid()), idempotent
--       (already-deleted → no-op), writes an audit_log row. Mirrors the 2.1b
--       lifecycle RPC shape. Supabase auto-GRANTs EXECUTE to PUBLIC/anon on every
--       new fn → REVOKE both explicitly (least-privilege belt; the gate is the
--       enforcement). $function$ closed BEFORE the GRANT block.
--
-- I-PROPOSED-1148-SOFT-DELETED-TABLE-NOT-BOOKABLE: a soft-deleted table is
-- excluded from the availability engine's eligible-table set. A revert that drops
-- the `deleted_at IS NULL` engine filter lets a deleted table keep producing slots
-- and FAILs the engine soft-delete SQL test.
--
-- Additive-only. MONOTONIC VERSION 20261013000002 — strictly greater than the
-- current max prefix across anchor main + every sibling worktree (20261013000001).
-- Re-confirmed at IMPLEMENT by scanning supabase/migrations/ + ~/Desktop/mingla-orchs/*/.
--
-- DO NOT run `supabase db push`. The orchestrator applies via the Supabase
-- Management API after REVIEW (CLI drift-wedged; MCP read-only).
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- (1) deleted_at column + leaner hot-path index.
-- ---------------------------------------------------------------------------
ALTER TABLE public.venue_tables
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz NULL;

-- The brand-active partial index now also excludes soft-deleted rows so the
-- engine's eligible-table scan never touches a deleted table.
DROP INDEX IF EXISTS public.venue_tables_brand_active_idx;
CREATE INDEX IF NOT EXISTS venue_tables_brand_active_idx
  ON public.venue_tables (brand_id) WHERE is_active AND deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- (2) Engine v3 — identical to v2 EXCEPT the one `AND t.deleted_at IS NULL`
--     line in the eligible-tables CTE (marked SOFT-DELETE below). Signature +
--     RETURN frozen; CREATE OR REPLACE (no DROP). Anon EXECUTE is NOT touched
--     here (the 2.2 grant in 20261012000000 stands).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pg_venue_available_slots(
  p_brand_id   uuid,
  p_date       date,
  p_party_size int
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
  IF p_brand_id IS NULL OR p_date IS NULL OR p_party_size IS NULL OR p_party_size < 1 THEN
    RETURN;
  END IF;

  SELECT reservations_enabled INTO v_enabled
  FROM public.venue_reservation_settings
  WHERE brand_id = p_brand_id;
  IF v_enabled IS NOT TRUE THEN
    RETURN;
  END IF;

  SELECT * INTO v_cfg
  FROM public.venue_availability_config
  WHERE brand_id = p_brand_id;
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
    WHERE b.brand_id = p_brand_id
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
  WHERE t.brand_id = p_brand_id
    AND t.is_active
    AND t.deleted_at IS NULL                       -- SOFT-DELETE exclusion
    AND t.reservation_policy = 'reservable'
    AND p_party_size BETWEEN COALESCE(t.min_party, 1)
                         AND LEAST(COALESCE(t.max_party, t.capacity), t.capacity)
    AND NOT EXISTS (
      SELECT 1 FROM public.venue_blackouts b
      WHERE b.brand_id = p_brand_id
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
        WHERE r.brand_id = p_brand_id
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

-- Preserve the live grants. We do NOT REVOKE anon here — the 2.2 consumer reserve
-- surface (20261012000000) granted anon EXECUTE intentionally and that stands.
-- authenticated EXECUTE is re-asserted (idempotent) for safety.
GRANT EXECUTE ON FUNCTION public.pg_venue_available_slots(uuid, date, int) TO authenticated;

-- ---------------------------------------------------------------------------
-- (3) biz_venue_table_soft_delete — the guarded soft-delete RPC.
-- Manager+ gate via the caller's auth context. Idempotent: an already-deleted
-- (or non-existent-for-this-caller) table is a clean no-op return of the brand's
-- live table count. Returns the brand_id so the client can invalidate the right
-- query key. Writes an audit_log row. NO money/checkout/engine-body change.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.biz_venue_table_soft_delete(
  p_table_id uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_brand uuid;
  v_already_deleted boolean;
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;
  IF p_table_id IS NULL THEN
    RAISE EXCEPTION 'table_id_required' USING ERRCODE = '22004';
  END IF;

  SELECT brand_id, (deleted_at IS NOT NULL)
    INTO v_brand, v_already_deleted
  FROM public.venue_tables
  WHERE id = p_table_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'table_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- Manager+ gate. biz_brand_effective_rank_for_caller is SECURITY DEFINER and
  -- resolves the caller via auth.uid() — works inside this SECURITY DEFINER fn.
  IF public.biz_brand_effective_rank_for_caller(v_brand)
       < public.biz_role_rank('event_manager') THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  -- Idempotent: already soft-deleted → no-op (no second audit row).
  IF v_already_deleted THEN
    RETURN v_brand;
  END IF;

  UPDATE public.venue_tables
     SET deleted_at = now(),
         updated_at = now()
   WHERE id = p_table_id;

  INSERT INTO public.audit_log (
    user_id, brand_id, action, target_type, target_id, after
  ) VALUES (
    v_uid, v_brand,
    'venue_table.soft_delete',
    'venue_table', p_table_id::text,
    jsonb_build_object('deleted_at', now())
  );

  RETURN v_brand;
END;
$function$;

REVOKE ALL ON FUNCTION public.biz_venue_table_soft_delete(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.biz_venue_table_soft_delete(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.biz_venue_table_soft_delete(uuid) TO authenticated;

COMMIT;
