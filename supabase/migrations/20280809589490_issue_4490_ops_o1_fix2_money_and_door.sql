-- Issue #4490, spec 08 O1 fix round 2 (between the O1 fix slots 584490 and
-- 594490, so it stays inside spec 08's block without taking a slot reserved
-- for O2 to O5). Every change here is order-independent of 584490/594490:
-- a trigger on a table 464490 creates, and checked patches of text 594490
-- does not touch.
--
-- 1. O1-B2: money taken beyond what a check costs (overpaid_minor) follows
--    every refund. A refund first comes out of that extra; on a check that is
--    still open the rest lowers what is counted as paid. overpaid_minor is
--    then re-derived from the payments: what was taken (paid, part refunded
--    or refunded payments, late ones included), minus what was refunded,
--    minus what is counted against the bill (paid_minor). One trigger on
--    venue_till_refunds covers every refund path (cash or own machine by
--    amount, an entry line, a card refund). Existing rows are corrected.
-- 2. O1-B3: the day's money (issue_4490_venue_money_day) puts money taken in
--    the Till on the venue's service day, the same rule as its refund. The
--    Till writes venue_offline_payments.paid_on as its own business date (a
--    05:00 rule), which is not a day staff chose; the money day now reads the
--    service day of the moment it was taken. Refunds already land on their
--    service day (stay_refunds, source_refunds, Till offer lines); which
--    refunds count and the spec 07 §E definitions are unchanged.
-- 3. Spec 08 §13 (door sales with the Till off): a gate sale paid in cash or
--    by transfer (payment_collection 'property', recorded by the
--    stay_offer_gate_paid event) is money received at the venue that day, so
--    it counts in "Paid in today" (b) on the service day it was taken, and in
--    "For today's bookings" for its booking day. It never had an offline
--    payment row, so it was counted nowhere; it is counted once here and
--    never as a Till check.
-- 4. Spec 08 §13: a guest-list arrival sitting on an open Till check cannot
--    also be sold at the gate (money taken once).
--
-- No venue_id column is added (the #2099 dependency seal is unchanged).
-- Static SQL. Local stack only until Seth approves a production migration.

BEGIN;
SET LOCAL lock_timeout = '5s';

-- Checked patch: the old text must appear exactly as many times as stated.
CREATE FUNCTION pg_temp.issue_4490_f2_patch(
  p_sig regprocedure,
  p_old text,
  p_new text,
  p_count integer DEFAULT 1
)
RETURNS void
LANGUAGE plpgsql
AS $patch$
DECLARE
  v_def text := pg_get_functiondef(p_sig);
  v_old_count integer;
BEGIN
  v_old_count := (length(v_def) - length(replace(v_def, p_old, ''))) / length(p_old);
  IF v_old_count <> p_count THEN
    RAISE EXCEPTION 'issue_4490 O1 fix 2 patch precondition failed for %: old % (expected %)',
      p_sig, v_old_count, p_count;
  END IF;
  EXECUTE replace(v_def, p_old, p_new);
END;
$patch$;

-- ---------------------------------------------------------------------------
-- 1. O1-B2: overpaid follows every refund.
-- ---------------------------------------------------------------------------
-- What was taken beyond what is counted against the bill, still not refunded.
CREATE OR REPLACE FUNCTION public.issue_4490_till_overpaid_derived(p_sale_id uuid)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT GREATEST(0,
    COALESCE((SELECT sum(p.amount_minor) FROM public.venue_till_payments p
              WHERE p.sale_id = s.id AND p.state IN ('paid', 'partially_refunded', 'refunded')), 0)
    - COALESCE((SELECT sum(r.amount_minor) FROM public.venue_till_refunds r
                JOIN public.venue_till_payments p ON p.id = r.payment_id
                WHERE p.sale_id = s.id), 0)
    - s.paid_minor)::bigint
  FROM public.venue_till_sales s
  WHERE s.id = p_sale_id;
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_till_refund_settles()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_sale public.venue_till_sales%ROWTYPE;
  v_from_extra bigint;
  v_paid bigint;
  v_overpaid bigint;
BEGIN
  SELECT s.* INTO v_sale
  FROM public.venue_till_sales s
  JOIN public.venue_till_payments p ON p.sale_id = s.id
  WHERE p.id = NEW.payment_id
  FOR UPDATE OF s;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  -- The refund comes out of the extra first; on a check still being paid the
  -- rest is no longer counted as paid (the bill shows it as due again).
  v_from_extra := LEAST(NEW.amount_minor, v_sale.overpaid_minor);
  v_paid := v_sale.paid_minor;
  IF v_sale.state IN ('open', 'paying') THEN
    v_paid := GREATEST(0, v_paid - (NEW.amount_minor - v_from_extra));
  END IF;
  UPDATE public.venue_till_sales SET paid_minor = v_paid, updated_at = now() WHERE id = v_sale.id;
  v_overpaid := public.issue_4490_till_overpaid_derived(v_sale.id);
  UPDATE public.venue_till_sales
  SET overpaid_minor = v_overpaid,
      version = CASE WHEN v_overpaid <> v_sale.overpaid_minor OR v_paid <> v_sale.paid_minor
                     THEN version + 1 ELSE version END,
      updated_at = now()
  WHERE id = v_sale.id;
  RETURN NULL;
END;
$function$;

CREATE TRIGGER issue_4490_till_refund_settles
  AFTER INSERT ON public.venue_till_refunds
  FOR EACH ROW EXECUTE FUNCTION public.issue_4490_till_refund_settles();

-- Rows written before this fix (the browser pass's "B1 Tolu": refunded in
-- full, overpaid still 4,000.00): the extra already given back is cleared.
-- Never raised: only lowered to what the payments prove.
UPDATE public.venue_till_sales s
SET overpaid_minor = public.issue_4490_till_overpaid_derived(s.id), updated_at = now()
WHERE s.overpaid_minor > public.issue_4490_till_overpaid_derived(s.id);

-- ---------------------------------------------------------------------------
-- 2 + 3. The day's money: Till money on its service day; gate sales counted.
-- ---------------------------------------------------------------------------
SELECT pg_temp.issue_4490_f2_patch(
  'public.issue_4490_venue_money_day(uuid,date)'::regprocedure,
  $old$          WHEN o.paid_on = (o.created_at AT TIME ZONE public.issue_4490_venue_timezone(p_venue_id))::date
            THEN public.issue_4490_venue_service_date(p_venue_id, o.created_at)$old$,
  $new$          -- #4490 08-O1 fix 2 (O1-B3): money taken in the Till lands on the
          -- service day it was taken, the same rule as its refund. Its paid_on
          -- is the Till's own business date, not a day staff chose.
          WHEN o.method = 'till'
            THEN public.issue_4490_venue_service_date(p_venue_id, o.created_at)
          WHEN o.paid_on = (o.created_at AT TIME ZONE public.issue_4490_venue_timezone(p_venue_id))::date
            THEN public.issue_4490_venue_service_date(p_venue_id, o.created_at)$new$
);
SELECT pg_temp.issue_4490_f2_patch(
  'public.issue_4490_venue_money_day(uuid,date)'::regprocedure,
  $old$  -- (c) membership periods paid at the venue (these write no offline payment row)$old$,
  $new$  -- #4490 08-O1 fix 2 (spec 08 §13): a gate sale paid in cash or by transfer
  -- was paid in full at the gate and writes no offline payment row; it counts
  -- on the service day it was taken (the stay_offer_gate_paid event).
  v_at_venue := v_at_venue + COALESCE((
    SELECT sum(g.total_minor) FROM public.stay_reservation_groups g
    JOIN public.stay_reservation_events e
      ON e.group_id = g.id AND e.event_type = 'stay_offer_gate_paid'
    WHERE g.venue_id = p_venue_id AND g.payment_collection = 'property'
      AND upper(g.currency_code) = v_cur
      AND public.issue_4490_venue_service_date(p_venue_id, e.created_at) = p_local_date), 0)::bigint;
  -- (c) membership periods paid at the venue (these write no offline payment row)$new$
);
SELECT pg_temp.issue_4490_f2_patch(
  'public.issue_4490_venue_money_day(uuid,date)'::regprocedure,
  $old$              WHERE o.group_id IN (SELECT id FROM day_groups) AND upper(o.currency_code) = v_cur), 0),$old$,
  $new$              WHERE o.group_id IN (SELECT id FROM day_groups) AND upper(o.currency_code) = v_cur), 0)
    -- #4490 08-O1 fix 2 (spec 08 §13): gate sales paid in cash or by transfer.
    + COALESCE((SELECT sum(g.total_minor) FROM public.stay_reservation_groups g
                WHERE g.id IN (SELECT id FROM day_groups) AND g.payment_collection = 'property'
                  AND upper(g.currency_code) = v_cur
                  AND EXISTS (SELECT 1 FROM public.stay_reservation_events e
                              WHERE e.group_id = g.id AND e.event_type = 'stay_offer_gate_paid')), 0),$new$
);

