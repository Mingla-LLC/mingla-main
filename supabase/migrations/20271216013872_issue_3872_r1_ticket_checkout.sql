-- #3872 R1 Discounts — ticket quote/create/finalize integration.
-- MINGLA-INVARIANT: I-3872-ENGINE-PARITY | issue #3872 | quote and create call the same SQL line, plan and discount owners.
BEGIN;
SET LOCAL lock_timeout = '10s';

-- Refuse to overwrite any checkout hotfix that landed after the verified base.
DO $drift$
DECLARE r record; v_actual text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('public.issue_1930_ticket_checkout_create_session_base(uuid,uuid,text,text,text,boolean,jsonb,text,timestamptz,integer,text,uuid[],timestamptz,timestamptz,integer)','662e543fb028bb0f4ba2a88186e0fe4b'),
    ('public.biz_ticket_checkout_create_session(uuid,uuid,text,text,text,boolean,jsonb,text,timestamptz,integer,text,uuid[],timestamptz,timestamptz,integer)','cc180091d9c3d40adf0449586c309ada'),
    ('public.biz_ticket_link_checkout_create_session(text,uuid,uuid,text,text,text,boolean,jsonb,text,timestamptz,integer,text,uuid[],timestamptz,timestamptz,integer)','8a5c7f8fa143b73b0ca175e29a0b3277'),
    ('public.issue_3872_copy_session_totals_to_order(uuid)','975f82ccca5f69799d001d93f7bd4509')
  ) v(sig,expected_md5) LOOP
    SELECT md5(pg_get_functiondef(r.sig::regprocedure)) INTO v_actual;
    IF v_actual IS DISTINCT FROM r.expected_md5 THEN
      RAISE EXCEPTION 'issue #3872 M2 drift: % expected %, got %',r.sig,r.expected_md5,v_actual;
    END IF;
  END LOOP;
END;
$drift$;

DROP FUNCTION public.biz_ticket_link_checkout_create_session(text,uuid,uuid,text,text,text,boolean,jsonb,text,timestamptz,integer,text,uuid[],timestamptz,timestamptz,integer);
DROP FUNCTION public.biz_ticket_checkout_create_session(uuid,uuid,text,text,text,boolean,jsonb,text,timestamptz,integer,text,uuid[],timestamptz,timestamptz,integer);
DROP FUNCTION public.issue_1930_ticket_checkout_create_session_base(uuid,uuid,text,text,text,boolean,jsonb,text,timestamptz,integer,text,uuid[],timestamptz,timestamptz,integer);

