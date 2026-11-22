-- issue #4522 M2 — trip payment plans v2 at checkout: the per-traveler
-- schedule, the v2 branch of quote / create-session / finalize and the
-- add-on payment choice. Inert while issue_4522_plan_v2_enabled() is false:
-- no v2 plan can be saved (M1), and every v2 branch below first asks
-- issue_4522_cart_has_v2(), which reads the switch.
--
-- Re-emitted from their latest bodies (20271216013872 / 20280313003281),
-- each guarded by an md5 drift check:
--   issue_3872_plan_due_today — a v2 prefix; the legacy body is untouched,
--     including installment_schedule_past_due_at_booking (legacy plans only).
--   issue_3872_ticket_quote, issue_1930_ticket_checkout_create_session_base
--     — same signatures: the add-on choice rides the cart lines
--     (`addonPaymentMode` on a line), so every caller and wrapper
--     (biz_ticket_checkout_create_session, the private-link and door
--     wrappers) is untouched. Grants are unchanged (service_role only).
--   issue_1930_ticket_checkout_finalize_base — rows carry kind, version 0 and
--     the spread add-on share; orders copy the frozen terms and add-on choice;
--     the session still records its order_id (the #4514 forms trigger reads it).
-- A v1 trip quote is byte-identical to before (I-4522-6, pinned by test).
-- Static SQL only. Conflicts raise PT409, never 40001 (none raised here).

BEGIN;
SET LOCAL lock_timeout = '10s';

DO $drift$
DECLARE r record; v_actual text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('public.issue_3872_plan_due_today(uuid,jsonb,text)','334d4e8f288f5db5e4e4800dd791a06c'),
    ('public.issue_3872_ticket_quote(uuid,jsonb,uuid[],timestamptz,timestamptz,integer,text,text,text,text,uuid,text,boolean)','4adeb2b03e5546201b596f91e4c9b1f1'),
    ('public.issue_1930_ticket_checkout_create_session_base(uuid,uuid,text,text,text,boolean,jsonb,text,timestamptz,integer,text,uuid[],timestamptz,timestamptz,integer,text,text)','c0ba32c9494e8a73de5254390974953e'),
    ('public.issue_1930_ticket_checkout_finalize_base(uuid,text,text,text,text,text,text,boolean)','e4a077a319fd8c9ba3805ce544126cd2')
  ) v(sig,expected_md5) LOOP
    SELECT md5(pg_get_functiondef(r.sig::regprocedure)) INTO v_actual;
    IF v_actual IS DISTINCT FROM r.expected_md5 THEN
      RAISE EXCEPTION 'issue #4522 M2 drift: % expected %, got %',r.sig,r.expected_md5,v_actual;
    END IF;
  END LOOP;
END;
$drift$;

