-- Issue #4490, spec 07 B: one table deposit rule, with the charge computed
-- by the database for per-guest, per-table and minimum-spend-share modes.
-- Static SQL. Local stack only until Seth approves a production migration.

BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.venue_tables
  ADD COLUMN deposit_mode text NOT NULL DEFAULT 'venue_rule'
    CHECK (deposit_mode IN ('venue_rule', 'per_guest', 'per_table', 'min_spend_share')),
  ADD COLUMN deposit_flat_minor bigint NULL
    CHECK (deposit_flat_minor IS NULL OR deposit_flat_minor BETWEEN 1 AND 2147483647),
  ADD COLUMN deposit_share_bps integer NULL
    CHECK (deposit_share_bps IS NULL OR deposit_share_bps BETWEEN 500 AND 10000);

UPDATE public.venue_tables
SET deposit_minor_per_guest = NULL
WHERE deposit_minor_per_guest = 0;

UPDATE public.venue_tables
SET deposit_mode = 'per_guest'
WHERE deposit_minor_per_guest > 0;

ALTER TABLE public.venue_tables
  ADD CONSTRAINT venue_tables_deposit_shape CHECK (
    (deposit_mode = 'venue_rule'
      AND deposit_minor_per_guest IS NULL
      AND deposit_flat_minor IS NULL
      AND deposit_share_bps IS NULL)
    OR
    (deposit_mode = 'per_guest'
      AND deposit_minor_per_guest > 0
      AND deposit_flat_minor IS NULL
      AND deposit_share_bps IS NULL)
    OR
    (deposit_mode = 'per_table'
      AND deposit_minor_per_guest IS NULL
      AND deposit_flat_minor IS NOT NULL
      AND deposit_share_bps IS NULL)
    OR
    (deposit_mode = 'min_spend_share'
      AND deposit_minor_per_guest IS NULL
      AND deposit_flat_minor IS NULL
      AND deposit_share_bps IS NOT NULL
      AND min_spend_minor > 0)
  );

COMMENT ON COLUMN public.venue_tables.deposit_mode IS
  '#4490: the table deposit rule. venue_rule falls back to the venue-level deposit.';
COMMENT ON COLUMN public.venue_tables.deposit_flat_minor IS
  '#4490: the whole-table hold in minor units when deposit_mode=per_table.';
COMMENT ON COLUMN public.venue_tables.deposit_share_bps IS
  '#4490: the minimum-spend share in basis points when deposit_mode=min_spend_share.';

CREATE OR REPLACE FUNCTION public.issue_4490_table_hold_minor(
  p_table_id uuid,
  p_party_size integer
)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT CASE
    WHEN p_party_size IS NULL OR p_party_size < 1 THEN NULL
    WHEN t.deposit_mode = 'venue_rule' THEN NULL
    WHEN t.deposit_mode = 'per_guest' THEN
      LEAST(t.deposit_minor_per_guest::numeric * p_party_size, 9223372036854775807)::bigint
    WHEN t.deposit_mode = 'per_table' THEN t.deposit_flat_minor
    WHEN t.deposit_mode = 'min_spend_share'
      AND public.issue_4490_venue_feature_on(t.venue_id, 'min_spend_tables') THEN
      LEAST(
        floor((t.min_spend_minor::numeric * t.deposit_share_bps + 5000) / 10000),
        9223372036854775807
      )::bigint
    ELSE NULL
  END
  FROM public.venue_tables t
  WHERE t.id = p_table_id AND t.deleted_at IS NULL;
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_table_hold_minor_for(
  p_table_ids uuid[],
  p_party_size integer
)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT max(public.issue_4490_table_hold_minor(t.id, p_party_size))
  FROM public.venue_tables t
  WHERE t.id = ANY(COALESCE(p_table_ids, '{}'::uuid[]));
$function$;