-- TC-4: one owner of selected-day and booked-window context.
CREATE OR REPLACE FUNCTION public.issue_3872_checkout_day_context(
  p_event_id uuid,p_event_date_ids uuid[],p_booked_start_at timestamptz,p_booked_end_at timestamptz
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,auth,pg_temp AS $fn$
DECLARE
  v_event record; v_day_ids uuid[]; v_day_count integer:=0; v_day_choice jsonb;
  v_per_occurrence boolean:=false; v_pricing_mode text:='per_day'; v_day_multiplier integer:=1;
  v_booked_start timestamptz:=p_booked_start_at; v_booked_end timestamptz:=p_booked_end_at;
  v_open_daily boolean:=false;
BEGIN
  SELECT e.id,e.brand_id,e.event_type,e.capacity_scope,e.booking_spacing_minutes,
         e.is_recurring,e.recurrence_rules,e.timezone,e.multi_date_pricing_mode
    INTO v_event FROM public.events e WHERE e.id=p_event_id AND e.deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'event_not_found'; END IF;

  IF p_event_date_ids IS NOT NULL AND array_length(p_event_date_ids,1)>0 THEN
    SELECT ARRAY(SELECT d.id FROM public.event_dates d
      WHERE d.event_id=p_event_id AND d.id=ANY(p_event_date_ids)
      ORDER BY d.start_at,d.id) INTO v_day_ids;
    IF COALESCE(array_length(v_day_ids,1),0)
       <> (SELECT count(DISTINCT x) FROM unnest(p_event_date_ids) x) THEN
      RAISE EXCEPTION 'occurrence_not_found';
    END IF;
    IF EXISTS(SELECT 1 FROM public.event_dates d WHERE d.id=ANY(v_day_ids) AND d.end_at<=now()) THEN
      RAISE EXCEPTION 'occurrence_not_available';
    END IF;
    v_day_count:=COALESCE(array_length(v_day_ids,1),0);
  END IF;

  v_day_choice:=public.issue_3313_event_day_choice(p_event_id);
  v_per_occurrence:=COALESCE((v_day_choice->>'perOccurrenceCapacity')::boolean,false);
  IF v_day_count=0 AND (v_day_choice->>'soleOccurrenceId') IS NOT NULL THEN
    v_day_ids:=ARRAY[(v_day_choice->>'soleOccurrenceId')::uuid]; v_day_count:=1;
  END IF;
  IF v_day_count=0 AND COALESCE((v_day_choice->>'requiresChoice')::boolean,false) THEN
    RAISE EXCEPTION 'event_date_choice_required';
  END IF;
  IF v_event.event_type='experience'
     AND COALESCE(v_event.capacity_scope,'total') IN ('per_day','per_start')
     AND v_day_count=0 THEN RAISE EXCEPTION 'event_date_choice_required'; END IF;

  v_pricing_mode:=COALESCE(v_event.multi_date_pricing_mode,'per_day');
  IF v_day_count>0 AND v_pricing_mode='per_day' THEN v_day_multiplier:=v_day_count; END IF;
  IF v_booked_start IS NOT NULL AND v_day_count<>1 THEN RAISE EXCEPTION 'booked_start_invalid'; END IF;
  v_open_daily:=COALESCE(v_event.is_recurring,false)
    AND jsonb_typeof(v_event.recurrence_rules)='object'
    AND v_event.recurrence_rules->>'preset'='daily'
    AND v_event.recurrence_rules->'termination'->>'kind'='never';
  IF v_booked_start IS NULL AND v_event.event_type='experience'
     AND COALESCE(v_event.capacity_scope,'total')='per_start' AND v_day_count=1 AND NOT v_open_daily THEN
    SELECT d.start_at,d.start_at+make_interval(mins=>GREATEST(1,COALESCE(v_event.booking_spacing_minutes,30)))
      INTO v_booked_start,v_booked_end FROM public.event_dates d WHERE d.id=v_day_ids[1];
  END IF;
  PERFORM public.issue_3281_validate_booked_start(p_event_id,
    CASE WHEN v_day_count=1 THEN v_day_ids[1] ELSE NULL END,v_booked_start,v_booked_end);
  RETURN jsonb_build_object('dayIds',to_jsonb(v_day_ids),'dayCount',v_day_count,
    'perOccurrence',v_per_occurrence,'pricingMode',v_pricing_mode,'dayMultiplier',v_day_multiplier,
    'bookedStart',v_booked_start,'bookedEnd',v_booked_end,'eventType',v_event.event_type,
    'brandId',v_event.brand_id,'eventTimezone',COALESCE(v_event.timezone,'UTC'));
END;
$fn$;
REVOKE ALL ON FUNCTION public.issue_3872_checkout_day_context(uuid,uuid[],timestamptz,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3872_checkout_day_context(uuid,uuid[],timestamptz,timestamptz) TO service_role;

-- TC-5: one owner of a ticket line's list price and scale metadata.
CREATE OR REPLACE FUNCTION public.issue_3872_ticket_line_price(
  p_event_id uuid,p_ticket_type_id uuid,p_qty_raw integer,p_ctx jsonb,
  p_expires_at timestamptz,p_booked_party_size integer
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,auth,pg_temp AS $fn$
DECLARE v_event record; v_tt record; v_qty integer; v_unit bigint; v_admits integer:=1;
  v_basis text; v_blocks integer; v_day_count integer; v_mode text; v_value_scale integer:=1; v_count_scale integer:=1;
  v_start timestamptz; v_end timestamptz;
BEGIN
  IF COALESCE(p_qty_raw,0)<=0 THEN RAISE EXCEPTION 'ticket_quantity_invalid'; END IF;
  SELECT e.event_type,e.discounts_allowed INTO v_event FROM public.events e
    WHERE e.id=p_event_id AND e.deleted_at IS NULL;
  SELECT * INTO v_tt FROM public.ticket_types t
    WHERE t.id=p_ticket_type_id AND t.event_id=p_event_id AND t.deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'ticket_type_not_found'; END IF;
  IF (v_tt.is_hidden AND NOT public.issue_3827_link_unlocks_tier(v_tt.id))
     OR v_tt.is_disabled OR NOT v_tt.available_online THEN RAISE EXCEPTION 'ticket_type_unavailable'; END IF;
  IF v_tt.sale_start_at IS NOT NULL AND v_tt.sale_start_at>now() AND NOT (
    p_expires_at='infinity'::timestamptz AND EXISTS(SELECT 1 FROM public.ticket_queue_arming a
      WHERE a.ticket_type_id=v_tt.id AND a.disarmed_at IS NULL)) THEN
    RAISE EXCEPTION 'ticket_sales_not_started';
  END IF;
  IF v_tt.sale_end_at IS NOT NULL AND v_tt.sale_end_at<=now() THEN RAISE EXCEPTION 'ticket_sales_ended'; END IF;
  IF p_qty_raw<v_tt.min_purchase_qty THEN RAISE EXCEPTION 'ticket_quantity_below_min'; END IF;
  IF v_tt.max_purchase_qty IS NOT NULL AND p_qty_raw>v_tt.max_purchase_qty THEN RAISE EXCEPTION 'ticket_quantity_above_max'; END IF;

  v_day_count:=COALESCE((p_ctx->>'dayCount')::integer,0);
  v_mode:=COALESCE(p_ctx->>'pricingMode','per_day');
  v_qty:=p_qty_raw*COALESCE((p_ctx->>'dayMultiplier')::integer,1);
  v_unit:=v_tt.price_cents; v_basis:=COALESCE(v_tt.price_basis,'person');
  v_start:=NULLIF(p_ctx->>'bookedStart','')::timestamptz; v_end:=NULLIF(p_ctx->>'bookedEnd','')::timestamptz;
  IF v_event.event_type='experience' AND v_basis='group' THEN
    IF p_booked_party_size IS NULL OR p_booked_party_size<1 OR v_tt.group_max IS NULL
       OR p_booked_party_size>v_tt.group_max THEN RAISE EXCEPTION 'booked_party_invalid'; END IF;
    v_admits:=v_tt.group_max;
  ELSIF v_event.event_type='experience' AND v_basis='block' THEN
    IF v_start IS NULL OR v_end IS NULL OR v_tt.block_minutes IS NULL OR v_end<=v_start THEN
      RAISE EXCEPTION 'booked_length_invalid';
    END IF;
    v_blocks:=(extract(epoch FROM (v_end-v_start))/(v_tt.block_minutes::numeric*60.0))::integer;
    IF v_blocks<COALESCE(v_tt.min_blocks,1) OR v_blocks>COALESCE(v_tt.max_blocks,v_blocks) THEN
      RAISE EXCEPTION 'booked_length_invalid';
    END IF;
    v_unit:=v_tt.price_cents*v_blocks; v_value_scale:=v_blocks; v_count_scale:=v_blocks;
  ELSIF v_mode='all_days' AND v_day_count>0 THEN v_count_scale:=v_day_count;
  END IF;
  RETURN jsonb_build_object('ticketTypeId',v_tt.id,'ticketName',v_tt.name,
    'rawQuantity',p_qty_raw,'quantity',v_qty,'unitPriceCents',v_unit,'totalCents',v_unit*v_qty,
    'admitsCount',v_admits,'priceBasis',v_basis,'blocks',v_blocks,'currency',v_tt.currency,
    'isFree',COALESCE(v_tt.is_free,false) OR COALESCE(v_tt.price_cents,0)=0,
    'discountsAllowed',COALESCE(v_event.discounts_allowed,true) AND COALESCE(v_tt.discounts_allowed,true),
    'valueScale',v_value_scale,'countScale',v_count_scale);
END;
$fn$;
REVOKE ALL ON FUNCTION public.issue_3872_ticket_line_price(uuid,uuid,integer,jsonb,timestamptz,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3872_ticket_line_price(uuid,uuid,integer,jsonb,timestamptz,integer) TO service_role;

-- TC-12/TC-21q: one owner of due-today list/net and the plan schedule.
CREATE OR REPLACE FUNCTION public.issue_3872_plan_due_today(
  p_event_id uuid,p_items jsonb,p_choice text
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_event record; v_line jsonb; v_meta jsonb; v_input jsonb; v_inst jsonb; v_item jsonb;
  v_count integer; v_i integer; v_ord integer; v_days integer; v_fixed text; v_pct numeric;
  v_deposit_pct numeric; v_pct_sum numeric; v_net bigint; v_list bigint; v_dep_net bigint; v_dep_list bigint;
  v_running bigint; v_amount bigint; v_due timestamptz; v_now timestamptz:=now();
  v_due_net bigint:=0; v_due_list bigint:=0; v_union jsonb:='[]'::jsonb; v_any boolean:=false;
  v_full_net bigint:=0; v_full_list bigint:=0; v_schedule jsonb;
BEGIN
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
$fn$;
REVOKE ALL ON FUNCTION public.issue_3872_plan_due_today(uuid,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3872_plan_due_today(uuid,jsonb,text) TO service_role;

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
  v_buyer jsonb;
  v_candidate_ids uuid[];
  v_queued boolean := false;
  v_list_total bigint := 0;
  v_list_due_today bigint := 0;
  v_ap jsonb;
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
        'installmentSchedule', v_existing.installment_schedule
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
    v_qty_raw := COALESCE((v_line ->> 'quantity')::integer, 0);
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

    v_price := public.issue_3872_ticket_line_price(
      p_event_id,v_ticket_type.id,v_qty_raw,v_ctx,p_expires_at,p_booked_party_size);
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
      IF v_per_occurrence AND v_day_count > 0 THEN
        SELECT COALESCE(SUM((l ->> 'quantity')::integer), 0)::integer
          INTO v_cart_qty_for_type
          FROM jsonb_array_elements(p_lines) AS l
         WHERE (l ->> 'ticketTypeId')::uuid = v_ticket_type.id;
        IF v_ticket_type.quantity_total IS NOT NULL THEN
          FOREACH v_day_id IN ARRAY v_day_ids LOOP
            v_night_taken := public.issue_3313_ticket_type_occurrence_taken(
              v_ticket_type.id, v_day_id
            );
            IF v_night_taken + v_cart_qty_for_type > v_ticket_type.quantity_total THEN
              RAISE EXCEPTION 'ticket_capacity_exceeded';
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
      SELECT COALESCE(SUM((l ->> 'quantity')::integer), 0)::integer * v_day_multiplier
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
    IF v_event.event_type = 'experience'
       AND v_ticket_type.quantity_total IS NOT NULL THEN
      SELECT COALESCE(SUM((l ->> 'quantity')::integer), 0)::integer
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
    ));
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
  IF p_expected_quote_digest IS NOT NULL
     AND p_expected_quote_digest IS DISTINCT FROM v_quote->>'digest' THEN
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
      units_counted, applied_discounts
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
      COALESCE(v_line->'applied','[]'::jsonb)
    );
  END LOOP;

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
    'quoteDigest', v_quote->>'digest',
    'quoteListDigest', v_quote->>'listDigest',
    'discounts', v_quote->'applied',
    'codeOutcome', v_quote->'codeOutcome',
    'notices', v_quote->'notices'
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
        'installmentSchedule',v_existing.installment_schedule
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
        'installmentSchedule',v_existing.installment_schedule
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
    'installmentSchedule',v_result->'installmentSchedule'
  );
END $function$;


CREATE OR REPLACE FUNCTION public.biz_ticket_link_checkout_create_session(
  p_token_hash text,
  p_event_id uuid,
  p_buyer_user_id uuid,
  p_buyer_name text,
  p_buyer_email text,
  p_buyer_phone_e164 text,
  p_marketing_opt_in boolean,
  p_lines jsonb,
  p_idempotency_key text,
  p_expires_at timestamptz,
  p_application_fee_amount_cents integer DEFAULT 0,
  p_payment_plan_choice text DEFAULT 'auto',
  p_event_date_ids uuid[] DEFAULT NULL,
  p_booked_start_at timestamptz DEFAULT NULL,
  p_booked_end_at timestamptz DEFAULT NULL,
  p_booked_party_size integer DEFAULT NULL,
  p_discount_code text DEFAULT NULL,
  p_expected_quote_digest text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_link public.ticket_type_links;
  v_line jsonb;
  v_units integer := 0;
  v_state text;
  v_result jsonb;
  v_session_id uuid;
BEGIN
  SELECT l.* INTO v_link FROM public.ticket_type_links l WHERE l.token_hash = p_token_hash FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'link_not_found'; END IF;
  IF v_link.event_id <> p_event_id OR v_link.kind <> 'private_ticket' THEN
    RAISE EXCEPTION 'not_a_private_ticket_link';
  END IF;
  v_state := public.issue_3827_link_state(v_link, now());
  IF v_state <> 'active' THEN
    RAISE EXCEPTION '%', CASE v_state WHEN 'revoked' THEN 'link_revoked'
      WHEN 'expired' THEN 'link_expired' WHEN 'full' THEN 'link_full' ELSE v_state END;
  END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'invalid_request';
  END IF;
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    IF (v_line ->> 'ticketTypeId')::uuid <> v_link.ticket_type_id THEN
      RAISE EXCEPTION 'link_tier_mismatch';
    END IF;
    v_units := v_units + COALESCE((v_line ->> 'quantity')::integer, 0);
  END LOOP;
  IF v_units <= 0 THEN RAISE EXCEPTION 'invalid_request'; END IF;
  IF v_link.max_uses IS NOT NULL
     AND public.issue_3827_link_uses_taken(v_link.id) + v_units > v_link.max_uses THEN
    RAISE EXCEPTION 'link_full';
  END IF;

  PERFORM set_config('mingla.ticket_link_id', v_link.id::text, true);
  v_result := public.biz_ticket_checkout_create_session(
    p_event_id, p_buyer_user_id, p_buyer_name, p_buyer_email,
    p_buyer_phone_e164, p_marketing_opt_in, p_lines, p_idempotency_key,
    p_expires_at, p_application_fee_amount_cents, p_payment_plan_choice,
    p_event_date_ids, p_booked_start_at, p_booked_end_at, p_booked_party_size,
    p_discount_code, p_expected_quote_digest
  );
  v_session_id := (v_result ->> 'checkoutSessionId')::uuid;
  UPDATE public.ticket_checkout_sessions
     SET ticket_link_id = v_link.id, ticket_link_units = v_units
   WHERE id = v_session_id AND ticket_link_id IS NULL;
  PERFORM set_config('mingla.ticket_link_id', '', true);
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.issue_1930_ticket_checkout_create_session_base(uuid,uuid,text,text,text,boolean,jsonb,text,timestamptz,integer,text,uuid[],timestamptz,timestamptz,integer,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_1930_ticket_checkout_create_session_base(uuid,uuid,text,text,text,boolean,jsonb,text,timestamptz,integer,text,uuid[],timestamptz,timestamptz,integer,text,text) TO service_role;
REVOKE ALL ON FUNCTION public.biz_ticket_checkout_create_session(uuid,uuid,text,text,text,boolean,jsonb,text,timestamptz,integer,text,uuid[],timestamptz,timestamptz,integer,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.biz_ticket_checkout_create_session(uuid,uuid,text,text,text,boolean,jsonb,text,timestamptz,integer,text,uuid[],timestamptz,timestamptz,integer,text,text) TO service_role;
REVOKE ALL ON FUNCTION public.biz_ticket_link_checkout_create_session(text,uuid,uuid,text,text,text,boolean,jsonb,text,timestamptz,integer,text,uuid[],timestamptz,timestamptz,integer,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.biz_ticket_link_checkout_create_session(text,uuid,uuid,text,text,text,boolean,jsonb,text,timestamptz,integer,text,uuid[],timestamptz,timestamptz,integer,text,text) TO service_role;


-- TC-21q: a quote uses the same line, discount and plan owners as create, but
-- never takes inventory locks or writes sessions, holds, uses or orders.
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
      v_units:=v_units+COALESCE((v_line->>'quantity')::integer,0);
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
    v_price:=public.issue_3872_ticket_line_price(
      p_event_id,(v_line->>'ticketTypeId')::uuid,
      COALESCE((v_line->>'quantity')::integer,0),v_ctx,v_expires_at,p_booked_party_size);
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
    'listSubtotalCents',(v_quote->>'listSubtotalMinor')::bigint,
    'discountCents',(v_quote->>'discountMinor')::bigint,
    'netSubtotalCents',(v_quote->>'netSubtotalMinor')::bigint,
    'dueTodayNetCents',(v_plan->>'dueTodayNetCents')::bigint,
    'dueTodayListCents',(v_plan->>'dueTodayListCents')::bigint,
    'installmentSchedule',v_plan->'installmentSchedule',
    'discounts',v_quote->'applied','codeOutcome',v_quote->'codeOutcome',
    'notices',v_quote->'notices','quoteDigest',v_quote->>'digest',
    'quoteListDigest',v_quote->>'listDigest');
END;
$quote$;
REVOKE ALL ON FUNCTION public.issue_3872_ticket_quote(uuid,jsonb,uuid[],timestamptz,timestamptz,integer,text,text,text,text,uuid,text,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3872_ticket_quote(uuid,jsonb,uuid[],timestamptz,timestamptz,integer,text,text,text,text,uuid,text,boolean) TO service_role;

-- TC-30: the existing finalize base calls this hook in both completion arms.
-- Copy money first, then pair lines, snapshot discounts and consume reservations
-- in the same finalize transaction.
CREATE OR REPLACE FUNCTION public.issue_3872_copy_session_totals_to_order(
  p_checkout_session_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $finalize$
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

  UPDATE public.discount_uses u
     SET status='consumed',order_id=s.order_id,consumed_at=now(),released_at=NULL
    FROM public.ticket_checkout_sessions s
   WHERE s.id=p_checkout_session_id AND s.order_id IS NOT NULL
     AND u.checkout_kind='ticket' AND u.checkout_ref_id=s.id
     AND u.status IN ('reserved','released');

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

-- The old defaulted identities must be gone and every recreated security-
-- definer entry point must remain service-role only.
DO $postcheck$
DECLARE v_sig text;
BEGIN
  IF to_regprocedure('public.issue_1930_ticket_checkout_create_session_base(uuid,uuid,text,text,text,boolean,jsonb,text,timestamptz,integer,text,uuid[],timestamptz,timestamptz,integer)') IS NOT NULL
     OR to_regprocedure('public.biz_ticket_checkout_create_session(uuid,uuid,text,text,text,boolean,jsonb,text,timestamptz,integer,text,uuid[],timestamptz,timestamptz,integer)') IS NOT NULL
     OR to_regprocedure('public.biz_ticket_link_checkout_create_session(text,uuid,uuid,text,text,text,boolean,jsonb,text,timestamptz,integer,text,uuid[],timestamptz,timestamptz,integer)') IS NOT NULL THEN
    RAISE EXCEPTION 'issue #3872 M2 left a legacy checkout identity';
  END IF;
  FOREACH v_sig IN ARRAY ARRAY[
    'public.issue_1930_ticket_checkout_create_session_base(uuid,uuid,text,text,text,boolean,jsonb,text,timestamptz,integer,text,uuid[],timestamptz,timestamptz,integer,text,text)',
    'public.biz_ticket_checkout_create_session(uuid,uuid,text,text,text,boolean,jsonb,text,timestamptz,integer,text,uuid[],timestamptz,timestamptz,integer,text,text)',
    'public.biz_ticket_link_checkout_create_session(text,uuid,uuid,text,text,text,boolean,jsonb,text,timestamptz,integer,text,uuid[],timestamptz,timestamptz,integer,text,text)',
    'public.issue_3872_ticket_quote(uuid,jsonb,uuid[],timestamptz,timestamptz,integer,text,text,text,text,uuid,text,boolean)'
  ] LOOP
    IF to_regprocedure(v_sig) IS NULL THEN RAISE EXCEPTION 'issue #3872 M2 missing %',v_sig; END IF;
    IF EXISTS(
         SELECT 1 FROM pg_proc p,
           LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
         WHERE p.oid=to_regprocedure(v_sig) AND a.grantee=0
           AND a.privilege_type='EXECUTE'
       )
       OR has_function_privilege('anon',v_sig,'EXECUTE')
       OR has_function_privilege('authenticated',v_sig,'EXECUTE')
       OR NOT has_function_privilege('service_role',v_sig,'EXECUTE') THEN
      RAISE EXCEPTION 'issue #3872 M2 ACL mismatch for %',v_sig;
    END IF;
  END LOOP;
END;
$postcheck$;

NOTIFY pgrst,'reload schema';
COMMIT;
