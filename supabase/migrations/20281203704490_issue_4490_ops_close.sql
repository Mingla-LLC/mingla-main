-- Issue #4490, spec 08 O5 part B (file number 613490; the spec's 534490 is
-- stale): the daily close, tips and sales by person, cash movements (float,
-- paid out), carrying a check to tomorrow, the day export, and Settings ›
-- Selling in person's write path stays issue_4490_till_settings_set.
--
-- ONE DAY, ONE OWNER. The close's business date is the venue's SERVICE day
-- (issue_4490_venue_service_date: the day before while that day's opening
-- window runs past midnight, else the local date), the same rule "Paid in
-- today" uses (08-O1 fix 2). The Till's own business date helper
-- issue_4490_till_business_date is re-emitted onto that rule, so every Till
-- date written from now on (a check's opened day, a payment's and a refund's
-- business_date) is the service day. venue_till_settings.day_starts_at is
-- RETIRED as an input: the column is kept (no destructive change), nothing
-- reads it any more, and the settings screen no longer offers it.
--
-- The close reads moments, never stored dates: a payment belongs to day D
-- when the service day of its paid_at is D; a refund when the service day of
-- its created_at is D; a void when the service day of its voided_at is D.
--
-- A close is a SNAPSHOT: venue_day_closes.totals is written once by
-- issue_4490_day_close and never changes while the day is closed (a trigger
-- refuses any other write; history only grows). Money that lands later for a
-- closed day is shown as that day's "late" list, derived at read time from
-- the snapshot's own payment and refund ids: nothing on the payment path was
-- changed, nothing is ever adjusted, written off or moved. Mingla never
-- loses money: the close only reports.
--
-- Rights: summary, close, reopen, cash movements, carry over and export need
-- money rights (issue_4490_can_manage_money) and the Till released at the
-- venue (flag VENUE_TILL and the venue's `till` feature); on a Till device
-- login every one of them needs a live PIN session (issue_4490_pin_actor_assert
-- in the same transaction); reopen and export also need a fresh PIN (step-up,
-- checked by the edge with requireStepUp, then run as the approver).
--
-- New tables have RLS on with no policies and no grants to anon or
-- authenticated: they are read and written only through these service-role
-- functions (the venue-till edge passes the verified person). Both have a
-- venue_id column, so the #2099 pending-venue seal moves: 20281203714490 is
-- the repin. Static SQL; conflicts raise PT409.

BEGIN;
SET LOCAL lock_timeout = '5s';

-- ===========================================================================
-- 0. One day: the Till's business date is the venue's service day.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.issue_4490_till_business_date(p_venue_id uuid, p_at timestamptz)
RETURNS date
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  -- #4490 08-O5B: the venue's service day (opening hours), the one rule
  -- "Paid in today" and the daily close use. day_starts_at is no longer read.
  SELECT public.issue_4490_venue_service_date(p_venue_id, p_at);
$function$;

COMMENT ON COLUMN public.venue_till_settings.day_starts_at IS
  '#4490 08-O5B: RETIRED. The Till, the daily close and Paid in today all use the venue''s service day '
  '(issue_4490_venue_service_date, from opening hours). Kept so no data is dropped; nothing reads it.';

-- ===========================================================================
-- 1. Tables.
-- ===========================================================================
CREATE TABLE public.venue_day_closes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL REFERENCES public.venue_listings(id) ON DELETE RESTRICT,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE RESTRICT,
  business_date date NOT NULL,
  state text NOT NULL CHECK (state IN ('closed', 'reopened')),
  currency text NOT NULL CHECK (currency = upper(currency) AND length(currency) = 3),
  cash_counted_minor bigint NULL CHECK (cash_counted_minor IS NULL OR cash_counted_minor BETWEEN 0 AND 100000000000),
  cash_expected_minor bigint NULL,
  difference_minor bigint NULL,
  totals jsonb NULL CHECK (totals IS NULL OR jsonb_typeof(totals) = 'object'),
  closed_by_user_id uuid NULL,
  closed_device_user_id uuid NULL,
  closed_at timestamptz NULL,
  close_request_id uuid NULL,
  reopen_count integer NOT NULL DEFAULT 0 CHECK (reopen_count >= 0),
  reopened_at timestamptz NULL,
  reopened_by_user_id uuid NULL,
  reopen_reason text NULL CHECK (reopen_reason IS NULL OR char_length(btrim(reopen_reason)) BETWEEN 1 AND 140),
  history jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(history) = 'array'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (venue_id, business_date),
  CONSTRAINT venue_day_closes_closed_shape CHECK (
    (state = 'closed') = (totals IS NOT NULL AND closed_at IS NOT NULL AND closed_by_user_id IS NOT NULL
                          AND cash_counted_minor IS NOT NULL AND cash_expected_minor IS NOT NULL
                          AND difference_minor IS NOT NULL)),
  CONSTRAINT venue_day_closes_difference CHECK (
    difference_minor IS NULL OR difference_minor = cash_counted_minor - cash_expected_minor),
  CONSTRAINT venue_day_closes_reopen_shape CHECK (
    (state = 'reopened') = (reopened_at IS NOT NULL AND reopened_by_user_id IS NOT NULL AND reopen_reason IS NOT NULL))
);
COMMENT ON TABLE public.venue_day_closes IS
  '#4490 spec 08 O5: one daily close per venue per service day. totals is a snapshot written once by '
  'issue_4490_day_close; a reopen moves it into history (never shrinks). Service role only.';

CREATE TABLE public.venue_cash_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL REFERENCES public.venue_listings(id) ON DELETE RESTRICT,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE RESTRICT,
  business_date date NOT NULL,
  kind text NOT NULL CHECK (kind IN ('float', 'paid_out')),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0 AND amount_minor <= 2147483647),
  currency text NOT NULL CHECK (currency = upper(currency) AND length(currency) = 3),
  note text NULL CHECK (note IS NULL OR char_length(btrim(note)) BETWEEN 1 AND 140),
  by_user_id uuid NOT NULL,
  device_user_id uuid NOT NULL,
  client_request_id uuid NOT NULL,
  -- clock_timestamp: two floats recorded in one transaction still have an order.
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (venue_id, client_request_id),
  CONSTRAINT venue_cash_movements_paid_out_note CHECK (kind <> 'paid_out' OR note IS NOT NULL)
);
CREATE INDEX venue_cash_movements_day_idx ON public.venue_cash_movements (venue_id, business_date, kind, created_at);
COMMENT ON TABLE public.venue_cash_movements IS
  '#4490 spec 08 O5: the one owner of the drawer float and paid outs. Append only. A newer float row for '
  'a day replaces the earlier one in Expected in the drawer (every row is kept). Service role only.';

ALTER TABLE public.venue_day_closes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.venue_cash_movements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.venue_day_closes FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.venue_cash_movements FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.venue_day_closes TO service_role;
GRANT ALL ON public.venue_cash_movements TO service_role;

-- A closed snapshot never changes; history only grows; nothing is deleted.
CREATE FUNCTION public.issue_4490_day_close_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_marker text := COALESCE(current_setting('mingla.issue_4490_day_close_write', true), '');
  v_prefix jsonb;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'day_close_immutable' USING ERRCODE = '42501';
  END IF;
  IF v_marker <> 'write:' || OLD.id::text THEN
    RAISE EXCEPTION 'day_close_immutable' USING ERRCODE = '42501';
  END IF;
  IF NEW.id <> OLD.id OR NEW.venue_id <> OLD.venue_id OR NEW.business_date <> OLD.business_date
     OR NEW.brand_id <> OLD.brand_id OR NEW.reopen_count < OLD.reopen_count THEN
    RAISE EXCEPTION 'day_close_immutable' USING ERRCODE = '42501';
  END IF;
  -- A closed row only leaves 'closed' by a reopen; it is never re-written closed.
  IF OLD.state = 'closed' AND NEW.state <> 'reopened' THEN
    RAISE EXCEPTION 'day_close_immutable' USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE(jsonb_agg(e ORDER BY i), '[]'::jsonb) INTO v_prefix
  FROM jsonb_array_elements(NEW.history) WITH ORDINALITY x(e, i)
  WHERE i <= jsonb_array_length(OLD.history);
  IF v_prefix IS DISTINCT FROM OLD.history OR jsonb_array_length(NEW.history) < jsonb_array_length(OLD.history) THEN
    RAISE EXCEPTION 'day_close_immutable' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER issue_4490_day_close_guard
  BEFORE UPDATE OR DELETE ON public.venue_day_closes
  FOR EACH ROW EXECUTE FUNCTION public.issue_4490_day_close_guard();

CREATE FUNCTION public.issue_4490_cash_movement_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  RAISE EXCEPTION 'cash_movement_append_only' USING ERRCODE = '42501';
END;
$function$;
CREATE TRIGGER issue_4490_cash_movement_guard
  BEFORE UPDATE OR DELETE ON public.venue_cash_movements
  FOR EACH ROW EXECUTE FUNCTION public.issue_4490_cash_movement_guard();