-- ---------------------------------------------------------------------------
-- 1. The per-line checkout schedule (spec §6.1). Pure; the one owner of the
--    v2 money math at checkout. The TS mirror (packages/offering-rendering/
--    tripPlanV2Math.ts) is display-only and pinned to this by a parity test.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.issue_4522_plan_v2_schedule(
  p_line_net_minor bigint,
  p_units integer,
  p_plan jsonb,
  p_trip_start_at timestamptz,
  p_time_zone text,
  p_booked_at timestamptz,
  p_addon_today_minor bigint,
  p_addon_spread_minor bigint,
  p_line_list_minor bigint DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $fn$
DECLARE
  c_unit constant bigint := 100;
  v_tz text := COALESCE(NULLIF(p_time_zone, ''), 'UTC');
  v_p bigint := p_line_net_minor;
  v_at bigint := COALESCE(p_addon_today_minor, 0);
  v_as bigint := COALESCE(p_addon_spread_minor, 0);
  v_d0 bigint;
  v_t bigint;
  v_count integer;
  v_auto boolean;
  v_fdate date;
  v_bdate date;
  v_days integer;
  v_final_at timestamptz;
  v_n integer := 0;
  v_avail text;
  v_dates date[] := ARRAY[]::date[];
  v_trip bigint[] := ARRAY[]::bigint[];
  v_addon bigint[] := ARRAY[]::bigint[];
  v_custom bigint[];
  v_base bigint;
  v_abase bigint;
  v_i integer;
  v_fold bigint;
  v_rows jsonb := '[]'::jsonb;
  v_sum bigint := 0;
  v_deposit bigint;
  v_list bigint := p_line_list_minor;
  v_t_list bigint;
  v_degrade boolean := false;
BEGIN
  IF v_p IS NULL OR v_p < 0 OR COALESCE(p_units, 0) < 1 OR v_at < 0 OR v_as < 0
     OR p_trip_start_at IS NULL OR p_booked_at IS NULL OR p_plan IS NULL THEN
    RAISE EXCEPTION 'plan_schedule_input_invalid' USING ERRCODE = '22023';
  END IF;

  IF p_plan#>>'{deposit,mode}' = 'amount' THEN
    v_d0 := least((p_plan#>>'{deposit,amount_minor}')::bigint * p_units, v_p);
  ELSE
    v_d0 := floor(v_p::numeric * (p_plan#>>'{deposit,pct}')::numeric / 100)::bigint;
  END IF;
  v_t := v_p - v_d0;
  v_count := (p_plan->>'count')::integer;
  v_auto := COALESCE((p_plan->>'auto_adjust')::boolean, true);
  v_fdate := (p_trip_start_at AT TIME ZONE v_tz)::date
             - (p_plan->>'final_due_days_before_start')::integer;
  v_final_at := (v_fdate + time '09:00') AT TIME ZONE v_tz;
  v_bdate := (p_booked_at AT TIME ZONE v_tz)::date;
  v_days := v_fdate - v_bdate;

  IF v_t + v_as = 0 THEN
    v_avail := 'full_deposit';
  ELSIF p_booked_at >= p_trip_start_at THEN
    v_avail := 'closed';
  ELSIF v_days < 7 THEN
    v_avail := 'full_window';
  ELSIF v_days / 7 < v_count AND NOT v_auto THEN
    v_avail := 'full_only';
  ELSE
    v_avail := 'plan';
    v_n := least(v_count, v_days / 7);
  END IF;

  IF v_avail = 'plan' THEN
    -- Row i (1..n) on bookingDay + round_half_up(i * days / n); row n is the final date.
    FOR v_i IN 1..v_n LOOP
      v_dates := v_dates || (v_bdate + ((2 * v_i * v_days + v_n) / (2 * v_n)));
    END LOOP;

    IF jsonb_typeof(p_plan->'custom_amounts_minor') = 'array'
       AND jsonb_array_length(p_plan->'custom_amounts_minor') > 0 THEN
      SELECT array_agg((x #>> '{}')::bigint * p_units ORDER BY o) INTO v_custom
        FROM jsonb_array_elements(p_plan->'custom_amounts_minor') WITH ORDINALITY a(x, o);
      -- Custom amounts are set against the list price. Under a discount (net
      -- below list) each scales by the trip part's ratio, in whole units, and
      -- the last row takes the exact remainder.
      IF v_list IS NOT NULL AND v_list > v_p THEN
        v_t_list := v_list - CASE WHEN p_plan#>>'{deposit,mode}' = 'amount'
          THEN least((p_plan#>>'{deposit,amount_minor}')::bigint * p_units, v_list)
          ELSE floor(v_list::numeric * (p_plan#>>'{deposit,pct}')::numeric / 100)::bigint END;
        IF v_t_list > 0 THEN
          SELECT array_agg(floor(c::numeric * v_t / v_t_list / c_unit)::bigint * c_unit ORDER BY o) INTO v_custom
            FROM unnest(v_custom) WITH ORDINALITY u(c, o);
        END IF;
      END IF;
      v_custom := v_custom || (v_t - (SELECT COALESCE(sum(c), 0) FROM unnest(v_custom) c));
      -- Fewer rows fit: the first (count - n + 1) custom rows fold into row 1.
      v_fold := 0;
      FOR v_i IN 1..(v_count - v_n + 1) LOOP
        v_fold := v_fold + v_custom[v_i];
      END LOOP;
      v_trip := ARRAY[v_fold] || COALESCE(v_custom[(v_count - v_n + 2):v_count], ARRAY[]::bigint[]);
    ELSE
      v_base := (v_t / v_n) / c_unit * c_unit;
      WHILE v_n > 1 AND v_base = 0 LOOP
        v_dates := v_dates[2:v_n];
        v_n := v_n - 1;
        v_base := (v_t / v_n) / c_unit * c_unit;
      END LOOP;
      FOR v_i IN 1..v_n LOOP
        v_trip := v_trip || CASE WHEN v_i < v_n THEN v_base ELSE v_t - v_base * (v_n - 1) END;
      END LOOP;
    END IF;

    v_abase := (v_as / v_n) / c_unit * c_unit;
    FOR v_i IN 1..v_n LOOP
      v_addon := v_addon || CASE WHEN v_i < v_n THEN v_abase ELSE v_as - v_abase * (v_n - 1) END;
      -- Custom rows that cannot hold (a row at or below zero, e.g. a deep
      -- discount): the line degrades to full_only, so "Pay in full" and the
      -- quote never fail because a plan preview cannot be built.
      IF v_trip[v_i] < 0 OR v_trip[v_i] + v_addon[v_i] <= 0 THEN
        v_degrade := true;
        EXIT;
      END IF;
      v_rows := v_rows || jsonb_build_array(jsonb_build_object(
        'due_at', to_char(((v_dates[v_i] + time '09:00') AT TIME ZONE v_tz) AT TIME ZONE 'UTC',
                          'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'amount_minor', v_trip[v_i] + v_addon[v_i],
        'addon_portion_minor', v_addon[v_i]));
      v_sum := v_sum + v_trip[v_i] + v_addon[v_i];
    END LOOP;
    IF v_degrade THEN
      v_avail := 'full_only';
      v_n := 0;
      v_rows := '[]'::jsonb;
      v_sum := 0;
    END IF;
  END IF;

  v_deposit := v_p + v_at + v_as - v_sum;
  -- I-4522-1 conservation: deposit + rows = line + add-ons; a plan's deposit is D0 + today add-ons.
  IF v_avail = 'plan' AND v_deposit <> v_d0 + v_at THEN
    RAISE EXCEPTION 'installment_rounding_invalid' USING ERRCODE = 'P0001';
  END IF;

  RETURN jsonb_build_object(
    'availability', v_avail,
    'deposit_minor', v_deposit,
    'rows', v_rows,
    'count_offered', v_count,
    'count_given', v_n,
    'final_due_at', to_char(v_final_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'));
END;
$fn$;
REVOKE ALL ON FUNCTION public.issue_4522_plan_v2_schedule(bigint,integer,jsonb,timestamptz,text,timestamptz,bigint,bigint,bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4522_plan_v2_schedule(bigint,integer,jsonb,timestamptz,text,timestamptz,bigint,bigint,bigint) TO service_role;
COMMENT ON FUNCTION public.issue_4522_plan_v2_schedule(bigint,integer,jsonb,timestamptz,text,timestamptz,bigint,bigint,bigint) IS
  'Issue #4522 §6.1: one cart line''s v2 schedule from the booking day to the final due date (09:00 in the trip time zone, rows at least 7 days apart, whole-unit split, last row absorbs). Custom amounts are against the list price (p_line_list_minor) and scale under a discount; custom rows that cannot hold degrade the line to full_only. availability: plan | full_deposit | full_window | full_only | closed.';

-- ---------------------------------------------------------------------------
-- 2. Does this cart carry a v2 plan line the server can run?
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.issue_4522_cart_has_v2(p_event_id uuid, p_items jsonb)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT public.issue_4522_plan_v2_enabled()
     AND EXISTS (SELECT 1 FROM public.events e WHERE e.id = p_event_id AND e.event_type = 'trip')
     AND EXISTS (
       SELECT 1
         FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) x
         JOIN public.trip_pricing_tiers t
           ON t.event_id = p_event_id AND t.ticket_type_id = (x->>'ticketTypeId')::uuid
        WHERE t.tier_metadata ? 'payment_plan'
          AND jsonb_typeof(t.tier_metadata->'payment_plan') = 'object')
$fn$;
REVOKE ALL ON FUNCTION public.issue_4522_cart_has_v2(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4522_cart_has_v2(uuid, jsonb) TO service_role;

-- ---------------------------------------------------------------------------
-- 3. The cart planner for v2 lines. Same output contract as
--    issue_3872_plan_due_today (dueTodayNetCents, dueTodayListCents,
--    installmentSchedule{fullPriceCents, depositCents, currency,
--    installments[{ordinal, pct, amountCents, dueAt}]}) plus, for v2 only:
--    per entry addonPortionCents and sourceTicketTypeId; top level
--    planVersion, availability, countOffered, countGiven, finalDueAt,
--    addonScheduledCents, addonPaymentMode and paymentPlanTerms.
--    A line's own `paymentPlanChoice` overrides p_choice (the #3859 contract
--    path). Lines with no v2 plan, and v1 lines in a cart that has a v2 line,
--    are paid in full; asking for `installments` on a line that cannot take
--    a plan raises installment_plan_unavailable. Spread add-ons are summed per
--    line from p_extras; today add-ons are the caller's (added after planning).
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.issue_4522_plan_cart_v2(
  p_event_id uuid,
  p_items jsonb,
  p_choice text,
  p_booked_at timestamptz,
  p_extras jsonb,
  p_addon_payment_mode text
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_event record;
  v_start timestamptz;
  v_line jsonb;
  v_ord bigint;
  v_meta jsonb;
  v_plan jsonb;
  v_first_plan jsonb;
  v_sched jsonb;
  v_row jsonb;
  v_ri integer;
  v_choice text;
  v_net bigint;
  v_list bigint;
  v_spread bigint;
  v_dep bigint;
  v_due_net bigint := 0;
  v_due_list bigint := 0;
  v_full_net bigint := 0;
  v_full_list bigint := 0;
  v_addon_sched bigint := 0;
  v_union jsonb := '[]'::jsonb;
  v_any boolean := false;
  v_avail text;
  v_offered integer := 0;
  v_given integer := 0;
  v_final text;
  v_schedule jsonb;
  v_mode text;
  v_has_extras boolean;
BEGIN
  SELECT e.event_type, e.currency, COALESCE(NULLIF(e.timezone, ''), 'UTC') AS tz, e.refund_policy
    INTO v_event FROM public.events e WHERE e.id = p_event_id;
  SELECT min(d.start_at) INTO v_start FROM public.event_dates d WHERE d.event_id = p_event_id;
  SELECT COALESCE(sum((x->>'totalCents')::bigint), 0),
         COALESCE(sum((x->>'listUnitPriceCents')::bigint * (x->>'quantity')::integer), 0)
    INTO v_full_net, v_full_list FROM jsonb_array_elements(p_items) x;
  v_has_extras := jsonb_typeof(p_extras->'items') = 'array' AND jsonb_array_length(p_extras->'items') > 0;

  FOR v_line, v_ord IN SELECT value, ordinality FROM jsonb_array_elements(p_items) WITH ORDINALITY LOOP
    v_net := (v_line->>'totalCents')::bigint;
    v_list := (v_line->>'listUnitPriceCents')::bigint * (v_line->>'quantity')::integer;
    v_choice := COALESCE(v_line->>'paymentPlanChoice', p_choice);
    v_spread := 0;
    IF p_addon_payment_mode = 'spread' AND v_has_extras THEN
      SELECT COALESCE(sum((x->>'totalCents')::bigint), 0) INTO v_spread
        FROM jsonb_array_elements(p_extras->'items') x
       WHERE x->>'ticketTypeId' = v_line->>'ticketTypeId';
    END IF;
    SELECT t.tier_metadata INTO v_meta FROM public.trip_pricing_tiers t
     WHERE t.event_id = p_event_id AND t.ticket_type_id = (v_line->>'ticketTypeId')::uuid;
    v_plan := CASE WHEN jsonb_typeof(v_meta->'payment_plan') = 'object' THEN v_meta->'payment_plan' END;

    IF v_plan IS NULL THEN
      -- A legacy plan line asked for by name cannot be mixed into a v2 cart.
      IF v_choice = 'installments' AND jsonb_typeof(v_meta->'installments') = 'object' AND v_net > 0 THEN
        RAISE EXCEPTION 'installment_plan_unavailable' USING ERRCODE = 'P0001';
      END IF;
      v_due_net := v_due_net + v_net; v_due_list := v_due_list + v_list;
      CONTINUE;
    END IF;
    IF v_choice = 'full' OR (v_net = 0 AND v_spread = 0) OR v_start IS NULL THEN
      v_due_net := v_due_net + v_net; v_due_list := v_due_list + v_list;
      CONTINUE;
    END IF;

    v_sched := public.issue_4522_plan_v2_schedule(
      v_net, (v_line->>'quantity')::integer, v_plan, v_start, v_event.tz, p_booked_at, 0, v_spread, v_list);
    v_offered := greatest(v_offered, (v_sched->>'count_offered')::integer);
    IF v_sched->>'availability' <> 'plan' THEN
      IF v_choice = 'installments' THEN
        RAISE EXCEPTION 'installment_plan_unavailable' USING ERRCODE = 'P0001',
          DETAIL = v_sched->>'availability';
      END IF;
      v_avail := COALESCE(v_avail, v_sched->>'availability');
      v_due_net := v_due_net + v_net; v_due_list := v_due_list + v_list;
      CONTINUE;
    END IF;

    v_any := true;
    v_avail := 'plan';
    v_first_plan := COALESCE(v_first_plan, v_plan);
    v_given := greatest(v_given, (v_sched->>'count_given')::integer);
    v_final := greatest(v_final, v_sched->>'final_due_at');
    -- deposit_minor = D0 (no today add-ons are passed in here).
    v_dep := (v_sched->>'deposit_minor')::bigint;
    v_due_net := v_due_net + v_dep;
    v_due_list := v_due_list + CASE WHEN v_net > 0
      THEN floor(v_list::numeric * v_dep / v_net)::bigint ELSE 0 END;
    v_ri := 0;
    FOR v_row IN SELECT value FROM jsonb_array_elements(v_sched->'rows') LOOP
      v_ri := v_ri + 1;
      v_addon_sched := v_addon_sched + (v_row->>'addon_portion_minor')::bigint;
      v_union := v_union || jsonb_build_array(jsonb_build_object(
        'dueAt', v_row->>'due_at', 'amountCents', (v_row->>'amount_minor')::bigint,
        'addonPortionCents', (v_row->>'addon_portion_minor')::bigint,
        'sourceTicketTypeId', v_line->>'ticketTypeId', 'lineOrd', v_ord, 'rowOrd', v_ri));
    END LOOP;
  END LOOP;

  v_mode := CASE WHEN v_has_extras AND v_any
    THEN CASE WHEN p_addon_payment_mode = 'spread' AND v_addon_sched > 0 THEN 'spread' ELSE 'today' END END;

  IF NOT v_any THEN
    RETURN jsonb_build_object('dueTodayNetCents', v_full_net, 'dueTodayListCents', v_full_list,
      'installmentSchedule', NULL, 'planVersion', 2, 'availability', v_avail,
      'countOffered', v_offered, 'countGiven', 0, 'finalDueAt', NULL,
      'addonScheduledCents', 0, 'addonPaymentMode', NULL, 'paymentPlanTerms', NULL);
  END IF;

  SELECT jsonb_build_object(
      'fullPriceCents', v_full_net + v_addon_sched,
      'depositCents', v_due_net,
      'currency', trim(v_event.currency),
      'planVersion', 2,
      'availability', 'plan',
      'countOffered', v_offered,
      'countGiven', v_given,
      'finalDueAt', v_final,
      'installments', COALESCE(jsonb_agg(jsonb_build_object(
        'ordinal', rn,
        'pct', round((elem->>'amountCents')::numeric * 100 / (v_full_net + v_addon_sched), 2),
        'amountCents', (elem->>'amountCents')::bigint,
        'dueAt', elem->>'dueAt',
        'addonPortionCents', (elem->>'addonPortionCents')::bigint,
        'sourceTicketTypeId', elem->>'sourceTicketTypeId') ORDER BY rn), '[]'::jsonb))
    INTO v_schedule
    FROM (SELECT elem, row_number() OVER (ORDER BY elem->>'dueAt',
                 (elem->>'lineOrd')::integer, (elem->>'rowOrd')::integer) rn
            FROM jsonb_array_elements(v_union) elem) ranked;

  RETURN jsonb_build_object(
    'dueTodayNetCents', v_due_net,
    'dueTodayListCents', v_due_list,
    'installmentSchedule', v_schedule,
    'planVersion', 2,
    'availability', 'plan',
    'countOffered', v_offered,
    'countGiven', v_given,
    'finalDueAt', v_final,
    'addonScheduledCents', v_addon_sched,
    'addonPaymentMode', v_mode,
    'paymentPlanTerms', jsonb_build_object(
      'v', 2,
      'trip_start_at', to_char(v_start AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'final_due_at', v_final,
      'time_zone', v_event.tz,
      'auto_adjust', COALESCE((v_first_plan->>'auto_adjust')::boolean, true),
      'flex_enabled', COALESCE((v_first_plan#>>'{flex,enabled}')::boolean, false),
      'min_payment_minor', CASE WHEN COALESCE((v_first_plan#>>'{flex,enabled}')::boolean, false)
        THEN (v_first_plan#>>'{flex,min_payment_minor}')::bigint END,
      'deposit_minor', v_due_net,
      'deposit_non_refundable', COALESCE((v_event.refund_policy->>'deposit_non_refundable')::boolean, false),
      'addon_payment_mode', v_mode,
      'count_offered', v_offered,
      'count_given', v_given));
END;
$fn$;
REVOKE ALL ON FUNCTION public.issue_4522_plan_cart_v2(uuid,jsonb,text,timestamptz,jsonb,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4522_plan_cart_v2(uuid,jsonb,text,timestamptz,jsonb,text) TO service_role;
COMMENT ON FUNCTION public.issue_4522_plan_cart_v2(uuid,jsonb,text,timestamptz,jsonb,text) IS
  'Issue #4522: the v2 cart planner (one schedule per line from issue_4522_plan_v2_schedule, rows unioned and renumbered by due date then line order), with frozen plan terms. Used only while issue_4522_plan_v2_enabled() is true.';

-- ---------------------------------------------------------------------------
-- 4. The #3859 contract path: the v2 plan for a reserved session, booked at
--    the session's creation, with each line's own plan choice. NULL when the
--    cart has no v2 line the server can run (the caller keeps its v1 path).
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.issue_4522_checkout_v2_plan(
  p_checkout_session_id uuid,
  p_lines jsonb
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_session public.ticket_checkout_sessions%ROWTYPE;
  v_items jsonb;
BEGIN
  SELECT * INTO v_session FROM public.ticket_checkout_sessions WHERE id = p_checkout_session_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'checkout_session_not_found'; END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'ticketTypeId', i.ticket_type_id,
      'quantity', i.quantity,
      'totalCents', i.total_cents,
      'listUnitPriceCents', COALESCE(i.list_unit_price_cents, i.unit_price_cents),
      'paymentPlanChoice', COALESCE((
        SELECT l->>'paymentPlanChoice' FROM jsonb_array_elements(COALESCE(p_lines, '[]'::jsonb)) l
         WHERE l->>'ticketTypeId' = i.ticket_type_id::text LIMIT 1), 'full'))
      ORDER BY i.created_at, i.id), '[]'::jsonb)
    INTO v_items
    FROM public.ticket_checkout_session_items i
   WHERE i.checkout_session_id = p_checkout_session_id;
  IF NOT public.issue_4522_cart_has_v2(v_session.event_id, v_items) THEN
    RETURN NULL;
  END IF;
  RETURN public.issue_4522_plan_cart_v2(v_session.event_id, v_items, 'full',
    v_session.created_at, NULL, NULL);
END;
$fn$;
REVOKE ALL ON FUNCTION public.issue_4522_checkout_v2_plan(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4522_checkout_v2_plan(uuid, jsonb) TO service_role;
COMMENT ON FUNCTION public.issue_4522_checkout_v2_plan(uuid, jsonb) IS
  'Issue #4522: the v2 plan for a #3859 contract checkout session (booked at the session''s creation, per-line plan choice). NULL when the cart has no runnable v2 line, so the caller keeps its legacy planner.';

-- ---------------------------------------------------------------------------
-- 5. issue_3872_plan_due_today: the v2 prefix.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_3872_plan_due_today(p_event_id uuid, p_items jsonb, p_choice text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_event record; v_line jsonb; v_meta jsonb; v_input jsonb; v_inst jsonb; v_item jsonb;
  v_count integer; v_i integer; v_ord integer; v_days integer; v_fixed text; v_pct numeric;
  v_deposit_pct numeric; v_pct_sum numeric; v_net bigint; v_list bigint; v_dep_net bigint; v_dep_list bigint;
  v_running bigint; v_amount bigint; v_due timestamptz; v_now timestamptz:=now();
  v_due_net bigint:=0; v_due_list bigint:=0; v_union jsonb:='[]'::jsonb; v_any boolean:=false;
  v_full_net bigint:=0; v_full_list bigint:=0; v_schedule jsonb;
BEGIN
  -- issue #4522 — a cart with a v2 plan line takes the v2 planner while the
  -- switch is on; every other cart takes the legacy body below, unchanged.
  IF COALESCE(p_choice,'')<>'full' AND public.issue_4522_cart_has_v2(p_event_id,p_items) THEN
    RETURN public.issue_4522_plan_cart_v2(p_event_id,p_items,p_choice,now(),NULL,NULL);
  END IF;
  -- #4522: legacy percent plan, retired when no live v1 trip remains.
  SELECT e.event_type,e.currency INTO v_event FROM public.events e WHERE e.id=p_event_id;
  SELECT COALESCE(sum((x->>'totalCents')::bigint),0),
         COALESCE(sum((x->>'listUnitPriceCents')::bigint*(x->>'quantity')::integer),0)
    INTO v_full_net,v_full_list FROM jsonb_array_elements(p_items) x;
  IF v_event.event_type<>'trip' OR p_choice='full' THEN
    RETURN jsonb_build_object('dueTodayNetCents',v_full_net,'dueTodayListCents',v_full_list,'installmentSchedule',NULL);
  END IF;
  FOR v_line IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    v_net:=(v_line->>'totalCents')::bigint;
    v_list:=(v_line->>'listUnitPriceCents')::bigint*(v_line->>'quantity')::integer;
    IF v_net=0 THEN CONTINUE; END IF;
    SELECT t.tier_metadata INTO v_meta FROM public.trip_pricing_tiers t
      WHERE t.event_id=p_event_id AND t.ticket_type_id=(v_line->>'ticketTypeId')::uuid;
    v_input:=CASE WHEN v_meta IS NULL THEN NULL ELSE v_meta->'installments' END;
    IF v_input IS NULL OR jsonb_typeof(v_input)<>'object' THEN
      v_due_net:=v_due_net+v_net; v_due_list:=v_due_list+v_list; CONTINUE;
    END IF;
    v_deposit_pct:=COALESCE((v_input->>'deposit_pct')::numeric,0); v_inst:=v_input->'installments';
    IF v_deposit_pct<=0 OR v_deposit_pct>100 THEN RAISE EXCEPTION 'installment_deposit_pct_out_of_range'; END IF;
    IF v_inst IS NULL OR jsonb_typeof(v_inst)<>'array' THEN RAISE EXCEPTION 'installment_schedule_malformed'; END IF;
    v_count:=jsonb_array_length(v_inst);
    IF v_count<1 OR v_count>11 THEN RAISE EXCEPTION 'installment_count_out_of_range'; END IF;
    v_pct_sum:=v_deposit_pct;
    FOR v_i IN 0..v_count-1 LOOP
      v_item:=v_inst->v_i; v_ord:=COALESCE((v_item->>'ordinal')::integer,-1);
      v_pct:=COALESCE((v_item->>'pct')::numeric,0); v_days:=NULLIF(v_item->>'days_after_booking','')::integer;
      v_fixed:=NULLIF(v_item->>'fixed_date','');
      IF v_ord<>v_i+1 THEN RAISE EXCEPTION 'installment_ordinal_invalid'; END IF;
      IF v_pct<=0 OR v_pct>=100 THEN RAISE EXCEPTION 'installment_pct_out_of_range'; END IF;
      IF (v_days IS NULL)=(v_fixed IS NULL) THEN RAISE EXCEPTION 'installment_due_mode_invalid'; END IF;
      v_pct_sum:=v_pct_sum+v_pct;
    END LOOP;
    IF abs(v_pct_sum-100)>0.01 THEN RAISE EXCEPTION 'installment_pct_sum_mismatch'; END IF;
    v_dep_net:=floor(v_net::numeric*v_deposit_pct/100)::bigint;
    v_dep_list:=floor(v_list::numeric*v_deposit_pct/100)::bigint; v_running:=0;
    FOR v_i IN 0..v_count-1 LOOP
      v_item:=v_inst->v_i; v_ord:=(v_item->>'ordinal')::integer; v_pct:=(v_item->>'pct')::numeric;
      v_days:=NULLIF(v_item->>'days_after_booking','')::integer; v_fixed:=NULLIF(v_item->>'fixed_date','');
      IF v_days IS NOT NULL THEN
        IF v_days<1 THEN RAISE EXCEPTION 'installment_days_after_booking_invalid'; END IF;
        v_due:=v_now+(v_days||' days')::interval;
      ELSE v_due:=v_fixed::timestamptz; END IF;
      IF v_i=0 AND v_due<=v_now THEN RAISE EXCEPTION 'installment_schedule_past_due_at_booking'; END IF;
      IF v_i<v_count-1 THEN v_amount:=floor(v_net::numeric*v_pct/100)::bigint; v_running:=v_running+v_amount;
      ELSE v_amount:=v_net-v_dep_net-v_running; IF v_amount<=0 THEN RAISE EXCEPTION 'installment_rounding_invalid'; END IF; END IF;
      v_union:=v_union||jsonb_build_array(jsonb_build_object('pct',v_pct,'amountCents',v_amount,
        'dueAt',to_char(v_due AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'sourceTicketTypeId',v_line->>'ticketTypeId','sourceOrdinal',v_ord));
    END LOOP;
    v_due_net:=v_due_net+v_dep_net; v_due_list:=v_due_list+v_dep_list; v_any:=true;
  END LOOP;
  IF NOT v_any THEN
    RETURN jsonb_build_object('dueTodayNetCents',v_full_net,'dueTodayListCents',v_full_list,'installmentSchedule',NULL);
  END IF;
  SELECT jsonb_build_object('fullPriceCents',v_full_net,'depositCents',v_due_net,
    'currency',trim(v_event.currency),'installments',COALESCE(jsonb_agg(jsonb_build_object(
      'ordinal',rn,'pct',(elem->>'pct')::numeric,'amountCents',(elem->>'amountCents')::bigint,
      'dueAt',elem->>'dueAt') ORDER BY rn),'[]'::jsonb)) INTO v_schedule
  FROM (SELECT elem,row_number() OVER(ORDER BY elem->>'dueAt',(elem->>'sourceOrdinal')::integer) rn
        FROM jsonb_array_elements(v_union) elem) ranked;
  RETURN jsonb_build_object('dueTodayNetCents',v_due_net,'dueTodayListCents',v_due_list,'installmentSchedule',v_schedule);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 6. Quote and create-session: the v2 add-on seam (same signatures).
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.issue_4522_lines_addon_payment_mode(p_lines jsonb)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_modes text[];
BEGIN
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' THEN RETURN NULL; END IF;
  SELECT array_agg(DISTINCT l->>'addonPaymentMode') INTO v_modes
    FROM jsonb_array_elements(p_lines) l
   WHERE jsonb_typeof(l) = 'object' AND l ? 'addonPaymentMode'
     AND jsonb_typeof(l->'addonPaymentMode') <> 'null';
  IF v_modes IS NULL THEN RETURN NULL; END IF;
  IF array_length(v_modes, 1) <> 1 OR v_modes[1] IS NULL OR v_modes[1] NOT IN ('today', 'spread') THEN
    RAISE EXCEPTION 'addon_payment_mode_invalid' USING ERRCODE = '22023';
  END IF;
  RETURN v_modes[1];
END;
$fn$;
REVOKE ALL ON FUNCTION public.issue_4522_lines_addon_payment_mode(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4522_lines_addon_payment_mode(jsonb) TO service_role;
COMMENT ON FUNCTION public.issue_4522_lines_addon_payment_mode(jsonb) IS
  'Issue #4522: the cart''s add-on payment choice for a v2 plan, from `addonPaymentMode` on its lines (one value per cart: today | spread; NULL when absent). Anything else raises addon_payment_mode_invalid (22023).';

CREATE OR REPLACE FUNCTION public.issue_3872_ticket_quote(p_event_id uuid, p_lines jsonb, p_event_date_ids uuid[], p_booked_start_at timestamp with time zone, p_booked_end_at timestamp with time zone, p_booked_party_size integer, p_payment_plan_choice text, p_discount_code text, p_buyer_email text, p_buyer_phone_e164 text, p_buyer_user_id uuid, p_link_token_hash text, p_queued boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
DECLARE
  v_event record;
  v_link public.ticket_type_links;
  v_state text;
  v_ctx jsonb;
  v_price jsonb;
  v_line_ctx jsonb;
  v_line jsonb;
  v_items jsonb := '[]'::jsonb;
  v_engine_lines jsonb := '[]'::jsonb;
  v_candidates jsonb;
  v_quote jsonb;
  v_plan jsonb;
  v_buyer jsonb;
  v_code text;
  v_currency character(3);
  v_line_currency text;
  v_saw_null_currency boolean := false;
  v_units integer := 0;
  v_expires_at timestamptz;
  v_result jsonb;
  v_extras jsonb;
  v_preview jsonb;
  v_addon_mode text;
BEGIN
  IF COALESCE(p_payment_plan_choice,'') NOT IN ('auto','full','installments') THEN
    RAISE EXCEPTION 'payment_plan_choice_invalid';
  END IF;
  -- issue #4522 — how add-ons on a v2 plan are paid (today | spread), carried
  -- on the cart lines so every caller and wrapper keeps its signature.
  v_addon_mode:=public.issue_4522_lines_addon_payment_mode(p_lines);
  IF p_lines IS NULL OR jsonb_typeof(p_lines)<>'array' OR jsonb_array_length(p_lines)=0 THEN
    RAISE EXCEPTION 'ticket_lines_required';
  END IF;

  SELECT e.id,e.brand_id,e.visibility,e.status,e.deleted_at,e.event_type,e.timezone
    INTO v_event FROM public.events e WHERE e.id=p_event_id;
  IF NOT FOUND OR v_event.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'event_not_found'; END IF;
  IF v_event.visibility NOT IN ('public','hidden')
     OR v_event.status NOT IN ('scheduled','live') THEN RAISE EXCEPTION 'event_not_selling'; END IF;
  IF EXISTS(SELECT 1 FROM public.event_dates d WHERE d.event_id=p_event_id)
     AND NOT EXISTS(SELECT 1 FROM public.event_dates d WHERE d.event_id=p_event_id AND d.end_at>now()) THEN
    RAISE EXCEPTION 'event_already_ended';
  END IF;

  IF p_link_token_hash IS NOT NULL THEN
    SELECT l.* INTO v_link FROM public.ticket_type_links l WHERE l.token_hash=p_link_token_hash;
    IF NOT FOUND THEN RAISE EXCEPTION 'link_not_found'; END IF;
    IF v_link.event_id<>p_event_id OR v_link.kind<>'private_ticket' THEN
      RAISE EXCEPTION 'not_a_private_ticket_link';
    END IF;
    v_state:=public.issue_3827_link_state(v_link,now());
    IF v_state<>'active' THEN
      RAISE EXCEPTION '%',CASE v_state WHEN 'revoked' THEN 'link_revoked'
        WHEN 'expired' THEN 'link_expired' WHEN 'full' THEN 'link_full' ELSE v_state END;
    END IF;
    FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
      IF (v_line->>'ticketTypeId')::uuid<>v_link.ticket_type_id THEN
        RAISE EXCEPTION 'link_tier_mismatch';
      END IF;
      v_units:=v_units+public.issue_3281_line_qty_sum(v_line);
    END LOOP;
    IF v_units<=0 THEN RAISE EXCEPTION 'invalid_request'; END IF;
    IF v_link.max_uses IS NOT NULL
       AND public.issue_3827_link_uses_taken(v_link.id)+v_units>v_link.max_uses THEN
      RAISE EXCEPTION 'link_full';
    END IF;
    PERFORM set_config('mingla.ticket_link_id',v_link.id::text,true);
  END IF;

  v_ctx:=public.issue_3872_checkout_day_context(
    p_event_id,p_event_date_ids,p_booked_start_at,p_booked_end_at);
  v_expires_at:=CASE WHEN COALESCE(p_queued,false) THEN 'infinity'::timestamptz
    ELSE now()+interval '30 minutes' END;
  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
    -- issue #3281 — quote and create-session refuse the same lines.
    PERFORM public.issue_3281_assert_line_days(
      (v_line->>'ticketTypeId')::uuid,
      CASE WHEN jsonb_typeof(v_line->'byDate')='object' THEN v_line->'byDate' ELSE NULL END,
      ARRAY(SELECT value::uuid FROM jsonb_array_elements_text(
        CASE WHEN jsonb_typeof(v_ctx->'dayIds')='array' THEN v_ctx->'dayIds' ELSE '[]'::jsonb END)),
      v_ctx->>'pricingMode');
    -- Same rules as create-session: byDate is already expanded per date.
    v_line_ctx:=v_ctx;
    IF jsonb_typeof(v_line->'byDate')='object' THEN
      IF v_ctx->>'pricingMode'='all_days' THEN
        RAISE EXCEPTION 'by_date_not_supported_for_all_days';
      END IF;
      IF COALESCE((v_ctx->>'dayCount')::integer,0)=0 OR EXISTS(
        SELECT 1 FROM jsonb_object_keys(v_line->'byDate') AS k
        WHERE NOT (k::uuid=ANY(ARRAY(
          SELECT jsonb_array_elements_text(v_ctx->'dayIds')::uuid)))
      ) THEN
        RAISE EXCEPTION 'ticket_quantity_invalid';
      END IF;
      v_line_ctx:=v_ctx||jsonb_build_object('dayMultiplier',1);
    END IF;
    v_price:=public.issue_3872_ticket_line_price(
      p_event_id,(v_line->>'ticketTypeId')::uuid,
      public.issue_3281_line_qty_sum(v_line),v_line_ctx,v_expires_at,p_booked_party_size);
    v_line_currency:=NULLIF(v_price->>'currency','');
    IF v_line_currency IS NULL THEN
      v_saw_null_currency:=true;
    ELSIF v_currency IS NULL THEN
      v_currency:=v_line_currency::character(3);
    ELSIF trim(v_currency)<>v_line_currency THEN
      RAISE EXCEPTION 'mixed_currency_cart';
    END IF;
    v_items:=v_items||jsonb_build_array(jsonb_build_object(
      'ticketTypeId',v_price->'ticketTypeId','ticketName',v_price->>'ticketName',
      'quantity',(v_price->>'quantity')::integer,
      'unitPriceCents',(v_price->>'unitPriceCents')::integer,
      'listUnitPriceCents',(v_price->>'unitPriceCents')::integer,
      'discountCents',0,'totalCents',(v_price->>'totalCents')::integer,
      'admitsCount',(v_price->>'admitsCount')::integer,
      'valueScale',(v_price->>'valueScale')::integer,
      'countScale',(v_price->>'countScale')::integer,
      'discountsAllowed',(v_price->>'discountsAllowed')::boolean,
      'priceBasis',v_price->>'priceBasis','isFree',(v_price->>'isFree')::boolean,
      'applied','[]'::jsonb));
  END LOOP;

  v_code:=NULLIF(upper(regexp_replace(btrim(COALESCE(p_discount_code,'')),'[\s-]','','g')),'');
  IF v_code IS NOT NULL AND (length(v_code)>32 OR v_code!~'^[A-Z0-9]+$') THEN
    RAISE EXCEPTION 'discount_code_invalid';
  END IF;
  v_buyer:=jsonb_build_object('email',NULLIF(lower(btrim(p_buyer_email)),''),
    'phone',p_buyer_phone_e164,'userId',p_buyer_user_id);
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'lineRef',i->>'ticketTypeId','itemKind','ticket_type','itemId',i->'ticketTypeId',
    'listingId',p_event_id,'listingKind',v_event.event_type,
    'listUnitMinor',(i->>'listUnitPriceCents')::integer,'qty',(i->>'quantity')::integer,
    'valueScale',(i->>'valueScale')::integer,'countScale',(i->>'countScale')::integer,
    'allowed',(i->>'discountsAllowed')::boolean AND NOT (i->>'isFree')::boolean,
    'tz',COALESCE(v_event.timezone,'UTC')) ORDER BY ord),'[]'::jsonb)
    INTO v_engine_lines FROM jsonb_array_elements(v_items) WITH ORDINALITY a(i,ord);
  v_candidates:=public.issue_3872_discount_candidates(
    v_event.brand_id,v_engine_lines,v_code,v_buyer,now());
  v_quote:=public.issue_3872_discount_apply(jsonb_build_object(
    'currency',trim(v_currency),'at',now(),'queued',COALESCE(p_queued,false),
    'lines',v_engine_lines,'automatics',v_candidates->'automatics',
    'code',v_candidates->'code','codeLookup',v_candidates->>'codeLookup'));
  SELECT COALESCE(jsonb_agg(i||jsonb_build_object(
    'unitPriceCents',(q->>'netUnitMinor')::integer,
    'totalCents',(q->>'lineNetMinor')::integer,
    'discountCents',(q->>'lineDiscountMinor')::integer,
    'unitsCounted',(q->>'unitsCounted')::integer,
    'applied',q->'applied') ORDER BY ord),'[]'::jsonb)
    INTO v_items
    FROM jsonb_array_elements(v_items) WITH ORDINALITY a(i,ord)
    JOIN jsonb_array_elements(v_quote->'lines') q ON q->>'lineRef'=i->>'ticketTypeId';
  IF v_saw_null_currency AND v_currency IS NOT NULL
     AND (v_quote->>'netSubtotalMinor')::bigint>0 THEN RAISE EXCEPTION 'mixed_currency_cart'; END IF;
  IF (v_quote->>'netSubtotalMinor')::bigint>0 AND v_currency IS NULL THEN
    RAISE EXCEPTION 'event_currency_required';
  END IF;

  v_plan:=public.issue_3872_plan_due_today(p_event_id,v_items,p_payment_plan_choice);
  -- issue #3281 — extras, priced after discounts and never on a plan.
  v_extras:=public.issue_3281_price_extras(p_event_id,p_lines,
    ARRAY(SELECT value::uuid FROM jsonb_array_elements_text(
      CASE WHEN jsonb_typeof(v_ctx->'dayIds')='array' THEN v_ctx->'dayIds' ELSE '[]'::jsonb END)),false);
  IF jsonb_array_length(v_extras->'items')>0 THEN
    IF (v_extras->>'totalCents')::integer>0 AND (v_quote->>'netSubtotalMinor')::bigint=0 THEN
      RAISE EXCEPTION 'extras_need_paid_ticket';
    END IF;
    IF v_plan->'installmentSchedule' IS NOT NULL AND v_plan->'installmentSchedule'<>'null'::jsonb THEN
      -- issue #4522 — add-ons ride only a v2 plan, and only with #3281's plan switch on.
      IF COALESCE((v_plan->>'planVersion')::integer,1)<>2
         OR NOT public.issue_3281_add_on_switch('plan_enabled') THEN
        RAISE EXCEPTION 'extras_not_on_installments';
      END IF;
      v_plan:=public.issue_4522_plan_cart_v2(p_event_id,v_items,p_payment_plan_choice,now(),
        v_extras,COALESCE(v_addon_mode,'today'));
    END IF;
  END IF;
  -- issue #4522 — what a v2 plan would look like on this booking day, so a
  -- client asking for `full` still learns the plan's availability first.
  IF NOT (v_plan ? 'planVersion') AND public.issue_4522_cart_has_v2(p_event_id,v_items) THEN
    v_preview:=public.issue_4522_plan_cart_v2(p_event_id,v_items,'auto',now(),v_extras,
      COALESCE(v_addon_mode,'today'));
  ELSIF v_plan ? 'planVersion' THEN
    v_preview:=v_plan;
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'ticketTypeId',i->'ticketTypeId','ticketName',i->>'ticketName',
    'quantity',(i->>'quantity')::integer,
    'listUnitCents',(i->>'listUnitPriceCents')::integer,
    'netUnitCents',(i->>'unitPriceCents')::integer,
    'lineListCents',(i->>'listUnitPriceCents')::integer*(i->>'quantity')::integer,
    'lineNetCents',(i->>'totalCents')::integer,
    'discountCents',(i->>'discountCents')::integer,
    'discounts',COALESCE(i->'applied','[]'::jsonb)) ORDER BY ord),'[]'::jsonb)
    INTO v_result FROM jsonb_array_elements(v_items) WITH ORDINALITY a(i,ord);
  IF p_link_token_hash IS NOT NULL THEN PERFORM set_config('mingla.ticket_link_id','',true); END IF;
  RETURN jsonb_build_object(
    'currency',trim(v_currency),'lines',v_result,
    'listSubtotalCents',(v_quote->>'listSubtotalMinor')::bigint+(v_extras->>'totalCents')::bigint,
    'discountCents',(v_quote->>'discountMinor')::bigint,
    'netSubtotalCents',(v_quote->>'netSubtotalMinor')::bigint+(v_extras->>'totalCents')::bigint,
    'dueTodayNetCents',(v_plan->>'dueTodayNetCents')::bigint+(v_extras->>'totalCents')::bigint
      -COALESCE((v_plan->>'addonScheduledCents')::bigint,0),
    'dueTodayListCents',(v_plan->>'dueTodayListCents')::bigint+(v_extras->>'totalCents')::bigint
      -COALESCE((v_plan->>'addonScheduledCents')::bigint,0),
    'extras',v_extras->'items','extrasTotalCents',(v_extras->>'totalCents')::bigint,
    'installmentSchedule',v_plan->'installmentSchedule',
    'discounts',v_quote->'applied','codeOutcome',v_quote->'codeOutcome',
    'notices',v_quote->'notices','quoteDigest',public.issue_3281_quote_digest(v_quote->>'digest',v_extras),
    'quoteListDigest',v_quote->>'listDigest')
    -- issue #4522 — present only when the cart has a v2 plan line.
    || CASE WHEN v_preview IS NULL THEN '{}'::jsonb ELSE jsonb_build_object(
      'paymentPlanV2',jsonb_build_object(
        'availability',v_preview->'availability','countOffered',v_preview->'countOffered',
        'countGiven',v_preview->'countGiven','finalDueAt',v_preview->'finalDueAt',
        'installmentSchedule',v_preview->'installmentSchedule'),
      'addonPaymentMode',v_plan->'addonPaymentMode') END;
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_1930_ticket_checkout_create_session_base(p_event_id uuid, p_buyer_user_id uuid, p_buyer_name text, p_buyer_email text, p_buyer_phone_e164 text, p_marketing_opt_in boolean, p_lines jsonb, p_idempotency_key text, p_expires_at timestamp with time zone, p_application_fee_amount_cents integer DEFAULT 0, p_payment_plan_choice text DEFAULT 'auto'::text, p_event_date_ids uuid[] DEFAULT NULL::uuid[], p_booked_start_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_booked_end_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_booked_party_size integer DEFAULT NULL::integer, p_discount_code text DEFAULT NULL::text, p_expected_quote_digest text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_existing record;
  v_event record;
  v_session_id uuid;
  v_status text;
  v_currency character(3);
  v_total integer := 0;
  v_line jsonb;
  v_ticket_type record;
  v_qty integer;
  v_sold integer;
  v_reserved integer;
  v_items jsonb := '[]'::jsonb;
  v_stripe_account_id text;
  v_is_trip boolean := false;
  v_line_count int := 0;
  -- META-ORCH-1174 B1: per-line installment locals. v_first_ticket_type_id is
  -- retained for compatibility but the schedule is now computed PER LINE in a
  -- second loop, not off the first tier only.
  v_first_ticket_type_id uuid := NULL;
  v_tier_metadata jsonb;
  v_installments_input jsonb;
  v_deposit_pct numeric;
  v_inst_array jsonb;
  v_inst_count int;
  v_inst_item jsonb;
  v_inst_ord int;
  v_inst_pct numeric;
  v_inst_days int;
  v_inst_fixed text;
  v_pct_sum numeric := 0;
  v_line_total bigint;          -- THIS line's total (price_cents × qty)
  v_line_deposit_cents bigint;  -- THIS line's deposit
  v_line_running bigint;        -- THIS line's running installment total
  v_inst_amount bigint;
  v_inst_due timestamptz;
  v_now timestamptz := now();
  v_i int;
  -- Aggregate accumulators across all lines:
  v_due_today_cents bigint := 0;          -- Σ deposits + Σ non-plan full
  v_any_installments boolean := false;    -- did ANY line produce a schedule?
  v_unioned jsonb := '[]'::jsonb;         -- all lines' raw installment entries
  v_full_price_cents bigint := 0;         -- Σ of all line totals (the trip total)
  v_unit_price bigint;
  v_admits integer;
  v_basis text;
  v_blocks integer;
  -- issue #1014: a NULL-currency (free-only) event's tickets carry NULL
  -- currency; track whether the cart saw one so mixing raises ONLY on money.
  v_saw_null_currency boolean := false;
  -- issue #2160 DELTA 2 of 6 — the day set, the mode, and the multiplier.
  v_day_ids uuid[];
  v_day_count integer := 0;
  v_pricing_mode text := 'per_day';
  v_day_multiplier integer := 1;
  v_qty_raw integer;
  v_cart_qty_for_type integer;
  v_day_id uuid;
  -- issue #3313: whether a day must be chosen, and capacity per night.
  v_day_choice jsonb;
  v_per_occurrence boolean := false;
  v_line_days uuid[]; -- issue #3281: this ticket's chosen dates, NULL for All dates
  v_night_taken integer;
  -- issue #3281 R3 — effective booked window (may bind fixed-slot opening).
  v_booked_start timestamptz := p_booked_start_at;
  v_booked_end timestamptz := p_booked_end_at;
  v_open_daily boolean := false;
  v_ctx jsonb;
  v_price jsonb;
  v_plan jsonb;
  v_code text;
  v_engine_lines jsonb := '[]'::jsonb;
  v_candidates jsonb;
  v_quote jsonb;
  v_extras jsonb;
  v_extras_total integer := 0;
  v_buyer jsonb;
  v_candidate_ids uuid[];
  v_queued boolean := false;
  v_list_total bigint := 0;
  v_list_due_today bigint := 0;
  v_ap jsonb;
  -- issue #3281 PR10 — optional per-date quantities on a line
  v_by_date jsonb;
  v_date_qty integer;
  v_ctx_price jsonb;
  v_sum integer;
  v_addon_mode text;
BEGIN
  IF COALESCE(p_payment_plan_choice, '') NOT IN ('auto', 'full', 'installments') THEN
    RAISE EXCEPTION 'payment_plan_choice_invalid';
  END IF;
  -- issue #4522 — how add-ons on a v2 plan are paid (today | spread), carried
  -- on the cart lines so every caller and wrapper keeps its signature.
  v_addon_mode := public.issue_4522_lines_addon_payment_mode(p_lines);

  IF p_buyer_phone_e164 IS NULL OR p_buyer_phone_e164 !~ '^\+[1-9][0-9]{1,14}$' THEN
    RAISE EXCEPTION 'buyer_phone_required';
  END IF;

  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'ticket_lines_required';
  END IF;

  SELECT *
    INTO v_existing
    FROM public.ticket_checkout_sessions
   WHERE idempotency_key = p_idempotency_key;

  IF FOUND THEN
    IF v_existing.status IN ('paid_completed','free_completed','failed','expired')
       OR v_existing.expires_at < now() THEN
      UPDATE public.ticket_checkout_sessions
         SET idempotency_key = idempotency_key || ':tombstone:' || id::text,
             status = CASE
               WHEN status IN ('paid_completed','free_completed','failed','expired') THEN status
               ELSE 'expired'
             END,
             failed_at = CASE
               WHEN status IN ('paid_completed','free_completed','failed','expired') THEN failed_at
               WHEN status IN ('pending_free','requires_payment','processing_payment','awaiting_web_redirect')
                 AND expires_at < now() THEN now()
               ELSE failed_at
             END,
             updated_at = now()
       WHERE id = v_existing.id;
    ELSE
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'ticketTypeId', i.ticket_type_id,
        'ticketName', i.ticket_name_at_purchase,
        'quantity', i.quantity,
        'unitPriceCents', i.unit_price_cents,
        'listUnitPriceCents', COALESCE(i.list_unit_price_cents,i.unit_price_cents),
        'discountCents', i.discount_cents,
        'totalCents', i.total_cents,
        'applied', i.applied_discounts
      ) ORDER BY i.created_at), '[]'::jsonb)
        INTO v_items
        FROM public.ticket_checkout_session_items i
       WHERE i.checkout_session_id = v_existing.id;

      RETURN jsonb_build_object(
        'checkoutSessionId', v_existing.id,
        'eventId', v_existing.event_id,
        'brandId', v_existing.brand_id,
        'status', v_existing.status,
        'totalCents', v_existing.total_cents,
        'subtotalCents', v_existing.total_cents,
        'listSubtotalCents', COALESCE(v_existing.list_subtotal_cents,v_existing.total_cents),
        'discountCents', v_existing.discount_cents,
        'currency', trim(v_existing.currency),
        'stripeAccountId', v_existing.stripe_account_id,
        'orderId', v_existing.order_id,
        'items', v_items,
        'lineItems', v_items,
        'installmentSchedule', v_existing.installment_schedule,
        'extras', public.issue_3281_session_extras(v_existing.id)->'items',
        'extrasTotalCents', (public.issue_3281_session_extras(v_existing.id)->>'totalCents')::integer
      );
    END IF;
  END IF;

  SELECT e.id, e.brand_id, e.visibility, e.status, e.deleted_at, e.event_type,
         e.capacity_scope, e.booking_spacing_minutes, e.is_recurring, e.recurrence_rules,
         s.stripe_account_id, s.charges_enabled,
         b.payment_provider
    INTO v_event
    FROM public.events e
    JOIN public.brands b ON b.id = e.brand_id
    LEFT JOIN public.stripe_connect_accounts s
      ON s.brand_id = e.brand_id
     AND s.detached_at IS NULL
   WHERE e.id = p_event_id
   FOR SHARE OF e;

  IF NOT FOUND OR v_event.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'event_not_found';
  END IF;
  IF v_event.visibility NOT IN ('public', 'hidden') OR NOT (v_event.status = ANY (ARRAY['scheduled'::text, 'live'::text])) THEN
    RAISE EXCEPTION 'event_not_selling';
  END IF;

  -- ══ issue #2562 — AN EVENT THAT HAS ALREADY HAPPENED CANNOT BE SOLD ═══
  --
  -- Before this, NOTHING on the reservation path asked whether the event was
  -- over. `event_not_selling` above checks `events.status`, and a finished
  -- event is still `scheduled` — status describes the LISTING, not the clock.
  -- The only thing standing between a guest and paying for a past event was an
  -- OPTIONAL per-tier `sale_end_at`, and six live tiers do not have one.
  --
  -- Proven against production before this guard existed: a checkout session for
  -- FIFA Grill Night — last occurrence ended 2026-07-26 — came back
  -- `status=requires_payment total=2000 currency=USD`, a month after the event.
  -- The buyer web blocked it; the Explorer app offered "Buy ticket"; the server
  -- accepted. A guarantee cannot rest on an optional field being filled in.
  --
  -- SCOPE, and both halves are deliberate:
  --   * Only fires when the event HAS occurrences. No rows means we do not know
  --     when it is, and refusing on unknown would be a different bug — one live
  --     event legitimately carries none.
  --   * `end_at > now()` allows an event that is CURRENTLY RUNNING, so walk-up
  --     sales during the event still work. It refuses only once every occurrence
  --     has finished.
  --
  -- This is the EVENT-level backstop. #2160's `occurrence_not_available` already
  -- refuses an individual chosen day that has passed; that guard only runs when
  -- the guest sent a day set, which is exactly why this one is needed too.
  --
  -- DELETE THIS BLOCK and a past event becomes payable again.
  IF EXISTS (SELECT 1 FROM public.event_dates d WHERE d.event_id = p_event_id)
     AND NOT EXISTS (
       SELECT 1 FROM public.event_dates d
        WHERE d.event_id = p_event_id AND d.end_at > now()
     ) THEN
    RAISE EXCEPTION 'event_already_ended';
  END IF;

  v_is_trip := v_event.event_type = 'trip';
  v_session_id := gen_random_uuid();

  -- #3872 TC-7: the base and quote share the same day/window owner.
  v_ctx := public.issue_3872_checkout_day_context(
    p_event_id,p_event_date_ids,p_booked_start_at,p_booked_end_at);
  SELECT ARRAY(SELECT value::uuid FROM jsonb_array_elements_text(
    CASE WHEN jsonb_typeof(v_ctx->'dayIds')='array' THEN v_ctx->'dayIds' ELSE '[]'::jsonb END
  )) INTO v_day_ids;
  v_day_count := COALESCE((v_ctx->>'dayCount')::integer,0);
  v_per_occurrence := COALESCE((v_ctx->>'perOccurrence')::boolean,false);
  v_pricing_mode := COALESCE(v_ctx->>'pricingMode','per_day');
  v_day_multiplier := COALESCE((v_ctx->>'dayMultiplier')::integer,1);
  v_booked_start := NULLIF(v_ctx->>'bookedStart','')::timestamptz;
  v_booked_end := NULLIF(v_ctx->>'bookedEnd','')::timestamptz;

  -- ══ issue #2462 — CANONICAL LOCK ORDER, TAKEN BEFORE PASS 1 ═══════════
  -- Pass 1 below takes `SELECT … FROM ticket_types … FOR UPDATE` once per
  -- line, in the order the CLIENT sent them, because
  -- `jsonb_array_elements(p_lines)` has no ORDER BY. The cart appends lines in
  -- the order the buyer TAPPED them (CartContext.tsx:290-292), so two guests
  -- who add the same two ticket types in opposite orders take the same two row
  -- locks in opposite orders and DEADLOCK. Postgres kills one; the RPC raises;
  -- the guest is told "Nothing was reserved — please try again". It can only
  -- happen under concurrency, on a multi-ticket-type cart, which is why it
  -- never reproduces in testing.
  --
  -- Proven on production: lines sent as [Day 2, Day 1] were processed
  -- [Day 2, Day 1] — lock order follows the client array verbatim.
  --
  -- Taking every lock ONCE here, ordered by primary key, makes the order
  -- total and identical for every caller. Pass 1's per-line FOR UPDATE then
  -- re-acquires a lock this transaction already holds, which is a no-op, so
  -- NOTHING below changes — including the order line items are inserted in,
  -- which the response's `items` array and its tests depend on.
  --
  -- DELETE THIS BLOCK and the deadlock returns under load.
  PERFORM 1
     FROM public.ticket_types tt
    WHERE tt.id IN (
            SELECT DISTINCT (l ->> 'ticketTypeId')::uuid
              FROM jsonb_array_elements(p_lines) AS l
             WHERE (l ->> 'ticketTypeId') IS NOT NULL
          )
      AND tt.event_id = p_event_id
      AND tt.deleted_at IS NULL
    ORDER BY tt.id
      FOR UPDATE;

  -- ---------------- Pass 1: validate lines + build line items (UNCHANGED). ----------------
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_line_count := v_line_count + 1;
    v_by_date := CASE
      WHEN jsonb_typeof(v_line -> 'byDate') = 'object' THEN v_line -> 'byDate'
      ELSE NULL
    END;
    IF v_by_date IS NOT NULL THEN
      -- Optional byDate only applies under per_day minting. all_days mints one
      -- pass entitled to every chosen day — per-date counts would be ignored
      -- and silently wrong. Reject at create so finalize never sees this shape.
      IF v_pricing_mode = 'all_days' THEN
        RAISE EXCEPTION 'by_date_not_supported_for_all_days';
      END IF;
      -- Optional byDate: quantity is the sum over chosen days; pricing skips the
      -- day multiplier (already expanded). Zero on a date is allowed; any
      -- non-zero must sit in [min, max] once the tier is loaded below.
      v_sum := 0;
      IF v_day_count = 0 THEN
        RAISE EXCEPTION 'ticket_quantity_invalid';
      END IF;
      FOREACH v_day_id IN ARRAY v_day_ids LOOP
        IF NOT (v_by_date ? v_day_id::text) THEN
          CONTINUE;
        END IF;
        v_date_qty := COALESCE((v_by_date ->> v_day_id::text)::integer, 0);
        IF v_date_qty < 0 THEN
          RAISE EXCEPTION 'ticket_quantity_invalid';
        END IF;
        v_sum := v_sum + v_date_qty;
      END LOOP;
      -- Reject unknown byDate keys outside the chosen set.
      IF EXISTS (
        SELECT 1
          FROM jsonb_object_keys(v_by_date) AS key
         WHERE NOT (key::uuid = ANY (v_day_ids))
      ) THEN
        RAISE EXCEPTION 'ticket_quantity_invalid';
      END IF;
      v_qty_raw := v_sum;
      v_ctx_price := v_ctx || jsonb_build_object('dayMultiplier', 1);
    ELSE
      v_qty_raw := COALESCE((v_line ->> 'quantity')::integer, 0);
      v_ctx_price := v_ctx;
    END IF;
    v_qty := v_qty_raw;
    IF v_qty <= 0 THEN
      RAISE EXCEPTION 'ticket_quantity_invalid';
    END IF;

    SELECT *
      INTO v_ticket_type
      FROM public.ticket_types
     WHERE id = (v_line ->> 'ticketTypeId')::uuid
       AND event_id = p_event_id
       AND deleted_at IS NULL
     FOR UPDATE;

    -- issue #3281 — a day-limited ticket only sells on its own dates.
    v_line_days := public.issue_3281_assert_line_days(
      v_ticket_type.id, v_by_date, v_day_ids, v_pricing_mode);

    -- Per-date min/max when byDate is present (decision 8).
    IF v_by_date IS NOT NULL THEN
      FOREACH v_day_id IN ARRAY v_day_ids LOOP
        v_date_qty := COALESCE((v_by_date ->> v_day_id::text)::integer, 0);
        IF v_date_qty = 0 THEN
          CONTINUE;
        END IF;
        IF v_date_qty < v_ticket_type.min_purchase_qty THEN
          RAISE EXCEPTION 'ticket_quantity_below_min';
        END IF;
        IF v_ticket_type.max_purchase_qty IS NOT NULL
           AND v_date_qty > v_ticket_type.max_purchase_qty THEN
          RAISE EXCEPTION 'ticket_quantity_above_max';
        END IF;
      END LOOP;
    END IF;

    v_price := public.issue_3872_ticket_line_price(
      p_event_id,v_ticket_type.id,v_qty_raw,v_ctx_price,p_expires_at,p_booked_party_size);
    v_qty := (v_price->>'quantity')::integer;
    -- #3872: quantity already includes the shared day multiplier.
    -- META-ORCH-1174 B1 — PER-PACKAGE capacity (DEC-1174-D): each ticket_type's
    -- own quantity_total is its own cap. This was already correct (per-line),
    -- and is the only capacity model multi-package needs.
    IF NOT v_ticket_type.is_unlimited THEN
      -- issue #2491 C2 step 3 — THE COUNTER, not the count.
      -- Was: COUNT(*) over public.tickets, measured at 18.71 ms per call once a
      -- ticket type holds 100k rows, executed INSIDE the serialized critical
      -- section so every other buyer waits behind it. Now a column read.
      -- sold_count is maintained by issue_2491_tickets_counters, which fires on
      -- INSERT, DELETE and UPDATE OF (status, ticket_type_id) — precisely the
      -- columns this formula reads — and RECOMPUTES from
      -- issue_2491_derived_sold rather than incrementing. Its only failure mode
      -- is structural (the trigger removed), never gradual, and 288 consecutive
      -- shadow observations over 77.7 h reported zero drift across 699 sales.
      -- ══ issue #3313 — CAPACITY PER NIGHT ON A RECURRING EVENT (Seth) ═══
      -- quantity_total is the capacity of EACH night, not of the whole run.
      -- For every chosen night: places already taken that night (sold + held,
      -- issue_3313_ticket_type_occurrence_taken — the ONE per-night counter,
      -- also used by the public reader's `remaining`) plus this cart's raw
      -- quantity of the type must fit. per_day stores quantity x D and mints q
      -- passes per night; all_days mints q passes valid on every chosen night;
      -- both consume q places per night. Every other event keeps the shared
      -- check below, verbatim.
      -- DELETE THIS BRANCH and a recurring event's 60 places are shared by
      -- every night of the run.
      -- issue #3281 — a day-limited ticket's capacity is per date, on its own
      -- dates only. All dates tickets keep the shared check below.
      IF (v_per_occurrence OR v_line_days IS NOT NULL) AND v_day_count > 0 THEN
        IF v_ticket_type.quantity_total IS NOT NULL THEN
          FOREACH v_day_id IN ARRAY COALESCE(v_line_days, v_day_ids) LOOP
            SELECT COALESCE(SUM(public.issue_3281_line_qty_for_date(l, v_day_id)), 0)::integer
              INTO v_cart_qty_for_type
              FROM jsonb_array_elements(p_lines) AS l
             WHERE (l ->> 'ticketTypeId')::uuid = v_ticket_type.id;
            v_night_taken := public.issue_3313_ticket_type_occurrence_taken(
              v_ticket_type.id, v_day_id
            );
            IF v_night_taken + v_cart_qty_for_type > v_ticket_type.quantity_total THEN
              RAISE EXCEPTION 'ticket_capacity_exceeded'
                USING DETAIL = v_day_id::text;
            END IF;
          END LOOP;
        END IF;
      ELSIF v_event.event_type = 'experience'
            AND COALESCE(v_event.capacity_scope, 'total') IN ('per_day', 'per_start') THEN
        -- Scoped counters are enforced in the R3 block below; skip lifetime.
        NULL;
      ELSE
      -- (the shared check, verbatim from 20270609002879)
      SELECT tt2.sold_count
        INTO v_sold
        FROM public.ticket_types tt2
       WHERE tt2.id = v_ticket_type.id;

      SELECT COALESCE(SUM(i.quantity), 0)::integer
        INTO v_reserved
        FROM public.ticket_checkout_session_items i
        JOIN public.ticket_checkout_sessions s ON s.id = i.checkout_session_id
       WHERE i.ticket_type_id = v_ticket_type.id
         AND s.expires_at > now()
         AND s.status IN ('pending_free', 'requires_payment', 'processing_payment', 'awaiting_web_redirect');

      -- ══ issue #2160 DELTA 5 of 6 — CAPACITY AGGREGATES PER TICKET TYPE ═
      -- THIS ONE PROTECTS MONEY. The pre-#2160 check compared
      -- `v_sold + v_reserved + v_qty` where v_qty is THIS LINE alone, and
      -- the current session's own items are inserted AFTER this loop — so a
      -- second line of the SAME ticket_type in the same cart was invisible
      -- to the first line's check and both passed independently.
      --
      -- Honest scoping: under the amendment's session-level day set, lines
      -- are never expanded, so multi-day does NOT create this shape. The
      -- hole is real but LATENT, exactly as it is today — this is hardening,
      -- not the load-bearing fix the pre-amendment spec described. It is
      -- kept because it is two lines inside a function being re-emitted
      -- anyway and any future feature that sends two lines of one type
      -- (bundles, add-ons) walks straight into it.
      --
      -- DELETE THE AGGREGATION and a cart with two lines of a
      -- quantity_total=1 ticket type mints 2 tickets against a cap of 1.
      SELECT COALESCE(SUM(
          CASE
            WHEN jsonb_typeof(l -> 'byDate') = 'object' THEN
              public.issue_3281_line_qty_sum(l)
            ELSE
              COALESCE((l ->> 'quantity')::integer, 0) * v_day_multiplier
          END
        ), 0)::integer
        INTO v_cart_qty_for_type
        FROM jsonb_array_elements(p_lines) AS l
       WHERE (l ->> 'ticketTypeId')::uuid = v_ticket_type.id;

      IF v_ticket_type.quantity_total IS NOT NULL
         AND v_sold + v_reserved + v_cart_qty_for_type > v_ticket_type.quantity_total THEN
        RAISE EXCEPTION 'ticket_capacity_exceeded';
      END IF;
      END IF;
    END IF;

    -- issue #1014 delta (2): null-safe cart mixing. An all-NULL (all-free)
    -- cart never raises; two DIFFERENT non-null currencies always raise;
    -- null-vs-non-null mixing is checked AFTER the loop (raises only when
    -- the cart carries money — see the post-loop gate).
    IF v_ticket_type.currency IS NOT NULL THEN
      IF v_currency IS NULL THEN
        v_currency := v_ticket_type.currency;
      ELSIF v_currency IS DISTINCT FROM v_ticket_type.currency THEN
        RAISE EXCEPTION 'mixed_currency_cart';
      END IF;
    ELSE
      v_saw_null_currency := true;
    END IF;

    IF v_first_ticket_type_id IS NULL THEN
      v_first_ticket_type_id := v_ticket_type.id;
    END IF;

    -- #3872 TC-8: list unit and scaling come from the shared line owner.
    v_unit_price := (v_price->>'unitPriceCents')::bigint;
    v_admits := (v_price->>'admitsCount')::integer;
    v_basis := v_price->>'priceBasis';
    v_blocks := NULLIF(v_price->>'blocks','')::integer;

    -- issue #3281 R3 — capacity_scope counters (cart-aggregated like lifetime).
    -- Same byDate / day-multiplier expansion as the lifetime quantity_total
    -- gate above so experience scopes cannot under-count uneven carts.
    IF v_event.event_type = 'experience'
       AND v_ticket_type.quantity_total IS NOT NULL THEN
      SELECT COALESCE(SUM(
          CASE
            WHEN jsonb_typeof(l -> 'byDate') = 'object' THEN
              public.issue_3281_line_qty_sum(l)
            ELSE
              COALESCE((l ->> 'quantity')::integer, 0) * v_day_multiplier
          END
        ), 0)::integer
        INTO v_cart_qty_for_type
        FROM jsonb_array_elements(p_lines) AS l
       WHERE (l ->> 'ticketTypeId')::uuid = v_ticket_type.id;
      IF COALESCE(v_event.capacity_scope, 'total') = 'per_start'
         AND v_booked_start IS NOT NULL THEN
        IF public.issue_3281_ticket_type_slot_taken(
             v_ticket_type.id,
             CASE WHEN v_day_count = 1 THEN v_day_ids[1] ELSE NULL END,
             v_booked_start,
             COALESCE(
               v_booked_end,
               v_booked_start + make_interval(
                 mins => GREATEST(1, COALESCE(v_event.booking_spacing_minutes, 30))
               )
             ),
             NULL
           ) + v_cart_qty_for_type > v_ticket_type.quantity_total THEN
          RAISE EXCEPTION 'slot_full';
        END IF;
      ELSIF COALESCE(v_event.capacity_scope, 'total') = 'per_day'
         AND v_day_count = 1 THEN
        IF public.issue_3313_ticket_type_occurrence_taken(
             v_ticket_type.id, v_day_ids[1]
           ) + v_cart_qty_for_type > v_ticket_type.quantity_total THEN
          RAISE EXCEPTION 'ticket_capacity_exceeded';
        END IF;
      ELSIF v_booked_start IS NOT NULL THEN
        IF public.issue_3281_ticket_type_slot_taken(
             v_ticket_type.id,
             CASE WHEN v_day_count = 1 THEN v_day_ids[1] ELSE NULL END,
             v_booked_start,
             COALESCE(
               v_booked_end,
               v_booked_start + make_interval(
                 mins => GREATEST(1, COALESCE(v_event.booking_spacing_minutes, 30))
               )
             ),
             NULL
           ) + v_cart_qty_for_type > v_ticket_type.quantity_total THEN
          RAISE EXCEPTION 'slot_full';
        END IF;
      END IF;
    END IF;

    v_total := v_total + (v_unit_price * v_qty);
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'ticketTypeId', v_ticket_type.id,
      'ticketName', v_ticket_type.name,
      'quantity', v_qty,
      'unitPriceCents', v_unit_price,
      'listUnitPriceCents', v_unit_price,
      'discountCents', 0,
      'totalCents', v_unit_price * v_qty,
      'admitsCount', v_admits,
      'valueScale', (v_price->>'valueScale')::integer,
      'countScale', (v_price->>'countScale')::integer,
      'discountsAllowed', (v_price->>'discountsAllowed')::boolean,
      'priceBasis', v_price->>'priceBasis',
      'isFree', (v_price->>'isFree')::boolean,
      'applied', '[]'::jsonb
    ) || CASE
      WHEN v_by_date IS NOT NULL THEN jsonb_build_object('byDate', v_by_date)
      ELSE '{}'::jsonb
    END);
  END LOOP;

  -- The full trip total (Σ all line totals) — used for the persisted schedule's
  -- fullPriceCents (informational; the buyer-facing receipt shows the trip total).
  v_list_total := v_total;
  v_code := NULLIF(upper(regexp_replace(btrim(COALESCE(p_discount_code,'')),'[\s-]','','g')),'');
  IF v_code IS NOT NULL AND (length(v_code)>32 OR v_code!~'^[A-Z0-9]+$') THEN
    RAISE EXCEPTION 'discount_code_invalid';
  END IF;
  v_queued := p_expires_at='infinity'::timestamptz;
  v_buyer := jsonb_build_object('email',lower(btrim(p_buyer_email)),
    'phone',p_buyer_phone_e164,'userId',p_buyer_user_id);
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'lineRef',i->>'ticketTypeId','itemKind','ticket_type','itemId',i->'ticketTypeId',
    'listingId',p_event_id,'listingKind',v_event.event_type,
    'listUnitMinor',(i->>'listUnitPriceCents')::integer,'qty',(i->>'quantity')::integer,
    'valueScale',(i->>'valueScale')::integer,'countScale',(i->>'countScale')::integer,
    'allowed',(i->>'discountsAllowed')::boolean AND NOT (i->>'isFree')::boolean,
    'tz',COALESCE(v_ctx->>'eventTimezone','UTC')) ORDER BY ord),'[]'::jsonb)
    INTO v_engine_lines FROM jsonb_array_elements(v_items) WITH ORDINALITY a(i,ord);
  v_candidates:=public.issue_3872_discount_candidates(
    v_event.brand_id,v_engine_lines,v_code,v_buyer,now());
  SELECT COALESCE(array_agg((x->>'id')::uuid),'{}'::uuid[]) INTO v_candidate_ids FROM (
    SELECT value x FROM jsonb_array_elements(v_candidates->'automatics')
    UNION ALL SELECT v_candidates->'code' WHERE v_candidates->'code' IS NOT NULL
  ) c;
  PERFORM public.issue_3872_lock_limited_discounts(v_candidate_ids);
  v_candidates:=public.issue_3872_discount_candidates(
    v_event.brand_id,v_engine_lines,v_code,v_buyer,now());
  v_quote:=public.issue_3872_discount_apply(jsonb_build_object(
    'currency',trim(v_currency),'at',now(),'queued',v_queued,'lines',v_engine_lines,
    'automatics',v_candidates->'automatics','code',v_candidates->'code',
    'codeLookup',v_candidates->>'codeLookup'));
  -- issue #3281 — extras: locked and priced after discounts, inside this hold.
  v_extras := public.issue_3281_price_extras(p_event_id, p_lines, v_day_ids, true);
  v_extras_total := (v_extras->>'totalCents')::integer;
  IF p_expected_quote_digest IS NOT NULL
     AND p_expected_quote_digest IS DISTINCT FROM
       public.issue_3281_quote_digest(v_quote->>'digest', v_extras) THEN
    RAISE EXCEPTION 'checkout_quote_changed';
  END IF;
  SELECT COALESCE(jsonb_agg(i || jsonb_build_object(
    'unitPriceCents',(q->>'netUnitMinor')::integer,
    'totalCents',(q->>'lineNetMinor')::integer,
    'discountCents',(q->>'lineDiscountMinor')::integer,
    'unitsCounted',(q->>'unitsCounted')::integer,
    'applied',q->'applied') ORDER BY ord),'[]'::jsonb)
    INTO v_items
    FROM jsonb_array_elements(v_items) WITH ORDINALITY a(i,ord)
    JOIN jsonb_array_elements(v_quote->'lines') q ON q->>'lineRef'=i->>'ticketTypeId';
  v_total := (v_quote->>'netSubtotalMinor')::integer;
  v_list_total := (v_quote->>'listSubtotalMinor')::bigint;
  v_full_price_cents := v_total;

  -- issue #1014 delta (2), post-loop leg: a cart mixing NULL-currency and
  -- currency-bearing tickets is legal ONLY when it carries no money (schema-
  -- impossible per-event today; defensive for cross-era rows).
  IF v_saw_null_currency AND v_currency IS NOT NULL AND v_total > 0 THEN
    RAISE EXCEPTION 'mixed_currency_cart';
  END IF;

  -- #3872 TC-12: net and list due-today totals share one plan owner.
  v_plan := public.issue_3872_plan_due_today(p_event_id,v_items,p_payment_plan_choice);
  v_total := (v_plan->>'dueTodayNetCents')::integer;
  v_list_due_today := (v_plan->>'dueTodayListCents')::bigint;
  v_any_installments := v_plan->'installmentSchedule' IS NOT NULL
    AND v_plan->'installmentSchedule'<>'null'::jsonb;
  v_unioned := v_plan->'installmentSchedule';
  IF jsonb_array_length(v_extras->'items') > 0 THEN
    IF v_extras_total > 0 AND v_full_price_cents = 0 THEN
      RAISE EXCEPTION 'extras_need_paid_ticket';
    END IF;
    IF v_any_installments THEN
      -- issue #4522 — add-ons ride only a v2 plan, and only with #3281's plan switch on.
      IF COALESCE((v_plan->>'planVersion')::integer, 1) <> 2
         OR NOT public.issue_3281_add_on_switch('plan_enabled') THEN
        RAISE EXCEPTION 'extras_not_on_installments';
      END IF;
      v_plan := public.issue_4522_plan_cart_v2(p_event_id, v_items, p_payment_plan_choice, now(),
        v_extras, COALESCE(v_addon_mode, 'today'));
      v_total := (v_plan->>'dueTodayNetCents')::integer;
      v_list_due_today := (v_plan->>'dueTodayListCents')::bigint;
      v_unioned := v_plan->'installmentSchedule';
    END IF;
    -- issue #4522 — spread add-ons already sit on the plan rows.
    v_total := v_total + v_extras_total - COALESCE((v_plan->>'addonScheduledCents')::integer, 0);
    v_list_due_today := v_list_due_today + v_extras_total
      - COALESCE((v_plan->>'addonScheduledCents')::bigint, 0);
    v_list_total := v_list_total + v_extras_total;
    v_full_price_cents := v_full_price_cents + v_extras_total;
  END IF;

  v_status := CASE WHEN v_total = 0 THEN 'pending_free' ELSE 'requires_payment' END;
  IF v_total > 0 AND v_event.payment_provider = 'stripe'
     AND (v_event.stripe_account_id IS NULL OR v_event.charges_enabled IS DISTINCT FROM true) THEN
    RAISE EXCEPTION 'stripe_account_not_ready';
  END IF;
  v_stripe_account_id := CASE
    WHEN v_total > 0 AND v_event.payment_provider = 'stripe' THEN v_event.stripe_account_id
    ELSE NULL
  END;

  -- issue #1014 delta (3): belt-and-braces — money never enters a session
  -- without a currency (unreachable given the (a) CHECKs: paid tickets always
  -- carry currency — but the RPC stays self-defending).
  IF v_total > 0 AND v_currency IS NULL THEN
    RAISE EXCEPTION 'event_currency_required';
  END IF;

  INSERT INTO public.ticket_checkout_sessions (
    id, event_id, brand_id, buyer_user_id, buyer_name, buyer_email, buyer_phone_e164,
    marketing_opt_in, list_subtotal_cents, discount_cents,
    subtotal_cents, application_fee_amount_cents, total_cents,
    currency, status, idempotency_key, cart_fingerprint, expires_at,
    stripe_account_id, stripe_application_fee_amount_cents,
    installment_schedule,
    -- issue #2160 — the mode this reservation was PRICED under. Finalize mints
    -- under this value, never a fresh read (§A.7).
    multi_date_pricing_mode_snapshot,
    -- issue #3281 — guest-chosen start (open-daily); NULL = legacy / slots / flag-off.
    booked_start_at,
    booked_end_at,
    booked_party_size,
    -- issue #4522 — v2 plan terms and the add-on choice, frozen with the session.
    payment_plan_terms,
    addon_payment_mode
  ) VALUES (
    v_session_id, p_event_id, v_event.brand_id, p_buyer_user_id, trim(p_buyer_name),
    lower(trim(p_buyer_email)), p_buyer_phone_e164, COALESCE(p_marketing_opt_in, false),
    v_list_due_today::integer, (v_list_due_today-v_total)::integer,
    v_total, COALESCE(p_application_fee_amount_cents, 0), v_total,
    v_currency, v_status, p_idempotency_key,
    md5(v_items::text), p_expires_at, v_stripe_account_id, COALESCE(p_application_fee_amount_cents, 0),
    CASE WHEN v_any_installments THEN v_unioned ELSE NULL END,
    v_pricing_mode,
    v_booked_start,
    v_booked_end,
    p_booked_party_size,
    CASE WHEN v_any_installments THEN v_plan->'paymentPlanTerms' END,
    CASE WHEN v_any_installments THEN v_plan->>'addonPaymentMode' END
  );

  FOR v_line IN SELECT * FROM jsonb_array_elements(v_items)
  LOOP
    INSERT INTO public.ticket_checkout_session_items (
      checkout_session_id, ticket_type_id, ticket_name_at_purchase, quantity,
      unit_price_cents, total_cents, list_unit_price_cents, discount_cents,
      units_counted, applied_discounts, by_date
    ) VALUES (
      v_session_id,
      (v_line ->> 'ticketTypeId')::uuid,
      v_line ->> 'ticketName',
      (v_line ->> 'quantity')::integer,
      (v_line ->> 'unitPriceCents')::integer,
      (v_line ->> 'totalCents')::integer,
      (v_line ->> 'listUnitPriceCents')::integer,
      (v_line ->> 'discountCents')::integer,
      (v_line ->> 'unitsCounted')::integer,
      COALESCE(v_line->'applied','[]'::jsonb),
      CASE WHEN jsonb_typeof(v_line -> 'byDate') = 'object' THEN v_line -> 'byDate' ELSE NULL END
    );
  END LOOP;

  -- issue #3281 — the extras hold their places with the session.
  INSERT INTO public.ticket_checkout_session_add_on_items (
    checkout_session_id, ticket_add_on_id, ticket_type_id, add_on_name_at_purchase,
    ticket_type_name_at_purchase, day_scope, quantity, unit_price_cents, total_cents,
    plan_choice
  )
  SELECT v_session_id, (x->>'addOnId')::uuid, (x->>'ticketTypeId')::uuid, x->>'addOnName',
         x->>'ticketName',
         CASE WHEN jsonb_typeof(x->'dayScope') = 'array'
           THEN ARRAY(SELECT jsonb_array_elements_text(x->'dayScope')) END,
         (x->>'quantity')::integer, (x->>'unitPriceCents')::integer, (x->>'totalCents')::integer,
         -- issue #4522 / #3281 §9 — the add-on choice when it rides a v2 plan.
         CASE WHEN v_any_installments THEN v_plan->>'addonPaymentMode' END
    FROM jsonb_array_elements(v_extras->'items') AS x;

  -- Reserve every applied definition in the same transaction as inventory.
  FOR v_ap IN SELECT value FROM jsonb_array_elements(COALESCE(v_quote->'applied','[]'::jsonb)) LOOP
    INSERT INTO public.discount_uses(
      discount_id,brand_id,checkout_kind,checkout_ref_id,buyer_user_id,
      buyer_email_norm,buyer_phone_e164,status,units,amount_minor,expires_at,channel)
    VALUES((v_ap->>'discountId')::uuid,v_event.brand_id,'ticket',v_session_id,p_buyer_user_id,
      NULLIF(lower(btrim(p_buyer_email)),''),p_buyer_phone_e164,'reserved',
      (v_ap->>'units')::integer,(v_ap->>'amountMinor')::integer,p_expires_at,'online')
    ON CONFLICT(discount_id,checkout_kind,checkout_ref_id) DO NOTHING;
  END LOOP;

  -- ══ issue #2160 DELTA 6 of 6 — PERSIST THE CHOSEN DAY SET ═════════════
  -- The finalize base reads these rows to distribute ticket_event_dates
  -- entitlements. DELETE THIS LOOP and every pass mints with zero days, so
  -- a guest who chose Saturday is silently admitted on every day of the
  -- event — and a guest who paid for two days gets one pass, not two.
  IF v_day_count > 0 THEN
    FOREACH v_day_id IN ARRAY v_day_ids LOOP
      INSERT INTO public.ticket_checkout_session_event_dates (
        checkout_session_id, event_date_id
      ) VALUES (v_session_id, v_day_id)
      ON CONFLICT DO NOTHING;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'checkoutSessionId', v_session_id,
    'eventId', p_event_id,
    'brandId', v_event.brand_id,
    'status', v_status,
    'totalCents', v_total,
    'subtotalCents', v_total,
    'listSubtotalCents', v_list_due_today,
    'discountCents', v_list_due_today-v_total,
    'fullListCents', v_list_total,
    'fullNetCents', v_full_price_cents,
    'currency', trim(v_currency),
    'stripeAccountId', v_stripe_account_id,
    'orderId', NULL,
    'items', v_items,
    'lineItems', v_items,
    'installmentSchedule', v_plan->'installmentSchedule',
    'quoteDigest', public.issue_3281_quote_digest(v_quote->>'digest', v_extras),
    'quoteListDigest', v_quote->>'listDigest',
    'discounts', v_quote->'applied',
    'codeOutcome', v_quote->'codeOutcome',
    'notices', v_quote->'notices',
    'extras', v_extras->'items',
    'extrasTotalCents', v_extras_total
  )
  -- issue #4522 — present only when the cart took the v2 planner.
  || CASE WHEN v_plan ? 'planVersion'
       THEN jsonb_build_object('addonPaymentMode', v_plan->'addonPaymentMode')
       ELSE '{}'::jsonb END;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 7. Finalize: v2 row columns, frozen terms, the add-on choice.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_1930_ticket_checkout_finalize_base(p_checkout_session_id uuid, p_stripe_payment_intent_id text, p_stripe_charge_id text, p_stripe_payment_method_type text, p_qr_token_pepper text, p_stripe_customer_id_on_connected_account text DEFAULT NULL::text, p_saved_payment_method_id text DEFAULT NULL::text, p_installment_plan_root boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_session record;
  v_item record;
  v_order_id uuid;
  v_ticket_id uuid;
  v_token text;
  v_token_hash text;
  v_qr text;
  v_tickets jsonb := '[]'::jsonb;
  v_now timestamptz := now();
  v_method text;
  v_qr_token_pepper text;
  i integer;
  v_schedule jsonb;
  v_inst_array jsonb;
  v_inst_item jsonb;
  v_inst_count int;
  v_idx int;
  v_inst_amount bigint;
  v_inst_currency char(3);
  v_inst_due timestamptz;
  -- issue #2160 DELTA 1 of 4 — the pricing mode and the chosen day set.
  v_pricing_mode text := 'per_day';
  v_days uuid[];
  v_line_days uuid[]; -- issue #3281: the dates this line's passes admit
  v_day_count integer;
  v_date_qty integer := 0;
  v_day_id uuid;
  -- issue #3827 — the mint helper's result.
  v_mint jsonb;
BEGIN
  v_qr_token_pepper := public.biz_ticket_checkout_assert_qr_pepper(p_qr_token_pepper);

  SELECT *
    INTO v_session
    FROM public.ticket_checkout_sessions
   WHERE id = p_checkout_session_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'checkout_session_not_found';
  END IF;

  IF v_session.order_id IS NOT NULL THEN
    -- ORCH-0921: replace the silent early-return with compare-and-correct.
    -- When the second caller passes p_installment_plan_root=true AND the
    -- existing order row has installment_plan_root=false AND the session
    -- carries an installment_schedule AND zero order_installments rows exist,
    -- backfill the missing installment-plan state. Idempotent: re-running
    -- after the backfill is a no-op (the EXISTS checks prevent duplicate
    -- INSERTs and redundant UPDATEs).
    IF p_installment_plan_root
       AND v_session.installment_schedule IS NOT NULL
       -- issue #3645: a Paystack plan has no Stripe customer/card pair.
       AND ((p_stripe_customer_id_on_connected_account IS NOT NULL
             AND p_saved_payment_method_id IS NOT NULL)
            OR public.issue_3645_finalize_is_paystack(p_stripe_payment_intent_id, p_stripe_charge_id))
       AND EXISTS (
         SELECT 1 FROM public.orders
         WHERE id = v_session.order_id
           AND installment_plan_root = false
       )
       AND NOT EXISTS (
         SELECT 1 FROM public.order_installments
         WHERE order_id = v_session.order_id
       )
    THEN
      v_schedule := v_session.installment_schedule;
      v_inst_array := v_schedule -> 'installments';
      v_inst_currency := COALESCE((v_schedule ->> 'currency')::char(3), v_session.currency);
      v_inst_count := COALESCE(jsonb_array_length(v_inst_array), 0);

      FOR v_idx IN 0 .. v_inst_count - 1 LOOP
        v_inst_item := v_inst_array -> v_idx;
        v_inst_amount := COALESCE((v_inst_item ->> 'amountCents')::bigint, 0);
        v_inst_due := (v_inst_item ->> 'dueAt')::timestamptz;

        IF v_inst_amount <= 0 THEN
          RAISE EXCEPTION 'installment_amount_invalid';
        END IF;

        INSERT INTO public.order_installments (
          order_id, ordinal, amount_cents, currency, due_at, status,
          provider, collection_method, plan_bound_at,
          kind, schedule_version, addon_portion_minor, ticket_type_id
        ) VALUES (
          v_session.order_id,
          (v_inst_item ->> 'ordinal')::smallint,
          v_inst_amount,
          v_inst_currency,
          v_inst_due,
          'scheduled',
          CASE WHEN public.issue_3645_finalize_is_paystack(p_stripe_payment_intent_id, p_stripe_charge_id)
               THEN 'paystack' ELSE 'stripe' END,
          CASE WHEN public.issue_3645_finalize_is_paystack(p_stripe_payment_intent_id, p_stripe_charge_id)
               THEN 'pay_link' ELSE 'auto_card' END,
          CASE WHEN public.issue_3645_finalize_is_paystack(p_stripe_payment_intent_id, p_stripe_charge_id)
               THEN NULL ELSE now() END,
          -- issue #4522 — a planned row, version 0, with its spread add-on share.
          'scheduled', 0, COALESCE((v_inst_item ->> 'addonPortionCents')::bigint, 0),
          -- v2 rows name their package (rebalance and flex allocation); v1 stays NULL.
          NULLIF(v_inst_item ->> 'sourceTicketTypeId', '')::uuid
        );
      END LOOP;

      UPDATE public.orders
         SET installment_plan_root = true,
             -- issue #4522 — the v2 terms and add-on choice frozen at checkout.
             payment_plan_terms = v_session.payment_plan_terms,
             addon_payment_mode = v_session.addon_payment_mode,
             stripe_customer_id_on_connected_account = p_stripe_customer_id_on_connected_account,
             saved_payment_method_id = p_saved_payment_method_id,
             updated_at = now()
       WHERE id = v_session.order_id;
    END IF;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'ticketId', t.id,
      'ticketTypeId', t.ticket_type_id,
      'ticketName', tt.name,
      'qrPayload', t.qr_code,
      'status', t.status,
      -- issue #2160 DELTA 2 of 4 — the days THIS pass admits, so the client
      -- can label it without a second read. `[]` for every pre-#2160 pass,
      -- which is what "not day-scoped" looks like on the wire.
      'eventDateIds', COALESCE((
        SELECT jsonb_agg(ted.event_date_id ORDER BY ed.start_at, ed.id)
          FROM public.ticket_event_dates ted
          JOIN public.event_dates ed ON ed.id = ted.event_date_id
         WHERE ted.ticket_id = t.id), '[]'::jsonb)
    ) ORDER BY t.created_at), '[]'::jsonb)
      INTO v_tickets
      FROM public.tickets t
      JOIN public.ticket_types tt ON tt.id = t.ticket_type_id
     WHERE t.order_id = v_session.order_id;

    RETURN jsonb_build_object(
      'orderId', v_session.order_id,
      'checkoutSessionId', v_session.id,
      'eventId', v_session.event_id,
      'paymentStatus', 'paid',
      'totalCents', v_session.total_cents,
      'currency', trim(v_session.currency),
      'tickets', v_tickets,
      'notificationStatus', 'queued',
      'installmentPlanRoot', (
        SELECT installment_plan_root FROM public.orders WHERE id = v_session.order_id
      )
    );
  END IF;

  IF v_session.total_cents > 0 AND COALESCE(p_stripe_payment_intent_id, v_session.stripe_payment_intent_id) IS NULL THEN
    RAISE EXCEPTION 'payment_intent_required';
  END IF;

  v_order_id := gen_random_uuid();
  v_method := CASE
    WHEN v_session.total_cents = 0 THEN 'free'
    WHEN p_stripe_payment_method_type = 'apple_pay' THEN 'apple_pay'
    WHEN p_stripe_payment_method_type = 'google_pay' THEN 'google_pay'
    ELSE 'online_card'
  END;

  v_schedule := v_session.installment_schedule;

  INSERT INTO public.orders (
    id, event_id, buyer_user_id, buyer_email, buyer_name, buyer_phone,
    buyer_phone_e164, total_cents, currency, payment_method, payment_status,
    stripe_payment_intent_id, stripe_charge_id, is_door_sale, metadata,
    checkout_session_id, source, confirmed_at, notification_status,
    stripe_application_fee_amount_cents, stripe_transfer_destination,
    stripe_payment_method_type, stripe_payment_intent_status, created_at, updated_at,
    installment_plan_root,
    stripe_customer_id_on_connected_account,
    saved_payment_method_id,
    pricing_breakdown,
    -- ORCH-1188 FIX 3b: persist the buyer's selected occurrence (NULL-safe).
    event_date_id,
    -- issue #3281 — copy session booked start onto the paid order.
    booked_start_at,
    booked_end_at,
    booked_party_size,
    -- issue #4522 — the v2 terms and add-on choice frozen at checkout.
    payment_plan_terms,
    addon_payment_mode
  ) VALUES (
    v_order_id, v_session.event_id, v_session.buyer_user_id, v_session.buyer_email,
    v_session.buyer_name, v_session.buyer_phone_e164, v_session.buyer_phone_e164,
    v_session.total_cents, v_session.currency, v_method, 'paid',
    COALESCE(p_stripe_payment_intent_id, v_session.stripe_payment_intent_id),
    p_stripe_charge_id, false,
    jsonb_build_object(
      'checkout_session_id', v_session.id,
      'marketing_opt_in', v_session.marketing_opt_in
    ),
    v_session.id, 'online_checkout', v_now, 'pending',
    COALESCE(v_session.stripe_application_fee_amount_cents, 0), v_session.stripe_account_id,
    p_stripe_payment_method_type,
    CASE WHEN v_session.total_cents = 0 THEN NULL ELSE 'succeeded' END,
    v_now, v_now,
    COALESCE(p_installment_plan_root AND v_schedule IS NOT NULL, false),
    CASE WHEN p_installment_plan_root THEN p_stripe_customer_id_on_connected_account ELSE NULL END,
    CASE WHEN p_installment_plan_root THEN p_saved_payment_method_id ELSE NULL END,
    v_session.pricing_breakdown,
    -- ORCH-1188 FIX 3b: the occurrence the buyer booked, read from the session
    -- metadata jsonb (NULL for single-date events / no selection). NULLIF guards
    -- an empty string, ::uuid is NULL-safe on NULL input.
    NULLIF(v_session.metadata->>'event_date_id', '')::uuid,
    v_session.booked_start_at,
    v_session.booked_end_at,
    v_session.booked_party_size,
    CASE WHEN p_installment_plan_root AND v_schedule IS NOT NULL THEN v_session.payment_plan_terms END,
    CASE WHEN p_installment_plan_root AND v_schedule IS NOT NULL THEN v_session.addon_payment_mode END
  );

  IF p_installment_plan_root AND v_schedule IS NOT NULL THEN
    -- issue #3645: Stripe plans need the customer + saved card; a Paystack plan
    -- binds its price (and any reusable card) right after finalize.
    IF NOT public.issue_3645_finalize_is_paystack(p_stripe_payment_intent_id, p_stripe_charge_id)
       AND (p_stripe_customer_id_on_connected_account IS NULL OR p_saved_payment_method_id IS NULL) THEN
      RAISE EXCEPTION 'installment_plan_finalize_missing_customer_or_pm';
    END IF;

    v_inst_array := v_schedule -> 'installments';
    v_inst_currency := COALESCE((v_schedule ->> 'currency')::char(3), v_session.currency);
    v_inst_count := COALESCE(jsonb_array_length(v_inst_array), 0);

    FOR v_idx IN 0 .. v_inst_count - 1 LOOP
      v_inst_item := v_inst_array -> v_idx;
      v_inst_amount := COALESCE((v_inst_item ->> 'amountCents')::bigint, 0);
      v_inst_due := (v_inst_item ->> 'dueAt')::timestamptz;

      IF v_inst_amount <= 0 THEN
        RAISE EXCEPTION 'installment_amount_invalid';
      END IF;

      INSERT INTO public.order_installments (
        order_id, ordinal, amount_cents, currency, due_at, status,
        provider, collection_method, plan_bound_at,
        kind, schedule_version, addon_portion_minor, ticket_type_id
      ) VALUES (
        v_order_id,
        (v_inst_item ->> 'ordinal')::smallint,
        v_inst_amount,
        v_inst_currency,
        v_inst_due,
        'scheduled',
        CASE WHEN public.issue_3645_finalize_is_paystack(p_stripe_payment_intent_id, p_stripe_charge_id)
             THEN 'paystack' ELSE 'stripe' END,
        CASE WHEN public.issue_3645_finalize_is_paystack(p_stripe_payment_intent_id, p_stripe_charge_id)
             THEN 'pay_link' ELSE 'auto_card' END,
        CASE WHEN public.issue_3645_finalize_is_paystack(p_stripe_payment_intent_id, p_stripe_charge_id)
             THEN NULL ELSE v_now END,
        -- issue #4522 — a planned row, version 0, with its spread add-on share.
        'scheduled', 0, COALESCE((v_inst_item ->> 'addonPortionCents')::bigint, 0),
        -- v2 rows name their package (rebalance and flex allocation); v1 stays NULL.
        NULLIF(v_inst_item ->> 'sourceTicketTypeId', '')::uuid
      );
    END LOOP;
  END IF;

  INSERT INTO public.order_line_items (
    order_id, ticket_type_id, quantity, unit_price_cents, total_cents
  )
  SELECT v_order_id, ticket_type_id, quantity, unit_price_cents, total_cents
    FROM public.ticket_checkout_session_items
   WHERE checkout_session_id = v_session.id;

  -- issue #3281 — the order records the extras its session paid for.
  INSERT INTO public.order_add_on_line_items (
    order_id, ticket_add_on_id, ticket_type_id, add_on_name_at_order,
    ticket_type_name_at_order, day_scope_at_order, quantity, unit_price_cents, total_cents,
    plan_choice
  )
  SELECT v_order_id, ticket_add_on_id, ticket_type_id, add_on_name_at_purchase,
         ticket_type_name_at_purchase, day_scope, quantity, unit_price_cents, total_cents,
         -- issue #4522 / #3281 §9 — the add-on choice on a v2 plan.
         plan_choice
    FROM public.ticket_checkout_session_add_on_items
   WHERE checkout_session_id = v_session.id;

  -- ══ issue #2160 DELTA 3 of 4 — MINT UNDER THE MODE THE GUEST WAS QUOTED ═
  --
  -- THE SNAPSHOT, NOT A FRESH READ OF `events`. The session was PRICED and
  -- SIZED under `multi_date_pricing_mode_snapshot` at create; minting under a
  -- different value issues a pass that does not match what the guest paid for,
  -- in both directions (§A.7 states the two reproductions). The lock cannot
  -- prevent the flip, because an in-flight session holds no ticket yet — which
  -- is precisely the window this line closes.
  --
  -- DELETE THE SNAPSHOT READ and an organiser flipping the mode mid-checkout
  -- either takes a two-day guest's money and admits them on one day, or sells
  -- two admissions and lets four people in.
  --
  -- COALESCE to the live event ONLY for a session created before the column
  -- existed, so anything already in flight at deploy still finalizes.
  SELECT COALESCE(
           v_session.multi_date_pricing_mode_snapshot,
           (SELECT e.multi_date_pricing_mode FROM public.events e
             WHERE e.id = v_session.event_id),
           'per_day')
    INTO v_pricing_mode;

  -- The day set, ordered by start_at so the per_day round-robin below is
  -- deterministic and testable, not incidental.

  SELECT ARRAY(
           SELECT d.event_date_id
             FROM public.ticket_checkout_session_event_dates d
             JOIN public.event_dates ed ON ed.id = d.event_date_id
            WHERE d.checkout_session_id = v_session.id
            ORDER BY ed.start_at, ed.id
         ) INTO v_days;
  v_day_count := COALESCE(array_length(v_days, 1), 0);

  FOR v_item IN
    SELECT *
      FROM public.ticket_checkout_session_items
     WHERE checkout_session_id = v_session.id
     ORDER BY created_at, id
  LOOP
    -- issue #3281 — an all_days pass admits only this ticket's own dates.
    v_line_days := COALESCE(public.issue_3281_days_in_scope(v_item.ticket_type_id, v_days), v_days);
    -- issue #3281 PR10 — when by_date is set, mint each date's own quantity
    -- instead of round-robin on the summed quantity. Create already rejects
    -- by_date under all_days; fail closed here if a legacy row still has it.
    IF v_item.by_date IS NOT NULL AND jsonb_typeof(v_item.by_date) = 'object'
       AND v_pricing_mode = 'all_days' THEN
      RAISE EXCEPTION 'by_date_not_supported_for_all_days';
    END IF;
    IF v_item.by_date IS NOT NULL AND jsonb_typeof(v_item.by_date) = 'object'
       AND v_day_count > 0 AND v_pricing_mode <> 'all_days' THEN
      FOREACH v_day_id IN ARRAY v_days LOOP
        v_date_qty := COALESCE((v_item.by_date ->> v_day_id::text)::integer, 0);
        FOR i IN 1..v_date_qty LOOP
          v_mint := public.issue_3827_mint_ticket(
            v_order_id, v_session.event_id, v_item.ticket_type_id,
            v_session.buyer_name, v_session.buyer_email, v_session.buyer_phone_e164,
            v_qr_token_pepper, v_now
          );
          v_ticket_id := (v_mint ->> 'ticketId')::uuid;
          v_qr := v_mint ->> 'qrPayload';
          INSERT INTO public.ticket_event_dates (ticket_id, event_date_id)
          VALUES (v_ticket_id, v_day_id) ON CONFLICT DO NOTHING;
          v_tickets := v_tickets || jsonb_build_array(jsonb_build_object(
            'ticketId', v_ticket_id,
            'ticketTypeId', v_item.ticket_type_id,
            'ticketName', v_item.ticket_name_at_purchase,
            'qrPayload', v_qr,
            'status', 'valid',
            'eventDateIds', jsonb_build_array(v_day_id)
          ));
        END LOOP;
      END LOOP;
      CONTINUE;
    END IF;

    FOR i IN 1..v_item.quantity LOOP
      -- issue #3827 — THE ONE MINT. The token, its hash, the signed QR payload
      -- and the tickets row are now minted by issue_3827_mint_ticket, whose body
      -- is the block that stood here, verbatim. Host guest-list comps call the
      -- same helper, so a comp QR and a bought QR can never drift apart.
      v_mint := public.issue_3827_mint_ticket(
        v_order_id, v_session.event_id, v_item.ticket_type_id,
        v_session.buyer_name, v_session.buyer_email, v_session.buyer_phone_e164,
        v_qr_token_pepper, v_now
      );
      v_ticket_id := (v_mint ->> 'ticketId')::uuid;
      v_qr := v_mint ->> 'qrPayload';

      -- ══ issue #2160 DELTA 4 of 4 — MINT THE ADMISSION ENTITLEMENTS ═════
      -- A pass admits the days it has rows for. The mint loop itself is
      -- UNCHANGED — `v_item.quantity` already carries the per-day multiplier
      -- from the create-session base (amendment §1), so all that differs
      -- between the modes is how the days are DISTRIBUTED.
      --
      --   zero days   -> NO ROWS. Not day-scoped. Today's any-occurrence
      --                  admission window, byte-identical, which is what
      --                  every pass issued before #2160 has and must keep.
      --   all_days    -> one row per chosen day on the SINGLE pass.
      --   per_day     -> ONE row, dealt round-robin across the ordered day
      --                  set: with quantity = qty x D this yields exactly
      --                  `qty` passes per day, deterministically.
      --
      -- DELETE THIS BLOCK and every pass mints with zero days, so a guest is
      -- admitted on a day they did not pay for and the whole issue reverts.
      IF v_day_count > 0 THEN
        IF v_pricing_mode = 'all_days' THEN
          FOREACH v_day_id IN ARRAY v_line_days LOOP
            INSERT INTO public.ticket_event_dates (ticket_id, event_date_id)
            VALUES (v_ticket_id, v_day_id) ON CONFLICT DO NOTHING;
          END LOOP;
        ELSE
          INSERT INTO public.ticket_event_dates (ticket_id, event_date_id)
          VALUES (v_ticket_id, v_days[((i - 1) % v_day_count) + 1])
          ON CONFLICT DO NOTHING;
        END IF;
      END IF;

      v_tickets := v_tickets || jsonb_build_array(jsonb_build_object(
        'ticketId', v_ticket_id,
        'ticketTypeId', v_item.ticket_type_id,
        'ticketName', v_item.ticket_name_at_purchase,
        'qrPayload', v_qr,
        'status', 'valid',
        'eventDateIds', CASE
          WHEN v_day_count = 0 THEN '[]'::jsonb
          WHEN v_pricing_mode = 'all_days' THEN to_jsonb(v_line_days)
          ELSE jsonb_build_array(v_days[((i - 1) % v_day_count) + 1])
        END
      ));
    END LOOP;
  END LOOP;

  PERFORM public.add_buyer_to_event_chat(
    v_session.event_id,
    v_session.buyer_user_id,
    v_order_id,
    v_session.buyer_email
  );

  INSERT INTO public.ticket_order_notifications (
    order_id, event_id, channel, recipient, idempotency_key, payload
  ) VALUES
    (
      v_order_id,
      v_session.event_id,
      'email',
      v_session.buyer_email,
      'ticket_confirmation:' || v_order_id::text || ':email',
      jsonb_build_object('checkoutSessionId', v_session.id)
    ),
    (
      v_order_id,
      v_session.event_id,
      'sms',
      v_session.buyer_phone_e164,
      'ticket_confirmation:' || v_order_id::text || ':sms',
      jsonb_build_object('checkoutSessionId', v_session.id)
    )
  ON CONFLICT (idempotency_key) DO NOTHING;

  UPDATE public.ticket_checkout_sessions
     SET order_id = v_order_id,
         status = CASE WHEN total_cents = 0 THEN 'free_completed' ELSE 'paid_completed' END,
         stripe_payment_intent_id = COALESCE(p_stripe_payment_intent_id, stripe_payment_intent_id),
         completed_at = v_now,
         updated_at = v_now
   WHERE id = v_session.id;

  RETURN jsonb_build_object(
    'orderId', v_order_id,
    'checkoutSessionId', v_session.id,
    'eventId', v_session.event_id,
    'paymentStatus', 'paid',
    'totalCents', v_session.total_cents,
    'currency', trim(v_session.currency),
    'tickets', v_tickets,
    'notificationStatus', 'queued',
    'installmentPlanRoot', COALESCE(p_installment_plan_root AND v_schedule IS NOT NULL, false)
  );
END;
$function$;

COMMIT;
