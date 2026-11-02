-- issue #3281 — Extras, slice 2: the checkout prices, holds and records extras.
--
-- Nothing can author an extra until slice 3, so no cart carries one yet. A cart
-- without extras takes exactly the paths it takes today: every helper below
-- returns an empty result for it and every re-emitted body adds zero.
--
-- How an extra reaches checkout: on its ticket's cart line, as
-- `addOns: [{ addOnId, quantity }]`. Lines still never split, so no RPC
-- signature changes and every reader of `p_lines` keeps working.
--
-- Re-emitted from their terminal bodies, with only the marked #3281 changes:
--   issue_3872_ticket_quote from 20280228003281_issue_3281_day_limited_tickets.sql
--   issue_1930_ticket_checkout_create_session_base from 20280228003281_issue_3281_day_limited_tickets.sql
--   biz_ticket_checkout_create_session from 20271216013872_issue_3872_r1_ticket_checkout.sql
--   issue_1930_ticket_checkout_finalize_base from 20280228003281_issue_3281_day_limited_tickets.sql
--   issue_1930_ticket_session_authorized from 20280228003281_issue_3281_day_limited_tickets.sql
--   issue_3859_bind_checkout_contract from 20280217003281_issue_3281_production_order_repair.sql
--   biz_refund_order_commit_from_webhook from 20280305003281_issue_3281_webhook_fee_unknown.sql
--
-- Rules, from the approved design (#3283) and the slice 2 defaults on #3281:
--   * The server prices every extra; the request only names it.
--   * An extra belongs to its ticket type and is capped at
--     max_per_ticket x that ticket's quantity in the cart.
--   * Discounts never apply to extras. They are priced after the discount engine.
--   * A date-limited extra is sold only on chosen dates it covers, and its
--     capacity counts per date. An all-dates extra keeps one shared count.
--   * Capacity is locked, aggregated and held like tickets: the add-on rows are
--     locked in id order, and an open session's extras hold their places.
--   * Refused for now: extras on an instalment plan, and paid extras when every
--     ticket is free. The refund paths don't cover those order shapes yet.
--   * The order records its extras at finalize, on both payment rails.
--   * A dashboard refund that completes the charge also records the extras.

BEGIN;

CREATE TABLE public.ticket_checkout_session_add_on_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checkout_session_id uuid NOT NULL
    REFERENCES public.ticket_checkout_sessions(id) ON DELETE CASCADE,
  -- RESTRICT: a held or paid-for extra must never vanish from its session.
  ticket_add_on_id uuid NOT NULL REFERENCES public.ticket_add_ons(id) ON DELETE RESTRICT,
  ticket_type_id uuid NOT NULL REFERENCES public.ticket_types(id) ON DELETE RESTRICT,
  add_on_name_at_purchase text NOT NULL,
  ticket_type_name_at_purchase text NOT NULL,
  day_scope text[],
  quantity integer NOT NULL,
  unit_price_cents integer NOT NULL,
  total_cents integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ticket_checkout_session_add_on_items_one_per_extra
    UNIQUE (checkout_session_id, ticket_add_on_id),
  CONSTRAINT ticket_checkout_session_add_on_items_quantity_positive CHECK (quantity > 0),
  CONSTRAINT ticket_checkout_session_add_on_items_price_not_negative CHECK (unit_price_cents >= 0),
  CONSTRAINT ticket_checkout_session_add_on_items_line_arith
    CHECK (total_cents = quantity * unit_price_cents)
);
CREATE INDEX idx_ticket_checkout_session_add_on_items_add_on
  ON public.ticket_checkout_session_add_on_items (ticket_add_on_id);
CREATE INDEX idx_order_add_on_line_items_add_on
  ON public.order_add_on_line_items (ticket_add_on_id);
ALTER TABLE public.ticket_checkout_session_add_on_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ticket_checkout_session_add_on_items FROM PUBLIC, anon, authenticated;

-- Places an extra has taken: sold on live orders plus held by open sessions.
-- With a date key, only rows covering that date count.
CREATE FUNCTION public.issue_3281_add_on_taken(
  p_add_on_id uuid, p_occurrence_key text, p_exclude_session uuid
) RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT (
    SELECT COALESCE(SUM(li.quantity), 0)
      FROM public.order_add_on_line_items li
      JOIN public.orders o ON o.id = li.order_id
     WHERE li.ticket_add_on_id = p_add_on_id
       AND o.payment_status IN ('pending', 'paid', 'partial_refund')
       AND (p_occurrence_key IS NULL OR p_occurrence_key = ANY (li.day_scope_at_order))
  )::integer + (
    SELECT COALESCE(SUM(si.quantity), 0)
      FROM public.ticket_checkout_session_add_on_items si
      JOIN public.ticket_checkout_sessions s ON s.id = si.checkout_session_id
     WHERE si.ticket_add_on_id = p_add_on_id
       AND s.id IS DISTINCT FROM p_exclude_session
       AND s.expires_at > now()
       AND s.order_id IS NULL
       AND s.revoked_at IS NULL
       AND s.status IN ('pending_free', 'requires_payment', 'processing_payment', 'awaiting_web_redirect')
       AND (p_occurrence_key IS NULL OR p_occurrence_key = ANY (si.day_scope))
  )::integer;
$fn$;