-- ===========================================================================
-- 2. The floor audit helper also records cash movements and carry overs
--    (re-emitted whole from 20281203684490; only the action list grew).
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.issue_4490_floor_audit(
  p_brand_id uuid,
  p_actor uuid,
  p_device_user uuid,
  p_action text,
  p_target_type text,
  p_target_id text,
  p_after jsonb
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF p_action NOT IN ('till.pay', 'till.void', 'till.refund', 'till.close', 'till.reopen',
                      'pin.set', 'pin.reset', 'pin.locked', 'stock.set',
                      -- #4490 08-O5B: the drawer and Move to tomorrow.
                      'till.cash_movement', 'till.carry_over') THEN
    RAISE EXCEPTION 'floor_audit_action_invalid' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.audit_log (user_id, brand_id, action, target_type, target_id, after)
  VALUES (p_actor, p_brand_id, p_action, p_target_type, p_target_id,
    COALESCE(p_after, '{}'::jsonb) - 'pin' - 'token' - 'pin_hash' - 'token_hash'
      || jsonb_build_object('device_user_id', COALESCE(p_device_user, p_actor)));
END;
$function$;

-- ===========================================================================
-- 3. Helpers.
-- ===========================================================================
-- Who a person is on the close: a real member (kind person), a Till device
-- account (kind device: never listed as a person; its legacy rows from before
-- PINs are shown as the device), an auto-added Mingla admin (kind
-- mingla_support, #4579: listed because the money must add up, labelled as
-- Mingla support and left out of staff tips), or nobody (kind system: a
-- check the Till cleared by itself). The name is the floor display name; the
-- client shows "Team member" when it is NULL. Never an email.
-- [TRANSITIONAL] granted_via is read through to_jsonb: it is false until
-- #4579's column exists on main. Exit: #4579 merged (use its display helper).
CREATE FUNCTION public.issue_4490_close_person(p_venue_id uuid, p_user_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT CASE
    WHEN p_user_id IS NULL THEN jsonb_build_object('userId', NULL, 'kind', 'system', 'name', NULL)
    WHEN public.issue_4490_is_till_device(p_venue_id, p_user_id)
      THEN jsonb_build_object('userId', p_user_id, 'kind', 'device', 'name', NULL)
    ELSE jsonb_build_object(
      'userId', p_user_id,
      'kind', CASE WHEN EXISTS (
          SELECT 1 FROM public.brand_team_members m JOIN public.venue_listings v ON v.brand_id = m.brand_id
          WHERE v.id = p_venue_id AND m.user_id = p_user_id
            AND to_jsonb(m) ->> 'granted_via' = 'mingla_admin') THEN 'mingla_support' ELSE 'person' END,
      'name', public.issue_4490_floor_person_name(p_user_id, p_venue_id))
  END;
$function$;

-- The method a payment is reported under: scan to pay is split by the
-- provider's channel (card, bank transfer, anything else).
CREATE FUNCTION public.issue_4490_close_method_key(p_method text, p_channel text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT CASE p_method
    WHEN 'scan' THEN CASE p_channel WHEN 'card' THEN 'scan_card' WHEN 'bank_transfer' THEN 'scan_transfer'
                                    ELSE 'scan_other' END
    ELSE p_method END;
$function$;

CREATE FUNCTION public.issue_4490_close_method_order(p_key text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT CASE p_key WHEN 'cash' THEN 1 WHEN 'own_machine' THEN 2 WHEN 'tap' THEN 3 WHEN 'scan_card' THEN 4
    WHEN 'scan_transfer' THEN 5 WHEN 'scan_other' THEN 6 WHEN 'room' THEN 7
    WHEN 'door_cash' THEN 11 WHEN 'door_transfer' THEN 12 WHEN 'door_card' THEN 13 ELSE 19 END;
$function$;

-- The Till payments of a venue's service day D (paid, part refunded or
-- refunded; the venue's currency), in the order they were paid.
CREATE FUNCTION public.issue_4490_day_payment_ids(p_venue_id uuid, p_date date)
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  WITH w AS (
    SELECT public.issue_4490_venue_timezone(p_venue_id) AS tz,
           (SELECT upper(b.default_currency) FROM public.venue_listings v JOIN public.brands b ON b.id = v.brand_id
            WHERE v.id = p_venue_id) AS cur
  )
  SELECT COALESCE(array_agg(p.id ORDER BY p.paid_at, p.id), '{}'::uuid[])
  FROM w, public.venue_till_payments p
  JOIN public.venue_till_sales s ON s.id = p.sale_id
  WHERE s.venue_id = p_venue_id AND s.currency = w.cur
    AND p.state IN ('paid', 'partially_refunded', 'refunded')
    AND p.paid_at >= ((p_date - 1)::timestamp AT TIME ZONE w.tz)
    AND p.paid_at < ((p_date + 2)::timestamp AT TIME ZONE w.tz)
    AND public.issue_4490_venue_service_date(p_venue_id, p.paid_at) = p_date;
$function$;

-- The Till refunds made on a venue's service day D (the day they happen).
CREATE FUNCTION public.issue_4490_day_refund_ids(p_venue_id uuid, p_date date)
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  WITH w AS (
    SELECT public.issue_4490_venue_timezone(p_venue_id) AS tz,
           (SELECT upper(b.default_currency) FROM public.venue_listings v JOIN public.brands b ON b.id = v.brand_id
            WHERE v.id = p_venue_id) AS cur
  )
  SELECT COALESCE(array_agg(r.id ORDER BY r.created_at, r.id), '{}'::uuid[])
  FROM w, public.venue_till_refunds r
  JOIN public.venue_till_payments p ON p.id = r.payment_id
  JOIN public.venue_till_sales s ON s.id = p.sale_id
  WHERE s.venue_id = p_venue_id AND s.currency = w.cur
    AND r.created_at >= ((p_date - 1)::timestamp AT TIME ZONE w.tz)
    AND r.created_at < ((p_date + 2)::timestamp AT TIME ZONE w.tz)
    AND public.issue_4490_venue_service_date(p_venue_id, r.created_at) = p_date;
$function$;

-- The drawer's float for day D: the newest float row of that day (0 if none).
CREATE FUNCTION public.issue_4490_day_float(p_venue_id uuid, p_date date)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT COALESCE((SELECT m.amount_minor FROM public.venue_cash_movements m
                   WHERE m.venue_id = p_venue_id AND m.business_date = p_date AND m.kind = 'float'
                   ORDER BY m.created_at DESC, m.id DESC LIMIT 1), 0)::bigint;
$function$;

-- ===========================================================================
-- 4. The day's totals (live). Every line's definition is written beside it.
-- ===========================================================================
CREATE FUNCTION public.issue_4490_day_totals(p_venue_id uuid, p_date date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_venue public.venue_listings%ROWTYPE;
  v_cur text;
  v_tz text;
  v_from timestamptz;
  v_to timestamptz;
  v_pay uuid[];
  v_ref uuid[];
  v_takings jsonb;
  v_by_method jsonb;
  v_people jsonb;
  v_tips jsonb;
  v_tips_other bigint;
  v_tips_by_method jsonb;
  v_refunds jsonb;
  v_voids jsonb;
  v_deposits_used jsonb;
  v_deposit_refunded jsonb;
  v_online_orders jsonb;
  v_door jsonb;
  v_door_cash bigint;
  v_door_total bigint;
  v_bookings bigint;
  v_on_open bigint;
  v_card jsonb;
  v_float bigint;
  v_float_at timestamptz;
  v_paid_out bigint;
  v_paid_outs jsonb;
  v_cash_pay bigint;
  v_cash_tip bigint;
  v_cash_ref bigint;
  v_expected bigint;
  v_till_at_venue bigint;
  v_till_online bigint;
  v_booked_online bigint;
  v_money_day jsonb;
  v_amount bigint;
  v_tip bigint;
  v_ref_amount bigint;
  v_ref_tip bigint;
BEGIN
  SELECT * INTO v_venue FROM public.venue_listings WHERE id = p_venue_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'venue_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT upper(b.default_currency) INTO v_cur FROM public.brands b WHERE b.id = v_venue.brand_id;
  v_tz := public.issue_4490_venue_timezone(p_venue_id);
  v_from := ((p_date - 1)::timestamp AT TIME ZONE v_tz);
  v_to := ((p_date + 2)::timestamp AT TIME ZONE v_tz);
  v_pay := public.issue_4490_day_payment_ids(p_venue_id, p_date);
  v_ref := public.issue_4490_day_refund_ids(p_venue_id, p_date);

  -- Takings = Σ amount_minor (service charge inside, tip and guest-paid fees
  -- outside) of the day's Till payments; tips = Σ tip_minor; guest-paid card
  -- fees = Σ (charged - amount - tip) on tap and scan payments.
  SELECT COALESCE(sum(p.amount_minor), 0), COALESCE(sum(p.tip_minor), 0) INTO v_amount, v_tip
  FROM public.venue_till_payments p WHERE p.id = ANY(v_pay);
  SELECT jsonb_build_object(
      'count', count(*),
      'amountMinor', COALESCE(sum(p.amount_minor), 0),
      'tipMinor', COALESCE(sum(p.tip_minor), 0),
      'serviceChargeMinor', COALESCE(sum(p.service_charge_minor), 0),
      'guestFeesMinor', COALESCE(sum(CASE WHEN p.method IN ('tap', 'scan')
        THEN GREATEST(COALESCE(p.charged_minor, p.amount_minor + p.tip_minor) - p.amount_minor - p.tip_minor, 0)
        ELSE 0 END), 0))
    INTO v_takings
  FROM public.venue_till_payments p WHERE p.id = ANY(v_pay);

  -- By payment type (scan split by the provider's channel).
  SELECT COALESCE(jsonb_agg(jsonb_build_object('method', x.k, 'count', x.n, 'amountMinor', x.a, 'tipMinor', x.t,
           'serviceChargeMinor', x.sc) ORDER BY public.issue_4490_close_method_order(x.k)), '[]'::jsonb)
    INTO v_by_method
  FROM (SELECT public.issue_4490_close_method_key(p.method, p.provider_channel) AS k, count(*) AS n,
               sum(p.amount_minor) AS a, sum(p.tip_minor) AS t, sum(p.service_charge_minor) AS sc
        FROM public.venue_till_payments p WHERE p.id = ANY(v_pay) GROUP BY 1) x;

  -- Tips by method.
  SELECT COALESCE(jsonb_agg(jsonb_build_object('method', x.k, 'tipMinor', x.t)
           ORDER BY public.issue_4490_close_method_order(x.k)), '[]'::jsonb)
    INTO v_tips_by_method
  FROM (SELECT public.issue_4490_close_method_key(p.method, p.provider_channel) AS k, sum(p.tip_minor) AS t
        FROM public.venue_till_payments p WHERE p.id = ANY(v_pay) AND p.tip_minor > 0 GROUP BY 1) x;

  -- Refunds made that day (Till refunds of any payment, by method and by
  -- who; the tip part separately). The table deposit's excess refund is a
  -- separate line below, never a Till refund.
  SELECT COALESCE(sum(r.amount_minor), 0), COALESCE(sum(r.tip_minor), 0) INTO v_ref_amount, v_ref_tip
  FROM public.venue_till_refunds r WHERE r.id = ANY(v_ref);
  SELECT jsonb_build_object(
      'count', (SELECT count(*) FROM public.venue_till_refunds r WHERE r.id = ANY(v_ref)),
      'amountMinor', v_ref_amount,
      'tipMinor', v_ref_tip,
      'byMethod', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('method', x.k, 'count', x.n, 'amountMinor', x.a, 'tipMinor', x.t)
                 ORDER BY public.issue_4490_close_method_order(x.k))
        FROM (SELECT public.issue_4490_close_method_key(r.method, p.provider_channel) AS k, count(*) AS n,
                     sum(r.amount_minor) AS a, sum(r.tip_minor) AS t
              FROM public.venue_till_refunds r JOIN public.venue_till_payments p ON p.id = r.payment_id
              WHERE r.id = ANY(v_ref) GROUP BY 1) x), '[]'::jsonb))
    INTO v_refunds;

  -- Voids on D: offer lines (a voided menu round is counted by its items) and
  -- menu items of Till rounds, by who voided them.
  WITH v AS (
    SELECT l.voided_by_user_id AS u, l.amount_minor AS a
    FROM public.venue_till_lines l JOIN public.venue_till_sales s ON s.id = l.sale_id
    WHERE s.venue_id = p_venue_id AND l.state = 'voided' AND l.kind NOT IN ('menu_round', 'deposit_credit')
      AND l.voided_at >= v_from AND l.voided_at < v_to
      AND public.issue_4490_venue_service_date(p_venue_id, l.voided_at) = p_date
    UNION ALL
    SELECT i.voided_by_user_id, i.line_total_cents::bigint
    FROM public.venue_order_items i JOIN public.venue_orders o ON o.id = i.venue_order_id
    WHERE o.venue_id = p_venue_id AND i.voided_at IS NOT NULL
      AND i.voided_at >= v_from AND i.voided_at < v_to
      AND public.issue_4490_venue_service_date(p_venue_id, i.voided_at) = p_date
      AND EXISTS (SELECT 1 FROM public.venue_till_lines l WHERE l.venue_order_id = o.id AND l.kind = 'menu_round')
  )
  SELECT jsonb_build_object('count', count(*), 'amountMinor', COALESCE(sum(a), 0)) INTO v_voids FROM v;

  -- By person: sales (count, amount) and tips and cash taken by who took the
  -- payment; tips by who served (the payment's server); refunds and voids by
  -- who made them.
  WITH pay AS (SELECT p.* FROM public.venue_till_payments p WHERE p.id = ANY(v_pay)),
  ref AS (SELECT r.* FROM public.venue_till_refunds r WHERE r.id = ANY(v_ref)),
  vd AS (
    SELECT l.voided_by_user_id AS u, l.amount_minor AS a
    FROM public.venue_till_lines l JOIN public.venue_till_sales s ON s.id = l.sale_id
    WHERE s.venue_id = p_venue_id AND l.state = 'voided' AND l.kind NOT IN ('menu_round', 'deposit_credit')
      AND l.voided_at >= v_from AND l.voided_at < v_to
      AND public.issue_4490_venue_service_date(p_venue_id, l.voided_at) = p_date
    UNION ALL
    SELECT i.voided_by_user_id, i.line_total_cents::bigint
    FROM public.venue_order_items i JOIN public.venue_orders o ON o.id = i.venue_order_id
    WHERE o.venue_id = p_venue_id AND i.voided_at IS NOT NULL
      AND i.voided_at >= v_from AND i.voided_at < v_to
      AND public.issue_4490_venue_service_date(p_venue_id, i.voided_at) = p_date
      AND EXISTS (SELECT 1 FROM public.venue_till_lines l WHERE l.venue_order_id = o.id AND l.kind = 'menu_round')
  ),
  ids AS (
    SELECT taken_by_user_id AS u FROM pay
    UNION SELECT server_user_id FROM pay
    UNION SELECT by_user_id FROM ref
    UNION SELECT u FROM vd
  ),
  rows AS (
    SELECT i.u,
      (SELECT count(*) FROM pay WHERE pay.taken_by_user_id IS NOT DISTINCT FROM i.u) AS sales_count,
      COALESCE((SELECT sum(amount_minor) FROM pay WHERE pay.taken_by_user_id IS NOT DISTINCT FROM i.u), 0) AS sales,
      COALESCE((SELECT sum(tip_minor) FROM pay WHERE pay.taken_by_user_id IS NOT DISTINCT FROM i.u), 0) AS tips_taken,
      COALESCE((SELECT sum(amount_minor + tip_minor) FROM pay
                WHERE pay.taken_by_user_id IS NOT DISTINCT FROM i.u AND pay.method = 'cash'), 0) AS cash_taken,
      COALESCE((SELECT sum(tip_minor) FROM pay WHERE pay.server_user_id IS NOT DISTINCT FROM i.u), 0) AS tips_served,
      (SELECT count(*) FROM ref WHERE ref.by_user_id IS NOT DISTINCT FROM i.u) AS refund_count,
      COALESCE((SELECT sum(amount_minor) FROM ref WHERE ref.by_user_id IS NOT DISTINCT FROM i.u), 0) AS refund_amount,
      COALESCE((SELECT sum(tip_minor) FROM ref WHERE ref.by_user_id IS NOT DISTINCT FROM i.u), 0) AS refund_tip,
      (SELECT count(*) FROM vd WHERE vd.u IS NOT DISTINCT FROM i.u) AS void_count,
      COALESCE((SELECT sum(a) FROM vd WHERE vd.u IS NOT DISTINCT FROM i.u), 0) AS void_amount
    FROM ids i
  )
  SELECT COALESCE(jsonb_agg(public.issue_4490_close_person(p_venue_id, r.u) || jsonb_build_object(
             'salesCount', r.sales_count, 'salesMinor', r.sales, 'tipsTakenMinor', r.tips_taken,
             'cashTakenMinor', r.cash_taken, 'tipsServedMinor', r.tips_served,
             'refundCount', r.refund_count, 'refundMinor', r.refund_amount, 'refundTipMinor', r.refund_tip,
             'voidCount', r.void_count, 'voidMinor', r.void_amount)
           ORDER BY r.sales DESC, r.tips_served DESC, r.u), '[]'::jsonb)
    INTO v_people
  FROM rows r;

  -- Tips by who served, for staff tip views: real members only. A Till
  -- device's legacy rows and an auto-added Mingla admin's are kept apart so
  -- the money still adds up (tipsOtherMinor).
  SELECT COALESCE(jsonb_agg(e ORDER BY (e->>'tipsServedMinor')::bigint DESC, e->>'userId'), '[]'::jsonb)
    INTO v_tips
  FROM jsonb_array_elements(v_people) e
  WHERE e->>'kind' = 'person' AND (e->>'tipsServedMinor')::bigint > 0;
  SELECT COALESCE(sum((e->>'tipsServedMinor')::bigint), 0) INTO v_tips_other
  FROM jsonb_array_elements(v_people) e WHERE e->>'kind' <> 'person';

  -- Deposits used: the table deposit consumed by checks finished on D
  -- (LEAST(credit, the bill)); never takings (it was paid when booked).
  SELECT jsonb_build_object('count', count(*),
      'amountMinor', COALESCE(sum(LEAST(s.credit_minor, s.subtotal_minor + s.service_charge_minor)), 0))
    INTO v_deposits_used
  FROM public.venue_till_sales s
  WHERE s.venue_id = p_venue_id AND s.currency = v_cur AND s.credit_minor > 0
    AND s.state IN ('paid', 'partially_refunded', 'refunded')
    AND s.paid_at >= v_from AND s.paid_at < v_to
    AND public.issue_4490_venue_service_date(p_venue_id, s.paid_at) = p_date;

  -- Deposit refunded: the unused part of a table deposit sent back to the
  -- guest's card when its check finished (spec 08 §15), on the day it was
  -- raised; shown apart from Till refunds and never from the drawer.
  SELECT jsonb_build_object('count', count(*), 'amountMinor', COALESCE(sum(sr.buyer_refund_requested_cents), 0))
    INTO v_deposit_refunded
  FROM public.source_refunds sr
  WHERE sr.source_type = 'venue_reservation' AND sr.venue_id = p_venue_id
    AND sr.idempotency_key LIKE 'venue_deposit\_excess:%'
    AND upper(sr.currency) = v_cur
    AND sr.buyer_state NOT IN ('failed_terminal', 'cancelled_no_refund_due')
    AND sr.requested_at >= v_from AND sr.requested_at < v_to
    AND public.issue_4490_venue_service_date(p_venue_id, sr.requested_at) = p_date;

  -- Ordered online at the venue: guest QR / page orders (not the Till, not a
  -- staff order) paid on D. Shown apart; never in the drawer.
  SELECT jsonb_build_object('count', count(*), 'amountMinor', COALESCE(sum(o.total_cents), 0))
    INTO v_online_orders
  FROM public.venue_orders o
  WHERE o.venue_id = p_venue_id AND o.till_payment_id IS NULL AND o.source <> 'staff'
    AND o.money_path = 'mingla' AND upper(o.currency) = v_cur
    AND o.payment_status IN ('paid', 'partial_refund', 'refunded')
    AND COALESCE(o.confirmed_at, o.created_at) >= v_from AND COALESCE(o.confirmed_at, o.created_at) < v_to
    AND public.issue_4490_venue_service_date(p_venue_id, COALESCE(o.confirmed_at, o.created_at)) = p_date;

  -- Sold at the door outside the Till: booking money recorded at the venue
  -- (cash, transfer, card at the venue, other; never the Till's own rows or a
  -- table deposit) and gate sales paid in cash or by transfer, each on the
  -- day "Paid in today" puts it (08-O1 fix 2). Cash goes in the drawer.
  WITH d AS (
    SELECT CASE o.method WHEN 'cash' THEN 'door_cash' WHEN 'transfer' THEN 'door_transfer'
             WHEN 'card_at_venue' THEN 'door_card' ELSE 'door_other' END AS k,
           o.amount_minor AS a
    FROM public.venue_offline_payments o JOIN public.stay_reservation_groups g ON g.id = o.group_id
    WHERE g.venue_id = p_venue_id AND upper(o.currency_code) = v_cur
      AND o.method IN ('cash', 'transfer', 'card_at_venue', 'other')
      AND CASE WHEN o.paid_on = (o.created_at AT TIME ZONE v_tz)::date
               THEN public.issue_4490_venue_service_date(p_venue_id, o.created_at)
               ELSE o.paid_on END = p_date
    UNION ALL
    SELECT CASE e.safe_metadata->>'method' WHEN 'cash' THEN 'door_cash' WHEN 'transfer' THEN 'door_transfer'
             ELSE 'door_other' END,
           g.total_minor
    FROM public.stay_reservation_groups g
    JOIN public.stay_reservation_events e ON e.group_id = g.id AND e.event_type = 'stay_offer_gate_paid'
    WHERE g.venue_id = p_venue_id AND g.payment_collection = 'property' AND upper(g.currency_code) = v_cur
      AND public.issue_4490_venue_service_date(p_venue_id, e.created_at) = p_date
  )
  SELECT COALESCE(sum(a), 0), COALESCE(sum(a) FILTER (WHERE k = 'door_cash'), 0),
         jsonb_build_object('count', count(*), 'amountMinor', COALESCE(sum(a), 0),
           'byMethod', COALESCE((SELECT jsonb_agg(jsonb_build_object('method', y.k, 'count', y.n, 'amountMinor', y.a)
                                   ORDER BY public.issue_4490_close_method_order(y.k))
                                 FROM (SELECT d2.k, count(*) AS n, sum(d2.a) AS a FROM d d2 GROUP BY d2.k) y), '[]'::jsonb))
    INTO v_door_total, v_door_cash, v_door
  FROM d;

  -- What the takings were for: entry, bookings and sessions (the offer part
  -- of each payment, recorded on its booking: the same rows "Paid in
  -- today" counts); money on checks still open (not split yet); the rest is
  -- food, drink and anything else on the checks.
  SELECT COALESCE(sum(o.amount_minor), 0) INTO v_bookings
  FROM public.venue_offline_payments o
  WHERE o.method = 'till' AND o.till_payment_id = ANY(v_pay);
  SELECT COALESCE(sum(p.amount_minor), 0) INTO v_on_open
  FROM public.venue_till_payments p JOIN public.venue_till_sales s ON s.id = p.sale_id
  WHERE p.id = ANY(v_pay) AND s.state IN ('open', 'paying');

  -- Card money: Mingla fees = Σ carrier (mingla fee + platform service fee);
  -- card money to your bank (before card processing fees) = Σ carrier totals
  -- - Σ those fees - Σ card refunds made that day.
  SELECT jsonb_build_object(
      'chargedMinor', COALESCE((SELECT sum(c.total_cents) FROM public.venue_till_payments p
                                JOIN public.venue_orders c ON c.id = p.carrier_order_id
                                WHERE p.id = ANY(v_pay) AND p.method IN ('tap', 'scan')), 0),
      'minglaFeesMinor', COALESCE((SELECT sum(c.mingla_fee_cents + c.platform_service_fee_cents)
                                   FROM public.venue_till_payments p
                                   JOIN public.venue_orders c ON c.id = p.carrier_order_id
                                   WHERE p.id = ANY(v_pay) AND p.method IN ('tap', 'scan')), 0),
      'refundedMinor', COALESCE((SELECT sum(r.amount_minor + r.tip_minor) FROM public.venue_till_refunds r
                                 WHERE r.id = ANY(v_ref) AND r.method IN ('tap', 'scan')), 0))
    INTO v_card;
  v_card := v_card || jsonb_build_object('toBankMinor',
    (v_card->>'chargedMinor')::bigint - (v_card->>'minglaFeesMinor')::bigint - (v_card->>'refundedMinor')::bigint);

  -- Cash expected = float + cash payments (amount + tip) + cash taken at the
  -- door - cash refunds (amount + tip) - paid outs.
  v_float := public.issue_4490_day_float(p_venue_id, p_date);
  SELECT m.created_at INTO v_float_at FROM public.venue_cash_movements m
  WHERE m.venue_id = p_venue_id AND m.business_date = p_date AND m.kind = 'float'
  ORDER BY m.created_at DESC, m.id DESC LIMIT 1;
  SELECT COALESCE(sum(m.amount_minor), 0) INTO v_paid_out FROM public.venue_cash_movements m
  WHERE m.venue_id = p_venue_id AND m.business_date = p_date AND m.kind = 'paid_out';
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', m.id, 'amountMinor', m.amount_minor, 'note', m.note,
           'atLocal', to_char(m.created_at AT TIME ZONE v_tz, 'HH24:MI'))
           ORDER BY m.created_at, m.id), '[]'::jsonb)
    INTO v_paid_outs
  FROM public.venue_cash_movements m
  WHERE m.venue_id = p_venue_id AND m.business_date = p_date AND m.kind = 'paid_out';
  SELECT COALESCE(sum(p.amount_minor), 0), COALESCE(sum(p.tip_minor), 0) INTO v_cash_pay, v_cash_tip
  FROM public.venue_till_payments p WHERE p.id = ANY(v_pay) AND p.method = 'cash';
  SELECT COALESCE(sum(r.amount_minor + r.tip_minor), 0) INTO v_cash_ref
  FROM public.venue_till_refunds r WHERE r.id = ANY(v_ref) AND r.method = 'cash';
  v_expected := v_float + v_cash_pay + v_cash_tip + v_door_cash - v_cash_ref - v_paid_out;

  -- Reconciliation with "Paid in today" (issue_4490_venue_money_day, its one
  -- owner): its at-the-venue part = the Till's offer parts paid in cash or
  -- on the venue's own machine + the door money above; its online part = the
  -- Till's offer parts paid by tap or scan + bookings paid online. Each part
  -- below uses exactly that function's day rule.
  SELECT COALESCE(sum(o.amount_minor) FILTER (WHERE tp.method NOT IN ('tap', 'scan')), 0),
         COALESCE(sum(o.amount_minor) FILTER (WHERE tp.method IN ('tap', 'scan')), 0)
    INTO v_till_at_venue, v_till_online
  FROM public.venue_offline_payments o
  JOIN public.stay_reservation_groups g ON g.id = o.group_id
  JOIN public.venue_till_payments tp ON tp.id = o.till_payment_id
  WHERE g.venue_id = p_venue_id AND upper(o.currency_code) = v_cur AND o.method = 'till'
    AND public.issue_4490_venue_service_date(p_venue_id, o.created_at) = p_date;
  SELECT COALESCE(sum(a.amount_minor), 0) INTO v_booked_online
  FROM public.stay_payment_attempts a
  JOIN public.stay_reservation_groups g ON g.id = a.group_id
  WHERE g.venue_id = p_venue_id AND a.state = 'succeeded' AND upper(a.currency_code) = v_cur
    AND public.issue_4490_venue_service_date(p_venue_id, a.succeeded_at) = p_date;
  v_money_day := public.issue_4490_venue_money_day(p_venue_id, p_date);

  RETURN jsonb_build_object(
    'version', 1,
    'businessDate', p_date,
    'currency', v_cur,
    'timezone', v_tz,
    'takings', v_takings,
    'byMethod', v_by_method,
    'people', v_people,
    'tipsByServer', v_tips,
    'tipsOtherMinor', v_tips_other,
    'tipsByMethod', v_tips_by_method,
    'refunds', v_refunds,
    'voids', v_voids,
    'serviceChargeMinor', (v_takings->>'serviceChargeMinor')::bigint,
    'net', jsonb_build_object('takingsMinor', v_amount - v_ref_amount, 'tipMinor', v_tip - v_ref_tip),
    'depositsUsed', v_deposits_used,
    'depositRefunded', v_deposit_refunded,
    'orderedOnline', v_online_orders,
    'door', v_door,
    'categories', jsonb_build_object('bookingsMinor', v_bookings, 'onOpenChecksMinor', v_on_open,
      'foodAndDrinkMinor', v_amount - v_bookings - v_on_open),
    'card', v_card,
    'cash', jsonb_build_object(
      'floatMinor', v_float,
      'floatSetAtLocal', CASE WHEN v_float_at IS NULL THEN NULL ELSE to_char(v_float_at AT TIME ZONE v_tz, 'HH24:MI') END,
      'cashPaymentsMinor', v_cash_pay, 'cashTipsMinor', v_cash_tip, 'doorCashMinor', v_door_cash,
      'cashRefundsMinor', v_cash_ref, 'paidOutMinor', v_paid_out, 'paidOuts', v_paid_outs,
      'expectedMinor', v_expected),
    'paidInToday', v_money_day,
    'reconcile', jsonb_build_object(
      'tillBookingsAtVenueMinor', v_till_at_venue,
      'tillBookingsOnlineMinor', v_till_online,
      'doorMinor', v_door_total,
      'bookedOnlineMinor', v_booked_online,
      'atVenueMatches', (v_money_day->'paidIn'->>'atVenue')::bigint = v_till_at_venue + v_door_total,
      'onlineMatches', (v_money_day->'paidIn'->>'online')::bigint = v_till_online + v_booked_online,
      'byMethodMatches', COALESCE((SELECT sum((e->>'amountMinor')::bigint) FROM jsonb_array_elements(v_by_method) e), 0) = v_amount,
      'byPersonMatches', COALESCE((SELECT sum((e->>'salesMinor')::bigint) FROM jsonb_array_elements(v_people) e), 0) = v_amount,
      'tipsMatch', COALESCE((SELECT sum((e->>'tipsServedMinor')::bigint) FROM jsonb_array_elements(v_tips) e), 0)
        + v_tips_other = v_tip),
    'paymentIds', to_jsonb(v_pay),
    'refundIds', to_jsonb(v_ref)
  );
END;
$function$;

-- ===========================================================================
-- 5. Open checks for day D. A check blocks the close when it is open, or
--    paying with anything but a scan code waiting (a guest may still pay a
--    scan code later; that money then lands as late), was opened on D or
--    before, has something on it, and was not moved past D.
-- ===========================================================================
CREATE FUNCTION public.issue_4490_day_open_checks(p_venue_id uuid, p_date date)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'saleId', s.id,
      'checkLabel', s.check_label,
      'spotLabel', (SELECT q.label FROM public.qr_spots q WHERE q.id = s.qr_spot_id),
      'server', public.issue_4490_close_person(p_venue_id, s.server_user_id),
      'openedAt', s.created_at,
      'ageMinutes', GREATEST(floor(extract(epoch FROM now() - s.created_at) / 60), 0)::integer,
      'state', s.state,
      'version', s.version,
      'dueMinor', GREATEST(s.total_due_minor - s.paid_minor, 0),
      'paidMinor', s.paid_minor,
      'waitingForScan', x.scan_only,
      'carriedPast', s.carried_past,
      'blocks', (s.carried_past IS NULL OR s.carried_past < p_date) AND NOT x.scan_only)
      ORDER BY s.created_at, s.id), '[]'::jsonb)
  FROM public.venue_till_sales s
  CROSS JOIN LATERAL (
    SELECT s.state = 'paying'
           AND EXISTS (SELECT 1 FROM public.venue_till_payments p WHERE p.sale_id = s.id AND p.state = 'pending')
           AND NOT EXISTS (SELECT 1 FROM public.venue_till_payments p
                           WHERE p.sale_id = s.id AND p.state = 'pending' AND p.method <> 'scan') AS scan_only
  ) x
  WHERE s.venue_id = p_venue_id AND s.state IN ('open', 'paying')
    AND public.issue_4490_venue_service_date(p_venue_id, s.created_at) <= p_date
    AND (s.paid_minor > 0 OR EXISTS (SELECT 1 FROM public.venue_till_lines l
                                     WHERE l.sale_id = s.id AND l.state IN ('held', 'committed')));
