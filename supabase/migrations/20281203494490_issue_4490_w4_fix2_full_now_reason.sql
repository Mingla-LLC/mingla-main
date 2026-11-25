-- Issue #4490, spec 06 W4 fix 2 (W4-R1): say WHY a booking whose offer takes a
-- deposit asks for everything now.
--
-- Proven on the local stack (private hire VB-D05D4911): the offer takes a 50%
-- deposit with the balance due 14 days before; the hire is on 30 Nov, so the
-- balance date (16 Nov) had passed before the request was even sent. The
-- deposit plan (issue_4490_deposit_plan) then folds the deposit into one
-- payment ("collapsed": "balance_due_passed") and the approval asks for the
-- whole amount, the refundable damage deposit included (spec 07 §C: the
-- percentage applies to everything but the damage deposit, which is paid with
-- the rest). That is correct, but the booking read the guest pays from (app
-- Purchases, buyer web booking page) only said "full", so it looked as if the
-- deposit setting had been ignored.
--
-- 1. issue_4490_full_now_reason(group): for a booking waiting for its first
--    payment (instant_payment_pending, approved_payment_required; paid through
--    Mingla) whose offer takes a deposit but which is offered only "full":
--      'balance_due_passed'   the balance date (session start minus the offer's
--                             balance_due_days_before) is now or past;
--      'deposit_covers_total' the deposit is the whole amount;
--    otherwise NULL (no deposit on the offer, a deposit still offered, paid,
--    a request still waiting, no session window). Read only; no money moves.
-- 2. issue_4490_booking_projection (latest 20281203384490 patches over
--    20281203334490) gains 'fullNowReason' beside 'payModes'. Checked patch: a
--    changed predecessor stops the migration.
-- No amount, state or pay mode changes. Internal (service role only).

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.issue_4490_full_now_reason(p_group_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT CASE
    WHEN g.state NOT IN ('instant_payment_pending', 'approved_payment_required')
      OR g.payment_collection IS DISTINCT FROM 'mingla' THEN NULL
    WHEN COALESCE(o.deposit_kind, 'none') = 'none' OR w.starts_at IS NULL THEN NULL
    -- A deposit is still offered: nothing to explain.
    WHEN g.deposit_minor IS NOT NULL AND g.balance_due_at > now() THEN NULL
    WHEN w.starts_at - make_interval(days => COALESCE(o.balance_due_days_before, 0)) <= now()
      THEN 'balance_due_passed'
    ELSE 'deposit_covers_total'
  END
  FROM public.stay_reservation_groups g
  LEFT JOIN LATERAL (
    SELECT l.offering_id, l.place_window_id
    FROM public.stay_reservation_lines l
    WHERE l.group_id = g.id AND l.place_window_id IS NOT NULL
    ORDER BY l.created_at, l.id
    LIMIT 1
  ) l ON true
  LEFT JOIN public.stay_offerings o ON o.id = l.offering_id
  LEFT JOIN public.stay_place_windows w ON w.id = l.place_window_id
  WHERE g.id = p_group_id AND g.offer_kind IS NOT NULL;
$function$;

REVOKE ALL ON FUNCTION public.issue_4490_full_now_reason(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4490_full_now_reason(uuid) TO service_role;

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
  IF v_new_count = 1 AND v_old_count = 0 THEN RETURN; END IF;
  IF v_old_count <> 1 OR v_new_count <> 0 THEN
    RAISE EXCEPTION 'issue_4490 w4 fix 2 patch precondition failed for %: old %, new %',
      p_sig, v_old_count, v_new_count;
  END IF;
  EXECUTE replace(v_def, p_old, p_new);
END;
$patch$;

SELECT pg_temp.issue_4490_patch(
  'public.issue_4490_booking_projection(uuid,text)'::regprocedure,
  $old$    'balanceDueAt', g.balance_due_at,
    'payModes', CASE$old$,
  $new$    'balanceDueAt', g.balance_due_at,
    -- #4490 06-W4 fix 2 (W4-R1): why only "full" is offered on an offer that takes a deposit.
    'fullNowReason', public.issue_4490_full_now_reason(g.id),
    'payModes', CASE$new$
);

DROP FUNCTION pg_temp.issue_4490_patch(regprocedure, text, text);

-- The projection keeps its privileges (CREATE OR REPLACE keeps the ACL); restated.
REVOKE ALL ON FUNCTION public.issue_4490_booking_projection(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4490_booking_projection(uuid, text) TO service_role;

COMMIT;