-- ---------------------------------------------------------------------------
-- 4. One guest-list arrival is sold once: not at the gate while it sits on an
--    open Till check (spec 08 §13; 594490 already refuses the reverse).
-- ---------------------------------------------------------------------------
SELECT pg_temp.issue_4490_f2_patch(
  'public.issue_4490_guest_list_gate_sale(uuid,uuid,integer,text,jsonb,text,uuid,uuid,bytea)'::regprocedure,
  $old$  IF NOT FOUND OR v_entry.status <> 'on_list' THEN
    RAISE EXCEPTION 'guest_list_entry_not_found' USING ERRCODE = 'P0002';
  END IF;$old$,
  $new$  IF NOT FOUND OR v_entry.status <> 'on_list' THEN
    RAISE EXCEPTION 'guest_list_entry_not_found' USING ERRCODE = 'P0002';
  END IF;
  -- #4490 08-O1 fix 2: the same arrival is never taken at the gate and in the Till.
  IF EXISTS (SELECT 1 FROM public.venue_till_lines l
             WHERE l.guest_list_entry_id = v_entry.id AND l.state = 'held') THEN
    RAISE EXCEPTION 'guest_list_entry_on_check' USING ERRCODE = 'PT409';
  END IF;$new$
);

-- ---------------------------------------------------------------------------
-- 5. Grants (new functions are internal: service role only; the trigger
--    function is not callable).
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION
  public.issue_4490_till_overpaid_derived(uuid),
  public.issue_4490_till_refund_settles()
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4490_till_overpaid_derived(uuid) TO service_role;

COMMIT;