$function$;

-- ===========================================================================
-- 6. The gate every close action passes: the Till released at the venue, the
--    PIN session on a Till device (in this transaction), money rights.
-- ===========================================================================
CREATE FUNCTION public.issue_4490_day_gate(p_venue_id uuid, p_actor uuid, p_device_user uuid)
RETURNS public.venue_listings
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_venue public.venue_listings%ROWTYPE;
BEGIN
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_venue FROM public.venue_listings WHERE id = p_venue_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'venue_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.issue_4490_till_enabled(v_venue.id) THEN
    RAISE EXCEPTION 'till_not_enabled' USING ERRCODE = 'P0001';
  END IF;
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  PERFORM public.issue_4490_pin_actor_assert(v_venue.id, p_actor, COALESCE(p_device_user, p_actor));
  IF NOT public.issue_4490_can_manage_money(v_venue.id, p_actor) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  RETURN v_venue;
END;
$function$;

-- The days a close action may name: today's service day and the 7 before it.
CREATE FUNCTION public.issue_4490_day_check_date(p_venue_id uuid, p_date date)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_today date := public.issue_4490_venue_service_date(p_venue_id, now());
BEGIN
  IF p_date IS NULL OR p_date > v_today OR p_date < v_today - 7 THEN
    RAISE EXCEPTION 'day_out_of_range' USING ERRCODE = '22023';
  END IF;
