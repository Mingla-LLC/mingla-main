-- issue #3281 S5 — add-ons on every offering: the add-on payment choice on a
-- trip plan (today joins the deposit; spread joins its package's rows through
-- order_installments.addon_portion_minor), refunds per choice, and the S1
-- deferrals that must land before multi_link_enabled can be switched on.
--
-- Behind add_on_rollout.plan_enabled (false). The quote, create-session and
-- finalize halves of the choice shipped with #4522 M2 (20281125034522): the
-- choice rides cart lines as addonPaymentMode (review decision 1). This file
-- adds what was still missing:
--   * the #3859 contract path (buyer web checkout v2): issue_4522_checkout_v2_plan
--     plans the session's add-ons with the cart choice when plan_enabled is on,
--     and issue_3859_bind_checkout_contract accepts add-ons on a v2 schedule
--     only when the database's own plan for the session matches it row for row,
--     then freezes the terms, the order's add-on choice and each add-on line's
--     plan_choice. Off (or no add-ons): both bodies behave exactly as before.
--   * refunds per choice: a host (biz_refund_order / refund_preview) or admin
--     (admin_refund_order) refunding a spread add-on first takes it off the open
--     plan rows of its package (#4522's seam issue_4522_remove_spread_addon,
--     rebalance reason addon_removed) and refunds in money only what was
--     collected. Nothing collected: no money moves; the removal is recorded in
--     order_add_on_plan_removals under the request's idempotency key and
--     replays from there. A today add-on is refunded from the deposit charge
--     as any add-on is. Returning every ticket of an order whose spread add-ons
--     are still on open rows is refused (add_on_plan_open_use_cancel): the
--     booking is cancelled instead (cancel flows refund collected rows).
--     Plan removals count as returned wherever add-on refunds are counted
--     (bounds, all-returned, door, admin view). These paths run only for add-on
--     lines bought with plan_choice 'spread', which exist only once
--     plan_enabled is on, so with the switch off every result is unchanged.
--   * S1 deferrals: issue_1930_ticket_checkout_finalize_base copies parent_kind;
--     issue_1930_ticket_session_authorized sums one add-on's holds across its
--     tickets (and per date); issue_3281_strip_removed_days and
--     business_update_live_event_atomic find add-ons by their offering, not by
--     ticket_add_ons.ticket_type_id; issue_3281_publish_tier_extras writes the
--     owner and its link itself (ticket_type_id stays [TRANSITIONAL] until S8).
--     With one link per add-on (every add-on today), each result is unchanged.
--
-- Re-emitted from the replayed database's current bodies (md5 drift-guarded):
--   issue_4522_checkout_v2_plan (20281125034522), issue_3859_bind_checkout_contract
--   (20280313003281), issue_1930_ticket_checkout_finalize_base (20281125034522),
--   issue_1930_ticket_session_authorized, issue_3281_strip_removed_days,
--   issue_3281_publish_tier_extras, business_update_live_event_atomic (their
--   latest #3281 bodies), issue_3281_extras_refund_cents,
--   issue_3281_extras_refund_cents_settled, issue_3281_record_extras_refund,
--   issue_3281_add_ons_all_returned, issue_3281_add_on_refund_lines,
--   issue_3281_add_on_refund_cents, issue_3281_record_add_on_refund,
--   refund_preview, biz_refund_order, admin_refund_order,
--   admin_order_add_on_lines (20281125093281), issue_3281_door_order_extras
--   (20280404003281). Signatures, grants and comments are unchanged.
-- New: order_add_on_plan_removals (service_role only), issue_3281_add_on_removed_qty,
--   issue_3281_add_on_removed_cents, issue_3281_order_has_open_spread,
--   issue_3281_add_on_plan_split, issue_3281_apply_plan_removals.
-- Static SQL only. A plan that changed under a removal raises PT409
-- (add_on_plan_changed / #4522's balance_payment_in_flight), never 40001.

BEGIN;
SET LOCAL lock_timeout = '10s';

DO $drift$
DECLARE r record; v_actual text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('public.issue_4522_checkout_v2_plan(uuid,jsonb)','30f383b315b5592f60a075c7117e0559'),
    ('public.issue_3859_bind_checkout_contract(uuid,uuid,text,uuid,text,jsonb,integer,integer,jsonb)','e0b490598c761dd2b7af90b6305036a6'),
    ('public.issue_1930_ticket_checkout_finalize_base(uuid,text,text,text,text,text,text,boolean)','201be713666fd183d83040b80db16f1e'),
    ('public.issue_1930_ticket_session_authorized(uuid,uuid)','3a18519432e655ec16e2a483abffdfbb'),
    ('public.issue_3281_strip_removed_days(uuid)','6fbd4b8871bcca70a45d4a934b716985'),
    ('public.issue_3281_publish_tier_extras(uuid,jsonb,text,jsonb,text[])','3e787b9275e2469894231e1fa2866229'),
    ('public.business_update_live_event_atomic(uuid,jsonb,text,integer)','bf3357a0653055d818837712a58f6fe0'),
    ('public.issue_3281_extras_refund_cents(uuid,jsonb,uuid)','6316cdbeaf1107ba2a615beecc2dc4e8'),
    ('public.issue_3281_extras_refund_cents_settled(uuid,jsonb)','94b0272d6eccff95d609d7189287674c'),
    ('public.issue_3281_record_extras_refund(uuid,uuid,jsonb,integer)','9a3e96ee96282e0ba1ff1521f9e00523'),
    ('public.issue_3281_add_ons_all_returned(uuid,boolean)','ebe50d881954950a5e5e907eb35e7bc4'),
    ('public.issue_3281_add_on_refund_lines(uuid,jsonb)','8dd35119a55d97ec1382d5541c65aaa8'),
    ('public.issue_3281_add_on_refund_cents(uuid,jsonb,jsonb,boolean)','a24c3cdc534cd6f194c54c40c9b69561'),
    ('public.issue_3281_record_add_on_refund(uuid,uuid,jsonb,jsonb)','b1877a5d86e53b898b41224d02f51b7f'),
    ('public.refund_preview(uuid,jsonb)','10fbcffc868e1cc5e1337d73dfcb91f2'),
    ('public.biz_refund_order(uuid,jsonb,text,text)','1733c44890c5663270f019e71881fa7c'),
    ('public.admin_refund_order(uuid,jsonb,text,text)','c2505f7ca2d3988a9128b6fe81fb5132'),
    ('public.admin_order_add_on_lines(uuid)','15cb223d9fb2ca797ce802a37917d39b'),
    ('public.issue_3281_door_order_extras(uuid,uuid,uuid[])','44cdb893a4a64ab00a97d982a2ce04d7')
  ) v(sig,expected_md5) LOOP
    SELECT md5(pg_get_functiondef(r.sig::regprocedure)) INTO v_actual;
    IF v_actual IS DISTINCT FROM r.expected_md5 THEN
      RAISE EXCEPTION 'issue #3281 S5 drift: % expected %, got %',r.sig,r.expected_md5,v_actual;
    END IF;
  END LOOP;
END;
$drift$;

-- ---------------------------------------------------------------------------
-- 1. The contract path (#3859 checkout v2): add-ons on a v2 plan.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_4522_checkout_v2_plan(p_checkout_session_id uuid, p_lines jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_session public.ticket_checkout_sessions%ROWTYPE;
  v_items jsonb;
  v_extras jsonb;
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
  -- issue #3281 S5 — with plan_enabled on, the add-ons this session holds
  -- ride the plan: `today` joins the deposit, `spread` joins its package's
  -- rows (addon_portion_minor). The choice rides the lines (addonPaymentMode,
  -- default today). Off, or no add-ons: the call below is unchanged.
  IF public.issue_3281_add_on_switch('plan_enabled') AND EXISTS (
       SELECT 1 FROM public.ticket_checkout_session_add_on_items x
        WHERE x.checkout_session_id = p_checkout_session_id) THEN
    SELECT jsonb_build_object(
             'items', COALESCE(jsonb_agg(jsonb_build_object(
               'ticketTypeId', x.ticket_type_id, 'totalCents', x.total_cents)
               ORDER BY x.created_at, x.id), '[]'::jsonb),
             'totalCents', COALESCE(sum(x.total_cents), 0))
      INTO v_extras
      FROM public.ticket_checkout_session_add_on_items x
     WHERE x.checkout_session_id = p_checkout_session_id;
    RETURN public.issue_4522_plan_cart_v2(v_session.event_id, v_items, 'full',
      v_session.created_at, v_extras,
      COALESCE(public.issue_4522_lines_addon_payment_mode(p_lines), 'today'))
      || jsonb_build_object('addOnsOnPlan', true,
           'extrasTotalCents', (v_extras->>'totalCents')::bigint);
  END IF;
  RETURN public.issue_4522_plan_cart_v2(v_session.event_id, v_items, 'full',
    v_session.created_at, NULL, NULL);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.issue_3859_bind_checkout_contract(p_checkout_session_id uuid, p_event_id uuid, p_idempotency_key text, p_checkout_attempt_id uuid, p_checkout_fingerprint text, p_lines jsonb, p_due_today_cents integer, p_full_price_cents integer, p_installment_schedule jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
DECLARE
  v_session public.ticket_checkout_sessions%ROWTYPE;
  v_line jsonb;
  v_item public.ticket_checkout_session_items%ROWTYPE;
  v_choice text;
  v_ticket_type_id uuid;
  v_quantity integer;
  v_seen integer := 0;
  v_item_count integer;
  v_full_price bigint;
  v_scheduled_total bigint := 0;
  v_installment jsonb;
  v_expected_ordinal integer := 1;
  v_seen_ticket_ids uuid[] := ARRAY[]::uuid[];
  -- issue #3281 S5 — the database's own plan when add-ons ride it.
  v_addon_plan jsonb;
BEGIN
  IF p_checkout_attempt_id IS NULL
     OR p_checkout_fingerprint IS NULL
     OR p_due_today_cents IS NULL
     OR p_full_price_cents IS NULL
     OR p_checkout_fingerprint !~ '^[0-9a-f]{64}$'
     OR p_idempotency_key IS DISTINCT FROM
       ('ticket_checkout:v2:' || p_event_id::text || ':' || p_checkout_attempt_id::text) THEN
    RAISE EXCEPTION 'checkout_contract_invalid';
  END IF;

  SELECT * INTO v_session
    FROM public.ticket_checkout_sessions
   WHERE id = p_checkout_session_id
     AND event_id = p_event_id
     AND idempotency_key = p_idempotency_key
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'checkout_session_not_found';
  END IF;

  -- Same attempt + same canonical fingerprint is reconciliation. Same attempt
  -- + changed cart/contact/consent/intake/quote is a review conflict.
  IF v_session.checkout_contract_version IS NOT NULL THEN
    IF v_session.checkout_contract_version = 2
       AND v_session.checkout_attempt_id = p_checkout_attempt_id
       AND v_session.checkout_fingerprint = p_checkout_fingerprint THEN
      RETURN jsonb_build_object(
        'outcome', 'reconciled',
        'totalCents', v_session.total_cents,
        'installmentSchedule', v_session.installment_schedule
      );
    END IF;
    RAISE EXCEPTION 'checkout_fingerprint_conflict';
  END IF;

  IF v_session.order_id IS NOT NULL
     OR v_session.stripe_payment_intent_id IS NOT NULL
     OR v_session.status NOT IN ('pending_free', 'requires_payment') THEN
    RAISE EXCEPTION 'checkout_contract_too_late';
  END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array'
     OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'checkout_lines_conflict';
  END IF;

  SELECT count(*), COALESCE(sum(total_cents), 0)
    INTO v_item_count, v_full_price
    FROM public.ticket_checkout_session_items
   WHERE checkout_session_id = p_checkout_session_id;
  -- issue #3281 — the extras this session reserved are part of its full price,
  -- never ride a plan, and a retry must name exactly those extras.
  v_full_price := v_full_price + COALESCE((
    SELECT sum(x.total_cents) FROM public.ticket_checkout_session_add_on_items x
     WHERE x.checkout_session_id = p_checkout_session_id), 0);
  IF EXISTS (SELECT 1 FROM public.ticket_checkout_session_add_on_items x
              WHERE x.checkout_session_id = p_checkout_session_id) THEN
    IF p_installment_schedule IS NOT NULL AND p_installment_schedule <> 'null'::jsonb THEN
      -- issue #3281 S5 — add-ons ride only a v2 plan, only with plan_enabled
      -- on, and only on the rows the database plans itself for this session.
      IF NOT public.issue_3281_add_on_switch('plan_enabled')
         OR COALESCE(p_installment_schedule->>'planVersion', '') <> '2' THEN
        RAISE EXCEPTION 'checkout_quote_invalid';
      END IF;
      v_addon_plan := public.issue_4522_checkout_v2_plan(p_checkout_session_id, p_lines);
      IF v_addon_plan IS NULL
         OR COALESCE((v_addon_plan->>'addOnsOnPlan')::boolean, false) IS NOT TRUE
         OR jsonb_typeof(v_addon_plan#>'{installmentSchedule,installments}') IS DISTINCT FROM 'array'
         OR jsonb_array_length(v_addon_plan#>'{installmentSchedule,installments}')
            <> jsonb_array_length(COALESCE(p_installment_schedule->'installments', '[]'::jsonb))
         OR EXISTS (
           SELECT 1
             FROM jsonb_array_elements(p_installment_schedule->'installments') WITH ORDINALITY a(e, n)
             JOIN jsonb_array_elements(v_addon_plan#>'{installmentSchedule,installments}') WITH ORDINALITY b(e, n)
               ON b.n = a.n
            WHERE (a.e->>'amountCents') IS DISTINCT FROM (b.e->>'amountCents')
               OR COALESCE(a.e->>'addonPortionCents', '0') IS DISTINCT FROM (b.e->>'addonPortionCents')
               OR (a.e->>'sourceTicketTypeId') IS DISTINCT FROM (b.e->>'sourceTicketTypeId')
               OR (a.e->>'dueAt')::timestamptz IS DISTINCT FROM (b.e->>'dueAt')::timestamptz) THEN
        RAISE EXCEPTION 'checkout_quote_invalid';
      END IF;
    END IF;
  END IF;
  IF (SELECT count(*) FROM public.ticket_checkout_session_add_on_items x
       WHERE x.checkout_session_id = p_checkout_session_id)
     <> (SELECT count(*) FROM jsonb_array_elements(p_lines) AS l,
           jsonb_array_elements(CASE WHEN jsonb_typeof(l.value->'addOns') = 'array'
             THEN l.value->'addOns' ELSE '[]'::jsonb END) AS a)
     OR EXISTS (
       SELECT 1 FROM public.ticket_checkout_session_add_on_items x
        WHERE x.checkout_session_id = p_checkout_session_id
          AND NOT EXISTS (
            SELECT 1 FROM jsonb_array_elements(p_lines) AS l,
                   jsonb_array_elements(CASE WHEN jsonb_typeof(l.value->'addOns') = 'array'
                     THEN l.value->'addOns' ELSE '[]'::jsonb END) AS a
             WHERE l.value->>'ticketTypeId' = x.ticket_type_id::text
               AND a.value->>'addOnId' = x.ticket_add_on_id::text
               AND a.value->>'quantity' = x.quantity::text)) THEN
    RAISE EXCEPTION 'checkout_lines_conflict';
  END IF;
  IF v_item_count <> jsonb_array_length(p_lines)
     OR v_full_price <> p_full_price_cents THEN
    RAISE EXCEPTION 'checkout_lines_conflict';
  END IF;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    IF jsonb_typeof(v_line) <> 'object'
       OR COALESCE(v_line->>'ticketTypeId', '') !~
         '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
       OR COALESCE(v_line->>'quantity', '') !~ '^[1-9][0-9]*$'
       OR COALESCE(v_line->>'paymentPlanChoice', '') NOT IN ('full', 'installments') THEN
      RAISE EXCEPTION 'checkout_lines_conflict';
    END IF;
    v_ticket_type_id := (v_line->>'ticketTypeId')::uuid;
    v_quantity := (v_line->>'quantity')::integer;
    v_choice := v_line->>'paymentPlanChoice';

    SELECT * INTO v_item
      FROM public.ticket_checkout_session_items
     WHERE checkout_session_id = p_checkout_session_id
       AND ticket_type_id = v_ticket_type_id;
    IF NOT FOUND OR v_item.quantity <> v_quantity THEN
      RAISE EXCEPTION 'checkout_lines_conflict';
    END IF;
    -- A same-total retry must not bind over the reserved per-date split.
    IF v_item.by_date IS DISTINCT FROM (v_line -> 'byDate') THEN
      RAISE EXCEPTION 'checkout_lines_conflict';
    END IF;

    IF v_ticket_type_id = ANY(v_seen_ticket_ids) THEN
      RAISE EXCEPTION 'checkout_lines_conflict';
    END IF;
    v_seen_ticket_ids := array_append(v_seen_ticket_ids, v_ticket_type_id);
    UPDATE public.ticket_checkout_session_items
       SET payment_plan_choice = v_choice
     WHERE id = v_item.id;
    v_seen := v_seen + 1;
  END LOOP;
  IF v_seen <> v_item_count THEN
    RAISE EXCEPTION 'checkout_lines_conflict';
  END IF;

  IF p_due_today_cents < 0 OR p_due_today_cents > p_full_price_cents THEN
    RAISE EXCEPTION 'checkout_quote_invalid';
  END IF;
  IF p_installment_schedule IS NULL THEN
    IF p_due_today_cents <> p_full_price_cents
       OR EXISTS (
         SELECT 1 FROM public.ticket_checkout_session_items
          WHERE checkout_session_id = p_checkout_session_id
            AND payment_plan_choice = 'installments'
       ) THEN
      RAISE EXCEPTION 'checkout_quote_invalid';
    END IF;
  ELSE
    IF jsonb_typeof(p_installment_schedule) <> 'object'
       OR COALESCE(p_installment_schedule->>'fullPriceCents', '') !~ '^[0-9]+$'
       OR COALESCE(p_installment_schedule->>'depositCents', '') !~ '^[0-9]+$'
       OR upper(COALESCE(p_installment_schedule->>'currency', '')) <>
         upper(trim(v_session.currency))
       OR jsonb_typeof(p_installment_schedule->'installments') <> 'array'
       OR p_due_today_cents <= 0 THEN
      RAISE EXCEPTION 'checkout_quote_invalid';
    END IF;
    IF jsonb_array_length(p_installment_schedule->'installments') = 0
       OR (p_installment_schedule->>'fullPriceCents')::bigint <> p_full_price_cents
       OR (p_installment_schedule->>'depositCents')::bigint <> p_due_today_cents THEN
      RAISE EXCEPTION 'checkout_quote_invalid';
    END IF;
    FOR v_installment IN
      SELECT value FROM jsonb_array_elements(p_installment_schedule->'installments')
    LOOP
      IF COALESCE(v_installment->>'ordinal', '') !~ '^[1-9][0-9]*$'
         OR (v_installment->>'ordinal')::integer <> v_expected_ordinal
         OR COALESCE(v_installment->>'amountCents', '') !~ '^[1-9][0-9]*$'
         OR COALESCE(v_installment->>'sourceTicketTypeId', '') !~
           '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
         OR NOT EXISTS (
           SELECT 1 FROM public.ticket_checkout_session_items
            WHERE checkout_session_id = p_checkout_session_id
              AND ticket_type_id = (v_installment->>'sourceTicketTypeId')::uuid
              AND payment_plan_choice = 'installments'
         ) THEN
        RAISE EXCEPTION 'checkout_quote_invalid';
      END IF;
      IF (v_installment->>'dueAt')::timestamptz <= v_session.created_at THEN
        RAISE EXCEPTION 'checkout_quote_invalid';
      END IF;
      v_scheduled_total := v_scheduled_total +
        (v_installment->>'amountCents')::bigint;
      v_expected_ordinal := v_expected_ordinal + 1;
    END LOOP;
    IF p_due_today_cents + v_scheduled_total <> p_full_price_cents
       OR EXISTS (
         SELECT 1 FROM public.ticket_checkout_session_items l
          WHERE l.checkout_session_id = p_checkout_session_id
            AND l.payment_plan_choice = 'installments'
            AND NOT EXISTS (
              SELECT 1
                FROM jsonb_array_elements(p_installment_schedule->'installments') i
               WHERE i->>'sourceTicketTypeId' = l.ticket_type_id::text
            )
       ) THEN
      RAISE EXCEPTION 'checkout_quote_invalid';
    END IF;
  END IF;

  UPDATE public.ticket_checkout_sessions
     SET checkout_contract_version = 2,
         checkout_attempt_id = p_checkout_attempt_id,
         checkout_fingerprint = p_checkout_fingerprint,
         cart_fingerprint = p_checkout_fingerprint,
         subtotal_cents = p_due_today_cents,
         total_cents = p_due_today_cents,
         installment_schedule = p_installment_schedule,
         -- issue #3281 S5 — frozen terms and the add-on choice, only when the
         -- add-ons ride the plan (finalize copies both to the order).
         payment_plan_terms = CASE WHEN v_addon_plan IS NULL THEN payment_plan_terms
           ELSE v_addon_plan->'paymentPlanTerms' END,
         addon_payment_mode = CASE WHEN v_addon_plan IS NULL THEN addon_payment_mode
           ELSE v_addon_plan->>'addonPaymentMode' END,
         updated_at = now()
   WHERE id = p_checkout_session_id;

  IF v_addon_plan IS NOT NULL THEN
    UPDATE public.ticket_checkout_session_add_on_items
       SET plan_choice = v_addon_plan->>'addonPaymentMode'
     WHERE checkout_session_id = p_checkout_session_id;
  END IF;

  RETURN jsonb_build_object(
    'outcome', 'bound',
    'totalCents', p_due_today_cents,
    'installmentSchedule', p_installment_schedule
  );
END
$function$
;

-- ---------------------------------------------------------------------------
-- 2. Refunds per choice: the plan-removal ledger and its helpers.
-- ---------------------------------------------------------------------------
CREATE TABLE public.order_add_on_plan_removals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  order_add_on_line_item_id uuid NOT NULL
    REFERENCES public.order_add_on_line_items(id) ON DELETE CASCADE,
  -- The money refund this removal rode with; NULL when no money moved.
  refund_id uuid REFERENCES public.refunds(id) ON DELETE RESTRICT,
  -- Units returned by this removal. 0 when a money refund carries the units.
  quantity integer NOT NULL CHECK (quantity >= 0),
  removed_minor bigint NOT NULL CHECK (removed_minor > 0),
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 128),
  actor uuid,
  request jsonb,
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT order_add_on_plan_removals_one_per_request
    UNIQUE (order_id, idempotency_key, order_add_on_line_item_id)
);
CREATE INDEX order_add_on_plan_removals_line_idx
  ON public.order_add_on_plan_removals (order_add_on_line_item_id);
CREATE INDEX order_add_on_plan_removals_refund_idx
  ON public.order_add_on_plan_removals (refund_id);
ALTER TABLE public.order_add_on_plan_removals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.order_add_on_plan_removals FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.order_add_on_plan_removals TO service_role;
COMMENT ON TABLE public.order_add_on_plan_removals IS
  'Issue #3281 S5: spread add-on amounts taken off a trip plan''s open rows by a host or admin add-on refund (removed_minor), with the units they returned when no money moved. Written only by issue_3281_apply_plan_removals.';

CREATE FUNCTION public.issue_3281_add_on_removed_qty(p_line_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT COALESCE(SUM(pr.quantity), 0)::integer
    FROM public.order_add_on_plan_removals pr
   WHERE pr.order_add_on_line_item_id = p_line_id;
$fn$;

CREATE FUNCTION public.issue_3281_add_on_removed_cents(p_line_id uuid)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT COALESCE(SUM(pr.removed_minor), 0)::bigint
    FROM public.order_add_on_plan_removals pr
   WHERE pr.order_add_on_line_item_id = p_line_id;
$fn$;

-- True while a spread order still has add-on money on open plan rows.
CREATE FUNCTION public.issue_3281_order_has_open_spread(p_order_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.orders o
      JOIN public.order_installments oi ON oi.order_id = o.id
     WHERE o.id = p_order_id AND o.addon_payment_mode = 'spread'
       AND oi.kind = 'scheduled' AND oi.status IN ('scheduled', 'failed')
       AND oi.addon_portion_minor > 0);
$fn$;

-- The named add-on lines (issue_3281_add_on_refund_lines' canonical shape),
-- each spread line split into removed_minor (off its package's open rows, in
-- line order) and money_minor (the collected rest). Not a spread order: the
-- input comes back unchanged. The same open-row sum as
-- issue_4522_remove_spread_addon, so the removal later takes exactly this.
CREATE FUNCTION public.issue_3281_add_on_plan_split(p_order_id uuid, p_add_on_lines jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_line jsonb;
  v_item public.order_add_on_line_items%ROWTYPE;
  v_used jsonb := '{}'::jsonb;
  v_open bigint;
  v_take bigint;
  v_amount bigint;
  v_key text;
  v_out jsonb := '[]'::jsonb;
BEGIN
  IF p_add_on_lines IS NULL THEN RETURN NULL; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.orders o
                  WHERE o.id = p_order_id AND o.addon_payment_mode = 'spread') THEN
    RETURN p_add_on_lines;
  END IF;
  FOR v_line IN SELECT value FROM jsonb_array_elements(p_add_on_lines) WITH ORDINALITY a(value, n) ORDER BY n LOOP
    SELECT * INTO v_item FROM public.order_add_on_line_items
     WHERE id = (v_line->>'order_add_on_line_item_id')::uuid AND order_id = p_order_id;
    IF NOT FOUND OR v_item.plan_choice IS DISTINCT FROM 'spread' THEN
      v_out := v_out || jsonb_build_array(v_line);
      CONTINUE;
    END IF;
    v_key := COALESCE(v_item.ticket_type_id::text, '');
    SELECT COALESCE(sum(oi.addon_portion_minor), 0) INTO v_open
      FROM public.order_installments oi
     WHERE oi.order_id = p_order_id AND oi.kind = 'scheduled'
       AND oi.status IN ('scheduled', 'failed')
       AND oi.ticket_type_id IS NOT DISTINCT FROM v_item.ticket_type_id;
    v_open := greatest(v_open - COALESCE((v_used->>v_key)::bigint, 0), 0);
    v_amount := (v_line->>'amount_cents')::bigint;
    v_take := least(v_open, greatest(v_amount, 0));
    v_used := v_used || jsonb_build_object(v_key, COALESCE((v_used->>v_key)::bigint, 0) + v_take);
    v_out := v_out || jsonb_build_array(v_line || jsonb_build_object(
      'removed_minor', v_take, 'money_minor', v_amount - v_take));
  END LOOP;
  RETURN v_out;
END;
$fn$;

-- Takes each split line's removed_minor off the open rows (through #4522's
-- seam, which locks the plan graph and refuses an in-flight payment with
-- PT409) and records it. With no money refund (p_refund_id NULL) the removal
-- returns the units itself and its result is what a replay of the key gets.
CREATE FUNCTION public.issue_3281_apply_plan_removals(
  p_order_id uuid, p_plan jsonb, p_refund_id uuid, p_idempotency_key text,
  p_actor uuid, p_request jsonb, p_reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_line jsonb;
  v_item public.order_add_on_line_items%ROWTYPE;
  v_seam jsonb;
  v_removed bigint;
  v_total bigint := 0;
  v_order public.orders%ROWTYPE;
  v_result jsonb;
BEGIN
  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'idempotency_key_required' USING ERRCODE = '22023';
  END IF;
  FOR v_line IN SELECT value FROM jsonb_array_elements(COALESCE(p_plan, '[]'::jsonb)) WITH ORDINALITY a(value, n) ORDER BY n LOOP
    v_removed := COALESCE((v_line->>'removed_minor')::bigint, 0);
    CONTINUE WHEN v_removed <= 0;
    SELECT * INTO v_item FROM public.order_add_on_line_items
     WHERE id = (v_line->>'order_add_on_line_item_id')::uuid AND order_id = p_order_id;
    v_seam := public.issue_4522_remove_spread_addon(p_order_id, v_item.ticket_type_id, v_removed, p_actor);
    IF (v_seam->>'removedFromOpenMinor')::bigint IS DISTINCT FROM v_removed THEN
      RAISE EXCEPTION 'add_on_plan_changed' USING ERRCODE = 'PT409';
    END IF;
    INSERT INTO public.order_add_on_plan_removals (
      order_id, order_add_on_line_item_id, refund_id, quantity, removed_minor,
      idempotency_key, actor, request
    ) VALUES (
      p_order_id, v_item.id, p_refund_id,
      CASE WHEN COALESCE((v_line->>'money_minor')::bigint, 0) > 0 THEN 0
           ELSE (v_line->>'quantity')::integer END,
      v_removed, p_idempotency_key, p_actor, p_request);
    v_total := v_total + v_removed;
  END LOOP;
  IF p_refund_id IS NOT NULL THEN
    RETURN NULL;
  END IF;
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  v_result := jsonb_build_object(
    'refund_id', NULL,
    'order_id', p_order_id,
    'amount_cents', 0,
    'currency', v_order.currency,
    'removed_from_plan_cents', v_total,
    'plan_removal_only', true,
    'proposed_new_payment_status', v_order.payment_status,
    'is_full_refund', false,
    'lines', '[]'::jsonb,
    'reason', p_reason,
    'idempotent_replay', false);
  UPDATE public.order_add_on_plan_removals
     SET result = v_result
   WHERE order_id = p_order_id AND idempotency_key = p_idempotency_key AND refund_id IS NULL;
  RETURN v_result;
END;
$fn$;

REVOKE ALL ON FUNCTION public.issue_3281_add_on_removed_qty(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_3281_add_on_removed_cents(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_3281_order_has_open_spread(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_3281_add_on_plan_split(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_3281_apply_plan_removals(uuid, jsonb, uuid, text, uuid, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3281_add_on_removed_qty(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_3281_add_on_removed_cents(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_3281_order_has_open_spread(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_3281_add_on_plan_split(uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_3281_apply_plan_removals(uuid, jsonb, uuid, text, uuid, jsonb, text) TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Refund helpers and entry points (plan removals count as returned).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_3281_extras_refund_cents(p_order_id uuid, p_lines jsonb, p_this_refund uuid)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_cents bigint;
BEGIN
  IF NOT public.issue_3281_refund_returns_all_tickets(p_order_id, p_lines, p_this_refund) THEN
    RETURN 0;
  END IF;
  -- An add-on is returned once per unit, even when a discount capped what it got back.
  SELECT COALESCE(SUM(item.total_cents::bigint - done.cents), 0)
    INTO v_cents
    FROM public.order_add_on_line_items item
    CROSS JOIN LATERAL (
      -- issue #3281 S5 — a spread add-on taken off the plan is returned too.
      SELECT COALESCE(SUM(ra.quantity), 0) + public.issue_3281_add_on_removed_qty(item.id) AS qty,
             COALESCE(SUM(ra.amount_cents::bigint), 0) + public.issue_3281_add_on_removed_cents(item.id) AS cents
        FROM public.refund_add_on_line_items ra
        JOIN public.refunds r ON r.id = ra.refund_id
       WHERE ra.order_add_on_line_item_id = item.id
         AND r.status IN ('pending', 'succeeded')
         AND r.id IS DISTINCT FROM p_this_refund
    ) done
   WHERE item.order_id = p_order_id
     AND done.qty < item.quantity;
  RETURN GREATEST(v_cents, 0)::integer;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.issue_3281_extras_refund_cents_settled(p_order_id uuid, p_lines jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_cents integer := public.issue_3281_extras_refund_cents(p_order_id, p_lines, NULL);
BEGIN
  -- A free extra waits too: it is still recorded as returned.
  IF public.issue_3281_refund_returns_all_tickets(p_order_id, p_lines, NULL)
     AND EXISTS (
       SELECT 1 FROM public.order_add_on_line_items item
        WHERE item.order_id = p_order_id
          AND item.quantity > (
            SELECT COALESCE(SUM(ra.quantity), 0) + public.issue_3281_add_on_removed_qty(item.id)
              FROM public.refund_add_on_line_items ra
              JOIN public.refunds r ON r.id = ra.refund_id
             WHERE ra.order_add_on_line_item_id = item.id
               AND r.status IN ('pending', 'succeeded')
          )
     )
     AND EXISTS (
       SELECT 1 FROM public.refunds r
        WHERE r.order_id = p_order_id AND r.status = 'pending'
     ) THEN
    RAISE EXCEPTION 'refund_pending_on_order' USING ERRCODE = 'P0013';
  END IF;
  RETURN v_cents;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.issue_3281_record_extras_refund(p_refund_id uuid, p_order_id uuid, p_lines jsonb, p_cap integer DEFAULT NULL::integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT public.issue_3281_refund_returns_all_tickets(p_order_id, p_lines, p_refund_id) THEN
    RETURN;
  END IF;
  INSERT INTO public.refund_add_on_line_items (
    refund_id, order_add_on_line_item_id, quantity, amount_cents
  )
  SELECT p_refund_id, due.id, due.open_qty,
         CASE WHEN p_cap IS NULL THEN due.open_cents
              ELSE LEAST(due.open_cents, GREATEST(p_cap::bigint - due.before, 0)) END::integer
    FROM (
      SELECT item.id, item.quantity - done.qty AS open_qty,
             GREATEST(item.total_cents::bigint - done.cents, 0) AS open_cents,
             COALESCE(SUM(GREATEST(item.total_cents::bigint - done.cents, 0)) OVER (
               ORDER BY item.id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
             ), 0) AS before
        FROM public.order_add_on_line_items item
        CROSS JOIN LATERAL (
          -- issue #3281 S5 — never refund what came off the plan.
          SELECT (COALESCE(SUM(ra.quantity), 0) + public.issue_3281_add_on_removed_qty(item.id))::integer AS qty,
                 COALESCE(SUM(ra.amount_cents::bigint), 0) + public.issue_3281_add_on_removed_cents(item.id) AS cents
            FROM public.refund_add_on_line_items ra
            JOIN public.refunds r ON r.id = ra.refund_id
           WHERE ra.order_add_on_line_item_id = item.id
             AND r.status IN ('pending', 'succeeded')
        ) done
       WHERE item.order_id = p_order_id
         AND done.qty < item.quantity
    ) due;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.issue_3281_add_ons_all_returned(p_order_id uuid, p_settled_only boolean)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT NOT public.issue_3281_add_on_switch('free_parent_enabled')
    OR NOT EXISTS (
      SELECT 1 FROM public.order_add_on_line_items item
       WHERE item.order_id = p_order_id
         AND item.quantity > (
           SELECT COALESCE(SUM(ra.quantity), 0) + public.issue_3281_add_on_removed_qty(item.id)
             FROM public.refund_add_on_line_items ra
             JOIN public.refunds r ON r.id = ra.refund_id
            WHERE ra.order_add_on_line_item_id = item.id
              AND (r.status = 'succeeded'
                   OR (NOT p_settled_only AND r.status = 'pending'))
         )
    );
$function$
;

CREATE OR REPLACE FUNCTION public.issue_3281_add_on_refund_lines(p_order_id uuid, p_add_on_lines jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_out jsonb;
  v_missing text;
BEGIN
  IF p_add_on_lines IS NULL OR p_add_on_lines = 'null'::jsonb
     OR (jsonb_typeof(p_add_on_lines) = 'array' AND jsonb_array_length(p_add_on_lines) = 0) THEN
    RETURN NULL;
  END IF;
  IF NOT public.issue_3281_add_on_switch('free_parent_enabled') THEN
    RAISE EXCEPTION 'add_on_refunds_off' USING ERRCODE = 'P0001';
  END IF;
  IF jsonb_typeof(p_add_on_lines) <> 'array' OR EXISTS (
       SELECT 1 FROM jsonb_array_elements(p_add_on_lines) l
        WHERE jsonb_typeof(l) <> 'object'
           OR jsonb_typeof(l->'quantity') IS DISTINCT FROM 'number'
           OR (l->>'quantity') !~ '^[0-9]+$'
           OR (l->>'order_add_on_line_item_id') !~* '^[0-9a-f-]{36}$') THEN
    RAISE EXCEPTION 'refund_lines_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT l->>'order_add_on_line_item_id' INTO v_missing
    FROM jsonb_array_elements(p_add_on_lines) l
   WHERE NOT EXISTS (
     SELECT 1 FROM public.order_add_on_line_items item
      WHERE item.id = (l->>'order_add_on_line_item_id')::uuid AND item.order_id = p_order_id)
   LIMIT 1;
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'add_on_line_not_found: %', v_missing USING ERRCODE = 'P0004';
  END IF;
  SELECT jsonb_agg(jsonb_build_object(
           'order_add_on_line_item_id', req.line_id,
           'quantity', req.qty,
           -- issue #3281 S5 — what came off the plan is not refunded again.
           'amount_cents', LEAST(req.qty * item.unit_price_cents::bigint,
             item.total_cents::bigint - public.issue_3281_add_on_removed_cents(item.id)))
         ORDER BY req.line_id)
    INTO v_out
    FROM (
      SELECT (l->>'order_add_on_line_item_id')::uuid AS line_id,
             SUM((l->>'quantity')::bigint) AS qty
        FROM jsonb_array_elements(p_add_on_lines) l
       GROUP BY 1
    ) req
    JOIN public.order_add_on_line_items item ON item.id = req.line_id;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_out) l WHERE (l->>'quantity')::bigint <= 0) THEN
    RAISE EXCEPTION 'refund_amount_zero' USING ERRCODE = 'P0008';
  END IF;
  RETURN v_out;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.issue_3281_add_on_refund_cents(p_order_id uuid, p_lines jsonb, p_add_on_lines jsonb, p_settled boolean)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_line jsonb;
  v_item public.order_add_on_line_items%ROWTYPE;
  v_done_qty bigint;
  v_done_cents bigint;
  v_cents bigint := 0;
BEGIN
  -- Bounds are checked first, so a named line can never be refunded twice.
  FOR v_line IN SELECT * FROM jsonb_array_elements(COALESCE(p_add_on_lines, '[]'::jsonb)) LOOP
    SELECT * INTO v_item FROM public.order_add_on_line_items
     WHERE id = (v_line->>'order_add_on_line_item_id')::uuid AND order_id = p_order_id;
    -- issue #3281 S5 — plan removals count against the line's bounds too.
    SELECT COALESCE(SUM(ra.quantity), 0) + public.issue_3281_add_on_removed_qty(v_item.id),
           COALESCE(SUM(ra.amount_cents::bigint), 0) + public.issue_3281_add_on_removed_cents(v_item.id)
      INTO v_done_qty, v_done_cents
      FROM public.refund_add_on_line_items ra
      JOIN public.refunds r ON r.id = ra.refund_id
     WHERE ra.order_add_on_line_item_id = v_item.id
       AND r.status IN ('pending', 'succeeded');
    IF v_done_qty + (v_line->>'quantity')::bigint > v_item.quantity
       OR v_done_cents + (v_line->>'amount_cents')::bigint > v_item.total_cents THEN
      RAISE EXCEPTION 'add_on_line_overrefund: line=% requested=% existing=% capacity=%',
        v_item.id, v_line->>'quantity', v_done_qty, v_item.quantity USING ERRCODE = 'P0005';
    END IF;
    -- issue #3281 S5 — a spread add-on refunds only what was collected
    -- (money_minor); the rest comes off the open plan rows.
    v_cents := v_cents + COALESCE((v_line->>'money_minor')::bigint, (v_line->>'amount_cents')::bigint);
  END LOOP;
  IF public.issue_3281_refund_returns_all_tickets(p_order_id, p_lines, NULL) THEN
    -- issue #3281 S5 — returning every ticket would refund add-ons the plan
    -- has not collected yet: a booking still being paid is cancelled instead.
    IF public.issue_3281_order_has_open_spread(p_order_id) THEN
      RAISE EXCEPTION 'add_on_plan_open_use_cancel' USING ERRCODE = 'P0001';
    END IF;
    RETURN CASE WHEN p_settled
      THEN public.issue_3281_extras_refund_cents_settled(p_order_id, p_lines)
      ELSE public.issue_3281_extras_refund_cents(p_order_id, p_lines, NULL) END;
  END IF;
  RETURN v_cents::integer;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.issue_3281_record_add_on_refund(p_refund_id uuid, p_order_id uuid, p_lines jsonb, p_add_on_lines jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_key text;
  v_actor uuid;
BEGIN
  IF public.issue_3281_refund_returns_all_tickets(p_order_id, p_lines, p_refund_id) THEN
    PERFORM public.issue_3281_record_extras_refund(p_refund_id, p_order_id, p_lines);
    RETURN;
  END IF;
  IF p_add_on_lines IS NULL THEN RETURN; END IF;
  -- issue #3281 S5 — spread add-ons come off the open plan rows first, under
  -- this refund's key; only the collected part is refunded in money.
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_add_on_lines) l
              WHERE COALESCE((l->>'removed_minor')::bigint, 0) > 0) THEN
    SELECT r.metadata->>'idempotency_key', r.initiated_by INTO v_key, v_actor
      FROM public.refunds r WHERE r.id = p_refund_id;
    PERFORM public.issue_3281_apply_plan_removals(p_order_id, p_add_on_lines, p_refund_id, v_key, v_actor, NULL, NULL);
  END IF;
  INSERT INTO public.refund_add_on_line_items (
    refund_id, order_add_on_line_item_id, quantity, amount_cents
  )
  SELECT p_refund_id, (l->>'order_add_on_line_item_id')::uuid,
         (l->>'quantity')::integer,
         COALESCE((l->>'money_minor')::bigint, (l->>'amount_cents')::bigint)::integer
    FROM jsonb_array_elements(p_add_on_lines) l
   WHERE COALESCE((l->>'removed_minor')::bigint, 0) = 0
      OR COALESCE((l->>'money_minor')::bigint, 0) > 0;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.refund_preview(p_order_id uuid, p_lines jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_order public.orders%ROWTYPE;
  v_brand_id uuid;
  v_lines jsonb;
  v_line jsonb;
  v_item public.order_line_items%ROWTYPE;
  v_existing integer;
  v_amount bigint := 0;
  v_remaining bigint;
  v_add_on_lines jsonb;
  -- issue #3281 S5 — spread add-ons split into plan removal and money.
  v_add_on_plan jsonb;
  v_plan_removed bigint := 0;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0001';
  END IF;
  SELECT brand_id INTO v_brand_id FROM public.events WHERE id = v_order.event_id;
  IF NOT public.biz_can_manage_payments_for_brand(v_brand_id, auth.uid()) THEN
    RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
  END IF;

  -- issue #3281 S4 — add-on lines ride p_lines, keyed order_add_on_line_item_id.
  v_add_on_lines := public.issue_3281_add_on_refund_lines(
    p_order_id, public.issue_3281_split_refund_lines(p_lines, true));
  p_lines := public.issue_3281_split_refund_lines(p_lines, false);
  v_add_on_plan := public.issue_3281_add_on_plan_split(p_order_id, v_add_on_lines);
  v_lines := public.issue_3872_refund_server_lines(p_order_id, p_lines);
  FOR v_line IN SELECT * FROM jsonb_array_elements(v_lines) LOOP
    SELECT * INTO v_item FROM public.order_line_items
     WHERE id::text = v_line->>'order_line_item_id' AND order_id = p_order_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'line_item_not_found: %', v_line->>'order_line_item_id' USING ERRCODE = 'P0004';
    END IF;
    IF COALESCE((v_line->>'quantity')::int, 0) <= 0 THEN
      RAISE EXCEPTION 'refund_amount_zero' USING ERRCODE = 'P0008';
    END IF;
    SELECT COALESCE(SUM(rli.quantity), 0) INTO v_existing
    FROM public.refund_line_items rli
    JOIN public.refunds r ON r.id = rli.refund_id
    WHERE rli.order_line_item_id = v_item.id AND r.status IN ('pending', 'succeeded');
    IF v_existing + (v_line->>'quantity')::int > v_item.quantity THEN
      RAISE EXCEPTION 'line_overrefund: line=% requested=% existing=% capacity=%',
        v_item.id, v_line->>'quantity', v_existing, v_item.quantity USING ERRCODE = 'P0005';
    END IF;
    v_amount := v_amount + (v_line->>'amount_cents')::bigint;
  END LOOP;
  -- issue #3281 — the same rule the refund itself applies.
  v_amount := v_amount + public.issue_3281_add_on_refund_cents(p_order_id, v_lines, v_add_on_plan, false);
  SELECT COALESCE(sum((l->>'removed_minor')::bigint), 0) INTO v_plan_removed
    FROM jsonb_array_elements(COALESCE(v_add_on_plan, '[]'::jsonb)) l;

  v_remaining := COALESCE(v_order.buyer_total_cents, v_order.total_cents)
    - COALESCE(v_order.refunded_amount_cents, 0);
  RETURN jsonb_build_object(
    'order_id', p_order_id,
    'currency', v_order.currency,
    'lines', v_lines,
    'amount_cents', v_amount,
    'remaining_cents', v_remaining,
    'within_remaining', v_amount <= v_remaining
  )
  -- issue #3281 S5 — present only when spread add-ons come off the plan.
  || CASE WHEN v_plan_removed > 0
       THEN jsonb_build_object('removed_from_plan_cents', v_plan_removed)
       ELSE '{}'::jsonb END;
END
$function$
;

CREATE OR REPLACE FUNCTION public.biz_refund_order(p_order_id uuid, p_lines jsonb, p_reason text, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_order public.orders%ROWTYPE;
  v_brand_id uuid;
  v_caller uuid := auth.uid();
  v_refund_id uuid;
  v_refund_amount_cents int := 0;
  v_line jsonb;
  v_line_item public.order_line_items%ROWTYPE;
  v_existing_refunded int;
  v_all_lines_fully_refunded boolean;
  v_proposed_new_payment_status text;
  v_existing_refund public.refunds%ROWTYPE;
  v_canonical_lines jsonb;
  v_request_manifest jsonb;
  v_stored_manifest jsonb;
  v_client_lines jsonb;
  v_client_amount_cents bigint;
  -- issue #3281 S4 — add-on lines refunded on their own (NULL when none).
  v_add_on_lines jsonb;
  -- issue #3281 S5 — the same lines with each spread add-on split into what
  -- comes off the open plan rows and what is refunded in money.
  v_add_on_plan jsonb;
  v_plan_removed bigint := 0;
  v_removal_replay jsonb;
BEGIN
  -- Authorization precedes the idempotency lookup so replay cannot disclose
  -- refund or payment identifiers to a caller outside the order's brand.
  -- issue #3281 S5 — an order with spread add-ons locks its plan graph in the
  -- plan's own order (event, order, open rows) before the order row below.
  IF EXISTS (SELECT 1 FROM public.orders o
              WHERE o.id = p_order_id AND o.addon_payment_mode = 'spread') THEN
    PERFORM public.issue_4522_lock_order_graph(p_order_id);
  END IF;
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0001';
  END IF;

  SELECT brand_id INTO v_brand_id FROM public.events WHERE id = v_order.event_id;
  IF NOT public.biz_can_manage_payments_for_brand(v_brand_id, v_caller) THEN
    RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
  END IF;

  IF p_reason IS NULL OR length(trim(p_reason)) < 10 OR length(trim(p_reason)) > 200 THEN
    RAISE EXCEPTION 'reason_invalid_length' USING ERRCODE = 'P0003';
  END IF;

  -- issue #3281 S4 — add-on lines ride p_lines, keyed order_add_on_line_item_id;
  -- the ticket lines below never see them.
  v_add_on_lines := public.issue_3281_add_on_refund_lines(
    p_order_id, public.issue_3281_split_refund_lines(p_lines, true));
  p_lines := public.issue_3281_split_refund_lines(p_lines, false);
  v_add_on_plan := public.issue_3281_add_on_plan_split(p_order_id, v_add_on_lines);

  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'order_line_item_id', line->>'order_line_item_id',
        'quantity', (line->>'quantity')::int,
        'amount_cents', (line->>'amount_cents')::int
      )
      ORDER BY
        line->>'order_line_item_id',
        (line->>'quantity')::int,
        (line->>'amount_cents')::int
    ),
    '[]'::jsonb
  )
  INTO v_client_lines
  FROM jsonb_array_elements(p_lines) AS line;

  -- Issue #3872 (F4): the refund amount is derived on the server from the
  -- order snapshot (quantity x order_line_items.unit_price_cents, the policy the
  -- Host app has always sent). A client-sent amount_cents is ignored; it is
  -- only logged below when it disagrees. Replays of a key minted before this
  -- change still match their stored client-shaped manifest.
  v_canonical_lines := public.issue_3872_refund_server_lines(p_order_id, p_lines);
  SELECT sum((l->>'amount_cents')::bigint) INTO v_client_amount_cents
  FROM jsonb_array_elements(v_client_lines) l;

  v_request_manifest := jsonb_build_object(
    'lines', v_canonical_lines,
    'reason', trim(p_reason),
    -- What the client sent, kept so a retry under the same key must repeat it.
    'client_lines', v_client_lines
  );
  IF v_add_on_lines IS NOT NULL THEN
    v_request_manifest := v_request_manifest || jsonb_build_object('add_on_lines', v_add_on_lines);
  END IF;

  -- Serialize same-key requests before the lookup/insert pair. The existing
  -- unique expression index remains the final database backstop.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_order_id::text || ':' || p_idempotency_key, 0)
  );

  SELECT * INTO v_existing_refund
  FROM public.refunds
  WHERE metadata->>'idempotency_key' = p_idempotency_key
    AND order_id = p_order_id
  LIMIT 1;

  IF FOUND THEN
    v_stored_manifest := v_existing_refund.metadata->'refund_request_manifest';
    IF v_stored_manifest IS NULL
       OR (v_stored_manifest->'lines' IS DISTINCT FROM v_canonical_lines
           AND v_stored_manifest->'lines' IS DISTINCT FROM v_client_lines)
       -- A request that names amounts must repeat the amounts first sent under
       -- this key (same key, different body is still a mismatch, #1175).
       OR (v_stored_manifest ? 'client_lines'
           AND v_client_amount_cents IS NOT NULL
           AND v_stored_manifest->'client_lines' IS DISTINCT FROM v_client_lines)
       OR v_stored_manifest->'add_on_lines' IS DISTINCT FROM v_add_on_lines
       OR v_stored_manifest->>'reason' IS DISTINCT FROM trim(p_reason) THEN
      RAISE EXCEPTION 'idempotency_request_mismatch'
        USING ERRCODE = '23505';
    END IF;

    RETURN jsonb_build_object(
      'refund_id', v_existing_refund.id,
      'order_id', p_order_id,
      'amount_cents', v_existing_refund.amount_cents,
      'currency', v_existing_refund.currency,
      'stripe_payment_intent_id', v_order.stripe_payment_intent_id,
      'stripe_charge_id', v_order.stripe_charge_id,
      'application_fee_amount_cents', v_order.stripe_application_fee_amount_cents,
      'proposed_new_payment_status',
        v_stored_manifest->>'proposed_new_payment_status',
      'is_full_refund',
        (v_stored_manifest->>'is_full_refund')::boolean,
      'lines', v_stored_manifest->'lines',
      'reason', v_stored_manifest->>'reason',
      'idempotent_replay', true
    );
  END IF;

  -- issue #3281 S5 — a removal that moved no money replays from its ledger.
  SELECT pr.result, pr.request INTO v_removal_replay, v_stored_manifest
    FROM public.order_add_on_plan_removals pr
   WHERE pr.order_id = p_order_id AND pr.idempotency_key = p_idempotency_key
     AND pr.refund_id IS NULL
   ORDER BY pr.created_at, pr.id LIMIT 1;
  IF FOUND THEN
    IF v_stored_manifest IS DISTINCT FROM v_add_on_lines
       OR jsonb_array_length(v_canonical_lines) > 0 THEN
      RAISE EXCEPTION 'idempotency_request_mismatch' USING ERRCODE = '23505';
    END IF;
    RETURN v_removal_replay || jsonb_build_object('idempotent_replay', true);
  END IF;

  IF v_order.payment_status NOT IN ('paid', 'partial_refund') THEN
    RAISE EXCEPTION 'order_not_refundable: status=%', v_order.payment_status
      USING ERRCODE = 'P0002';
  END IF;

  FOR v_line IN SELECT * FROM jsonb_array_elements(v_canonical_lines) LOOP
    SELECT * INTO v_line_item
    FROM public.order_line_items
    WHERE id = (v_line->>'order_line_item_id')::uuid
      AND order_id = p_order_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'line_item_not_found: %',
        v_line->>'order_line_item_id' USING ERRCODE = 'P0004';
    END IF;

    SELECT COALESCE(SUM(rli.quantity), 0) INTO v_existing_refunded
    FROM public.refund_line_items rli
    JOIN public.refunds r ON r.id = rli.refund_id
    WHERE rli.order_line_item_id = v_line_item.id
      AND r.status IN ('pending', 'succeeded');

    IF COALESCE((v_line->>'quantity')::int, 0) <= 0 THEN
      RAISE EXCEPTION 'refund_amount_zero' USING ERRCODE = 'P0008';
    END IF;

    IF v_existing_refunded + (v_line->>'quantity')::int > v_line_item.quantity THEN
      RAISE EXCEPTION 'line_overrefund: line=% requested=% existing=% capacity=%',
        v_line_item.id, v_line->>'quantity', v_existing_refunded,
        v_line_item.quantity USING ERRCODE = 'P0005';
    END IF;

    v_refund_amount_cents :=
      v_refund_amount_cents + (v_line->>'amount_cents')::int;
  END LOOP;

  -- issue #3281 — returning the last tickets also returns the order's extras.
  v_refund_amount_cents := v_refund_amount_cents
    + public.issue_3281_add_on_refund_cents(p_order_id, v_canonical_lines, v_add_on_plan, true);

  -- issue #3281 S5 — only spread add-ons still on the plan: they come off the
  -- open rows and no money moves (nothing of them was collected).
  SELECT COALESCE(sum((l->>'removed_minor')::bigint), 0) INTO v_plan_removed
    FROM jsonb_array_elements(COALESCE(v_add_on_plan, '[]'::jsonb)) l;
  IF v_refund_amount_cents <= 0 AND v_plan_removed > 0
     AND jsonb_array_length(v_canonical_lines) = 0 THEN
    RETURN public.issue_3281_apply_plan_removals(p_order_id, v_add_on_plan, NULL,
      p_idempotency_key, v_caller, v_add_on_lines, trim(p_reason));
  END IF;

  IF v_refund_amount_cents <= 0 THEN
    RAISE EXCEPTION 'refund_amount_zero' USING ERRCODE = 'P0008';
  END IF;

  -- Issue #3872: never more than the buyer paid and has not had back.
  IF v_refund_amount_cents >
     COALESCE(v_order.buyer_total_cents, v_order.total_cents)
       - COALESCE(v_order.refunded_amount_cents, 0) THEN
    RAISE EXCEPTION 'refund_exceeds_remaining: requested=% remaining=%',
      v_refund_amount_cents,
      COALESCE(v_order.buyer_total_cents, v_order.total_cents)
        - COALESCE(v_order.refunded_amount_cents, 0)
      USING ERRCODE = 'P0009';
  END IF;

  INSERT INTO public.refunds (
    order_id, amount_cents, currency, reason, initiated_by, status,
    stripe_payment_intent_id, stripe_charge_id, metadata
  ) VALUES (
    p_order_id,
    v_refund_amount_cents,
    v_order.currency,
    trim(p_reason),
    v_caller,
    'pending',
    v_order.stripe_payment_intent_id,
    v_order.stripe_charge_id,
    jsonb_build_object(
      'idempotency_key', p_idempotency_key,
      'refund_request_manifest', v_request_manifest
    ) || CASE
      WHEN v_client_amount_cents IS NOT NULL
        AND v_client_amount_cents IS DISTINCT FROM v_refund_amount_cents::bigint
      THEN jsonb_build_object('issue_3872_client_reported', jsonb_build_object(
        'amount_cents', v_client_amount_cents,
        'lines', v_client_lines,
        'server_amount_cents', v_refund_amount_cents))
      ELSE '{}'::jsonb
    END
  ) RETURNING id INTO v_refund_id;

  PERFORM public.issue_3281_record_add_on_refund(v_refund_id, p_order_id, v_canonical_lines, v_add_on_plan);

  FOR v_line IN SELECT * FROM jsonb_array_elements(v_canonical_lines) LOOP
    INSERT INTO public.refund_line_items (
      refund_id, order_line_item_id, ticket_type_id, quantity, amount_cents
    )
    SELECT
      v_refund_id,
      (v_line->>'order_line_item_id')::uuid,
      oli.ticket_type_id,
      (v_line->>'quantity')::int,
      (v_line->>'amount_cents')::int
    FROM public.order_line_items oli
    WHERE oli.id = (v_line->>'order_line_item_id')::uuid
      -- issue #3281 S4 — a free ticket has nothing to refund: naming it returns
      -- it (status below), never a $0 row.
      AND ((v_line->>'amount_cents')::int > 0 OR NOT public.issue_3281_add_on_switch('free_parent_enabled'));
  END LOOP;

  SELECT NOT EXISTS (
    SELECT 1 FROM public.order_line_items oli
    WHERE oli.order_id = p_order_id
      AND oli.quantity > (
        SELECT COALESCE(SUM(rli.quantity), 0)
        FROM public.refund_line_items rli
        JOIN public.refunds r ON r.id = rli.refund_id
        WHERE rli.order_line_item_id = oli.id
          AND r.status IN ('pending', 'succeeded')
      )
      + CASE WHEN oli.unit_price_cents = 0 AND public.issue_3281_add_on_switch('free_parent_enabled')
          THEN COALESCE((SELECT SUM((l->>'quantity')::int) FROM jsonb_array_elements(v_canonical_lines) l
                          WHERE l->>'order_line_item_id' = oli.id::text), 0)
          ELSE 0 END
  ) AND public.issue_3281_add_ons_all_returned(p_order_id, false)
  INTO v_all_lines_fully_refunded;

  v_proposed_new_payment_status := CASE
    WHEN v_all_lines_fully_refunded THEN 'refunded'
    ELSE 'partial_refund'
  END;
  v_request_manifest := v_request_manifest || jsonb_build_object(
    'amount_cents', v_refund_amount_cents,
    'proposed_new_payment_status', v_proposed_new_payment_status,
    'is_full_refund', v_all_lines_fully_refunded
  );
  UPDATE public.refunds
  SET metadata = metadata ||
    jsonb_build_object('refund_request_manifest', v_request_manifest)
  WHERE id = v_refund_id;

  RETURN jsonb_build_object(
    'refund_id', v_refund_id,
    'order_id', p_order_id,
    'amount_cents', v_refund_amount_cents,
    'currency', v_order.currency,
    'stripe_payment_intent_id', v_order.stripe_payment_intent_id,
    'stripe_charge_id', v_order.stripe_charge_id,
    'application_fee_amount_cents', v_order.stripe_application_fee_amount_cents,
    'proposed_new_payment_status', v_proposed_new_payment_status,
    'is_full_refund', v_all_lines_fully_refunded,
    'lines', v_canonical_lines,
    'reason', trim(p_reason),
    'idempotent_replay', false
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_refund_order(p_order_id uuid, p_lines jsonb, p_reason text, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_order public.orders%ROWTYPE;
  v_caller uuid := auth.uid();
  v_refund_id uuid;
  v_refund_amount_cents int := 0;
  v_line jsonb;
  v_line_item public.order_line_items%ROWTYPE;
  v_existing_refunded int;
  v_all_lines_fully_refunded boolean;
  v_proposed_new_payment_status text;
  v_existing_refund public.refunds%ROWTYPE;
  v_remaining_cents int;
  v_canonical_lines jsonb;
  v_request_manifest jsonb;
  v_stored_manifest jsonb;
  v_client_lines jsonb;
  v_client_amount_cents bigint;
  -- issue #3281 S4 — add-on lines refunded on their own (NULL when none).
  v_add_on_lines jsonb;
  -- issue #3281 S5 — the same lines with each spread add-on split into what
  -- comes off the open plan rows and what is refunded in money.
  v_add_on_plan jsonb;
  v_plan_removed bigint := 0;
  v_removal_replay jsonb;
BEGIN
  -- I-PROPOSED-1278-ADMIN-GATE-FIRST: this remains the first executable
  -- statement, byte-for-byte equivalent to the approved service-role twin.
  IF auth.uid() IS NOT NULL AND NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  -- issue #3281 S5 — an order with spread add-ons locks its plan graph in the
  -- plan's own order (event, order, open rows) before the order row below.
  IF EXISTS (SELECT 1 FROM public.orders o
              WHERE o.id = p_order_id AND o.addon_payment_mode = 'spread') THEN
    PERFORM public.issue_4522_lock_order_graph(p_order_id);
  END IF;
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF p_reason IS NULL OR length(trim(p_reason)) < 10 OR length(trim(p_reason)) > 200 THEN
    RAISE EXCEPTION 'reason_invalid_length' USING ERRCODE = 'P0003';
  END IF;

  -- issue #3281 S4 — add-on lines ride p_lines, keyed order_add_on_line_item_id;
  -- the ticket lines below never see them.
  v_add_on_lines := public.issue_3281_add_on_refund_lines(
    p_order_id, public.issue_3281_split_refund_lines(p_lines, true));
  p_lines := public.issue_3281_split_refund_lines(p_lines, false);
  v_add_on_plan := public.issue_3281_add_on_plan_split(p_order_id, v_add_on_lines);

  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'order_line_item_id', line->>'order_line_item_id',
        'quantity', (line->>'quantity')::int,
        'amount_cents', (line->>'amount_cents')::int
      )
      ORDER BY
        line->>'order_line_item_id',
        (line->>'quantity')::int,
        (line->>'amount_cents')::int
    ),
    '[]'::jsonb
  )
  INTO v_client_lines
  FROM jsonb_array_elements(p_lines) AS line;

  -- Issue #3872 (F4): the refund amount is derived on the server from the
  -- order snapshot (quantity x order_line_items.unit_price_cents, the policy the
  -- Host app has always sent). A client-sent amount_cents is ignored; it is
  -- only logged below when it disagrees. Replays of a key minted before this
  -- change still match their stored client-shaped manifest.
  v_canonical_lines := public.issue_3872_refund_server_lines(p_order_id, p_lines);
  SELECT sum((l->>'amount_cents')::bigint) INTO v_client_amount_cents
  FROM jsonb_array_elements(v_client_lines) l;

  v_request_manifest := jsonb_build_object(
    'lines', v_canonical_lines,
    'reason', trim(p_reason),
    -- What the client sent, kept so a retry under the same key must repeat it.
    'client_lines', v_client_lines
  );
  IF v_add_on_lines IS NOT NULL THEN
    v_request_manifest := v_request_manifest || jsonb_build_object('add_on_lines', v_add_on_lines);
  END IF;
  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_order_id::text || ':' || p_idempotency_key, 0)
  );

  SELECT * INTO v_existing_refund
  FROM public.refunds
  WHERE metadata->>'idempotency_key' = p_idempotency_key
    AND order_id = p_order_id
  LIMIT 1;

  IF FOUND THEN
    v_stored_manifest := v_existing_refund.metadata->'refund_request_manifest';
    IF v_stored_manifest IS NULL
       OR (v_stored_manifest->'lines' IS DISTINCT FROM v_canonical_lines
           AND v_stored_manifest->'lines' IS DISTINCT FROM v_client_lines)
       -- A request that names amounts must repeat the amounts first sent under
       -- this key (same key, different body is still a mismatch, #1175).
       OR (v_stored_manifest ? 'client_lines'
           AND v_client_amount_cents IS NOT NULL
           AND v_stored_manifest->'client_lines' IS DISTINCT FROM v_client_lines)
       OR v_stored_manifest->'add_on_lines' IS DISTINCT FROM v_add_on_lines
       OR v_stored_manifest->>'reason' IS DISTINCT FROM trim(p_reason) THEN
      RAISE EXCEPTION 'idempotency_request_mismatch'
        USING ERRCODE = '23505';
    END IF;

    RETURN jsonb_build_object(
      'refund_id', v_existing_refund.id,
      'order_id', p_order_id,
      'amount_cents', v_existing_refund.amount_cents,
      'currency', v_existing_refund.currency,
      'stripe_payment_intent_id', v_order.stripe_payment_intent_id,
      'stripe_charge_id', v_order.stripe_charge_id,
      'application_fee_amount_cents', v_order.stripe_application_fee_amount_cents,
      'proposed_new_payment_status',
        v_stored_manifest->>'proposed_new_payment_status',
      'is_full_refund',
        (v_stored_manifest->>'is_full_refund')::boolean,
      'lines', v_stored_manifest->'lines',
      'reason', v_stored_manifest->>'reason',
      'idempotent_replay', true
    );
  END IF;

  -- issue #3281 S5 — a removal that moved no money replays from its ledger.
  SELECT pr.result, pr.request INTO v_removal_replay, v_stored_manifest
    FROM public.order_add_on_plan_removals pr
   WHERE pr.order_id = p_order_id AND pr.idempotency_key = p_idempotency_key
     AND pr.refund_id IS NULL
   ORDER BY pr.created_at, pr.id LIMIT 1;
  IF FOUND THEN
    IF v_stored_manifest IS DISTINCT FROM v_add_on_lines
       OR jsonb_array_length(v_canonical_lines) > 0 THEN
      RAISE EXCEPTION 'idempotency_request_mismatch' USING ERRCODE = '23505';
    END IF;
    RETURN v_removal_replay || jsonb_build_object('idempotent_replay', true);
  END IF;

  IF v_order.payment_status NOT IN ('paid', 'partial_refund') THEN
    RAISE EXCEPTION 'order_not_refundable: status=%', v_order.payment_status
      USING ERRCODE = 'P0002';
  END IF;

  FOR v_line IN SELECT * FROM jsonb_array_elements(v_canonical_lines) LOOP
    SELECT * INTO v_line_item
    FROM public.order_line_items
    WHERE id = (v_line->>'order_line_item_id')::uuid
      AND order_id = p_order_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'line_item_not_found: %',
        v_line->>'order_line_item_id' USING ERRCODE = 'P0004';
    END IF;

    SELECT COALESCE(SUM(rli.quantity), 0) INTO v_existing_refunded
    FROM public.refund_line_items rli
    JOIN public.refunds r ON r.id = rli.refund_id
    WHERE rli.order_line_item_id = v_line_item.id
      AND r.status IN ('pending', 'succeeded');

    IF COALESCE((v_line->>'quantity')::int, 0) <= 0 THEN
      RAISE EXCEPTION 'refund_amount_zero' USING ERRCODE = 'P0008';
    END IF;

    IF v_existing_refunded + (v_line->>'quantity')::int > v_line_item.quantity THEN
      RAISE EXCEPTION 'line_overrefund: line=% requested=% existing=% capacity=%',
        v_line_item.id, v_line->>'quantity', v_existing_refunded,
        v_line_item.quantity USING ERRCODE = 'P0005';
    END IF;

    v_refund_amount_cents :=
      v_refund_amount_cents + (v_line->>'amount_cents')::int;
  END LOOP;

  -- issue #3281 — returning the last tickets also returns the order's extras.
  v_refund_amount_cents := v_refund_amount_cents
    + public.issue_3281_add_on_refund_cents(p_order_id, v_canonical_lines, v_add_on_plan, true);

  -- issue #3281 S5 — only spread add-ons still on the plan: they come off the
  -- open rows and no money moves (nothing of them was collected).
  SELECT COALESCE(sum((l->>'removed_minor')::bigint), 0) INTO v_plan_removed
    FROM jsonb_array_elements(COALESCE(v_add_on_plan, '[]'::jsonb)) l;
  IF v_refund_amount_cents <= 0 AND v_plan_removed > 0
     AND jsonb_array_length(v_canonical_lines) = 0 THEN
    RETURN public.issue_3281_apply_plan_removals(p_order_id, v_add_on_plan, NULL,
      p_idempotency_key, v_caller, v_add_on_lines, trim(p_reason));
  END IF;

  IF v_refund_amount_cents <= 0 THEN
    RAISE EXCEPTION 'refund_amount_zero' USING ERRCODE = 'P0008';
  END IF;

  v_remaining_cents :=
    v_order.total_cents - COALESCE(v_order.refunded_amount_cents, 0);
  IF v_refund_amount_cents > v_remaining_cents THEN
    RAISE EXCEPTION 'refund_exceeds_remaining: requested=% remaining=%',
      v_refund_amount_cents, v_remaining_cents USING ERRCODE = 'P0009';
  END IF;

  INSERT INTO public.refunds (
    order_id, amount_cents, currency, reason, initiated_by, status,
    stripe_payment_intent_id, stripe_charge_id, metadata
  ) VALUES (
    p_order_id,
    v_refund_amount_cents,
    v_order.currency,
    trim(p_reason),
    v_caller,
    'pending',
    v_order.stripe_payment_intent_id,
    v_order.stripe_charge_id,
    jsonb_build_object(
      'idempotency_key', p_idempotency_key,
      'refund_request_manifest', v_request_manifest
    ) || CASE
      WHEN v_client_amount_cents IS NOT NULL
        AND v_client_amount_cents IS DISTINCT FROM v_refund_amount_cents::bigint
      THEN jsonb_build_object('issue_3872_client_reported', jsonb_build_object(
        'amount_cents', v_client_amount_cents,
        'lines', v_client_lines,
        'server_amount_cents', v_refund_amount_cents))
      ELSE '{}'::jsonb
    END
  ) RETURNING id INTO v_refund_id;

  PERFORM public.issue_3281_record_add_on_refund(v_refund_id, p_order_id, v_canonical_lines, v_add_on_plan);

  FOR v_line IN SELECT * FROM jsonb_array_elements(v_canonical_lines) LOOP
    INSERT INTO public.refund_line_items (
      refund_id, order_line_item_id, ticket_type_id, quantity, amount_cents
    )
    SELECT
      v_refund_id,
      (v_line->>'order_line_item_id')::uuid,
      oli.ticket_type_id,
      (v_line->>'quantity')::int,
      (v_line->>'amount_cents')::int
    FROM public.order_line_items oli
    WHERE oli.id = (v_line->>'order_line_item_id')::uuid
      -- issue #3281 S4 — a free ticket has nothing to refund: naming it returns
      -- it (status below), never a $0 row.
      AND ((v_line->>'amount_cents')::int > 0 OR NOT public.issue_3281_add_on_switch('free_parent_enabled'));
  END LOOP;

  SELECT NOT EXISTS (
    SELECT 1 FROM public.order_line_items oli
    WHERE oli.order_id = p_order_id
      AND oli.quantity > (
        SELECT COALESCE(SUM(rli.quantity), 0)
        FROM public.refund_line_items rli
        JOIN public.refunds r ON r.id = rli.refund_id
        WHERE rli.order_line_item_id = oli.id
          AND r.status IN ('pending', 'succeeded')
      )
      + CASE WHEN oli.unit_price_cents = 0 AND public.issue_3281_add_on_switch('free_parent_enabled')
          THEN COALESCE((SELECT SUM((l->>'quantity')::int) FROM jsonb_array_elements(v_canonical_lines) l
                          WHERE l->>'order_line_item_id' = oli.id::text), 0)
          ELSE 0 END
  ) AND public.issue_3281_add_ons_all_returned(p_order_id, false)
  INTO v_all_lines_fully_refunded;

  v_proposed_new_payment_status := CASE
    WHEN v_all_lines_fully_refunded THEN 'refunded'
    ELSE 'partial_refund'
  END;
  v_request_manifest := v_request_manifest || jsonb_build_object(
    'amount_cents', v_refund_amount_cents,
    'proposed_new_payment_status', v_proposed_new_payment_status,
    'is_full_refund', v_all_lines_fully_refunded
  );
  UPDATE public.refunds
  SET metadata = metadata ||
    jsonb_build_object('refund_request_manifest', v_request_manifest)
  WHERE id = v_refund_id;

  RETURN jsonb_build_object(
    'refund_id', v_refund_id,
    'order_id', p_order_id,
    'amount_cents', v_refund_amount_cents,
    'currency', v_order.currency,
    'stripe_payment_intent_id', v_order.stripe_payment_intent_id,
    'stripe_charge_id', v_order.stripe_charge_id,
    'application_fee_amount_cents', v_order.stripe_application_fee_amount_cents,
    'proposed_new_payment_status', v_proposed_new_payment_status,
    'is_full_refund', v_all_lines_fully_refunded,
    'lines', v_canonical_lines,
    'reason', trim(p_reason),
    'idempotent_replay', false
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_order_add_on_lines(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'id', item.id,
             'name', item.add_on_name_at_order,
             'quantity', item.quantity,
             'unit_price_cents', item.unit_price_cents,
             'total_cents', item.total_cents,
             'refunded_quantity', done.qty,
             'refunded_cents', done.cents)
           -- issue #3281 S5 — present only for an add-on spread over a plan.
           || CASE WHEN item.plan_choice = 'spread'
                THEN jsonb_build_object('plan_choice', 'spread') ELSE '{}'::jsonb END
           -- issue #3281 S5 — present only when a spread add-on came off the plan.
           || CASE WHEN public.issue_3281_add_on_removed_qty(item.id) > 0
                     OR public.issue_3281_add_on_removed_cents(item.id) > 0
                THEN jsonb_build_object(
                  'removed_quantity', public.issue_3281_add_on_removed_qty(item.id),
                  'removed_cents', public.issue_3281_add_on_removed_cents(item.id))
                ELSE '{}'::jsonb END
           ORDER BY item.created_at, item.id)
      FROM public.order_add_on_line_items item
      CROSS JOIN LATERAL (
        SELECT COALESCE(SUM(ra.quantity), 0)::integer AS qty,
               COALESCE(SUM(ra.amount_cents::bigint), 0) AS cents
          FROM public.refund_add_on_line_items ra
          JOIN public.refunds r ON r.id = ra.refund_id
         WHERE ra.order_add_on_line_item_id = item.id
           AND r.status IN ('pending', 'succeeded')
      ) done
     WHERE item.order_id = p_order_id), '[]'::jsonb);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.issue_3281_door_order_extras(p_actor_id uuid, p_event_id uuid, p_order_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_brand uuid;
  v_extras jsonb;
BEGIN
  IF COALESCE(cardinality(p_order_ids), 0) > 20 THEN
    RAISE EXCEPTION 'too_many_orders';
  END IF;

  -- The same door authority as the door search and its link labels.
  SELECT e.brand_id INTO v_brand
    FROM public.events e
   WHERE e.id = p_event_id
     AND e.deleted_at IS NULL;
  IF NOT FOUND OR NOT (
    public.issue_3827_can_door_scan(p_event_id, p_actor_id)
    OR public.biz_brand_effective_rank(v_brand, p_actor_id) >= public.biz_role_rank('event_manager')
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT COALESCE(jsonb_object_agg(x.order_id::text, x.items), '{}'::jsonb)
    INTO v_extras
    FROM (
      SELECT li.order_id,
             jsonb_agg(jsonb_build_object(
               'name', li.add_on_name_at_order,
               'quantity', owed.quantity,
               -- null when it is for every date of the event (a single-date
               -- event included), so the door never says "some days only"
               -- about an extra good on every day.
               'eventDateIds', CASE
                 WHEN li.day_scope_at_order IS NULL THEN NULL
                 WHEN NOT EXISTS (
                   SELECT 1 FROM public.event_dates d
                    WHERE d.event_id = p_event_id
                      AND (d.occurrence_key IS NULL
                        OR NOT d.occurrence_key = ANY (li.day_scope_at_order))
                 ) THEN NULL
                 ELSE to_jsonb(ARRAY(
                   SELECT d.id FROM public.event_dates d
                    WHERE d.event_id = p_event_id
                      AND d.occurrence_key = ANY (li.day_scope_at_order)
                    ORDER BY d.start_at, d.id))
               END
             ) ORDER BY li.add_on_name_at_order, li.id) AS items
        FROM public.order_add_on_line_items li
        JOIN public.orders o ON o.id = li.order_id
        CROSS JOIN LATERAL (
          SELECT li.quantity - COALESCE((
            SELECT SUM(rli.quantity)
              FROM public.refund_add_on_line_items rli
              JOIN public.refunds r ON r.id = rli.refund_id
             WHERE rli.order_add_on_line_item_id = li.id
               AND r.status IN ('pending', 'succeeded')
          ), 0)::integer
          -- issue #3281 S5 — an add-on taken off the plan is not owed at the door.
          - public.issue_3281_add_on_removed_qty(li.id) AS quantity
        ) owed
       WHERE o.event_id = p_event_id
         AND o.payment_status IN ('paid', 'partial_refund')
         AND li.order_id = ANY (COALESCE(p_order_ids, '{}'::uuid[]))
         AND owed.quantity > 0
       GROUP BY li.order_id
    ) x;

  RETURN v_extras;
END;
$function$
;

-- ---------------------------------------------------------------------------
-- 4. S1 deferrals: links are the one truth for these writers and readers.
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
    plan_choice, parent_kind
  )
  SELECT v_order_id, ticket_add_on_id, ticket_type_id, add_on_name_at_purchase,
         ticket_type_name_at_purchase, day_scope, quantity, unit_price_cents, total_cents,
         -- issue #4522 / #3281 §9 — the add-on choice on a v2 plan.
         plan_choice,
         -- issue #3281 S5 (S1 deferral) — the parent the session held it with.
         parent_kind
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
$function$
;

CREATE OR REPLACE FUNCTION public.issue_1930_ticket_session_authorized(p_session_id uuid, p_event_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
DECLARE
  v_event public.events%ROWTYPE; v_bad boolean;
  v_session public.ticket_checkout_sessions%ROWTYPE; v_decision text;
  v_per_occurrence boolean; -- issue #3313
BEGIN
  SELECT * INTO v_event FROM public.events WHERE id=p_event_id;
  IF public.issue_1930_event_sale_reason(v_event) <> 'sellable' THEN RETURN false; END IF;
  -- #2101 — the sole decision owner, consuming this session's snapshots. It
  -- takes event -> brand in the canonical order before any lower-order row.
  SELECT * INTO v_session FROM public.ticket_checkout_sessions
    WHERE id=p_session_id AND event_id=p_event_id;
  IF NOT FOUND THEN RETURN false; END IF;
  v_decision := public.issue_2101_ticket_checkout_access_decision(
    p_event_id, v_session.buyer_user_id,
    v_session.checkout_access_mode_snapshot,
    v_session.checkout_access_restrictive_epoch_snapshot,
    v_session.checkout_access_membership_id_snapshot,
    v_session.checkout_access_membership_epoch_snapshot);
  IF v_decision NOT IN ('allowed_unrestricted','allowed_named') THEN RETURN false; END IF;
  v_per_occurrence := COALESCE(
    (public.issue_3313_event_day_choice(p_event_id) ->> 'perOccurrenceCapacity')::boolean, false);
  IF NOT EXISTS(SELECT 1 FROM public.ticket_checkout_sessions s
    WHERE s.id=p_session_id AND s.event_id=p_event_id AND s.revoked_at IS NULL
      AND s.status IN ('pending_free','requires_payment','processing_payment','awaiting_web_redirect'))
  THEN RETURN false; END IF;
  -- issue #4271 — a pay code's checkout is payable only while its code is.
  IF v_session.door_pay_code_id IS NOT NULL
     AND NOT public.issue_4271_door_session_payable(p_session_id) THEN
    RETURN false;
  END IF;
  SELECT EXISTS(
    SELECT 1 FROM public.ticket_checkout_session_items i
    LEFT JOIN public.ticket_types tt ON tt.id=i.ticket_type_id AND tt.event_id=p_event_id
    WHERE i.checkout_session_id=p_session_id AND (
      tt.id IS NULL OR tt.deleted_at IS NOT NULL OR tt.is_hidden OR tt.is_disabled
      -- issue #4271 — a door-only tier passes only inside its own code's session.
      OR (NOT tt.available_online
        AND NOT public.issue_4271_door_code_allows_tier(v_session.door_pay_code_id, tt.id))
      OR (tt.sale_start_at IS NOT NULL AND tt.sale_start_at > now())
      OR (tt.sale_end_at IS NOT NULL AND tt.sale_end_at <= now())
      -- issue #3313 — a recurring event's capacity is PER NIGHT, so the
      -- finalize-time re-check measures each of this session's nights (every
      -- upcoming night when it has none): everyone else's sold + held places
      -- that night, plus this session's own places that night. The shared
      -- whole-run check below stays for every other event. DELETE THIS and a
      -- second night's buyer is authorised at reserve and refused at finalize.
      -- issue #3281 — a day-limited ticket is measured per date, on its dates.
      OR ((v_per_occurrence OR tt.valid_occurrence_keys IS NOT NULL)
        AND NOT tt.is_unlimited AND tt.quantity_total IS NOT NULL
        AND EXISTS (
          SELECT 1
            FROM public.event_dates night
           WHERE night.event_id = p_event_id
             AND (tt.valid_occurrence_keys IS NULL
               OR night.occurrence_key = ANY (tt.valid_occurrence_keys))
             AND (
               EXISTS (SELECT 1 FROM public.ticket_checkout_session_event_dates sd
                        WHERE sd.checkout_session_id = p_session_id AND sd.event_date_id = night.id)
               OR (NOT EXISTS (SELECT 1 FROM public.ticket_checkout_session_event_dates sd
                                WHERE sd.checkout_session_id = p_session_id)
                   AND night.end_at > now())
             )
             AND public.issue_3313_ticket_type_occurrence_taken(tt.id, night.id, p_session_id)
                 + CASE
                     WHEN jsonb_typeof(i.by_date) = 'object'
                       THEN COALESCE((i.by_date ->> night.id::text)::integer, 0)
                     WHEN COALESCE(v_session.multi_date_pricing_mode_snapshot, 'per_day') = 'per_day'
                          AND (SELECT count(*) FROM public.ticket_checkout_session_event_dates sd
                                WHERE sd.checkout_session_id = p_session_id) > 0
                       THEN i.quantity / (SELECT count(*) FROM public.ticket_checkout_session_event_dates sd
                                           WHERE sd.checkout_session_id = p_session_id)
                     ELSE i.quantity
                   END
                 > tt.quantity_total
        ))
      OR (NOT v_per_occurrence AND tt.valid_occurrence_keys IS NULL
        AND NOT tt.is_unlimited AND tt.quantity_total IS NOT NULL AND
        (SELECT count(*) FROM public.tickets sold
          WHERE sold.ticket_type_id=tt.id
            AND sold.status IN ('valid','used','transferred'))
        + (SELECT COALESCE(sum(reserved.quantity),0) FROM public.ticket_checkout_session_items reserved
            JOIN public.ticket_checkout_sessions active
              ON active.id=reserved.checkout_session_id
          WHERE reserved.ticket_type_id=tt.id
            AND active.id<>p_session_id
            AND active.expires_at>now()
            AND active.order_id IS NULL
            AND active.revoked_at IS NULL
            AND active.status IN ('pending_free','requires_payment','processing_payment','awaiting_web_redirect'))
        + i.quantity > tt.quantity_total)
    )
  ) INTO v_bad;
  IF v_bad THEN RETURN false; END IF;
  -- issue #3281 — every extra this session holds is still on sale and still
  -- fits, measured per date for a date-limited extra.
  -- issue #3281 S5 (S1 deferral) — one add-on held with two tickets is one
  -- stock count: the session's holds are summed per add-on (and per date).
  IF EXISTS (
    SELECT 1
      FROM (SELECT x.ticket_add_on_id, sum(x.quantity) AS quantity
              FROM public.ticket_checkout_session_add_on_items x
             WHERE x.checkout_session_id = p_session_id
             GROUP BY x.ticket_add_on_id) held
      LEFT JOIN public.ticket_add_ons a ON a.id = held.ticket_add_on_id
     WHERE (a.id IS NULL OR NOT a.is_active
         OR (NOT a.is_unlimited AND (
           (a.valid_occurrence_keys IS NULL
             AND public.issue_3281_add_on_taken(a.id, NULL, p_session_id) + held.quantity > a.quantity_total)
           OR (a.valid_occurrence_keys IS NOT NULL AND EXISTS (
             SELECT 1
               FROM (SELECT k, sum(x2.quantity) AS quantity
                       FROM public.ticket_checkout_session_add_on_items x2
                       CROSS JOIN LATERAL unnest(x2.day_scope) AS k
                      WHERE x2.checkout_session_id = p_session_id
                        AND x2.ticket_add_on_id = a.id
                      GROUP BY k) per_day
              WHERE public.issue_3281_add_on_taken(a.id, per_day.k, p_session_id) + per_day.quantity > a.quantity_total))
         )))
  ) THEN RETURN false; END IF;
  IF EXISTS(SELECT 1 FROM public.ticket_checkout_sessions s
    WHERE s.id=p_session_id AND (s.metadata->>'event_date_id') IS NOT NULL
      AND NOT EXISTS(SELECT 1 FROM public.event_dates d
        WHERE d.id=(s.metadata->>'event_date_id')::uuid AND d.event_id=p_event_id
          AND d.end_at > now() AND d.status = 'active')) THEN RETURN false; END IF;  -- issue #3281
  -- ══ issue #2160 — RE-VALIDATE **EVERY** CHOSEN DAY, NOT JUST THE ANCHOR ══
  -- The clause above re-checks only `metadata->>'event_date_id'`, which under
  -- #2160 is the ANCHOR (the latest-ENDING day). Without the clause below a
  -- stale NON-anchor day could still mint an entitlement at finalize for an
  -- occurrence that has already ended — the guest gets a pass for a day that
  -- is over, and the scanner correctly refuses them at a door they paid for.
  --
  -- DELETE THIS BLOCK and a session that sat in the cart across the end of
  -- day 1 finalizes into a day-1 pass.
  IF EXISTS(SELECT 1 FROM public.ticket_checkout_session_event_dates i
             WHERE i.checkout_session_id=p_session_id
               AND NOT EXISTS(SELECT 1 FROM public.event_dates d
                 WHERE d.id=i.event_date_id AND d.event_id=p_event_id
                   AND d.end_at > now() AND d.status = 'active')) THEN RETURN false; END IF;  -- issue #3281
  -- issue #3281: a checkout with no date of its own (a single-date event,
  -- or one opened before a cancel) cannot complete once the event has no
  -- active upcoming date and a date was cancelled. The cancelled date is
  -- matched whenever it was, so the refusal does not lapse when its
  -- original end time passes.
  IF NOT EXISTS(SELECT 1 FROM public.ticket_checkout_session_event_dates i
                 WHERE i.checkout_session_id=p_session_id)
     AND (v_session.metadata->>'event_date_id') IS NULL
     AND NOT EXISTS(SELECT 1 FROM public.event_dates d
                     WHERE d.event_id=p_event_id AND d.end_at > now() AND d.status = 'active')
     AND EXISTS(SELECT 1 FROM public.event_dates d
                 WHERE d.event_id=p_event_id AND d.status <> 'active')
  THEN RETURN false; END IF;
  RETURN true;
END $function$
;

CREATE OR REPLACE FUNCTION public.issue_3281_strip_removed_days(p_event_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_ticket record;
  v_kept text[];
  v_extra record; -- issue #3281
BEGIN
  -- issue #3281: business_update_live_event_atomic writes the dates, then
  -- the tickets, then strips once (so a ticket moved off a removed date is
  -- judged on its new list). A direct when-save still strips here.
  IF current_setting('mingla.issue_3281_defer_day_strip', true) = 'on' THEN
    RETURN;
  END IF;
  FOR v_ticket IN
    SELECT tt.id, tt.valid_occurrence_keys
      FROM public.ticket_types tt
     WHERE tt.event_id = p_event_id AND tt.deleted_at IS NULL
       AND tt.valid_occurrence_keys IS NOT NULL
     ORDER BY tt.id
       FOR UPDATE
  LOOP
    SELECT array_agg(d.occurrence_key ORDER BY d.occurrence_key) INTO v_kept
      FROM public.event_dates d
     WHERE d.event_id = p_event_id
       AND d.occurrence_key = ANY (v_ticket.valid_occurrence_keys);
    IF v_kept IS NULL THEN RAISE EXCEPTION 'tier_day_scope_empty'; END IF;
    IF cardinality(v_kept) <> cardinality(v_ticket.valid_occurrence_keys) THEN
      UPDATE public.ticket_types SET valid_occurrence_keys = v_kept, updated_at = now()
       WHERE id = v_ticket.id;
    END IF;
  END LOOP;
  -- issue #3281 — extras follow the same rule as their tiers.
  FOR v_extra IN
    SELECT a.id, a.valid_occurrence_keys
      FROM public.ticket_add_ons a
     -- issue #3281 S5 (S1 deferral) — the offering owns the add-on; a live
     -- ticket link keeps it in scope.
     WHERE a.event_id = p_event_id
       AND EXISTS (SELECT 1 FROM public.ticket_add_on_links l
                     JOIN public.ticket_types tt ON tt.id = l.ticket_type_id
                    WHERE l.add_on_id = a.id AND tt.deleted_at IS NULL)
       AND a.is_active AND a.valid_occurrence_keys IS NOT NULL
     ORDER BY a.id
       FOR UPDATE OF a
  LOOP
    SELECT array_agg(d.occurrence_key ORDER BY d.occurrence_key) INTO v_kept
      FROM public.event_dates d
     WHERE d.event_id = p_event_id
       AND d.occurrence_key = ANY (v_extra.valid_occurrence_keys);
    IF v_kept IS NULL THEN RAISE EXCEPTION 'extra_day_scope_empty'; END IF;
    IF cardinality(v_kept) <> cardinality(v_extra.valid_occurrence_keys) THEN
      UPDATE public.ticket_add_ons SET valid_occurrence_keys = v_kept, updated_at = now()
       WHERE id = v_extra.id;
    END IF;
  END LOOP;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.issue_3281_publish_tier_extras(p_ticket_type_id uuid, p_tier jsonb, p_when_mode text, p_multi_dates jsonb, p_tier_keys text[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_extra jsonb;
  v_order bigint;
  v_keys text[];
  v_add_on_id uuid;
BEGIN
  IF NOT (p_tier ? 'extras') OR jsonb_typeof(p_tier->'extras') = 'null' THEN RETURN; END IF;
  FOR v_extra, v_order IN
    SELECT value, ordinality FROM jsonb_array_elements(public.issue_3281_normalize_tier_extras(
      p_tier->'extras', COALESCE((p_tier->>'isFree')::boolean, false))) WITH ORDINALITY
  LOOP
    -- A draft date deleted after the extra was set up leaves its list here; an
    -- extra that loses every date is refused rather than widened.
    IF jsonb_typeof(v_extra->'validDayIds') = 'array' AND p_when_mode = 'multi_date' THEN
      v_extra := jsonb_set(v_extra, '{validDayIds}', COALESCE((
        SELECT jsonb_agg(k.value) FROM jsonb_array_elements(v_extra->'validDayIds') k
         WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(p_multi_dates) e WHERE e->'id' = k.value)
      ), '[]'::jsonb));
      IF jsonb_array_length(v_extra->'validDayIds') = 0 THEN
        RAISE EXCEPTION 'extra_day_scope_empty';
      END IF;
    END IF;
    v_keys := public.issue_3281_draft_ticket_scope(v_extra, p_when_mode, p_multi_dates);
    PERFORM public.issue_3281_assert_extra_days_in_tier(v_keys, p_tier_keys);
    -- issue #3281 S5 (S1 deferral) — the offering owns the add-on and this
    -- writer names its link itself; ticket_type_id stays [TRANSITIONAL] (S8).
    INSERT INTO public.ticket_add_ons (
      event_id, ticket_type_id, name, description, price_cents, quantity_total, is_unlimited,
      max_per_ticket, sort_order, valid_occurrence_keys
    ) VALUES (
      (SELECT tt.event_id FROM public.ticket_types tt WHERE tt.id = p_ticket_type_id),
      p_ticket_type_id, v_extra->>'name', v_extra->>'description',
      round((v_extra->>'priceGbp')::numeric * 100)::integer,
      NULLIF(v_extra->>'capacity', '')::integer, (v_extra->>'isUnlimited')::boolean,
      (v_extra->>'maxPerTicket')::integer, v_order::integer - 1, v_keys)
    RETURNING id INTO v_add_on_id;
    INSERT INTO public.ticket_add_on_links (add_on_id, event_id, target_kind, ticket_type_id)
    SELECT v_add_on_id, tt.event_id, 'ticket_type', tt.id
      FROM public.ticket_types tt WHERE tt.id = p_ticket_type_id
    ON CONFLICT (add_on_id, ticket_type_id) DO NOTHING;
  END LOOP;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.business_update_live_event_atomic(p_event_id uuid, p_patch jsonb, p_reason text, p_client_revision integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_core jsonb:=COALESCE(p_patch->'core','{}'::jsonb);
  v_core_without_tickets jsonb:=COALESCE(p_patch->'core','{}'::jsonb)-'tickets';
  v_taxonomy jsonb:=p_patch->'taxonomy';
  v_when jsonb:=p_patch->'when';
  v_cover jsonb:=p_patch->'cover';
  v_selection public.event_cover_selections%ROWTYPE;
  v_event public.events%ROWTYPE;
  v_tickets jsonb;
  v_item jsonb;
  v_mode text;
  v_timezone text;
  v_local_when jsonb;
  v_pricing_patch jsonb:='{}'::jsonb;
  v_reason text;   -- issue #3827
  v_notice jsonb;  -- issue #3827 buyer email
  v_keys_before text[];   -- issue #3281
  v_removed_keys text[];  -- issue #3281
  v_ticket_patch jsonb;   -- issue #3281
BEGIN
  -- issue #3827 — a reason is owed to BUYERS. With none, a blank reason is
  -- recorded as the stated constant; with one or more it is still refused.
  -- The core, tier and when leaves below are unchanged and still validate
  -- what they are handed, which is now the resolved reason.
  v_reason:=public.business_resolve_edit_reason(p_event_id,p_reason);
  IF v_reason IS NULL THEN RAISE EXCEPTION 'invalid_edit_reason';END IF;
  IF v_core ? 'visibility'
     AND COALESCE(v_core->>'visibility','') NOT IN('public','unlisted','private') THEN
    RAISE EXCEPTION 'event_visibility_invalid';
  END IF;
  PERFORM public.business_update_live_event(
    p_event_id,v_core_without_tickets,v_reason,p_client_revision   -- issue #3827
  );
  IF v_taxonomy IS NOT NULL THEN
    PERFORM public.business_patch_event_taxonomy_with_place(
      p_event_id,
      v_taxonomy->>'city',
      ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_taxonomy->'partyTypes','[]'::jsonb))),
      ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_taxonomy->'vibeTags','[]'::jsonb))),
      ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_taxonomy->'musicGenres','[]'::jsonb))),
      NULLIF(v_taxonomy#>>'{locationGeo,lat}','')::numeric,
      NULLIF(v_taxonomy#>>'{locationGeo,lng}','')::numeric,
      NULLIF(v_taxonomy->>'locationText',''),
      COALESCE(v_taxonomy->>'coordinatePrecision',''),
      NULLIF(btrim(COALESCE(v_taxonomy->>'locationProviderPlaceId','')),'')
    );
  END IF;

  IF v_when IS NOT NULL THEN
    v_mode:=COALESCE(NULLIF(v_when->>'whenMode',''),'single');
    v_timezone:=COALESCE(NULLIF(v_when->>'timezone',''),
      (SELECT timezone FROM public.events WHERE id=p_event_id),'UTC');
    IF v_mode IN('single','recurring') THEN
      v_local_when:=v_when->'when';
      PERFORM public.business_resolve_event_local_datetime(
        v_local_when->>'date',COALESCE(NULLIF(v_local_when->>'doorsOpen',''),'00:00'),v_timezone
      );
      PERFORM public.business_resolve_event_local_datetime(
        v_local_when->>'date',COALESCE(NULLIF(v_local_when->>'endsAt',''),
          COALESCE(NULLIF(v_local_when->>'doorsOpen',''),'00:00')),v_timezone
      );
    ELSIF v_mode='multi_date' THEN
      FOR v_item IN SELECT value FROM jsonb_array_elements(COALESCE(v_when->'multiDates','[]'::jsonb)) LOOP
        PERFORM public.business_resolve_event_local_datetime(
          v_item->>'date',COALESCE(NULLIF(v_item->>'startTime',''),'00:00'),v_timezone
        );
        PERFORM public.business_resolve_event_local_datetime(
          v_item->>'date',COALESCE(NULLIF(v_item->>'endTime',''),
            COALESCE(NULLIF(v_item->>'startTime',''),'00:00')),v_timezone
        );
      END LOOP;
    END IF;
    -- issue #3281: dates first, so a ticket or extra in this same save can
    -- name a date the save adds. Removed dates are stripped from ticket and
    -- extra lists once the tickets are written (below), so a ticket moved
    -- off a removed date is judged on its new list, not its old one.
    PERFORM set_config('mingla.issue_3281_defer_day_strip','on',true);
    -- issue #3281: the keys of the dates this save removes (before minus after).
    SELECT COALESCE(array_agg(d.occurrence_key),'{}'::text[]) INTO v_keys_before
      FROM public.event_dates d
     WHERE d.event_id=p_event_id AND d.occurrence_key IS NOT NULL;
    PERFORM public.business_patch_event_when(
      p_event_id,v_when,v_reason,p_client_revision   -- issue #3827
    );
    PERFORM set_config('mingla.issue_3281_defer_day_strip','',true);
    v_removed_keys:=ARRAY(
      SELECT k FROM unnest(v_keys_before) k
       WHERE NOT EXISTS (SELECT 1 FROM public.event_dates d
                          WHERE d.event_id=p_event_id AND d.occurrence_key=k));
  END IF;

  IF v_core ? 'tickets' THEN
    v_ticket_patch:=v_core->'tickets';
    -- issue #3281: a ticket or extra sent with a date this save removed (the
    -- Host trims tickets' lists, never extras') drops that date, the way the
    -- publish path drops a deleted draft date. Only removed dates are dropped:
    -- an unknown date is still refused, and a list left empty is refused
    -- (*_scope_empty), never widened to every date. Kept extras that are not
    -- sent lose a removed date here too, so they still fit their ticket.
    IF v_mode='multi_date' AND COALESCE(cardinality(v_removed_keys),0)>0
       AND jsonb_typeof(v_ticket_patch)='array' THEN
      SELECT COALESCE(jsonb_agg(
          (CASE WHEN jsonb_typeof(t.value->'validDayIds')='array'
                THEN jsonb_set(t.value,'{validDayIds}',COALESCE((
                  SELECT jsonb_agg(k.value ORDER BY k.n)
                    FROM jsonb_array_elements(t.value->'validDayIds') WITH ORDINALITY k(value,n)
                   WHERE NOT ((k.value#>>'{}') = ANY (v_removed_keys))),'[]'::jsonb))
                ELSE t.value END)
          || CASE WHEN jsonb_typeof(t.value->'extras')='array'
               THEN jsonb_build_object('extras',(
                 SELECT COALESCE(jsonb_agg((CASE WHEN jsonb_typeof(x.value->'validDayIds')='array'
                THEN jsonb_set(x.value,'{validDayIds}',COALESCE((
                  SELECT jsonb_agg(k.value ORDER BY k.n)
                    FROM jsonb_array_elements(x.value->'validDayIds') WITH ORDINALITY k(value,n)
                   WHERE NOT ((k.value#>>'{}') = ANY (v_removed_keys))),'[]'::jsonb))
                ELSE x.value END) ORDER BY x.n),'[]'::jsonb)
                   FROM jsonb_array_elements(t.value->'extras') WITH ORDINALITY x(value,n)))
               ELSE '{}'::jsonb END
          ORDER BY t.n),'[]'::jsonb)
        INTO v_ticket_patch
        FROM jsonb_array_elements(v_ticket_patch) WITH ORDINALITY t(value,n);
      UPDATE public.ticket_add_ons a
         SET valid_occurrence_keys=ARRAY(
               SELECT k FROM unnest(a.valid_occurrence_keys) k
                WHERE NOT (k = ANY (v_removed_keys)) ORDER BY k),
             updated_at=now()
       -- issue #3281 S5 (S1 deferral) — the offering owns its add-ons.
       WHERE a.event_id=p_event_id
         AND a.valid_occurrence_keys && v_removed_keys
         AND EXISTS (SELECT 1 FROM unnest(a.valid_occurrence_keys) k
                      WHERE NOT (k = ANY (v_removed_keys)));
    END IF;
    PERFORM public.business_patch_event_ticket_tiers(
      p_event_id,v_ticket_patch,NULL,NULL,NULL,v_reason   -- issue #3827
    );
  END IF;

  IF v_when IS NOT NULL THEN
    -- issue #3281: the strip business_patch_event_when deferred. A list left
    -- with no date is refused (tier_day_scope_empty), never widened.
    PERFORM public.issue_3281_strip_removed_days(p_event_id);
    -- issue #3281: business_patch_event_when judged offering_date_past on
    -- the tickets stored before this save. Judge it again on the tickets
    -- this save wrote, so a save that makes a ticket paid cannot also move
    -- every date into the past.
    IF EXISTS (SELECT 1 FROM public.ticket_types t
                WHERE t.event_id=p_event_id AND t.deleted_at IS NULL
                  AND t.available_online=true AND t.price_cents>0)
       AND COALESCE((SELECT max(ed.end_at) FROM public.event_dates ed
                      WHERE ed.event_id=p_event_id),'-infinity'::timestamptz)<=now() THEN
      RAISE EXCEPTION 'offering_date_past';
    END IF;
  END IF;

  IF p_patch ? 'theme' THEN
    UPDATE public.events SET
      theme_color_override=NULLIF(p_patch#>>'{theme,color}',''),
      theme_font_override=NULLIF(p_patch#>>'{theme,font}',''),
      theme_animation_override=NULLIF(p_patch#>>'{theme,animation}',''),
      theme_gradient_override=NULLIF(p_patch#>>'{theme,gradient}',''),
      updated_at=now()
    WHERE id=p_event_id;
  END IF;

  IF p_patch ? 'pricing' THEN
    IF p_patch->'pricing' ? 'passTax' THEN
      v_pricing_patch:=v_pricing_patch || jsonb_build_object('pass_tax',p_patch#>'{pricing,passTax}');
    END IF;
    IF p_patch->'pricing' ? 'passMinglaFee' THEN
      v_pricing_patch:=v_pricing_patch || jsonb_build_object('pass_mingla_fee',p_patch#>'{pricing,passMinglaFee}');
    END IF;
    IF p_patch->'pricing' ? 'passServiceFee' THEN
      v_pricing_patch:=v_pricing_patch || jsonb_build_object('pass_service_fee',p_patch#>'{pricing,passServiceFee}');
    END IF;
    PERFORM public.business_patch_pricing_switches(p_event_id,v_pricing_patch);
  END IF;

  IF v_cover IS NOT NULL THEN
    IF COALESCE((v_cover->>'clear')::boolean,false) THEN
      PERFORM public.business_clear_event_cover_media(p_event_id);
    ELSE
      SELECT * INTO v_selection FROM public.event_cover_selections
      WHERE selection_ref=v_cover->>'selectionRef'
        AND user_id=auth.uid() AND event_id=p_event_id
        AND consumed_at IS NULL AND expires_at>now() FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'cover_selection_unverified';END IF;
      PERFORM public.business_set_event_cover_media(
        p_event_id,v_selection.selection_ref,v_selection.media_url,
        v_selection.media_type,v_selection.poster_url,v_selection.provider,
        v_selection.source_url,v_selection.credit,v_selection.credit_url,
        v_selection.alt
      );
    END IF;
  END IF;

  -- issue #3288 — the additional photos. AFTER the cover block, so a save that
  -- removes the cover and edits the gallery keeps the new gallery. The caller
  -- is already authenticated, role-checked and revision-checked by
  -- business_update_live_event above; the column CHECK enforces the array shape.
  IF p_patch ? 'gallery' THEN
    UPDATE public.events SET
      cover_media_gallery=COALESCE(p_patch->'gallery','[]'::jsonb),
      updated_at=now()
    WHERE id=p_event_id;
  END IF;

  SELECT * INTO v_event FROM public.events WHERE id=p_event_id;
  -- issue #3281 — with each tier's extras, so the editor keeps them.
  SELECT COALESCE(jsonb_agg(to_jsonb(tt)||jsonb_build_object('extras',public.issue_3281_tier_extras_json(tt.id))
      ORDER BY tt.display_order,tt.created_at),'[]'::jsonb)
    INTO v_tickets FROM public.ticket_types tt
    WHERE tt.event_id=p_event_id AND tt.deleted_at IS NULL;
  -- issue #3827 buyer email — every write above is done. Record this edit
  -- (who, why, what changed) and decide whether buyers are emailed. A save
  -- made with "refund all and proceed" holds the email. Never raises.
  v_notice:=public.event_edit_notice_flush(
    p_event_id,v_reason,'event',
    COALESCE((v_when->>'acknowledgeSoldImpact')::boolean,false)
  );
  RETURN jsonb_build_object(
    'event',public.issue_4420_event_json_for_caller(to_jsonb(v_event)),'tickets',v_tickets,
    'client_revision',p_client_revision,
    'buyer_notice',v_notice   -- issue #3827 buyer email
  );
END;$function$
;

COMMIT;
