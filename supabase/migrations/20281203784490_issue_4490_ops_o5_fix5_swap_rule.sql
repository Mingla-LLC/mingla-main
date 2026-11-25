-- Issue #4490, spec 08 O5 fix round 5: a cheaper swap follows the refund rule.
--
-- The web and iOS re-check found that a brand finance manager (money rights
-- through brand rank, no venue sell or kitchen grant) was offered Refund on a
-- guest line that sold out after payment (canRefund true) but no Swap item
-- (canSwap false), and the server refused the cheaper swap: every swap was
-- first asked for the kitchen or seller grant, before the money rule that
-- fix 4 put on a swap that gives money back.
--
-- A cheaper swap gives money back, so it is a refund and follows the one
-- refund rule, issue_4490_can_manage_money (venue.manage_money at that venue,
-- or brand rank >= finance_manager), as fix 4 already asks after the price is
-- worked out. From here:
--   * the swap entry check lets in the kitchen, the sellers AND whoever may
--     refund;
--   * a swap that gives nothing back (same price) keeps the kitchen or seller
--     rule (checked once the money back is known: not_authorized);
--   * the staff read says canSwap for the kitchen, the sellers and whoever may
--     refund, and canSwapEven (a same-price swap) for the kitchen and the
--     sellers only, so Host offers exactly what the server allows.
-- On a Till device the fresh PIN step-up for a money-returning swap is
-- unchanged (fix 3).
--
-- No new column, no new venue_id: the #2099 pending-venue seal does not move.
-- Functions are patched in place (each patch refuses a definition it does not
-- recognise).

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE FUNCTION pg_temp.issue_4490_o5f5_patch(p_sig regprocedure, p_old text, p_new text, p_count integer DEFAULT 1)
RETURNS void
LANGUAGE plpgsql
AS $patch$
DECLARE
  v_def text := pg_get_functiondef(p_sig);
  v_old_count integer;
BEGIN
  v_old_count := (length(v_def) - length(replace(v_def, p_old, ''))) / length(p_old);
  IF v_old_count <> p_count THEN
    RAISE EXCEPTION 'issue_4490 O5 fix 5 patch precondition failed for %: old % (expected %)',
      p_sig, v_old_count, p_count;
  END IF;
  EXECUTE replace(v_def, p_old, p_new);
END;
$patch$;

-- ===========================================================================
-- 1. The swap entry check: the kitchen, the sellers, or whoever may refund.
-- ===========================================================================
SELECT pg_temp.issue_4490_o5f5_patch(
  'public.issue_4490_order_sold_out_resolve(uuid,uuid[],text,uuid,uuid,uuid,text)'::regprocedure,
  $old$    IF NOT (public.issue_4490_can_kitchen(v_order.venue_id, p_actor)
            OR public.issue_4490_can_sell(v_order.venue_id, p_actor)) THEN$old$,
  $new$    IF NOT (public.issue_4490_can_kitchen(v_order.venue_id, p_actor)
            OR public.issue_4490_can_sell(v_order.venue_id, p_actor)
            OR public.issue_4490_can_manage_money(v_order.venue_id, p_actor)) THEN$new$
);

-- ===========================================================================
-- 2. A swap that gives nothing back keeps the kitchen or seller rule.
-- ===========================================================================
SELECT pg_temp.issue_4490_o5f5_patch(
  'public.issue_4490_order_sold_out_resolve(uuid,uuid[],text,uuid,uuid,uuid,text)'::regprocedure,
  $old$  -- The money back, on the existing rail (its own row; never more than is$old$,
  $new$  -- #4490 08-O5 fix 5: a swap that gives nothing back is not a refund: it
  -- keeps the kitchen or seller rule (money rights alone do not swap).
  IF p_resolution = 'swap' AND v_refund_total = 0
     AND NOT (public.issue_4490_can_kitchen(v_order.venue_id, p_actor)
              OR public.issue_4490_can_sell(v_order.venue_id, p_actor)) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  -- The money back, on the existing rail (its own row; never more than is$new$
);

-- ===========================================================================
-- 3. The staff read: canSwap (any swap Host may offer) and canSwapEven (a
--    same-price swap).
-- ===========================================================================
SELECT pg_temp.issue_4490_o5f5_patch(
  'public.issue_4490_order_sold_out(uuid,uuid)'::regprocedure,
  $old$    'canSwap', public.issue_4490_can_kitchen(v_order.venue_id, p_actor) OR public.issue_4490_can_sell(v_order.venue_id, p_actor),$old$,
  $new$    'canSwap', public.issue_4490_can_kitchen(v_order.venue_id, p_actor) OR public.issue_4490_can_sell(v_order.venue_id, p_actor)
                 OR public.issue_4490_can_manage_money(v_order.venue_id, p_actor),
    'canSwapEven', public.issue_4490_can_kitchen(v_order.venue_id, p_actor) OR public.issue_4490_can_sell(v_order.venue_id, p_actor),$new$
);

COMMIT;

-- Reverse (local use only): re-apply issue_4490_order_sold_out from
-- 20281203734490 followed by its patches in 20281203764490;
-- issue_4490_order_sold_out_resolve from 20281203734490 followed by the
-- section 7 patches of 20281203754490 and section 1 of 20281203764490.