END;
$function$;

-- ===========================================================================
-- 7. The summary (live, or the snapshot plus the late list once closed).
-- ===========================================================================
CREATE FUNCTION public.issue_4490_day_summary(p_venue_id uuid, p_date date, p_actor uuid, p_device_user uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_venue public.venue_listings%ROWTYPE;
  v_today date;
  v_date date;
  v_row public.venue_day_closes%ROWTYPE;
  v_live jsonb;
  v_totals jsonb;
  v_checks jsonb;
  v_late jsonb := jsonb_build_object('count', 0, 'amountMinor', 0, 'tipMinor', 0, 'payments', '[]'::jsonb,
                                     'refundCount', 0, 'refundMinor', 0, 'refunds', '[]'::jsonb);
  v_tz text;
  v_blocking integer;
BEGIN
  v_venue := public.issue_4490_day_gate(p_venue_id, p_actor, p_device_user);
  v_today := public.issue_4490_venue_service_date(v_venue.id, now());
  v_date := COALESCE(p_date, v_today);
  PERFORM public.issue_4490_day_check_date(v_venue.id, v_date);
  v_tz := public.issue_4490_venue_timezone(v_venue.id);
  SELECT * INTO v_row FROM public.venue_day_closes WHERE venue_id = v_venue.id AND business_date = v_date;
  v_live := public.issue_4490_day_totals(v_venue.id, v_date);
  v_checks := public.issue_4490_day_open_checks(v_venue.id, v_date);
  SELECT count(*) INTO v_blocking FROM jsonb_array_elements(v_checks) e WHERE (e->>'blocks')::boolean;
  IF v_row.state = 'closed' THEN
    v_totals := v_row.totals;
    -- Late: money of this day the snapshot does not hold (landed after the
    -- close). Shown, never added into the snapshot, no reopen needed.
    WITH lp AS (
      SELECT p.* FROM public.venue_till_payments p
      WHERE p.id IN (SELECT (x)::uuid FROM jsonb_array_elements_text(v_live->'paymentIds') x)
        AND p.id NOT IN (SELECT (x)::uuid FROM jsonb_array_elements_text(COALESCE(v_totals->'paymentIds', '[]'::jsonb)) x)
    ), lr AS (
      SELECT r.* FROM public.venue_till_refunds r
      WHERE r.id IN (SELECT (x)::uuid FROM jsonb_array_elements_text(v_live->'refundIds') x)
        AND r.id NOT IN (SELECT (x)::uuid FROM jsonb_array_elements_text(COALESCE(v_totals->'refundIds', '[]'::jsonb)) x)
    )
    SELECT jsonb_build_object(
        'count', (SELECT count(*) FROM lp),
        'amountMinor', COALESCE((SELECT sum(amount_minor) FROM lp), 0),
        'tipMinor', COALESCE((SELECT sum(tip_minor) FROM lp), 0),
        'payments', COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'paymentId', lp.id, 'method', public.issue_4490_close_method_key(lp.method, lp.provider_channel),
            'amountMinor', lp.amount_minor, 'tipMinor', lp.tip_minor, 'paidLate', lp.paid_late,
            'paidAtLocal', to_char(lp.paid_at AT TIME ZONE v_tz, 'HH24:MI'),
            'checkLabel', COALESCE(s.check_label, (SELECT q.label FROM public.qr_spots q WHERE q.id = s.qr_spot_id)))
            ORDER BY lp.paid_at, lp.id)
          FROM lp JOIN public.venue_till_sales s ON s.id = lp.sale_id), '[]'::jsonb),
        'refundCount', (SELECT count(*) FROM lr),
        'refundMinor', COALESCE((SELECT sum(amount_minor + tip_minor) FROM lr), 0),
        'refunds', COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'refundId', lr.id, 'method', lr.method, 'amountMinor', lr.amount_minor, 'tipMinor', lr.tip_minor,
            'atLocal', to_char(lr.created_at AT TIME ZONE v_tz, 'HH24:MI')) ORDER BY lr.created_at, lr.id)
          FROM lr), '[]'::jsonb))
      INTO v_late;
  ELSE
    v_totals := v_live;
  END IF;
  RETURN jsonb_build_object(
    'venueId', v_venue.id,
    'venueName', v_venue.name,
    'brandId', v_venue.brand_id,
    'businessDate', v_date,
    'today', v_today,
    'timezone', v_tz,
    'currency', v_totals->>'currency',
    'paper', COALESCE((SELECT s.print_paper FROM public.venue_till_settings s WHERE s.venue_id = v_venue.id), 'a4'),
    'state', COALESCE(v_row.state, 'open'),
    'close', CASE WHEN v_row.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', v_row.id,
      'closedAtLocal', CASE WHEN v_row.closed_at IS NULL THEN NULL
                            ELSE to_char(v_row.closed_at AT TIME ZONE v_tz, 'HH24:MI') END,
      'closedBy', CASE WHEN v_row.closed_by_user_id IS NULL THEN NULL
                       ELSE public.issue_4490_close_person(v_venue.id, v_row.closed_by_user_id) END,
      'cashCountedMinor', v_row.cash_counted_minor,
      'cashExpectedMinor', v_row.cash_expected_minor,
      'differenceMinor', v_row.difference_minor,
      'reopenCount', v_row.reopen_count,
      'reopenReason', v_row.reopen_reason,
      'canReopen', v_row.state = 'closed' AND v_date >= v_today - 7) END,
    'history', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'closedAtLocal', h->>'closedAtLocal', 'reopenedAtLocal', h->>'reopenedAtLocal',
        'reopenedBy', h->'reopenedBy', 'reason', h->>'reason',
        'differenceMinor', (h->>'differenceMinor')::bigint,
        'takingsMinor', (h->'totals'->'takings'->>'amountMinor')::bigint))
      FROM jsonb_array_elements(COALESCE(v_row.history, '[]'::jsonb)) h), '[]'::jsonb),
    'totals', v_totals - 'paymentIds' - 'refundIds',
    'late', v_late,
    'openChecks', v_checks,
    'blockingCount', v_blocking,
    'canClose', COALESCE(v_row.state, 'open') <> 'closed' AND v_blocking = 0
  );