-- Prices the extras on a cart's lines. The quote calls it without locks; the
-- session calls it with locks, inside the transaction that holds the places.
CREATE FUNCTION public.issue_3281_price_extras(
  p_event_id uuid, p_lines jsonb, p_day_ids uuid[], p_lock boolean
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_line jsonb;
  v_req jsonb;
  v_ids uuid[] := '{}'::uuid[];
  v_add_on public.ticket_add_ons%ROWTYPE;
  v_ticket public.ticket_types%ROWTYPE;
  v_qty integer;
  v_parent integer;
  v_line_days uuid[];
  v_keys text[];
  v_key text;
  v_items jsonb := '[]'::jsonb;
  v_total integer := 0;
BEGIN
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' THEN
    RETURN jsonb_build_object('items', v_items, 'totalCents', 0);
  END IF;
  -- Shape first: one entry per extra, each a known id and a whole quantity.
  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
    IF NOT (v_line ? 'addOns') OR v_line->'addOns' = 'null'::jsonb THEN CONTINUE; END IF;
    IF jsonb_typeof(v_line->'addOns') <> 'array' THEN RAISE EXCEPTION 'extras_invalid'; END IF;
    FOR v_req IN SELECT value FROM jsonb_array_elements(v_line->'addOns') LOOP
      IF jsonb_typeof(v_req) <> 'object'
         OR COALESCE(v_req->>'addOnId', '') !~
           '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
         OR jsonb_typeof(v_req->'quantity') <> 'number'
         OR COALESCE(v_req->>'quantity', '') !~ '^[1-9][0-9]{0,5}$'
         OR (v_req->>'addOnId')::uuid = ANY (v_ids) THEN
        RAISE EXCEPTION 'extras_invalid';
      END IF;
      v_ids := v_ids || (v_req->>'addOnId')::uuid;
    END LOOP;
  END LOOP;
  IF cardinality(v_ids) = 0 THEN
    RETURN jsonb_build_object('items', v_items, 'totalCents', 0);
  END IF;

  -- One lock order for every caller, after the ticket and discount locks.
  IF p_lock THEN
    PERFORM 1 FROM public.ticket_add_ons a WHERE a.id = ANY (v_ids) ORDER BY a.id FOR UPDATE;
  END IF;

  FOR v_line, v_req IN
    SELECT l.value, r.value
      FROM jsonb_array_elements(p_lines) AS l,
           jsonb_array_elements(CASE WHEN jsonb_typeof(l.value->'addOns') = 'array'
             THEN l.value->'addOns' ELSE '[]'::jsonb END) AS r
     ORDER BY (r.value->>'addOnId')
  LOOP
    SELECT a.* INTO v_add_on FROM public.ticket_add_ons a WHERE a.id = (v_req->>'addOnId')::uuid;
    SELECT tt.* INTO v_ticket FROM public.ticket_types tt WHERE tt.id = v_add_on.ticket_type_id;
    IF v_add_on.id IS NULL OR NOT v_add_on.is_active
       OR v_add_on.ticket_type_id::text IS DISTINCT FROM (v_line->>'ticketTypeId')
       OR v_ticket.event_id IS DISTINCT FROM p_event_id
       OR v_ticket.deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'extra_not_available' USING DETAIL = v_req->>'addOnId';
    END IF;
    v_qty := (v_req->>'quantity')::integer;
    v_parent := CASE WHEN jsonb_typeof(v_line->'byDate') = 'object'
      THEN public.issue_3281_line_qty_sum(v_line)
      ELSE COALESCE((v_line->>'quantity')::integer, 0) END;
    IF v_qty > v_add_on.max_per_ticket * v_parent THEN
      RAISE EXCEPTION 'extra_quantity_above_max' USING DETAIL = v_add_on.id::text;
    END IF;

    -- The dates this line's tickets are for, then the ones this extra covers.
    IF jsonb_typeof(v_line->'byDate') = 'object' THEN
      v_line_days := ARRAY(SELECT q.key::uuid FROM jsonb_each_text(v_line->'byDate') q
                            WHERE COALESCE(q.value::integer, 0) > 0);
    ELSE
      v_line_days := COALESCE(public.issue_3281_days_in_scope(v_ticket.id, p_day_ids), p_day_ids);
    END IF;
    v_keys := ARRAY(
      SELECT d.occurrence_key FROM public.event_dates d
       WHERE d.event_id = p_event_id
         AND d.id = ANY (COALESCE(v_line_days, '{}'::uuid[]))
         AND d.occurrence_key IS NOT NULL
         AND (v_add_on.valid_occurrence_keys IS NULL
           OR d.occurrence_key = ANY (v_add_on.valid_occurrence_keys))
       ORDER BY d.start_at, d.id);
    IF v_add_on.valid_occurrence_keys IS NOT NULL AND cardinality(v_keys) = 0 THEN
      RAISE EXCEPTION 'extra_not_on_chosen_days' USING DETAIL = v_add_on.id::text;
    END IF;

    IF NOT v_add_on.is_unlimited THEN
      IF v_add_on.valid_occurrence_keys IS NOT NULL THEN
        FOREACH v_key IN ARRAY v_keys LOOP
          IF public.issue_3281_add_on_taken(v_add_on.id, v_key, NULL) + v_qty
             > v_add_on.quantity_total THEN
            RAISE EXCEPTION 'extra_capacity_exceeded' USING DETAIL = v_key;
          END IF;
        END LOOP;
      ELSIF public.issue_3281_add_on_taken(v_add_on.id, NULL, NULL) + v_qty
            > v_add_on.quantity_total THEN
        RAISE EXCEPTION 'extra_capacity_exceeded' USING DETAIL = v_add_on.id::text;
      END IF;
    END IF;
    IF v_add_on.price_cents > 0 AND v_ticket.currency IS NULL THEN
      RAISE EXCEPTION 'event_currency_required';
    END IF;

    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'addOnId', v_add_on.id, 'ticketTypeId', v_ticket.id,
      'addOnName', v_add_on.name, 'ticketName', v_ticket.name,
      'dayScope', CASE WHEN cardinality(v_keys) = 0 THEN NULL ELSE to_jsonb(v_keys) END,
      'quantity', v_qty, 'unitPriceCents', v_add_on.price_cents,
      'totalCents', v_qty * v_add_on.price_cents));
    v_total := v_total + v_qty * v_add_on.price_cents;
  END LOOP;
  RETURN jsonb_build_object('items', v_items, 'totalCents', v_total);
