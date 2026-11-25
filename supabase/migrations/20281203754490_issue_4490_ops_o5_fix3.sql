-- Issue #4490, spec 08 O5 fix round 3 (file number 618490): the defects the
-- independent L3 test of O5 found at c8308ab524. Nothing else changes.
--
-- 1. Step-up approvals are bound in the database (P1, P2, P3, P5). A fresh
--    PIN entry (venue_pin_approvals, made by issue_4490_pin_approve after the
--    PIN check and the approver's money rights) is now tied to ONE purpose
--    (refund, void_sent, reopen, export, swap_refund) and ONE target (the
--    payment or line refunded, the item voided, the venue's day, the order),
--    and it is SINGLE-USE: issue_4490_pin_step_up_take finds it on the live
--    PIN session of the device, locks it and marks it consumed in the same
--    transaction as the write. A write recorded for a Till device
--    (device_user_id <> actor) needs one for:
--      - every Till refund row (the BEFORE INSERT backstop on
--        venue_till_refunds: purpose refund, target the line or the payment),
--        INCLUDING when the actor is the switched-in member (P3);
--      - the void of a sent item (issue_4490_till_void_on_device no longer
--        trusts the caller's p_stepped_up flag);
--      - a day reopen and a day export;
--      - a sold-out refund and a sold-out swap that returns money;
--      - a guest refund approved from a Till device login
--        (biz_venue_order_refund_decision, item 7).
--    One approval moves money once (P2): a second refund needs a second PIN.
--    An approval for one purpose never authorises another (P1).
--    issue_4490_pin_actor_assert accepts an approver who is not the session
--    member only when that approver's approval was consumed IN THIS
--    TRANSACTION (it no longer accepts any approval of the last 2 minutes).
--    Rows of a multi-row refund (a paid offer line refunded across two
--    payments) share one approval through consumed_txid + consumed_ref (the
--    same transaction and the same client request id); every other write
--    takes its approval with a one-off ref, so it never shares one. Nothing changes for an account that is
--    not a Till device: actor = device, no approval is asked or consumed.
-- 2. A sold-out swap that gives money back (old line price > new) needs the
--    refund rights (event_manager+, the same floor as a sold-out refund) and,
--    on a Till device, a fresh step-up (purpose swap_refund, target the
--    order) (P8). A swap that returns nothing keeps the current rules.
-- 3. A close request id used before a reopen is refused after it
--    (day_close_request_stale): the reopen now keeps the close's request id
--    in that close's history entry, and the close refuses any id found there
--    (P6). A retry before the reopen still answers "replayed".
-- 4. A sold-out request key reused for a different set of lines (or the other
--    resolution) is refused (sold_out_key_reused) instead of resolving the
--    new lines and overwriting the stored answer (P7). The same request again
--    still answers what it did.
-- 5. A payment confirmation that arrives after the order was partly or fully
--    refunded (or cancelled after payment) is a replay that changes nothing;
--    it no longer flips the order back to "paid" (P9).
--
-- The day-close PDF consumes its export step-up in the database
-- (issue_4490_day_close_pdf, section 6). The Till-device step-up on the guest refund
-- decision at the edge (7), the fail-closed PIN gate (8) and the CSV formula
-- guard (9) are edge and client changes. The new columns are on
-- venue_pin_approvals (no new venue_id column), so the #2099 pending-venue
-- seal does not move. Static SQL; conflicts raise PT409. Functions are
-- patched in place (each patch refuses a definition it does not recognise).

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE FUNCTION pg_temp.issue_4490_o5f3_patch(p_sig regprocedure, p_old text, p_new text, p_count integer DEFAULT 1)
RETURNS void
LANGUAGE plpgsql
AS $patch$
DECLARE
  v_def text := pg_get_functiondef(p_sig);
  v_old_count integer;
BEGIN
  v_old_count := (length(v_def) - length(replace(v_def, p_old, ''))) / length(p_old);
  IF v_old_count <> p_count THEN
    RAISE EXCEPTION 'issue_4490 O5 fix 3 patch precondition failed for %: old % (expected %)',
      p_sig, v_old_count, p_count;
  END IF;
  EXECUTE replace(v_def, p_old, p_new);
END;
$patch$;

-- ===========================================================================
-- 1. Approvals: one purpose more (swap_refund), and single use.
-- ===========================================================================
ALTER TABLE public.venue_pin_approvals DROP CONSTRAINT venue_pin_approvals_purpose_check;
ALTER TABLE public.venue_pin_approvals ADD CONSTRAINT venue_pin_approvals_purpose_check
  CHECK (purpose IN ('refund', 'void_sent', 'reopen', 'export', 'swap_refund', 'sign_out'));
ALTER TABLE public.venue_pin_attempts DROP CONSTRAINT venue_pin_attempts_purpose_check;
ALTER TABLE public.venue_pin_attempts ADD CONSTRAINT venue_pin_attempts_purpose_check
  CHECK (purpose IN ('unlock', 'refund', 'void_sent', 'reopen', 'export', 'swap_refund', 'sign_out'));
ALTER TABLE public.venue_pin_approvals
  ADD COLUMN consumed_at timestamptz NULL,
  ADD COLUMN consumed_txid bigint NULL,
  ADD COLUMN consumed_ref text NULL CHECK (consumed_ref IS NULL OR char_length(consumed_ref) <= 200);
ALTER TABLE public.venue_pin_approvals ADD CONSTRAINT venue_pin_approvals_consumed_shape
  CHECK ((consumed_at IS NULL) = (consumed_txid IS NULL) AND (consumed_at IS NULL) = (consumed_ref IS NULL));
COMMENT ON COLUMN public.venue_pin_approvals.consumed_at IS
  '#4490 08-O5 fix 3: when the write this approval authorised consumed it (single use). NULL = unused.';
COMMENT ON COLUMN public.venue_pin_approvals.consumed_txid IS
  '#4490 08-O5 fix 3: the transaction that consumed it (rows of one multi-row refund share it).';
COMMENT ON COLUMN public.venue_pin_approvals.consumed_ref IS
  '#4490 08-O5 fix 3: the request that consumed it (e.g. refund:<client request id>).';

SELECT pg_temp.issue_4490_o5f3_patch(
  'public.issue_4490_pin_approve(bytea,uuid,uuid,uuid,uuid,text,text,text)'::regprocedure,
  $old$IF p_purpose NOT IN ('refund', 'void_sent', 'reopen', 'export', 'sign_out')$old$,
  $new$IF p_purpose NOT IN ('refund', 'void_sent', 'reopen', 'export', 'swap_refund', 'sign_out')$new$
);

-- ===========================================================================
-- 2. Take (consume) the step-up approval for a write, in the write's
--    transaction. Returns the approver's user id, or NULL when the write is
--    not recorded for a Till device (actor = device: nothing to take) or when
--    p_required is false and no approval exists.
--    p_actor NULL: any approver (the guest refund decision, where the caller
--    is the device itself and the approver becomes the actor).
--    Raises pin_session_required (a Till device acting as itself),
--    pin_session_invalid (no live session on that device at that venue) or
--    pin_step_up_required (no fresh, unused approval for this purpose,
--    target and approver on that session).
-- ===========================================================================
CREATE FUNCTION public.issue_4490_pin_step_up_take(
  p_venue_id uuid,
  p_actor uuid,
  p_device_user uuid,
  p_purpose text,
  p_target text,
  p_ref text,
  p_required boolean
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_session public.venue_staff_switch_sessions%ROWTYPE;
  v_approval public.venue_pin_approvals%ROWTYPE;
BEGIN
  IF p_purpose IS NULL OR p_purpose NOT IN ('refund', 'void_sent', 'reopen', 'export', 'swap_refund')
     OR p_target IS NULL OR p_ref IS NULL OR char_length(p_ref) > 200 THEN
    RAISE EXCEPTION 'till_invalid_payload' USING ERRCODE = '22023';
  END IF;
  IF p_device_user IS NULL OR p_device_user = p_actor THEN
    -- Acting as itself: never a Till device (it needs someone's PIN).
    IF p_actor IS NOT NULL AND public.issue_4490_is_till_device(p_venue_id, p_actor) THEN
      RAISE EXCEPTION 'pin_session_required' USING ERRCODE = '28000';
    END IF;
    RETURN NULL;
  END IF;
  IF NOT public.issue_4490_is_till_device(p_venue_id, p_device_user) THEN
    RAISE EXCEPTION 'pin_session_invalid' USING ERRCODE = '28000';
  END IF;
  SELECT * INTO v_session FROM public.venue_staff_switch_sessions
  WHERE device_user_id = p_device_user AND venue_id = p_venue_id AND ended_at IS NULL
    AND expires_at > now()
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'pin_session_invalid' USING ERRCODE = '28000';
  END IF;
  -- An approval this very request already consumed (the second row of one
  -- multi-row refund) first, else the newest unused one. Two writes racing
  -- for one approval: the loser re-reads it consumed and is refused.
  SELECT * INTO v_approval FROM public.venue_pin_approvals a
  WHERE a.session_id = v_session.id
    AND a.venue_id = p_venue_id
    AND a.device_user_id = p_device_user
    AND a.purpose = p_purpose
    AND lower(a.target) = lower(p_target)
    AND (p_actor IS NULL OR a.approver_user_id = p_actor)
    AND a.created_at > now() - interval '2 minutes'
    AND (a.consumed_at IS NULL OR (a.consumed_txid = txid_current() AND a.consumed_ref = p_ref))
  ORDER BY (a.consumed_at IS NOT NULL) DESC, a.created_at DESC, a.id
  LIMIT 1
  FOR UPDATE;
  IF NOT FOUND OR NOT public.issue_4490_can_manage_money(p_venue_id, v_approval.approver_user_id) THEN
    IF COALESCE(p_required, true) THEN
      RAISE EXCEPTION 'pin_step_up_required' USING ERRCODE = 'P0001';
    END IF;
    RETURN NULL;
  END IF;
  IF v_approval.consumed_at IS NULL THEN
    UPDATE public.venue_pin_approvals
    SET consumed_at = now(), consumed_txid = txid_current(), consumed_ref = p_ref
    WHERE id = v_approval.id;
  END IF;
  RETURN v_approval.approver_user_id;
END;
$function$;

COMMENT ON FUNCTION public.issue_4490_pin_step_up_take(uuid, uuid, uuid, text, text, text, boolean) IS
  '#4490 08-O5 fix 3: consumes the fresh, unused step-up approval for one purpose and target on the device''s '
  'live PIN session, in the write''s transaction (single use). Internal (service role and definer functions).';

-- ===========================================================================
-- 3. The in-transaction assert: an approver who is not the session member
--    acts only on an approval consumed in THIS transaction.
-- ===========================================================================
SELECT pg_temp.issue_4490_o5f3_patch(
  'public.issue_4490_pin_actor_assert(uuid,uuid,uuid)'::regprocedure,
  $old$  -- A manager approving on the spot (§11.4 item 1): their fresh approval on
  -- this very session.
  IF EXISTS (SELECT 1 FROM public.venue_pin_approvals a
             WHERE a.session_id = v_session.id AND a.approver_user_id = p_actor
               AND a.created_at > now() - interval '2 minutes') THEN$old$,
  $new$  -- A manager approving on the spot (§11.4 item 1): their approval on this
  -- very session, consumed by this transaction's write
  -- (issue_4490_pin_step_up_take, #4490 08-O5 fix 3).
  IF EXISTS (SELECT 1 FROM public.venue_pin_approvals a
             WHERE a.session_id = v_session.id AND a.approver_user_id = p_actor
               AND a.consumed_txid = txid_current()) THEN$new$
);

-- ===========================================================================
-- 4. The money-row backstop: a Till refund row recorded for a Till device
--    consumes a refund approval for its line (or payment) first.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.issue_4490_pin_money_row_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_venue uuid;
BEGIN
  IF TG_TABLE_NAME = 'venue_till_payments' THEN
    SELECT s.venue_id INTO v_venue FROM public.venue_till_sales s WHERE s.id = NEW.sale_id;
    PERFORM public.issue_4490_pin_actor_assert(v_venue, NEW.taken_by_user_id, NEW.device_user_id);
  ELSE
    SELECT s.venue_id INTO v_venue FROM public.venue_till_payments p
    JOIN public.venue_till_sales s ON s.id = p.sale_id WHERE p.id = NEW.payment_id;
    -- #4490 08-O5 fix 3: refunds need a fresh PIN in the database too, even
    -- from the switched-in member; one approval, one refund request.
    PERFORM public.issue_4490_pin_step_up_take(v_venue, NEW.by_user_id, NEW.device_user_id, 'refund',
      COALESCE(NEW.line_id, NEW.payment_id)::text,
      'refund:' || COALESCE(NEW.client_request_id::text, NEW.payment_id::text), true);
    PERFORM public.issue_4490_pin_actor_assert(v_venue, NEW.by_user_id, NEW.device_user_id);
  END IF;
  RETURN NEW;
END;
$function$;

-- ===========================================================================
-- 5. The void on a Till device: a sent item consumes a void_sent approval
--    for that item (or line); the caller's flag no longer authorises it.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.issue_4490_till_void_on_device(
  p_sale_id uuid,
  p_line_id uuid,
  p_order_item_id uuid,
  p_actor uuid,
  p_device_user uuid,
  p_reason text,
  p_restock boolean,
  p_expected_version integer,
  p_stepped_up boolean
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_venue uuid;
  v_sent boolean := false;
  v_target uuid := COALESCE(p_order_item_id, p_line_id);
BEGIN
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT s.venue_id INTO v_venue FROM public.venue_till_sales s WHERE s.id = p_sale_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'till_sale_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF p_order_item_id IS NOT NULL THEN
    SELECT o.fulfillment_status <> 'held' INTO v_sent
    FROM public.venue_order_items i JOIN public.venue_orders o ON o.id = i.venue_order_id
    WHERE i.id = p_order_item_id;
  ELSIF p_line_id IS NOT NULL THEN
    SELECT o.fulfillment_status <> 'held' INTO v_sent
    FROM public.venue_till_lines l JOIN public.venue_orders o ON o.id = l.venue_order_id
    WHERE l.id = p_line_id AND l.kind = 'menu_round';
  END IF;
  -- #4490 08-O5 fix 3: a sent item (or an approver acting on the spot) needs
  -- a void_sent approval for THIS item, consumed here (single use).
  IF COALESCE(v_sent, false) OR COALESCE(p_stepped_up, false) THEN
    IF v_target IS NULL THEN
      RAISE EXCEPTION 'pin_step_up_required' USING ERRCODE = 'P0001';
    END IF;
    PERFORM public.issue_4490_pin_step_up_take(v_venue, p_actor, p_device_user, 'void_sent', v_target::text,
      'void:' || gen_random_uuid()::text, true);
  END IF;
  PERFORM public.issue_4490_pin_actor_assert(v_venue, p_actor, p_device_user);
  PERFORM set_config('mingla.issue_4490_device_user', p_device_user::text, true);
  RETURN public.issue_4490_till_void(p_sale_id, p_line_id, p_order_item_id, p_actor, p_reason,
    p_restock, p_expected_version);
END;
$function$;

-- ===========================================================================
-- 6. Reopen and export: a step-up for that venue's day, consumed first; the
--    reopen keeps the close's request id in history; the close refuses a
--    request id from before a reopen.
-- ===========================================================================
SELECT pg_temp.issue_4490_o5f3_patch(
  'public.issue_4490_day_reopen(uuid,date,text,uuid,uuid)'::regprocedure,
  $old$  v_venue := public.issue_4490_day_gate(p_venue_id, p_actor, p_device_user);$old$,
  $new$  -- #4490 08-O5 fix 3: on a Till device the reopen consumes a reopen
  -- approval for this venue's day (single use), even from the session member.
  PERFORM public.issue_4490_pin_step_up_take(p_venue_id, p_actor, p_device_user, 'reopen',
    p_venue_id::text || ':' || COALESCE(p_date::text, ''),
    'reopen:' || gen_random_uuid()::text, true);
  v_venue := public.issue_4490_day_gate(p_venue_id, p_actor, p_device_user);$new$
);
SELECT pg_temp.issue_4490_o5f3_patch(
  'public.issue_4490_day_reopen(uuid,date,text,uuid,uuid)'::regprocedure,
  $old$      'closedDeviceUserId', v_row.closed_device_user_id,$old$,
  $new$      'closedDeviceUserId', v_row.closed_device_user_id,
      'closeRequestId', v_row.close_request_id,$new$
);
SELECT pg_temp.issue_4490_o5f3_patch(
  'public.issue_4490_day_export(uuid,date,uuid,uuid)'::regprocedure,
  $old$  v_venue := public.issue_4490_day_gate(p_venue_id, p_actor, p_device_user);$old$,
  $new$  -- #4490 08-O5 fix 3: on a Till device the export consumes an export
  -- approval for this venue's day (single use).
  PERFORM public.issue_4490_pin_step_up_take(p_venue_id, p_actor, p_device_user, 'export',
    p_venue_id::text || ':' || COALESCE(p_date::text, ''),
    'export:' || gen_random_uuid()::text, true);
  v_venue := public.issue_4490_day_gate(p_venue_id, p_actor, p_device_user);$new$
);
SELECT pg_temp.issue_4490_o5f3_patch(
  'public.issue_4490_day_close(uuid,date,bigint,uuid,uuid,uuid)'::regprocedure,
  $old$    RAISE EXCEPTION 'day_already_closed' USING ERRCODE = 'PT409';
  END IF;$old$,
  $new$    RAISE EXCEPTION 'day_already_closed' USING ERRCODE = 'PT409';
  END IF;
  -- #4490 08-O5 fix 3 (P6): a close request used before a reopen never closes
  -- the day again (its count is from before the reopen).
  IF v_row.id IS NOT NULL AND EXISTS (
       SELECT 1 FROM jsonb_array_elements(v_row.history) h
       WHERE h->>'closeRequestId' = p_request_id::text) THEN
    RAISE EXCEPTION 'day_close_request_stale' USING ERRCODE = 'PT409';
  END IF;$new$
);

-- The day-close PDF is an export of the day too: on a Till device it consumes
-- the export approval the PDF's PIN made (single use), so that approval can
-- never also authorise a CSV export of the same day. issue_4490_day_summary
-- itself takes nothing (the Till's summary screen and the close and reopen
-- answers read it).
CREATE FUNCTION public.issue_4490_day_close_pdf(p_venue_id uuid, p_date date, p_actor uuid, p_device_user uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  PERFORM public.issue_4490_pin_step_up_take(p_venue_id, p_actor, p_device_user, 'export',
    p_venue_id::text || ':' || COALESCE(p_date::text, ''),
    'export_pdf:' || gen_random_uuid()::text, true);
  RETURN public.issue_4490_day_summary(p_venue_id, p_date, p_actor, p_device_user);
END;
$function$;

COMMENT ON FUNCTION public.issue_4490_day_close_pdf(uuid, date, uuid, uuid) IS
  '#4490 08-O5 fix 3: the day-close PDF source. On a Till device it consumes the export step-up for that '
  'venue''s day (single use), then answers issue_4490_day_summary. Internal (service role).';

-- ===========================================================================
-- 7. Sold out after payment: step-up, money-returning swaps, key reuse.
-- ===========================================================================
SELECT pg_temp.issue_4490_o5f3_patch(
  'public.issue_4490_order_sold_out_resolve(uuid,uuid[],text,uuid,uuid,uuid,text)'::regprocedure,
  $old$  v_payload jsonb;
BEGIN$old$,
  $new$  v_payload jsonb;
  v_step uuid;
BEGIN$new$
);
SELECT pg_temp.issue_4490_o5f3_patch(
  'public.issue_4490_order_sold_out_resolve(uuid,uuid[],text,uuid,uuid,uuid,text)'::regprocedure,
  $old$  PERFORM public.issue_4490_pin_actor_assert(v_order.venue_id, p_actor, p_device_user);

  SELECT array_agg(DISTINCT x ORDER BY x) INTO v_ids FROM unnest(p_item_ids) x;
  -- A replay of the same request answers what it did.
  IF NOT EXISTS (SELECT 1 FROM unnest(v_ids) x
                 WHERE NOT EXISTS (SELECT 1 FROM public.venue_order_items i
                                   WHERE i.id = x AND i.venue_order_id = v_order.id
                                     AND i.sold_out_resolution IS NOT NULL))
     AND v_order.metadata->'sold_out_resolutions' ? v_key THEN
    RETURN (v_order.metadata->'sold_out_resolutions'->v_key) || jsonb_build_object('replayed', true);
  END IF;$old$,
  $new$  SELECT array_agg(DISTINCT x ORDER BY x) INTO v_ids FROM unnest(p_item_ids) x;
  -- A replay of the same request answers what it did; the same key for other
  -- lines (or the other resolution) is refused (#4490 08-O5 fix 3, P7). The
  -- replay is answered before any step-up is taken (like a Till refund), so a
  -- retry needs no fresh PIN and never spends one.
  IF v_order.metadata->'sold_out_resolutions' ? v_key THEN
    IF (v_order.metadata->'sold_out_resolutions'->v_key->'orderItemIds') IS NOT DISTINCT FROM to_jsonb(v_ids)
       AND (v_order.metadata->'sold_out_resolutions'->v_key->>'resolution') IS NOT DISTINCT FROM p_resolution THEN
      RETURN (v_order.metadata->'sold_out_resolutions'->v_key) || jsonb_build_object('replayed', true);
    END IF;
    RAISE EXCEPTION 'sold_out_key_reused' USING ERRCODE = 'PT409';
  END IF;

  -- #4490 08-O5 fix 3: on a Till device a sold-out refund consumes a refund
  -- approval for this order (always); a swap takes a swap_refund approval
  -- when one was given (required below only if the swap returns money).
  v_step := public.issue_4490_pin_step_up_take(v_order.venue_id, p_actor, p_device_user,
    CASE WHEN p_resolution = 'refund' THEN 'refund' ELSE 'swap_refund' END, v_order.id::text,
    'sold_out:' || gen_random_uuid()::text, p_resolution = 'refund');
  PERFORM public.issue_4490_pin_actor_assert(v_order.venue_id, p_actor, p_device_user);$new$
);
SELECT pg_temp.issue_4490_o5f3_patch(
  'public.issue_4490_order_sold_out_resolve(uuid,uuid[],text,uuid,uuid,uuid,text)'::regprocedure,
  $old$  -- The money back, on the existing rail (its own row; never more than is$old$,
  $new$  -- #4490 08-O5 fix 3 (P8): a swap that gives money back is a refund: the
  -- refund rights, and on a Till device a fresh step-up.
  IF p_resolution = 'swap' AND v_refund_total > 0 THEN
    IF public.biz_brand_effective_rank(v_order.brand_id, p_actor) < public.biz_role_rank('event_manager') THEN
      RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
    END IF;
    IF v_step IS NULL AND p_device_user IS NOT NULL AND p_device_user <> p_actor THEN
      RAISE EXCEPTION 'pin_step_up_required' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- The money back, on the existing rail (its own row; never more than is$new$
);

-- ===========================================================================
-- 8. The guest refund decision from a Till device login: a PIN session and a
--    fresh refund step-up for this order; recorded under the approver.
-- ===========================================================================
SELECT pg_temp.issue_4490_o5f3_patch(
  'public.biz_venue_order_refund_decision(uuid,text,text)'::regprocedure,
  $old$  IF p_decision = 'approved' THEN
    v_refund := public.pg_venue_order_mint_refund($old$,
  $new$  -- #4490 08-O5 fix 3: a Till device login approves a guest refund only
  -- with a fresh PIN step-up (refund, this order) on its live PIN session,
  -- consumed here; the refund is then made and recorded as the approver.
  IF p_decision = 'approved' AND public.issue_4490_pin_gate(v_order.venue_id, v_uid) THEN
    v_uid := public.issue_4490_pin_step_up_take(v_order.venue_id, NULL, v_uid, 'refund', p_order_id::text,
      'refund_decision:' || gen_random_uuid()::text, true);
  END IF;

  IF p_decision = 'approved' THEN
    v_refund := public.pg_venue_order_mint_refund($new$
);

-- ===========================================================================
-- 9. A payment confirmation after a refund (or a cancel after payment) is a
--    replay that changes nothing (P9).
-- ===========================================================================
SELECT pg_temp.issue_4490_o5f3_patch(
  'public.pg_venue_order_finalize_payment(uuid,text,integer,text,text,text,integer,text)'::regprocedure,
  $old$  IF v_order.payment_status = 'paid' THEN$old$,
  $new$  -- #4490 08-O5 fix 3 (P9): any state after payment is a replay.
  IF v_order.payment_status IN ('paid', 'partial_refund', 'refunded')
     OR (v_order.payment_status = 'cancelled' AND v_order.confirmed_at IS NOT NULL) THEN$new$
);

-- ===========================================================================
-- Grants: the new function is internal (service role and definer functions).
-- ===========================================================================
REVOKE ALL ON FUNCTION public.issue_4490_pin_step_up_take(uuid, uuid, uuid, text, text, text, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4490_pin_step_up_take(uuid, uuid, uuid, text, text, text, boolean)
  TO service_role;
REVOKE ALL ON FUNCTION public.issue_4490_day_close_pdf(uuid, date, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4490_day_close_pdf(uuid, date, uuid, uuid)
  TO service_role;

COMMIT;

-- Reverse (local use only): re-apply issue_4490_pin_approve,
-- issue_4490_pin_actor_assert, issue_4490_pin_money_row_guard and
-- issue_4490_till_void_on_device from 20281203684490; issue_4490_day_close,
-- issue_4490_day_reopen and issue_4490_day_export from 20281203704490;
-- pg_venue_order_finalize_payment from 20281203724490;
-- issue_4490_order_sold_out_resolve from 20281203734490;
-- biz_venue_order_refund_decision from 20270319001846; then DROP FUNCTION
-- issue_4490_day_close_pdf and issue_4490_pin_step_up_take and the three consumed_* columns, and restore
-- the two purpose checks without swap_refund.