END;
$function$;

-- ===========================================================================
-- 8. Close the day: one counted total; blocked by open checks; the snapshot.
--    Two closes at once: one wins (the day's advisory lock, then the row).
--    A retry with the same request id answers the close it made.
-- ===========================================================================
CREATE FUNCTION public.issue_4490_day_close(
  p_venue_id uuid,
  p_date date,
  p_counted_minor bigint,
  p_actor uuid,
  p_device_user uuid,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_venue public.venue_listings%ROWTYPE;
  v_row public.venue_day_closes%ROWTYPE;
  v_totals jsonb;
  v_expected bigint;
  v_blocking integer;
BEGIN
  v_venue := public.issue_4490_day_gate(p_venue_id, p_actor, p_device_user);
  IF p_request_id IS NULL OR p_counted_minor IS NULL OR p_counted_minor < 0 OR p_counted_minor > 100000000000 THEN
    RAISE EXCEPTION 'day_close_invalid' USING ERRCODE = '22023';
  END IF;
  PERFORM public.issue_4490_day_check_date(v_venue.id, p_date);
  PERFORM pg_advisory_xact_lock(hashtextextended('issue_4490_day_close:' || v_venue.id::text || ':' || p_date::text, 0));
  SELECT * INTO v_row FROM public.venue_day_closes
  WHERE venue_id = v_venue.id AND business_date = p_date FOR UPDATE;
  IF v_row.state = 'closed' THEN
    IF v_row.close_request_id = p_request_id THEN
      RETURN public.issue_4490_day_summary(v_venue.id, p_date, p_actor, p_device_user)
        || jsonb_build_object('replayed', true);
    END IF;
    RAISE EXCEPTION 'day_already_closed' USING ERRCODE = 'PT409';
  END IF;
  SELECT count(*) INTO v_blocking
  FROM jsonb_array_elements(public.issue_4490_day_open_checks(v_venue.id, p_date)) e WHERE (e->>'blocks')::boolean;
  IF v_blocking > 0 THEN
    RAISE EXCEPTION 'day_checks_open' USING ERRCODE = 'PT409',
      DETAIL = jsonb_build_object('remaining', v_blocking)::text;
  END IF;
  v_totals := public.issue_4490_day_totals(v_venue.id, p_date);
  v_expected := (v_totals->'cash'->>'expectedMinor')::bigint;
  IF v_row.id IS NULL THEN
    INSERT INTO public.venue_day_closes (
      venue_id, brand_id, business_date, state, currency, cash_counted_minor, cash_expected_minor,
      difference_minor, totals, closed_by_user_id, closed_device_user_id, closed_at, close_request_id)
    VALUES (v_venue.id, v_venue.brand_id, p_date, 'closed', v_totals->>'currency', p_counted_minor, v_expected,
      p_counted_minor - v_expected, v_totals, p_actor, COALESCE(p_device_user, p_actor), now(), p_request_id)
    RETURNING * INTO v_row;
  ELSE
    PERFORM set_config('mingla.issue_4490_day_close_write', 'write:' || v_row.id::text, true);
    UPDATE public.venue_day_closes SET
      state = 'closed', cash_counted_minor = p_counted_minor, cash_expected_minor = v_expected,
      difference_minor = p_counted_minor - v_expected, totals = v_totals, closed_by_user_id = p_actor,
      closed_device_user_id = COALESCE(p_device_user, p_actor), closed_at = now(), close_request_id = p_request_id,
      reopened_at = NULL, reopened_by_user_id = NULL, reopen_reason = NULL, updated_at = now()
    WHERE id = v_row.id
    RETURNING * INTO v_row;
    PERFORM set_config('mingla.issue_4490_day_close_write', '', true);
  END IF;
  PERFORM public.issue_4490_floor_audit(v_venue.brand_id, p_actor, p_device_user, 'till.close', 'venue_day_close',
    v_row.id::text, jsonb_build_object('venue_id', v_venue.id, 'business_date', p_date,
      'cash_counted_minor', p_counted_minor, 'cash_expected_minor', v_expected,
      'difference_minor', p_counted_minor - v_expected,
      'takings_minor', (v_totals->'takings'->>'amountMinor')::bigint, 'reopen_count', v_row.reopen_count));
  RETURN public.issue_4490_day_summary(v_venue.id, p_date, p_actor, p_device_user)
    || jsonb_build_object('replayed', false);
END;
$function$;

-- ===========================================================================
-- 9. Reopen: money rights (the edge adds a fresh PIN on a Till device),
--    within 7 days, a reason; the snapshot moves into history; the cash is
--    counted again at the next close.
-- ===========================================================================
CREATE FUNCTION public.issue_4490_day_reopen(
  p_venue_id uuid,
  p_date date,
  p_reason text,
  p_actor uuid,
  p_device_user uuid
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_venue public.venue_listings%ROWTYPE;
  v_row public.venue_day_closes%ROWTYPE;
  v_reason text := btrim(COALESCE(p_reason, ''));
  v_tz text;
BEGIN
  v_venue := public.issue_4490_day_gate(p_venue_id, p_actor, p_device_user);
  IF char_length(v_reason) < 1 OR char_length(v_reason) > 140 THEN
    RAISE EXCEPTION 'day_reason_required' USING ERRCODE = '22023';
  END IF;
  IF p_date IS NULL OR p_date > public.issue_4490_venue_service_date(v_venue.id, now()) THEN
    RAISE EXCEPTION 'day_out_of_range' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('issue_4490_day_close:' || v_venue.id::text || ':' || p_date::text, 0));
  SELECT * INTO v_row FROM public.venue_day_closes
  WHERE venue_id = v_venue.id AND business_date = p_date FOR UPDATE;
  IF NOT FOUND OR v_row.state <> 'closed' THEN
    RAISE EXCEPTION 'day_not_closed' USING ERRCODE = 'PT409';
  END IF;
  IF p_date < public.issue_4490_venue_service_date(v_venue.id, now()) - 7 THEN
    RAISE EXCEPTION 'day_reopen_too_late' USING ERRCODE = 'PT409';
  END IF;
  v_tz := public.issue_4490_venue_timezone(v_venue.id);
  PERFORM set_config('mingla.issue_4490_day_close_write', 'write:' || v_row.id::text, true);
  UPDATE public.venue_day_closes SET
    state = 'reopened',
    history = history || jsonb_build_array(jsonb_build_object(
      'closedAt', v_row.closed_at,
      'closedAtLocal', to_char(v_row.closed_at AT TIME ZONE v_tz, 'HH24:MI'),
      'closedBy', public.issue_4490_close_person(v_venue.id, v_row.closed_by_user_id),
      'closedByUserId', v_row.closed_by_user_id,
      'closedDeviceUserId', v_row.closed_device_user_id,
      'cashCountedMinor', v_row.cash_counted_minor,
      'cashExpectedMinor', v_row.cash_expected_minor,
      'differenceMinor', v_row.difference_minor,
      'totals', v_row.totals,
      'reopenedAt', now(),
      'reopenedAtLocal', to_char(now() AT TIME ZONE v_tz, 'HH24:MI'),
      'reopenedBy', public.issue_4490_close_person(v_venue.id, p_actor),
      'reopenedByUserId', p_actor,
      'reason', v_reason)),
    totals = NULL, cash_counted_minor = NULL, cash_expected_minor = NULL, difference_minor = NULL,
    closed_by_user_id = NULL, closed_device_user_id = NULL, closed_at = NULL, close_request_id = NULL,
    reopen_count = reopen_count + 1, reopened_at = now(), reopened_by_user_id = p_actor, reopen_reason = v_reason,
    updated_at = now()
  WHERE id = v_row.id
  RETURNING * INTO v_row;
  PERFORM set_config('mingla.issue_4490_day_close_write', '', true);
  PERFORM public.issue_4490_floor_audit(v_venue.brand_id, p_actor, p_device_user, 'till.reopen', 'venue_day_close',
    v_row.id::text, jsonb_build_object('venue_id', v_venue.id, 'business_date', p_date, 'reason', v_reason,
      'reopen_count', v_row.reopen_count));
  RETURN public.issue_4490_day_summary(v_venue.id, p_date, p_actor, p_device_user);
END;
$function$;

-- ===========================================================================
-- 10. Move to tomorrow: the check stops blocking day D (carried_past = D).
-- ===========================================================================
CREATE FUNCTION public.issue_4490_till_carry_over(
  p_sale_id uuid,
  p_date date,
  p_actor uuid,
  p_device_user uuid
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_sale public.venue_till_sales%ROWTYPE;
  v_venue public.venue_listings%ROWTYPE;
  v_date date;
BEGIN
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_sale FROM public.venue_till_sales WHERE id = p_sale_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'till_sale_not_found' USING ERRCODE = 'P0002';
  END IF;
  v_venue := public.issue_4490_day_gate(v_sale.venue_id, p_actor, p_device_user);
  v_date := COALESCE(p_date, public.issue_4490_venue_service_date(v_venue.id, now()));
  PERFORM public.issue_4490_day_check_date(v_venue.id, v_date);
  IF v_sale.state NOT IN ('open', 'paying') THEN
    RAISE EXCEPTION 'till_check_closed' USING ERRCODE = 'PT409';
  END IF;
  IF v_sale.carried_past IS NULL OR v_sale.carried_past < v_date THEN
    UPDATE public.venue_till_sales SET carried_past = v_date, updated_at = now() WHERE id = v_sale.id;
    PERFORM public.issue_4490_floor_audit(v_venue.brand_id, p_actor, p_device_user, 'till.carry_over',
      'venue_till_sale', v_sale.id::text, jsonb_build_object('venue_id', v_venue.id, 'carried_past', v_date));
  END IF;
  RETURN jsonb_build_object('saleId', v_sale.id, 'carriedPast', GREATEST(COALESCE(v_sale.carried_past, v_date), v_date));
END;
$function$;

-- ===========================================================================
-- 11. The drawer: float and paid outs (money rights; never on a closed day).
-- ===========================================================================
CREATE FUNCTION public.issue_4490_cash_movements_list(
  p_venue_id uuid,
  p_date date,
  p_actor uuid,
  p_device_user uuid
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_venue public.venue_listings%ROWTYPE;
  v_date date;
  v_tz text;
  v_prev public.venue_cash_movements%ROWTYPE;
BEGIN
  v_venue := public.issue_4490_day_gate(p_venue_id, p_actor, p_device_user);
  v_date := COALESCE(p_date, public.issue_4490_venue_service_date(v_venue.id, now()));
  PERFORM public.issue_4490_day_check_date(v_venue.id, v_date);
  v_tz := public.issue_4490_venue_timezone(v_venue.id);
  -- "Same as yesterday": the float of the latest earlier day that had one.
  SELECT * INTO v_prev FROM public.venue_cash_movements m
  WHERE m.venue_id = v_venue.id AND m.kind = 'float' AND m.business_date < v_date
    AND m.business_date >= v_date - 30
  ORDER BY m.business_date DESC, m.created_at DESC, m.id DESC LIMIT 1;
  RETURN jsonb_build_object(
    'businessDate', v_date,
    'currency', (SELECT upper(b.default_currency) FROM public.brands b WHERE b.id = v_venue.brand_id),
    'floatMinor', public.issue_4490_day_float(v_venue.id, v_date),
    'previousFloatMinor', v_prev.amount_minor,
    'dayClosed', EXISTS (SELECT 1 FROM public.venue_day_closes c
                         WHERE c.venue_id = v_venue.id AND c.business_date = v_date AND c.state = 'closed'),
    'movements', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', m.id, 'kind', m.kind, 'amountMinor', m.amount_minor, 'note', m.note,
        'atLocal', to_char(m.created_at AT TIME ZONE v_tz, 'HH24:MI'),
        'by', public.issue_4490_close_person(v_venue.id, m.by_user_id),
        'current', m.kind = 'paid_out' OR m.id = (
          SELECT f.id FROM public.venue_cash_movements f
          WHERE f.venue_id = v_venue.id AND f.business_date = v_date AND f.kind = 'float'
          ORDER BY f.created_at DESC, f.id DESC LIMIT 1))
        ORDER BY m.created_at, m.id)
      FROM public.venue_cash_movements m
      WHERE m.venue_id = v_venue.id AND m.business_date = v_date), '[]'::jsonb));