END;
$fn$;

-- The extras a session holds, in the shape the quote and session return.
CREATE FUNCTION public.issue_3281_session_extras(p_session_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT jsonb_build_object(
    'items', COALESCE(jsonb_agg(jsonb_build_object(
      'addOnId', x.ticket_add_on_id, 'ticketTypeId', x.ticket_type_id,
      'addOnName', x.add_on_name_at_purchase, 'ticketName', x.ticket_type_name_at_purchase,
      'dayScope', to_jsonb(x.day_scope), 'quantity', x.quantity,
      'unitPriceCents', x.unit_price_cents, 'totalCents', x.total_cents
    ) ORDER BY x.ticket_add_on_id), '[]'::jsonb),
    'totalCents', COALESCE(SUM(x.total_cents), 0))
  FROM public.ticket_checkout_session_add_on_items x
  WHERE x.checkout_session_id = p_session_id;
$fn$;

-- The quote digest covers the extras too, so a session created from a quote
-- refuses when an extra's price or dates changed in between. A cart without
-- extras keeps the discount engine's digest unchanged.
CREATE FUNCTION public.issue_3281_quote_digest(p_digest text, p_extras jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT CASE WHEN COALESCE(jsonb_array_length(p_extras->'items'), 0) = 0 THEN p_digest
    ELSE md5(COALESCE(p_digest, '') || ':extras:' || (p_extras->'items')::text) END;
$fn$;

REVOKE ALL ON FUNCTION public.issue_3281_quote_digest(text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_3281_add_on_taken(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_3281_price_extras(uuid, jsonb, uuid[], boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_3281_session_extras(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.issue_3872_ticket_quote(
  p_event_id uuid,
  p_lines jsonb,
  p_event_date_ids uuid[],
  p_booked_start_at timestamptz,
  p_booked_end_at timestamptz,
  p_booked_party_size integer,
  p_payment_plan_choice text,
  p_discount_code text,
  p_buyer_email text,
  p_buyer_phone_e164 text,
  p_buyer_user_id uuid,
  p_link_token_hash text,
  p_queued boolean
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=public,auth,pg_temp AS $quote$
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
BEGIN
  IF COALESCE(p_payment_plan_choice,'') NOT IN ('auto','full','installments') THEN
    RAISE EXCEPTION 'payment_plan_choice_invalid';
  END IF;
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
      RAISE EXCEPTION 'extras_not_on_installments';
    END IF;
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
    'dueTodayNetCents',(v_plan->>'dueTodayNetCents')::bigint+(v_extras->>'totalCents')::bigint,
    'dueTodayListCents',(v_plan->>'dueTodayListCents')::bigint+(v_extras->>'totalCents')::bigint,
    'extras',v_extras->'items','extrasTotalCents',(v_extras->>'totalCents')::bigint,
    'installmentSchedule',v_plan->'installmentSchedule',
    'discounts',v_quote->'applied','codeOutcome',v_quote->'codeOutcome',
    'notices',v_quote->'notices','quoteDigest',public.issue_3281_quote_digest(v_quote->>'digest',v_extras),
    'quoteListDigest',v_quote->>'listDigest');
END;
$quote$;

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
BEGIN
  IF COALESCE(p_payment_plan_choice, '') NOT IN ('auto', 'full', 'installments') THEN
    RAISE EXCEPTION 'payment_plan_choice_invalid';
  END IF;

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
      RAISE EXCEPTION 'extras_not_on_installments';
    END IF;
    v_total := v_total + v_extras_total;
    v_list_due_today := v_list_due_today + v_extras_total;
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
    booked_party_size
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
    p_booked_party_size
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
    ticket_type_name_at_purchase, day_scope, quantity, unit_price_cents, total_cents
  )
  SELECT v_session_id, (x->>'addOnId')::uuid, (x->>'ticketTypeId')::uuid, x->>'addOnName',
         x->>'ticketName',
         CASE WHEN jsonb_typeof(x->'dayScope') = 'array'
           THEN ARRAY(SELECT jsonb_array_elements_text(x->'dayScope')) END,
         (x->>'quantity')::integer, (x->>'unitPriceCents')::integer, (x->>'totalCents')::integer
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
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.biz_ticket_checkout_create_session(p_event_id uuid, p_buyer_user_id uuid, p_buyer_name text, p_buyer_email text, p_buyer_phone_e164 text, p_marketing_opt_in boolean, p_lines jsonb, p_idempotency_key text, p_expires_at timestamp with time zone, p_application_fee_amount_cents integer DEFAULT 0, p_payment_plan_choice text DEFAULT 'auto'::text, p_event_date_ids uuid[] DEFAULT NULL::uuid[], p_booked_start_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_booked_end_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_booked_party_size integer DEFAULT NULL::integer, p_discount_code text DEFAULT NULL::text, p_expected_quote_digest text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
DECLARE
  v_event public.events%ROWTYPE;
  v_existing record;
  v_items jsonb := '[]'::jsonb;
  v_result jsonb;
  v_decision text;
  v_replay_decision text;
  v_snapshot jsonb;
  v_mode text;
  v_session_id uuid;
BEGIN
  SELECT * INTO v_event FROM public.events WHERE id=p_event_id FOR UPDATE;
  IF NOT FOUND OR v_event.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'event_not_found';
  END IF;
  -- #2101 A3.1 — brand lock immediately after the event lock.
  PERFORM 1 FROM public.brands
    WHERE id=v_event.brand_id AND deleted_at IS NULL FOR UPDATE;
  IF public.issue_1930_event_sale_reason(v_event)<>'sellable' THEN
    RAISE EXCEPTION 'event_not_selling';
  END IF;

  -- #2101 — fresh decision BEFORE the idempotency replay owner.
  v_decision := public.issue_2101_ticket_checkout_access_decision(
    p_event_id, p_buyer_user_id);
  IF v_decision='sign_in_required' THEN
    RAISE EXCEPTION 'checkout_sign_in_required';
  END IF;
  IF v_decision NOT IN ('allowed_unrestricted','allowed_named') THEN
    RAISE EXCEPTION 'checkout_restricted';
  END IF;
  v_snapshot := public.issue_2101_current_access_snapshot(p_event_id,p_buyer_user_id);
  v_mode := v_snapshot->>'mode';

  -- issue #2696 — SCOPED TO THE EVENT BEING BOUGHT.
  --
  -- This lookup resolved a session by idempotency key ALONE. The key is globally
  -- UNIQUE with no event or brand column, and its event-scoping was only ever an
  -- implicit property of how the edge composed it. That made it defeatable the
  -- moment a caller could supply their own key, which the edge accepted verbatim
  -- until #2696 removed it.
  --
  -- The conjunct here is the durable half of that fix: even a caller-supplied or
  -- colliding key can no longer return a session belonging to a different event.
  -- Without it, a request naming event B could be answered with event A's
  -- session, and every decision after this point — the #2101 access mode, the
  -- named-buyer cross-check, the status-token write — was then made against B's
  -- rules on A's row.
  --
  -- NOT A BEHAVIOUR CHANGE: all 179 live sessions already satisfy
  -- `idempotency_key LIKE 'ticket_checkout:' || event_id || ':%'`, and 0 do not.
  -- A legitimate resubmit derives the same key for the same event and still
  -- finds its row.
  SELECT *
    INTO v_existing
    FROM public.ticket_checkout_sessions
   WHERE idempotency_key=p_idempotency_key
     AND event_id=p_event_id;

  IF FOUND THEN
    -- ═══════════════════════════════════════════════════════════════════════
    -- issue #2150 — A COMPLETED **FREE** RESERVATION IS RETURNED, NOT REMINTED.
    --
    -- This block is evaluated BEFORE the ORCH-0791 terminal tombstone and
    -- before the ORCH-0829-B D-1 expiry tombstone, and it is the ONLY thing
    -- that changed in this function. Every conjunct is load-bearing:
    --
    --   status='free_completed'  the only status `biz_ticket_checkout_finalize`
    --                            assigns when `total_cents = 0`.
    --   total_cents = 0          independent proof this carried NO money, so
    --                            the paid arm cannot enter here even if a
    --                            status were corrupted. THIS is the conjunct
    --                            that scopes the change to the zero-total case.
    --   order_id IS NOT NULL     there is something to hand back.
    --   revoked_at IS NULL       the sale was not revoked (#2079 / #1930).
    --   buyer identity matches   an anonymous guest is (NULL,NULL) and matches
    --                            itself; a DIFFERENT signed-in user presenting
    --                            the same derived key falls through to today's
    --                            behaviour rather than being handed someone
    --                            else's passes.
    --   a live ticket exists     a cancelled / refunded / voided reservation is
    --                            NOT a reservation the guest still holds, so it
    --                            falls through and they can re-reserve.
    --
    -- On a match the guest's ORIGINAL session is returned untouched: the key is
    -- NOT renamed, no row is inserted, and `ticket-checkout-create` answers
    -- with that same order's already-issued tickets — one order, one ticket,
    -- one confirmation email and one SMS, however many times they submit.
    -- ═══════════════════════════════════════════════════════════════════════
    IF v_existing.status='free_completed'
       AND COALESCE(v_existing.total_cents,0)=0
       AND v_existing.order_id IS NOT NULL
       AND v_existing.revoked_at IS NULL
       AND v_existing.buyer_user_id IS NOT DISTINCT FROM p_buyer_user_id
       AND EXISTS(SELECT 1 FROM public.tickets t
                   WHERE t.order_id=v_existing.order_id
                     AND t.status IN ('valid','used','transferred')) THEN
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'ticketTypeId',i.ticket_type_id,
        'ticketName',i.ticket_name_at_purchase,
        'quantity',i.quantity,
        'unitPriceCents',i.unit_price_cents,
        'listUnitPriceCents',COALESCE(i.list_unit_price_cents,i.unit_price_cents),
        'discountCents',i.discount_cents,
        'totalCents',i.total_cents,
        'applied',i.applied_discounts
      ) ORDER BY i.created_at),'[]'::jsonb)
        INTO v_items
        FROM public.ticket_checkout_session_items i
       WHERE i.checkout_session_id=v_existing.id;

      RETURN jsonb_build_object(
        'checkoutSessionId',v_existing.id,
        'eventId',v_existing.event_id,
        'brandId',v_existing.brand_id,
        'status',v_existing.status,
        'totalCents',v_existing.total_cents,
        'subtotalCents',v_existing.total_cents,
        'listSubtotalCents',COALESCE(v_existing.list_subtotal_cents,v_existing.total_cents),
        'discountCents',v_existing.discount_cents,
        'currency',trim(v_existing.currency),
        'stripeAccountId',v_existing.stripe_account_id,
        'orderId',v_existing.order_id,
        'items',v_items,
        'lineItems',v_items,
        'installmentSchedule',v_existing.installment_schedule,
        'extras',public.issue_3281_session_extras(v_existing.id)->'items',
        'extrasTotalCents',(public.issue_3281_session_extras(v_existing.id)->>'totalCents')::integer
      );
    END IF;

    IF v_existing.status IN ('paid_completed','free_completed','failed','expired')
       OR v_existing.expires_at < now() THEN
      UPDATE public.ticket_checkout_sessions
         SET idempotency_key=idempotency_key || ':tombstone:' || id::text,
             status=CASE
               WHEN status IN ('paid_completed','free_completed','failed','expired') THEN status
               ELSE 'expired'
             END,
             failed_at=CASE
               WHEN status IN ('paid_completed','free_completed','failed','expired') THEN failed_at
               WHEN status IN ('pending_free','requires_payment','processing_payment','awaiting_web_redirect')
                 AND expires_at < now() THEN now()
               ELSE failed_at
             END,
             updated_at=now()
       WHERE id=v_existing.id;
    ELSE
      v_replay_decision := public.issue_2101_ticket_checkout_access_decision(
        p_event_id, v_existing.buyer_user_id,
        v_existing.checkout_access_mode_snapshot,
        v_existing.checkout_access_restrictive_epoch_snapshot,
        v_existing.checkout_access_membership_id_snapshot,
        v_existing.checkout_access_membership_epoch_snapshot);
      IF v_replay_decision NOT IN ('allowed_unrestricted','allowed_named')
         OR (v_mode='named_buyers'
             AND v_existing.buyer_user_id IS DISTINCT FROM p_buyer_user_id) THEN
        RAISE EXCEPTION 'checkout_restricted';
      END IF;

      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'ticketTypeId',i.ticket_type_id,
        'ticketName',i.ticket_name_at_purchase,
        'quantity',i.quantity,
        'unitPriceCents',i.unit_price_cents,
        'listUnitPriceCents',COALESCE(i.list_unit_price_cents,i.unit_price_cents),
        'discountCents',i.discount_cents,
        'totalCents',i.total_cents,
        'applied',i.applied_discounts
      ) ORDER BY i.created_at),'[]'::jsonb)
        INTO v_items
        FROM public.ticket_checkout_session_items i
       WHERE i.checkout_session_id=v_existing.id;

      RETURN jsonb_build_object(
        'checkoutSessionId',v_existing.id,
        'eventId',v_existing.event_id,
        'brandId',v_existing.brand_id,
        'status',v_existing.status,
        'totalCents',v_existing.total_cents,
        'subtotalCents',v_existing.total_cents,
        'listSubtotalCents',COALESCE(v_existing.list_subtotal_cents,v_existing.total_cents),
        'discountCents',v_existing.discount_cents,
        'currency',trim(v_existing.currency),
        'stripeAccountId',v_existing.stripe_account_id,
        'orderId',v_existing.order_id,
        'items',v_items,
        'lineItems',v_items,
        'installmentSchedule',v_existing.installment_schedule,
        'extras',public.issue_3281_session_extras(v_existing.id)->'items',
        'extrasTotalCents',(public.issue_3281_session_extras(v_existing.id)->>'totalCents')::integer
      );
    END IF;
  END IF;

  -- issue #2160 DELTA 2 of 2 — forward the day set. NOTHING ELSE IN THIS
  -- FUNCTION CHANGED: the #2150 free-completed exemption above, the ORCH-0791
  -- terminal tombstone, the ORCH-0829-B expiry tombstone, the #2101 fresh
  -- decision, the event -> brand lock order and the access snapshot write-back
  -- are byte-preserved from 20270419002150:158-358.
  -- issue #3281 / R2 — forward optional start, end, and party size.
  v_result:=public.issue_1930_ticket_checkout_create_session_base(
    p_event_id,p_buyer_user_id,p_buyer_name,p_buyer_email,p_buyer_phone_e164,
    p_marketing_opt_in,p_lines,p_idempotency_key,p_expires_at,
    p_application_fee_amount_cents,p_payment_plan_choice,p_event_date_ids,
    p_booked_start_at,p_booked_end_at,p_booked_party_size,
    p_discount_code,p_expected_quote_digest);

  v_session_id := (v_result->>'checkoutSessionId')::uuid;
  IF v_session_id IS NOT NULL THEN
    UPDATE public.ticket_checkout_sessions SET
      checkout_access_mode_snapshot=v_mode,
      checkout_access_restrictive_epoch_snapshot=
        COALESCE((v_snapshot->>'restrictiveEpoch')::bigint,0),
      checkout_access_membership_id_snapshot=
        NULLIF(v_snapshot->>'membershipId','')::uuid,
      checkout_access_membership_epoch_snapshot=
        NULLIF(v_snapshot->>'membershipEpoch','')::bigint
    WHERE id=v_session_id;
  END IF;

  RETURN jsonb_build_object(
    'checkoutSessionId',v_result->'checkoutSessionId',
    'eventId',v_result->'eventId',
    'brandId',v_result->'brandId',
    'status',v_result->'status',
    'totalCents',v_result->'totalCents',
    'subtotalCents',v_result->'subtotalCents',
    'listSubtotalCents',v_result->'listSubtotalCents',
    'discountCents',v_result->'discountCents',
    'fullListCents',v_result->'fullListCents',
    'fullNetCents',v_result->'fullNetCents',
    'quoteDigest',v_result->'quoteDigest',
    'quoteListDigest',v_result->'quoteListDigest',
    'discounts',v_result->'discounts',
    'codeOutcome',v_result->'codeOutcome',
    'notices',v_result->'notices',
    'currency',v_result->'currency',
    'stripeAccountId',v_result->'stripeAccountId',
    'orderId',v_result->'orderId',
    'items',v_result->'items',
    'lineItems',v_result->'lineItems',
    'installmentSchedule',v_result->'installmentSchedule',
    -- issue #3281 — extras pass through to the edge function.
    'extras',v_result->'extras',
    'extrasTotalCents',v_result->'extrasTotalCents'
  );
END $function$;

CREATE OR REPLACE FUNCTION public.issue_1930_ticket_checkout_finalize_base(
  p_checkout_session_id uuid,
  p_stripe_payment_intent_id text,
  p_stripe_charge_id text,
  p_stripe_payment_method_type text,
  p_qr_token_pepper text,
  p_stripe_customer_id_on_connected_account text DEFAULT NULL,
  p_saved_payment_method_id text DEFAULT NULL,
  p_installment_plan_root boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
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
          provider, collection_method, plan_bound_at
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
               THEN NULL ELSE now() END
        );
      END LOOP;

      UPDATE public.orders
         SET installment_plan_root = true,
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
    booked_party_size
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
    v_session.booked_party_size
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
        provider, collection_method, plan_bound_at
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
             THEN NULL ELSE v_now END
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
    ticket_type_name_at_order, day_scope_at_order, quantity, unit_price_cents, total_cents
  )
  SELECT v_order_id, ticket_add_on_id, ticket_type_id, add_on_name_at_purchase,
         ticket_type_name_at_purchase, day_scope, quantity, unit_price_cents, total_cents
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
$$;

