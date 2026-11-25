-- Issue #4490, spec 08 O5 fix round 4: "can refund" has one rule.
--
-- A device and browser pass found that a venue Manager with Till money rights
-- (the venue.manage_money grant) could approve Till refunds and appeared as an
-- approver on the swap PIN pad, yet on a guest line that sold out after
-- payment was offered only "Swap item", with the cheaper swap greyed "ask
-- someone who can refund". The sold-out read (canRefund), the sold-out refund
-- and the money-returning sold-out swap asked for brand rank >= event_manager
-- and ignored the venue money rights.
--
-- From here the sold-out refund, the money-returning sold-out swap and the
-- canRefund flag the Host app reads all ask issue_4490_can_manage_money: the
-- one rule every Till refund already uses (venue.manage_money at that venue,
-- or brand rank >= finance_manager). Nothing is refundable that a Till refund
-- does not already allow. The sold-out read is open to whoever may refund, as
-- well as to the kitchen and the sellers. On a Till device the fresh PIN
-- step-up (issue_4490_pin_step_up_take) is still taken in the same
-- transaction; nothing about it changes. A swap that gives nothing back keeps
-- the swap rules (kitchen or seller).
--
-- The late payments the closed day lists also name who took each payment
-- (takenBy), so a check with no name and no QR spot reads as more than
-- "Team member" in Host.
--
-- No new column, no new venue_id: the #2099 pending-venue seal does not move.
-- Functions are patched in place (each patch refuses a definition it does not
-- recognise).

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE FUNCTION pg_temp.issue_4490_o5f4_patch(p_sig regprocedure, p_old text, p_new text, p_count integer DEFAULT 1)
RETURNS void
LANGUAGE plpgsql
AS $patch$
DECLARE
  v_def text := pg_get_functiondef(p_sig);
  v_old_count integer;
BEGIN
  v_old_count := (length(v_def) - length(replace(v_def, p_old, ''))) / length(p_old);
  IF v_old_count <> p_count THEN
    RAISE EXCEPTION 'issue_4490 O5 fix 4 patch precondition failed for %: old % (expected %)',
      p_sig, v_old_count, p_count;
  END IF;
  EXECUTE replace(v_def, p_old, p_new);
END;
$patch$;

-- ===========================================================================
-- 1. The sold-out refund and the money-returning swap: the Till refund rule.
-- ===========================================================================
SELECT pg_temp.issue_4490_o5f4_patch(
  'public.issue_4490_order_sold_out_resolve(uuid,uuid[],text,uuid,uuid,uuid,text)'::regprocedure,
  $old$public.biz_brand_effective_rank(v_order.brand_id, p_actor) < public.biz_role_rank('event_manager')$old$,
  $new$NOT public.issue_4490_can_manage_money(v_order.venue_id, p_actor)$new$,
  2
);

-- ===========================================================================
-- 2. The staff read: canRefund is the same rule; who may refund may read.
-- ===========================================================================
SELECT pg_temp.issue_4490_o5f4_patch(
  'public.issue_4490_order_sold_out(uuid,uuid)'::regprocedure,
  $old$          OR public.biz_brand_effective_rank(v_order.brand_id, p_actor) >= public.biz_role_rank('event_manager')) THEN$old$,
  $new$          OR public.issue_4490_can_manage_money(v_order.venue_id, p_actor)) THEN$new$
);
SELECT pg_temp.issue_4490_o5f4_patch(
  'public.issue_4490_order_sold_out(uuid,uuid)'::regprocedure,
  $old$'canRefund', public.biz_brand_effective_rank(v_order.brand_id, p_actor) >= public.biz_role_rank('event_manager'),$old$,
  $new$'canRefund', public.issue_4490_can_manage_money(v_order.venue_id, p_actor),$new$
);

-- ===========================================================================
-- 3. Late payments since close name who took the payment, so a check with no
--    name and no QR spot is still told apart (never just "Team member").
-- ===========================================================================
SELECT pg_temp.issue_4490_o5f4_patch(
  'public.issue_4490_day_summary(uuid,date,uuid,uuid)'::regprocedure,
  $old$'checkLabel', COALESCE(s.check_label, (SELECT q.label FROM public.qr_spots q WHERE q.id = s.qr_spot_id)))$old$,
  $new$'checkLabel', COALESCE(s.check_label, (SELECT q.label FROM public.qr_spots q WHERE q.id = s.qr_spot_id)),
            'takenBy', public.issue_4490_close_person(v_venue.id, lp.taken_by_user_id))$new$
);

COMMIT;

-- Reverse (local use only): re-apply issue_4490_order_sold_out from
-- 20281203734490 and issue_4490_order_sold_out_resolve from 20281203734490
-- followed by the section 7 patches of 20281203754490; issue_4490_day_summary
-- from 20281203704490 followed by its patch in 20281203724490.