END;
$function$;

CREATE FUNCTION public.issue_4490_cash_movement(
  p_venue_id uuid,
  p_date date,
  p_kind text,
  p_amount_minor bigint,
  p_note text,
  p_actor uuid,
  p_device_user uuid,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_venue public.venue_listings%ROWTYPE;
  v_date date;
  v_note text := NULLIF(btrim(COALESCE(p_note, '')), '');
  v_old public.venue_cash_movements%ROWTYPE;
  v_row public.venue_cash_movements%ROWTYPE;
BEGIN
  v_venue := public.issue_4490_day_gate(p_venue_id, p_actor, p_device_user);
  IF p_request_id IS NULL OR p_kind IS NULL OR p_kind NOT IN ('float', 'paid_out')
     OR p_amount_minor IS NULL OR p_amount_minor <= 0 OR p_amount_minor > 2147483647
     OR (v_note IS NOT NULL AND char_length(v_note) > 140)
     OR (p_kind = 'paid_out' AND v_note IS NULL) THEN
    RAISE EXCEPTION 'cash_movement_invalid' USING ERRCODE = '22023';
  END IF;
  v_date := COALESCE(p_date, public.issue_4490_venue_service_date(v_venue.id, now()));
  PERFORM public.issue_4490_day_check_date(v_venue.id, v_date);
  SELECT * INTO v_old FROM public.venue_cash_movements WHERE venue_id = v_venue.id AND client_request_id = p_request_id;
  IF FOUND THEN
    IF v_old.kind = p_kind AND v_old.amount_minor = p_amount_minor AND v_old.business_date = v_date
       AND v_old.note IS NOT DISTINCT FROM v_note THEN
      RETURN public.issue_4490_cash_movements_list(v_venue.id, v_date, p_actor, p_device_user)
        || jsonb_build_object('replayed', true);
    END IF;
    RAISE EXCEPTION 'till_request_reused' USING ERRCODE = 'PT409';
  END IF;
  -- The same lock as the close: a movement and a close of that day never cross.
  PERFORM pg_advisory_xact_lock(hashtextextended('issue_4490_day_close:' || v_venue.id::text || ':' || v_date::text, 0));
  IF EXISTS (SELECT 1 FROM public.venue_day_closes c
             WHERE c.venue_id = v_venue.id AND c.business_date = v_date AND c.state = 'closed') THEN
    RAISE EXCEPTION 'day_already_closed' USING ERRCODE = 'PT409';
  END IF;
  INSERT INTO public.venue_cash_movements (venue_id, brand_id, business_date, kind, amount_minor, currency, note,
    by_user_id, device_user_id, client_request_id)
  VALUES (v_venue.id, v_venue.brand_id, v_date, p_kind, p_amount_minor,
    (SELECT upper(b.default_currency) FROM public.brands b WHERE b.id = v_venue.brand_id), v_note,
    p_actor, COALESCE(p_device_user, p_actor), p_request_id)
  RETURNING * INTO v_row;
  PERFORM public.issue_4490_floor_audit(v_venue.brand_id, p_actor, p_device_user, 'till.cash_movement',
    'venue_cash_movement', v_row.id::text, jsonb_build_object('venue_id', v_venue.id, 'business_date', v_date,
      'kind', p_kind, 'amount_minor', p_amount_minor));
  RETURN public.issue_4490_cash_movements_list(v_venue.id, v_date, p_actor, p_device_user)
    || jsonb_build_object('replayed', false);
END;
$function$;

-- ===========================================================================
-- 12. Export: one row per payment of the day (the edge asks for a fresh PIN
--     on a Till device first). Names only, never an email.
-- ===========================================================================
CREATE FUNCTION public.issue_4490_day_export(p_venue_id uuid, p_date date, p_actor uuid, p_device_user uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_venue public.venue_listings%ROWTYPE;
  v_pay uuid[];
  v_tz text;
  v_row public.venue_day_closes%ROWTYPE;
  v_closed uuid[] := '{}'::uuid[];
BEGIN
  v_venue := public.issue_4490_day_gate(p_venue_id, p_actor, p_device_user);
  PERFORM public.issue_4490_day_check_date(v_venue.id, p_date);
  v_tz := public.issue_4490_venue_timezone(v_venue.id);
  v_pay := public.issue_4490_day_payment_ids(v_venue.id, p_date);
  SELECT * INTO v_row FROM public.venue_day_closes WHERE venue_id = v_venue.id AND business_date = p_date;
  IF v_row.state = 'closed' THEN
    SELECT COALESCE(array_agg((x)::uuid), '{}'::uuid[]) INTO v_closed
    FROM jsonb_array_elements_text(COALESCE(v_row.totals->'paymentIds', '[]'::jsonb)) x;
  END IF;
  RETURN jsonb_build_object(
    'venueName', v_venue.name,
    'businessDate', p_date,
    'currency', (SELECT upper(b.default_currency) FROM public.brands b WHERE b.id = v_venue.brand_id),
    'rows', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'paymentId', p.id,
        'reference', upper(right(replace(p.id::text, '-', ''), 8)),
        'paidAtLocal', to_char(p.paid_at AT TIME ZONE v_tz, 'YYYY-MM-DD HH24:MI'),
        'check', COALESCE(s.check_label, (SELECT q.label FROM public.qr_spots q WHERE q.id = s.qr_spot_id)),
        'method', public.issue_4490_close_method_key(p.method, p.provider_channel),
        'amountMinor', p.amount_minor,
        'serviceChargeMinor', p.service_charge_minor,
        'tipMinor', p.tip_minor,
        'guestFeeMinor', CASE WHEN p.method IN ('tap', 'scan')
          THEN GREATEST(COALESCE(p.charged_minor, p.amount_minor + p.tip_minor) - p.amount_minor - p.tip_minor, 0)
          ELSE 0 END,
        'refundedMinor', COALESCE((SELECT sum(r.amount_minor + r.tip_minor) FROM public.venue_till_refunds r
                                   WHERE r.payment_id = p.id), 0),
        'takenBy', public.issue_4490_close_person(v_venue.id, p.taken_by_user_id),
        'server', public.issue_4490_close_person(v_venue.id, p.server_user_id),
        'paidAfterCancel', p.paid_late,
        'late', v_row.state = 'closed' AND NOT (p.id = ANY(v_closed)))
        ORDER BY p.paid_at, p.id)
      FROM public.venue_till_payments p JOIN public.venue_till_sales s ON s.id = p.sale_id
      WHERE p.id = ANY(v_pay)), '[]'::jsonb));
