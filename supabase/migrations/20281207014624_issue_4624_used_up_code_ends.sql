-- Issue #4624 follow-up 2: a ticket-capped (or use-capped) discount reads
-- ACTIVE in the Host list after its last ticket goes, until the next
-- clean-up (issue_3872_discount_maintenance) ends it with ended_reason 'count'
-- or 'uses'. Root cause: only the sweep ever sets status 'ended' for a run-out
-- discount; the consume step (issue_3872_copy_session_totals_to_order) never
-- looks at the limits.
--
-- Fix, one path for both callers:
--   1. issue_4624_settle_discount_limits(ids|NULL, now, skip_locked) holds the
--      sweep's end rule and its D-4c reopen rule, both unchanged from
--      20281206014624 section 7, for the given discounts (NULL = all).
--   2. issue_3872_copy_session_totals_to_order: after a checkout consumes its
--      uses, its capped discounts are settled in the same transaction, so the
--      checkout that takes the last ticket (or use) ends the code with the same
--      ended_reason the sweep uses. The row lock is taken with SKIP LOCKED: two
--      checkouts of one code each hold it FOR KEY SHARE (their
--      order_discount_lines insert), so a blocking FOR UPDATE could deadlock
--      them; a row another transaction holds is left to the next settle (the
--      next consume or the sweep).
--   3. issue_3872_discount_candidates reads a discount ended only because it
--      ran out ('count' / 'uses') as active, so buyers keep the engine's own
--      answer: "has been fully used" (used_up) while nothing is left, and a
--      place a refund frees is usable at once.
--   4. issue_3872_discount_maintenance calls the same function for every
--      discount; its notices (the "ended" message to the host included) are
--      unchanged, so a code ended at consume is still announced by the sweep.
-- Reopening (D-4c) stays in the sweep, which runs every 15 minutes
-- (3,18,33,48 * * * *): a refund, cancel or void never takes a lock on the
-- discount (the #4632 rule its tester proved, A24), because the return trigger
-- would hold that lock in the reverse order to checkout creation (ticket
-- types, then discounts). Buyers can use a freed place at once (item 3); the
-- Host list shows the code Active again after the next sweep.
-- Bodies are copied from 20281206014624 (applied in production) with only the
-- marked blocks added. Owner, SECURITY DEFINER, search_path and grants of every
-- replaced function are unchanged. Functions only: no schema or data change.

BEGIN;
SET LOCAL lock_timeout = '10s';

-- ---------------------------------------------------------------------------
-- 1. One end / reopen rule for the sweep and the consume.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_4624_settle_discount_limits(
  p_discount_ids uuid[],p_now timestamptz DEFAULT now(),p_skip_locked boolean DEFAULT false
) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_ids uuid[]; v_id uuid; v_n integer; v_count integer:=0;
BEGIN
  -- NULL = every discount (the sweep). A list = those discounts only, locked
  -- in id order like issue_3872_lock_limited_discounts; with p_skip_locked a
  -- row another transaction holds is left for the next settle.
  IF p_discount_ids IS NOT NULL THEN
    IF cardinality(p_discount_ids)=0 THEN RETURN 0; END IF;
    IF p_skip_locked THEN
      SELECT COALESCE(array_agg(q.id ORDER BY q.id),'{}'::uuid[]) INTO v_ids FROM (
        SELECT d.id FROM public.brand_discounts d
         WHERE d.id=ANY(p_discount_ids)
         ORDER BY d.id FOR UPDATE SKIP LOCKED
      ) q;
    ELSE
      PERFORM 1 FROM public.brand_discounts d WHERE d.id=ANY(p_discount_ids) ORDER BY d.id FOR UPDATE;
      v_ids:=p_discount_ids;
    END IF;
    IF cardinality(v_ids)=0 THEN RETURN 0; END IF;
  END IF;

  -- End: the sweep's rule and ended_reason (20281206014624 section 7), unchanged.
  UPDATE public.brand_discounts d
     SET status='ended',ended_reason=CASE
       WHEN d.ends_at IS NOT NULL AND d.ends_at<=p_now THEN 'window'
       WHEN d.ends_after_count IS NOT NULL AND COALESCE((
         SELECT sum(u.units-u.returned_units) FROM public.discount_uses u
          WHERE u.discount_id=d.id AND u.status='consumed'
       ),0)>=d.ends_after_count THEN 'count'
       ELSE 'uses' END
   WHERE (v_ids IS NULL OR d.id=ANY(v_ids))
     AND d.deleted_at IS NULL AND d.status='active' AND (
     (d.ends_at IS NOT NULL AND d.ends_at<=p_now)
     OR (d.ends_after_count IS NOT NULL AND COALESCE((
       SELECT sum(u.units-u.returned_units) FROM public.discount_uses u WHERE u.discount_id=d.id AND u.status='consumed'
     ),0)>=d.ends_after_count)
     OR (d.max_total_uses IS NOT NULL AND COALESCE((
       SELECT count(*) FROM public.discount_uses u WHERE u.discount_id=d.id AND u.status='consumed' AND u.returned_at IS NULL
     ),0)>=d.max_total_uses)
   );
  GET DIAGNOSTICS v_n=ROW_COUNT;
  v_count:=v_count+v_n;

  -- Reopen (D-4c), the sweep's rule unchanged: a discount ended because it ran
  -- out reopens when returns bring it back under every limit, while it is still
  -- inside its dates, not deleted, and no other live discount (nor a newer
  -- ended one) in the brand has the same code. A host-ended or window-ended
  -- discount never reopens. One row at a time: a code text taken in the
  -- meantime (a unique or namespace refusal) keeps that one ended and never
  -- fails the sweep (the single UPDATE it replaces aborted the whole sweep).
  FOR v_id IN
    SELECT d.id FROM public.brand_discounts d
     WHERE (v_ids IS NULL OR d.id=ANY(v_ids))
       AND d.status='ended' AND d.ended_reason IN ('count','uses') AND d.deleted_at IS NULL
       AND (d.ends_at IS NULL OR d.ends_at>p_now)
       AND (d.ends_after_count IS NULL OR COALESCE((
         SELECT sum(u.units-u.returned_units) FROM public.discount_uses u WHERE u.discount_id=d.id AND u.status='consumed'
       ),0)<d.ends_after_count)
       AND (d.max_total_uses IS NULL OR COALESCE((
         SELECT count(*) FROM public.discount_uses u WHERE u.discount_id=d.id AND u.status='consumed' AND u.returned_at IS NULL
       ),0)<d.max_total_uses)
       AND (d.code IS NULL OR NOT EXISTS (
         SELECT 1 FROM public.brand_discounts o
          WHERE o.brand_id=d.brand_id AND o.code=d.code AND o.id<>d.id AND o.deleted_at IS NULL
            AND (o.status<>'ended' OR o.created_at>d.created_at OR (o.created_at=d.created_at AND o.id>d.id))
       ))
     ORDER BY d.id
  LOOP
    BEGIN
      UPDATE public.brand_discounts
         SET status='active',ended_reason=NULL,notified_ended_at=NULL,notified_limit80_at=NULL
       WHERE id=v_id AND status='ended';
      GET DIAGNOSTICS v_n=ROW_COUNT;
      v_count:=v_count+v_n;
    EXCEPTION WHEN unique_violation OR raise_exception THEN
      RAISE WARNING 'issue #4624: discount % stays ended (%)',v_id,SQLERRM;
    END;
  END LOOP;
  RETURN v_count;
END;
$fn$;
REVOKE ALL ON FUNCTION public.issue_4624_settle_discount_limits(uuid[],timestamptz,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4624_settle_discount_limits(uuid[],timestamptz,boolean) TO service_role;

-- ---------------------------------------------------------------------------
-- 2. Consume (body of 20281206014624 section 5b): settle the checkout's capped
--    discounts once its uses are consumed.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_3872_copy_session_totals_to_order(
  p_checkout_session_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $finalize$
DECLARE
  v_late_ids uuid[];
  v_late record;
  v_used_units bigint; v_used_uses bigint; v_buyer_uses bigint;
  v_settle_ids uuid[];
BEGIN
  UPDATE public.orders o
  SET list_subtotal_cents=s.list_subtotal_cents,
      discount_cents=s.discount_cents,
      net_subtotal_cents=s.net_subtotal_cents,
      buyer_fees_cents=s.buyer_fees_cents,
      tax_cents=s.tax_cents,
      buyer_total_cents=s.buyer_total_cents,
      pricing_source=s.pricing_source,
      pricing_breakdown=COALESCE(o.pricing_breakdown,s.pricing_breakdown),
      updated_at=now()
  FROM public.ticket_checkout_sessions s
  WHERE s.id=p_checkout_session_id AND o.id=s.order_id
    AND s.buyer_total_cents IS NOT NULL AND o.buyer_total_cents IS NULL;

  WITH session_lines AS (
    SELECT i.id,i.ticket_type_id,i.quantity,i.unit_price_cents,i.total_cents,
      i.list_unit_price_cents,i.discount_cents,
      row_number() OVER(PARTITION BY i.ticket_type_id,i.quantity,i.unit_price_cents,i.total_cents ORDER BY i.id) rn
    FROM public.ticket_checkout_session_items i
    WHERE i.checkout_session_id=p_checkout_session_id
  ), order_lines AS (
    SELECT li.id,li.ticket_type_id,li.quantity,li.unit_price_cents,li.total_cents,
      row_number() OVER(PARTITION BY li.ticket_type_id,li.quantity,li.unit_price_cents,li.total_cents ORDER BY li.id) rn
    FROM public.order_line_items li
    JOIN public.ticket_checkout_sessions s ON s.order_id=li.order_id
    WHERE s.id=p_checkout_session_id
  ), pairs AS (
    SELECT o.id order_line_id,s.id session_item_id,s.list_unit_price_cents,s.discount_cents
    FROM session_lines s JOIN order_lines o USING(ticket_type_id,quantity,unit_price_cents,total_cents,rn)
  )
  UPDATE public.order_line_items li
     SET checkout_session_item_id=p.session_item_id,
         list_unit_price_cents=COALESCE(p.list_unit_price_cents,li.unit_price_cents),
         discount_cents=p.discount_cents
    FROM pairs p
   WHERE li.id=p.order_line_id AND li.checkout_session_item_id IS NULL;

  INSERT INTO public.order_discount_lines(
    order_kind,order_id,line_ref,discount_id,brand_id,kind,code_snapshot,
    name_snapshot,value_type,value_bps,value_minor,units,amount_minor,
    applied_seq,currency)
  SELECT 'ticket',s.order_id,li.id::text,(a->>'discountId')::uuid,s.brand_id,
    a->>'kind',NULLIF(a->>'code',''),a->>'name',a->>'valueType',
    NULLIF(a->>'valueBps','')::integer,NULLIF(a->>'valueMinor','')::integer,
    (a->>'units')::integer,(a->>'lineMinor')::integer,(a->>'seq')::smallint,
    trim(s.currency)
  FROM public.ticket_checkout_sessions s
  JOIN public.ticket_checkout_session_items i ON i.checkout_session_id=s.id
  JOIN public.order_line_items li ON li.checkout_session_item_id=i.id
  CROSS JOIN LATERAL jsonb_array_elements(i.applied_discounts) a
  WHERE s.id=p_checkout_session_id AND s.order_id IS NOT NULL
  ON CONFLICT DO NOTHING;

  -- #4624 item 5b: a hold that lapsed before the payment finished (released, or
  -- reserved past its expires_at) is a late row. Take the same discount lock the
  -- reserve path takes, count usage without this row, and stamp any overrun.
  -- The buyer keeps what they paid for (D-5b honour); rows still live consume
  -- exactly as before.
  SELECT array_agg(DISTINCT u.discount_id ORDER BY u.discount_id) INTO v_late_ids
  FROM public.discount_uses u
  JOIN public.ticket_checkout_sessions s ON s.id=u.checkout_ref_id
  WHERE s.id=p_checkout_session_id AND s.order_id IS NOT NULL
    AND u.checkout_kind='ticket'
    AND (u.status='released' OR (u.status='reserved' AND u.expires_at<=now()));
  IF v_late_ids IS NOT NULL THEN
    PERFORM public.issue_3872_lock_limited_discounts(v_late_ids);
    FOR v_late IN
      SELECT u.id,u.units,u.buyer_email_norm,u.buyer_phone_e164,u.buyer_user_id,
        d.id discount_id,d.ends_after_count,d.max_total_uses,d.max_uses_per_buyer
      FROM public.discount_uses u
      JOIN public.brand_discounts d ON d.id=u.discount_id
      WHERE u.checkout_kind='ticket' AND u.checkout_ref_id=p_checkout_session_id
        AND (u.status='released' OR (u.status='reserved' AND u.expires_at<=now()))
      ORDER BY u.discount_id
    LOOP
      SELECT
        COALESCE(sum(CASE WHEN o.status='consumed' THEN o.units-o.returned_units ELSE o.units END),0),
        count(*) FILTER (WHERE o.status='reserved' OR o.returned_at IS NULL),
        count(*) FILTER (WHERE (o.status='reserved' OR o.returned_at IS NULL)
          AND ((v_late.buyer_email_norm IS NOT NULL AND o.buyer_email_norm=v_late.buyer_email_norm)
            OR (v_late.buyer_phone_e164 IS NOT NULL AND o.buyer_phone_e164=v_late.buyer_phone_e164)
            OR (v_late.buyer_user_id IS NOT NULL AND o.buyer_user_id=v_late.buyer_user_id)))
        INTO v_used_units,v_used_uses,v_buyer_uses
      FROM public.discount_uses o
      WHERE o.discount_id=v_late.discount_id AND o.id<>v_late.id
        AND (o.status='consumed' OR (o.status='reserved' AND o.expires_at>now()));
      UPDATE public.discount_uses
         SET over_limit_units=CASE WHEN v_late.ends_after_count IS NULL THEN 0
               ELSE GREATEST(0,LEAST(v_late.units,v_used_units+v_late.units-v_late.ends_after_count))::integer END,
             over_limit_uses=(v_late.max_total_uses IS NOT NULL AND v_used_uses+1>v_late.max_total_uses)
               OR (v_late.max_uses_per_buyer IS NOT NULL AND v_buyer_uses+1>v_late.max_uses_per_buyer)
       WHERE id=v_late.id;
    END LOOP;
  END IF;

  UPDATE public.discount_uses u
     SET status='consumed',order_id=s.order_id,consumed_at=now(),released_at=NULL
    FROM public.ticket_checkout_sessions s
   WHERE s.id=p_checkout_session_id AND s.order_id IS NOT NULL
     AND u.checkout_kind='ticket' AND u.checkout_ref_id=s.id
     AND u.status IN ('reserved','released');

  -- #4624 follow-up 2: the checkout that uses up a code's last ticket (or its
  -- last use) ends the code in the same transaction, with the sweep's own rule
  -- and ended_reason, so the Host list is right straight away. A discount row
  -- another checkout holds at this instant (even FOR KEY SHARE, from its own
  -- order_discount_lines insert) is skipped, never waited on: upgrading two
  -- key-share locks would deadlock. The next consume or the sweep ends it.
  SELECT array_agg(DISTINCT u.discount_id ORDER BY u.discount_id) INTO v_settle_ids
  FROM public.discount_uses u
  JOIN public.brand_discounts d ON d.id=u.discount_id
  WHERE u.checkout_kind='ticket' AND u.checkout_ref_id=p_checkout_session_id
    AND u.status='consumed'
    AND (d.ends_after_count IS NOT NULL OR d.max_total_uses IS NOT NULL);
  IF v_settle_ids IS NOT NULL THEN
    PERFORM public.issue_4624_settle_discount_limits(v_settle_ids,now(),true);
  END IF;

  UPDATE public.orders o
     SET metadata=jsonb_set(COALESCE(o.metadata,'{}'::jsonb),'{discount_ids}',
       (SELECT jsonb_agg(x.discount_id ORDER BY x.discount_id)
          FROM (SELECT DISTINCT d.discount_id FROM public.order_discount_lines d
                WHERE d.order_kind='ticket' AND d.order_id=o.id) x),true),
         updated_at=now()
   WHERE o.id=(SELECT s.order_id FROM public.ticket_checkout_sessions s
               WHERE s.id=p_checkout_session_id)
     AND EXISTS(SELECT 1 FROM public.order_discount_lines d
                WHERE d.order_kind='ticket' AND d.order_id=o.id);
END;
$finalize$;
REVOKE ALL ON FUNCTION public.issue_3872_copy_session_totals_to_order(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3872_copy_session_totals_to_order(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Candidates (body of 20281206014624 section 3): a discount ended only
--    because it ran out ('count' / 'uses') is read as active, so the engine
--    keeps its own answer for it: no places left is used_up ("has been fully
--    used", as before the code was ended at consume, never "has ended"), and a
--    place a refund freed is usable at once, before the sweep reopens the row.
--    The engine still refuses it past its end date, and the newest code with
--    that text is the one looked up, so this is exactly the D-4c reopen rule.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_3872_discount_candidates(
  p_brand_id uuid,p_lines jsonb,p_code text,p_buyer jsonb,p_at timestamptz
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_automatics jsonb; v_code jsonb; v_lookup text:='none'; v_email text; v_phone text; v_user uuid;
BEGIN
  v_email:=NULLIF(lower(btrim(COALESCE(p_buyer->>'email',''))),'');
  v_phone:=NULLIF(btrim(COALESCE(p_buyer->>'phone','')),'');
  v_user:=NULLIF(p_buyer->>'userId','')::uuid;
  IF p_code IS NOT NULL AND v_email IS NULL AND v_phone IS NULL AND v_user IS NULL THEN
    RAISE EXCEPTION 'discount_code_not_accepted';
  END IF;
  IF NOT public.issue_3872_discounts_on(p_brand_id) THEN
    RETURN jsonb_build_object('automatics','[]'::jsonb,'code',NULL,'codeLookup',CASE WHEN p_code IS NULL THEN 'none' ELSE 'not_found' END);
  END IF;

  SELECT COALESCE(jsonb_agg(def ORDER BY def->>'createdAt',def->>'id'),'[]'::jsonb) INTO v_automatics
  FROM (
    SELECT jsonb_build_object(
      'id',d.id,'kind',d.kind,'code',d.code,'name',d.name,'valueType',d.value_type,
      'valueBps',d.value_bps,'valueMinor',d.value_minor,'currency',d.currency,'scopeKind',d.scope_kind,
      'combinesWith',d.combines_with,'startsAt',d.starts_at,'endsAt',d.ends_at,'schedule',d.schedule,
      'minSubtotalMinor',d.min_subtotal_minor,'status',CASE WHEN d.status='ended' AND d.ended_reason IN ('count','uses') THEN 'active' ELSE d.status END,'needsAttention',d.needs_attention,
      'deletedAt',d.deleted_at,'createdAt',d.created_at,
      'targets',COALESCE((SELECT jsonb_agg(jsonb_build_object('targetKind',t.target_kind,'listingKind',t.listing_kind,'targetId',t.target_id))
                          FROM public.brand_discount_targets t WHERE t.discount_id=d.id AND t.orphaned_at IS NULL),'[]'::jsonb),
      'remainingTotalUses',CASE WHEN d.max_total_uses IS NULL THEN NULL ELSE GREATEST(0,d.max_total_uses-(SELECT count(*) FROM public.discount_uses u WHERE u.discount_id=d.id AND ((u.status='consumed' AND u.returned_at IS NULL) OR (u.status='reserved' AND u.expires_at>p_at)))) END,
      'remainingBuyerUses',CASE WHEN d.max_uses_per_buyer IS NULL THEN NULL ELSE GREATEST(0,d.max_uses_per_buyer-(SELECT count(*) FROM public.discount_uses u WHERE u.discount_id=d.id AND ((u.status='consumed' AND u.returned_at IS NULL) OR (u.status='reserved' AND u.expires_at>p_at)) AND ((v_email IS NOT NULL AND u.buyer_email_norm=v_email) OR (v_phone IS NOT NULL AND u.buyer_phone_e164=v_phone) OR (v_user IS NOT NULL AND u.buyer_user_id=v_user)))) END,
      'remainingUnits',CASE WHEN d.ends_after_count IS NULL THEN NULL ELSE GREATEST(0,d.ends_after_count-COALESCE((SELECT sum(CASE WHEN u.status='consumed' THEN u.units-u.returned_units ELSE u.units END) FROM public.discount_uses u WHERE u.discount_id=d.id AND (u.status='consumed' OR (u.status='reserved' AND u.expires_at>p_at))),0)) END,
      'limited',(d.ends_after_count IS NOT NULL OR d.max_total_uses IS NOT NULL OR d.max_uses_per_buyer IS NOT NULL)
    ) def
    FROM public.brand_discounts d
    WHERE d.brand_id=p_brand_id AND d.kind IN ('automatic','sale_price') AND d.deleted_at IS NULL
      AND (d.max_uses_per_buyer IS NULL OR v_email IS NOT NULL OR v_phone IS NOT NULL OR v_user IS NOT NULL)
  ) q;

  IF p_code IS NOT NULL THEN
    SELECT jsonb_build_object(
      'id',d.id,'kind',d.kind,'code',d.code,'name',d.name,'valueType',d.value_type,
      'valueBps',d.value_bps,'valueMinor',d.value_minor,'currency',d.currency,'scopeKind',d.scope_kind,
      'combinesWith',d.combines_with,'startsAt',d.starts_at,'endsAt',d.ends_at,'schedule',d.schedule,
      'minSubtotalMinor',d.min_subtotal_minor,'status',CASE WHEN d.status='ended' AND d.ended_reason IN ('count','uses') THEN 'active' ELSE d.status END,'needsAttention',d.needs_attention,
      'deletedAt',d.deleted_at,'createdAt',d.created_at,
      'targets',COALESCE((SELECT jsonb_agg(jsonb_build_object('targetKind',t.target_kind,'listingKind',t.listing_kind,'targetId',t.target_id)) FROM public.brand_discount_targets t WHERE t.discount_id=d.id AND t.orphaned_at IS NULL),'[]'::jsonb),
      'remainingTotalUses',CASE WHEN d.max_total_uses IS NULL THEN NULL ELSE GREATEST(0,d.max_total_uses-(SELECT count(*) FROM public.discount_uses u WHERE u.discount_id=d.id AND ((u.status='consumed' AND u.returned_at IS NULL) OR (u.status='reserved' AND u.expires_at>p_at)))) END,
      'remainingBuyerUses',CASE WHEN d.max_uses_per_buyer IS NULL THEN NULL ELSE GREATEST(0,d.max_uses_per_buyer-(SELECT count(*) FROM public.discount_uses u WHERE u.discount_id=d.id AND ((u.status='consumed' AND u.returned_at IS NULL) OR (u.status='reserved' AND u.expires_at>p_at)) AND ((v_email IS NOT NULL AND u.buyer_email_norm=v_email) OR (v_phone IS NOT NULL AND u.buyer_phone_e164=v_phone) OR (v_user IS NOT NULL AND u.buyer_user_id=v_user)))) END,
      'remainingUnits',CASE WHEN d.ends_after_count IS NULL THEN NULL ELSE GREATEST(0,d.ends_after_count-COALESCE((SELECT sum(CASE WHEN u.status='consumed' THEN u.units-u.returned_units ELSE u.units END) FROM public.discount_uses u WHERE u.discount_id=d.id AND (u.status='consumed' OR (u.status='reserved' AND u.expires_at>p_at))),0)) END,
      'limited',(d.ends_after_count IS NOT NULL OR d.max_total_uses IS NOT NULL OR d.max_uses_per_buyer IS NOT NULL)
    ),'found' INTO v_code,v_lookup
    FROM public.brand_discounts d
    WHERE d.brand_id=p_brand_id AND d.kind='code' AND d.code=p_code AND d.deleted_at IS NULL
    ORDER BY d.created_at DESC LIMIT 1;
    IF NOT FOUND THEN v_lookup:='not_found'; END IF;
  END IF;
  RETURN jsonb_build_object('automatics',v_automatics,'code',v_code,'codeLookup',v_lookup);
END;
$fn$;
REVOKE ALL ON FUNCTION public.issue_3872_discount_candidates(uuid,jsonb,text,jsonb,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3872_discount_candidates(uuid,jsonb,text,jsonb,timestamptz) TO service_role;

-- ---------------------------------------------------------------------------
-- 4. Sweep (body of 20281206014624 section 7): end and reopen through the
--    shared function; everything else unchanged.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_3872_discount_maintenance(p_now timestamptz DEFAULT now())
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp
AS $fn$
DECLARE v_notify jsonb;
BEGIN
  UPDATE public.brand_discounts d
     SET needs_attention='currency_mismatch'
   WHERE d.deleted_at IS NULL AND d.status IN ('active','paused')
     AND d.currency IS NOT NULL
     AND d.currency IS DISTINCT FROM (
       SELECT upper(COALESCE(b.pricing_currency,b.default_currency)) FROM public.brands b WHERE b.id=d.brand_id
     );

  -- #4624 D-5a: a hold whose session already expired or failed stops counting
  -- at its own expires_at; mark it released once that has passed.
  UPDATE public.discount_uses u
     SET status='released',released_at=p_now
    FROM public.ticket_checkout_sessions s
   WHERE u.checkout_kind='ticket' AND u.checkout_ref_id=s.id
     AND u.status='reserved' AND u.expires_at<p_now
     AND s.status IN ('expired','failed');

  -- #4624 follow-up 2: ending a run-out discount and reopening one a return
  -- freed (D-4c) live in one function, shared with the consume path.
  PERFORM public.issue_4624_settle_discount_limits(NULL,p_now,false);

  WITH usage AS (
    SELECT d.*,
      COALESCE((SELECT sum(u.units-u.returned_units) FROM public.discount_uses u WHERE u.discount_id=d.id AND u.status='consumed'),0)::integer consumed_units,
      COALESCE((SELECT count(*) FROM public.discount_uses u WHERE u.discount_id=d.id AND u.status='consumed' AND u.returned_at IS NULL),0)::integer consumed_uses
    FROM public.brand_discounts d WHERE d.deleted_at IS NULL
  ), notices AS (
    SELECT id,brand_id,name,'business.discount_limit_80'::text type,
      GREATEST(0,LEAST(
        CASE WHEN ends_after_count IS NOT NULL THEN ends_after_count-consumed_units END,
        CASE WHEN max_total_uses IS NOT NULL THEN max_total_uses-consumed_uses END
      ))::integer left_count,
      NULL::text reason
    FROM usage WHERE status='active' AND notified_limit80_at IS NULL
      AND (
        (ends_after_count IS NOT NULL AND consumed_units*5>=ends_after_count*4)
        OR (max_total_uses IS NOT NULL AND consumed_uses*5>=max_total_uses*4)
      )
    UNION ALL
    SELECT id,brand_id,name,'business.discount_ended',NULL::integer,ended_reason
    FROM usage WHERE status='ended' AND notified_ended_at IS NULL
    UNION ALL
    SELECT id,brand_id,name,'business.discount_needs_attention',NULL::integer,needs_attention
    FROM usage WHERE needs_attention IS NOT NULL AND notified_attention_at IS NULL
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'discountId',id,'brandId',brand_id,'type',type,'name',name,'left',left_count,'reason',reason
  ) ORDER BY id,type),'[]'::jsonb) INTO v_notify FROM notices;

  DELETE FROM public.discount_code_attempts WHERE failed_at<p_now-interval '1 day';
  RETURN jsonb_build_object('notify',v_notify);
END;
$fn$;
REVOKE ALL ON FUNCTION public.issue_3872_discount_maintenance(timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3872_discount_maintenance(timestamptz) TO service_role;

COMMIT;