-- The return shape grows by hold_minor. Functions that call this helper are
-- name-bound by PL/pgSQL/SQL at execution time, so the drop/recreate is kept
-- inside this transaction and the existing callers are re-emitted below.
DROP FUNCTION public.issue_4490_table_slot_occupancy(uuid, timestamptz, integer, uuid, uuid);
CREATE FUNCTION public.issue_4490_table_slot_occupancy(
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
  hold_minor bigint,
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
  v_tz := COALESCE(NULLIF(btrim(COALESCE(v_cfg.iana_timezone, '')), ''), 'UTC');
  v_date := (p_slot AT TIME ZONE v_tz)::date;
  IF EXISTS (
    SELECT 1 FROM public.venue_blackouts b
    WHERE b.venue_id = p_venue_id AND b.applies_to = 'all'
      AND v_date BETWEEN b.date_start AND b.date_end
  ) THEN
    RETURN;
  END IF;
  v_buffer := COALESCE(v_cfg.buffer_minutes, 0);
  v_turn := public.pg_venue_turn_minutes_for_party(v_cfg.turn_times, p_party);
  v_end := p_slot + make_interval(mins => v_turn + v_buffer);

  RETURN QUERY
  WITH tbl AS (
    SELECT t.id, t.name, t.capacity, t.min_party, t.max_party, t.space_id AS t_space, t.combinable,
           t.guest_pickable, t.min_spend_minor AS t_min_spend,
           CASE WHEN t.deposit_mode = 'per_guest' THEN t.deposit_minor_per_guest END AS t_hold_per_guest,
           t.deposit_mode, t.sort_order,
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
           CASE
             WHEN a.deposit_mode IN ('venue_rule', 'per_guest')
              AND b.deposit_mode IN ('venue_rule', 'per_guest')
              AND (a.deposit_mode = 'per_guest' OR b.deposit_mode = 'per_guest')
             THEN GREATEST(COALESCE(a.t_hold_per_guest, 0), COALESCE(b.t_hold_per_guest, 0))
             ELSE NULL
           END AS hold_per_guest,
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
         e.t_min_spend, e.t_hold_per_guest,
         public.issue_4490_table_hold_minor(e.id, p_party), tt.remaining
  FROM elig e CROSS JOIN total tt
  UNION ALL
  SELECT 'join'::text, ARRAY[pr.a_id, pr.b_id], ARRAY[pr.a_name, pr.b_name], pr.cap, pr.t_space,
         pr.is_taken, (NOT pr.is_taken AND pr.both_pickable), pr.ms, pr.hold_per_guest,
         public.issue_4490_table_hold_minor_for(ARRAY[pr.a_id, pr.b_id], p_party), tt.remaining
  FROM pair_rows pr CROSS JOIN total tt;
END;
$function$;

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
  SELECT EXISTS (
    SELECT 1 FROM public.pg_venue_available_slots(p_date, p_party_size, p_venue_id, NULL, p_space_id) s
    WHERE s.slot_start_utc = p_slot_start AND NOT s.is_full
  ) INTO v_slot_ok;
  RETURN QUERY
  WITH occ AS (
    SELECT o.* FROM public.issue_4490_table_slot_occupancy(
      p_venue_id, p_slot_start, p_party_size, p_space_id
    ) o
  )
  SELECT 'table'::text, ARRAY[t.id], ARRAY[t.name], t.space_id, sp.name, t.capacity, t.shape,
         t.plan_x, t.plan_y, t.plan_w, t.plan_h, t.plan_rotation::integer,
         CASE WHEN o.table_ids IS NULL THEN 'not_fit'
              WHEN NOT v_slot_ok OR o.taken THEN 'taken'
              WHEN NOT o.pickable THEN 'not_pickable'
              ELSE 'free' END,
         CASE WHEN v_min_spend_on THEN t.min_spend_minor ELSE 0 END,
         CASE WHEN t.deposit_mode = 'per_guest' THEN t.deposit_minor_per_guest END,
         public.issue_4490_table_hold_minor(t.id, p_party_size)
  FROM public.venue_tables t
  LEFT JOIN public.venue_spaces sp ON sp.id = t.space_id
  LEFT JOIN occ o ON o.option_kind = 'table' AND o.table_ids = ARRAY[t.id]
  WHERE t.venue_id = p_venue_id AND t.is_active AND t.deleted_at IS NULL
    AND t.reservation_policy = 'reservable'
    AND (p_space_id IS NULL OR t.space_id = p_space_id)
  UNION ALL
  SELECT 'join'::text, o.table_ids, o.table_names, o.space_id, sp.name, o.capacity, NULL::text,
         NULL::numeric, NULL::numeric, NULL::numeric, NULL::numeric, NULL::integer,
         CASE WHEN NOT v_slot_ok OR o.taken THEN 'taken'
              WHEN NOT o.pickable THEN 'not_pickable' ELSE 'free' END,
         CASE WHEN v_min_spend_on THEN o.min_spend_minor ELSE 0 END,
         o.deposit_minor_per_guest,
         o.hold_minor
  FROM occ o
  LEFT JOIN public.venue_spaces sp ON sp.id = o.space_id
  WHERE o.option_kind = 'join';
END;
$function$;

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
  v_hold_per_guest bigint;
  v_hold_basis text;
  v_min_spend bigint;
  v_names text;
  v_count integer;
  v_every_hold_per_guest boolean;
BEGIN
  IF p_table_ids IS NULL OR cardinality(p_table_ids) = 0 THEN
    RETURN jsonb_build_object(
      'holdMinor', NULL, 'holdPerGuestMinor', NULL, 'holdBasis', NULL,
      'minSpendMinor', 0, 'tableNames', ''
    );
  END IF;
  SELECT count(*),
         public.issue_4490_table_hold_minor_for(p_table_ids, p_party_size),
         bool_and(t.deposit_mode = 'per_guest')
           FILTER (WHERE public.issue_4490_table_hold_minor(t.id, p_party_size) IS NOT NULL),
         max(CASE WHEN t.deposit_mode = 'per_guest' THEN t.deposit_minor_per_guest END),
         max(t.min_spend_minor),
         string_agg(t.name, ' + ' ORDER BY t.sort_order, t.name)
  INTO v_count, v_hold, v_every_hold_per_guest, v_hold_per_guest, v_min_spend, v_names
  FROM public.venue_tables t
  WHERE t.id = ANY(p_table_ids) AND t.venue_id = p_venue_id AND t.deleted_at IS NULL;
  IF v_count <> cardinality(p_table_ids) THEN
    RAISE EXCEPTION 'table_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_hold IS NOT NULL THEN
    IF COALESCE(v_every_hold_per_guest, false) THEN
      v_hold_basis := 'per_guest';
    ELSE
      SELECT t.deposit_mode INTO v_hold_basis
      FROM public.venue_tables t
      WHERE t.id = ANY(p_table_ids)
        AND public.issue_4490_table_hold_minor(t.id, p_party_size) = v_hold
      ORDER BY CASE t.deposit_mode WHEN 'per_table' THEN 1 WHEN 'min_spend_share' THEN 2 ELSE 3 END,
               t.sort_order, t.id
      LIMIT 1;
    END IF;
  END IF;
  RETURN jsonb_build_object(
    'holdMinor', v_hold,
    'holdPerGuestMinor', CASE WHEN COALESCE(v_every_hold_per_guest, false) THEN v_hold_per_guest END,
    'holdBasis', v_hold_basis,
    'minSpendMinor', CASE WHEN public.issue_4490_venue_feature_on(p_venue_id, 'min_spend_tables')
                          THEN COALESCE(v_min_spend, 0) ELSE 0 END,
    'tableNames', v_names
  );
END;
$function$;

DROP FUNCTION public.issue_4490_resolve_table_pick(uuid, timestamptz, integer, uuid[], uuid, uuid, boolean);
CREATE FUNCTION public.issue_4490_resolve_table_pick(
  p_venue_id uuid,
  p_reserved_for timestamptz,
  p_party_size integer,
  p_table_ids uuid[],
  p_space_id uuid DEFAULT NULL,
  p_exclude_reservation uuid DEFAULT NULL,
  p_staff boolean DEFAULT false
)
RETURNS TABLE (
  table_id uuid,
  joined_table_ids uuid[],
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
  v_sorted uuid[];
  v_row record;
BEGIN
  IF p_table_ids IS NULL OR cardinality(p_table_ids) = 0 THEN
    IF p_space_id IS NULL THEN
      RETURN;
    END IF;
    SELECT o.* INTO v_row
    FROM public.issue_4490_table_slot_occupancy(
      p_venue_id, p_reserved_for, p_party_size, p_space_id, p_exclude_reservation
    ) o
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
    hold_minor := v_row.hold_minor;
    RETURN NEXT;
    RETURN;
  END IF;
  IF NOT p_staff AND NOT public.issue_4490_venue_feature_on(p_venue_id, 'pick_a_table') THEN
    RAISE EXCEPTION 'table_pick_unavailable' USING ERRCODE = 'P0001';
  END IF;
  IF cardinality(p_table_ids) > 2 OR EXISTS (
    SELECT 1 FROM unnest(p_table_ids) x WHERE NOT EXISTS (
      SELECT 1 FROM public.venue_tables t WHERE t.id = x AND t.venue_id = p_venue_id
        AND t.is_active AND t.deleted_at IS NULL
    )
  ) THEN
    RAISE EXCEPTION 'table_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT array_agg(x ORDER BY x) INTO v_sorted FROM (SELECT DISTINCT unnest(p_table_ids) x) d;
  SELECT o.* INTO v_row
  FROM public.issue_4490_table_slot_occupancy(
    p_venue_id, p_reserved_for, p_party_size, NULL, p_exclude_reservation
  ) o
  WHERE (SELECT array_agg(x ORDER BY x) FROM unnest(o.table_ids) x) = v_sorted;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'table_not_fit' USING ERRCODE = '22023';
  END IF;
  IF v_row.taken OR (NOT p_staff AND NOT v_row.pickable) THEN
    RAISE EXCEPTION '%', CASE WHEN v_row.taken THEN 'table_taken' ELSE 'table_not_pickable' END
      USING ERRCODE = 'PT409';
  END IF;
  table_id := v_row.table_ids[1];
  joined_table_ids := v_row.table_ids[2:];
  min_spend_minor := CASE WHEN public.issue_4490_venue_feature_on(p_venue_id, 'min_spend_tables')
                          THEN v_row.min_spend_minor ELSE 0 END;
  hold_minor_per_guest := v_row.deposit_minor_per_guest;
  hold_minor := v_row.hold_minor;
  RETURN NEXT;
END;
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
    'depositMode', t.deposit_mode,
    'depositPerGuestMinor', t.deposit_minor_per_guest,
    'depositFlatMinor', t.deposit_flat_minor,
    'depositShareBps', t.deposit_share_bps,
    'reservationPolicy', t.reservation_policy,
    'isActive', t.is_active, 'zone', t.zone, 'sortOrder', t.sort_order, 'updatedAt', t.updated_at,
    'joinsWith', COALESCE((
      SELECT jsonb_agg(
        CASE WHEN j.table_a = t.id THEN j.table_b ELSE j.table_a END
        ORDER BY CASE WHEN j.table_a = t.id THEN j.table_b ELSE j.table_a END
      )
      FROM public.venue_table_joins j WHERE j.table_a = t.id OR j.table_b = t.id
    ), '[]'::jsonb)
  )
  FROM public.venue_tables t WHERE t.id = p_table_id;
$function$;

-- The two large, already-sealed writers keep their current definitions. This
-- checked patch changes only the deposit fields and the payment gate.
CREATE FUNCTION pg_temp.issue_4490_patch(
  p_sig regprocedure,
  p_old text,
  p_new text
)
RETURNS void
LANGUAGE plpgsql
AS $patch$
DECLARE
  v_def text := pg_get_functiondef(p_sig);
  v_old_count integer;
  v_new_count integer;
BEGIN
  v_old_count := (length(v_def) - length(replace(v_def, p_old, ''))) / length(p_old);
  v_new_count := (length(v_def) - length(replace(v_def, p_new, ''))) / length(p_new);
  IF v_new_count = 1 AND v_old_count = 0 THEN
    RETURN;
  END IF;
  IF v_old_count <> 1 OR v_new_count <> 0 THEN
    RAISE EXCEPTION 'issue_4490 table-deposit patch precondition failed for %: old %, new %',
      p_sig, v_old_count, v_new_count;
  END IF;
  EXECUTE replace(v_def, p_old, p_new);
END;
$patch$;

SELECT pg_temp.issue_4490_patch(
  'public.issue_4490_manage_table(text,uuid,jsonb,text)'::regprocedure,
  $old$  v_capacity integer;
BEGIN$old$,
  $new$  v_capacity integer;
  v_deposit_mode text;
  v_deposit_per_guest bigint;
  v_deposit_flat bigint;
  v_deposit_share integer;
  v_effective_min_spend bigint;
BEGIN$new$
);

SELECT pg_temp.issue_4490_patch(
  'public.issue_4490_manage_table(text,uuid,jsonb,text)'::regprocedure,
  $old$  IF p_payload ? 'depositPerGuestMinor' AND p_payload->'depositPerGuestMinor' <> 'null'::jsonb
     AND (jsonb_typeof(p_payload->'depositPerGuestMinor') <> 'number'
          OR (p_payload->>'depositPerGuestMinor') !~ '^[0-9]{1,10}$') THEN
    RAISE EXCEPTION 'table_hold_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_payload ? 'reservationPolicy'$old$,
  $new$  IF p_payload ? 'depositMode'
     AND COALESCE(p_payload->>'depositMode', '') NOT IN ('venue_rule', 'per_guest', 'per_table', 'min_spend_share') THEN
    RAISE EXCEPTION 'table_deposit_mode_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_payload ? 'depositPerGuestMinor' AND p_payload->'depositPerGuestMinor' <> 'null'::jsonb
     AND (jsonb_typeof(p_payload->'depositPerGuestMinor') <> 'number'
          OR (p_payload->>'depositPerGuestMinor') !~ '^[0-9]{1,10}$') THEN
    RAISE EXCEPTION 'table_hold_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_payload ? 'depositFlatMinor' AND p_payload->'depositFlatMinor' <> 'null'::jsonb
     AND (jsonb_typeof(p_payload->'depositFlatMinor') <> 'number'
          OR (p_payload->>'depositFlatMinor') !~ '^[0-9]{1,10}$'
          OR (p_payload->>'depositFlatMinor')::bigint NOT BETWEEN 1 AND 2147483647) THEN
    RAISE EXCEPTION 'table_hold_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_payload ? 'depositShareBps' AND p_payload->'depositShareBps' <> 'null'::jsonb
     AND (jsonb_typeof(p_payload->'depositShareBps') <> 'number'
          OR (p_payload->>'depositShareBps') !~ '^[0-9]{3,5}$'
          OR (p_payload->>'depositShareBps')::integer NOT BETWEEN 500 AND 10000) THEN
    RAISE EXCEPTION 'table_hold_invalid' USING ERRCODE = '22023';
  END IF;

  v_effective_min_spend := CASE WHEN p_payload ? 'minSpendMinor'
    THEN COALESCE((p_payload->>'minSpendMinor')::bigint, 0)
    ELSE COALESCE(v_table.min_spend_minor, 0) END;
  v_deposit_mode := CASE
    WHEN p_payload ? 'depositMode' THEN p_payload->>'depositMode'
    WHEN p_payload ? 'depositPerGuestMinor' THEN
      CASE WHEN COALESCE((p_payload->>'depositPerGuestMinor')::bigint, 0) > 0
        THEN 'per_guest' ELSE 'venue_rule' END
    WHEN p_action = 'create' THEN 'venue_rule'
    ELSE v_table.deposit_mode
  END;
  v_deposit_per_guest := CASE WHEN v_deposit_mode = 'per_guest' THEN
    CASE WHEN p_payload ? 'depositPerGuestMinor'
      THEN NULLIF((p_payload->>'depositPerGuestMinor')::bigint, 0)
      WHEN p_action <> 'create' AND v_table.deposit_mode = 'per_guest'
      THEN v_table.deposit_minor_per_guest END END;
  v_deposit_flat := CASE WHEN v_deposit_mode = 'per_table' THEN
    CASE WHEN p_payload ? 'depositFlatMinor'
      THEN (p_payload->>'depositFlatMinor')::bigint
      WHEN p_action <> 'create' AND v_table.deposit_mode = 'per_table'
      THEN v_table.deposit_flat_minor END END;
  v_deposit_share := CASE WHEN v_deposit_mode = 'min_spend_share' THEN
    CASE WHEN p_payload ? 'depositShareBps'
      THEN (p_payload->>'depositShareBps')::integer
      WHEN p_action <> 'create' AND v_table.deposit_mode = 'min_spend_share'
      THEN v_table.deposit_share_bps END END;

  IF v_deposit_mode = 'per_guest' AND COALESCE(v_deposit_per_guest, 0) <= 0 THEN
    RAISE EXCEPTION 'table_hold_invalid' USING ERRCODE = '22023';
  END IF;
  IF v_deposit_mode = 'per_table' AND v_deposit_flat IS NULL THEN
    RAISE EXCEPTION 'table_hold_invalid' USING ERRCODE = '22023';
  END IF;
  IF v_deposit_mode = 'min_spend_share' AND v_deposit_share IS NULL THEN
    RAISE EXCEPTION 'table_hold_invalid' USING ERRCODE = '22023';
  END IF;
  IF v_deposit_mode = 'min_spend_share' AND v_effective_min_spend <= 0 THEN
    IF p_action <> 'create' AND v_table.deposit_mode = 'min_spend_share'
       AND p_payload ? 'minSpendMinor' THEN
      RAISE EXCEPTION 'table_deposit_uses_min_spend:1' USING ERRCODE = 'P0001';
    END IF;
    RAISE EXCEPTION 'table_deposit_needs_min_spend' USING ERRCODE = '22023';
  END IF;
  IF v_deposit_mode = 'min_spend_share'
     AND NOT public.issue_4490_venue_feature_on(p_venue_id, 'min_spend_tables') THEN
    RAISE EXCEPTION 'table_deposit_needs_min_spend_tables' USING ERRCODE = 'P0001';
  END IF;

  IF p_payload ? 'reservationPolicy'$new$
);

SELECT pg_temp.issue_4490_patch(
  'public.issue_4490_manage_table(text,uuid,jsonb,text)'::regprocedure,
  $old$      min_spend_minor, deposit_minor_per_guest, guest_pickable
    ) VALUES ($old$,
  $new$      min_spend_minor, deposit_mode, deposit_minor_per_guest,
      deposit_flat_minor, deposit_share_bps, guest_pickable
    ) VALUES ($new$
);

SELECT pg_temp.issue_4490_patch(
  'public.issue_4490_manage_table(text,uuid,jsonb,text)'::regprocedure,
  $old$      COALESCE((p_payload->>'minSpendMinor')::bigint, 0), NULLIF(p_payload->>'depositPerGuestMinor', '')::bigint,
      COALESCE((p_payload->>'guestPickable')::boolean, true)$old$,
  $new$      COALESCE((p_payload->>'minSpendMinor')::bigint, 0), v_deposit_mode, v_deposit_per_guest,
      v_deposit_flat, v_deposit_share, COALESCE((p_payload->>'guestPickable')::boolean, true)$new$
);

SELECT pg_temp.issue_4490_patch(
  'public.issue_4490_manage_table(text,uuid,jsonb,text)'::regprocedure,
  $old$      deposit_minor_per_guest = CASE WHEN p_payload ? 'depositPerGuestMinor'
        THEN NULLIF(p_payload->>'depositPerGuestMinor', '')::bigint ELSE deposit_minor_per_guest END,
      guest_pickable = COALESCE((p_payload->>'guestPickable')::boolean, guest_pickable),$old$,
  $new$      deposit_mode = v_deposit_mode,
      deposit_minor_per_guest = v_deposit_per_guest,
      deposit_flat_minor = v_deposit_flat,
      deposit_share_bps = v_deposit_share,
      guest_pickable = COALESCE((p_payload->>'guestPickable')::boolean, guest_pickable),$new$
);

SELECT pg_temp.issue_4490_patch(
  'public.issue_4490_set_venue_feature(uuid,text,boolean,uuid[],jsonb,bigint,text,boolean)'::regprocedure,
  $old$  v_other text;
  v_result jsonb;
BEGIN$old$,
  $new$  v_other text;
  v_result jsonb;
  v_share_tables integer;
BEGIN$new$
);

SELECT pg_temp.issue_4490_patch(
  'public.issue_4490_set_venue_feature(uuid,text,boolean,uuid[],jsonb,bigint,text,boolean)'::regprocedure,
  $old$  IF p_enabled THEN
    SELECT COALESCE(array_agg(parent ORDER BY ord), '{}'::text[]) INTO v_missing$old$,
  $new$  IF p_key = 'min_spend_tables' AND NOT p_enabled THEN
    SELECT count(*)::integer INTO v_share_tables
    FROM public.venue_tables t
    WHERE t.venue_id = p_venue_id AND t.deleted_at IS NULL
      AND t.deposit_mode = 'min_spend_share';
    IF v_share_tables > 0 THEN
      RAISE EXCEPTION 'table_deposit_uses_min_spend:%', v_share_tables USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF p_enabled THEN
    SELECT COALESCE(array_agg(parent ORDER BY ord), '{}'::text[]) INTO v_missing$new$
);

SELECT pg_temp.issue_4490_patch(
  'public.pg_create_guest_reservation(uuid,timestamptz,integer,text,text,uuid,text,text,text,integer,character,text,text,text,text,text,text,text,uuid[],uuid)'::regprocedure,
  $old$IF COALESCE(cardinality(p_table_ids), 0) > 0 AND COALESCE(v_pick.hold_minor_per_guest, 0) > 0$old$,
  $new$IF COALESCE(cardinality(p_table_ids), 0) > 0 AND COALESCE(v_pick.hold_minor, 0) > 0$new$
);

DROP FUNCTION pg_temp.issue_4490_patch(regprocedure, text, text);

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
    'holdFromMinor', (
      SELECT min(public.issue_4490_table_hold_minor(t.id, 1))
      FROM public.venue_tables t
      WHERE t.venue_id = p_venue_id AND t.is_active AND t.deleted_at IS NULL
        AND t.reservation_policy = 'reservable'
    ),
    'minSpendFromMinor', CASE WHEN 'min_spend_tables' = ANY(p_features) THEN
      (SELECT min(t.min_spend_minor) FROM public.venue_tables t
       WHERE t.venue_id = p_venue_id AND t.is_active AND t.deleted_at IS NULL
         AND t.reservation_policy = 'reservable' AND t.min_spend_minor > 0) END,
    'largePartyRequest', public.issue_4490_feature_setting_on(
      p_venue_id, 'table_reservations', 'largePartyRequest'
    ),
    'guestWaitlist', 'waitlist' = ANY(p_features)
      AND public.issue_4490_feature_setting_on(p_venue_id, 'waitlist', 'guestJoin'),
    'notifyMe', 'waitlist' = ANY(p_features)
      AND public.issue_4490_feature_setting_on(p_venue_id, 'waitlist', 'guestJoin'),
    'seatingAreas', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('spaceId', s.id, 'name', s.name) ORDER BY s.sort_order, s.name)
      FROM public.venue_spaces s
      WHERE s.venue_id = p_venue_id AND s.is_active AND s.archived_at IS NULL
        AND EXISTS (
          SELECT 1 FROM public.venue_tables t
          WHERE t.space_id = s.id AND t.is_active AND t.deleted_at IS NULL
            AND t.reservation_policy = 'reservable'
        )
    ), '[]'::jsonb)
  ) END;
$function$;

REVOKE ALL ON FUNCTION
  public.issue_4490_table_hold_minor(uuid, integer),
  public.issue_4490_table_hold_minor_for(uuid[], integer),
  public.issue_4490_table_slot_occupancy(uuid, timestamptz, integer, uuid, uuid),
  public.issue_4490_resolve_table_pick(uuid, timestamptz, integer, uuid[], uuid, uuid, boolean)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
  public.issue_4490_table_hold_minor(uuid, integer),
  public.issue_4490_table_hold_minor_for(uuid[], integer)
TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION
  public.issue_4490_table_slot_occupancy(uuid, timestamptz, integer, uuid, uuid)
TO service_role;

COMMIT;