END;
$function$;

-- ===========================================================================
-- 13. Settings › Selling in person (read): brand_admin+ with the Till released
--     at the venue (the edge refuses any PIN session). Makes the venue's row
--     on first read so the screen's version check has a row to match.
-- ===========================================================================
CREATE FUNCTION public.issue_4490_till_settings_read(p_venue_id uuid, p_actor uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_venue public.venue_listings%ROWTYPE;
BEGIN
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_venue FROM public.venue_listings WHERE id = p_venue_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'venue_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.issue_4490_till_enabled(v_venue.id) THEN
    RAISE EXCEPTION 'till_not_enabled' USING ERRCODE = 'P0001';
  END IF;
  IF p_actor IS NULL
     OR public.biz_brand_effective_rank(v_venue.brand_id, p_actor) < public.biz_role_rank('brand_admin') THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.venue_till_settings (venue_id, brand_id) VALUES (v_venue.id, v_venue.brand_id)
  ON CONFLICT (venue_id) DO NOTHING;
  RETURN public.issue_4490_till_settings_projection(v_venue.id) - 'dayStartsAt' || jsonb_build_object(
    'venueName', v_venue.name,
    'brandId', v_venue.brand_id,
    'currency', (SELECT upper(b.default_currency) FROM public.brands b WHERE b.id = v_venue.brand_id),
    'serviceChargeBps', COALESCE((SELECT o.service_charge_bps FROM public.venue_ordering_settings o
                                  WHERE o.venue_id = v_venue.id), 0),
    'kitchenScreensOn', public.issue_4490_venue_feature_on(v_venue.id, 'kitchen_screens'),
    -- The business day follows the opening hours (08-O5B): how many weekdays
    -- run past midnight, so the screen can say what happens to a 01:00 sale.
    'pastMidnightDays', (SELECT count(*) FROM public.brand_hours h
                         WHERE h.venue_id = v_venue.id AND NOT h.is_closed AND h.open_time IS NOT NULL
                           AND h.close_time IS NOT NULL AND h.close_time <= h.open_time));
END;
$function$;

-- ===========================================================================
-- 14. Grants: every function here is internal (service role only).
-- ===========================================================================
REVOKE ALL ON FUNCTION public.issue_4490_till_settings_read(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4490_till_settings_read(uuid, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.issue_4490_day_close_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_4490_cash_movement_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_4490_floor_audit(uuid, uuid, uuid, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_4490_till_business_date(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_4490_close_person(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_4490_close_method_key(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_4490_close_method_order(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_4490_day_payment_ids(uuid, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_4490_day_refund_ids(uuid, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_4490_day_float(uuid, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_4490_day_totals(uuid, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_4490_day_open_checks(uuid, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_4490_day_gate(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_4490_day_check_date(uuid, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_4490_day_summary(uuid, date, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_4490_day_close(uuid, date, bigint, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_4490_day_reopen(uuid, date, text, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_4490_till_carry_over(uuid, date, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_4490_cash_movements_list(uuid, date, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_4490_cash_movement(uuid, date, text, bigint, text, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_4490_day_export(uuid, date, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4490_floor_audit(uuid, uuid, uuid, text, text, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_4490_till_business_date(uuid, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_4490_close_person(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_4490_close_method_key(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_4490_close_method_order(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_4490_day_payment_ids(uuid, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_4490_day_refund_ids(uuid, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_4490_day_float(uuid, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_4490_day_totals(uuid, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_4490_day_open_checks(uuid, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_4490_day_gate(uuid, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_4490_day_check_date(uuid, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_4490_day_summary(uuid, date, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_4490_day_close(uuid, date, bigint, uuid, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_4490_day_reopen(uuid, date, text, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_4490_till_carry_over(uuid, date, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_4490_cash_movements_list(uuid, date, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_4490_cash_movement(uuid, date, text, bigint, text, uuid, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_4490_day_export(uuid, date, uuid, uuid) TO service_role;

COMMIT;

-- Reverse (local use only): DROP the tables venue_cash_movements and
-- venue_day_closes and the functions above; re-apply issue_4490_floor_audit
-- from 20281203684490 and issue_4490_till_business_date from 20281203504490.