CREATE OR REPLACE FUNCTION public.issue_1930_ticket_session_authorized(
  p_session_id uuid, p_event_id uuid
) RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=public,auth,pg_temp AS $function$
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
  SELECT EXISTS(
    SELECT 1 FROM public.ticket_checkout_session_items i
    LEFT JOIN public.ticket_types tt ON tt.id=i.ticket_type_id AND tt.event_id=p_event_id
    WHERE i.checkout_session_id=p_session_id AND (
      tt.id IS NULL OR tt.deleted_at IS NOT NULL OR tt.is_hidden OR tt.is_disabled
      OR NOT tt.available_online
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
  IF EXISTS (
    SELECT 1 FROM public.ticket_checkout_session_add_on_items x
      LEFT JOIN public.ticket_add_ons a ON a.id = x.ticket_add_on_id
     WHERE x.checkout_session_id = p_session_id
       AND (a.id IS NULL OR NOT a.is_active
         OR (NOT a.is_unlimited AND (
           (a.valid_occurrence_keys IS NULL
             AND public.issue_3281_add_on_taken(a.id, NULL, p_session_id) + x.quantity > a.quantity_total)
           OR (a.valid_occurrence_keys IS NOT NULL AND EXISTS (
             SELECT 1 FROM unnest(x.day_scope) AS k
              WHERE public.issue_3281_add_on_taken(a.id, k, p_session_id) + x.quantity > a.quantity_total))
         )))
  ) THEN RETURN false; END IF;
  IF EXISTS(SELECT 1 FROM public.ticket_checkout_sessions s
    WHERE s.id=p_session_id AND (s.metadata->>'event_date_id') IS NOT NULL
      AND NOT EXISTS(SELECT 1 FROM public.event_dates d
        WHERE d.id=(s.metadata->>'event_date_id')::uuid AND d.event_id=p_event_id
          AND d.end_at > now())) THEN RETURN false; END IF;
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
                   AND d.end_at > now())) THEN RETURN false; END IF;
  RETURN true;
END $function$;

CREATE OR REPLACE FUNCTION public.issue_3859_bind_checkout_contract(
  p_checkout_session_id uuid,
  p_event_id uuid,
  p_idempotency_key text,
  p_checkout_attempt_id uuid,
  p_checkout_fingerprint text,
  p_lines jsonb,
  p_due_today_cents integer,
  p_full_price_cents integer,
  p_installment_schedule jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
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
      RAISE EXCEPTION 'checkout_quote_invalid';
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
         updated_at = now()
   WHERE id = p_checkout_session_id;

  RETURN jsonb_build_object(
    'outcome', 'bound',
    'totalCents', p_due_today_cents,
    'installmentSchedule', p_installment_schedule
  );
END
$function$;

CREATE OR REPLACE FUNCTION public.biz_refund_order_commit_from_webhook(
  p_order_id uuid,
  p_stripe_refund_id text,
  p_amount_cents integer,
  p_currency character,
  p_application_fee_refunded_cents integer,
  p_idempotency_key_hint text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_order public.orders%ROWTYPE;
  v_existing_refund_id uuid;
  v_refund_id uuid;
  v_line record;
  v_remaining_to_allocate int;
  v_alloc_qty int;
  v_alloc_amount int;
  v_new_payment_status text;
  v_total_refunded_cents int;
  v_settled boolean := false;
  v_open_lines int;
  v_idx int := 0;
  v_extras_due int := 0;
  v_extras_cap int := 0;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0001';
  END IF;

  -- Match path 1: refunds.stripe_refund_id = p_stripe_refund_id (idempotent webhook replay).
  SELECT id INTO v_existing_refund_id
  FROM public.refunds
  WHERE stripe_refund_id = p_stripe_refund_id;

  -- Match path 2: in-app refund pre-recorded with idempotency_key hint, still pending.
  IF v_existing_refund_id IS NULL AND p_idempotency_key_hint IS NOT NULL THEN
    SELECT id INTO v_existing_refund_id
    FROM public.refunds
    WHERE order_id = p_order_id
      AND status = 'pending'
      AND metadata->>'idempotency_key' = p_idempotency_key_hint
    LIMIT 1;
  END IF;

  IF v_existing_refund_id IS NOT NULL THEN
    -- Advance the existing row to succeeded (if pending) — no-op if already terminal.
    UPDATE public.refunds
    SET status = 'succeeded',
        stripe_refund_id = COALESCE(stripe_refund_id, p_stripe_refund_id),
        -- issue #3281 — no fee amount keeps the fee fields as they are (#2097).
        application_fee_refunded_cents = COALESCE(p_application_fee_refunded_cents, application_fee_refunded_cents),
        processed_at = COALESCE(processed_at, now())
    WHERE id = v_existing_refund_id
      AND status = 'pending';
    -- issue #3281 — only the call that settles the refund voids its tickets.
    v_settled := FOUND;
    v_refund_id := v_existing_refund_id;
  ELSE
    -- issue #3281 — lock the order before allocating, so two dashboard refunds
    -- never take the same line, and a redelivery that waited here finds the row.
    -- The referral share goes first: a settling refund's share trigger
    -- (issue_3872_refund_share_trigger) takes it before the order everywhere else.
    PERFORM 1 FROM public.payee_shares
    WHERE order_kind = 'ticket' AND order_id = p_order_id AND payee_kind = 'referral'
    FOR UPDATE;
    PERFORM 1 FROM public.orders WHERE id = p_order_id FOR NO KEY UPDATE;
    SELECT id INTO v_refund_id
    FROM public.refunds
    WHERE stripe_refund_id = p_stripe_refund_id;
    v_existing_refund_id := v_refund_id;
    IF v_refund_id IS NULL THEN
      v_settled := true;
      -- Dashboard-initiated refund with no in-app pre-record.
      -- Create a new refund row + proportional refund_line_items (oldest-first allocation per Q-3).
      INSERT INTO public.refunds (
        order_id, amount_cents, currency, reason, initiated_by, status,
        stripe_payment_intent_id, stripe_charge_id, stripe_refund_id,
        application_fee_refunded_cents, processed_at, metadata
      ) VALUES (
        p_order_id,
        p_amount_cents,
        p_currency,
        'Dashboard-initiated refund (Stripe)',
        NULL,
        'succeeded',
        v_order.stripe_payment_intent_id,
        v_order.stripe_charge_id,
        p_stripe_refund_id,
        -- issue #3281 — unknown until fee evidence arrives (#2097 unknown_legacy).
        p_application_fee_refunded_cents,
        now(),
        jsonb_build_object('source', 'webhook_reconciliation')
      ) RETURNING id INTO v_refund_id;

      -- Proportional allocation: walk order_line_items oldest-first, take as much qty as needed
      -- to cover p_amount_cents at unit_price_cents per ticket.
      v_remaining_to_allocate := p_amount_cents;
      FOR v_line IN
        SELECT id, ticket_type_id, quantity, unit_price_cents, total_cents,
               (
                 SELECT COALESCE(SUM(rli.quantity), 0)
                 FROM public.refund_line_items rli
                 JOIN public.refunds r ON r.id = rli.refund_id
                 WHERE rli.order_line_item_id = order_line_items.id
                   -- issue #3281 — a pending in-app refund already holds its lines.
                   AND r.status IN ('pending', 'succeeded')
                   AND r.id <> v_refund_id
               ) AS already_refunded_qty
        FROM public.order_line_items
        WHERE order_id = p_order_id
        ORDER BY id ASC
      LOOP
        EXIT WHEN v_remaining_to_allocate <= 0;
        -- How many units can we refund from this line?
        v_alloc_qty := LEAST(
          v_line.quantity - v_line.already_refunded_qty,
          CASE WHEN v_line.unit_price_cents > 0
            THEN v_remaining_to_allocate / v_line.unit_price_cents
            ELSE 0
          END
        );
        IF v_alloc_qty <= 0 THEN
          CONTINUE;
        END IF;
        v_alloc_amount := v_alloc_qty * v_line.unit_price_cents;
        INSERT INTO public.refund_line_items (
          refund_id, order_line_item_id, ticket_type_id, quantity, amount_cents
        ) VALUES (
          v_refund_id, v_line.id, v_line.ticket_type_id, v_alloc_qty, v_alloc_amount
        );
        v_remaining_to_allocate := v_remaining_to_allocate - v_alloc_amount;
      END LOOP;
      -- If we couldn't fully allocate (e.g., partial-cent refund), the leftover stays at the
      -- order level only (orders.refunded_amount_cents reflects the Stripe truth via re-aggregation below).

      -- issue #3281 — once the order's refunds return the whole charge, this
      -- refund's unallocated cents take the paid tickets still held, so refunds
      -- smaller than a ticket never leave a fully refunded order with valid tickets.
      IF v_remaining_to_allocate > 0
         AND (SELECT COALESCE(SUM(amount_cents), 0) FROM public.refunds
              WHERE order_id = p_order_id AND status = 'succeeded') >= v_order.total_cents THEN
        SELECT count(*) INTO v_open_lines
        FROM public.order_line_items oli
        WHERE oli.order_id = p_order_id AND oli.unit_price_cents > 0
          AND oli.quantity > (
            SELECT COALESCE(SUM(rli.quantity), 0)
            FROM public.refund_line_items rli
            JOIN public.refunds r ON r.id = rli.refund_id
            WHERE rli.order_line_item_id = oli.id AND r.status IN ('pending', 'succeeded'));
        -- issue #3281 — keep the extras' share for the extras, leaving each
        -- ticket line still held at least a cent.
        SELECT COALESCE(SUM(item.total_cents), 0) INTO v_extras_due
          FROM public.order_add_on_line_items item
         WHERE item.order_id = p_order_id
           AND NOT EXISTS (
             SELECT 1 FROM public.refund_add_on_line_items ra
               JOIN public.refunds r ON r.id = ra.refund_id
              WHERE ra.order_add_on_line_item_id = item.id
                AND r.status IN ('pending', 'succeeded'));
        v_extras_cap := LEAST(v_extras_due, GREATEST(v_remaining_to_allocate - v_open_lines, 0));
        v_remaining_to_allocate := v_remaining_to_allocate - v_extras_cap;
        FOR v_line IN
          SELECT oli.id, oli.ticket_type_id,
                 oli.quantity - (
                   SELECT COALESCE(SUM(rli.quantity), 0)
                   FROM public.refund_line_items rli
                   JOIN public.refunds r ON r.id = rli.refund_id
                   WHERE rli.order_line_item_id = oli.id AND r.status IN ('pending', 'succeeded')
                 ) AS open_qty
          FROM public.order_line_items oli
          WHERE oli.order_id = p_order_id AND oli.unit_price_cents > 0
          ORDER BY oli.id ASC
        LOOP
          CONTINUE WHEN v_line.open_qty <= 0;
          EXIT WHEN v_remaining_to_allocate <= 0;
          v_idx := v_idx + 1;
          -- Split only this refund's own cents, so no line claims more than was returned.
          v_alloc_amount := CASE WHEN v_idx >= v_open_lines THEN v_remaining_to_allocate
            ELSE GREATEST(v_remaining_to_allocate / (v_open_lines - v_idx + 1), 1) END;
          -- The first pass may already hold part of this line for this refund.
          INSERT INTO public.refund_line_items (
            refund_id, order_line_item_id, ticket_type_id, quantity, amount_cents
          ) VALUES (
            v_refund_id, v_line.id, v_line.ticket_type_id, v_line.open_qty, v_alloc_amount
          )
          ON CONFLICT ON CONSTRAINT refund_line_items_refund_line_installment_unique DO UPDATE
          SET quantity = public.refund_line_items.quantity + EXCLUDED.quantity,
              amount_cents = public.refund_line_items.amount_cents + EXCLUDED.amount_cents;
          v_remaining_to_allocate := v_remaining_to_allocate - v_alloc_amount;
        END LOOP;
        -- The order is fully refunded, so its extras are too.
        INSERT INTO public.refund_add_on_line_items (
          refund_id, order_add_on_line_item_id, quantity, amount_cents
        )
        SELECT v_refund_id, due.id, due.quantity,
               LEAST(due.total_cents, GREATEST(v_extras_cap - due.before, 0))::integer
          FROM (
            SELECT item.id, item.quantity, item.total_cents,
                   COALESCE(SUM(item.total_cents) OVER (
                     ORDER BY item.id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
                   ), 0) AS before
              FROM public.order_add_on_line_items item
             WHERE item.order_id = p_order_id
               AND NOT EXISTS (
                 SELECT 1 FROM public.refund_add_on_line_items ra
                   JOIN public.refunds r ON r.id = ra.refund_id
                  WHERE ra.order_add_on_line_item_id = item.id
                    AND r.status IN ('pending', 'succeeded'))
          ) due;
      END IF;
    END IF;
  END IF;

  -- issue #3281 — two refunds settling together must see each other's result.
  -- NO KEY UPDATE stays compatible with the key-share lock a new refund row holds.
  PERFORM 1 FROM public.orders WHERE id = p_order_id FOR NO KEY UPDATE;
  -- Recompute cumulative refunded cents and new payment_status.
  SELECT COALESCE(SUM(amount_cents), 0) INTO v_total_refunded_cents
  FROM public.refunds
  WHERE order_id = p_order_id AND status = 'succeeded';

  -- issue #3281 — a replay must not undo a settled full cancellation.
  v_new_payment_status := public.issue_3281_settled_payment_status(p_order_id);

  UPDATE public.orders
  SET payment_status = v_new_payment_status,
      refunded_amount_cents = v_total_refunded_cents,
      updated_at = now()
  WHERE id = p_order_id;

  -- Defense-in-depth ticket void (idempotent — only flips tickets still 'valid').
  -- issue #3281 — a replayed event must not void more tickets than the refund holds.
  IF v_settled THEN
    FOR v_line IN
      SELECT rli.ticket_type_id, rli.quantity
      FROM public.refund_line_items rli
      WHERE rli.refund_id = v_refund_id
    LOOP
      UPDATE public.tickets t
      SET status = 'refunded'
      WHERE t.id IN (
        SELECT t2.id
        FROM public.tickets t2
        WHERE t2.order_id = p_order_id
          AND t2.ticket_type_id = v_line.ticket_type_id
          AND t2.status = 'valid'
        ORDER BY t2.created_at ASC
        LIMIT v_line.quantity
      );
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'refund_id', v_refund_id,
    'status', 'succeeded',
    'new_payment_status', v_new_payment_status,
    'total_refunded_cents', v_total_refunded_cents,
    'source', CASE WHEN v_existing_refund_id IS NULL THEN 'webhook_new' ELSE 'webhook_match' END
  );
END;
$function$;

NOTIFY pgrst, 'reload schema';

COMMIT;
